/**
 * Place the village into a Creator LocalWorkspace.
 *
 * Official map notes (MSW-Git/msw-ai-coding-plugins-official 96133b2991d71b66bbe1e2494d28e4cc4bf57f82):
 * a new map id may need `map://{id}` in Global/SectorConfig.config entries when that
 * map must be reachable. Creator Basic exports use map/map01.map and do not ship
 * SectorConfig. This script never creates that file and never guesses its schema.
 * Every check below finishes before the backup directory or any workspace write.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAP_ID = 'map://AgentMapleVillage';
const OVERLAY_ROOT = '/maps/AgentMapleVillage';
const VILLAGE_ENTITIES = ['Desk1', 'Desk2', 'Desk3', 'Desk4', 'Desk5', 'Desk6', 'Foreman', 'Worker', 'VillageRelay', 'Guide', 'NoticeBoard', 'BookWork', 'BookSource', 'HomeForeman', 'HomeWorker', 'MeetingRoom', 'ShelfLeft', 'ShelfRight'];
const PLACEMENTS = {
  Desk1: { x: -5 },
  Desk2: { x: -3 },
  Desk3: { x: -1 },
  Desk4: { x: 1 },
  Desk5: { x: 3 },
  Desk6: { x: 5 },
  Foreman: { x: -6.5, homeX: -6.5, deskX: -5, meetingX: -1, approachOffset: -1.2 },
  Worker: { x: 6.5, homeX: 6.5, deskX: -3, meetingX: 1, approachOffset: 1.2 },
  Guide: { x: 4 },
  NoticeBoard: { x: 2.2 },
  BookWork: { x: 4.8 },
  BookSource: { x: 5.6 },
  HomeForeman: { x: -6.5 },
  HomeWorker: { x: 6.5 },
  MeetingRoom: { x: 0 },
  ShelfLeft: { x: 3.4 },
  ShelfRight: { x: 6.2 },
};
const FLOOR_STRIPS = JSON.parse(fs.readFileSync(new URL('../msw/floors/official-strips.json', import.meta.url), 'utf8'));
const SCRIPT_FILES = ['VillageRelay.mlua', 'OfficeNpc.mlua', 'GoalDesk.mlua', 'LibraryHall.mlua', 'OfficeStatus.mlua', 'BookSpot.mlua', 'NoticeBoard.mlua', 'GuidePost.mlua'];
const UI_FILES = ['AgentMapleDesk.ui', 'AgentMapleLibrary.ui'];
const BODY_BY_MODE = {
  0: 'MOD.Core.RigidbodyComponent',
  1: 'MOD.Core.KinematicbodyComponent',
  2: 'MOD.Core.SideviewbodyComponent',
};
const BODY_TYPES = new Set(Object.values(BODY_BY_MODE));
const SCRIPT_PROPERTY_DEFAULTS = {
  'script.VillageRelay': {
    ClockOffset: null,
    OpenDecisionId: '',
    Busy: false,
    Cursor: 0,
    CommandCounter: 0,
  },
};

export function deployWorkspace(workspace, options = {}) {
  const root = path.resolve(workspace);
  const overlay = options.overlay ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../msw/workspace-overlay');
  const plan = planDeployment(root, overlay);
  if (!plan.ok) {
    for (const error of plan.errors) console.error(error);
    return { ok: false, code: 2, errors: plan.errors, written: [] };
  }
  const backup = options.backup ?? path.join(path.dirname(root), `AgentMapleVillage-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
  const touched = [];
  try {
    fs.mkdirSync(backup, { recursive: true });
    for (const change of plan.changes) {
      const dest = path.join(root, change.rel);
      const had = fs.existsSync(dest);
      if (had) {
        const bak = path.join(backup, change.rel);
        fs.mkdirSync(path.dirname(bak), { recursive: true });
        fs.copyFileSync(dest, bak);
      }
      touched.push({ rel: change.rel, had });
      writeAtomically(dest, change.body);
      if (options.failAfter && touched.length >= options.failAfter) {
        throw new Error('injected write failure');
      }
      console.log(`wrote ${change.rel}`);
    }
  } catch (error) {
    restore(root, backup, touched);
    const message = error instanceof Error ? error.message : 'deploy failed';
    console.error(message);
    return { ok: false, code: 1, errors: [message], written: [], backup };
  }
  console.log(`backup ${backup}`);
  console.log(plan.note);
  console.log('Maker must be out of play mode. Then refresh. This script did not refresh or play.');
  return { ok: true, code: 0, errors: [], written: touched.map((item) => item.rel), backup, note: plan.note };
}

export function planDeployment(root, overlay) {
  const errors = [];
  for (const required of ['Global', 'map', 'ui', 'RootDesk']) {
    if (!fs.existsSync(path.join(root, required))) errors.push(`Not a LocalWorkspace (missing ${required}): ${root}`);
  }
  const overlayFiles = [
    'map/AgentMapleVillage.map',
    ...UI_FILES.map((name) => path.join('ui', name)),
    ...SCRIPT_FILES.map((name) => path.join('RootDesk/MyDesk/AgentMapleVillage', name)),
  ];
  for (const rel of overlayFiles) {
    if (!fs.existsSync(path.join(overlay, rel))) errors.push(`Overlay is missing ${rel}`);
  }
  if (errors.length) return { ok: false, errors, changes: [], note: '' };

  const worldConfigPath = path.join(root, 'Global/WorldConfig.config');
  if (!fs.existsSync(worldConfigPath)) {
    errors.push('MISSING SEED: Global/WorldConfig.config. Enable UseExtendedScriptFormat in Maker. Nothing was written.');
  } else if (!extendedScriptFormatEnabled(fs.readFileSync(worldConfigPath, 'utf8'))) {
    errors.push('UseExtendedScriptFormat is not true under ContentProto.Json or the file root. Nothing was written.');
  }

  const sectorPath = path.join(root, 'Global/SectorConfig.config');
  let sectorConfig = null;
  if (fs.existsSync(sectorPath)) {
    const text = fs.readFileSync(sectorPath, 'utf8');
    const parsed = parseSector(text);
    if (!parsed.ok) errors.push(parsed.error);
    else sectorConfig = parsed.config;
  }

  const mapPath = path.join(root, 'map/map01.map');
  let mapJson = null;
  let mapInfo = null;
  if (!sectorConfig) {
    if (!fs.existsSync(mapPath)) {
      errors.push('MISSING SEED: map/map01.map. A Creator Basic export uses this file as its map. Nothing was written.');
    } else {
      try {
        mapJson = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
        mapInfo = inspectMap(mapJson);
      } catch {
        mapJson = null;
        mapInfo = null;
      }
      if (!mapInfo || mapInfo.contentType !== 'x-mod/map') {
        errors.push('map/map01.map is not an x-mod/map file. Nothing was written.');
      } else if (mapInfo.condensed) {
        errors.push('map/map01.map is a condensed version2 map. MapBuilder cannot edit that form, so nothing was written.');
      } else if (!mapInfo.rootName || !Object.prototype.hasOwnProperty.call(BODY_BY_MODE, mapInfo.mode)) {
        errors.push('map/map01.map has no MapComponent.TileMapMode 0, 1, or 2. Nothing was written.');
      }
    }
  }
  if (errors.length) return { ok: false, errors, changes: [], note: '' };

  const changes = [];
  if (!sectorConfig) {
    const targetRoot = `/maps/${mapInfo.rootName}`;
    const merged = mergeVillageOntoMap(mapJson, overlay, targetRoot, mapInfo.mode);
    changes.push({ rel: 'map/map01.map', body: `${JSON.stringify(merged, null, 2)}\n` });
    for (const [file, id, label] of ROOM_MAPS) {
      changes.push(roomChange(root, file, id, label));
    }
    for (const name of SCRIPT_FILES) {
      const source = fs.readFileSync(path.join(overlay, 'RootDesk/MyDesk/AgentMapleVillage', name), 'utf8');
      changes.push({
        rel: path.join('RootDesk/MyDesk/AgentMapleVillage', name),
        body: source.replaceAll(`${OVERLAY_ROOT}/`, `${targetRoot}/`),
      });
    }
    for (const name of UI_FILES) {
      changes.push({ rel: path.join('ui', name), body: fs.readFileSync(path.join(overlay, 'ui', name), 'utf8') });
    }
    return {
      ok: true,
      errors: [],
      changes,
      note: `SectorConfig.config is absent. The official map builder says that file may be needed only when a new map id must be reachable. Village entities were placed on ${mapInfo.rootName}. No SectorConfig file was created.`,
    };
  }

  for (const name of SCRIPT_FILES) {
    changes.push({
      rel: path.join('RootDesk/MyDesk/AgentMapleVillage', name),
      body: fs.readFileSync(path.join(overlay, 'RootDesk/MyDesk/AgentMapleVillage', name), 'utf8'),
    });
  }
  for (const name of UI_FILES) {
    changes.push({ rel: path.join('ui', name), body: fs.readFileSync(path.join(overlay, 'ui', name), 'utf8') });
  }
  changes.push({ rel: 'map/AgentMapleVillage.map', body: fs.readFileSync(path.join(overlay, 'map/AgentMapleVillage.map'), 'utf8') });
  if (!sectorConfig.entries.includes(MAP_ID)) {
    const next = { ...sectorConfig, entries: [...sectorConfig.entries, MAP_ID] };
    changes.push({ rel: 'Global/SectorConfig.config', body: `${JSON.stringify(next, null, 2)}\n` });
    return {
      ok: true,
      errors: [],
      changes,
      note: `SectorConfig.entries is a string array, so ${MAP_ID} was appended. map/AgentMapleVillage.map was copied. Creator has not loaded it.`,
    };
  }
  return {
    ok: true,
    errors: [],
    changes,
    note: 'SectorConfig already lists map://AgentMapleVillage. The separate map file was copied. map01 was left unchanged.',
  };
}

export function extendedScriptFormatEnabled(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return false;
  }
  let json = data?.ContentProto?.Json ?? data;
  if (typeof json === 'string') {
    try {
      json = JSON.parse(json);
    } catch {
      return false;
    }
  }
  return json?.UseExtendedScriptFormat === true;
}

export function inspectMap(data) {
  const entities = data?.ContentProto?.Entities ?? [];
  let mode = null;
  let rootName = null;
  let condensed = false;
  for (const entity of entities) {
    const js = entityJson(entity);
    if (js.version2 && (js.entityInfos || js.addedComponents || js.modifications)) condensed = true;
    if (!rootName && typeof js.path === 'string' && /^\/maps\/[^/]+$/.test(js.path)) rootName = js.path.split('/').pop();
    for (const component of js['@components'] ?? []) {
      if (component['@type'] === 'MOD.Core.MapComponent' && Number.isInteger(component.TileMapMode) && component.TileMapMode >= 0 && component.TileMapMode <= 2) {
        mode = component.TileMapMode;
      }
    }
  }
  if (!rootName && typeof data?.EntryKey === 'string' && /^map:\/\/[^/]+$/.test(data.EntryKey)) rootName = data.EntryKey.slice('map://'.length);
  return { mode, rootName, condensed, contentType: data?.ContentType ?? null };
}

function parseSector(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'SectorConfig.config is not JSON this deploy understands. Nothing was written.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'SectorConfig.entries is not a string array. The file was not modified and nothing else was written.' };
  }
  if (!Array.isArray(parsed.entries) || parsed.entries.some((item) => typeof item !== 'string')) {
    return { ok: false, error: 'SectorConfig.entries is not a string array. The file was not modified and nothing else was written.' };
  }
  return { ok: true, config: parsed };
}

function mergeVillageOntoMap(mapJson, overlay, targetRoot, mode) {
  const village = JSON.parse(fs.readFileSync(path.join(overlay, 'map/AgentMapleVillage.map'), 'utf8'));
  const merged = structuredClone(mapJson);
  const entities = merged.ContentProto.Entities;
  const existingPaths = new Set(entities.map((entity) => entityJson(entity).path || entity.path));
  let order = entities.reduce((max, entity) => Math.max(max, Number(entityJson(entity).displayOrder) || 0), 0);
  const body = BODY_BY_MODE[mode];
  const stringify = entities.some((entity) => typeof entity.jsonString === 'string');
  repairMapleMap(merged, mode, stringify);
  const standY = ensureFloor(merged, mode, targetRoot, stringify);
  const footholdY = mode === 0 ? footholdStandY(merged) : null;
  settleSpawn(entities, footholdY ?? standY, targetRoot, stringify);
  for (const source of village.ContentProto.Entities) {
    const sourceJson = entityJson(source);
    const name = sourceJson.name || String(sourceJson.path || source.path || '').split('/').pop();
    if (!VILLAGE_ENTITIES.includes(name)) continue;
    const nextPath = `${targetRoot}/${name}`;
    if (existingPaths.has(nextPath)) {
      const current = entities.find((entity) => (entityJson(entity).path || entity.path) === nextPath);
      if (current) writeEntity(current, placeOnFloor(entityJson(current), standY), stringify);
      continue;
    }
    const nextJs = rewritePaths(structuredClone(sourceJson), OVERLAY_ROOT, targetRoot);
    nextJs.path = nextPath;
    nextJs.displayOrder = ++order;
    nextJs.pathConstraints = '/'.repeat((nextPath.match(/\//g) || []).length);
    nextJs['@components'] = (nextJs['@components'] ?? []).map((component) => {
      if (!BODY_TYPES.has(component['@type']) || component['@type'] === body) return component;
      return { ...component, '@type': body };
    });
    placeOnFloor(nextJs, standY);
    const id = crypto.randomUUID();
    if (nextJs.origin && typeof nextJs.origin === 'object') nextJs.origin.root_entity_id = id;
    entities.push({
      id,
      path: nextPath,
      componentNames: (nextJs['@components'] ?? []).map((component) => component['@type']).filter(Boolean).join(','),
      jsonString: stringify ? JSON.stringify(nextJs) : nextJs,
    });
    existingPaths.add(nextPath);
  }
  addPortals(entities, targetRoot, footholdY ?? standY, stringify);
  repairPortals(entities);
  fillMissingScriptProperties(entities);
  ensureNpcTouch(entities);
  return merged;
}

const ROOM_MAPS = [
  ['AgentMapleOffice.map', 'AgentMapleOffice', '지휘석'],
  ['AgentMapleLibrary.map', 'AgentMapleLibrary', '도서관'],
  ['AgentMapleMeeting.map', 'AgentMapleMeeting', '회의실'],
  ['AgentMapleNotice.map', 'AgentMapleNotice', '게시판'],
];

function addPortals(entities, targetRoot, standY, stringify) {
  const spots = [
    ['PortalOffice', -4, '지휘석'],
    ['PortalLibrary', -2, '도서관'],
    ['PortalMeeting', 2, '회의실'],
    ['PortalNotice', 4, '게시판'],
  ];
  const paths = new Set(entities.map((entity) => entityJson(entity).path || entity.path));
  for (const [name, x, label] of spots) {
    const entityPath = `${targetRoot}/${name}`;
    if (paths.has(entityPath)) continue;
    const entity = portalEntity(targetRoot, name, x, standY, label);
    if (stringify) writeEntity(entity, entityJson(entity), true);
    entities.push(entity);
  }
}

function roomChange(root, file, id, label) {
  const rel = path.join('map', file);
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return { rel, body: roomMap(id, label) };
  try {
    const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
    repairPortals(parsed.ContentProto?.Entities ?? []);
    return { rel, body: `${JSON.stringify(parsed, null, 2)}\n` };
  } catch {
    return { rel, body: roomMap(id, label) };
  }
}

function repairPortals(entities) {
  for (const entity of entities) {
    const asString = typeof entity.jsonString === 'string';
    const js = entityJson(entity);
    let changed = false;
    for (const component of js['@components'] ?? []) {
      if (component['@type'] !== 'MOD.Core.PortalComponent') continue;
      if (component.IsLegacy !== false) {
        component.IsLegacy = false;
        changed = true;
      }
    }
    if (changed) writeEntity(entity, js, asString);
  }
}

function portalEntity(root, name, x, y, label) {
  const id = crypto.randomUUID();
  const entityPath = `${root}/${name}`;
  return {
    id,
    path: entityPath,
    componentNames: 'MOD.Core.TransformComponent,MOD.Core.SpriteRendererComponent,MOD.Core.PortalComponent,MOD.Core.NameTagComponent',
    jsonString: {
      name,
      path: entityPath,
      enable: true,
      visible: true,
      '@components': [
        { '@type': 'MOD.Core.TransformComponent', Position: { x, y, z: 0 }, Enable: true },
        { '@type': 'MOD.Core.SpriteRendererComponent', SpriteRUID: VERIFIED_SPRITE_RUID, Enable: true, SortingLayer: 'Default' },
        { '@type': 'MOD.Core.PortalComponent', Enable: true, IsLegacy: false },
        { '@type': 'MOD.Core.NameTagComponent', Enable: true, Name: label },
      ],
    },
  };
}

function roomMap(id, label) {
  const strip = FLOOR_STRIPS.modes['0'];
  const tiles = strip.tiles.filter((tile) => tile.position.x >= -6 && tile.position.x <= 6 && tile.position.y >= -2);
  const footholds = (strip.footholds || []).filter((item) => item.StartPoint.x >= -8 && item.EndPoint.x <= 8).slice(0, 6);
  const rootId = crypto.randomUUID();
  const tileId = crypto.randomUUID();
  const entities = [
    {
      id: rootId,
      path: `/maps/${id}`,
      componentNames: 'MOD.Core.MapComponent,MOD.Core.FootholdComponent',
      jsonString: {
        name: id,
        path: `/maps/${id}`,
        enable: true,
        '@components': [
          {
            '@type': 'MOD.Core.MapComponent',
            IsInstanceMap: false,
            TileMapMode: 0,
            Enable: true,
            Gravity: 1,
            WalkAccelerationFactor: 1,
            WalkDrag: 1,
            AirAccelerationXFactor: 1,
            AirDecelerationXFactor: 1,
            FallSpeedMaxXFactor: 1,
            FallSpeedMaxYFactor: 1,
          },
          { '@type': 'MOD.Core.FootholdComponent', Enable: true, FootholdsByLayer: { 1: footholds.map((item) => ({ ...item, OwnerId: tileId })) } },
        ],
      },
    },
    {
      id: tileId,
      path: `/maps/${id}/TileMap`,
      componentNames: 'MOD.Core.TransformComponent,MOD.Core.TileMapComponent',
      jsonString: {
        name: 'TileMap',
        path: `/maps/${id}/TileMap`,
        enable: true,
        '@components': [
          { '@type': 'MOD.Core.TransformComponent', Position: { x: 0, y: 0, z: 1000 }, Enable: true },
          { '@type': 'MOD.Core.TileMapComponent', Enable: true, SortingLayer: 'MapLayer0', TileSetRUID: structuredClone(strip.tileSetRuid), Tiles: tiles },
        ],
      },
    },
    spawnEntity(`/maps/${id}`, footholds[0]?.StartPoint?.y ?? 0),
    portalEntity(`/maps/${id}`, 'PortalSquare', -3, footholds[0]?.StartPoint?.y ?? 0, '광장'),
  ];
  if (id === 'AgentMapleOffice' || id === 'AgentMapleMeeting') {
    const station = id === 'AgentMapleOffice' ? 'desk' : 'meeting';
    entities.push(actorEntity(`/maps/${id}`, 'Foreman', -1, footholds[0]?.StartPoint?.y ?? 0, 'ses_foreman', station));
    entities.push(actorEntity(`/maps/${id}`, 'Worker', 1, footholds[0]?.StartPoint?.y ?? 0, 'ses_worker', station));
  }
  if (id === 'AgentMapleLibrary') entities.push(actorEntity(`/maps/${id}`, 'Guide', 0, footholds[0]?.StartPoint?.y ?? 0, '', 'library'));
  return `${JSON.stringify({ ContentType: 'x-mod/map', EntryKey: `map://${id}`, ContentProto: { Entities: entities } }, null, 2)}\n`;
}

function actorEntity(root, name, x, y, sessionId, station) {
  const id = crypto.randomUUID();
  const entityPath = `${root}/${name}`;
  const js = {
    name,
    path: entityPath,
    enable: true,
    '@components': [
      { '@type': 'MOD.Core.TransformComponent', Position: { x, y, z: 0 }, Enable: true },
      { '@type': 'MOD.Core.SpriteRendererComponent', SpriteRUID: VERIFIED_SPRITE_RUID, Enable: false, SortingLayer: 'Default' },
      { '@type': 'MOD.Core.NameTagComponent', Enable: true, Name: name === 'Guide' ? '안내' : name === 'Foreman' ? '감독관' : '작업자' },
      { '@type': 'MOD.Core.MovementComponent', Enable: true },
      { '@type': 'MOD.Core.RigidbodyComponent', Enable: true },
      name === 'Guide'
        ? { '@type': 'script.GuidePost', Enable: true }
        : { '@type': 'script.OfficeNpc', Enable: true, SessionId: sessionId || 'ses_foreman', Station: station, Pace: false, Holding: false, HomeX: x, DeskX: x, MeetingX: x, FloorY: y, DeskY: y, DeskSaved: true },
    ],
  };
  useDefaultAvatar(js);
  return { id, path: entityPath, componentNames: js['@components'].map((component) => component['@type']).join(','), jsonString: js };
}

function ensureFloor(mapJson, mode, targetRoot, stringify) {
  const strip = FLOOR_STRIPS.modes[String(mode)];
  if (!strip) return 0;
  const entities = mapJson.ContentProto.Entities;
  let tileEntity = entities.find((entity) => entityJson(entity)['@components']?.some((component) => component['@type'] === strip.component));
  if (!tileEntity) {
    tileEntity = blankTileEntity(targetRoot, strip);
    entities.push(tileEntity);
  }
  const asString = typeof tileEntity.jsonString === 'string';
  const js = entityJson(tileEntity);
  const component = (js['@components'] ?? []).find((item) => item['@type'] === strip.component);
  if (!component) return strip.standY;
  const field = strip.tileField;
  const tiles = Array.isArray(component[field]) ? component[field] : [];
  let tilesetChanged = false;
  if (tilesetMissing(component.TileSetRUID)) {
    component.TileSetRUID = structuredClone(strip.tileSetRuid);
    tilesetChanged = true;
  }
  fillAbsentMapleMovement(mapJson, mode, stringify || asString);
  const surface = surfaceRow(tiles);
  if (surface) {
    if (tilesetChanged) writeEntity(tileEntity, js, stringify || asString);
    if (mode === 0) {
      const footholdY = footholdStandY(mapJson);
      if (footholdY != null) return footholdY;
    }
    return surface.y + 1;
  }
  const occupied = new Set(tiles.map((tile) => `${tile.position?.x},${tile.position?.y}`));
  for (const tile of strip.tiles) {
    const key = `${tile.position.x},${tile.position.y}`;
    if (occupied.has(key)) continue;
    tiles.push(structuredClone(tile));
  }
  component[field] = tiles;
  if (strip.footholds?.length) {
    const root = entities.find((entity) => /^\/maps\/[^/]+$/.test(entityJson(entity).path || entity.path || ''));
    const rootJs = root ? entityJson(root) : null;
    if (root && rootJs) {
      let foothold = (rootJs['@components'] ?? []).find((item) => item['@type'] === 'MOD.Core.FootholdComponent');
      const layer = foothold?.FootholdsByLayer?.['1'] ?? foothold?.FootholdsByLayer?.[1];
      if (!foothold) {
        foothold = { '@type': 'MOD.Core.FootholdComponent', FootholdsByLayer: {}, Enable: true };
        rootJs['@components'].push(foothold);
      }
      if (!Array.isArray(layer) || layer.length === 0) {
        foothold.FootholdsByLayer = {
          ...(foothold.FootholdsByLayer ?? {}),
          1: strip.footholds.map((item) => ({ ...item, OwnerId: tileEntity.id })),
        };
        writeEntity(root, rootJs, stringify || asString);
      }
    }
  }
  writeEntity(tileEntity, js, stringify || asString);
  fillAbsentMapleMovement(mapJson, mode, stringify || asString);
  if (mode === 0) {
    const footholdY = footholdStandY(mapJson);
    if (footholdY != null) return footholdY;
  }
  return strip.standY;
}

function repairMapleMap(mapJson, mode, stringify) {
  if (mode !== 0) return;
  fillAbsentMapleMovement(mapJson, mode, stringify);
  const strip = FLOOR_STRIPS.modes['0'];
  const tileEntity = (mapJson.ContentProto?.Entities ?? []).find((entity) => entityJson(entity)['@components']?.some((component) => component['@type'] === strip.component));
  if (!tileEntity) return;
  const js = entityJson(tileEntity);
  const component = (js['@components'] ?? []).find((item) => item['@type'] === strip.component);
  if (!component || !tilesetMissing(component.TileSetRUID)) return;
  component.TileSetRUID = structuredClone(strip.tileSetRuid);
  writeEntity(tileEntity, js, stringify || typeof tileEntity.jsonString === 'string');
}

function tilesetMissing(value) {
  if (value == null || value === '') return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'object') return String(value.DataId ?? value.dataId ?? '').trim() === '';
  return false;
}

const MAPLE_MOVEMENT_DEFAULTS = {
  Gravity: 1,
  WalkAccelerationFactor: 1,
  WalkDrag: 1,
  AirAccelerationXFactor: 1,
  AirDecelerationXFactor: 1,
  FallSpeedMaxXFactor: 1,
  FallSpeedMaxYFactor: 1,
};

function fillAbsentMapleMovement(mapJson, mode, stringify) {
  if (mode !== 0) return;
  const root = (mapJson.ContentProto?.Entities ?? []).find((entity) => /^\/maps\/[^/]+$/.test(entityJson(entity).path || entity.path || ''));
  if (!root) return;
  const js = entityJson(root);
  const mapComponent = (js['@components'] ?? []).find((component) => component['@type'] === 'MOD.Core.MapComponent');
  if (!mapComponent) return;
  let changed = false;
  for (const [key, value] of Object.entries(MAPLE_MOVEMENT_DEFAULTS)) {
    if (!Object.prototype.hasOwnProperty.call(mapComponent, key)) {
      mapComponent[key] = value;
      changed = true;
    }
  }
  if (changed) writeEntity(root, js, stringify);
}

function footholdStandY(mapJson) {
  const root = (mapJson.ContentProto?.Entities ?? []).find((entity) => /^\/maps\/[^/]+$/.test(entityJson(entity).path || entity.path || ''));
  const foothold = root ? (entityJson(root)['@components'] ?? []).find((component) => component['@type'] === 'MOD.Core.FootholdComponent') : null;
  const layer = foothold?.FootholdsByLayer?.['1'] ?? foothold?.FootholdsByLayer?.[1];
  if (!Array.isArray(layer) || layer.length === 0) return null;
  let y = null;
  for (const item of layer) {
    for (const point of [item?.StartPoint, item?.EndPoint]) {
      if (typeof point?.y !== 'number') continue;
      y = y == null ? point.y : Math.max(y, point.y);
    }
  }
  return y;
}

function surfaceRow(tiles) {
  const rows = new Map();
  for (const tile of tiles) {
    const x = tile?.position?.x;
    const y = tile?.position?.y;
    if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
    const row = rows.get(y) ?? new Set();
    row.add(x);
    rows.set(y, row);
  }
  let best = null;
  for (const [y, xs] of rows) {
    if (xs.size < 8) continue;
    if (!best || y > best.y) best = { y, count: xs.size };
  }
  return best;
}

function blankTileEntity(targetRoot, strip) {
  const name = strip.component === 'MOD.Core.TileMapComponent' ? 'TileMap' : 'RectTileMap';
  const id = crypto.randomUUID();
  return {
    id,
    path: `${targetRoot}/${name}`,
    componentNames: `MOD.Core.TransformComponent,${strip.component}`,
    jsonString: {
      name,
      path: `${targetRoot}/${name}`,
      nameEditable: false,
      enable: true,
      visible: true,
      localize: false,
      displayOrder: 3,
      pathConstraints: '///',
      revision: 1,
      origin: { type: 'Model', entry_id: name === 'TileMap' ? 'tilemap' : 'recttilemap', sub_entity_id: null, root_entity_id: id, replaced_model_id: null },
      modelId: name === 'TileMap' ? 'tilemap' : 'recttilemap',
      '@components': [
        {
          '@type': 'MOD.Core.TransformComponent',
          Rotation: { x: 0, y: 0, z: 0 },
          Position: { x: 0, y: 0, z: 1000 },
          QuaternionRotation: { x: 0, y: 0, z: 0, w: 1 },
          ZRotation: 0,
          Enable: true,
        },
        {
          '@type': strip.component,
          SortingLayer: strip.sortingLayer,
          TileSetRUID: strip.tileSetRuid,
          Enable: true,
          [strip.tileField]: [],
        },
      ],
    },
  };
}

function settleSpawn(entities, standY, targetRoot, stringify) {
  const existing = entities.find((entity) => {
    const js = entityJson(entity);
    const name = js.name || String(js.path || entity.path || '').split('/').pop();
    return name === 'SpawnLocation';
  });
  if (!existing) {
    entities.push(spawnEntity(targetRoot, standY));
    const created = entities[entities.length - 1];
    if (stringify) writeEntity(created, entityJson(created), true);
    return;
  }
  const js = entityJson(existing);
  const transform = (js['@components'] ?? []).find((component) => component['@type'] === 'MOD.Core.TransformComponent');
  if (!transform?.Position) return;
  // The avatar starts at this entity. A gap under 1.5 still leaves it off the tile row.
  if (Number(transform.Position.y) === standY) return;
  transform.Position.y = standY;
  writeEntity(existing, js, stringify);
}

function spawnEntity(targetRoot, standY) {
  const id = crypto.randomUUID();
  const entityPath = `${targetRoot}/SpawnLocation`;
  return {
    id,
    path: entityPath,
    componentNames: 'MOD.Core.TransformComponent,MOD.Core.SpriteRendererComponent,MOD.Core.SpawnLocationComponent',
    jsonString: {
      name: 'SpawnLocation',
      path: entityPath,
      nameEditable: true,
      enable: true,
      visible: true,
      localize: false,
      displayOrder: 2,
      pathConstraints: '///',
      revision: 0,
      modelId: null,
      '@components': [
        {
          '@type': 'MOD.Core.TransformComponent',
          Rotation: { x: 0, y: 0, z: 0 },
          Position: { x: 0, y: standY, z: 999.999 },
          QuaternionRotation: { x: 0, y: 0, z: 0, w: 1 },
          Scale: { x: 1, y: 1, z: 1 },
          ZRotation: 0,
          Enable: true,
        },
        {
          '@type': 'MOD.Core.SpriteRendererComponent',
          SortingLayer: 'Default',
          SpriteRUID: '8ef238e0d0ca4bb783aca526cff35d11',
          Enable: true,
        },
        { '@type': 'MOD.Core.SpawnLocationComponent', Enable: true },
      ],
    },
  };
}

function placeOnFloor(js, standY) {
  const name = js.name || String(js.path || '').split('/').pop();
  const seat = PLACEMENTS[name];
  if (!seat) return js;
  const transform = (js['@components'] ?? []).find((component) => component['@type'] === 'MOD.Core.TransformComponent');
  if (transform?.Position) {
    transform.Position.x = seat.x;
    transform.Position.y = standY;
  }
  const npc = (js['@components'] ?? []).find((component) => component['@type'] === 'script.OfficeNpc');
  if (npc && seat.homeX !== undefined) {
    npc.HomeX = seat.homeX;
    npc.DeskX = seat.deskX;
    npc.MeetingX = seat.meetingX;
    npc.ApproachOffset = seat.approachOffset;
    npc.FloorY = standY;
    npc.DeskY = standY;
    npc.DeskSaved = true;
    if (!Object.prototype.hasOwnProperty.call(npc, 'Station')) npc.Station = 'home';
    npc.Pace = false;
    npc.Holding = false;
    if (!Object.prototype.hasOwnProperty.call(npc, 'ActivityText')) npc.ActivityText = '집에서 쉬는 중';
    npc.CaptureOwnerOnNextEnter = true;
  }
  if (name === 'Foreman' || name === 'Worker' || name === 'Guide') useDefaultAvatar(js);
  return js;
}

const VERIFIED_SPRITE_RUID = '8ef238e0d0ca4bb783aca526cff35d11';

function useDefaultAvatar(js) {
  const sprite = (js['@components'] ?? []).find((component) => component['@type'] === 'MOD.Core.SpriteRendererComponent');
  if (sprite) sprite.Enable = false;
  const present = new Set((js['@components'] ?? []).map((component) => component['@type']));
  const add = [];
  if (!present.has('MOD.Core.AvatarRendererComponent')) {
    add.push({ '@type': 'MOD.Core.AvatarRendererComponent', Enable: true, OrderInLayer: 2, SortingLayer: 'Default' });
  }
  if (!present.has('MOD.Core.CostumeManagerComponent')) add.push({ '@type': 'MOD.Core.CostumeManagerComponent', Enable: true });
  if (!present.has('MOD.Core.AvatarStateAnimationComponent')) add.push({ '@type': 'MOD.Core.AvatarStateAnimationComponent', Enable: true });
  js['@components'] = [...(js['@components'] ?? []), ...add];
}

function writeEntity(entity, js, stringify) {
  entity.path = js.path || entity.path;
  entity.componentNames = (js['@components'] ?? []).map((component) => component['@type']).filter(Boolean).join(',');
  entity.jsonString = stringify ? JSON.stringify(js) : js;
}

function ensureNpcTouch(entities) {
  for (const entity of entities) {
    const asString = typeof entity.jsonString === 'string';
    const js = entityJson(entity);
    const name = js.name || String(js.path || '').split('/').pop();
    if (name !== 'Foreman' && name !== 'Worker') continue;
    const components = js['@components'] ?? [];
    let changed = false;
    if (!components.some((component) => component['@type'] === 'MOD.Core.TouchReceiveComponent')) {
      components.push({ '@type': 'MOD.Core.TouchReceiveComponent', Enable: true });
      changed = true;
    }
    if (!components.some((component) => component['@type'] === 'script.OfficeStatus')) {
      components.push({
        '@type': 'script.OfficeStatus',
        Enable: true,
        StatusLine: '릴레이에 붙어 있지 않습니다. 진행 중으로 표시하지 않습니다.',
      });
      changed = true;
    }
    if (!changed) continue;
    js['@components'] = components;
    entity.componentNames = components.map((component) => component['@type']).filter(Boolean).join(',');
    entity.jsonString = asString ? JSON.stringify(js) : js;
  }
}

function fillMissingScriptProperties(entities) {
  for (const entity of entities) {
    const asString = typeof entity.jsonString === 'string';
    const js = entityJson(entity);
    let changed = false;
    for (const component of js['@components'] ?? []) {
      const defaults = SCRIPT_PROPERTY_DEFAULTS[component['@type']];
      if (!defaults) continue;
      for (const [key, value] of Object.entries(defaults)) {
        if (!Object.prototype.hasOwnProperty.call(component, key)) {
          component[key] = value;
          changed = true;
        }
      }
    }
    if (changed) entity.jsonString = asString ? JSON.stringify(js) : js;
  }
}

function rewritePaths(value, fromRoot, toRoot) {
  if (typeof value === 'string') {
    if (value === fromRoot || value.startsWith(`${fromRoot}/`)) return toRoot + value.slice(fromRoot.length);
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => rewritePaths(item, fromRoot, toRoot));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = rewritePaths(item, fromRoot, toRoot);
    return out;
  }
  return value;
}

function entityJson(entity) {
  if (!entity) return {};
  if (typeof entity.jsonString === 'string') return JSON.parse(entity.jsonString);
  return entity.jsonString ?? {};
}

function writeAtomically(dest, body) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.amv-tmp`;
  fs.writeFileSync(tmp, body);
  try {
    if (fs.existsSync(dest)) fs.rmSync(dest);
    fs.renameSync(tmp, dest);
  } finally {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
  }
}

function restore(root, backup, touched) {
  for (const item of [...touched].reverse()) {
    const dest = path.join(root, item.rel);
    const bak = path.join(backup, item.rel);
    if (item.had && fs.existsSync(bak)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(bak, dest);
    } else if (!item.had && fs.existsSync(dest)) {
      fs.rmSync(dest, { force: true });
      removeEmptyParents(path.dirname(dest), root);
    }
  }
}

function removeEmptyParents(start, stop) {
  let current = start;
  while (current !== stop && current.startsWith(`${stop}${path.sep}`)) {
    if (!fs.existsSync(current) || fs.readdirSync(current).length > 0) break;
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

const isDirect = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const workspace = process.argv[2];
  if (!workspace) {
    console.error('Usage: node tools/deploy-msw-overlay.mjs <LocalWorkspace folder>');
    process.exit(1);
  }
  const result = deployWorkspace(workspace);
  process.exit(result.code);
}
