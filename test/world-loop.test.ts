import { describe, expect, it } from 'vitest';
import { anchorFor, boardText, bookIdsFromSearch, meetingGathering, shouldHold } from '../src/world-loop.js';

describe('world loop anchors', () => {
  it('maps real session state to a floor anchor and stays home when the relay is down', () => {
    expect(anchorFor({ linked: false, openQuestion: true, working: true, meeting: true })).toBe('home');
    expect(anchorFor({ linked: true, openQuestion: true, working: true, meeting: true })).toBe('player');
    expect(anchorFor({ linked: true, openQuestion: false, working: true, meeting: true })).toBe('desk');
    expect(anchorFor({ linked: true, openQuestion: false, working: false, meeting: true })).toBe('meeting');
    expect(anchorFor({ linked: true, openQuestion: false, working: false, meeting: false })).toBe('home');
  });

  it('gathers a meeting only when two sessions are actually there', () => {
    expect(meetingGathering({ characters: [{ sessionId: 'ses_worker', displayName: '작업자', station: 'meeting' }], topic: '설계' }).gathered).toBe(false);
    const gathered = meetingGathering({
      characters: [
        { sessionId: 'ses_foreman', displayName: '감독관', station: 'meeting' },
        { sessionId: 'ses_worker', displayName: '작업자', station: 'meeting' },
      ],
      topic: null,
    });
    expect(gathered.gathered).toBe(true);
    expect(gathered.text).toContain('감독관');
    expect(gathered.text).toContain('작업자');
    expect(gathered.text).toContain('주제 텍스트가 없습니다.');
  });

  it('splits the board into change, missing tests, and open review', () => {
    expect(boardText({ tab: 'change', feed: [], decisions: [] })).toBe('기록된 변경이 없습니다.');
    expect(boardText({ tab: 'test', feed: [], decisions: [] })).toBe('기록된 테스트 출력이 없습니다.');
    expect(boardText({ tab: 'review', feed: [], decisions: [{ status: 'open', sessionId: 'ses_worker', question: '진행할까요?' }] })).toContain('진행할까요?');
    expect(boardText({ tab: 'change', feed: [{ kind: 'change', sessionId: 'ses_worker', text: 'notes.txt' }], decisions: [] })).toContain('notes.txt');
  });

  it('stops at the anchor and moves again only when the target changes', () => {
    const arrived = shouldHold({ holding: false, lastTargetX: 0, targetX: 5, x: 5 });
    expect(arrived).toMatchObject({ holding: true, move: false, lastTargetX: 5 });
    const stayed = shouldHold({ holding: true, lastTargetX: 5, targetX: 5.2, x: 5 });
    expect(stayed.move).toBe(false);
    const retarget = shouldHold({ holding: true, lastTargetX: 5, targetX: 1, x: 5 });
    expect(retarget).toMatchObject({ holding: false, move: true });
  });

  it('turns search cards into book ids', () => {
    expect(bookIdsFromSearch([{ id: 'kn_2' }, { id: 'kn_9' }, {}])).toEqual(['kn_2', 'kn_9']);
  });
});
