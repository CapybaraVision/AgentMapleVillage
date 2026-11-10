import http from 'node:http';
import { hashesEqual, pairingCode, randomToken, sha256, secretsMatch, fingerprint } from './json.js';
import { readJson, writeJsonAtomic } from './persist.js';
import {
  COMMAND_ID_RE,
  foldEvents,
  isDeniedCommand,
  isEventType,
  isWorldCommand,
  type OfficeView,
} from './protocol.js';
import type { Clock } from './office.js';
import { systemClock } from './office.js';

const SKEW_MS = 5 * 60 * 1000;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const WORLD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_BODY = 256 * 1024;
const MAX_EVENTS = 500;

export interface RelayOptions {
  rootToken: string;
  host?: string;
  port?: number;
  clock?: Clock;
  file?: string;
  pairingTtlMs?: number;
  worldTtlMs?: number;
  refreshTtlMs?: number;
  skewMs?: number;
  maxEvents?: number;
}

interface StoredCommand {
  relaySeq: number;
  commandId: string;
  type: string;
  payload: Record<string, unknown>;
  issuedAt: number;
  acceptedAt: number;
}

interface StoredEvent {
  eventSeq: number;
  eventId: string;
  type: string;
  sessionId?: string;
  ts: number;
  payload: Record<string, unknown>;
}

interface CommandReceipt {
  fingerprint: string;
  relaySeq: number;
  response: Record<string, unknown>;
}

interface Village {
  id: string;
  displayName: string;
  connectorTokenHash: string;
  pairing?: { codeHash: string; expiresAt: number; used: boolean };
  world?: { tokenHash: string; refreshHash: string; expiresAt: number; refreshExpiresAt?: number };
  revokedRefresh: string[];
  commands: StoredCommand[];
  commandSeq: number;
  events: StoredEvent[];
  eventSeq: number;
  eventIndex: Record<string, number>;
  commandReceipts: Record<string, CommandReceipt>;
  createdAt: number;
}

interface TokenRef {
  villageId: string;
  role: 'connector' | 'world';
}

interface PersistedRelay {
  version: 1;
  villages: Village[];
}

export class Relay {
  private villages = new Map<string, Village>();
  private tokens = new Map<string, TokenRef>();
  private pairingIndex = new Map<string, string>();
  private server: http.Server | undefined;
  readonly clock: Clock;
  private urlValue = '';

  constructor(private opts: RelayOptions) {
    if (!opts.rootToken || opts.rootToken.length < 16) throw new Error('root token must be at least 16 characters');
    this.clock = opts.clock ?? systemClock;
    if (opts.file) {
      const saved = readJson<PersistedRelay>(opts.file);
      if (saved?.version === 1) {
        for (const village of saved.villages) this.remember(village);
      }
    }
  }

  get url(): string {
    return this.urlValue;
  }

  async start(): Promise<string> {
    const server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.opts.port ?? 0, this.opts.host ?? '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('relay failed to bind');
    this.urlValue = `http://${this.opts.host ?? '127.0.0.1'}:${address.port}`;
    return this.urlValue;
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }

  private persist(): void {
    if (!this.opts.file) return;
    const body: PersistedRelay = { version: 1, villages: [...this.villages.values()] };
    writeJsonAtomic(this.opts.file, body);
  }

  private remember(village: Village): void {
    this.villages.set(village.id, village);
    this.tokens.set(village.connectorTokenHash, { villageId: village.id, role: 'connector' });
    if (village.world) this.tokens.set(village.world.tokenHash, { villageId: village.id, role: 'world' });
    if (village.pairing && !village.pairing.used) this.pairingIndex.set(village.pairing.codeHash, village.id);
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const started = Date.now();
    attachRequestLog(req, res, started);
    try {
      const method = req.method ?? 'GET';
      if (method !== 'GET' && method !== 'POST') {
        send(res, 405, { ok: false, error: 'method_not_allowed', message: 'only GET and POST are accepted' });
        return;
      }
      const url = new URL(req.url ?? '/', 'http://relay.local');
      const path = url.pathname;
      if (path === '/v1/health') {
        send(res, 200, { ok: true, service: 'agentmaple-relay', protocol: 1 });
        return;
      }
      if (path === '/v1/time' && (method === 'GET' || method === 'POST')) return this.time(req, res);
      if (path === '/v1/state' && method === 'GET') return this.stateGet(req, res, url);
      if (method !== 'POST') {
        send(res, 404, { ok: false, error: 'not_found', message: 'unknown route' });
        return;
      }
      const body = await readBody(req);
      if (path === '/v1/villages') return this.createVillage(req, res, body);
      if (path === '/v1/pair') return this.pair(res, body);
      if (path === '/v1/world/refresh') return this.refresh(res, body);
      if (path === '/v1/world/reissue') return this.reissue(req, res, body);
      if (path === '/v1/commands') return this.enqueue(req, res, body);
      if (path === '/v1/connector/poll') return this.poll(req, res, body);
      if (path === '/v1/events') return this.ingest(req, res, body);
      if (path === '/v1/state') return this.state(req, res, body);
      send(res, 404, { ok: false, error: 'not_found', message: 'unknown route' });
    } catch (error) {
      const coded = error as { status?: number; code?: string; message?: string };
      if (coded.status && coded.code) {
        send(res, coded.status, { ok: false, error: coded.code, message: coded.message ?? coded.code });
        return;
      }
      send(res, 500, { ok: false, error: 'internal', message: 'relay failed' });
    }
  }

