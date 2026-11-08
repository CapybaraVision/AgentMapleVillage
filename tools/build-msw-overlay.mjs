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
for (const name of ['VillageRelay.mlua', 'OfficeNpc.mlua', 'GoalDesk.mlua', 'LibraryHall.mlua', 'OfficeStatus.mlua', 'BookSpot.mlua', 'NoticeBoard.mlua', 'GuidePost.mlua']) {
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
for (const name of ['Foreman', 'Worker']) {
  map.upsertComponent(name, 'MOD.Core.TouchReceiveComponent', { Enable: true });
  map.upsertComponent(name, 'script.OfficeStatus', {
    Enable: true,
    StatusLine: '릴레이에 붙어 있지 않습니다. 진행 중으로 표시하지 않습니다.',
  });
}
map.sprite('Guide', { pos: [0, floorY + 0.8, 0] });
map.upsertComponent('Guide', 'MOD.Core.NameTagComponent', { Enable: true, Name: '안내' });
map.upsertComponent('Guide', 'MOD.Core.ChatBalloonComponent', { Enable: true });
map.upsertComponent('Guide', 'script.GuidePost', { Enable: true });
map.sprite('NoticeBoard', { pos: [2.2, floorY + 0.6, 0] });
map.upsertComponent('NoticeBoard', 'MOD.Core.NameTagComponent', { Enable: true, Name: '게시판' });
map.upsertComponent('NoticeBoard', 'MOD.Core.ChatBalloonComponent', { Enable: true });
map.upsertComponent('NoticeBoard', 'MOD.Core.TouchReceiveComponent', { Enable: true });
map.upsertComponent('NoticeBoard', 'script.NoticeBoard', { Enable: true });
for (const book of [
  ['BookWork', 4, '빈 작업 책', 'work'],
  ['BookSource', 5.4, '빈 출처 책', 'source'],
]) {
  map.sprite(book[0], { pos: [book[1], floorY + 0.8, 0] });
  map.upsertComponent(book[0], 'MOD.Core.NameTagComponent', { Enable: true, Name: book[2] });
  map.upsertComponent(book[0], 'MOD.Core.ChatBalloonComponent', { Enable: true });
  map.upsertComponent(book[0], 'MOD.Core.TouchReceiveComponent', { Enable: true });
  map.upsertComponent(book[0], 'script.BookSpot', { Enable: true, Shelf: book[3], NodeId: '', TitleText: book[2] });
}
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
  WorldToken: '',
  ClockOffset: null,
  OpenDecisionId: '',
  Busy: false,
  Cursor: 0,
  CommandCounter: 0,
});
fs.mkdirSync(path.join(outRoot, 'map'), { recursive: true });
map.write(path.join(outRoot, 'map/AgentMapleVillage.map'));

const buttonPaint = { font_size: 18, color: '#111827', bg_color: { r: 0.9, g: 0.94, b: 1, a: 1 } };

function stack(ui, prefix, x, y, width) {
  const gapAfter = { text: 8, input: 8, button: 8 };
  return {
    text(name, label, height) {
      ui.text(`${prefix}/${name}`, label, { size: 18, anchor: 'top-left', pos: [x, y], rect_size: [width, height] });
      y -= height + gapAfter.text;
    },
    input(name, placeholder) {
      ui.textInput(`${prefix}/${name}`, { placeholder, anchor: 'top-left', pos: [x, y], rect_size: [width, 48], font_size: 18 });
      y -= 48 + gapAfter.input;
    },
    button(name, label) {
      ui.button(`${prefix}/${name}`, label, { anchor: 'top-left', pos: [x, y], rect_size: [width, 88], ...buttonPaint });
      y -= 88 + gapAfter.button;
    },
    pair(leftName, leftLabel, rightName, rightLabel) {
      const half = Math.floor((width - 12) / 2);
      ui.button(`${prefix}/${leftName}`, leftLabel, { anchor: 'top-left', pos: [x, y], rect_size: [half, 88], ...buttonPaint });
      ui.button(`${prefix}/${rightName}`, rightLabel, { anchor: 'top-left', pos: [x + half + 12, y], rect_size: [width - half - 12, 88], ...buttonPaint });
      y -= 88 + gapAfter.button;
    },
    bottom() {
      return y;
    },
  };
}

