/**
 * Wire contract shared by the relay, the local connector, and the MapleStory Worlds scripts.
 * Identifiers are English. Player-facing copy lives in the office and the mLua UI.
 *
 * AgentCraft (MIT) investigated at CapybaraVision/agentcraft@9411705. No AgentCraft source is copied.
 * Status, station, decision, and task names follow that behavior so a later port can line up.
 */

export const PROTOCOL_VERSION = 1 as const;

export const DEFAULT_FOREMAN_SESSION = 'ses_foreman';
export const DEFAULT_WORKER_SESSION = 'ses_worker';
export const DEFAULT_FOREMAN_ACTOR = 'npc-foreman';
export const DEFAULT_WORKER_ACTOR = 'npc-worker';

export const WORLD_COMMANDS = [
  'goal.submit',
  'decision.answer',
  'character.bind',
  'library.publish',
  'library.revise',
  'library.link',
  'library.approveLink',
  'library.search',
  'library.read',
  'library.neighbors',
  'library.browse',
  'library.organize',
  'library.retract',
  'meeting.invite',
  'meeting.accept',
  'meeting.cancel',
  'meeting.end',
] as const;
export type WorldCommandType = (typeof WORLD_COMMANDS)[number];

/** Names that must never be queued, even if a client sends them. */
export const DENIED_COMMANDS = [
  'shell.exec',
  'git.exec',
  'git.push',
  'git.merge',
  'tool.run',
  'desktop.exec',
  'claude.exec',
  'library.delete',
  'library.ingest',
  'library.bulk',
] as const;

