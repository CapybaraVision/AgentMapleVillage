/**
 * Copy the generated overlay into an existing LocalWorkspace.
 * Refuses to run without a workspace path. Copies a backup of every file
 * it will replace before writing. Does not delete node_modules, profiles,
 * or unrelated world files. Does not call Maker and does not open a GUI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = process.argv[2];
if (!workspace) {
  console.error('Usage: node tools/deploy-msw-overlay.mjs <LocalWorkspace folder>');
  process.exit(1);
}
const root = path.resolve(workspace);
for (const required of ['Global', 'map', 'ui', 'RootDesk']) {
  if (!fs.existsSync(path.join(root, required))) {
    console.error(`Not a LocalWorkspace (missing ${required}): ${root}`);
    process.exit(1);
  }
}
const overlay = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../msw/workspace-overlay');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(path.dirname(root), `AgentMapleVillage-backup-${stamp}`);
fs.mkdirSync(backup, { recursive: true });

const relatives = walkFiles(overlay)
  .map((full) => path.relative(overlay, full))
  .filter((rel) => rel !== 'PROVENANCE.json');

for (const rel of relatives) {
  const dest = path.join(root, rel);
  if (fs.existsSync(dest)) {
    const bak = path.join(backup, rel);
    fs.mkdirSync(path.dirname(bak), { recursive: true });
    fs.copyFileSync(dest, bak);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(overlay, rel), dest);
  console.log(`wrote ${rel}`);
}
console.log(`backup ${backup}`);

const worldConfig = path.join(root, 'Global/WorldConfig.config');
if (!fs.existsSync(worldConfig)) {
  console.error('MISSING SEED: Global/WorldConfig.config. Confirm UseExtendedScriptFormat in Maker before refresh.');
  process.exitCode = 2;
} else {
  const text = fs.readFileSync(worldConfig, 'utf8');
  if (!text.includes('"UseExtendedScriptFormat"')) {
    console.error('WorldConfig.config has no UseExtendedScriptFormat field. Enable it in Maker. This script did not edit WorldConfig.');
    process.exitCode = 2;
  } else if (!/"UseExtendedScriptFormat"\s*:\s*true/.test(text)) {
    console.error('UseExtendedScriptFormat is not true. Enable it in Maker. This script did not edit WorldConfig.');
    process.exitCode = 2;
  }
}

const sector = path.join(root, 'Global/SectorConfig.config');
const mapId = 'map://AgentMapleVillage';
if (!fs.existsSync(sector)) {
  console.error(`MISSING SEED: Global/SectorConfig.config. Add ${mapId} to its entries after you have a backup. This script did not create that file.`);
  process.exitCode = 2;
} else {
  const original = fs.readFileSync(sector, 'utf8');
  if (original.includes(mapId)) {
    console.log('SectorConfig already lists the map');
  } else {
    let data;
    try {
      data = JSON.parse(original);
    } catch {
      data = null;
    }
    if (!data || !Array.isArray(data.entries) || data.entries.some((item) => typeof item !== 'string')) {
      console.error(`SectorConfig.entries is not a string array. Not modified. Add ${mapId} in Maker or send the file shape before retrying.`);
      process.exitCode = 2;
    } else {
      const bak = path.join(backup, 'Global/SectorConfig.config');
      fs.mkdirSync(path.dirname(bak), { recursive: true });
      fs.copyFileSync(sector, bak);
      data.entries.push(mapId);
      fs.writeFileSync(sector, `${JSON.stringify(data, null, 2)}\n`);
      console.log(`appended ${mapId}`);
    }
  }
}
console.log('Maker must be out of play mode. Then refresh. This script did not refresh or play.');

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}
