import Database from 'better-sqlite3';
import type { DeviceTelemetryEvent, TwinEvent, TwinSnapshot } from '../shared/types';

export interface TwinDatabaseOptions {
  snapshotIntervalEvents?: number;
}

export interface IdempotencyRecord<T = unknown> {
  requestHash: string;
  response: T;
}

export interface AccessAuditInput {
  method: string;
  endpoint: string;
  privacy: 'admin' | 'public';
  runId: string | null;
  sequence: number | null;
  details?: Record<string, unknown>;
}

export interface AccessAuditRecord extends AccessAuditInput {
  id: number;
  ts: string;
}

export class TwinDatabase {
  private readonly db: Database.Database;
  private readonly snapshotIntervalEvents: number;

  constructor(filename: string, options: TwinDatabaseOptions = {}) {
    this.snapshotIntervalEvents = Math.max(1, options.snapshotIntervalEvents ?? 50);
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        home_id TEXT NOT NULL DEFAULT 'home_001',
        run_id TEXT,
        covered_sequence INTEGER NOT NULL DEFAULT 0,
        ts TEXT NOT NULL,
        scenario_id TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        home_id TEXT NOT NULL DEFAULT 'home_001',
        run_id TEXT,
        sequence INTEGER NOT NULL DEFAULT 0,
        ts TEXT NOT NULL,
        type TEXT NOT NULL,
        scenario_id TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS telemetry (
        id TEXT PRIMARY KEY,
        home_id TEXT NOT NULL DEFAULT 'home_001',
        run_id TEXT,
        sequence INTEGER NOT NULL DEFAULT 0,
        ts TEXT NOT NULL,
        scenario_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS idempotency_records (
        idempotency_key TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        ts TEXT NOT NULL,
        response_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS access_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        method TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        privacy_mode TEXT NOT NULL,
        run_id TEXT,
        sequence INTEGER,
        details_json TEXT NOT NULL
      );
    `);
    this.ensureColumn('snapshots', 'home_id', "TEXT NOT NULL DEFAULT 'home_001'");
    this.ensureColumn('snapshots', 'run_id', 'TEXT');
    this.ensureColumn('snapshots', 'covered_sequence', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('events', 'home_id', "TEXT NOT NULL DEFAULT 'home_001'");
    this.ensureColumn('events', 'run_id', 'TEXT');
    this.ensureColumn('events', 'sequence', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('telemetry', 'home_id', "TEXT NOT NULL DEFAULT 'home_001'");
    this.ensureColumn('telemetry', 'run_id', 'TEXT');
    this.ensureColumn('telemetry', 'sequence', 'INTEGER NOT NULL DEFAULT 0');
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS events_home_run_sequence_idx
        ON events(home_id, run_id, sequence);

      CREATE INDEX IF NOT EXISTS snapshots_home_run_idx
        ON snapshots(home_id, run_id, id);

      CREATE INDEX IF NOT EXISTS telemetry_home_run_idx
        ON telemetry(home_id, run_id, sequence);

      CREATE INDEX IF NOT EXISTS access_audit_ts_idx
        ON access_audit(ts, id);
    `);
  }

  recordSnapshot(snapshot: TwinSnapshot): void {
    this.insertSnapshot(snapshot);
  }

  recordEvents(events: TwinEvent[]): void {
    const transaction = this.db.transaction((items: TwinEvent[]) => {
      this.insertEvents(items);
    });
    transaction(events);
  }

  recordUpdate(snapshot: TwinSnapshot, events: TwinEvent[]): boolean {
    const transaction = this.db.transaction((nextSnapshot: TwinSnapshot, nextEvents: TwinEvent[]) => {
      const shouldRecordSnapshot = this.shouldRecordSnapshot(nextSnapshot);
      if (shouldRecordSnapshot) {
        this.insertSnapshot(nextSnapshot);
      }
      this.insertEvents(nextEvents);
      return shouldRecordSnapshot;
    });
    return transaction(snapshot, events) as boolean;
  }

  getLatestSnapshot(): TwinSnapshot | null {
    const row = this.db.prepare('SELECT payload_json FROM snapshots ORDER BY id DESC LIMIT 1').get() as { payload_json: string } | undefined;
    return row ? JSON.parse(row.payload_json) as TwinSnapshot : null;
  }

  getLatestSnapshotCheckpoint(): { snapshot: TwinSnapshot; coveredSequence: number } | null {
    const row = this.db.prepare('SELECT covered_sequence, payload_json FROM snapshots ORDER BY id DESC LIMIT 1').get() as { covered_sequence: number; payload_json: string } | undefined;
    return row ? { snapshot: JSON.parse(row.payload_json) as TwinSnapshot, coveredSequence: row.covered_sequence } : null;
  }

  getSnapshotCount(runId?: string): number {
    const row = runId
      ? this.db.prepare('SELECT COUNT(*) AS count FROM snapshots WHERE run_id = ?').get(runId) as { count: number }
      : this.db.prepare('SELECT COUNT(*) AS count FROM snapshots').get() as { count: number };
    return row.count;
  }

