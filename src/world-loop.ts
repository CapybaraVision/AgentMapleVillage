/** Maps real session fields to a floor anchor. No relay data means home, not a fake task. */

export type FloorAnchor = 'home' | 'desk' | 'player' | 'meeting';
export type BoardTab = 'change' | 'test' | 'review';

export function anchorFor(input: { linked: boolean; openQuestion: boolean; working: boolean; meeting: boolean }): FloorAnchor {
  if (!input.linked) return 'home';
  if (input.openQuestion) return 'player';
  if (input.working) return 'desk';
  if (input.meeting) return 'meeting';
  return 'home';
}

export function meetingGathering(input: {
  characters: Array<{ sessionId: string; displayName: string; station: string }>;
  topic?: string | null;
}): { gathered: boolean; text: string } {
  const people = input.characters.filter((character) => character.station === 'meeting');
  if (people.length < 2) return { gathered: false, text: '회의가 아닙니다.' };
  const topic = input.topic && input.topic.trim() ? input.topic.trim() : '주제 텍스트가 없습니다.';
  return { gathered: true, text: `${people.map((person) => person.displayName).join(', ')}\n${topic}` };
}

export function boardText(input: {
  tab: BoardTab;
  feed: Array<{ kind: string; text: string; sessionId?: string }>;
  decisions: Array<{ status: string; question: string; sessionId: string }>;
}): string {
  if (input.tab === 'change') {
    const lines = input.feed.filter((item) => item.kind === 'change');
    if (!lines.length) return '기록된 변경이 없습니다.';
    return lines.map((item) => `${item.sessionId ?? '세션 없음'} ${item.text}`).join('\n');
  }
  if (input.tab === 'test') {
    const lines = input.feed.filter((item) => item.kind === 'test');
    if (!lines.length) return '기록된 테스트 출력이 없습니다.';
    return lines.map((item) => `${item.sessionId ?? '세션 없음'} ${item.text}`).join('\n');
  }
  const open = input.decisions.filter((item) => item.status === 'open');
  if (!open.length) return '열린 리뷰나 질문이 없습니다.';
  return open.map((item) => `${item.sessionId} ${item.question}`).join('\n');
}

export function shouldHold(input: { holding: boolean; lastTargetX: number; targetX: number; x: number; arrive?: number; retarget?: number }): { holding: boolean; move: boolean; lastTargetX: number } {
  const arrive = input.arrive ?? 0.25;
  const retarget = input.retarget ?? 0.35;
  const targetMoved = Math.abs(input.targetX - input.lastTargetX) > retarget;
  if (input.holding && !targetMoved) return { holding: true, move: false, lastTargetX: input.lastTargetX };
  if (Math.abs(input.targetX - input.x) <= arrive) return { holding: true, move: false, lastTargetX: input.targetX };
  return { holding: false, move: true, lastTargetX: input.lastTargetX };
}

export function markerVisible(input: { occupied: boolean; debug: boolean }): boolean {
  return input.debug || input.occupied;
}

export function bookIdsFromSearch(cards: Array<{ id?: string }>): string[] {
  return cards.map((card) => card.id).filter((id): id is string => typeof id === 'string' && id.startsWith('kn_')).slice(0, 2);
}
