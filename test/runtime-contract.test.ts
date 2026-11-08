import { describe, expect, it } from 'vitest';
import { assertReadOnlyClaudeArgs, parseClaudePrintJson, readOnlyClaudeArgs } from '../src/claude-cli.js';
import { probeAllowed } from '../src/bin/claude-readonly-probe.js';
import { unixMillisFromMswElapsed } from '../src/msw-clock.js';
import { postJson } from '../src/http-client.js';
import { startRelay } from '../src/relay.js';

describe('read-only Claude CLI contract', () => {
  it('builds a bounded resume call and rejects permission bypass', () => {
    const first = readOnlyClaudeArgs('Reply with exactly the single word pong. Do not use tools.');
    const second = readOnlyClaudeArgs('Reply with exactly the single word pong-again. Do not use tools.', 'sess_real');
    assertReadOnlyClaudeArgs(first);
    assertReadOnlyClaudeArgs(second);
    expect(second[second.indexOf('--resume') + 1]).toBe('sess_real');
    expect(first).not.toContain('--resume');
    expect(() => readOnlyClaudeArgs('x', 'sess') && assertReadOnlyClaudeArgs(['-p', 'x', '--dangerously-skip-permissions'])).toThrow(/dangerously-skip-permissions/);
    expect(() => assertReadOnlyClaudeArgs(['-p', 'x', '--permission-mode', 'bypassPermissions', '--tools', ''])).toThrow(/default/);
    const parsed = parseClaudePrintJson('log line\n{"session_id":"sess_real","result":"pong"}');
    expect(parsed).toEqual({ sessionId: 'sess_real', text: 'pong', isError: false });
  });

  it('does not treat the cloud process as authorized to run Claude', () => {
    expect(probeAllowed({})).toBe(false);
    expect(probeAllowed({ AGENTMAPLE_RUN_CLAUDE_PROBE: '0' })).toBe(false);
    expect(probeAllowed({ AGENTMAPLE_RUN_CLAUDE_PROBE: '1' })).toBe(true);
    expect(process.env.AGENTMAPLE_RUN_CLAUDE_PROBE).toBeUndefined();
  });
});

describe('MSW elapsed clock', () => {
  it('converts a non-unix millisecond counter with one relay sample', () => {
    const sample = { elapsed: 10_000, serverUnixMillis: 1_700_000_000_000 };
    expect(unixMillisFromMswElapsed(12_345, sample)).toBe(1_700_000_002_345);
    expect(unixMillisFromMswElapsed(sample.elapsed, sample)).toBe(sample.serverUnixMillis);
  });

  it('returns relay unix time only to a world token', async () => {
    const clock = { t: 1_700_000_000_123, now() { return this.t; } };
    const relay = await startRelay({ rootToken: 'root-token-for-tests-only', clock });
    try {
      const created = await postJson<{ pairingCode: string }>(`${relay.url}/v1/villages`, {}, 'root-token-for-tests-only');
      const paired = await postJson<{ worldToken: string; serverTime: number }>(`${relay.url}/v1/pair`, { pairingCode: created.pairingCode });
      expect(paired.serverTime).toBe(clock.t);
      await expect(postJson(`${relay.url}/v1/time`, {})).rejects.toMatchObject({ status: 401 });
      const timed = await postJson<{ serverTime: number; epoch: string }>(`${relay.url}/v1/time`, {}, paired.worldToken);
      expect(timed).toEqual({ ok: true, serverTime: clock.t, epoch: 'unix-ms' });
    } finally {
      await relay.close();
    }
  });
});
