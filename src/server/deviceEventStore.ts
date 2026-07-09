import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { DeviceValueEvent } from './deviceEventStream';

export type DeviceEventQueryCreatedBy = 'agent' | 'system' | 'human_reviewer';
export type DeviceEventAggregateGroupBy = 'roomId' | 'deviceId' | 'deviceType' | 'field' | 'sourceEventType';

export interface DeviceEventImportInput {
  inputPath: string;
  inputSha256: string;
  schemaVersion: number;
  events: DeviceValueEvent[];
}

export interface StoredDeviceEvent extends DeviceValueEvent {
  importId: string;
  payload: DeviceValueEvent;
}

export interface DeviceEventListQuery {
  homeId?: string;
  runId?: string;
  fromSequence?: number;
  toSequence?: number;
  fromSimTime?: string;
  toSimTime?: string;
  roomId?: string;
  deviceId?: string;
  deviceType?: string;
  field?: string;
  sourceEventType?: DeviceValueEvent['sourceEventType'];
  sourceEventId?: string;
  q?: string;
  limit?: number;
}

export interface DeviceEventAroundSourceQuery {
  sourceEventId: string;
  homeId?: string;
  runId?: string;
  windowMinutes?: number;
  limit?: number;
}

export interface DeviceEventAggregateQuery extends Omit<DeviceEventListQuery, 'q'> {
  groupBy: DeviceEventAggregateGroupBy;
}

export interface DeviceEventQueryAuditInput {
  id?: string;
  homeId: string;
  runId?: string | null;
  query: Record<string, unknown>;
  resultCount: number;
  summary?: string | null;
  createdBy: DeviceEventQueryCreatedBy;
}

export interface DeviceEventQueryAudit {
  id: string;
  homeId: string;
  runId: string | null;
  query: Record<string, unknown>;
  resultCount: number;
  summary: string | null;
  createdBy: DeviceEventQueryCreatedBy;
  createdAt: string;
}

export interface DeviceEventRebuildResult {
  importId: string;
  homeId: string;
  runId: string;
  eventCount: number;
}

export class DeviceEventDatabase {
  private readonly db: Database.Database;

