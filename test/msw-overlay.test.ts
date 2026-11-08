import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const overlay = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../msw/workspace-overlay');

function readJson(rel: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(overlay, rel), 'utf8'));
}

function entities(file: { ContentProto?: { Entities?: Array<{ path?: string; jsonString?: { path?: string; '@components'?: Array<Record<string, unknown>> } }> } }) {
  return file.ContentProto?.Entities ?? [];
}

describe('backup-safe deploy', () => {
  it('copies the overlay and refuses to invent SectorConfig', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'amv-ws-'));
    for (const dir of ['Global', 'map', 'ui', 'RootDesk']) fs.mkdirSync(path.join(workspace, dir));
    fs.writeFileSync(path.join(workspace, 'Global/WorldConfig.config'), '{ "UseExtendedScriptFormat": true }\n');
    fs.writeFileSync(path.join(workspace, 'map/old.map'), 'keep\n');
    const deploy = path.resolve(overlay, '../../tools/deploy-msw-overlay.mjs');
    const result = spawnSync(process.execPath, [deploy, workspace], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('MISSING SEED: Global/SectorConfig.config');
    expect(fs.readFileSync(path.join(workspace, 'map/old.map'), 'utf8')).toBe('keep\n');
    expect(fs.existsSync(path.join(workspace, 'map/AgentMapleVillage.map'))).toBe(true);
    expect(fs.existsSync(path.join(workspace, 'ui/AgentMapleDesk.ui'))).toBe(true);
    expect(fs.readFileSync(path.join(workspace, 'RootDesk/MyDesk/AgentMapleVillage/OfficeNpc.mlua'), 'utf8')).toContain('ses_worker');
  });
});

describe('official builder overlay', () => {
  it('places the side-view village, two sessions, and both UI groups', () => {
    const map = readJson('map/AgentMapleVillage.map') as {
      EntryKey?: string;
      ContentProto?: { Entities?: Array<{ path?: string; jsonString?: { path?: string; '@components'?: Array<Record<string, unknown>> } }> };
    };
    expect(map.EntryKey).toBe('map://AgentMapleVillage');
    const list = entities(map);
    const mode = list
      .flatMap((entity) => entity.jsonString?.['@components'] ?? [])
      .find((component) => component['@type'] === 'MOD.Core.MapComponent');
    expect(mode?.TileMapMode).toBe(2);
    const foreman = list.find((entity) => entity.path === '/maps/AgentMapleVillage/Foreman');
    const worker = list.find((entity) => entity.path === '/maps/AgentMapleVillage/Worker');
    const relay = list.find((entity) => entity.path === '/maps/AgentMapleVillage/VillageRelay');
    expect(foreman?.jsonString?.['@components']?.some((component) => component['@type'] === 'script.OfficeNpc' && component.SessionId === 'ses_foreman')).toBe(true);
    expect(worker?.jsonString?.['@components']?.some((component) => component['@type'] === 'script.OfficeNpc' && component.SessionId === 'ses_worker' && component.SlotLabel === 'S02')).toBe(true);
    expect(relay?.jsonString?.['@components']?.some((component) => component['@type'] === 'script.VillageRelay')).toBe(true);
    expect(list.filter((entity) => entity.path?.startsWith('/maps/AgentMapleVillage/Desk'))).toHaveLength(6);
    for (const name of ['AgentMapleDesk', 'AgentMapleLibrary']) {
      const ui = readJson(`ui/${name}.ui`) as { ContentProto?: { Entities?: Array<{ path?: string }> } };
      expect(ui.ContentProto?.Entities?.some((entity) => entity.path === `/ui/${name}`)).toBe(true);
    }
    const script = fs.readFileSync(path.join(overlay, 'RootDesk/MyDesk/AgentMapleVillage/GoalDesk.mlua'), 'utf8');
    expect(script).toContain('/ui/AgentMapleDesk/GoalButton');
    expect(fs.readdirSync(overlay, { recursive: true }).some((name) => String(name).endsWith('.codeblock'))).toBe(false);
  });

  it('keeps every resource id inside the official skill provenance list', () => {
    const provenance = readJson('PROVENANCE.json') as {
      notTestedInCreator: boolean;
      skillCommit: string;
      note: string;
      ruids: Record<string, string>;
    };
    expect(provenance.notTestedInCreator).toBe(true);
    expect(provenance.skillCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(provenance.note).toContain('did not invent');
    const corpus = walk(overlay).filter((file) => !file.endsWith('PROVENANCE.json')).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    const found = [...corpus.matchAll(/\b[0-9a-f]{32}\b/g)].map((match) => match[0]);
    expect(new Set(found)).toEqual(new Set(Object.keys(provenance.ruids)));
    expect(found.length).toBeGreaterThan(0);
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
