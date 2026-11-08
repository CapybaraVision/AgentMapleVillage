import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'msw', 'scripts');

describe('msw script contract', () => {
  const files = fs.readdirSync(root).filter((file) => file.endsWith('.mlua'));

  it('ships script sources and not a fabricated world package', () => {
    expect(files.sort()).toEqual(['GoalDesk.mlua', 'LibraryHall.mlua', 'OfficeNpc.mlua', 'VillageRelay.mlua']);
    const packaged = fs.readdirSync(path.resolve(root, '..', '..')).filter((file) => file.endsWith('.modpackage'));
    expect(packaged).toEqual([]);
  });

  it('matches the relay command names and stays inside the documented HTTP surface', () => {
    const relay = fs.readFileSync(path.join(root, 'VillageRelay.mlua'), 'utf8');
    const npc = fs.readFileSync(path.join(root, 'OfficeNpc.mlua'), 'utf8');
    const desk = fs.readFileSync(path.join(root, 'GoalDesk.mlua'), 'utf8');
    const hall = fs.readFileSync(path.join(root, 'LibraryHall.mlua'), 'utf8');
    const all = `${relay}\n${npc}\n${desk}\n${hall}`;
    for (const token of ['goal.submit', 'decision.answer', 'character.bind', 'PostAndWait', 'ses_foreman', 'ses_worker', '이대로 진행', '거절']) {
      expect(all).toContain(token);
    }
    expect(relay).toContain('afterEventSeq');
    expect(relay).toContain('/state');
    expect(relay).toContain('/commands');
    expect(relay).toContain('/pair');
    expect(npc).toContain('Station == "user"');
    expect(npc).toContain('targetY = self.DeskY');
    expect(relay).toContain('library.search');
    expect(hall).toContain('SubmitLibrarySearch');
    expect(hall).toContain('kn_');
    expect(relay).toContain('library.neighbors');
    expect(relay).toContain('self.ClockOffset');
    expect(relay).toContain('DateTime.UtcNow.Elapsed + self.ClockOffset');
    expect(relay).not.toContain('issuedAt = DateTime.UtcNow.Elapsed,');
    expect(npc).toContain('CaptureOwnerOnNextEnter');
    expect(npc).not.toContain('if self.OwnerUserId == "" then\n\t\t\tself.OwnerUserId = event.UserId');
    expect(hall).not.toContain('documentVersion');
    expect(desk).toContain('질문이 오면 여기에 표시됩니다.');
    const code = all.replace(/--\[\[[\s\S]*?\]\]/g, '').replace(/--.*$/gm, '');
    expect(code).not.toMatch(/WebSocket|websocket|os\.execute|io\.popen|RequestAndWait|RUID|\.modpackage/);
    expect(all).toContain('UNVERIFIED');
  });

  it('declares every assigned component field, which static tests can check and Creator play cannot be claimed here', () => {
    const required = ['WorldToken', 'ClockOffset', 'OpenDecisionId', 'Busy', 'Cursor', 'CommandCounter'];
    for (const file of files) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      const declared = new Set([...text.matchAll(/^\s*property\s+\S+\s+([A-Za-z_][A-Za-z0-9_]*)/gm)].map((match) => match[1]));
      const assigned = [...text.matchAll(/\bself\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g)].map((match) => match[1]);
      for (const name of assigned) expect(declared.has(name), `${file} ${name}`).toBe(true);
      if (file === 'VillageRelay.mlua') {
        for (const name of required) expect(declared.has(name)).toBe(true);
        expect(text).not.toMatch(/^\s*@Sync\b/m);
        expect(text).toContain('cannot set Name, no such field');
      }
    }
    const desk = fs.readFileSync(path.join(root, 'GoalDesk.mlua'), 'utf8');
    expect(desk).toContain('공개 릴레이가 없습니다.');
    expect(desk).not.toContain('마을 연결 전');
  });
});
