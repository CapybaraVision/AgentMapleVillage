/**
 * Claude Code session driver.
 *
 * AgentCraft's Claude engine (MIT, not copied) resumes a session by passing the SDK `resume`
 * id captured from the stream (`onSession` / `SessionRecord.sessionId`). This driver keeps that
 * contract for the Claude Code CLI: `--resume <session_id>` and `session_id` on stream-json.
 *
 * It does not start a process unless `enabled` is set. Tests inject `spawnImpl`. This workspace
 * does not have an authenticated `claude` binary, and tests must not call a paid API.
 */

import { spawn, type SpawnOptions } from 'node:child_process';
import { approvedWorkClaudeArgs, parseClaudePrintJson, READONLY_TIMEOUT_MS, readOnlyClaudeArgs } from './claude-cli.js';

interface Spawned {
  stdout: NodeJS.ReadableStream;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'exit', listener: (code: number | null) => void): void;
}

export interface ApprovalRequest {
  toolName: string;
  summary: string;
  writes: boolean;
}

export type Approval = 'allow' | 'deny';

export interface TurnRequest {
  intent: 'ask' | 'work';
  sessionKey: string;
  resumeSessionId?: string;
  prompt: string;
  workdir?: string;
  approve: (request: ApprovalRequest) => Promise<Approval>;
}

export interface TurnResult {
  sessionId: string;
  text: string;
  denied: boolean;
  reason?: string;
}

export interface SessionDriver {
  readonly id: string;
  runTurn(request: TurnRequest): Promise<TurnResult>;
}

export interface SpawnLike {
  (command: string, args: string[], options: SpawnOptions): Spawned;
}

export class ClaudeDriverError extends Error {}

export class FakeClaudeDriver implements SessionDriver {
  readonly id = 'fake-claude';
  readonly calls: TurnRequest[] = [];
  private minted = 0;

  async runTurn(request: TurnRequest): Promise<TurnResult> {
    this.calls.push(request);
    const sessionId = request.resumeSessionId ?? `fake_${++this.minted}_${request.sessionKey.replaceAll(':', '_')}`;
    if (request.intent === 'ask') {
      return { sessionId, text: '범위 확인이 필요합니다.', denied: false };
    }
    const decision = await request.approve({ toolName: 'Write', summary: 'workspace write', writes: true });
    if (decision === 'deny') {
      return { sessionId, text: '', denied: true, reason: '쓰기 권한이 거부되었습니다.' };
    }
    return { sessionId, text: '가짜 Claude 세션이 쓰기를 승인 뒤에만 반영했습니다.', denied: false };
  }
}

export interface ClaudeCliOptions {
  enabled?: boolean;
  command?: string;
  spawnImpl?: SpawnLike;
}

/**
 * Fail-closed CLI adapter. `enabled: true` still needs an injected or real spawn.
 * Write intent asks for approval before the process is created. A denial does not spawn.
 */
export class ClaudeCodeCliDriver implements SessionDriver {
  readonly id = 'claude-code';

  constructor(private opts: ClaudeCliOptions = {}) {}

  async runTurn(request: TurnRequest): Promise<TurnResult> {
    if (this.opts.enabled !== true) {
      throw new ClaudeDriverError('Claude Code driver is disabled. Set claude.enabled only after a local authenticated CLI is verified.');
    }
    const work = request.intent === 'work';
    if (work) {
      if (!request.workdir) {
        return { sessionId: request.resumeSessionId ?? '', text: '', denied: true, reason: '세션 작업 폴더가 없어 Claude를 시작하지 않았습니다.' };
      }
      const decision = await request.approve({ toolName: 'Write', summary: 'Claude Code workspace write', writes: true });
      if (decision !== 'allow') {
        return {
          sessionId: request.resumeSessionId ?? '',
          text: '',
          denied: true,
          reason: '쓰기 권한이 거부되어 Claude Code 프로세스를 시작하지 않았습니다.',
        };
      }
    }
    const args = work
      ? approvedWorkClaudeArgs(request.prompt, request.resumeSessionId)
      : readOnlyClaudeArgs(request.prompt, request.resumeSessionId);
    const spawnImpl: SpawnLike = this.opts.spawnImpl ?? ((command, spawnArgs, options) => spawn(command, spawnArgs, { ...options, timeout: READONLY_TIMEOUT_MS }) as Spawned);
    const child = spawnImpl(this.opts.command ?? 'claude', args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(request.workdir ? { cwd: request.workdir } : {}),
    });
    const stdout = await readStream(child.stdout);
    const parsed = parseClaudePrintJson(stdout);
    await waitForExit(child);
    if (parsed.isError) throw new ClaudeDriverError('Claude print JSON reported is_error');
    return { sessionId: parsed.sessionId, text: parsed.text, denied: false };
  }
}

function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

function waitForExit(child: Spawned): Promise<void> {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code && code !== 0) reject(new ClaudeDriverError(`claude exited ${code}`));
      else resolve();
    });
  });
}