const desk = new UIBuilder('AgentMapleDesk');
desk.button('OpenButton', '지휘석', { anchor: 'middle-left', pos: [24, 300], rect_size: [160, 88], ...buttonPaint });
desk.panel('Board', { anchor: 'middle-left', pos: [24, -96], rect_size: [440, 672], color: '#1b2430', alpha: 0.92, enable: false });
const deskRows = stack(desk, 'Board', 16, -16, 408);
deskRows.text('Title', '지휘석', 40);
deskRows.text('StatusText', '공개 릴레이가 없습니다.', 48);
deskRows.text('QuestionText', '질문이 오면 여기에 표시됩니다.', 72);
deskRows.text('ResultText', '', 48);
deskRows.input('PairInput', '페어링 코드');
deskRows.button('PairButton', '연결');
deskRows.input('GoalInput', '목표');
deskRows.button('GoalButton', '목표 보내기');
deskRows.pair('AcceptButton', '이대로 진행', 'DenyButton', '거절');
desk.script('GoalDesk', 'script.GoalDesk', { anchor: 'stretch', pos: [0, 0], rect_size: [1920, 1080] });
fs.mkdirSync(path.join(outRoot, 'ui'), { recursive: true });
desk.write(path.join(outRoot, 'ui/AgentMapleDesk.ui'), {
  bind: {
    mlua: path.join(scriptOut, 'GoalDesk.mlua'),
    props: {
      OpenButton: '/ui/AgentMapleDesk/OpenButton',
      PairButton: '/ui/AgentMapleDesk/Board/PairButton',
      GoalButton: '/ui/AgentMapleDesk/Board/GoalButton',
      AcceptButton: '/ui/AgentMapleDesk/Board/AcceptButton',
      DenyButton: '/ui/AgentMapleDesk/Board/DenyButton',
    },
  },
});

const library = new UIBuilder('AgentMapleLibrary');
library.button('OpenButton', '도서관', { anchor: 'middle-right', pos: [-24, 300], rect_size: [160, 88], ...buttonPaint });
library.panel('Board', { anchor: 'middle-right', pos: [-24, -140], rect_size: [760, 760], color: '#1b2430', alpha: 0.92, enable: false });
library.text('Board/Title', '도서관', { size: 28, anchor: 'top-left', pos: [16, -16], rect_size: [728, 40] });
library.text('Board/ResultText', 'kn_ 번호로 본문을 엽니다. 출처 기록과 세션 요약은 사실이 아닙니다.', { size: 16, anchor: 'top-left', pos: [16, -64], rect_size: [728, 56] });
const libraryLeft = stack(library, 'Board', 16, -136, 356);
libraryLeft.input('SearchInput', '검색어');
libraryLeft.button('SearchButton', '검색');
libraryLeft.input('NodeInput', 'kn_ 번호');
libraryLeft.pair('ReadButton', '본문', 'NeighborButton', '이웃');
libraryLeft.input('TitleInput', '제목');
libraryLeft.input('BodyInput', '본문');
libraryLeft.input('SourceInput', '출처 이름');
const libraryRight = stack(library, 'Board', 388, -136, 356);
libraryRight.input('TaskInput', '과제 id');
libraryRight.button('PublishSourceButton', '출처 기록 올리기');
libraryRight.button('PublishSummaryButton', '세션 요약 올리기');
libraryRight.input('FromInput', '시작 kn_');
libraryRight.input('ToInput', '끝 kn_');
libraryRight.button('LinkButton', '연결 제안');
libraryRight.input('EdgeInput', 'ke_ 번호');
libraryRight.button('ApproveButton', '연결 승인');
library.script('LibraryHall', 'script.LibraryHall', { anchor: 'stretch', pos: [0, 0], rect_size: [1920, 1080] });
library.write(path.join(outRoot, 'ui/AgentMapleLibrary.ui'), {
  bind: {
    mlua: path.join(scriptOut, 'LibraryHall.mlua'),
    props: {
      OpenButton: '/ui/AgentMapleLibrary/OpenButton',
      SearchButton: '/ui/AgentMapleLibrary/Board/SearchButton',
      ReadButton: '/ui/AgentMapleLibrary/Board/ReadButton',
      NeighborButton: '/ui/AgentMapleLibrary/Board/NeighborButton',
      PublishSourceButton: '/ui/AgentMapleLibrary/Board/PublishSourceButton',
      PublishSummaryButton: '/ui/AgentMapleLibrary/Board/PublishSummaryButton',
      LinkButton: '/ui/AgentMapleLibrary/Board/LinkButton',
      ApproveButton: '/ui/AgentMapleLibrary/Board/ApproveButton',
    },
  },
});

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
