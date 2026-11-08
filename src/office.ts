import path from 'node:path';
import {
  ACTOR_ID_RE,
  COMMAND_ID_RE,
  DEFAULT_FOREMAN_ACTOR,
  DEFAULT_FOREMAN_SESSION,
  DEFAULT_WORKER_ACTOR,
  DEFAULT_WORKER_SESSION,
  SESSION_ID_RE,
  type AgentSessionRecord,
  type Character,
  type Decision,
  type DomainEvent,
  type Goal,
  type OfficeView,
  type Role,
  type Task,
} from './protocol.js';
import { fingerprint } from './json.js';
import { readJson, writeJsonAtomic } from './persist.js';
import type { SessionDriver, TurnResult } from './claude-driver.js';
import { emptyLibrary, Library, LibraryError, migrateLibrary, type KnowledgeEdge, type KnowledgeNode, type LibraryPanel, type LibraryState } from './library.js';
import { FLOOR_Y, seatFor } from './seats.js';
import { ensureSessionHome, sessionHome } from './session-home.js';
import { inspectWorkdir } from './workspace-inspect.js';
import { LibraryDatabase, openLibraryDatabase } from './library-db.js';

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export class OfficeError extends Error {
  constructor(
    readonly code: 'bad_request' | 'conflict' | 'not_found' | 'denied' | 'forbidden',
    message: string,
  ) {
    super(message);
  }
}

export interface ApplyResult {
  result: Record<string, unknown>;
  events: DomainEvent[];
}

interface AppliedCommand {
  fingerprint: string;
  result: Record<string, unknown>;
  events: DomainEvent[];
}

export interface OfficeState {
  version: 1;
  backend: 'sim' | 'claude';
  characters: Character[];
  goals: Goal[];
  tasks: Task[];
  decisions: Decision[];
  sessions: AgentSessionRecord[];
  feed: OfficeView['feed'];
  applied: Record<string, AppliedCommand>;
  counters: { goal: number; task: number; decision: number; feed: number; meeting: number };
  meetings: MeetingRecord[];
  phase: string;
  createdAt: number;
  villageId: string;
  library: LibraryState;
}

export interface MeetingRecord {
  id: string;
  status: 'invited' | 'active' | 'ended' | 'cancelled';
  sessionIds: string[];
  heldSessionIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkerContext {
  sessionId: string;
  taskId: string;
  goalId: string;
  goalText: string;
  sessionKey: string;
  claudeSessionId?: string;
  referenceContext?: string;
  workdir?: string;
}

export interface ContinueContext extends WorkerContext {
  answer: { option?: string; text?: string };
}

export interface WorkerBackend {
  readonly id: 'sim' | 'claude';
  startTask(ctx: WorkerContext): Promise<{ claudeSessionId?: string; question: string; options: string[] } | { denied: true; reason: string; claudeSessionId?: string }>;
  continueTask(ctx: ContinueContext): Promise<{ claudeSessionId?: string; done: boolean; summary: string; denied?: boolean }>;
}

const QUESTION = '이 목표를 이 범위로 진행할까요?';
const OPTIONS = ['이대로 진행', '거절'] as const;

export function simBackend(): WorkerBackend {
  return {
    id: 'sim',
    async startTask() {
      return { question: QUESTION, options: [...OPTIONS] };
    },
    async continueTask(ctx) {
      if (ctx.answer.option === '거절') {
        return { done: false, denied: true, summary: '사용자가 이 범위를 거절했습니다.' };
      }
      return { done: true, summary: '시뮬 작업이 끝났습니다. 실제 모델 호출은 없습니다.' };
    },
  };
}

export function claudeBackend(driver: SessionDriver): WorkerBackend {
  return {
    id: 'claude',
    async startTask(ctx) {
      const turn = await driver.runTurn({
        intent: 'ask',
        sessionKey: ctx.sessionKey,
        ...(ctx.claudeSessionId ? { resumeSessionId: ctx.claudeSessionId } : {}),
        prompt: withReference(`Goal:\n${ctx.goalText}\nAsk the owner to confirm the scope before writing files.`, ctx.referenceContext),
        approve: async () => 'deny',
      });
      if (turn.denied) return { denied: true, reason: turn.reason ?? 'denied', ...(turn.sessionId ? { claudeSessionId: turn.sessionId } : {}) };
      return {
        ...(turn.sessionId ? { claudeSessionId: turn.sessionId } : {}),
        question: QUESTION,
        options: [...OPTIONS],
      };
    },
    async continueTask(ctx) {
      const turn: TurnResult = await driver.runTurn({
        intent: 'work',
        sessionKey: ctx.sessionKey,
        ...(ctx.claudeSessionId ? { resumeSessionId: ctx.claudeSessionId } : {}),
        prompt: withReference(`Goal:\n${ctx.goalText}\nOwner answer: ${ctx.answer.option ?? ''} ${ctx.answer.text ?? ''}`.trim(), ctx.referenceContext),
        ...(ctx.workdir ? { workdir: ctx.workdir } : {}),
        approve: async (request) => {
          if (!request.writes) return 'allow';
          return ctx.answer.option === '이대로 진행' ? 'allow' : 'deny';
        },
      });
      if (turn.denied) {
        return {
          done: false,
          denied: true,
          summary: turn.reason ?? '쓰기 권한이 거부되었습니다.',
          ...(turn.sessionId ? { claudeSessionId: turn.sessionId } : {}),
        };
      }
      return {
        done: true,
        summary: turn.text || '작업 결과를 반영했습니다.',
        ...(turn.sessionId ? { claudeSessionId: turn.sessionId } : {}),
      };
    },
  };
}

function defaultCharacters(): Character[] {
  return [
    {
      sessionId: DEFAULT_FOREMAN_SESSION,
      mapleActorId: DEFAULT_FOREMAN_ACTOR,
      displayName: '감독관',
      role: 'lead',
      state: 'idle',
      station: 'home',
      activity: '집에서 쉬는 중',
      ...seatFields(DEFAULT_FOREMAN_SESSION, 0),
    },
    {
      sessionId: DEFAULT_WORKER_SESSION,
      mapleActorId: DEFAULT_WORKER_ACTOR,
      displayName: '작업자',
      role: 'worker',
      state: 'idle',
      station: 'home',
      activity: '집에서 쉬는 중',
      ...seatFields(DEFAULT_WORKER_SESSION, 1),
    },
  ];
}

function seatFields(sessionId: string, index: number): Pick<Character, 'homeX' | 'deskX' | 'meetingX' | 'approachOffset' | 'floorY' | 'pace'> {
  const seat = seatFor(sessionId, index);
  return { ...seat, floorY: FLOOR_Y, pace: true };
}

function emptyState(backend: 'sim' | 'claude', now: number, villageId = ''): OfficeState {
  return {
    version: 1,
    backend,
    characters: defaultCharacters(),
    goals: [],
    tasks: [],
    decisions: [],
    sessions: [],
    feed: [],
    applied: {},
    counters: { goal: 0, task: 0, decision: 0, feed: 0, meeting: 0 },
    meetings: [],
    phase: 'idle',
    createdAt: now,
    villageId,
    library: emptyLibrary(villageId),
  };
}

function withReference(prompt: string, referenceContext?: string): string {
  if (!referenceContext) return prompt;
  return `${prompt}\n\n${referenceContext}`;
}

export class Office {
  private constructor(
    private state: OfficeState,
    private backend: WorkerBackend,
    private clock: Clock,
    private file?: string,
    private libraryDb?: LibraryDatabase,
  ) {}

