/**
 * Build a LocalWorkspace overlay with the official MSW builders.
 * Requires a checkout of https://github.com/MSW-Git/msw-ai-coding-plugins-official
 * at MSW_SKILL_ROOT (the plugins/msw-maker-base-skill directory).
 * Does not invent RUIDs: sprites use the builder default, and every 32-hex
 * id in the output must already occur in that skill checkout.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const skillRoot = process.env.MSW_SKILL_ROOT;
if (!skillRoot) {
  console.error('Set MSW_SKILL_ROOT to plugins/msw-maker-base-skill');
  process.exit(1);
}
const skillCommit = (process.env.MSW_SKILL_COMMIT || '').trim();
if (!/^[0-9a-f]{40}$/.test(skillCommit)) {
  console.error('Set MSW_SKILL_COMMIT to the full skill checkout SHA');
  process.exit(1);
}

const { MapBuilder } = require(path.join(skillRoot, 'skills/msw-general/scripts/map/msw_map_builder.cjs'));
const { UIBuilder } = require(path.join(skillRoot, 'skills/msw-ui-system/scripts/msw_ui_builder.cjs'));

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = path.join(repoRoot, 'msw/workspace-overlay');
const scriptSrc = path.join(repoRoot, 'msw/scripts');

fs.rmSync(outRoot, { recursive: true, force: true });
const scriptOut = path.join(outRoot, 'RootDesk/MyDesk/AgentMapleVillage');
fs.mkdirSync(scriptOut, { recursive: true });
for (const name of ['VillageRelay.mlua', 'OfficeNpc.mlua', 'GoalDesk.mlua', 'LibraryHall.mlua']) {
  fs.copyFileSync(path.join(scriptSrc, name), path.join(scriptOut, name));
}

const map = MapBuilder.fromTemplate(MapBuilder.templatePath('sideview'), 'AgentMapleVillage');
const floorY = 0.2;
const desks = [-5, -3, -1, 1, 3, 5];
desks.forEach((x, index) => {
  map.sprite(`Desk${index + 1}`, { pos: [x, floorY, 0] });
  map.upsertComponent(`Desk${index + 1}`, 'MOD.Core.NameTagComponent', {
    Enable: true,
    Name: index < 2 ? '' : '빈 자리',
  });
});

function placeNpc(name, x, sessionId, slot) {
  map.sprite(name, { pos: [x, floorY + 0.8, 0] });
  map.upsertComponent(name, 'MOD.Core.NameTagComponent', { Enable: true, Name: name === 'Foreman' ? '감독관' : '작업자' });
  map.upsertComponent(name, 'MOD.Core.ChatBalloonComponent', { Enable: true });
  map.upsertComponent(name, 'MOD.Core.MovementComponent', { Enable: true });
  map.upsertComponent(name, 'MOD.Core.SideviewbodyComponent', { Enable: true });
  map.upsertComponent(name, 'script.OfficeNpc', {
    Enable: true,
    SessionId: sessionId,
    SlotLabel: slot,
    Station: 'desk',
    ActivityText: '대기 중',
    OwnerUserId: '',
    CaptureOwnerOnNextEnter: false,
    DeskX: x,
    DeskY: floorY + 0.8,
    DeskSaved: true,
    LibraryX: 6,
    MoveSpeed: 2.5,
  });
}

placeNpc('Foreman', desks[0], 'ses_foreman', 'S01');
placeNpc('Worker', desks[1], 'ses_worker', 'S02');
map.empty('VillageRelay', { pos: [0, 2, 0], scripts: ['script.VillageRelay'] });
map.upsertComponent('VillageRelay', 'script.VillageRelay', {
  Enable: true,
  RelayBase: 'https://relay.example/v1',
  GoalDeskPath: '/ui/AgentMapleDesk/GoalDesk',
  LibraryHallPath: '/ui/AgentMapleLibrary/LibraryHall',
  ForemanNpcPath: '/maps/AgentMapleVillage/Foreman',
  WorkerNpcPath: '/maps/AgentMapleVillage/Worker',
  ForemanActorId: 'npc-foreman',
  WorkerActorId: 'npc-worker',
  ForemanSessionId: 'ses_foreman',
  WorkerSessionId: 'ses_worker',
});
fs.mkdirSync(path.join(outRoot, 'map'), { recursive: true });
map.write(path.join(outRoot, 'map/AgentMapleVillage.map'));

const button = { rect_size: [220, 88], font_size: 18, color: '#111827', bg_color: { r: 0.9, g: 0.94, b: 1, a: 1 } };
const field = { rect_size: [360, 40], font_size: 18 };

const desk = new UIBuilder('AgentMapleDesk');
desk.panel('Board', { anchor: 'middle-left', pos: [300, -40], rect_size: [420, 980], color: '#1b2430', alpha: 0.92 });
desk.text('Board/Title', '지휘석', { size: 28, anchor: 'top-center', pos: [0, -16], rect_size: [360, 40] });
desk.text('Board/StatusText', '마을 연결 전', { size: 18, anchor: 'top-left', pos: [16, -64], rect_size: [380, 48] });
desk.text('Board/QuestionText', '질문이 오면 여기에 표시됩니다.', { size: 18, anchor: 'top-left', pos: [16, -120], rect_size: [380, 96] });
desk.text('Board/ResultText', '', { size: 18, anchor: 'top-left', pos: [16, -220], rect_size: [380, 48] });
desk.textInput('Board/PairInput', { placeholder: '페어링 코드', anchor: 'top-left', pos: [16, -280], ...field });
desk.button('Board/PairButton', '연결', { anchor: 'top-left', pos: [16, -332], ...button });
desk.textInput('Board/GoalInput', { placeholder: '목표', anchor: 'top-left', pos: [16, -392], ...field });
desk.button('Board/GoalButton', '목표 보내기', { anchor: 'top-left', pos: [16, -444], ...button });
desk.button('Board/AcceptButton', '이대로 진행', { anchor: 'top-left', pos: [16, -508], ...button });
desk.button('Board/DenyButton', '거절', { anchor: 'top-left', pos: [16, -564], ...button });
desk.script('GoalDesk', 'script.GoalDesk', { anchor: 'stretch', pos: [0, 0], rect_size: [1920, 1080] });
fs.mkdirSync(path.join(outRoot, 'ui'), { recursive: true });
desk.write(path.join(outRoot, 'ui/AgentMapleDesk.ui'));

const library = new UIBuilder('AgentMapleLibrary');
library.panel('Board', { anchor: 'middle-right', pos: [-340, -40], rect_size: [460, 1040], color: '#1b2430', alpha: 0.92 });
library.text('Board/Title', '도서관', { size: 28, anchor: 'top-center', pos: [0, -12], rect_size: [400, 36] });
library.text('Board/ResultText', 'kn_ 번호로 본문을 엽니다. 출처 기록과 세션 요약은 사실이 아닙니다.', { size: 16, anchor: 'top-left', pos: [16, -56], rect_size: [420, 72] });
library.textInput('Board/SearchInput', { placeholder: '검색어', anchor: 'top-left', pos: [16, -136], ...field });
library.button('Board/SearchButton', '검색', { anchor: 'top-left', pos: [16, -184], ...button });
library.textInput('Board/NodeInput', { placeholder: 'kn_ 번호', anchor: 'top-left', pos: [16, -240], ...field });
library.button('Board/ReadButton', '본문', { anchor: 'top-left', pos: [16, -288], rect_size: [160, 88], font_size: 18, color: '#111827', bg_color: button.bg_color });
library.button('Board/NeighborButton', '이웃', { anchor: 'top-left', pos: [188, -288], rect_size: [160, 88], font_size: 18, color: '#111827', bg_color: button.bg_color });
library.textInput('Board/TitleInput', { placeholder: '제목', anchor: 'top-left', pos: [16, -348], ...field });
library.textInput('Board/BodyInput', { placeholder: '본문', anchor: 'top-left', pos: [16, -396], ...field });
library.textInput('Board/SourceInput', { placeholder: '출처 이름', anchor: 'top-left', pos: [16, -444], ...field });
library.textInput('Board/TaskInput', { placeholder: '과제 id', anchor: 'top-left', pos: [16, -492], ...field });
library.button('Board/PublishSourceButton', '출처 기록 올리기', { anchor: 'top-left', pos: [16, -544], ...button });
library.button('Board/PublishSummaryButton', '세션 요약 올리기', { anchor: 'top-left', pos: [16, -596], ...button });
library.textInput('Board/FromInput', { placeholder: '시작 kn_', anchor: 'top-left', pos: [16, -656], rect_size: [170, 40], font_size: 16 });
library.textInput('Board/ToInput', { placeholder: '끝 kn_', anchor: 'top-left', pos: [196, -656], rect_size: [170, 40], font_size: 16 });
library.button('Board/LinkButton', '연결 제안', { anchor: 'top-left', pos: [16, -708], ...button });
library.textInput('Board/EdgeInput', { placeholder: 'ke_ 번호', anchor: 'top-left', pos: [16, -760], ...field });
library.button('Board/ApproveButton', '연결 승인', { anchor: 'top-left', pos: [16, -808], ...button });
library.script('LibraryHall', 'script.LibraryHall', { anchor: 'stretch', pos: [0, 0], rect_size: [1920, 1080] });
library.write(path.join(outRoot, 'ui/AgentMapleLibrary.ui'));

const skillCorpus = walkText(skillRoot);
const overlayCorpus = walkText(outRoot);
const ruids = [...overlayCorpus.matchAll(/\b[0-9a-f]{32}\b/g)].map((match) => match[0]);
const unique = [...new Set(ruids)];
const unknown = unique.filter((id) => !skillCorpus.includes(id));
if (unknown.length) {
  console.error('RUID not present in the official skill checkout:', unknown.join(', '));
  process.exit(1);
}
const provenance = {
  notTestedInCreator: true,
  skillRepo: 'https://github.com/MSW-Git/msw-ai-coding-plugins-official',
  skillCommit,
  note: 'RUID values were copied by the official builders from that skill checkout. This repository did not invent them.',
  ruids: Object.fromEntries(unique.map((id) => [id, 'present in MSW-Git msw-maker-base-skill at skillCommit'])),
};
fs.writeFileSync(path.join(outRoot, 'PROVENANCE.json'), `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`overlay ready, ruids ${unique.length}, tile mode ${MapBuilder.read(path.join(outRoot, 'map/AgentMapleVillage.map')).getTileMapMode()}`);

function walkText(dir) {
  let out = '';
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out += walkText(full);
    else if (entry.isFile() && fs.statSync(full).size < 5_000_000) out += fs.readFileSync(full, 'utf8');
  }
  return out;
}
