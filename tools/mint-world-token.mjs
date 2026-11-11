import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function mintWorldToken(options = {}) {
  const rootToken = readRootToken(options);
  const relay = trimSlash(options.relay ?? 'http://127.0.0.1:8787');
  const villageId = options.villageId || villageFromState(options.state);
  const response = await fetch(`${relay}/v1/world/reissue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${rootToken}` },
    body: JSON.stringify(villageId ? { villageId } : {}),
  });
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok || parsed.ok === false) {
    const code = typeof parsed.error === 'string' ? parsed.error : 'http_error';
    throw new Error(`reissue failed status=${response.status} code=${code}`);
  }
  const worldToken = typeof parsed.worldToken === 'string' ? parsed.worldToken : '';
  const refreshToken = typeof parsed.refreshToken === 'string' ? parsed.refreshToken : '';
  if (worldToken.length < 16 || refreshToken.length < 16) throw new Error('reissue response did not include tokens');
  const outDir = options.outDir ?? path.join(process.cwd(), '.agentmaple');
  fs.mkdirSync(outDir, { recursive: true });
  const worldFile = path.join(outDir, 'world-token');
  const refreshFile = path.join(outDir, 'world-refresh-token');
  writeSecret(worldFile, worldToken);
  writeSecret(refreshFile, refreshToken);
  let backup = '';
  if (options.map) backup = writeMapTokens(options.map, worldToken, refreshToken, parsed.worldTokenExpiresAt);
  return {
    villageId: parsed.villageId,
    worldTokenLen: worldToken.length,
    refreshTokenLen: refreshToken.length,
    worldTokenExpiresAt: parsed.worldTokenExpiresAt,
    refreshTokenExpiresAt: parsed.refreshTokenExpiresAt,
    worldFile,
    refreshFile,
    backup,
  };
}

function readRootToken(options) {
  if (options.rootToken) return String(options.rootToken).trim();
  const file = options.rootFile ?? defaultRootFile();
  if (file && fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const fromEnv = process.env.RELAY_ROOT_TOKEN ?? '';
  if (fromEnv.trim().length >= 16) return fromEnv.trim();
  throw new Error('root token file was not found. Pass --root-file or set RELAY_ROOT_TOKEN.');
}

function defaultRootFile() {
  const home = process.env.USERPROFILE || os.homedir();
  const candidates = [
    path.join(home, '.agentmaple', 'relay-root-token'),
    path.join(process.cwd(), '.agentmaple', 'relay-root-token'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function villageFromState(stateFile) {
  if (!stateFile) return '';
  const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const ids = (parsed.villages ?? []).map((village) => village.id).filter((id) => typeof id === 'string' && id.length > 0);
  if (ids.length === 1) return ids[0];
  throw new Error(`villageId is required (${ids.length} villages in state)`);
}

function writeSecret(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${value}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

function writeMapTokens(mapPath, worldToken, refreshToken, expiresAt) {
  const backup = `${mapPath}.bak-${Date.now()}`;
  fs.copyFileSync(mapPath, backup);
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const entities = map.ContentProto?.Entities ?? [];
  let found = false;
  for (const entity of entities) {
    const asString = typeof entity.jsonString === 'string';
    const js = asString ? JSON.parse(entity.jsonString) : entity.jsonString;
    if (!js || !Array.isArray(js['@components'])) continue;
    let changed = false;
    for (const component of js['@components']) {
      if (component['@type'] !== 'script.VillageRelay') continue;
      component.WorldToken = worldToken;
      component.WorldRefreshToken = refreshToken;
      if (typeof expiresAt === 'number') component.WorldTokenExpiresAt = expiresAt;
      found = true;
      changed = true;
    }
    if (changed) entity.jsonString = asString ? JSON.stringify(js) : js;
  }
  if (!found) throw new Error('VillageRelay component was not found in the map');
  const tmp = `${mapPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(map, null, 2)}\n`);
  fs.renameSync(tmp, mapPath);
  return backup;
}

function trimSlash(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return undefined;
  return process.argv[index + 1];
}

async function main() {
  const result = await mintWorldToken({
    rootFile: arg('--root-file'),
    relay: arg('--relay'),
    state: arg('--state'),
    villageId: arg('--village'),
    map: arg('--map'),
    outDir: arg('--out-dir'),
  });
  console.log(`village=${result.villageId}`);
  console.log(`worldTokenLen=${result.worldTokenLen}`);
  console.log(`refreshTokenLen=${result.refreshTokenLen}`);
  console.log(`worldTokenExpiresAt=${result.worldTokenExpiresAt}`);
  console.log(`refreshTokenExpiresAt=${result.refreshTokenExpiresAt}`);
  console.log(`wrote ${result.worldFile}`);
  console.log(`wrote ${result.refreshFile}`);
  if (result.backup) console.log(`map backup=${result.backup}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : 'mint failed';
    console.error(message);
    process.exit(1);
  });
}