  private createVillage(req: http.IncomingMessage, res: http.ServerResponse, body: unknown): void {
    this.requireRoot(req);
    const record = asRecord(body);
    const displayName = typeof record.displayName === 'string' && record.displayName.trim() ? record.displayName.trim().slice(0, 40) : '마을';
    const connectorToken = randomToken('amv_connector');
    const code = pairingCode();
    const now = this.clock.now();
    const village: Village = {
      id: `vil_${randomToken('id').slice(3, 15)}`,
      displayName,
      connectorTokenHash: sha256(connectorToken),
      pairing: { codeHash: sha256(code), expiresAt: now + (this.opts.pairingTtlMs ?? PAIRING_TTL_MS), used: false },
      revokedRefresh: [],
      commands: [],
      commandSeq: 0,
      events: [],
      eventSeq: 0,
      eventIndex: {},
      commandReceipts: {},
      createdAt: now,
    };
    this.remember(village);
    this.persist();
    send(res, 201, {
      ok: true,
      villageId: village.id,
      connectorToken,
      pairingCode: code,
      pairingExpiresAt: village.pairing!.expiresAt,
    });
  }

  private pair(res: http.ServerResponse, body: unknown): void {
    const record = asRecord(body);
    const code = typeof record.pairingCode === 'string' ? record.pairingCode.trim() : '';
    if (!code) fail(400, 'bad_request', 'pairingCode is required');
    const villageId = this.pairingIndex.get(sha256(code));
    const village = villageId ? this.villages.get(villageId) : undefined;
    const pairing = village?.pairing;
    const now = this.clock.now();
    if (!village || !pairing || pairing.used || pairing.expiresAt <= now || !hashesEqual(pairing.codeHash, sha256(code))) {
      fail(401, 'unauthorized', 'pairing code is invalid, expired, or already used');
    }
    pairing.used = true;
    this.pairingIndex.delete(pairing.codeHash);
    const issued = this.issueWorld(village, now);
    this.persist();
    send(res, 200, { ok: true, villageId: village.id, serverTime: now, epoch: 'unix-ms', ...issued });
  }

  private time(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.requireRole(req, 'world');
    send(res, 200, { ok: true, serverTime: this.clock.now(), epoch: 'unix-ms' });
  }

  private refresh(res: http.ServerResponse, body: unknown): void {
    const record = asRecord(body);
    const refreshToken = typeof record.refreshToken === 'string' ? record.refreshToken : '';
    if (!refreshToken) fail(400, 'bad_request', 'refreshToken is required');
    const hash = sha256(refreshToken);
    const village = [...this.villages.values()].find((item) => item.world?.refreshHash === hash || item.revokedRefresh.includes(hash));
    if (!village?.world) fail(401, 'unauthorized', 'refresh token is invalid');
    if (village.revokedRefresh.includes(hash) || village.world.refreshHash !== hash) {
      fail(401, 'replay', 'refresh token was already used');
    }
    const now = this.clock.now();
    const refreshExpiresAt = village.world.refreshExpiresAt ?? village.world.expiresAt;
    if (refreshExpiresAt <= now) fail(401, 'expired', 'refresh token is expired');
    this.tokens.delete(village.world.tokenHash);
    village.revokedRefresh.push(hash);
    const issued = this.issueWorld(village, now);
    this.persist();
    send(res, 200, { ok: true, villageId: village.id, ...issued });
  }

  private reissue(req: http.IncomingMessage, res: http.ServerResponse, body: unknown): void {
    this.requireRoot(req);
    const record = asRecord(body);
    const requested = typeof record.villageId === 'string' ? record.villageId : '';
    const villages = [...this.villages.values()];
    const village = requested ? this.villages.get(requested) : villages.length === 1 ? villages[0] : undefined;
    if (!village) fail(404, 'not_found', requested ? 'village was not found' : 'villageId is required');
    if (village.world) {
      this.tokens.delete(village.world.tokenHash);
      village.revokedRefresh.push(village.world.refreshHash);
    }
    const issued = this.issueWorld(village, this.clock.now());
    this.persist();
    send(res, 200, { ok: true, villageId: village.id, serverTime: this.clock.now(), ...issued });
  }