  static create(opts: { backend: WorkerBackend; clock?: Clock; file?: string; villageId?: string }): Office {
    const clock = opts.clock ?? systemClock;
    const office = new Office(emptyState(opts.backend.id, clock.now(), opts.villageId ?? ''), opts.backend, clock, opts.file);
    if (opts.file) {
      const opened = openLibraryDatabase(opts.file, office.state.library, office.state.villageId);
      office.libraryDb = opened.db;
      office.state.library = opened.library;
      const profileDir = path.dirname(opts.file);
      for (const character of office.state.characters) ensureSessionHome(profileDir, character.sessionId, character.role);
    }
    if (opts.villageId) office.bindVillage(opts.villageId);
    office.save();
    return office;
  }

  static load(opts: { file: string; backend: WorkerBackend; clock?: Clock }): Office {
    const clock = opts.clock ?? systemClock;
    const saved = readJson<OfficeState>(opts.file);
    if (!saved) return Office.create({ backend: opts.backend, clock, file: opts.file });
    if (saved.version !== 1) throw new OfficeError('bad_request', 'unsupported office state version');
    const loose = saved as OfficeState & { library?: LibraryState; villageId?: string };
    if (!loose.villageId) loose.villageId = '';
    loose.library = migrateLibrary(loose.library, loose.villageId);
    if (!Array.isArray(loose.meetings)) loose.meetings = [];
    if (!loose.counters.meeting) loose.counters.meeting = 0;
    const opened = openLibraryDatabase(opts.file, loose.library, loose.villageId);
    loose.library = opened.library;
    loose.backend = opts.backend.id;
    return new Office(loose, opts.backend, clock, opts.file, opened.db);
  }

  bindVillage(villageId: string): void {
    if (!/^vil_[A-Za-z0-9_-]{4,64}$/.test(villageId)) throw new OfficeError('bad_request', 'invalid villageId');
    if (this.state.villageId && this.state.villageId !== villageId) {
      throw new OfficeError('conflict', 'profile is already bound to another village');
    }
    if (this.state.library.nodes.some((node) => node.villageId && node.villageId !== villageId)) {
      throw new OfficeError('conflict', 'library is already bound to another village');
    }
    this.state.villageId = villageId;
    this.state.library.villageId = villageId;
    this.save();
  }

  approvalsFor(sessionId: string): Array<{ commandId: string; decision: string; writes: boolean }> {
    return this.libraryDb?.approvalsFor(sessionId) ?? [];
  }

  get snapshot(): OfficeState {
    return structuredClone(this.state);
  }

  save(): void {
    if (!this.file) return;
    this.libraryDb?.write(this.state.library);
    writeJsonAtomic(this.file, this.state);
  }

  static statePath(profileDir: string): string {
    return path.join(profileDir, 'state.json');
  }

