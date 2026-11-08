/** Loopback is the default. A public bind is refused unless the operator sets the flag. This does not open a port by itself. */

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export function resolveListenHost(host: string | undefined, allowPublic = false): string {
  const value = host && host.trim().length > 0 ? host.trim() : '127.0.0.1';
  if (!LOOPBACK.has(value) && allowPublic !== true) {
    throw new Error('relay listen host must stay on loopback unless RELAY_ALLOW_PUBLIC=1');
  }
  return value;
}
