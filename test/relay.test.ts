import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { postJson } from '../src/http-client.js';
import { startRelay, type Relay } from '../src/relay.js';

class ManualClock {
  t = 1_700_000_000_000;
  now(): number {
    return this.t;
  }
}

const relays: Relay[] = [];

afterEach(async () => {
  await Promise.all(relays.splice(0).map((relay) => relay.close()));
});

async function boot(opts: { clock?: ManualClock; file?: string; pairingTtlMs?: number; worldTtlMs?: number; maxEvents?: number } = {}) {
  const rootToken = 'root-token-for-tests-only';
  const relay = await startRelay({
    rootToken,
    ...(opts.clock ? { clock: opts.clock } : {}),
    ...(opts.file ? { file: opts.file } : {}),
    ...(opts.pairingTtlMs ? { pairingTtlMs: opts.pairingTtlMs } : {}),
    ...(opts.worldTtlMs ? { worldTtlMs: opts.worldTtlMs } : {}),
    ...(opts.maxEvents ? { maxEvents: opts.maxEvents } : {}),
  });
  relays.push(relay);
  return { relay, rootToken };
}

describe('relay auth and routing', () => {
  it('rejects missing, wrong, and cross-role tokens', async () => {
    const { relay, rootToken } = await boot();
    const created = await postJson<{ villageId: string; connectorToken: string; pairingCode: string }>(
      `${relay.url}/v1/villages`,
      { displayName: '마을' },
      rootToken,
    );
    const paired = await postJson<{ worldToken: string }>(`${relay.url}/v1/pair`, { pairingCode: created.pairingCode });

    await expect(postJson(`${relay.url}/v1/state`, { afterEventSeq: 0 })).rejects.toMatchObject({ status: 401 });
    await expect(postJson(`${relay.url}/v1/state`, { afterEventSeq: 0 }, 'not-a-token')).rejects.toMatchObject({ status: 403 });
    await expect(postJson(`${relay.url}/v1/state`, { afterEventSeq: 0 }, rootToken)).rejects.toMatchObject({ status: 403 });
    await expect(postJson(`${relay.url}/v1/commands`, { commandId: 'c1', type: 'goal.submit', issuedAt: Date.now(), payload: { text: 'x' } }, created.connectorToken)).rejects.toMatchObject({ status: 403 });
    await expect(postJson(`${relay.url}/v1/connector/poll`, { afterCommandSeq: 0 }, paired.worldToken)).rejects.toMatchObject({ status: 403 });
    await expect(postJson(`${relay.url}/v1/events`, { events: [] }, paired.worldToken)).rejects.toMatchObject({ status: 403 });

    const health = await fetch(`${relay.url}/v1/health`, { method: 'PUT' });
    expect(health.status).toBe(405);
  });

  it('rejects denied command types without queueing them', async () => {
    const clock = new ManualClock();
    const { relay, rootToken } = await boot({ clock });
    const created = await postJson<{ connectorToken: string; pairingCode: string }>(`${relay.url}/v1/villages`, {}, rootToken);
    const paired = await postJson<{ worldToken: string }>(`${relay.url}/v1/pair`, { pairingCode: created.pairingCode });
    for (const type of ['shell.exec', 'git.push', 'tool.run', 'desktop.exec', 'claude.exec']) {
      await expect(
        postJson(`${relay.url}/v1/commands`, { commandId: `bad-${type}`, type, issuedAt: clock.now(), payload: { cmd: 'rm -rf /' } }, paired.worldToken),
      ).rejects.toMatchObject({ status: 400, code: 'denied' });
    }
    const polled = await postJson<{ commands: unknown[] }>(`${relay.url}/v1/connector/poll`, { afterCommandSeq: 0 }, created.connectorToken);
    expect(polled.commands).toEqual([]);
  });

  it('dedupes commands, rejects conflicting bodies, and rejects stale issuedAt', async () => {
    const clock = new ManualClock();
    const { relay, rootToken } = await boot({ clock });
    const created = await postJson<{ connectorToken: string; pairingCode: string }>(`${relay.url}/v1/villages`, {}, rootToken);
    const paired = await postJson<{ worldToken: string }>(`${relay.url}/v1/pair`, { pairingCode: created.pairingCode });
    const first = await postJson<{ relaySeq: number; duplicate: boolean }>(
      `${relay.url}/v1/commands`,
      { commandId: 'goal-1', type: 'goal.submit', issuedAt: clock.now(), payload: { text: '같은 목표' } },
      paired.worldToken,
    );
    const again = await postJson<{ relaySeq: number; duplicate: boolean }>(
      `${relay.url}/v1/commands`,
      { commandId: 'goal-1', type: 'goal.submit', issuedAt: clock.now() + 10, payload: { text: '같은 목표' } },
      paired.worldToken,
    );
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(again.relaySeq).toBe(first.relaySeq);
    await expect(
      postJson(`${relay.url}/v1/commands`, { commandId: 'goal-1', type: 'goal.submit', issuedAt: clock.now(), payload: { text: '다른 목표' } }, paired.worldToken),
    ).rejects.toMatchObject({ status: 409, code: 'conflict' });
    await expect(
      postJson(`${relay.url}/v1/commands`, { commandId: 'goal-old', type: 'goal.submit', issuedAt: clock.now() - 10 * 60 * 1000, payload: { text: '늦음' } }, paired.worldToken),
    ).rejects.toMatchObject({ status: 401, code: 'replay' });
    const polled = await postJson<{ commands: Array<{ commandId: string }> }>(`${relay.url}/v1/connector/poll`, { afterCommandSeq: 0 }, created.connectorToken);
    expect(polled.commands.map((command) => command.commandId)).toEqual(['goal-1']);
  });

  it('expires pairing codes, refuses reuse, rotates world tokens, and rejects refresh replay', async () => {
    const clock = new ManualClock();
    const { relay, rootToken } = await boot({ clock, pairingTtlMs: 1_000, worldTtlMs: 5_000 });
    const created = await postJson<{ pairingCode: string }>(`${relay.url}/v1/villages`, {}, rootToken);
    clock.t += 1_001;
    await expect(postJson(`${relay.url}/v1/pair`, { pairingCode: created.pairingCode })).rejects.toMatchObject({ status: 401 });

    const fresh = await postJson<{ pairingCode: string }>(`${relay.url}/v1/villages`, {}, rootToken);
    const paired = await postJson<{ worldToken: string; refreshToken: string }>(`${relay.url}/v1/pair`, { pairingCode: fresh.pairingCode });
    await expect(postJson(`${relay.url}/v1/pair`, { pairingCode: fresh.pairingCode })).rejects.toMatchObject({ status: 401 });

    const rotated = await postJson<{ worldToken: string; refreshToken: string }>(`${relay.url}/v1/world/refresh`, { refreshToken: paired.refreshToken });
    await expect(postJson(`${relay.url}/v1/world/refresh`, { refreshToken: paired.refreshToken })).rejects.toMatchObject({ status: 401, code: 'replay' });
    await expect(postJson(`${relay.url}/v1/state`, { afterEventSeq: 0 }, paired.worldToken)).rejects.toMatchObject({ status: 403 });
    const state = await postJson<{ ok: boolean }>(`${relay.url}/v1/state`, { afterEventSeq: 0 }, rotated.worldToken);
    expect(state.ok).toBe(true);

    clock.t += 5_001;
    await expect(postJson(`${relay.url}/v1/state`, { afterEventSeq: 0 }, rotated.worldToken)).rejects.toMatchObject({ status: 401, code: 'expired' });
    await expect(postJson(`${relay.url}/v1/world/refresh`, { refreshToken: rotated.refreshToken })).rejects.toMatchObject({ status: 401, code: 'expired' });
  });

  it('isolates villages and dedupes events across a restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amv-relay-'));
    const file = path.join(dir, 'relay.json');
    const clock = new ManualClock();
    const rootToken = 'root-token-for-tests-only';
    const first = await startRelay({ rootToken, clock, file });
    relays.push(first);
    const villageA = await postJson<{ villageId: string; connectorToken: string; pairingCode: string }>(`${first.url}/v1/villages`, { displayName: 'A' }, rootToken);
    const villageB = await postJson<{ connectorToken: string; pairingCode: string }>(`${first.url}/v1/villages`, { displayName: 'B' }, rootToken);
    const worldA = await postJson<{ worldToken: string }>(`${first.url}/v1/pair`, { pairingCode: villageA.pairingCode });
    const worldB = await postJson<{ worldToken: string }>(`${first.url}/v1/pair`, { pairingCode: villageB.pairingCode });
    await postJson(`${first.url}/v1/commands`, { commandId: 'only-b', type: 'character.bind', issuedAt: clock.now(), payload: { sessionId: 'ses_b', mapleActorId: 'npc-b', displayName: '을', role: 'worker' } }, worldB.worldToken);
    const pollA = await postJson<{ commands: unknown[] }>(`${first.url}/v1/connector/poll`, { afterCommandSeq: 0 }, villageA.connectorToken);
    expect(pollA.commands).toEqual([]);
    await postJson(`${first.url}/v1/events`, {
      events: [{ eventId: 'only-b:0', type: 'feed.add', ts: clock.now(), payload: { ts: clock.now(), kind: 'system', text: '을만 보이는 기록' } }],
    }, villageB.connectorToken);
    await postJson(`${first.url}/v1/events`, {
      events: [{ eventId: 'only-b:0', type: 'feed.add', ts: clock.now(), payload: { ts: clock.now(), kind: 'system', text: '을만 보이는 기록' } }],
    }, villageB.connectorToken);
    const stateA = await postJson<{ view: { feed: unknown[] } }>(`${first.url}/v1/state`, { afterEventSeq: 0 }, worldA.worldToken);
    const stateB = await postJson<{ view: { feed: Array<{ text: string }> }; cursor: number }>(`${first.url}/v1/state`, { afterEventSeq: 0 }, worldB.worldToken);
    expect(stateA.view.feed).toEqual([]);
    expect(stateB.view.feed).toHaveLength(1);
    expect(stateB.cursor).toBe(1);
    await first.close();
    relays.pop();

    const second = await startRelay({ rootToken, clock, file });
    relays.push(second);
    const afterRestart = await postJson<{ view: { feed: Array<{ text: string }> }; cursor: number }>(`${second.url}/v1/state`, { afterEventSeq: 0 }, worldB.worldToken);
    expect(afterRestart.cursor).toBe(1);
    expect(afterRestart.view.feed[0]?.text).toBe('을만 보이는 기록');
    const delta = await postJson<{ mode: string; events: unknown[] }>(`${second.url}/v1/state`, { afterEventSeq: 1 }, worldB.worldToken);
    expect(delta.mode).toBe('delta');
    expect(delta.events).toEqual([]);
  });

  it('returns a snapshot when the event cursor falls behind retention', async () => {
    const clock = new ManualClock();
    const { relay, rootToken } = await boot({ clock, maxEvents: 2 });
    const created = await postJson<{ connectorToken: string; pairingCode: string }>(`${relay.url}/v1/villages`, {}, rootToken);
    const paired = await postJson<{ worldToken: string }>(`${relay.url}/v1/pair`, { pairingCode: created.pairingCode });
    for (let i = 1; i <= 4; i += 1) {
      await postJson(`${relay.url}/v1/events`, {
        events: [{ eventId: `e${i}`, type: 'feed.add', ts: clock.now(), payload: { ts: clock.now(), kind: 'system', text: `n${i}` } }],
      }, created.connectorToken);
    }
    const recovered = await postJson<{ mode: string; view: { feed: Array<{ text: string }> } }>(`${relay.url}/v1/state`, { afterEventSeq: 1 }, paired.worldToken);
    expect(recovered.mode).toBe('snapshot');
    expect(recovered.view.feed.map((item) => item.text)).toEqual(['n3', 'n4']);
  });
});