  async apply(commandId: string, type: string, payload: Record<string, unknown>): Promise<ApplyResult> {
    if (!COMMAND_ID_RE.test(commandId)) throw new OfficeError('bad_request', 'invalid commandId');
    const prior = this.state.applied[commandId];
    const body = fingerprint({ type, payload });
    if (prior) {
      if (prior.fingerprint !== body) throw new OfficeError('conflict', 'commandId was already used with a different body');
      return { result: { ...prior.result, duplicate: true }, events: prior.events.map((event) => ({ ...event, payload: { ...event.payload } })) };
    }
    const produced = await this.dispatch(type, payload);
    if (type === 'decision.answer' && this.libraryDb && this.file) {
      const decisionId = typeof payload.decisionId === 'string' ? payload.decisionId : '';
      const decision = this.state.decisions.find((item) => item.id === decisionId);
      if (decision) {
        this.libraryDb.recordApproval({
          commandId,
          sessionId: decision.sessionId,
          decision: typeof payload.option === 'string' ? payload.option : 'text',
          writes: payload.option === '이대로 진행',
          recordedAt: this.clock.now(),
        });
        ensureSessionHome(path.dirname(this.file), decision.sessionId, this.requireCharacter(decision.sessionId).role);
      }
    }
    produced.events.forEach((event, index) => {
      event.eventId = `${commandId}:${index}`;
    });
    this.state.applied[commandId] = { fingerprint: body, result: produced.result, events: produced.events };
    this.save();
    return produced;
  }

  private async dispatch(type: string, payload: Record<string, unknown>): Promise<ApplyResult> {
    if (type === 'character.bind') return this.bindCharacter(payload);
    if (type === 'goal.submit') return this.submitGoal(payload);
    if (type === 'decision.answer') return this.answer(payload);
    if (type.startsWith('library.')) return this.libraryCommand(type, payload);
    if (type.startsWith('meeting.')) return this.meetingCommand(type, payload);
    if (type === 'workspace.inspect') return this.inspectCommand(payload);
    throw new OfficeError('denied', `command type ${type} is not handled locally`);
  }

  private rememberWork(sessionId: string, taskId: string, title: string, outcome: string, now: number): DomainEvent[] {
    if (!this.state.villageId) return [];
    const kept = this.library().retainSession({ sessionId, taskId, title, outcome, shelf: 'work' });
    if (!kept.node || kept.reason === 'duplicate' || kept.reason === 'tombstone') return [];
    return [this.libraryNodeEvent(kept.node, now), ...kept.edges.map((edge) => this.libraryEdgeEvent(edge, now))];
  }

  private library(): Library {
    return new Library(this.state.library, this.clock, {
      villageId: () => this.state.villageId,
      hasSession: (sessionId) => this.state.characters.some((item) => item.sessionId === sessionId),
      hasTask: (taskId) => this.state.tasks.some((item) => item.id === taskId),
    });
  }

  private libraryCommand(type: string, payload: Record<string, unknown>): ApplyResult {
    if (Array.isArray(payload.entries) || Array.isArray(payload.nodes) || Array.isArray(payload.edges)) {
      throw new OfficeError('denied', '도서관에는 한 건씩만 올릴 수 있습니다.');
    }
    const now = this.clock.now();
    try {
      if (type === 'library.publish') {
        const before = this.state.library.edges.length;
        const published = this.library().publish({
          explicit: payload.explicit === true,
          kind: payload.kind as 'source' | 'summary',
          title: stringField(payload, 'title'),
          body: stringField(payload, 'body'),
          authorRole: payload.authorRole === 'session' ? 'session' : 'user',
          authorId: typeof payload.authorId === 'string' ? payload.authorId : 'user',
          ...(typeof payload.sessionId === 'string' ? { sessionId: payload.sessionId } : {}),
          ...(typeof payload.taskId === 'string' ? { taskId: payload.taskId } : {}),
          ...(typeof payload.sourceLabel === 'string' ? { sourceLabel: payload.sourceLabel } : {}),
          ...(typeof payload.shelf === 'string' ? { shelf: payload.shelf as 'project' | 'concept' | 'work' | 'source' } : {}),
          ...(typeof payload.locator === 'string' ? { locator: payload.locator } : {}),
          ...(typeof payload.groundedNodeId === 'string' ? { groundedNodeId: payload.groundedNodeId } : {}),
          ...(typeof payload.villageId === 'string' ? { villageId: payload.villageId } : {}),
        });
        const edges = this.state.library.edges.slice(before);
        return {
          result: { nodeId: published.node.id, contentDuplicate: published.contentDuplicate, assertsFact: false },
          events: [this.libraryNodeEvent(published.node, now), ...edges.map((edge) => this.libraryEdgeEvent(edge, now))],
        };
      }
      if (type === 'library.revise') {
        const node = this.library().revise({
          explicit: payload.explicit === true,
          nodeId: stringField(payload, 'nodeId'),
          ...(typeof payload.title === 'string' ? { title: payload.title } : {}),
          ...(typeof payload.body === 'string' ? { body: payload.body } : {}),
          authorRole: payload.authorRole === 'session' ? 'session' : 'user',
          authorId: typeof payload.authorId === 'string' ? payload.authorId : 'user',
          ...(typeof payload.sessionId === 'string' ? { sessionId: payload.sessionId } : {}),
          ...(typeof payload.villageId === 'string' ? { villageId: payload.villageId } : {}),
        });
        return { result: { nodeId: node.id, revision: node.revision, assertsFact: false }, events: [this.libraryNodeEvent(node, now)] };
      }
      if (type === 'library.link') {
        const linked = this.library().link({
          explicit: payload.explicit === true,
          fromId: stringField(payload, 'fromId'),
          toId: stringField(payload, 'toId'),
          ...(typeof payload.note === 'string' ? { note: payload.note } : {}),
          authorRole: payload.authorRole === 'session' ? 'session' : 'user',
          authorId: typeof payload.authorId === 'string' ? payload.authorId : 'user',
          ...(typeof payload.sessionId === 'string' ? { sessionId: payload.sessionId } : {}),
          ...(typeof payload.villageId === 'string' ? { villageId: payload.villageId } : {}),
        });
        return {
          result: { edgeId: linked.edge.id, contentDuplicate: linked.contentDuplicate, status: linked.edge.status, assertsFact: false },
          events: [this.libraryEdgeEvent(linked.edge, now)],
        };
      }
      if (type === 'library.approveLink') {
        const approved = this.library().approveLink({
          explicit: payload.explicit === true,
          edgeId: stringField(payload, 'edgeId'),
          ...(typeof payload.villageId === 'string' ? { villageId: payload.villageId } : {}),
        });
        return {
          result: { edgeId: approved.edge.id, alreadyApproved: approved.alreadyApproved, assertsFact: false },
          events: [this.libraryEdgeEvent(approved.edge, now)],
        };
      }
      if (type === 'library.retract') {
        const node = this.library().retract({
          explicit: payload.explicit === true,
          nodeId: stringField(payload, 'nodeId'),
          ...(typeof payload.villageId === 'string' ? { villageId: payload.villageId } : {}),
        });
        return { result: { nodeId: node.id, retracted: true, assertsFact: false }, events: [] };
      }
      if (type === 'library.organize') {
        const before = this.library().nodeRevision(stringField(payload, 'nodeId'));
        const node = this.library().organize({
          explicit: payload.explicit === true,
          nodeId: stringField(payload, 'nodeId'),
          shelf: stringField(payload, 'shelf'),
          ...(typeof payload.villageId === 'string' ? { villageId: payload.villageId } : {}),
        });
        return { result: { nodeId: node.id, revision: node.revision, revisionUnchanged: node.revision === before, assertsFact: false }, events: [this.libraryNodeEvent(node, now)] };
      }
      if (type === 'library.search' || type === 'library.read' || type === 'library.neighbors' || type === 'library.browse') {
        const panel = this.libraryPanel(type, payload);
        return { result: { mode: panel.mode, count: panel.cards.length, executable: false }, events: [this.libraryPanelEvent(panel, now)] };
      }
    } catch (error) {
      if (error instanceof LibraryError) throw new OfficeError(error.code, error.message);
      throw error;
    }
    throw new OfficeError('denied', `command type ${type} is not handled locally`);
  }

