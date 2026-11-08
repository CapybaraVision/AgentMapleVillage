import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Connector } from '../src/connector.js';
import { runSimDemo } from '../src/demo.js';
import { postJson } from '../src/http-client.js';
import { simBackend } from '../src/office.js';
import { DEFAULT_WORKER_SESSION, type Decision, type Goal, type Task } from '../src/protocol.js';
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

describe('connector integration', () => {
  it('completes a goal through the relay and survives cursor replay plus process restart', async () => {
    const clock = new ManualClock();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amv-int-'));
    const relay = await startRelay({ rootToken: 'root-token-for-tests-only', clock, file: path.join(root, 'relay.json') });
    relays.push(relay);
    const connector = new Connector({
      relayUrl: relay.url,
      profileDir: path.join(root, 'profile'),
      rootToken: 'root-token-for-tests-only',
      backend: simBackend(),
      clock,
    });
    const created = await connector.ensureVillage();
    expect(created.pairingCode).toBeTruthy();
    const paired = await postJson<{ worldToken: string }>(`${relay.url}/v1/pair`, { pairingCode: created.pairingCode! });

    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const started = performance.now();
      await postJson(`${relay.url}/v1/state`, { afterEventSeq: 0 }, paired.worldToken);
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    const p50 = ((samples[9] ?? 0) + (samples[10] ?? 0)) / 2;
    console.log(`MEASURED_LOCAL_P50_MS ${p50.toFixed(2)}`);
    expect(p50).toBeLessThan(500);

    const hopStarted = performance.now();
    await postJson(`${relay.url}/v1/commands`, {
      commandId: 'goal-village-1',
      type: 'goal.submit',
      issuedAt: clock.now(),
      payload: { text: '오늘 할 일을 게시판에 정리' },
    }, paired.worldToken);
    expect(await connector.pollOnce()).toBe(1);
    const waiting = await postJson<{ mode: string; view: { goals: Goal[]; tasks: Task[]; decisions: Decision[]; characters: Array<{ sessionId: string; station: string }> } }>(
      `${relay.url}/v1/state`,
      { afterEventSeq: 0 },
      paired.worldToken,
    );
    const hopMs = performance.now() - hopStarted;
    console.log(`MEASURED_LOCAL_GOAL_TO_QUESTION_MS ${hopMs.toFixed(2)}`);
    expect(hopMs).toBeLessThan(1_000);
    expect(waiting.mode).toBe('snapshot');
    expect(waiting.view.characters.find((item) => item.sessionId === DEFAULT_WORKER_SESSION)?.station).toBe('user');
    expect(waiting.view.tasks[0]?.status).toBe('doing');
    const decision = waiting.view.decisions.find((item) => item.status === 'open');
    expect(decision?.sessionId).toBe(DEFAULT_WORKER_SESSION);

    const restarted = new Connector({
      relayUrl: relay.url,
      profileDir: path.join(root, 'profile'),
      backend: simBackend(),
      clock,
    });
    expect(restarted.office.snapshot.characters.find((item) => item.sessionId === DEFAULT_WORKER_SESSION)?.sessionId).toBe(DEFAULT_WORKER_SESSION);
    expect(restarted.villageId).toBe(created.villageId);
    restarted.rewindCursor(0);
    expect(await restarted.pollOnce()).toBe(1);
    expect(restarted.office.snapshot.goals).toHaveLength(1);

    await postJson(`${relay.url}/v1/commands`, {
      commandId: 'answer-village-1',
      type: 'decision.answer',
      issuedAt: clock.now(),
      payload: { decisionId: decision!.id, option: '이대로 진행', text: '그 범위로 진행합니다' },
    }, paired.worldToken);
    expect(await restarted.pollOnce()).toBe(1);
    const done = await postJson<{ view: { goals: Goal[]; characters: Array<{ sessionId: string; station: string; state: string }> } }>(
      `${relay.url}/v1/state`,
      { afterEventSeq: 0 },
      paired.worldToken,
    );
    expect(done.view.goals[0]?.status).toBe('done');
    expect(done.view.characters.find((item) => item.sessionId === DEFAULT_WORKER_SESSION)).toMatchObject({ station: 'desk', state: 'done' });
  });

  it('runs the packaged sim demo without a model call', async () => {
    const report = await runSimDemo();
    expect(report.goalStatus).toBe('done');
    expect(report.sessionId).toBe(DEFAULT_WORKER_SESSION);
    expect(report.question).toContain('이 목표를 이 범위로 진행할까요?');
    console.log(`MEASURED_DEMO_TOTAL_MS ${report.localRoundTripMs}`);
    expect(report.localRoundTripMs).toBeLessThan(1_000);
  });
});
