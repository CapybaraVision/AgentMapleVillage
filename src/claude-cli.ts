/**
 * Argument list for a read-only Claude Code print probe aimed at CLI 2.1.318.
 * Sources checked 2026-11-08:
 * - https://code.claude.com/docs/en/headless
 * - https://code.claude.com/docs/en/cli-reference
 * - https://code.claude.com/docs/en/changelog
 *
 * Installed Claude Code 2.1.318 `--help` lists `--output-format json`,
 * `--tools`, `--permission-mode default`, `--resume`, and `--max-budget-usd`.
 * It does not list `--max-turns`. The current CLI reference documents
 * `--max-turns` for print mode and does not name a minimum version that
 * includes 2.1.318. The probe therefore does not pass `--max-turns`.
 *
 * `--max-budget-usd` is documented as a client-side estimate of API-call
 * spend, which can differ from a bill. It is not a proven hard dollar cap
 * for claude.ai subscription usage, so this probe does not pass it and does
 * not describe it as one.
 *
 * Turn bounding for 2.1.318 is the script itself: one print, then one
 * `--resume` print, each killed by an external timeout. `--tools ""` removes
 * built-in tools. `--permission-mode default` does not bypass prompts.
 */

export const READONLY_TIMEOUT_MS = 45_000;

export const MAX_TURNS_ON_CLAUDE_2_1_318 = {
  flag: '--max-turns',
  installedHelpListsIt: false,
  passedByProbe: false,
  blocker:
    'Claude Code 2.1.318 --help omits --max-turns. The CLI reference at https://code.claude.com/docs/en/cli-reference lists the flag without a minimum version that includes 2.1.318, so the probe does not pass it.',
} as const;

export const MAX_BUDGET_USD_NOTE =
  'Official --max-budget-usd stops a print run at a client-side estimate of API-call spend. It is not a proven hard dollar cap for claude.ai subscription usage. The probe does not pass it.';

const BANNED_FLAGS = ['--dangerously-skip-permissions', '--allowedTools', '--allowed-tools', '--bare'];
const BANNED_MODES = new Set(['bypassPermissions', 'acceptEdits', 'dontAsk', 'auto']);

export function readOnlyClaudeArgs(prompt: string, resumeSessionId?: string): string[] {
  if (!prompt.trim()) throw new Error('prompt is empty');
  const args = ['-p', prompt, '--output-format', 'json', '--tools', '', '--permission-mode', 'default'];
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  assertReadOnlyClaudeArgs(args);
  return args;
}

/** Approved work still uses permission-mode default. It does not clear tools and does not skip prompts. */
export function approvedWorkClaudeArgs(prompt: string, resumeSessionId?: string): string[] {
  if (!prompt.trim()) throw new Error('prompt is empty');
  const args = ['-p', prompt, '--output-format', 'json', '--permission-mode', 'default'];
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  assertWorkClaudeArgs(args);
  return args;
}

export function assertWorkClaudeArgs(args: string[]): void {
  for (const flag of BANNED_FLAGS) {
    if (args.includes(flag)) throw new Error(`approved work Claude args must not include ${flag}`);
  }
  const modeAt = args.indexOf('--permission-mode');
  const mode = modeAt >= 0 ? args[modeAt + 1] : '';
  if (mode !== 'default') throw new Error(`approved work Claude permission mode must be default, got ${mode || '(missing)'}`);
  if (args.includes('--tools') && args[args.indexOf('--tools') + 1] === '') {
    throw new Error('approved work Claude args must not clear the tool list');
  }
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
  if (args.includes('--max-turns')) throw new Error(MAX_TURNS_ON_CLAUDE_2_1_318.blocker);
  if (args.includes('--max-budget-usd')) throw new Error(MAX_BUDGET_USD_NOTE);
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