  private libraryPanel(type: string, payload: Record<string, unknown>): LibraryPanel {
    const villageId = typeof payload.villageId === 'string' ? payload.villageId : undefined;
    if (type === 'library.search') {
      return this.library().search({
        query: stringField(payload, 'query'),
        ...(typeof payload.limit === 'number' ? { limit: payload.limit } : {}),
        ...(typeof payload.kind === 'string' ? { kind: payload.kind } : {}),
        ...(typeof payload.shelf === 'string' ? { shelf: payload.shelf } : {}),
        ...(typeof payload.taskId === 'string' ? { taskId: payload.taskId } : {}),
        ...(typeof payload.sessionId === 'string' ? { sessionId: payload.sessionId } : {}),
        ...(villageId ? { villageId } : {}),
      });
    }
    if (type === 'library.read') return this.library().read({ nodeId: stringField(payload, 'nodeId'), ...(villageId ? { villageId } : {}) }).panel;
    if (type === 'library.browse') {
      return this.library().browse({
        ...(typeof payload.query === 'string' ? { query: payload.query } : {}),
        ...(typeof payload.shelf === 'string' ? { shelf: payload.shelf } : {}),
        ...(typeof payload.kind === 'string' ? { kind: payload.kind } : {}),
        ...(typeof payload.afterId === 'string' ? { afterId: payload.afterId } : {}),
        ...(villageId ? { villageId } : {}),
      });
    }
    return this.library().neighbors({
      nodeId: stringField(payload, 'nodeId'),
      ...(typeof payload.depth === 'number' ? { depth: payload.depth } : {}),
      ...(typeof payload.limit === 'number' ? { limit: payload.limit } : {}),
      ...(typeof payload.status === 'string' ? { status: payload.status } : {}),
      ...(villageId ? { villageId } : {}),
    });
  }

  private async inspectCommand(payload: Record<string, unknown>): Promise<ApplyResult> {
    const sessionId = requiredString(payload, 'sessionId');
    this.requireCharacter(sessionId);
    if (typeof payload.cmd === 'string' || typeof payload.command === 'string') {
      throw new OfficeError('denied', 'workspace.inspect does not accept a command string');
    }
    const now = this.clock.now();
    const task = this.state.tasks.find((item) => item.assigneeSessionId === sessionId && (item.status === 'doing' || item.status === 'todo'));
    const events = await this.noteInspect(sessionId, task?.id, now);
    return { result: { sessionId, executable: false, summary: events[0]?.payload.text ?? '' }, events };
  }

  private async noteInspect(sessionId: string, taskId: string | undefined, now: number): Promise<DomainEvent[]> {
    if (!this.file) return [this.feed(now, 'change', '세션 폴더가 없습니다. 변경 파일과 테스트 결과는 이 검사에 없습니다.', sessionId)];
    const report = await inspectWorkdir(sessionHome(path.dirname(this.file), sessionId));
    const events: DomainEvent[] = [this.feed(now, 'change', `${sessionId} ${report.summary}`, sessionId)];
    if (this.state.villageId && report.repo) {
      events.push(...this.rememberWork(sessionId, taskId ?? '', '작업 폴더 검사', report.files.length ? `변경 ${report.files.length}` : '변경 없음', now));
    }
    return events;
  }

