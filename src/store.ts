import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { KitchenError, type Session, type HistoryEntry } from './types.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

export class KitchenStore {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations(request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, revision INTEGER NOT NULL, operation TEXT NOT NULL, at TEXT NOT NULL, changes TEXT NOT NULL);`);
  }
  get(id: string): Session {
    const row = this.db.prepare('SELECT data FROM sessions WHERE id=?').get(id) as { data: string } | undefined;
    if (!row) throw new KitchenError('SESSION_NOT_FOUND', 'This kitchen session does not exist.');
    return JSON.parse(row.data) as Session;
  }
  save(session: Session, operation: string): void {
    this.db.prepare('INSERT INTO sessions(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(session.id, JSON.stringify(session));
    this.db.prepare('INSERT INTO events(session_id,revision,operation,at,changes) VALUES(?,?,?,?,?)')
      .run(session.id, session.revision, operation, session.updatedAt, JSON.stringify(session.changes));
  }
  execute(requestId: string, operation: string, args: unknown, work: () => Session): Session {
    const fingerprint = createHash('sha256').update(operation + canonical(args)).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const cached = this.db.prepare('SELECT fingerprint,result FROM operations WHERE request_id=?').get(requestId) as
        { fingerprint: string; result: string } | undefined;
      if (cached) {
        if (cached.fingerprint !== fingerprint) throw new KitchenError('IDEMPOTENCY_CONFLICT', 'Use a new requestId for a different mutation.');
        this.db.exec('COMMIT');
        return JSON.parse(cached.result) as Session;
      }
      const result = work();
      this.save(result, operation);
      this.db.prepare('INSERT INTO operations(request_id,fingerprint,result) VALUES(?,?,?)')
        .run(requestId, fingerprint, JSON.stringify(result));
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  eventCount(sessionId: string): number {
    return (this.db.prepare('SELECT count(*) AS n FROM events WHERE session_id=?').get(sessionId) as { n: number }).n;
  }
  history(sessionId: string): HistoryEntry[] {
    const rows = this.db.prepare('SELECT revision,operation,at,changes FROM events WHERE session_id=? ORDER BY id DESC LIMIT 10')
      .all(sessionId) as { revision: number; operation: string; at: string; changes: string }[];
    return rows.reverse().map(row => ({ ...row, changes: JSON.parse(row.changes) as HistoryEntry['changes'] }));
  }
  close(): void { this.db.close(); }
}
