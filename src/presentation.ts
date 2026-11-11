/**
 * Maps actual session fields onto Korean labels and a horizontal walk hint.
 * It does not change session state, pick an animation clip, or treat movement ending as success.
 * Slot labels such as S01 are display text from the anchor manifest, not identifiers.
 */

export interface PresentCharacter {
  sessionId: string;
  displayName: string;
  state: string;
  station: string;
  activity: string;
  taskId?: string;
}

export interface Presentation {
  sessionId: string;
  nameplate: string;
  stateLabel: string;
  doneBadge: boolean;
  questionCount: number;
  freshness: 'unknown' | 'current' | 'stale';
  movement: 'hold' | 'walk_x';
  targetAnchorId: string;
  keepsFloorY: true;
  pathfinding: false;
  animationClip: null;
  writesLocked: boolean;
  allowedActions: string[];
}

const STATE_LABELS: Record<string, string> = {
  idle: '대기',
  thinking: '생각 중',
  reading: '읽는 중',
  editing: '수정 중',
  running: '실행 중',
  testing: '테스트 중',
  waiting_user: '질문',
  blocked: '멈춤',
  done: '완료 표식',
  error: '오류',
};

const READ_ACTIONS = ['library.search', 'library.read', 'library.neighbors', 'library.browse'] as const;

export function presentCharacter(input: {
  character: PresentCharacter;
  taskStatus?: string;
  openDecisions: number;
  lastEventAt?: number;
  now: number;
  staleAfterMs: number | null;
  slotLabel?: string;
  deskAnchorId: string;
}): Presentation {
  const { character } = input;
  const stateLabel = STATE_LABELS[character.state] ?? character.activity;
  const doneBadge = input.taskStatus === 'done' && character.state === 'done';
  let freshness: Presentation['freshness'] = 'unknown';
  if (typeof input.lastEventAt === 'number' && input.staleAfterMs !== null) {
    freshness = input.now - input.lastEventAt <= input.staleAfterMs ? 'current' : 'stale';
  } else if (typeof input.lastEventAt === 'number') {
    freshness = 'current';
  }
  const writesLocked = freshness === 'stale';
  const slot = input.slotLabel ? ` · ${input.slotLabel}` : '';
  const waiting = character.state === 'waiting_user' && input.openDecisions > 0;
  const movement = character.station === 'desk' || character.station === 'library' || waiting ? 'walk_x' : 'hold';
  const targetAnchorId = waiting ? 'command' : character.station === 'library' ? 'library' : input.deskAnchorId;
  const allowed = new Set<string>(READ_ACTIONS);
  if (!writesLocked && waiting) allowed.add('decision.answer');
  return {
    sessionId: character.sessionId,
    nameplate: `${character.displayName}${slot} · ${character.activity}`,
    stateLabel,
    doneBadge,
    questionCount: input.openDecisions,
    freshness,
    movement: character.station === 'desk' && !waiting ? 'hold' : movement,
    targetAnchorId: character.station === 'desk' && !waiting ? input.deskAnchorId : targetAnchorId,
    keepsFloorY: true,
    pathfinding: false,
    animationClip: null,
    writesLocked,
    allowedActions: [...allowed],
  };
}