  private meetingCommand(type: string, payload: Record<string, unknown>): ApplyResult {
    const now = this.clock.now();
    if (type === 'meeting.invite') {
      const sessionIds = stringList(payload.sessionIds);
      if (sessionIds.length < 1 || sessionIds.length > 6) throw new OfficeError('bad_request', 'meeting needs 1 to 6 sessions');
      for (const sessionId of sessionIds) this.requireCharacter(sessionId);
      const id = `mtg_${++this.state.counters.meeting}`;
      const meeting: MeetingRecord = {
        id,
        status: 'invited',
        sessionIds,
        heldSessionIds: sessionIds.filter((sessionId) => this.busy(sessionId)),
        createdAt: now,
        updatedAt: now,
      };
      this.state.meetings.push(meeting);
      const events = [
        this.feed(now, 'system', '회의 요청입니다. 작업 중인 세션은 자리를 비우지 않습니다. 세션 실행은 멈추지 않습니다.', sessionIds[0]),
        ...this.withSeats(sessionIds, now, []),
      ];
      return { result: { meetingId: id, status: meeting.status, heldSessionIds: meeting.heldSessionIds }, events };
    }
    const meeting = this.requireMeeting(stringField(payload, 'meetingId'));
    if (type === 'meeting.accept') {
      if (meeting.status === 'cancelled' || meeting.status === 'ended') throw new OfficeError('conflict', 'meeting is already closed');
      meeting.status = 'active';
      meeting.updatedAt = now;
      meeting.heldSessionIds = meeting.sessionIds.filter((sessionId) => this.busy(sessionId));
      return {
        result: { meetingId: meeting.id, status: meeting.status, heldSessionIds: meeting.heldSessionIds },
        events: [this.feed(now, 'system', '회의 자리를 확인했습니다. 모델 호출은 없습니다.', meeting.sessionIds[0]), ...this.withSeats(meeting.sessionIds, now, [])],
      };
    }
    if (type === 'meeting.cancel' || type === 'meeting.end') {
      if (meeting.status === 'cancelled' || meeting.status === 'ended') {
        return { result: { meetingId: meeting.id, status: meeting.status, duplicate: true }, events: [] };
      }
      meeting.status = type === 'meeting.cancel' ? 'cancelled' : 'ended';
      meeting.updatedAt = now;
      const text = meeting.status === 'cancelled' ? '회의 요청을 취소했습니다.' : '회의가 끝났습니다. 자리로 돌아갑니다.';
      return {
        result: { meetingId: meeting.id, status: meeting.status },
        events: [this.feed(now, 'system', text, meeting.sessionIds[0]), ...this.withSeats(meeting.sessionIds, now, [])],
      };
    }
    throw new OfficeError('denied', `command type ${type} is not handled locally`);
  }

  private requireMeeting(meetingId: string): MeetingRecord {
    const meeting = this.state.meetings.find((item) => item.id === meetingId);
    if (!meeting) throw new OfficeError('not_found', 'unknown meeting');
    return meeting;
  }

  private busy(sessionId: string): boolean {
    if (this.state.decisions.some((item) => item.sessionId === sessionId && item.status === 'open')) return true;
    return this.state.goals.some((item) => item.sessionId === sessionId && (item.status === 'planning' || item.status === 'active'));
  }

  private withSeats(sessionIds: string[], now: number, events: DomainEvent[]): DomainEvent[] {
    const seen = new Set<string>();
    for (const sessionId of sessionIds) {
      if (seen.has(sessionId)) continue;
      seen.add(sessionId);
      events.push(this.settle(sessionId, now));
    }
    return events;
  }

  private settle(sessionId: string, now: number): DomainEvent {
    const character = this.requireCharacter(sessionId);
    const index = this.state.characters.findIndex((item) => item.sessionId === sessionId);
    Object.assign(character, seatFields(sessionId, Math.max(0, index)));
    const open = this.state.decisions.some((item) => item.sessionId === sessionId && item.status === 'open');
    const working = this.state.goals.some((item) => item.sessionId === sessionId && (item.status === 'planning' || item.status === 'active'));
    const meeting = this.state.meetings.find((item) => (item.status === 'invited' || item.status === 'active') && item.sessionIds.includes(sessionId));
    if (open) {
      character.station = 'user';
      character.activity = '확인이 필요해 찾아가는 중';
      character.pace = false;
    } else if (working) {
      character.station = 'desk';
      character.activity = '책상에서 작업 중';
      character.pace = false;
    } else if (meeting) {
      character.station = 'meeting';
      character.activity = '회의 자리로 이동';
      character.pace = false;
    } else if (character.state === 'blocked') {
      character.station = 'home';
      character.activity = '거절되어 멈춤';
      character.pace = false;
    } else {
      character.station = 'home';
      character.activity = character.state === 'done' ? '일을 마치고 집에 있습니다' : '집에서 쉬는 중';
      character.pace = true;
    }
    if (meeting) {
      meeting.heldSessionIds = meeting.sessionIds.filter((id) => this.busy(id));
    }
    return this.characterEvent(character, now);
  }

