import { startRelay } from '../relay.js';
import { resolveListenHost } from '../relay-listen.js';

const rootToken = process.env.RELAY_ROOT_TOKEN ?? '';
if (rootToken.length < 16) {
  console.error('RELAY_ROOT_TOKEN is required (at least 16 characters). Do not commit it.');
  process.exit(1);
}

const port = Number(process.env.RELAY_PORT ?? '8787');
const host = resolveListenHost(process.env.RELAY_HOST, process.env.RELAY_ALLOW_PUBLIC === '1');
const file = process.env.RELAY_STATE_FILE;

const relay = await startRelay({
  rootToken,
  port,
  host,
  ...(file ? { file } : {}),
});

console.log(`agentmaple relay listening on ${relay.url}`);
console.log('TLS on port 443 belongs in front of this process. MapleStory Worlds should call the public https endpoint.');
console.log('This process does not execute shell, git, or desktop commands.');
