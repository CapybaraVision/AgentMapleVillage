/**
 * Local SQLite store for one village library.
 * Node's built-in node:sqlite. No cloud database and no new npm package.
 * The public relay never receives this file or a SQL string.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { writeJsonAtomic } from './persist.js';
import { emptyLibrary, migrateLibrary, type KnowledgeEdge, type KnowledgeNode, type LibraryState, type Tombstone } from './library.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  assertion TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_label TEXT,
  task_id TEXT,
  session_id TEXT,
  author_role TEXT NOT NULL,
  author_id TEXT NOT NULL,
  shelf TEXT,
  revision INTEGER NOT NULL,
  revisions_json TEXT NOT NULL,
  redacted INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  author_role TEXT NOT NULL,
  author_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  approved_at INTEGER
);
CREATE TABLE IF NOT EXISTS tombstones (
  content_hash TEXT NOT NULL,
  node_id TEXT NOT NULL,
  village_id TEXT NOT NULL,
  retired_at INTEGER NOT NULL,
  PRIMARY KEY (village_id, content_hash)
);
CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  command_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  writes INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL
);
`;

export function libraryDbPath(stateFile: string): string {
  return path.join(path.dirname(stateFile), 'library.sqlite');
}

export function libraryBackupPath(stateFile: string): string {
  return `${libraryDbPath(stateFile)}.json-backup`;
}

export class LibraryDatabase {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').run('schema', '1');
  }

  hasRows(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM nodes').get() as { n: number };
    const tomb = this.db.prepare('SELECT COUNT(*) AS n FROM tombstones').get() as { n: number };
    return row.n > 0 || tomb.n > 0;
  }

  read(villageId: string): LibraryState {
    const nodes = this.db.prepare('SELECT * FROM nodes ORDER BY id').all().map(rowToNode);
    const edges = this.db.prepare('SELECT * FROM edges ORDER BY id').all().map(rowToEdge);
    const tombstones = this.db.prepare('SELECT * FROM tombstones').all().map(rowToTombstone);
    const counters = { node: this.counter('node'), edge: this.counter('edge') };
    return migrateLibrary({ villageId, nodes, edges, tombstones, counters }, villageId);
  }

  write(state: LibraryState): void {
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM nodes');
      this.db.exec('DELETE FROM edges');
      this.db.exec('DELETE FROM tombstones');
      this.db.exec('DELETE FROM counters');
      const insertNode = this.db.prepare(`INSERT INTO nodes (
        id, village_id, kind, assertion, title, body, source_label, task_id, session_id,
        author_role, author_id, shelf, revision, revisions_json, redacted, content_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const node of state.nodes) {
        insertNode.run(
          node.id,
          node.villageId,
          node.kind,
          node.assertion,
          node.title,
          node.body,
          node.sourceLabel ?? null,
          node.taskId ?? null,
          node.sessionId ?? null,
          node.authorRole,
          node.authorId,
          node.shelf ?? null,
          node.revision,
          JSON.stringify(node.revisions),
          node.redacted ? 1 : 0,
          node.contentHash,
          node.createdAt,
          node.updatedAt,
        );
      }
      const insertEdge = this.db.prepare(`INSERT INTO edges (
        id, village_id, from_id, to_id, kind, status, note, author_role, author_id, created_at, approved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const edge of state.edges) {
        insertEdge.run(
          edge.id,
          edge.villageId,
          edge.fromId,
          edge.toId,
          edge.kind,
          edge.status,
          edge.note ?? null,
          edge.authorRole,
          edge.authorId,
          edge.createdAt,
          edge.approvedAt ?? null,
        );
      }
      const insertTomb = this.db.prepare('INSERT INTO tombstones (content_hash, node_id, village_id, retired_at) VALUES (?, ?, ?, ?)');
      for (const tomb of state.tombstones) {
        insertTomb.run(tomb.contentHash, tomb.nodeId, tomb.villageId, tomb.retiredAt);
      }
      this.db.prepare('INSERT INTO counters (name, value) VALUES (?, ?)').run('node', state.counters.node);
      this.db.prepare('INSERT INTO counters (name, value) VALUES (?, ?)').run('edge', state.counters.edge);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  recordApproval(input: { commandId: string; sessionId: string; decision: string; writes: boolean; recordedAt: number }): boolean {
    const result = this.db.prepare(
      'INSERT INTO approvals (command_id, session_id, decision, writes, recorded_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(command_id) DO NOTHING',
    ).run(input.commandId, input.sessionId, input.decision, input.writes ? 1 : 0, input.recordedAt);
    return Number(result.changes) === 1;
  }

  approvalsFor(sessionId: string): Array<{ commandId: string; decision: string; writes: boolean }> {
    const rows = this.db.prepare('SELECT command_id, decision, writes FROM approvals WHERE session_id = ? ORDER BY recorded_at, command_id').all(sessionId) as Array<{
      command_id: string;
      decision: string;
      writes: number;
    }>;
    return rows.map((row) => ({ commandId: row.command_id, decision: row.decision, writes: row.writes === 1 }));
  }

  private counter(name: string): number {
    const row = this.db.prepare('SELECT value FROM counters WHERE name = ?').get(name) as { value: number } | undefined;
    return row?.value ?? 0;
  }
}

export function openLibraryDatabase(stateFile: string, jsonLibrary: LibraryState | undefined, villageId: string): { db: LibraryDatabase; library: LibraryState } {
  const current = migrateLibrary(jsonLibrary, villageId);
  const db = new LibraryDatabase(libraryDbPath(stateFile));
  if (!db.hasRows() && (current.nodes.length > 0 || current.edges.length > 0 || current.tombstones.length > 0)) {
    const backup = libraryBackupPath(stateFile);
    if (!fs.existsSync(backup)) writeJsonAtomic(backup, current);
    db.write(current);
  }
  if (db.hasRows()) return { db, library: db.read(villageId) };
  return { db, library: current.nodes.length ? current : emptyLibrary(villageId) };
}

function rowToNode(row: Record<string, unknown>): KnowledgeNode {
  return {
    id: String(row.id),
    villageId: String(row.village_id),
    kind: row.kind === 'source' ? 'source' : 'summary',
    assertion: row.assertion === 'citation' ? 'citation' : 'summary',
    assertsFact: false,
    title: String(row.title),
    body: String(row.body),
    ...(row.source_label ? { sourceLabel: String(row.source_label) } : {}),
    ...(row.task_id ? { taskId: String(row.task_id) } : {}),
    ...(row.session_id ? { sessionId: String(row.session_id) } : {}),
    authorRole: row.author_role === 'session' ? 'session' : 'user',
    authorId: String(row.author_id),
    ...(row.shelf === 'project' || row.shelf === 'concept' || row.shelf === 'work' || row.shelf === 'source' ? { shelf: row.shelf } : {}),
    revision: Number(row.revision),
    revisions: JSON.parse(String(row.revisions_json)) as KnowledgeNode['revisions'],
    redacted: Number(row.redacted) === 1,
    contentHash: String(row.content_hash),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToEdge(row: Record<string, unknown>): KnowledgeEdge {
  return {
    id: String(row.id),
    villageId: String(row.village_id),
    fromId: String(row.from_id),
    toId: String(row.to_id),
    kind: row.kind === 'grounded_in' ? 'grounded_in' : 'related',
    status: row.status === 'approved' ? 'approved' : 'proposed',
    assertsFact: false,
    ...(row.note ? { note: String(row.note) } : {}),
    authorRole: row.author_role === 'session' ? 'session' : 'user',
    authorId: String(row.author_id),
    createdAt: Number(row.created_at),
    ...(row.approved_at != null ? { approvedAt: Number(row.approved_at) } : {}),
  };
}

function rowToTombstone(row: Record<string, unknown>): Tombstone {
  return {
    contentHash: String(row.content_hash),
    nodeId: String(row.node_id),
    villageId: String(row.village_id),
    retiredAt: Number(row.retired_at),
  };
}