  private bindCharacter(payload: Record<string, unknown>): ApplyResult {
    const sessionId = requiredString(payload, 'sessionId');
    const mapleActorId = requiredString(payload, 'mapleActorId');
    const displayName = requiredString(payload, 'displayName');
    const role = requiredString(payload, 'role');
    if (!SESSION_ID_RE.test(sessionId)) throw new OfficeError('bad_request', 'invalid sessionId');
    if (!ACTOR_ID_RE.test(mapleActorId)) throw new OfficeError('bad_request', 'invalid mapleActorId');
    if (role !== 'lead' && role !== 'worker') throw new OfficeError('bad_request', 'invalid role');
    if (displayName.length > 40) throw new OfficeError('bad_request', 'displayName is too long');

    const byActor = this.state.characters.find((item) => item.mapleActorId === mapleActorId);
    const bySession = this.state.characters.find((item) => item.sessionId === sessionId);
    if (byActor && byActor.sessionId !== sessionId) {
      throw new OfficeError('conflict', `actor ${mapleActorId} is already bound to ${byActor.sessionId}`);
    }
    if (bySession && bySession.mapleActorId !== mapleActorId) {
      throw new OfficeError('conflict', `session ${sessionId} is already bound to ${bySession.mapleActorId}`);
    }
    const now = this.clock.now();
    let character: Character;
    if (bySession) {
      bySession.displayName = displayName;
      bySession.role = role as Role;
      character = bySession;
    } else {
      character = {
        sessionId,
        mapleActorId,
        displayName,
        role: role as Role,
        state: 'idle',
        station: 'desk',
        activity: '대기 중',
      };
      this.state.characters.push(character);
    }
    if (character.homeX === undefined) Object.assign(character, seatFields(sessionId, Math.max(0, this.state.characters.length - 1)));
    if (this.file) ensureSessionHome(path.dirname(this.file), sessionId, role);
    if (!bySession) {
      character.station = 'home';
      character.activity = '집에서 쉬는 중';
      character.pace = true;
    }
    const events = [this.characterEvent(character, now), this.feed(now, 'system', `${displayName} 세션이 고정되었습니다.`, sessionId)];
    return { result: { sessionId, mapleActorId }, events };
  }

  private async submitGoal(payload: Record<string, unknown>): Promise<ApplyResult> {
    const text = requiredString(payload, 'text').trim();
    if (text.length < 1 || text.length > 500) throw new OfficeError('bad_request', 'goal text must be 1-500 characters');
    const sessionId = typeof payload.targetSessionId === 'string' ? payload.targetSessionId : DEFAULT_WORKER_SESSION;
    if (!SESSION_ID_RE.test(sessionId)) throw new OfficeError('bad_request', 'invalid targetSessionId');
    const worker = this.requireCharacter(sessionId);
    if (worker.role !== 'worker') throw new OfficeError('bad_request', 'goals are assigned to a worker session');
    if (this.state.goals.some((goal) => goal.sessionId === sessionId && (goal.status === 'planning' || goal.status === 'active'))) {
      throw new OfficeError('conflict', 'this session already has an open goal');
    }
    const open = this.state.decisions.find((item) => item.sessionId === sessionId && item.status === 'open');
    if (open) throw new OfficeError('conflict', 'this session already has an open question');

    const now = this.clock.now();
    const goalId = `goal_${++this.state.counters.goal}`;
    const taskId = `task_${++this.state.counters.task}`;
    const decisionId = `dec_${++this.state.counters.decision}`;
    const goal: Goal = { id: goalId, text, status: 'planning', sessionId, createdAt: now, updatedAt: now };
    const task: Task = {
      id: taskId,
      goalId,
      title: text.length > 40 ? `${text.slice(0, 40)}…` : text,
      status: 'doing',
      assigneeSessionId: sessionId,
      createdAt: now,
      updatedAt: now,
    };
    this.state.goals.push(goal);
    this.state.tasks.push(task);
    const lead = this.requireCharacter(DEFAULT_FOREMAN_SESSION);
    lead.state = 'thinking';
    lead.station = 'desk';
    lead.activity = '목표를 나누는 중';
    worker.state = 'editing';
    worker.station = 'desk';
    worker.activity = '책상에서 작업 중';
    worker.taskId = taskId;
    this.state.phase = 'working';

    const sessionKey = `${sessionId}:${taskId}`;
    const record = this.sessionRecord(sessionKey);
    const reference = this.library().referenceFor(text, taskId);
    const started = await this.backend.startTask({
      sessionId,
      taskId,
      goalId,
      goalText: text,
      sessionKey,
      ...(record.claudeSessionId ? { claudeSessionId: record.claudeSessionId } : {}),
      ...(reference.text ? { referenceContext: reference.text } : {}),
      ...(this.file ? { workdir: sessionHome(path.dirname(this.file), sessionId) } : {}),
    });
    this.rememberSession(sessionKey, started.claudeSessionId);

    const events: DomainEvent[] = [
      this.characterEvent(lead, now),
      this.goalEvent(goal, now),
      this.taskEvent(task, now),
      this.characterEvent(worker, now),
    ];

    if ('denied' in started) {
      task.status = 'blocked';
      task.summary = started.reason;
      task.updatedAt = now;
      goal.status = 'failed';
      goal.updatedAt = now;
      worker.state = 'blocked';
      worker.station = 'desk';
      worker.activity = '시작이 거부되었습니다';
      this.state.phase = 'blocked';
      events.push(this.taskEvent(task, now), this.goalEvent(goal, now), this.characterEvent(worker, now), this.feed(now, 'error', started.reason, sessionId), this.taskFeed(task, sessionId, now), this.statusEvent(now));
      return { result: { goalId, taskId, denied: true }, events: this.withSeats([sessionId, DEFAULT_FOREMAN_SESSION], now, events) };
    }

    goal.status = 'active';
    goal.updatedAt = now;
    const decision: Decision = {
      id: decisionId,
      sessionId,
      taskId,
      goalId,
      kind: 'question',
      question: `${started.question}\n${text}`,
      options: started.options,
      status: 'open',
      createdAt: now,
    };
    this.state.decisions.push(decision);
    worker.state = 'waiting_user';
    worker.station = 'user';
    worker.activity = '확인이 필요해 찾아가는 중';
    lead.state = 'idle';
    lead.activity = '답변을 기다리는 중';
    this.state.phase = 'waiting_user';
    events.push(
      this.goalEvent(goal, now),
      this.decisionEvent(decision, now),
      this.characterEvent(worker, now),
      this.characterEvent(lead, now),
      this.feed(now, 'decision', `${worker.displayName}이 질문을 들고 왔습니다.`, sessionId),
      this.taskFeed(task, sessionId, now),
      this.statusEvent(now),
    );
    return { result: { goalId, taskId, decisionId }, events: this.withSeats([sessionId, DEFAULT_FOREMAN_SESSION], now, events) };
  }