  constructor(filename: string, options: { readonly?: boolean; fileMustExist?: boolean } = {}) {
    if (!options.readonly) {
      mkdirSync(path.dirname(filename), { recursive: true });
    }
    this.db = new Database(filename, options);
    if (!options.readonly) {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.pragma('foreign_keys = ON');
    if (!options.readonly) {
      this.ensureSchema();
    }
  }

  ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS device_event_imports (
        id TEXT PRIMARY KEY,
        input_path TEXT NOT NULL,
        input_sha256 TEXT NOT NULL,
        home_id TEXT,
        run_id TEXT,
        event_count INTEGER NOT NULL,
        imported_at TEXT NOT NULL,
        schema_version INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS device_value_events (
        id TEXT PRIMARY KEY,
        import_id TEXT NOT NULL,
        source_event_id TEXT NOT NULL,
        source_event_type TEXT NOT NULL,
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        ts TEXT NOT NULL,
        sim_time TEXT NOT NULL,
        home_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        device_type TEXT NOT NULL,
        field TEXT NOT NULL,
        value_json TEXT NOT NULL,
        search_text TEXT NOT NULL,
        payload_json TEXT NOT NULL,

        FOREIGN KEY (import_id) REFERENCES device_event_imports(id) ON DELETE CASCADE,
        CHECK (source_event_type IN ('DeviceTelemetry', 'DeviceStateChanged'))
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS device_event_fts USING fts5(
        event_id UNINDEXED,
        home_id UNINDEXED,
        run_id UNINDEXED,
        search_text,
        tokenize = 'unicode61'
      );

      CREATE TABLE IF NOT EXISTS device_event_queries (
        id TEXT PRIMARY KEY,
        home_id TEXT NOT NULL,
        run_id TEXT,
        query_json TEXT NOT NULL,
        result_count INTEGER NOT NULL,
        summary TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,

        CHECK (created_by IN ('agent', 'system', 'human_reviewer'))
      );

      CREATE INDEX IF NOT EXISTS device_value_events_run_sequence_idx
        ON device_value_events(home_id, run_id, sequence);
      CREATE INDEX IF NOT EXISTS device_value_events_time_idx
        ON device_value_events(home_id, run_id, sim_time);
      CREATE INDEX IF NOT EXISTS device_value_events_room_time_idx
        ON device_value_events(home_id, run_id, room_id, sim_time);
      CREATE INDEX IF NOT EXISTS device_value_events_device_field_time_idx
        ON device_value_events(home_id, run_id, device_id, field, sim_time);
      CREATE INDEX IF NOT EXISTS device_value_events_source_idx
        ON device_value_events(source_event_id);
    `);
  }

  rebuildFromEvents(input: DeviceEventImportInput): DeviceEventRebuildResult {
    const normalized = validateEvents(input.events);
    const importId = `import_${new Date().toISOString().replace(/[^0-9]/g, '')}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const importedAt = new Date().toISOString();
    const homeId = normalized[0].homeId;
    const runId = normalized[0].runId;

    console.info('[device-events] rebuild_start', JSON.stringify({
      operation: 'device_event_rebuild',
      inputPath: input.inputPath,
      importId,
      homeId,
      runId,
      eventCount: normalized.length
    }));

    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM device_event_fts').run();
      this.db.prepare('DELETE FROM device_value_events').run();
      this.db.prepare('DELETE FROM device_event_imports').run();
      this.db.prepare('DELETE FROM device_event_queries').run();

      this.db.prepare(`
        INSERT INTO device_event_imports
          (id, input_path, input_sha256, home_id, run_id, event_count, imported_at, schema_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(importId, input.inputPath, input.inputSha256, homeId, runId, normalized.length, importedAt, input.schemaVersion);

      const insertEvent = this.db.prepare(`
        INSERT INTO device_value_events
          (id, import_id, source_event_id, source_event_type, run_id, sequence, ts, sim_time, home_id, room_id, device_id, device_type, field, value_json, search_text, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertFts = this.db.prepare(`
        INSERT INTO device_event_fts (event_id, home_id, run_id, search_text)
        VALUES (?, ?, ?, ?)
      `);

      for (const event of normalized) {
        const searchText = buildSearchText(event);
        insertEvent.run(
          event.id,
          importId,
          event.sourceEventId,
          event.sourceEventType,
          event.runId,
          event.sequence,
          event.ts,
          event.simTime,
          event.homeId,
          event.roomId,
          event.deviceId,
          event.deviceType,
          event.field,
          JSON.stringify(event.value),
          searchText,
          JSON.stringify(event)
        );
        insertFts.run(event.id, event.homeId, event.runId, searchText);
      }
    });
    transaction();

    console.info('[device-events] rebuild_complete', JSON.stringify({
      operation: 'device_event_rebuild',
      inputPath: input.inputPath,
      importId,
      homeId,
      runId,
      eventCount: normalized.length
    }));

    return { importId, homeId, runId, eventCount: normalized.length };
  }

  listEvents(query: DeviceEventListQuery = {}): { items: StoredDeviceEvent[] } {
    const { join, where, params } = buildEventQuery(query);
    params.push(query.limit ?? 100);
    const rows = this.db.prepare(`
      SELECT e.*
      FROM device_value_events e
      ${join}
      ${where}
      ORDER BY e.sequence ASC, e.id ASC
      LIMIT ?
    `).all(...params) as DeviceValueEventRow[];
    return { items: rows.map(toStoredDeviceEvent) };
  }

  getEvent(id: string): StoredDeviceEvent | null {
    const row = this.db.prepare('SELECT * FROM device_value_events WHERE id = ?').get(id) as DeviceValueEventRow | undefined;
    return row ? toStoredDeviceEvent(row) : null;
  }

  getEventsBySourceEventId(sourceEventId: string, query: Pick<DeviceEventListQuery, 'homeId' | 'runId' | 'limit'> = {}): { items: StoredDeviceEvent[] } {
    return this.listEvents({
      ...query,
      limit: query.limit ?? 100,
      q: undefined,
      sourceEventType: undefined,
      fromSequence: undefined,
      toSequence: undefined,
      fromSimTime: undefined,
      toSimTime: undefined,
      roomId: undefined,
      deviceId: undefined,
      deviceType: undefined,
      field: undefined,
      sourceEventId
    });
  }

  getEventsAroundSource(query: DeviceEventAroundSourceQuery): { source: StoredDeviceEvent | null; items: StoredDeviceEvent[] } {
    const sourceItems = this.getEventsBySourceEventId(query.sourceEventId, {
      homeId: query.homeId,
      runId: query.runId,
      limit: 1
    }).items;
    const source = sourceItems[0] ?? null;
    if (!source) {
      return { source: null, items: [] };
    }
    const windowMinutes = query.windowMinutes ?? 30;
    const sourceTime = parseSimTimeMs(source.simTime);
    if (Number.isNaN(sourceTime)) {
      const sequenceWindow = Math.max(1, Math.round(windowMinutes));
      return {
        source,
        items: this.listEvents({
          homeId: source.homeId,
          runId: source.runId,
          fromSequence: source.sequence - sequenceWindow,
          toSequence: source.sequence + sequenceWindow,
          limit: query.limit ?? 200
        }).items
      };
    }
    return {
      source,
      items: this.listEvents({
        homeId: source.homeId,
        runId: source.runId,
        fromSimTime: formatSimTime(sourceTime - windowMinutes * 60_000),
        toSimTime: formatSimTime(sourceTime + windowMinutes * 60_000),
        limit: query.limit ?? 200
      }).items
    };
  }

  aggregateEvents(query: DeviceEventAggregateQuery): { items: Array<{ key: string; count: number }> } {
    const column = aggregateColumn(query.groupBy);
    const { join, where, params } = buildEventQuery(query);
    const rows = this.db.prepare(`
      SELECT e.${column} AS key, COUNT(*) AS count
      FROM device_value_events e
      ${join}
      ${where}
      GROUP BY e.${column}
      ORDER BY count DESC, key ASC
      LIMIT ?
    `).all(...params, query.limit ?? 100) as Array<{ key: string; count: number }>;
    return { items: rows };
  }

  recordQueryAudit(input: DeviceEventQueryAuditInput): DeviceEventQueryAudit {
    const id = input.id ?? `query_${new Date().toISOString().replace(/[^0-9]/g, '')}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO device_event_queries
        (id, home_id, run_id, query_json, result_count, summary, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.homeId,
      input.runId ?? null,
      JSON.stringify(input.query),
      input.resultCount,
      input.summary ?? null,
      input.createdBy,
      createdAt
    );
    console.info('[device-events] query_audit_written', JSON.stringify({
      operation: 'device_event_query_audit',
      queryId: id,
      homeId: input.homeId,
      runId: input.runId ?? null,
      resultCount: input.resultCount,
      createdBy: input.createdBy
    }));
    return {
      id,
      homeId: input.homeId,
      runId: input.runId ?? null,
      query: input.query,
      resultCount: input.resultCount,
      summary: input.summary ?? null,
      createdBy: input.createdBy,
      createdAt
    };
  }

  getQuery(id: string): DeviceEventQueryAudit | null {
    const row = this.db.prepare('SELECT * FROM device_event_queries WHERE id = ?').get(id) as DeviceEventQueryRow | undefined;
    return row ? toQueryAudit(row) : null;
  }

  listQueries(query: { homeId?: string; runId?: string; limit?: number } = {}): { items: DeviceEventQueryAudit[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.homeId) {
      clauses.push('home_id = ?');
      params.push(query.homeId);
    }
    if (query.runId) {
      clauses.push('run_id = ?');
      params.push(query.runId);
    }
    params.push(query.limit ?? 100);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT *
      FROM device_event_queries
      ${where}
      ORDER BY created_at DESC, id ASC
      LIMIT ?
    `).all(...params) as DeviceEventQueryRow[];
    return { items: rows.map(toQueryAudit) };
  }

  hasQuery(id: string, homeId: string, runId?: string | null): boolean {
    const row = runId
      ? this.db.prepare('SELECT 1 AS found FROM device_event_queries WHERE id = ? AND home_id = ? AND run_id = ? LIMIT 1').get(id, homeId, runId)
      : this.db.prepare('SELECT 1 AS found FROM device_event_queries WHERE id = ? AND home_id = ? LIMIT 1').get(id, homeId);
    return Boolean(row);
  }

  close(): void {
    this.db.close();
  }
}

interface DeviceValueEventRow {
  id: string;
  import_id: string;
  source_event_id: string;
  source_event_type: DeviceValueEvent['sourceEventType'];
  run_id: string;
  sequence: number;
  ts: string;
  sim_time: string;
  home_id: string;
  room_id: string;
  device_id: string;
  device_type: string;
  field: string;
  value_json: string;
  payload_json: string;
}

interface DeviceEventQueryRow {
  id: string;
  home_id: string;
  run_id: string | null;
  query_json: string;
  result_count: number;
  summary: string | null;
  created_by: DeviceEventQueryCreatedBy;
  created_at: string;
}

function buildEventQuery(query: DeviceEventListQuery): {
  join: string;
  where: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let join = '';
  if (query.q?.trim()) {
    join = 'JOIN device_event_fts ON device_event_fts.event_id = e.id';
    clauses.push('device_event_fts MATCH ?');
    params.push(toFtsQuery(query.q));
  }
  addClause(clauses, params, 'e.home_id = ?', query.homeId);
  addClause(clauses, params, 'e.run_id = ?', query.runId);
  addClause(clauses, params, 'e.sequence >= ?', query.fromSequence);
  addClause(clauses, params, 'e.sequence <= ?', query.toSequence);
  addClause(clauses, params, 'e.sim_time >= ?', query.fromSimTime);
  addClause(clauses, params, 'e.sim_time <= ?', query.toSimTime);
  addClause(clauses, params, 'e.room_id = ?', query.roomId);
  addClause(clauses, params, 'e.device_id = ?', query.deviceId);
  addClause(clauses, params, 'e.device_type = ?', query.deviceType);
  addClause(clauses, params, 'e.field = ?', query.field);
  addClause(clauses, params, 'e.source_event_type = ?', query.sourceEventType);
  addClause(clauses, params, 'e.source_event_id = ?', query.sourceEventId);
  return {
    join,
    where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  };
}

function addClause(clauses: string[], params: unknown[], sql: string, value: unknown): void {
  if (value === undefined || value === null || value === '') {
    return;
  }
  clauses.push(sql);
  params.push(value);
}

function validateEvents(events: DeviceValueEvent[]): DeviceValueEvent[] {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('Device Event rebuild requires a non-empty events array');
  }
  const ids = new Set<string>();
  const normalized = events.map((event, index) => validateEvent(event, index));
  for (const event of normalized) {
    if (ids.has(event.id)) {
      throw new Error(`Duplicate device event id in import: ${event.id}`);
    }
    ids.add(event.id);
  }
  return normalized.sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
}

