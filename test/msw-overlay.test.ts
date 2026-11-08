import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const overlay = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../msw/workspace-overlay');

function readJson(rel: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(overlay, rel), 'utf8'));
}

function entities(file: { ContentProto?: { Entities?: Array<{ path?: string; jsonString?: { path?: string; '@components'?: Array<Record<string, unknown>> } }> } }) {
  return file.ContentProto?.Entities ?? [];
}

const deploy = path.resolve(overlay, '../../tools/deploy-msw-overlay.mjs');

function basicWorkspace(mode = 0, stringJson = false): { parent: string; workspace: string; mapBytes: string } {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'amv-parent-'));
  const workspace = path.join(parent, 'MapleAIgent');
  fs.mkdirSync(path.join(workspace, 'Global'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'map'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'ui'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'RootDesk/MyDesk'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'Environment'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'Environment/config'), 'keep-env\n');
  fs.writeFileSync(path.join(workspace, 'Global/WorldConfig.config'), `${JSON.stringify({
    ContentProto: { Json: { UseExtendedScriptFormat: true, SourceLanguage: 'ko' } },
  })}\n`);
  fs.writeFileSync(path.join(workspace, 'RootDesk/MyDesk/UIPopup.codeblock'), 'keep-block\n');
  fs.writeFileSync(path.join(workspace, 'RootDesk/MyDesk/UIPopup.mlua'), 'keep-popup\n');
  fs.writeFileSync(path.join(workspace, 'ui/DefaultGroup.ui'), 'keep-ui\n');
  const rootJson = {
    name: 'map01',
    path: '/maps/map01',
    '@components': [{ '@type': 'MOD.Core.MapComponent', TileMapMode: mode }],
  };
  const map = {
    ContentType: 'x-mod/map',
    EntryKey: 'map://map01',
    ContentProto: {
      Entities: [{
        id: '11111111-1111-4111-8111-111111111111',
        path: '/maps/map01',
        componentNames: 'MOD.Core.MapComponent',
        jsonString: stringJson ? JSON.stringify(rootJson) : rootJson,
      }],
    },
  };
  const mapBytes = `${JSON.stringify(map)}\n`;
  fs.writeFileSync(path.join(workspace, 'map/map01.map'), mapBytes);
  return { parent, workspace, mapBytes };
}