  private async answer(payload: Record<string, unknown>): Promise<ApplyResult> {
    const decisionId = requiredString(payload, 'decisionId');
    const option = typeof payload.option === 'string' ? payload.option : undefined;
    const text = typeof payload.text === 'string' ? payload.text : undefined;
    if (!option && !text) throw new OfficeError('bad_request', 'an option or text is required');
    if (text && text.length > 500) throw new OfficeError('bad_request', 'answer text is too long');
    const decision = this.state.decisions.find((item) => item.id === decisionId);
    if (!decision) throw new OfficeError('not_found', 'unknown decision');
    if (decision.status !== 'open') throw new OfficeError('conflict', 'decision is not open');
    if (option && !decision.options.includes(option)) throw new OfficeError('bad_request', 'option is not one of the offered choices');

    const now = this.clock.now();
    decision.status = 'answered';
    decision.answer = { ...(option ? { option } : {}), ...(text ? { text } : {}), ts: now };
    const task = this.state.tasks.find((item) => item.id === decision.taskId);
    const goal = this.state.goals.find((item) => item.id === decision.goalId);
    const worker = this.requireCharacter(decision.sessionId);
    if (!task || !goal) throw new OfficeError('not_found', 'decision is missing its task');

    const sessionKey = `${decision.sessionId}:${decision.taskId}`;
    const record = this.sessionRecord(sessionKey);
    const reference = this.library().referenceFor(goal.text, decision.taskId);
    const continued = await this.backend.continueTask({
      sessionId: decision.sessionId,
      taskId: decision.taskId,
      goalId: decision.goalId,
      goalText: goal.text,
      sessionKey,
      ...(record.claudeSessionId ? { claudeSessionId: record.claudeSessionId } : {}),
      ...(reference.text ? { referenceContext: reference.text } : {}),
      ...(this.file ? { workdir: sessionHome(path.dirname(this.file), decision.sessionId) } : {}),
      answer: { ...(option ? { option } : {}), ...(text ? { text } : {}) },
    });
    this.rememberSession(sessionKey, continued.claudeSessionId);

    const events: DomainEvent[] = [this.decisionEvent(decision, now)];
    if (continued.denied || !continued.done) {
      task.status = 'blocked';
      task.summary = continued.summary;
      task.updatedAt = now;
      goal.status = 'failed';
      goal.updatedAt = now;
      worker.state = 'blocked';
      worker.station = 'desk';
      worker.activity = '거절되어 멈춤';
      this.state.phase = 'blocked';
      events.push(
        this.taskEvent(task, now),
        this.goalEvent(goal, now),
        this.characterEvent(worker, now),
        this.feed(now, 'error', '작업이 거절되어 멈췄습니다.', worker.sessionId),
        this.taskFeed(task, worker.sessionId, now),
        this.statusEvent(now),
        ...this.rememberWork(worker.sessionId, task.id, goal.text, '거절', now),
      );
      events.push(...(await this.noteInspect(decision.sessionId, task.id, now)));
      return { result: { decisionId, goalId: goal.id, status: goal.status, denied: true }, events: this.withSeats([decision.sessionId, DEFAULT_FOREMAN_SESSION], now, events) };
    }

    task.status = 'done';
    task.summary = continued.summary;
    task.updatedAt = now;
    goal.status = 'done';
    goal.updatedAt = now;
    worker.state = 'done';
    worker.station = 'desk';
    worker.activity = '완료';
    delete worker.taskId;
    const lead = this.state.characters.find((item) => item.role === 'lead');
    if (lead) {
      lead.state = 'idle';
      lead.station = 'desk';
      lead.activity = '대기 중';
    }
    this.state.phase = 'done';
    events.push(
      this.taskEvent(task, now),
      this.goalEvent(goal, now),
      this.characterEvent(worker, now),
      ...(lead ? [this.characterEvent(lead, now)] : []),
      this.feed(now, 'goal', '목표가 끝났습니다.', worker.sessionId),
      this.taskFeed(task, worker.sessionId, now),
      this.statusEvent(now),
      ...this.rememberWork(worker.sessionId, task.id, goal.text, `완료. 선택 ${decision.answer?.option ?? '없음'}`, now),
    );
    events.push(...(await this.noteInspect(decision.sessionId, task.id, now)));
    return { result: { decisionId, goalId: goal.id, taskId: task.id, status: 'done' }, events: this.withSeats([decision.sessionId, DEFAULT_FOREMAN_SESSION], now, events) };
  }

