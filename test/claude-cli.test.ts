import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeCliDriver, ClaudeDriverError, type SpawnLike } from '../src/claude-driver.js';

type SpawnOptionsShell = boolean | string | undefined;

class FakeChild extends EventEmitter {
  stdout: Readable;
  private exitCode: number | null = null;
  private exitListener?: (code: number | null) => void;

  constructor(text: string) {
    super();
    this.stdout = Readable.from([text]);
    this.stdout.on('end', () => {
      this.exitCode = 0;
      this.exitListener?.(0);
    });
  }

  override on(event: string, listener: (...args: unknown[]) => void): this {
    if (event === 'exit') {
      const exitListener = listener as (code: number | null) => void;
      if (this.exitCode !== null) exitListener(this.exitCode);
      else this.exitListener = exitListener;
      return this;
    }
    return super.on(event, listener);
  }
}

describe('Claude Code CLI driver', () => {
  it('does not spawn when disabled or when a write is denied', async () => {
    let spawns = 0;
    const spawnImpl: SpawnLike = () => {
      spawns += 1;
      throw new Error('spawn should not be called');
    };
    const disabled = new ClaudeCodeCliDriver({ enabled: false, spawnImpl });
    await expect(
      disabled.runTurn({ intent: 'ask', sessionKey: 'ses_worker:task_1', prompt: 'hi', approve: async () => 'allow' }),
    ).rejects.toBeInstanceOf(ClaudeDriverError);
    const enabled = new ClaudeCodeCliDriver({ enabled: true, spawnImpl });
    const denied = await enabled.runTurn({
      intent: 'work',
      sessionKey: 'ses_worker:task_1',
      resumeSessionId: 'sess_existing',
      prompt: 'write notes',
      approve: async () => 'deny',
    });
    expect(denied.denied).toBe(true);
    expect(spawns).toBe(0);
  });

  it('captures session_id and passes --resume without a shell', async () => {
    const calls: Array<{ command: string; args: string[]; shell: SpawnOptionsShell }> = [];
    const spawnImpl: SpawnLike = (command, args, options) => {
      calls.push({ command, args, shell: options.shell });
      const resumed = args.includes('--resume');
      const sessionLine = resumed
        ? '{"type":"system","session_id":"sess_from_cli"}\n{"type":"result","result":"이어졌습니다","session_id":"sess_from_cli"}\n'
        : '{"type":"system","session_id":"sess_from_cli"}\n{"type":"result","result":"시작","session_id":"sess_from_cli"}\n';
      return new FakeChild(sessionLine) as unknown as ReturnType<SpawnLike>;
    };
    const driver = new ClaudeCodeCliDriver({ enabled: true, command: 'claude', spawnImpl });
    const first = await driver.runTurn({
      intent: 'ask',
      sessionKey: 'ses_worker:task_1',
      prompt: '범위 확인',
      approve: async () => 'deny',
    });
    expect(first.sessionId).toBe('sess_from_cli');
    expect(first.denied).toBe(false);
    expect(calls[0]?.shell).toBe(false);
    expect(calls[0]?.args).not.toContain('--resume');
    expect(calls[0]?.command).toBe('claude');

    const second = await driver.runTurn({
      intent: 'work',
      sessionKey: 'ses_worker:task_1',
      resumeSessionId: first.sessionId,
      prompt: '반영',
      approve: async () => 'allow',
    });
    expect(second.sessionId).toBe('sess_from_cli');
    expect(second.text).toBe('이어졌습니다');
    const resumeAt = calls[1]?.args.indexOf('--resume');
    expect(resumeAt).toBeGreaterThan(-1);
    expect(calls[1]?.args[resumeAt! + 1]).toBe('sess_from_cli');
    expect(calls[1]?.args).toContain('-p');
    expect(calls[1]?.shell).toBe(false);
  });
});
