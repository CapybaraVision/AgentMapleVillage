import path from 'node:path';
import { postJson } from './http-client.js';
import { readJson, ensureDir, writeJsonAtomic } from './persist.js';
import { Office, OfficeError, type Clock, type WorkerBackend } from './office.js';
import { createDesktopAdapter, type DesktopAdapter } from './desktop.js';
import { isDeniedCommand, isWorldCommand, type DomainEvent } from './protocol.js';

interface ProfileAuth {
  villageId: string;
  connectorToken: string;
  lastCommandSeq: number;
}

interface VillageResponse {
  villageId: string;
  connectorToken: string;
  pairingCode: string;
  pairingExpiresAt: number;
}

interface PollResponse {
  cursor: number;
  commands: Array<{ relaySeq: number; commandId: string; type: string; payload: Record<string, unknown> }>;
}

export interface ConnectorOptions {
  relayUrl: string;
  profileDir: string;
  rootToken?: string;
  backend: WorkerBackend;
  clock?: Clock;
  fetchImpl?: typeof fetch;
  desktop?: DesktopAdapter;
}

/**
 * Outbound-only client. The MapleStory Worlds server cannot reach this process.
 * The connector polls the relay and applies commands locally. It never exposes a shell.
 */
export class Connector {
  readonly office: Office;
  readonly desktop: DesktopAdapter;
  private auth: ProfileAuth | undefined;

  constructor(private opts: ConnectorOptions) {
    ensureDir(opts.profileDir);
    this.office = Office.load({
      file: Office.statePath(opts.profileDir),
      backend: opts.backend,
      ...(opts.clock ? { clock: opts.clock } : {}),
    });
    this.auth = readJson<ProfileAuth>(this.authPath());
    this.desktop = opts.desktop ?? createDesktopAdapter({ enabled: false });
    if (this.auth?.villageId) this.office.bindVillage(this.auth.villageId);
  }

  get villageId(): string | undefined {
    return this.auth?.villageId;
  }

  async ensureVillage(displayName = '마을'): Promise<{ villageId: string; pairingCode?: string }> {
    if (this.auth) {
      this.office.bindVillage(this.auth.villageId);
      return { villageId: this.auth.villageId };
    }
    if (!this.opts.rootToken) throw new Error('RELAY_ROOT_TOKEN is required to create a village');
    const created = await postJson<VillageResponse>(
      `${this.opts.relayUrl}/v1/villages`,
      { displayName },
      this.opts.rootToken,
      this.opts.fetchImpl,
    );
    this.auth = { villageId: created.villageId, connectorToken: created.connectorToken, lastCommandSeq: 0 };
    this.saveAuth();
    this.office.bindVillage(created.villageId);
    return { villageId: created.villageId, pairingCode: created.pairingCode };
  }

  async pollOnce(): Promise<number> {
    const auth = this.requireAuth();
    const polled = await postJson<PollResponse>(
      `${this.opts.relayUrl}/v1/connector/poll`,
      { afterCommandSeq: auth.lastCommandSeq },
      auth.connectorToken,
      this.opts.fetchImpl,
    );
    let processed = 0;
    for (const command of polled.commands) {
      await this.consume(command);
      processed += 1;
    }
    return processed;
  }

  /** Rewind the outbound cursor without clearing office state. Used to prove replay is idempotent. */
  rewindCursor(seq = 0): void {
    const auth = this.requireAuth();
    auth.lastCommandSeq = seq;
    this.saveAuth();
  }

  private async consume(command: PollResponse['commands'][number]): Promise<void> {
    const auth = this.requireAuth();
    let events: DomainEvent[];
    try {
      if (isDeniedCommand(command.type) || !isWorldCommand(command.type)) {
        throw new OfficeError('denied', `refusing ${command.type} before any local action`);
      }
      const applied = await this.office.apply(command.commandId, command.type, command.payload ?? {});
      events = applied.events;
    } catch (error) {
      if (!(error instanceof OfficeError)) throw error;
      const message = error instanceof Error ? error.message : 'denied';
      const ts = Date.now();
      events = [
        {
          eventId: `${command.commandId}:error`,
          type: 'feed.add',
          ts,
          payload: { ts, kind: 'error', text: message },
        },
      ];
    }
    if (events.length > 0) {
      await postJson(
        `${this.opts.relayUrl}/v1/events`,
        { events },
        auth.connectorToken,
        this.opts.fetchImpl,
      );
    }
    auth.lastCommandSeq = command.relaySeq;
    this.saveAuth();
  }

  private requireAuth(): ProfileAuth {
    if (!this.auth) throw new Error('connector has no village yet');
    return this.auth;
  }

  private authPath(): string {
    return path.join(this.opts.profileDir, 'auth.json');
  }

  private saveAuth(): void {
    if (!this.auth) return;
    writeJsonAtomic(this.authPath(), this.auth);
  }
}
