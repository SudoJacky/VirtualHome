import Database from 'better-sqlite3';
import type { DeviceTelemetryEvent, TwinEvent, TwinSnapshot } from '../shared/types';

export class TwinDatabase {
  private readonly db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        home_id TEXT NOT NULL DEFAULT 'home_001',
        run_id TEXT,
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
    `);
    this.ensureColumn('snapshots', 'home_id', "TEXT NOT NULL DEFAULT 'home_001'");
    this.ensureColumn('snapshots', 'run_id', 'TEXT');
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
    `);
  }

  recordSnapshot(snapshot: TwinSnapshot): void {
    this.db.prepare('INSERT INTO snapshots (home_id, run_id, ts, scenario_id, payload_json) VALUES (?, ?, ?, ?, ?)')
      .run(snapshot.homeId, snapshot.runId, snapshot.simClock.currentTime, snapshot.scenarioId, JSON.stringify(snapshot));
  }

  recordEvents(events: TwinEvent[]): void {
    const insertEvent = this.db.prepare('INSERT INTO events (id, home_id, run_id, sequence, ts, type, scenario_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const insertTelemetry = this.db.prepare('INSERT INTO telemetry (id, home_id, run_id, sequence, ts, scenario_id, room_id, device_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const transaction = this.db.transaction((items: TwinEvent[]) => {
      for (const event of items) {
        insertEvent.run(event.id, event.homeId, event.runId, event.sequence, event.simTime, event.type, event.scenarioId, JSON.stringify(event));
        if (event.type === 'DeviceTelemetry') {
          const telemetry = event as DeviceTelemetryEvent;
          insertTelemetry.run(telemetry.id, telemetry.homeId, telemetry.runId, telemetry.sequence, telemetry.simTime, telemetry.scenarioId, telemetry.roomId, telemetry.deviceId, JSON.stringify(telemetry));
        }
      }
    });
    transaction(events);
  }

  getLatestSnapshot(): TwinSnapshot | null {
    const row = this.db.prepare('SELECT payload_json FROM snapshots ORDER BY id DESC LIMIT 1').get() as { payload_json: string } | undefined;
    return row ? JSON.parse(row.payload_json) as TwinSnapshot : null;
  }

  getRecentEvents(limit: number, runId?: string): TwinEvent[] {
    const rows = runId
      ? this.db.prepare('SELECT payload_json FROM events WHERE run_id = ? ORDER BY ts DESC, sequence DESC LIMIT ?').all(runId, limit) as Array<{ payload_json: string }>
      : this.db.prepare('SELECT payload_json FROM events ORDER BY ts DESC, run_id DESC, sequence DESC LIMIT ?').all(limit) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as TwinEvent);
  }

  getRecentTelemetry(limit: number, runId?: string): DeviceTelemetryEvent[] {
    const rows = runId
      ? this.db.prepare('SELECT payload_json FROM telemetry WHERE run_id = ? ORDER BY ts DESC, sequence DESC LIMIT ?').all(runId, limit) as Array<{ payload_json: string }>
      : this.db.prepare('SELECT payload_json FROM telemetry ORDER BY ts DESC, run_id DESC, sequence DESC LIMIT ?').all(limit) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as DeviceTelemetryEvent);
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
}
