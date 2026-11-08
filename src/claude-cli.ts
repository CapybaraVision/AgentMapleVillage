/**
 * Argument list for the documented Claude Code print CLI.
 * Sources checked 2026-11-08:
 * - https://code.claude.com/docs/en/headless
 * - https://code.claude.com/docs/en/cli-reference
 *
 * The read-only probe uses `--output-format json` because that page shows
 * `session_id` on the JSON object and `--resume` taking that id.
 * `--tools ""` removes built-in tools. `--permission-mode default` does not
 * bypass prompts. `--dangerously-skip-permissions` and `bypassPermissions`
 * are rejected by assertReadOnlyClaudeArgs.
 */

export const READONLY_MAX_TURNS = '1';
export const READONLY_BUDGET_USD = '0.05';
export const READONLY_TIMEOUT_MS = 45_000;

const BANNED_FLAGS = ['--dangerously-skip-permissions', '--allowedTools', '--allowed-tools', '--bare'];
const BANNED_MODES = new Set(['bypassPermissions', 'acceptEdits', 'dontAsk', 'auto']);

export function readOnlyClaudeArgs(prompt: string, resumeSessionId?: string): string[] {
  if (!prompt.trim()) throw new Error('prompt is empty');
  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--max-turns',
    READONLY_MAX_TURNS,
    '--max-budget-usd',
    READONLY_BUDGET_USD,
    '--tools',
    '',
    '--permission-mode',
    'default',
  ];
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  assertReadOnlyClaudeArgs(args);
  return args;
}

export function assertReadOnlyClaudeArgs(args: string[]): void {
  for (const flag of BANNED_FLAGS) {
    if (args.includes(flag)) throw new Error(`read-only Claude args must not include ${flag}`);
  }
  const modeAt = args.indexOf('--permission-mode');
  const mode = modeAt >= 0 ? args[modeAt + 1] : 'default';
  if (!mode || BANNED_MODES.has(mode) || mode !== 'default') {
    throw new Error(`read-only Claude permission mode must be default, got ${mode ?? '(missing)'}`);
  }
  const toolsAt = args.indexOf('--tools');
  if (toolsAt < 0 || args[toolsAt + 1] !== '') throw new Error('read-only Claude args must pass --tools with an empty list');
  if (!args.includes('--max-turns') || !args.includes('--max-budget-usd')) {
    throw new Error('read-only Claude args must bound turns and budget');
  }
}

export interface ClaudePrintJson {
  sessionId: string;
  text: string;
  isError: boolean;
}

/** Parse one `--output-format json` object. Does not accept a permission-bypass field as success. */
export function parseClaudePrintJson(stdout: string): ClaudePrintJson {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Claude print output had no JSON object');
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
    session_id?: unknown;
    result?: unknown;
    is_error?: unknown;
  };
  if (typeof parsed.session_id !== 'string' || parsed.session_id.length === 0) {
    throw new Error('Claude print JSON had no session_id');
  }
  return {
    sessionId: parsed.session_id,
    text: typeof parsed.result === 'string' ? parsed.result : '',
    isError: parsed.is_error === true,
  };
}