function validateEvent(event: DeviceValueEvent, index: number): DeviceValueEvent {
  const required = [
    'id',
    'sourceEventId',
    'sourceEventType',
    'runId',
    'sequence',
    'ts',
    'simTime',
    'homeId',
    'roomId',
    'deviceId',
    'deviceType',
    'field'
  ] as const;
  for (const field of required) {
    if (event[field] === undefined || event[field] === null || event[field] === '') {
      throw new Error(`Device event at index ${index} is missing ${field}`);
    }
  }
  if (event.sourceEventType !== 'DeviceTelemetry' && event.sourceEventType !== 'DeviceStateChanged') {
    throw new Error(`Device event ${event.id} has unsupported sourceEventType: ${event.sourceEventType}`);
  }
  if (!Number.isInteger(event.sequence)) {
    throw new Error(`Device event ${event.id} sequence must be an integer`);
  }
  return event;
}

function buildSearchText(event: DeviceValueEvent): string {
  const valueJson = JSON.stringify(event.value);
  return [
    event.id,
    event.sourceEventId,
    event.sourceEventType,
    event.runId,
    event.homeId,
    event.roomId,
    event.deviceId,
    event.deviceType,
    event.deviceId.replaceAll('_', ' '),
    event.deviceType.replaceAll('_', ' '),
    event.field,
    valueJson,
    JSON.stringify(event)
  ].join(' ');
}