export const EVENT_TYPES = [
  'character.upsert',
  'goal.upsert',
  'task.upsert',
  'decision.upsert',
  'feed.add',
  'office.status',
  'library.node',
  'library.edge',
  'library.panel',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type AgentState =
  | 'idle'
  | 'thinking'
  | 'reading'
  | 'editing'
  | 'running'
  | 'testing'
  | 'waiting_user'
  | 'blocked'
  | 'done'
  | 'error';

export type Station = 'home' | 'desk' | 'user' | 'meeting' | 'lounge' | 'library';
export type Role = 'lead' | 'worker';
export type GoalStatus = 'planning' | 'active' | 'done' | 'failed' | 'cancelled';
export type TaskStatus = 'todo' | 'doing' | 'review' | 'done' | 'blocked' | 'cancelled';
export type DecisionKind = 'question' | 'permission' | 'merge';
export type DecisionStatus = 'open' | 'answered' | 'cancelled';

export interface Character {
  sessionId: string;
  mapleActorId: string;
  displayName: string;
  role: Role;
  state: AgentState;
  station: Station;
  activity: string;
  taskId?: string;
  homeX?: number;
  deskX?: number;
  meetingX?: number;
  approachOffset?: number;
  floorY?: number;
  pace?: boolean;
}

export interface Goal {
  id: string;
  text: string;
  status: GoalStatus;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
}

export interface Task {
  id: string;
  goalId: string;
  title: string;
  status: TaskStatus;
  assigneeSessionId: string;
  summary?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DecisionAnswer {
  option?: string;
  text?: string;
  ts: number;
}

export interface Decision {
  id: string;
  sessionId: string;
  taskId: string;
  goalId: string;
  kind: DecisionKind;
  question: string;
  options: string[];
  status: DecisionStatus;
  answer?: DecisionAnswer;
  createdAt: number;
}

export interface FeedItem {
  ts: number;
  kind: string;
  text: string;
  sessionId?: string;
}

export interface AgentSessionRecord {
  sessionKey: string;
  engine: 'sim' | 'claude-code';
  claudeSessionId?: string;
  turns: number;
  updatedAt: number;
}

export interface LibraryViewEdge {
  id: string;
  fromId: string;
  toId: string;
  kind: string;
  status: string;
  statusLabel?: string;
  assertsFact: false;
}

export interface LibraryViewCard {
  id: string;
  kind: string;
  kindLabel?: string;
  title: string;
  snippet?: string;
  assertion?: string;
  assertsFact: false;
}

export interface OfficeView {
  characters: Character[];
  goals: Goal[];
  tasks: Task[];
  decisions: Decision[];
  feed: FeedItem[];
  status: { phase: string; backend: 'sim' | 'claude' };
  library: {
    nodes: LibraryViewCard[];
    edges: LibraryViewEdge[];
    panel?: { mode?: string; text?: string; notice?: string; executable: false };
  };
}

export interface DomainEvent {
  eventId: string;
  type: EventType;
  sessionId?: string;
  ts: number;
  payload: Record<string, unknown>;
}

export const SESSION_ID_RE = /^ses_[a-z0-9_-]{1,64}$/;
export const ACTOR_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const COMMAND_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/;

export function isWorldCommand(type: string): type is WorldCommandType {
  return (WORLD_COMMANDS as readonly string[]).includes(type);
}

export function isDeniedCommand(type: string): boolean {
  return (DENIED_COMMANDS as readonly string[]).includes(type);
}

export function isEventType(type: string): type is EventType {
  return (EVENT_TYPES as readonly string[]).includes(type);
}

/** Conservative MSW HttpService budget. Official notice: 120 requests/minute, then 30s lockout. */
export const MSW_HTTP_LIMIT_PER_MIN = 120;
export const MSW_HTTP_LOCKOUT_MS = 30_000;
export const MSW_HTTP_TIMEOUT_MS = 30_000;
/** Design target for in-world reflection. Not a measured MapleStory Worlds latency. */
export const REFLECTION_TARGET_MS = { min: 1_000, max: 2_000 } as const;
/** Default world poll. 30 requests/minute, leaving headroom for goals, answers, and other world HTTP. */
export const DEFAULT_POLL_INTERVAL_MS = 2_000;

export function requestsPerMinute(intervalMs: number): number {
  if (intervalMs <= 0) throw new Error('intervalMs must be positive');
  return 60_000 / intervalMs;
}

export function lockoutIfExceeded(requestsInLastMinute: number): { allowed: boolean; lockoutMs: number } {
  if (requestsInLastMinute > MSW_HTTP_LIMIT_PER_MIN) {
    return { allowed: false, lockoutMs: MSW_HTTP_LOCKOUT_MS };
  }
  return { allowed: true, lockoutMs: 0 };
}

/** Upper bound the world should expect: one poll period plus one HTTP round trip. */
export function reflectionBudgetMs(pollIntervalMs: number, httpRttMs: number): number {
  return pollIntervalMs + Math.max(0, httpRttMs);
}

export function emptyView(backend: 'sim' | 'claude' = 'sim'): OfficeView {
  return {
    characters: [],
    goals: [],
    tasks: [],
    decisions: [],
    feed: [],
    status: { phase: 'empty', backend },
    library: { nodes: [], edges: [] },
  };
}

export function foldEvents(events: Array<{ type: string; payload: Record<string, unknown> }>, backend: 'sim' | 'claude' = 'sim'): OfficeView {
  const view = emptyView(backend);
  for (const event of events) applyEvent(view, event.type, event.payload);
  return view;
}

export function applyEvent(view: OfficeView, type: string, payload: Record<string, unknown>): void {
  if (type === 'character.upsert') {
    const character = payload as unknown as Character;
    const index = view.characters.findIndex((item) => item.sessionId === character.sessionId);
    if (index >= 0) view.characters[index] = character;
    else view.characters.push(character);
    return;
  }
  if (type === 'goal.upsert') {
    const goal = payload as unknown as Goal;
    const index = view.goals.findIndex((item) => item.id === goal.id);
    if (index >= 0) view.goals[index] = goal;
    else view.goals.push(goal);
    return;
  }
  if (type === 'task.upsert') {
    const task = payload as unknown as Task;
    const index = view.tasks.findIndex((item) => item.id === task.id);
    if (index >= 0) view.tasks[index] = task;
    else view.tasks.push(task);
    return;
  }
  if (type === 'decision.upsert') {
    const decision = payload as unknown as Decision;
    const index = view.decisions.findIndex((item) => item.id === decision.id);
    if (index >= 0) view.decisions[index] = decision;
    else view.decisions.push(decision);
    return;
  }
  if (type === 'feed.add') {
    view.feed.push(payload as unknown as FeedItem);
    if (view.feed.length > 50) view.feed.splice(0, view.feed.length - 50);
    return;
  }
  if (type === 'office.status') {
    const status = payload as { phase?: string; backend?: 'sim' | 'claude' };
    if (typeof status.phase === 'string') view.status.phase = status.phase;
    if (status.backend === 'sim' || status.backend === 'claude') view.status.backend = status.backend;
    return;
  }
  if (type === 'library.node') {
    const card = payload as unknown as LibraryViewCard;
    if (!card.id) return;
    const index = view.library.nodes.findIndex((item) => item.id === card.id);
    if (index >= 0) view.library.nodes[index] = card;
    else view.library.nodes.push(card);
    if (view.library.nodes.length > 40) view.library.nodes.splice(0, view.library.nodes.length - 40);
    return;
  }
  if (type === 'library.edge') {
    const edge = payload as unknown as LibraryViewEdge;
    if (!edge.id) return;
    const index = view.library.edges.findIndex((item) => item.id === edge.id);
    if (index >= 0) view.library.edges[index] = edge;
    else view.library.edges.push(edge);
    if (view.library.edges.length > 80) view.library.edges.splice(0, view.library.edges.length - 80);
    return;
  }
  if (type === 'library.panel') {
    const panel = payload as { mode?: string; text?: string; notice?: string };
    view.library.panel = { ...panel, executable: false };
  }
}