  getRecentEvents(limit: number, runId?: string): TwinEvent[] {
    const rows = runId
      ? this.db.prepare('SELECT payload_json FROM events WHERE run_id = ? ORDER BY ts DESC, sequence DESC LIMIT ?').all(runId, limit) as Array<{ payload_json: string }>
      : this.db.prepare('SELECT payload_json FROM events ORDER BY ts DESC, run_id DESC, sequence DESC LIMIT ?').all(limit) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as TwinEvent);
  }

  getEventsForRun(runId: string): TwinEvent[] {
    const rows = this.db.prepare('SELECT payload_json FROM events WHERE run_id = ? ORDER BY sequence ASC').all(runId) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as TwinEvent);
  }

  getEventsAfter(runId: string, sequence: number, limit = 500): TwinEvent[] {
    const rows = this.db.prepare('SELECT payload_json FROM events WHERE run_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?')
      .all(runId, sequence, limit) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as TwinEvent);
  }

  getRecentTelemetry(limit: number, runId?: string): DeviceTelemetryEvent[] {
    const rows = runId
      ? this.db.prepare('SELECT payload_json FROM telemetry WHERE run_id = ? ORDER BY ts DESC, sequence DESC LIMIT ?').all(runId, limit) as Array<{ payload_json: string }>
      : this.db.prepare('SELECT payload_json FROM telemetry ORDER BY ts DESC, run_id DESC, sequence DESC LIMIT ?').all(limit) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as DeviceTelemetryEvent);
  }

  getIdempotencyRecord<T = unknown>(key: string): IdempotencyRecord<T> | null {
    const row = this.db.prepare('SELECT request_hash, response_json FROM idempotency_records WHERE idempotency_key = ?')
      .get(key) as { request_hash: string; response_json: string } | undefined;
    return row ? {
      requestHash: row.request_hash,
      response: JSON.parse(row.response_json) as T
    } : null;
  }

  recordIdempotencyResponse(key: string, requestHash: string, response: unknown): void {
    this.db.prepare('INSERT INTO idempotency_records (idempotency_key, request_hash, ts, response_json) VALUES (?, ?, ?, ?)')
      .run(key, requestHash, new Date().toISOString(), JSON.stringify(response));
  }

  recordAccessAudit(record: AccessAuditInput): void {
    this.db.prepare(`
      INSERT INTO access_audit (ts, method, endpoint, privacy_mode, run_id, sequence, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      new Date().toISOString(),
      record.method,
      record.endpoint,
      record.privacy,
      record.runId,
      record.sequence,
      JSON.stringify(record.details ?? {})
    );
  }

  getRecentAccessAudit(limit: number): AccessAuditRecord[] {
    const rows = this.db.prepare(`
      SELECT id, ts, method, endpoint, privacy_mode, run_id, sequence, details_json
      FROM access_audit
      ORDER BY id DESC
      LIMIT ?
    `).all(limit) as Array<{
      id: number;
      ts: string;
      method: string;
      endpoint: string;
      privacy_mode: 'admin' | 'public';
      run_id: string | null;
      sequence: number | null;
      details_json: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      ts: row.ts,
      method: row.method,
      endpoint: row.endpoint,
      privacy: row.privacy_mode,
      runId: row.run_id,
      sequence: row.sequence,
      details: JSON.parse(row.details_json) as Record<string, unknown>
    }));
  }

  close(): void {
    this.db.close();
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((item) => item.name === column)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  private insertSnapshot(snapshot: TwinSnapshot): void {
    this.db.prepare('INSERT INTO snapshots (home_id, run_id, covered_sequence, ts, scenario_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(snapshot.homeId, snapshot.runId, snapshot.simClock.sequence, snapshot.simClock.currentTime, snapshot.scenarioId, JSON.stringify(snapshot));
  }

  private shouldRecordSnapshot(snapshot: TwinSnapshot): boolean {
    const checkpoint = this.getLatestSnapshotCheckpointForRun(snapshot.homeId, snapshot.runId);
    if (!checkpoint) {
      return true;
    }
    return snapshot.simClock.sequence - checkpoint.coveredSequence >= this.snapshotIntervalEvents;
  }

  private getLatestSnapshotCheckpointForRun(homeId: string, runId: string): { coveredSequence: number } | null {
    const row = this.db.prepare('SELECT covered_sequence FROM snapshots WHERE home_id = ? AND run_id = ? ORDER BY id DESC LIMIT 1')
      .get(homeId, runId) as { covered_sequence: number } | undefined;
    return row ? { coveredSequence: row.covered_sequence } : null;
  }

  private insertEvents(events: TwinEvent[]): void {
    const insertEvent = this.db.prepare('INSERT INTO events (id, home_id, run_id, sequence, ts, type, scenario_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const insertTelemetry = this.db.prepare('INSERT INTO telemetry (id, home_id, run_id, sequence, ts, scenario_id, room_id, device_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const event of events) {
      insertEvent.run(event.id, event.homeId, event.runId, event.sequence, event.simTime, event.type, event.scenarioId, JSON.stringify(event));
      if (event.type === 'DeviceTelemetry') {
        const telemetry = event as DeviceTelemetryEvent;
        insertTelemetry.run(telemetry.id, telemetry.homeId, telemetry.runId, telemetry.sequence, telemetry.simTime, telemetry.scenarioId, telemetry.roomId, telemetry.deviceId, JSON.stringify(telemetry));
      }
    }
  }
}