function toStoredDeviceEvent(row: DeviceValueEventRow): StoredDeviceEvent {
  const payload = JSON.parse(row.payload_json) as DeviceValueEvent;
  return {
    ...payload,
    importId: row.import_id,
    id: row.id,
    sourceEventId: row.source_event_id,
    sourceEventType: row.source_event_type,
    runId: row.run_id,
    sequence: row.sequence,
    ts: row.ts,
    simTime: row.sim_time,
    homeId: row.home_id,
    roomId: row.room_id,
    deviceId: row.device_id,
    deviceType: row.device_type,
    field: row.field,
    value: JSON.parse(row.value_json) as DeviceValueEvent['value'],
    payload
  };
}

function toQueryAudit(row: DeviceEventQueryRow): DeviceEventQueryAudit {
  return {
    id: row.id,
    homeId: row.home_id,
    runId: row.run_id,
    query: JSON.parse(row.query_json) as Record<string, unknown>,
    resultCount: row.result_count,
    summary: row.summary,
    createdBy: row.created_by,
    createdAt: row.created_at
  };
}

function aggregateColumn(groupBy: DeviceEventAggregateGroupBy): string {
  if (groupBy === 'roomId') return 'room_id';
  if (groupBy === 'deviceId') return 'device_id';
  if (groupBy === 'deviceType') return 'device_type';
  if (groupBy === 'field') return 'field';
  return 'source_event_type';
}

function toFtsQuery(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/["*]/g, '').trim())
    .filter(Boolean)
    .map((term) => `"${term}"*`)
    .join(' AND ');
}

function parseSimTimeMs(simTime: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(simTime);
  if (!match) {
    return Number.NaN;
  }
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0)
  );
}

function formatSimTime(timeMs: number): string {
  return new Date(timeMs).toISOString().slice(0, 19);
}
