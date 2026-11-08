/**
 * Smallest real Claude Code check: two read-only print turns in an empty directory.
 * Does not start unless this process's environment sets AGENTMAPLE_RUN_CLAUDE_PROBE=1.
 * The cloud workspace must not set that variable. No secrets are printed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseClaudePrintJson, READONLY_TIMEOUT_MS, readOnlyClaudeArgs } from '../claude-cli.js';

export function probeAllowed(env: NodeJS.ProcessEnv): boolean {
  return env.AGENTMAPLE_RUN_CLAUDE_PROBE === '1';
}

const FIRST_PROMPT = 'Reply with exactly the single word pong. Do not use tools.';
const SECOND_PROMPT = 'Reply with exactly the single word pong-again. Do not use tools.';

function runOnce(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`claude exceeded ${READONLY_TIMEOUT_MS}ms`));
    }, READONLY_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code && code !== 0) reject(new Error(`claude exited ${code}`));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

async function main(): Promise<void> {
  if (!probeAllowed(process.env)) {
    console.error('Refusing to start Claude. This process does not have AGENTMAPLE_RUN_CLAUDE_PROBE=1.');
    console.error('The cloud agent must not set that variable or borrow credentials.');
    process.exit(2);
  }
  const command = process.env.CLAUDE_COMMAND || 'claude';
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmaple-claude-empty-'));
  const firstArgs = readOnlyClaudeArgs(FIRST_PROMPT);
  const first = parseClaudePrintJson(await runOnce(command, firstArgs, cwd));
  if (first.isError || !first.sessionId) throw new Error('first Claude turn failed');
  const secondArgs = readOnlyClaudeArgs(SECOND_PROMPT, first.sessionId);
  const second = parseClaudePrintJson(await runOnce(command, secondArgs, cwd));
  const report = {
    cwd,
    sameSession: second.sessionId === first.sessionId,
    firstSessionId: first.sessionId,
    secondSessionId: second.sessionId,
    firstText: first.text,
    secondText: second.text,
    realProcess: true,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.sameSession) process.exit(1);
}

const isDirect = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'probe failed');
    process.exit(1);
  });
}
