import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'msw', 'scripts');

function readSource(file: string): string {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

describe('msw script contract', () => {
  const files = fs.readdirSync(root).filter((file) => file.endsWith('.mlua'));

  it('ships script sources and not a fabricated world package', () => {
    expect(files.sort()).toEqual(['BookSpot.mlua', 'GoalDesk.mlua', 'GuidePost.mlua', 'LibraryHall.mlua', 'NoticeBoard.mlua', 'OfficeNpc.mlua', 'OfficeStatus.mlua', 'VillageRelay.mlua']);
    const packaged = fs.readdirSync(path.resolve(root, '..', '..')).filter((file) => file.endsWith('.modpackage'));
    expect(packaged).toEqual([]);
  });

  it('matches the relay command names and stays inside the documented HTTP surface', () => {
    const relay = readSource(path.join(root, 'VillageRelay.mlua'));
    const npc = readSource(path.join(root, 'OfficeNpc.mlua'));
    const desk = readSource(path.join(root, 'GoalDesk.mlua'));
    const hall = readSource(path.join(root, 'LibraryHall.mlua'));
    const all = `${relay}\n${npc}\n${desk}\n${hall}`;
    for (const token of ['goal.submit', 'decision.answer', 'character.bind', 'PostAndWait', 'ses_foreman', 'ses_worker', '이대로 진행', '거절']) {
      expect(all).toContain(token);
    }
    expect(relay).toContain('afterEventSeq');
    expect(relay).toContain('/state');
    expect(relay).toContain('/commands');
    expect(relay).toContain('/pair');
    expect(npc).toContain('Station == "user"');
    expect(npc).toContain('Station == "meeting"');
    expect(npc).toContain('self.HomeX');
    expect(relay).toContain('meeting.invite');
    expect(relay).toContain('workspace.inspect');
    expect(relay).toContain('SubmitBookOpen');
    expect(relay).toContain('OpenAnswerPanel');
    expect(relay).toContain('SetTabs');
    expect(readSource(path.join(root, 'OfficeNpc.mlua'))).toContain('FlipX');
    expect(readSource(path.join(root, 'LibraryHall.mlua'))).toContain('OpenBoard');
    expect(relay).toContain('연결 끊김');
    expect(relay).toContain('작업 중');
    expect(readSource(path.join(root, 'BookSpot.mlua'))).toContain('SubmitBookOpen');
    expect(npc).toContain('MoveToDirection');
    expect(npc).not.toContain('SetWorldPosition');
    expect(relay).toContain('library.search');
    expect(hall).toContain('SubmitLibrarySearch');
    expect(hall).toContain('kn_');
    expect(relay).toContain('library.neighbors');
    expect(relay).toContain('self.ClockOffset');
    expect(relay).toContain('DateTime.UtcNow.Elapsed + self.ClockOffset');
    expect(relay).not.toContain('issuedAt = DateTime.UtcNow.Elapsed,');
    expect(npc).toContain('CaptureOwnerOnNextEnter = true');
    expect(relay).toContain('poll loop started');
    expect(relay).toContain('/time');
    expect(relay).toContain('연결 실패:');
    expect(relay).toContain('연결됨');
    expect(relay).toContain('WorldTokenLen=');
    expect(relay).toContain('LocalRelayBase');
    expect(relay).toContain('httpEnabled = true');
    expect(relay).toContain('GetAndWait');
    expect(relay).toContain('/health');
    expect(relay).toContain('poll backoff interval=10');
    expect(relay).toContain('WorldRefreshToken');
    expect(relay).not.toContain('OnBeginPlay clears it');
    expect(npc).not.toContain('if self.OwnerUserId == "" then\n\t\t\tself.OwnerUserId = event.UserId');
    expect(hall).not.toContain('documentVersion');
    expect(desk).toContain('질문이 오면 여기에 표시됩니다.');
    expect(desk).toContain('ConnectEvent(ButtonClickEvent');
    expect(desk).not.toContain('@EventSender("Entity"');
    expect(hall).toContain('ConnectEvent(ButtonClickEvent');
    expect(hall).not.toContain('@EventSender("Entity"');
    const withoutComments = all.replace(/--\[\[[\s\S]*?\]\]/g, '').replace(/--.*$/gm, '');
    expect(withoutComments).not.toMatch(/method\s+\S+\s+\w+\s*\([^)]*\bany\s+/);
    const code = all.replace(/--\[\[[\s\S]*?\]\]/g, '').replace(/--.*$/gm, '');
    expect(code).not.toMatch(/WebSocket|websocket|os\.execute|io\.popen|RUID|\.modpackage/);
    expect(relay).toContain('RequestAndWait');
    expect(relay).toContain('method=post');
    expect(relay).toContain('method=request');
    expect(relay).toContain('/state?afterEventSeq=');
    expect(relay).toContain('POST 실패(메이커 HttpService)');
    expect(all).toContain('UNVERIFIED');
  });

  it('declares every assigned component field, which static tests can check and Creator play cannot be claimed here', () => {
    const required = ['WorldToken', 'ClockOffset', 'OpenDecisionId', 'Busy', 'Cursor', 'CommandCounter'];
    for (const file of files) {
      const text = readSource(path.join(root, file));
      const declared = new Set([...text.matchAll(/^\s*property\s+\S+\s+([A-Za-z_][A-Za-z0-9_]*)/gm)].map((match) => match[1]));
      const assigned = [...text.matchAll(/\bself\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g)].map((match) => match[1]);
      for (const name of assigned) expect(declared.has(name), `${file} ${name}`).toBe(true);
      if (file === 'VillageRelay.mlua') {
        for (const name of required) expect(declared.has(name)).toBe(true);
        expect(text).not.toMatch(/^\s*@Sync\b/m);
        expect(text).toContain('cannot set Name, no such field');
      }
    }
    const desk = readSource(path.join(root, 'GoalDesk.mlua'));
    expect(desk).toContain('공개 릴레이가 없습니다.');
    expect(desk).not.toContain('마을 연결 전');
  });

  it('lets child UI receive clicks and writes the GUI text component before any legacy text component', () => {
    const uiDir = path.resolve(root, '..', 'workspace-overlay', 'ui');
    const uiFiles = fs.readdirSync(uiDir).filter((file) => file.endsWith('.ui'));
    expect(uiFiles.length).toBeGreaterThan(0);
    for (const file of uiFiles) {
      const ui = JSON.parse(readSource(path.join(uiDir, file))) as {
        ContentProto?: { Entities?: Array<{ jsonString?: { path?: string; '@components'?: Array<Record<string, unknown>> } }> };
      };
      const rootPath = `/ui/${file.replace(/\.ui$/, '')}`;
      const rootEntity = (ui.ContentProto?.Entities ?? []).find((entity) => entity.jsonString?.path === rootPath);
      const canvas = rootEntity?.jsonString?.['@components']?.find((component) => component['@type'] === 'MOD.Core.CanvasGroupComponent');
      expect(canvas?.BlocksRaycasts, file).toBe(true);
    }
    const relay = readSource(path.join(root, 'VillageRelay.mlua'));
    expect(relay).toContain('@ExecSpace("Client")\n\tmethod void PushUi');
    expect(relay).toContain('@ExecSpace("Client")\n\tmethod void PushLibrary');
    expect(relay).toContain('@ExecSpace("Client")\n\tmethod void OpenAnswerPanel');
    expect(relay).toContain('@ExecSpace("ServerOnly")\n\tmethod void PushStatus');
    for (const file of ['GoalDesk.mlua', 'LibraryHall.mlua']) {
      const text = readSource(path.join(root, file));
      const writeAt = text.indexOf('method void WriteText');
      const write = text.slice(writeAt);
      const guiWrite = write.indexOf('entity.TextGUIRendererComponent.Text = text');
      const legacyWrite = write.indexOf('entity.TextComponent.Text = text');
      const leaveGui = write.indexOf('return', guiWrite);
      expect(guiWrite, file).toBeGreaterThan(-1);
      expect(leaveGui, file).toBeGreaterThan(guiWrite);
      expect(legacyWrite, file).toBeGreaterThan(leaveGui);
      const readAt = text.indexOf('method string ReadText');
      const read = text.slice(readAt, writeAt);
      expect(read.indexOf('TextGUIRendererInputComponent')).toBeLessThan(read.indexOf('TextInputComponent'));
      expect(text).toContain('entity:SetEnable(enabled)');
    }
    expect(readSource(path.join(root, 'GoalDesk.mlua'))).toContain('지휘석 · 연결됨');
  });

  it('binds desk and library buttons by entity path and sends goal text to the server', () => {
    const desk = readSource(path.join(root, 'GoalDesk.mlua'));
    const begin = desk.slice(desk.indexOf('method void OnBeginPlay'), desk.indexOf('method void OnEndPlay'));
    const end = desk.slice(desk.indexOf('method void OnEndPlay'), desk.indexOf('method void OnOpenClick'));
    const wiring = `${begin}\n${end}`;
    for (const pathName of ['OpenButtonPath', 'PairButtonPath', 'GoalButtonPath', 'AcceptButtonPath', 'DenyButtonPath']) {
      expect(wiring).toContain(`GetEntityByPath(self.${pathName})`);
    }
    for (const handler of ['OnOpenClick', 'OnPairClick', 'OnGoalClick', 'OnAcceptClick', 'OnDenyClick']) {
      expect(wiring).toContain(`ConnectEvent(ButtonClickEvent, self.${handler})`);
    }
    expect(wiring).not.toContain('.Entity:ConnectEvent');
    expect(wiring).not.toContain('00000000-0000-4000-8000-000000000001');
    expect(wiring).not.toContain('00000000-0000-4000-8000-000000000002');
    expect(wiring).not.toContain('00000000-0000-4000-8000-000000000003');
    expect(wiring).not.toContain('00000000-0000-4000-8000-000000000004');
    expect(wiring).not.toContain('00000000-0000-4000-8000-000000000005');
    const hall = readSource(path.join(root, 'LibraryHall.mlua'));
    const hallBegin = hall.slice(hall.indexOf('method void OnBeginPlay'), hall.indexOf('method void OnEndPlay'));
    expect(hallBegin).toContain('GetEntityByPath(self.SearchButtonPath)');
    expect(hallBegin).toContain('ConnectEvent(ButtonClickEvent, self.OnSearchClick)');
    expect(hallBegin).not.toContain('.Entity:ConnectEvent');
    const relay = readSource(path.join(root, 'VillageRelay.mlua'));
    expect(relay).toContain('@ExecSpace("Server")\n\tmethod void Pair');
    expect(relay).toContain('@ExecSpace("Server")\n\tmethod void SubmitGoal');
    expect(relay).toContain('@ExecSpace("Server")\n\tmethod void SubmitAnswer');
    expect(relay).toContain('@ExecSpace("Client")\n\tmethod void PushUi');
    expect(relay).toContain('@ExecSpace("Client")\n\tmethod void OpenAnswerPanel');
    expect(relay).toContain('@ExecSpace("ServerOnly")\n\tmethod void SendCommand');
  });
});