  private sessionRecord(sessionKey: string): AgentSessionRecord {
    const found = this.state.sessions.find((item) => item.sessionKey === sessionKey);
    if (found) return found;
    const created: AgentSessionRecord = {
      sessionKey,
      engine: this.backend.id === 'claude' ? 'claude-code' : 'sim',
      turns: 0,
      updatedAt: this.clock.now(),
    };
    this.state.sessions.push(created);
    return created;
  }

  private rememberSession(sessionKey: string, claudeSessionId: string | undefined): void {
    if (!claudeSessionId) return;
    const record = this.sessionRecord(sessionKey);
    record.claudeSessionId = claudeSessionId;
    record.engine = 'claude-code';
    record.turns += 1;
    record.updatedAt = this.clock.now();
  }

  private requireCharacter(sessionId: string): Character {
    const found = this.state.characters.find((item) => item.sessionId === sessionId);
    if (!found) throw new OfficeError('not_found', `unknown session ${sessionId}`);
    return found;
  }

  private characterEvent(character: Character, ts: number): DomainEvent {
    return { eventId: '', type: 'character.upsert', sessionId: character.sessionId, ts, payload: { ...character } };
  }

  private goalEvent(goal: Goal, ts: number): DomainEvent {
    return { eventId: '', type: 'goal.upsert', sessionId: goal.sessionId, ts, payload: { ...goal } };
  }

  private taskEvent(task: Task, ts: number): DomainEvent {
    return { eventId: '', type: 'task.upsert', sessionId: task.assigneeSessionId, ts, payload: { ...task } };
  }

  private decisionEvent(decision: Decision, ts: number): DomainEvent {
    return { eventId: '', type: 'decision.upsert', sessionId: decision.sessionId, ts, payload: { ...decision } };
  }

  private taskFeed(task: Task, sessionId: string, ts: number): DomainEvent {
    return this.feed(ts, 'task', `과제 ${task.id} 상태 ${task.status}. 변경 파일과 테스트 결과는 이 기록에 없습니다.`, sessionId);
  }

  private feed(ts: number, kind: string, text: string, sessionId?: string): DomainEvent {
    const item = { ts, kind, text, ...(sessionId ? { sessionId } : {}) };
    this.state.feed.push(item);
    if (this.state.feed.length > 50) this.state.feed.splice(0, this.state.feed.length - 50);
    return { eventId: '', type: 'feed.add', ...(sessionId ? { sessionId } : {}), ts, payload: item };
  }

  private statusEvent(ts: number): DomainEvent {
    return {
      eventId: '',
      type: 'office.status',
      ts,
      payload: { phase: this.state.phase, backend: this.state.backend },
    };
  }

  private libraryNodeEvent(node: KnowledgeNode, ts: number): DomainEvent {
    return {
      eventId: '',
      type: 'library.node',
      ...(node.sessionId ? { sessionId: node.sessionId } : {}),
      ts,
      payload: {
        id: node.id,
        villageId: node.villageId,
        kind: node.kind,
        kindLabel: node.kind === 'source' ? '출처 기록' : '세션 요약',
        title: node.title,
        snippet: node.body.slice(0, 140),
        assertion: node.assertion,
        assertsFact: false,
        revision: node.revision,
        ...(node.shelf ? { shelf: node.shelf } : {}),
        ...(node.taskId ? { taskId: node.taskId } : {}),
        ...(node.sessionId ? { sessionId: node.sessionId } : {}),
        ...(node.sourceLabel ? { sourceLabel: node.sourceLabel } : {}),
      },
    };
  }

  private libraryEdgeEvent(edge: KnowledgeEdge, ts: number): DomainEvent {
    return {
      eventId: '',
      type: 'library.edge',
      ts,
      payload: {
        id: edge.id,
        villageId: edge.villageId,
        fromId: edge.fromId,
        toId: edge.toId,
        kind: edge.kind,
        status: edge.status,
        statusLabel: edge.status === 'approved' ? '승인한 연결' : '제안된 연결',
        assertsFact: false,
      },
    };
  }

  private libraryPanelEvent(panel: LibraryPanel, ts: number): DomainEvent {
    return {
      eventId: '',
      type: 'library.panel',
      ts,
      payload: {
        mode: panel.mode,
        notice: panel.notice,
        text: panel.text,
        executable: false,
        cards: panel.cards,
        edges: panel.edges,
        ...(panel.query ? { query: panel.query } : {}),
      },
    };
  }
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string') throw new OfficeError('bad_request', `${key} is required`);
  return value;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !SESSION_ID_RE.test(item))) {
    throw new OfficeError('bad_request', 'sessionIds must be session ids');
  }
  return [...new Set(value)];
}

function requiredString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) throw new OfficeError('bad_request', `${key} is required`);
  return value;
}
