import path from 'node:path';
import { startRelay } from '../relay.js';
import { resolveListenHost } from '../relay-listen.js';

const rootToken = process.env.RELAY_ROOT_TOKEN ?? '';
if (rootToken.length < 16) {
  console.error('RELAY_ROOT_TOKEN is required (at least 16 characters). Do not commit it.');
  process.exit(1);
}

const port = Number(process.env.RELAY_PORT ?? '8787');
const host = resolveListenHost(process.env.RELAY_HOST, process.env.RELAY_ALLOW_PUBLIC === '1');
const file = process.env.RELAY_STATE_FILE ?? path.join('.agentmaple', 'relay-state.json');
const worldTtlMs = optionalMs('RELAY_WORLD_TTL_MS');
const refreshTtlMs = optionalMs('RELAY_REFRESH_TTL_MS');

const relay = await startRelay({
  rootToken,
  port,
  host,
  file,
  ...(worldTtlMs ? { worldTtlMs } : {}),
  ...(refreshTtlMs ? { refreshTtlMs } : {}),
});

console.log(`agentmaple relay listening on ${relay.url}`);
console.log(`stateFile=${file}`);
console.log(`requestLog=${process.env.RELAY_LOG_REQUESTS === '1' ? 'on' : 'off'}`);
console.log('World tokens default to 30 days. Refresh tokens default to 90 days. Restart this process after replacing the code, with the same state file, so the village and characters stay.');
console.log('TLS on port 443 belongs in front of this process. MapleStory Worlds should call the public https endpoint.');
console.log('This process does not execute shell, git, or desktop commands.');

function optionalMs(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`${name} must be a positive number of milliseconds.`);
    process.exit(1);
  }
  return value;
}