  private issueWorld(village: Village, now: number): { worldToken: string; worldTokenExpiresAt: number; refreshToken: string; refreshTokenExpiresAt: number } {
    const worldToken = randomToken('amv_world');
    const refreshToken = randomToken('amv_refresh');
    const worldTtl = this.opts.worldTtlMs ?? WORLD_TTL_MS;
    let refreshTtl = this.opts.refreshTtlMs ?? REFRESH_TTL_MS;
    if (refreshTtl <= worldTtl) refreshTtl = worldTtl + 24 * 60 * 60 * 1000;
    const expiresAt = now + worldTtl;
    const refreshExpiresAt = now + refreshTtl;
    village.world = { tokenHash: sha256(worldToken), refreshHash: sha256(refreshToken), expiresAt, refreshExpiresAt };
    this.tokens.set(village.world.tokenHash, { villageId: village.id, role: 'world' });
    return { worldToken, worldTokenExpiresAt: expiresAt, refreshToken, refreshTokenExpiresAt: refreshExpiresAt };
  }

  private enqueue(req: http.IncomingMessage, res: http.ServerResponse, body: unknown): void {
    const village = this.requireRole(req, 'world');
    const record = asRecord(body);
    const commandId = typeof record.commandId === 'string' ? record.commandId : '';
    const type = typeof record.type === 'string' ? record.type : '';
    const issuedAt = record.issuedAt;
    const payload = asPayload(record.payload);
    if (!COMMAND_ID_RE.test(commandId)) fail(400, 'bad_request', 'invalid commandId');
    if (isDeniedCommand(type) || !isWorldCommand(type)) fail(400, 'denied', `command type ${type || '(empty)'} is not allowed on the relay`);
    const bodyFingerprint = fingerprint({ type, payload });
    const existing = village.commandReceipts[commandId];
    if (existing) {
      if (existing.fingerprint !== bodyFingerprint) fail(409, 'conflict', 'commandId was already accepted with a different body');
      send(res, 200, { ...existing.response, duplicate: true });
      return;
    }
    if (typeof issuedAt !== 'number' || !Number.isFinite(issuedAt)) fail(400, 'bad_request', 'issuedAt is required');
    const skew = Math.abs(this.clock.now() - issuedAt);
    if (skew > (this.opts.skewMs ?? SKEW_MS)) fail(401, 'replay', 'issuedAt is outside the acceptance window');
    const relaySeq = ++village.commandSeq;
    const acceptedAt = this.clock.now();
    village.commands.push({ relaySeq, commandId, type, payload, issuedAt, acceptedAt });
    const response = { ok: true, relaySeq, duplicate: false, commandId };
    village.commandReceipts[commandId] = { fingerprint: bodyFingerprint, relaySeq, response };
    this.persist();
    send(res, 202, response);
  }

  private poll(req: http.IncomingMessage, res: http.ServerResponse, body: unknown): void {
    const village = this.requireRole(req, 'connector');
    const record = asRecord(body);
    const after = typeof record.afterCommandSeq === 'number' ? record.afterCommandSeq : 0;
    if (!Number.isInteger(after) || after < 0) fail(400, 'bad_request', 'afterCommandSeq must be a non-negative integer');
    const commands = village.commands.filter((command) => command.relaySeq > after).slice(0, 50);
    send(res, 200, { ok: true, villageId: village.id, cursor: village.commandSeq, commands });
  }

  private ingest(req: http.IncomingMessage, res: http.ServerResponse, body: unknown): void {
    const village = this.requireRole(req, 'connector');
    const record = asRecord(body);
    if (!Array.isArray(record.events)) fail(400, 'bad_request', 'events array is required');
    if (record.events.length > 50) fail(400, 'bad_request', 'too many events');
    const accepted: Array<{ eventId: string; eventSeq: number; duplicate: boolean }> = [];
    for (const raw of record.events) {
      const event = asRecord(raw);
      const eventId = typeof event.eventId === 'string' ? event.eventId : '';
      const type = typeof event.type === 'string' ? event.type : '';
      if (!COMMAND_ID_RE.test(eventId) && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/.test(eventId)) {
        fail(400, 'bad_request', 'invalid eventId');
      }
      if (!isEventType(type)) fail(400, 'bad_request', `event type ${type} is not allowed`);
      const priorSeq = village.eventIndex[eventId];
      if (priorSeq !== undefined) {
        accepted.push({ eventId, eventSeq: priorSeq, duplicate: true });
        continue;
      }
      const payload = asPayload(event.payload);
      const eventSeq = ++village.eventSeq;
      const stored: StoredEvent = {
        eventSeq,
        eventId,
        type,
        ts: typeof event.ts === 'number' ? event.ts : this.clock.now(),
        payload,
        ...(typeof event.sessionId === 'string' ? { sessionId: event.sessionId } : {}),
      };
      village.events.push(stored);
      village.eventIndex[eventId] = eventSeq;
      accepted.push({ eventId, eventSeq, duplicate: false });
    }
    const maxEvents = this.opts.maxEvents ?? MAX_EVENTS;
    if (village.events.length > maxEvents) {
      const dropped = village.events.length - maxEvents;
      const removed = village.events.splice(0, dropped);
      for (const event of removed) delete village.eventIndex[event.eventId];
    }
    this.persist();
    send(res, 200, { ok: true, cursor: village.eventSeq, accepted });
  }

