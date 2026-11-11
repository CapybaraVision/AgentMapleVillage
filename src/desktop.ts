/**
 * Optional future adapter for https://github.com/vercel-labs/agent-desktop (Apache-2.0).
 * That CLI is a computer-use tool. It does not contain a model loop, and it is not a
 * MapleStory Worlds editor automation tool. No agent-desktop source is vendored here.
 *
 * The adapter stays fail-closed: it never opens a socket and never accepts relay commands,
 * including when `enabled` is set. A verified local integration is future work.
 */

export class DesktopDisabledError extends Error {
  constructor(message = 'agent-desktop adapter is disabled and unverified; it does not open a command channel') {
    super(message);
  }
}

export interface DesktopAdapter {
  readonly id: 'agent-desktop';
  readonly enabled: boolean;
  describe(): string;
  run(action: string): Promise<never>;
}

export function createDesktopAdapter(opts?: { enabled?: boolean }): DesktopAdapter {
  const enabled = opts?.enabled === true;
  return {
    id: 'agent-desktop',
    enabled,
    describe() {
      return enabled
        ? 'enabled flag is set, but the adapter is still unverified and refuses every call'
        : 'disabled by default';
    },
    async run() {
      throw new DesktopDisabledError();
    },
  };
}
