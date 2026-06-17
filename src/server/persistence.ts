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
        ts TEXT NOT NULL,
        scenario_id TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        type TEXT NOT NULL,
        scenario_id TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS telemetry (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        scenario_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);
  }

  recordSnapshot(snapshot: TwinSnapshot): void {
    this.db.prepare('INSERT INTO snapshots (ts, scenario_id, payload_json) VALUES (?, ?, ?)')
      .run(snapshot.simClock.currentTime, snapshot.scenarioId, JSON.stringify(snapshot));
  }

  recordEvents(events: TwinEvent[]): void {
    const insertEvent = this.db.prepare('INSERT OR REPLACE INTO events (id, ts, type, scenario_id, payload_json) VALUES (?, ?, ?, ?, ?)');
    const insertTelemetry = this.db.prepare('INSERT OR REPLACE INTO telemetry (id, ts, scenario_id, room_id, device_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)');
    const transaction = this.db.transaction((items: TwinEvent[]) => {
      for (const event of items) {
        insertEvent.run(event.id, event.simTime, event.type, event.scenarioId, JSON.stringify(event));
        if (event.type === 'DeviceTelemetry') {
          const telemetry = event as DeviceTelemetryEvent;
          insertTelemetry.run(telemetry.id, telemetry.simTime, telemetry.scenarioId, telemetry.roomId, telemetry.deviceId, JSON.stringify(telemetry));
        }
      }
    });
    transaction(events);
  }

  getLatestSnapshot(): TwinSnapshot | null {
    const row = this.db.prepare('SELECT payload_json FROM snapshots ORDER BY id DESC LIMIT 1').get() as { payload_json: string } | undefined;
    return row ? JSON.parse(row.payload_json) as TwinSnapshot : null;
  }

  getRecentEvents(limit: number): TwinEvent[] {
    const rows = this.db.prepare('SELECT payload_json FROM events ORDER BY ts DESC, id DESC LIMIT ?').all(limit) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as TwinEvent);
  }

  getRecentTelemetry(limit: number): DeviceTelemetryEvent[] {
    const rows = this.db.prepare('SELECT payload_json FROM telemetry ORDER BY ts DESC, id DESC LIMIT ?').all(limit) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as DeviceTelemetryEvent);
  }

  close(): void {
    this.db.close();
  }
}