  private stateGet(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
    const raw = url.searchParams.get('afterEventSeq');
    const after = raw == null || raw === '' ? 0 : Number(raw);
    if (!Number.isInteger(after) || after < 0) fail(400, 'bad_request', 'afterEventSeq must be a non-negative integer');
    this.writeState(req, res, after);
  }

  private state(req: http.IncomingMessage, res: http.ServerResponse, body: unknown): void {
    const record = asRecord(body);
    const after = typeof record.afterEventSeq === 'number' ? record.afterEventSeq : 0;
    if (!Number.isInteger(after) || after < 0) fail(400, 'bad_request', 'afterEventSeq must be a non-negative integer');
    this.writeState(req, res, after);
  }

  private writeState(req: http.IncomingMessage, res: http.ServerResponse, after: number): void {
    const village = this.requireRole(req, 'world');
    const oldest = village.events[0]?.eventSeq ?? 0;
    const gap = after > 0 && oldest > 0 && after + 1 < oldest;
    const snapshot = after === 0 || gap;
    const events = snapshot ? [] : village.events.filter((event) => event.eventSeq > after);
    const view: OfficeView = foldEvents(village.events, 'sim');
    send(res, 200, {
      ok: true,
      villageId: village.id,
      serverTime: this.clock.now(),
      cursor: village.eventSeq,
      mode: snapshot ? 'snapshot' : 'delta',
      ...(snapshot ? { view } : {}),
      events,
    });
  }

  private requireRoot(req: http.IncomingMessage): void {
    const token = bearer(req);
    if (!token || !secretsMatch(this.opts.rootToken, token)) fail(401, 'unauthorized', 'root token was rejected');
  }

  private requireRole(req: http.IncomingMessage, role: 'connector' | 'world'): Village {
    const token = bearer(req);
    if (!token) fail(401, 'unauthorized', 'bearer token is required');
    const ref = this.tokens.get(sha256(token));
    if (!ref || ref.role !== role) fail(403, 'forbidden', `${role} token is required`);
    const village = this.villages.get(ref.villageId);
    if (!village) fail(401, 'unauthorized', 'unknown village');
    if (role === 'world') {
      if (!village.world || village.world.expiresAt <= this.clock.now()) fail(401, 'expired', 'world token is expired');
    }
    return village;
  }
}

export async function startRelay(opts: RelayOptions): Promise<Relay> {
  const relay = new Relay(opts);
  await relay.start();
  return relay;
}

function bearer(req: http.IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'bad_request', 'JSON object is required');
  return value as Record<string, unknown>;
}

function asPayload(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  const record = asRecord(value);
  const encoded = JSON.stringify(record);
  if (encoded.length > 16_000) fail(400, 'bad_request', 'payload is too large');
  return record;
}

function fail(status: number, code: string, message: string): never {
  const error = new Error(message) as Error & { status: number; code: string };
  error.status = status;
  error.code = code;
  throw error;
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  const bodyLen = Buffer.byteLength(json);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': bodyLen,
  });
  const logged = res as http.ServerResponse & { logHttp?: (status: number, bodyLen: number) => void };
  logged.logHttp?.(status, bodyLen);
  res.end(json);
}

function attachRequestLog(req: http.IncomingMessage, res: http.ServerResponse, started: number): void {
  if (process.env.RELAY_LOG_REQUESTS !== '1') return;
  const method = req.method ?? 'GET';
  let pathName = '/';
  try {
    pathName = new URL(req.url ?? '/', 'http://relay.local').pathname;
  } catch {
    pathName = '/';
  }
  (res as http.ServerResponse & { logHttp?: (status: number, bodyLen: number) => void }).logHttp = (status, bodyLen) => {
    console.log(`http method=${method} path=${pathName} status=${status} bodyLen=${bodyLen} ms=${Date.now() - started}`);
  };
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY) fail(413, 'bad_request', 'body is too large');
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    fail(400, 'bad_request', 'body must be JSON');
  }
}
