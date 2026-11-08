import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeClaudeDriver } from '../src/claude-driver.js';
import { DesktopDisabledError, createDesktopAdapter } from '../src/desktop.js';
import { Office, OfficeError, claudeBackend, simBackend } from '../src/office.js';
import { DEFAULT_FOREMAN_SESSION, DEFAULT_WORKER_SESSION, lockoutIfExceeded, reflectionBudgetMs, requestsPerMinute, DEFAULT_POLL_INTERVAL_MS, MSW_HTTP_LIMIT_PER_MIN, REFLECTION_TARGET_MS } from '../src/protocol.js';

function dir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'amv-office-'));
}

describe('office sim', () => {
  it('runs goal, question, answer, and complete with stable session ids across restart', async () => {
    const file = path.join(dir(), 'state.json');
    const office = Office.create({ backend: simBackend(), file });
    const first = await office.apply('goal-1', 'goal.submit', { text: '게시판 정리' });
    expect(first.result.goalId).toBe('goal_1');
    const waiting = office.snapshot;
    const worker = waiting.characters.find((item) => item.sessionId === DEFAULT_WORKER_SESSION);
    expect(worker).toMatchObject({ state: 'waiting_user', station: 'user', sessionId: DEFAULT_WORKER_SESSION });
    expect(waiting.characters.find((item) => item.sessionId === DEFAULT_FOREMAN_SESSION)?.sessionId).toBe(DEFAULT_FOREMAN_SESSION);
    expect(waiting.decisions[0]?.status).toBe('open');
    expect(waiting.tasks).toHaveLength(1);

    const reloaded = Office.load({ file, backend: simBackend() });
    expect(reloaded.snapshot.characters.map((item) => item.sessionId).sort()).toEqual([DEFAULT_FOREMAN_SESSION, DEFAULT_WORKER_SESSION]);
    const replay = await reloaded.apply('goal-1', 'goal.submit', { text: '게시판 정리' });
    expect(replay.result.duplicate).toBe(true);
    expect(reloaded.snapshot.goals).toHaveLength(1);
    expect(replay.events.length).toBeGreaterThan(0);

    await expect(reloaded.apply('goal-1', 'goal.submit', { text: '다른 문장' })).rejects.toBeInstanceOf(OfficeError);
    const decisionId = reloaded.snapshot.decisions[0]!.id;
    const done = await reloaded.apply('answer-1', 'decision.answer', { decisionId, option: '이대로 진행' });
    expect(done.result.status).toBe('done');
    expect(reloaded.snapshot.goals[0]).toMatchObject({ status: 'done', sessionId: DEFAULT_WORKER_SESSION });
    expect(reloaded.snapshot.tasks[0]?.status).toBe('done');
    expect(reloaded.snapshot.characters.find((item) => item.sessionId === DEFAULT_WORKER_SESSION)).toMatchObject({ station: 'home', state: 'done', pace: true });

    const again = Office.load({ file, backend: simBackend() });
    expect(again.snapshot.goals[0]?.status).toBe('done');
    const replayAnswer = await again.apply('answer-1', 'decision.answer', { decisionId, option: '이대로 진행' });
    expect(replayAnswer.result.duplicate).toBe(true);
    expect(again.snapshot.goals).toHaveLength(1);
  });

  it('routes two worker sessions and rejects a crossed binding', async () => {
    const office = Office.create({ backend: simBackend() });
    await office.apply('bind-a', 'character.bind', { sessionId: 'ses_alpha', mapleActorId: 'npc-alpha', displayName: '작업자 갑', role: 'worker' });
    await office.apply('bind-b', 'character.bind', { sessionId: 'ses_beta', mapleActorId: 'npc-beta', displayName: '작업자 을', role: 'worker' });
    await expect(
      office.apply('bind-conflict', 'character.bind', { sessionId: 'ses_other', mapleActorId: 'npc-alpha', displayName: '다른 사람', role: 'worker' }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await office.apply('goal-a', 'goal.submit', { text: '갑의 목표', targetSessionId: 'ses_alpha' });
    await office.apply('goal-b', 'goal.submit', { text: '을의 목표', targetSessionId: 'ses_beta' });
    const decisions = office.snapshot.decisions;
    const alpha = decisions.find((item) => item.sessionId === 'ses_alpha');
    const beta = decisions.find((item) => item.sessionId === 'ses_beta');
    expect(alpha?.status).toBe('open');
    expect(beta?.status).toBe('open');
    await office.apply('answer-a', 'decision.answer', { decisionId: alpha!.id, option: '이대로 진행' });
    const after = office.snapshot;
    expect(after.goals.find((goal) => goal.sessionId === 'ses_alpha')?.status).toBe('done');
    expect(after.goals.find((goal) => goal.sessionId === 'ses_beta')?.status).toBe('active');
    expect(after.decisions.find((item) => item.sessionId === 'ses_beta')?.status).toBe('open');
    expect(after.characters.find((item) => item.sessionId === 'ses_alpha')?.station).toBe('home');
    expect(after.characters.find((item) => item.sessionId === 'ses_beta')?.station).toBe('user');
  });

  it('blocks a refused answer without completing the goal', async () => {
    const office = Office.create({ backend: simBackend() });
    await office.apply('goal-1', 'goal.submit', { text: '위험한 정리' });
    const decisionId = office.snapshot.decisions[0]!.id;
    const refused = await office.apply('answer-no', 'decision.answer', { decisionId, option: '거절' });
    expect(refused.result.denied).toBe(true);
    expect(office.snapshot.goals[0]?.status).toBe('failed');
    expect(office.snapshot.tasks[0]?.status).toBe('blocked');
    await expect(office.apply('shell-1', 'shell.exec', { cmd: 'git push' })).rejects.toMatchObject({ code: 'denied' });
  });

  it('keeps a busy session at the question and returns everyone home when the meeting is cancelled', async () => {
    const office = Office.create({ backend: simBackend() });
    await office.apply('goal-1', 'goal.submit', { text: '회의 중에도 질문은 유지' });
    const invited = await office.apply('meet-1', 'meeting.invite', { sessionIds: [DEFAULT_FOREMAN_SESSION, DEFAULT_WORKER_SESSION] });
    expect(invited.result.heldSessionIds).toEqual([DEFAULT_WORKER_SESSION]);
    expect(office.snapshot.characters.find((item) => item.sessionId === DEFAULT_WORKER_SESSION)?.station).toBe('user');
    expect(office.snapshot.characters.find((item) => item.sessionId === DEFAULT_FOREMAN_SESSION)?.station).toBe('meeting');
    expect(office.snapshot.decisions[0]?.status).toBe('open');
    const accepted = await office.apply('meet-ok', 'meeting.accept', { meetingId: invited.result.meetingId });
    expect(accepted.result.status).toBe('active');
    expect(office.snapshot.characters.find((item) => item.sessionId === DEFAULT_WORKER_SESSION)?.station).toBe('user');
    await office.apply('meet-no', 'meeting.cancel', { meetingId: invited.result.meetingId });
    expect(office.snapshot.characters.find((item) => item.sessionId === DEFAULT_FOREMAN_SESSION)).toMatchObject({ station: 'home', pace: true });
    expect(office.snapshot.characters.find((item) => item.sessionId === DEFAULT_WORKER_SESSION)?.station).toBe('user');
    expect(office.snapshot.decisions.filter((item) => item.status === 'open')).toHaveLength(1);
  });

  it('keeps a private workspace and one approval row per session across restart', async () => {
    const folder = dir();
    const file = path.join(folder, 'state.json');
    const office = Office.create({ backend: simBackend(), file, villageId: 'vil_alpha' });
    expect(fs.existsSync(path.join(folder, 'sessions', DEFAULT_WORKER_SESSION, 'bound.json'))).toBe(true);
    expect(fs.existsSync(path.join(folder, 'sessions', DEFAULT_FOREMAN_SESSION, 'bound.json'))).toBe(true);
    await office.apply('bind-a', 'character.bind', { sessionId: 'ses_alpha', mapleActorId: 'npc-alpha', displayName: '갑', role: 'worker' });
    expect(JSON.parse(fs.readFileSync(path.join(folder, 'sessions', 'ses_alpha', 'bound.json'), 'utf8')).sessionId).toBe('ses_alpha');
    await office.apply('goal-1', 'goal.submit', { text: '세션 작업 공간', targetSessionId: 'ses_alpha' });
    const decisionId = office.snapshot.decisions.find((item) => item.sessionId === 'ses_alpha')!.id;
    await office.apply('answer-1', 'decision.answer', { decisionId, option: '이대로 진행' });
    await office.apply('answer-1', 'decision.answer', { decisionId, option: '이대로 진행' });
    expect(office.approvalsFor('ses_alpha')).toEqual([{ commandId: 'answer-1', decision: '이대로 진행', writes: true }]);
    const again = Office.load({ file, backend: simBackend() });
    expect(again.approvalsFor('ses_alpha')).toHaveLength(1);
    expect(again.snapshot.library.nodes.some((node) => node.sessionId === 'ses_alpha' && node.kind === 'summary')).toBe(true);
  });

  it('reports real git paths from the session folder and refuses a command string', async () => {
    const folder = dir();
    const file = path.join(folder, 'state.json');
    const office = Office.create({ backend: simBackend(), file, villageId: 'vil_alpha' });
    const work = path.join(folder, 'sessions', DEFAULT_WORKER_SESSION);
    spawnSync('git', ['init'], { cwd: work, encoding: 'utf8' });
    fs.writeFileSync(path.join(work, 'notes.txt'), 'hello\n');
    const seen = await office.apply('see-1', 'workspace.inspect', { sessionId: DEFAULT_WORKER_SESSION });
    expect(String(seen.result.summary)).toContain('notes.txt');
    expect(String(seen.result.summary)).toContain('테스트 결과는 이 검사에 없습니다.');
    expect(office.snapshot.feed.some((item) => item.kind === 'change' && item.text.includes('notes.txt'))).toBe(true);
    await expect(office.apply('see-2', 'workspace.inspect', { sessionId: DEFAULT_WORKER_SESSION, cmd: 'rm -rf /' })).rejects.toMatchObject({ code: 'denied' });
  });
});

describe('claude session resume', () => {
  it('persists the fake session id and passes it as resume, and a denial does not complete the task', async () => {
    const file = path.join(dir(), 'state.json');
    const driver = new FakeClaudeDriver();
    const office = Office.create({ backend: claudeBackend(driver), file });
    await office.apply('goal-1', 'goal.submit', { text: '세션 이어가기' });
    expect(driver.calls[0]).toMatchObject({ intent: 'ask', sessionKey: `${DEFAULT_WORKER_SESSION}:task_1` });
    expect(driver.calls[0]?.resumeSessionId).toBeUndefined();
    const sessionId = office.snapshot.sessions.find((item) => item.sessionKey === `${DEFAULT_WORKER_SESSION}:task_1`)?.claudeSessionId;
    expect(sessionId).toMatch(/^fake_/);

    const resumed = new FakeClaudeDriver();
    const reloaded = Office.load({ file, backend: claudeBackend(resumed) });
    const decisionId = reloaded.snapshot.decisions[0]!.id;
    await reloaded.apply('answer-no', 'decision.answer', { decisionId, option: '거절' });
    expect(resumed.calls[0]).toMatchObject({ intent: 'work', resumeSessionId: sessionId });
    expect(reloaded.snapshot.tasks[0]).toMatchObject({ status: 'blocked' });
    expect(reloaded.snapshot.goals[0]?.status).toBe('failed');

    const allowedDriver = new FakeClaudeDriver();
    const allowed = Office.create({ backend: claudeBackend(allowedDriver) });
    await allowed.apply('goal-2', 'goal.submit', { text: '승인 후 완료' });
    const allowedDecision = allowed.snapshot.decisions[0]!.id;
    await allowed.apply('answer-yes', 'decision.answer', { decisionId: allowedDecision, option: '이대로 진행' });
    expect(allowedDriver.calls[1]?.resumeSessionId).toBe(allowedDriver.calls[0] && allowed.snapshot.sessions[0]?.claudeSessionId);
    expect(allowed.snapshot.goals[0]?.status).toBe('done');
    expect(allowed.snapshot.tasks[0]?.summary).toContain('승인');
  });
});

describe('desktop adapter', () => {
  it('stays closed even if the enabled flag is set', async () => {
    const disabled = createDesktopAdapter();
    const flagged = createDesktopAdapter({ enabled: true });
    expect(disabled.enabled).toBe(false);
    expect(flagged.enabled).toBe(true);
    await expect(disabled.run('screenshot')).rejects.toBeInstanceOf(DesktopDisabledError);
    await expect(flagged.run('click')).rejects.toBeInstanceOf(DesktopDisabledError);
    const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/desktop.ts'), 'utf8');
    expect(source).not.toMatch(/createServer|net\.listen|child_process/);
  });
});

describe('poll budget', () => {
  it('keeps the default poll under the documented HttpService quota', () => {
    const rate = requestsPerMinute(DEFAULT_POLL_INTERVAL_MS);
    expect(rate).toBe(30);
    expect(rate).toBeLessThan(MSW_HTTP_LIMIT_PER_MIN);
    expect(lockoutIfExceeded(120).allowed).toBe(true);
    expect(lockoutIfExceeded(121)).toEqual({ allowed: false, lockoutMs: 30_000 });
    const budget = reflectionBudgetMs(DEFAULT_POLL_INTERVAL_MS, 50);
    expect(budget).toBeGreaterThanOrEqual(REFLECTION_TARGET_MS.min);
    expect(REFLECTION_TARGET_MS.max).toBe(2_000);
  });
});