function runDeploy(workspace: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [deploy, workspace], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('Basic workspace deploy', () => {
  it('places the village on map01 when SectorConfig is absent and writes nothing before the checks pass', () => {
    const { parent, workspace, mapBytes } = basicWorkspace(0, true);
    const worldBefore = fs.readFileSync(path.join(workspace, 'Global/WorldConfig.config'), 'utf8');
    const result = runDeploy(workspace);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No SectorConfig file was created');
    expect(fs.existsSync(path.join(workspace, 'Global/SectorConfig.config'))).toBe(false);
    expect(fs.existsSync(path.join(workspace, 'map/AgentMapleVillage.map'))).toBe(false);
    expect(fs.readFileSync(path.join(workspace, 'Global/WorldConfig.config'), 'utf8')).toBe(worldBefore);
    expect(fs.readFileSync(path.join(workspace, 'Environment/config'), 'utf8')).toBe('keep-env\n');
    expect(fs.readFileSync(path.join(workspace, 'RootDesk/MyDesk/UIPopup.mlua'), 'utf8')).toBe('keep-popup\n');
    expect(fs.readFileSync(path.join(workspace, 'RootDesk/MyDesk/UIPopup.codeblock'), 'utf8')).toBe('keep-block\n');
    expect(fs.readFileSync(path.join(workspace, 'ui/DefaultGroup.ui'), 'utf8')).toBe('keep-ui\n');
    expect(fs.existsSync(path.join(workspace, 'ui/AgentMapleDesk.ui'))).toBe(true);
    expect(fs.existsSync(path.join(workspace, 'ui/AgentMapleLibrary.ui'))).toBe(true);
    const written = JSON.parse(fs.readFileSync(path.join(workspace, 'map/map01.map'), 'utf8')) as {
      ContentProto: { Entities: Array<{ path?: string; jsonString?: string | { path?: string; '@components'?: Array<Record<string, unknown>> } }> };
    };
    const root = written.ContentProto.Entities.find((entity) => entity.path === '/maps/map01');
    expect(typeof root?.jsonString).toBe('string');
    const foreman = written.ContentProto.Entities.find((entity) => entity.path === '/maps/map01/Foreman');
    expect(foreman).toBeTruthy();
    const foremanJson = typeof foreman?.jsonString === 'string' ? JSON.parse(foreman.jsonString) as { '@components'?: Array<Record<string, unknown>> } : foreman?.jsonString;
    const types = (foremanJson?.['@components'] ?? []).map((component) => component['@type']);
    expect(types).toContain('MOD.Core.RigidbodyComponent');
    const foremanTransform = (foremanJson?.['@components'] ?? []).find((component) => component['@type'] === 'MOD.Core.TransformComponent') as { Position?: { y?: number } } | undefined;
    expect(foremanTransform?.Position?.y).toBe(0);
    const mapMode = JSON.parse(String(root?.jsonString))['@components'].find((component: { '@type'?: string }) => component['@type'] === 'MOD.Core.MapComponent');
    expect(mapMode.TileMapMode).toBe(0);
    expect(types).not.toContain('MOD.Core.SideviewbodyComponent');
    const relay = written.ContentProto.Entities.find((entity) => entity.path === '/maps/map01/VillageRelay');
    const relayJson = typeof relay?.jsonString === 'string' ? JSON.parse(relay.jsonString) as { '@components'?: Array<Record<string, unknown>> } : relay?.jsonString;
    const relayScript = relayJson?.['@components']?.find((component) => component['@type'] === 'script.VillageRelay');
    expect(relayScript?.ForemanNpcPath).toBe('/maps/map01/Foreman');
    expect(fs.readFileSync(path.join(workspace, 'RootDesk/MyDesk/AgentMapleVillage/VillageRelay.mlua'), 'utf8')).toContain('/maps/map01/Foreman');
    expect(fs.readFileSync(path.join(workspace, 'RootDesk/MyDesk/AgentMapleVillage/GoalDesk.mlua'), 'utf8')).toContain('/maps/map01/VillageRelay');
    expect(fs.readFileSync(path.join(workspace, 'RootDesk/MyDesk/AgentMapleVillage/OfficeNpc.mlua'), 'utf8')).toContain('ses_worker');
    expect(fs.readdirSync(path.join(workspace, 'RootDesk/MyDesk/AgentMapleVillage')).some((name) => name.endsWith('.codeblock'))).toBe(false);
    const backups = fs.readdirSync(parent).filter((name) => name.startsWith('AgentMapleVillage-backup-'));
    expect(backups).toHaveLength(1);
    const backup = path.join(parent, backups[0]);
    expect(backup.startsWith(`${workspace}${path.sep}`)).toBe(false);
    expect(fs.readFileSync(path.join(backup, 'map/map01.map'), 'utf8')).toBe(mapBytes);
    const again = runDeploy(workspace);
    expect(again.status).toBe(0);
    const second = JSON.parse(fs.readFileSync(path.join(workspace, 'map/map01.map'), 'utf8')) as {
      ContentProto: { Entities: Array<{ path?: string }> };
    };
    expect(second.ContentProto.Entities.filter((entity) => entity.path === '/maps/map01/Foreman')).toHaveLength(1);
    expect(second.ContentProto.Entities.filter((entity) => entity.path?.startsWith('/maps/map01/Desk'))).toHaveLength(6);
  });

  it('keeps Sideviewbody when map01 is already TileMapMode 2', () => {
    const { workspace } = basicWorkspace(2, false);
    expect(runDeploy(workspace).status).toBe(0);
    const written = JSON.parse(fs.readFileSync(path.join(workspace, 'map/map01.map'), 'utf8')) as {
      ContentProto: { Entities: Array<{ path?: string; jsonString?: { '@components'?: Array<Record<string, unknown>> } }> };
    };
    const foreman = written.ContentProto.Entities.find((entity) => entity.path === '/maps/map01/Foreman');
    const types = (foreman?.jsonString?.['@components'] ?? []).map((component) => component['@type']);
    expect(types).toContain('MOD.Core.SideviewbodyComponent');
    expect(types).not.toContain('MOD.Core.RigidbodyComponent');
  });

  it('adds a template floor only when the map has no walkable row, and keeps an existing row and unrelated entity', () => {
    const bare = basicWorkspace(2, false);
    expect(runDeploy(bare.workspace).status).toBe(0);
    const bareMap = JSON.parse(fs.readFileSync(path.join(bare.workspace, 'map/map01.map'), 'utf8')) as {
      ContentProto: { Entities: Array<{ path?: string; jsonString?: { '@components'?: Array<Record<string, unknown>> } }> };
    };
    const bareTile = bareMap.ContentProto.Entities.find((entity) => entity.path === '/maps/map01/RectTileMap');
    const bareComponent = bareTile?.jsonString?.['@components']?.find((component) => component['@type'] === 'MOD.Core.RectTileMapComponent');
    const bareTiles = bareComponent?.tileMap as Array<{ position: { x: number; y: number } }>;
    expect(bareTiles?.some((tile) => tile.position.x === 0 && tile.position.y === -1)).toBe(true);
    const bareMode = bareMap.ContentProto.Entities.find((entity) => entity.path === '/maps/map01')?.jsonString?.['@components']?.find((component) => component['@type'] === 'MOD.Core.MapComponent');
    expect(bareMode?.TileMapMode).toBe(2);

    const { workspace } = basicWorkspace(2, false);
    const map = JSON.parse(fs.readFileSync(path.join(workspace, 'map/map01.map'), 'utf8')) as {
      ContentProto: { Entities: Array<Record<string, unknown>> };
    };
    const tiles = [];
    for (let x = 0; x < 8; x += 1) tiles.push({ type: 0, position: { x, y: 3 }, tileIndex: 1 });
    map.ContentProto.Entities.push({
      id: '22222222-2222-4222-8222-222222222222',
      path: '/maps/map01/RectTileMap',
      componentNames: 'MOD.Core.TransformComponent,MOD.Core.RectTileMapComponent',
      jsonString: {
        name: 'RectTileMap',
        path: '/maps/map01/RectTileMap',
        '@components': [
          { '@type': 'MOD.Core.TransformComponent', Position: { x: 0, y: 0, z: 1000 }, Enable: true },
          { '@type': 'MOD.Core.RectTileMapComponent', TileSetRUID: 'tileset://already-here', Enable: true, tileMap: tiles },
        ],
      },
    });
    map.ContentProto.Entities.push({
      id: '33333333-3333-4333-8333-333333333333',
      path: '/maps/map01/KeepMe',
      componentNames: 'MOD.Core.TransformComponent',
      jsonString: { name: 'KeepMe', path: '/maps/map01/KeepMe', '@components': [{ '@type': 'MOD.Core.TransformComponent', Position: { x: 1, y: 2, z: 0 }, Enable: true }] },
    });
    map.ContentProto.Entities.push({
      id: '44444444-4444-4444-8444-444444444444',
      path: '/maps/map01/SpawnLocation',
      componentNames: 'MOD.Core.TransformComponent,MOD.Core.SpawnLocationComponent',
      jsonString: { name: 'SpawnLocation', path: '/maps/map01/SpawnLocation', '@components': [{ '@type': 'MOD.Core.TransformComponent', Position: { x: 2, y: 9, z: 0 }, Enable: true }, { '@type': 'MOD.Core.SpawnLocationComponent', Enable: true }] },
    });
    fs.writeFileSync(path.join(workspace, 'map/map01.map'), JSON.stringify(map));
    expect(runDeploy(workspace).status).toBe(0);
    const written = JSON.parse(fs.readFileSync(path.join(workspace, 'map/map01.map'), 'utf8')) as {
      ContentProto: { Entities: Array<{ path?: string; jsonString?: { '@components'?: Array<Record<string, unknown>>; path?: string } }> };
    };
    const tile = written.ContentProto.Entities.find((entity) => entity.path === '/maps/map01/RectTileMap')?.jsonString?.['@components']?.find((component) => component['@type'] === 'MOD.Core.RectTileMapComponent');
    expect(tile?.TileSetRUID).toBe('tileset://already-here');
    expect(tile?.tileMap).toHaveLength(8);
    const foreman = written.ContentProto.Entities.find((entity) => entity.path === '/maps/map01/Foreman')?.jsonString?.['@components']?.find((component) => component['@type'] === 'MOD.Core.TransformComponent') as { Position?: { y?: number } };
    expect(foreman.Position?.y).toBe(4);
    const keep = written.ContentProto.Entities.find((entity) => entity.path === '/maps/map01/KeepMe')?.jsonString?.['@components']?.find((component) => component['@type'] === 'MOD.Core.TransformComponent') as { Position?: { x?: number; y?: number } };
    expect(keep.Position).toMatchObject({ x: 1, y: 2 });
    const spawn = written.ContentProto.Entities.find((entity) => entity.path === '/maps/map01/SpawnLocation')?.jsonString?.['@components']?.find((component) => component['@type'] === 'MOD.Core.TransformComponent') as { Position?: { x?: number; y?: number } };
    expect(spawn.Position).toMatchObject({ x: 2, y: 4 });
    const mode = written.ContentProto.Entities.find((entity) => entity.path === '/maps/map01')?.jsonString?.['@components']?.find((component) => component['@type'] === 'MOD.Core.MapComponent');
    expect(mode?.TileMapMode).toBe(2);
  });

  it('rejects a SectorConfig whose entries are not a string array before any write', () => {
    for (const entries of [1, { 'map://map01': true }, null]) {
      const { parent, workspace, mapBytes } = basicWorkspace();
      fs.writeFileSync(path.join(workspace, 'Global/SectorConfig.config'), `${JSON.stringify({ entries })}\n`);
      const sectorBytes = fs.readFileSync(path.join(workspace, 'Global/SectorConfig.config'), 'utf8');
      const result = runDeploy(workspace);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('SectorConfig.entries is not a string array');
      expect(result.stdout).not.toContain('wrote ');
      expect(fs.readFileSync(path.join(workspace, 'map/map01.map'), 'utf8')).toBe(mapBytes);
      expect(fs.readFileSync(path.join(workspace, 'Global/SectorConfig.config'), 'utf8')).toBe(sectorBytes);
      expect(fs.existsSync(path.join(workspace, 'ui/AgentMapleDesk.ui'))).toBe(false);
      expect(fs.existsSync(path.join(workspace, 'map/AgentMapleVillage.map'))).toBe(false);
      expect(fs.readdirSync(parent).filter((name) => name.startsWith('AgentMapleVillage-backup-'))).toHaveLength(0);
    }
  });

  it('rejects unreadable SectorConfig JSON before any write', () => {
    const { parent, workspace, mapBytes } = basicWorkspace();
    fs.writeFileSync(path.join(workspace, 'Global/SectorConfig.config'), '{ entries: [\n');
    const result = runDeploy(workspace);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('SectorConfig.config is not JSON');
    expect(fs.readFileSync(path.join(workspace, 'map/map01.map'), 'utf8')).toBe(mapBytes);
    expect(fs.existsSync(path.join(workspace, 'ui/AgentMapleDesk.ui'))).toBe(false);
    expect(fs.readdirSync(parent).filter((name) => name.startsWith('AgentMapleVillage-backup-'))).toHaveLength(0);
  });

  it('appends a map id only when entries is already a string array', () => {
    const { workspace, mapBytes } = basicWorkspace();
    fs.writeFileSync(path.join(workspace, 'Global/SectorConfig.config'), `${JSON.stringify({ entries: ['map://map01'] })}\n`);
    const result = runDeploy(workspace);
    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(workspace, 'map/map01.map'), 'utf8')).toBe(mapBytes);
    const sector = JSON.parse(fs.readFileSync(path.join(workspace, 'Global/SectorConfig.config'), 'utf8')) as { entries: string[] };
    expect(sector.entries).toEqual(['map://map01', 'map://AgentMapleVillage']);
    expect(fs.existsSync(path.join(workspace, 'map/AgentMapleVillage.map'))).toBe(true);
    expect(fs.readFileSync(path.join(workspace, 'RootDesk/MyDesk/AgentMapleVillage/VillageRelay.mlua'), 'utf8')).toContain('/maps/AgentMapleVillage/Foreman');
  });

  it('does not write when WorldConfig or map01 is not a supported Basic seed', () => {
    const missingWorld = basicWorkspace();
    fs.rmSync(path.join(missingWorld.workspace, 'Global/WorldConfig.config'));
    const noWorld = runDeploy(missingWorld.workspace);
    expect(noWorld.status).toBe(2);
    expect(noWorld.stderr).toContain('MISSING SEED: Global/WorldConfig.config');
    expect(fs.existsSync(path.join(missingWorld.workspace, 'ui/AgentMapleDesk.ui'))).toBe(false);
    expect(fs.readdirSync(missingWorld.parent).filter((name) => name.startsWith('AgentMapleVillage-backup-'))).toHaveLength(0);

    const disabled = basicWorkspace();
    fs.writeFileSync(path.join(disabled.workspace, 'Global/WorldConfig.config'), `${JSON.stringify({
      ContentProto: { Json: { UseExtendedScriptFormat: false, SourceLanguage: 'ko' } },
    })}\n`);
    expect(runDeploy(disabled.workspace).status).toBe(2);
    expect(fs.readFileSync(path.join(disabled.workspace, 'map/map01.map'), 'utf8')).toBe(disabled.mapBytes);
    expect(fs.existsSync(path.join(disabled.workspace, 'ui/AgentMapleDesk.ui'))).toBe(false);

    const missingMap = basicWorkspace();
    fs.rmSync(path.join(missingMap.workspace, 'map/map01.map'));
    const noMap = runDeploy(missingMap.workspace);
    expect(noMap.status).toBe(2);
    expect(noMap.stderr).toContain('MISSING SEED: map/map01.map');
    expect(fs.existsSync(path.join(missingMap.workspace, 'ui/AgentMapleDesk.ui'))).toBe(false);
    expect(fs.readdirSync(missingMap.parent).filter((name) => name.startsWith('AgentMapleVillage-backup-'))).toHaveLength(0);
  });

  it('refuses a drive-letter ESM specifier before any deploy import', () => {
    const windowsPath = 'C:\\tools\\deploy-msw-overlay.mjs';
    expect(new URL(windowsPath).protocol).toBe('c:');
    const refused = spawnSync(process.execPath, ['--input-type=module', '-e', `import ${JSON.stringify(windowsPath)};`], { encoding: 'utf8' });
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain('ERR_UNSUPPORTED_ESM_URL_SCHEME');
    expect(refused.stderr).toContain("protocol 'c:'");
    const specifier = pathToFileURL(deploy).href;
    expect(new URL(specifier).protocol).toBe('file:');
    const accepted = spawnSync(process.execPath, ['--input-type=module', '-e', `import ${JSON.stringify(specifier)};`], { encoding: 'utf8' });
    expect(accepted.status).toBe(0);
    expect(accepted.stderr).not.toContain('ERR_UNSUPPORTED_ESM_URL_SCHEME');
  });

  it('adds missing script properties without replacing a user map edit', () => {
    const { workspace } = basicWorkspace();
    const mapPath = path.join(workspace, 'map/map01.map');
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as {
      ContentProto: { Entities: Array<Record<string, unknown>> };
    };
    map.ContentProto.Entities.push({
      id: '22222222-2222-4222-8222-222222222222',
      path: '/maps/map01/UserTree',
      componentNames: 'MOD.Core.TransformComponent',
      jsonString: { name: 'UserTree', path: '/maps/map01/UserTree', '@components': [{ '@type': 'MOD.Core.TransformComponent', Position: { x: 3, y: 1, z: 0 } }] },
    });
    map.ContentProto.Entities.push({
      id: '33333333-3333-4333-8333-333333333333',
      path: '/maps/map01/VillageRelay',
      componentNames: 'script.VillageRelay',
      jsonString: {
        name: 'VillageRelay',
        path: '/maps/map01/VillageRelay',
        '@components': [{ '@type': 'script.VillageRelay', Enable: true, RelayBase: 'https://user.example/v1' }],
      },
    });
    fs.writeFileSync(mapPath, `${JSON.stringify(map)}\n`);
    expect(runDeploy(workspace).status).toBe(0);
    const written = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as {
      ContentProto: { Entities: Array<{ path?: string; jsonString?: { '@components'?: Array<Record<string, unknown>> } }> };
    };
    expect(written.ContentProto.Entities.some((entity) => entity.path === '/maps/map01/UserTree')).toBe(true);
    const relay = written.ContentProto.Entities.find((entity) => entity.path === '/maps/map01/VillageRelay');
    const script = relay?.jsonString?.['@components']?.find((component) => component['@type'] === 'script.VillageRelay');
    expect(script?.RelayBase).toBe('https://user.example/v1');
    expect(script?.WorldToken).toBe('');
    expect(script?.ClockOffset).toBeNull();
    expect(script?.CommandCounter).toBe(0);
  });

  it('rolls back a mid-write failure and leaves no partial village files', () => {
    const { parent, workspace, mapBytes } = basicWorkspace();
    const backup = path.join(parent, 'explicit-backup');
    const specifier = pathToFileURL(deploy).href;
    expect(new URL(specifier).protocol).toBe('file:');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { deployWorkspace } from ${JSON.stringify(specifier)};
      const outcome = deployWorkspace(process.env.WS, { failAfter: 2, backup: process.env.BAK });
      process.exit(outcome.code);
    `], { encoding: 'utf8', env: { ...process.env, WS: workspace, BAK: backup } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('injected write failure');
    expect(fs.readFileSync(path.join(workspace, 'map/map01.map'), 'utf8')).toBe(mapBytes);
    expect(fs.existsSync(path.join(workspace, 'RootDesk/MyDesk/AgentMapleVillage'))).toBe(false);
    expect(fs.existsSync(path.join(workspace, 'ui/AgentMapleDesk.ui'))).toBe(false);
    expect(fs.existsSync(path.join(workspace, 'Global/SectorConfig.config'))).toBe(false);
    expect(backup.startsWith(`${workspace}${path.sep}`)).toBe(false);
    expect(fs.readFileSync(path.join(backup, 'map/map01.map'), 'utf8')).toBe(mapBytes);
    expect(fs.readdirSync(workspace, { recursive: true }).some((name) => String(name).endsWith('.amv-tmp'))).toBe(false);
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
    expect(script).toContain('/ui/AgentMapleDesk/Board/GoalInput');
    expect(script).toContain('ConnectEvent(ButtonClickEvent');
    expect(fs.readdirSync(overlay, { recursive: true }).some((name) => String(name).endsWith('.codeblock'))).toBe(false);
  });

  it('keeps closed panels and non-overlapping controls in the generated UI files', () => {
    for (const name of ['AgentMapleDesk', 'AgentMapleLibrary']) {
      const ui = readJson(`ui/${name}.ui`) as {
        ContentProto?: { Entities?: Array<{ jsonString?: { path?: string; enable?: boolean; name?: string; '@components'?: Array<Record<string, unknown>> } }> };
      };
      const items = (ui.ContentProto?.Entities ?? []).map((entity) => {
        const body = entity.jsonString ?? {};
        const transform = (body['@components'] ?? []).find((component) => component['@type'] === 'MOD.Core.UITransformComponent') as {
          OffsetMin?: { x: number; y: number };
          OffsetMax?: { x: number; y: number };
        } | undefined;
        return { path: body.path ?? '', enable: body.enable, min: transform?.OffsetMin, max: transform?.OffsetMax };
      });
      const board = items.find((item) => item.path === `/ui/${name}/Board`);
      const opener = items.find((item) => item.path === `/ui/${name}/OpenButton`);
      expect(board?.enable).toBe(false);
      expect(opener?.enable).toBe(true);
      const byParent = new Map<string, typeof items>();
      for (const item of items) {
        const parent = item.path.split('/').slice(0, -1).join('/');
        const list = byParent.get(parent) ?? [];
        list.push(item);
        byParent.set(parent, list);
      }
      for (const kids of byParent.values()) {
        for (let left = 0; left < kids.length; left += 1) {
          for (let right = left + 1; right < kids.length; right += 1) {
            const a = kids[left];
            const b = kids[right];
            if (!a.min || !a.max || !b.min || !b.max) continue;
            const overlapX = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
            const overlapY = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
            expect(overlapX > 1 && overlapY > 1, `${a.path} overlaps ${b.path}`).toBe(false);
          }
        }
      }
    }
    const desk = fs.readFileSync(path.join(overlay, 'ui/AgentMapleDesk.ui'), 'utf8');
    expect(desk).toContain('공개 릴레이가 없습니다.');
    expect(desk).not.toContain('마을 연결 전');
  });

  it('binds each command button UUID into the script instead of a path EventSender', () => {
    const ui = readJson('ui/AgentMapleDesk.ui') as { ContentProto?: { Entities?: Array<{ id?: string; path?: string }> } };
    const open = ui.ContentProto?.Entities?.find((entity) => entity.path === '/ui/AgentMapleDesk/OpenButton');
    const script = fs.readFileSync(path.join(overlay, 'RootDesk/MyDesk/AgentMapleVillage/GoalDesk.mlua'), 'utf8');
    expect(open?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(script).toContain(`property ButtonComponent OpenButton = "${open?.id}"`);
    expect(script).toContain('ConnectEvent(ButtonClickEvent');
    expect(script).not.toContain('@EventSender("Entity"');
    expect(script).not.toContain('00000000-0000-4000-8000-000000000001');
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
