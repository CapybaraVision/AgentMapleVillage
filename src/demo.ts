import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Connector } from './connector.js';
import { postJson } from './http-client.js';
import { simBackend } from './office.js';
import { DEFAULT_WORKER_SESSION, type Decision, type Goal } from './protocol.js';
import { randomToken } from './json.js';
import { startRelay } from './relay.js';

export interface DemoReport {
  villageId: string;
  sessionId: string;
  goalStatus: string;
  question: string;
  hops: Array<{ name: string; ms: number }>;
  localRoundTripMs: number;
  acceptedRelaySeq: number;
}

interface StateResponse {
  mode: 'snapshot' | 'delta';
  cursor: number;
  view?: { goals: Goal[]; decisions: Decision[] };
  events: unknown[];
  serverTime: number;
}

interface PairResponse {
  villageId: string;
  worldToken: string;
  refreshToken: string;
}

interface CommandResponse {
  relaySeq: number;
  duplicate: boolean;
}

/**
 * In-process sim of goal -> task -> question -> answer -> complete.
 * No Claude API call and no MapleStory Worlds process.
 */
export async function runSimDemo(root?: string): Promise<DemoReport> {
  const dir = root ?? fs.mkdtempSync(path.join(os.tmpdir(), 'agentmaple-demo-'));
  const rootToken = randomToken('amv_root');
  const relay = await startRelay({ rootToken, file: path.join(dir, 'relay.json') });
  try {
    const connector = new Connector({
      relayUrl: relay.url,
      profileDir: path.join(dir, 'profile'),
      rootToken,
      backend: simBackend(),
    });
    const created = await connector.ensureVillage();
    if (!created.pairingCode) throw new Error('pairing code was not issued');
    const paired = await postJson<PairResponse>(`${relay.url}/v1/pair`, { pairingCode: created.pairingCode });
    const started = Date.now();
    const submitStarted = Date.now();
    const submitted = await postJson<CommandResponse>(
      `${relay.url}/v1/commands`,
      {
        commandId: 'goal-demo-1',
        type: 'goal.submit',
        issuedAt: Date.now(),
        payload: { text: '마을 게시판에 오늘 할 일을 정리해 주세요' },
      },
      paired.worldToken,
    );
    await connector.pollOnce();
    const afterGoal = Date.now();
    const waiting = await postJson<StateResponse>(`${relay.url}/v1/state`, { afterEventSeq: 0 }, paired.worldToken);
    const decision = waiting.view?.decisions.find((item) => item.status === 'open');
    if (!decision) throw new Error('sim did not open a question');
    const answerStarted = Date.now();
    await postJson(
      `${relay.url}/v1/commands`,
      {
        commandId: 'answer-demo-1',
        type: 'decision.answer',
        issuedAt: Date.now(),
        payload: { decisionId: decision.id, option: '이대로 진행' },
      },
      paired.worldToken,
    );
    await connector.pollOnce();
    const done = await postJson<StateResponse>(`${relay.url}/v1/state`, { afterEventSeq: 0 }, paired.worldToken);
    const goal = done.view?.goals.at(-1);
    if (!goal || goal.status !== 'done') throw new Error(`goal did not complete (${goal?.status ?? 'missing'})`);
    const finished = Date.now();
    return {
      villageId: created.villageId,
      sessionId: DEFAULT_WORKER_SESSION,
      goalStatus: goal.status,
      question: decision.question,
      hops: [
        { name: 'goal-to-question', ms: afterGoal - submitStarted },
        { name: 'answer-to-complete', ms: finished - answerStarted },
        { name: 'total', ms: finished - started },
      ],
      localRoundTripMs: finished - started,
      acceptedRelaySeq: submitted.relaySeq,
    };
  } finally {
    await relay.close();
  }
}
