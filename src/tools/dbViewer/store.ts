import Database from 'better-sqlite3';
import type {
  DbViewerAgentProfileEntryDetail,
  DbViewerAgentProfileEntrySummary,
  DbViewerAgentProfileEvent,
  DbViewerAgentProfileSource,
  DbViewerClaimIndex,
  DbViewerDeviceEvent,
  DbViewerDeviceEventQueryAudit,
  DbViewerHealth,
  DbViewerHomeMemoryItem,
  DbViewerListResponse,
  DbViewerRun,
  DbViewerSourceResolution,
  DbViewerSourceType,
  DbViewerTimeWindow
} from './types';

export interface DbViewerStoreOptions {
  homeMemoryDatabasePath: string;
  agentProfileDatabasePath: string;
  deviceEventsDatabasePath?: string;
}

export interface DbViewerEntryQuery {
  homeId?: string;
  status?: string;
  entryType?: string;
  subjectType?: string;
  text?: string;
  limit?: number;
}

export interface DbViewerSearchQuery {
  homeId: string;
  q: string;
  limit?: number;
}

export interface DbViewerHomeMemoryQuery {
  homeId: string;
  runId: string;
  limit?: number;
  text?: string;
}

export interface DbViewerDeviceEventQuery {
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
  sourceEventType?: string;
  sourceEventId?: string;
  q?: string;
  limit?: number;
}

export class DbViewerStore {
  private readonly homeMemoryDb: Database.Database;
  private readonly agentProfileDb: Database.Database;
  private readonly deviceEventsDb: Database.Database | null;
  private readonly homeMemoryDatabasePath: string;
  private readonly agentProfileDatabasePath: string;
  private readonly deviceEventsDatabasePath: string | null;

  constructor(options: DbViewerStoreOptions) {
    this.homeMemoryDatabasePath = options.homeMemoryDatabasePath;
    this.agentProfileDatabasePath = options.agentProfileDatabasePath;
    this.deviceEventsDatabasePath = options.deviceEventsDatabasePath ?? null;
    this.homeMemoryDb = new Database(options.homeMemoryDatabasePath, { readonly: true, fileMustExist: true });
    this.agentProfileDb = new Database(options.agentProfileDatabasePath, { readonly: true, fileMustExist: true });
    this.deviceEventsDb = options.deviceEventsDatabasePath
      ? new Database(options.deviceEventsDatabasePath, { readonly: true, fileMustExist: true })
      : null;
  }

  getHealth(): DbViewerHealth {
    const missing = [
      ...missingTables(this.homeMemoryDb, [
        'home_memory_runs',
        'home_memory_evidence',
        'home_memory_profile_hypotheses',
        'home_memory_portrait_sections'
      ]),
      ...missingTables(this.agentProfileDb, [
        'agent_profile_entries',
        'agent_profile_sources',
        'agent_profile_claim_index',
        'agent_profile_time_windows',
        'agent_profile_fts',
        'agent_profile_entry_events'
      ]),
      ...(this.deviceEventsDb
        ? missingTables(this.deviceEventsDb, [
          'device_event_imports',
          'device_value_events',
          'device_event_fts',
          'device_event_queries'
        ])
        : [])
    ];
    return {
      status: missing.length === 0 ? 'ok' : 'unhealthy',
      homeMemoryDatabasePath: this.homeMemoryDatabasePath,
      agentProfileDatabasePath: this.agentProfileDatabasePath,
      deviceEventsDatabasePath: this.deviceEventsDatabasePath,
      deviceEventsAvailable: Boolean(this.deviceEventsDb),
      missingTables: missing
    };
  }

  listAgentProfileEntries(query: DbViewerEntryQuery = {}): DbViewerListResponse<DbViewerAgentProfileEntrySummary> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.homeId) {
      clauses.push('home_id = ?');
      params.push(query.homeId);
    }
    if (query.status) {
      clauses.push('status = ?');
      params.push(query.status);
    }
    if (query.entryType) {
      clauses.push('entry_type = ?');
      params.push(query.entryType);
    }
    if (query.subjectType) {
      clauses.push('subject_type = ?');
      params.push(query.subjectType);
    }
    if (query.text?.trim()) {
      clauses.push('(title LIKE ? OR summary LIKE ? OR content_json LIKE ?)');
      const like = `%${query.text.trim()}%`;
      params.push(like, like, like);
    }
    params.push(query.limit ?? 100);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.agentProfileDb.prepare(`
      SELECT *
      FROM agent_profile_entries
      ${where}
      ORDER BY updated_at DESC, id ASC
      LIMIT ?
    `).all(...params) as AgentProfileEntryRow[];
    return { items: rows.map(toEntrySummary) };
  }

  searchAgentProfileEntries(query: DbViewerSearchQuery): DbViewerListResponse<DbViewerAgentProfileEntrySummary> {
    const match = toFtsQuery(query.q);
    if (!match) {
      return { items: [] };
    }
    const rows = this.agentProfileDb.prepare(`
      SELECT e.*
      FROM agent_profile_fts f
      JOIN agent_profile_entries e ON e.id = f.entry_id
      WHERE f.home_id = ? AND agent_profile_fts MATCH ?
      ORDER BY bm25(agent_profile_fts) ASC
      LIMIT ?
    `).all(query.homeId, match, query.limit ?? 25) as AgentProfileEntryRow[];
    return { items: rows.map((row) => ({ ...toEntrySummary(row), matchChannels: ['fts'] })) };
  }

  getAgentProfileEntry(entryId: string): DbViewerAgentProfileEntryDetail | null {
    const row = this.agentProfileDb.prepare('SELECT * FROM agent_profile_entries WHERE id = ?').get(entryId) as AgentProfileEntryRow | undefined;
    if (!row) {
      return null;
    }
    return {
      ...toEntrySummary(row),
      content: JSON.parse(row.content_json) as Record<string, unknown>,
      sources: this.listAgentProfileSources(entryId),
      events: this.listAgentProfileEvents(entryId),
      claimIndex: this.getClaimIndex(entryId),
      timeWindows: this.listTimeWindows(entryId)
    };
  }

  listAgentProfileSources(entryId: string): DbViewerAgentProfileSource[] {
    const rows = this.agentProfileDb.prepare(`
      SELECT *
      FROM agent_profile_sources
      WHERE entry_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(entryId) as AgentProfileSourceRow[];
    return rows.map(toSource);
  }

  listAgentProfileEvents(entryId: string): DbViewerAgentProfileEvent[] {
    const rows = this.agentProfileDb.prepare(`
      SELECT *
      FROM agent_profile_entry_events
      WHERE entry_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(entryId) as AgentProfileEventRow[];
    return rows.map((row) => ({
      id: row.id,
      entryId: row.entry_id,
      eventType: row.event_type,
      actor: row.actor,
      before: parseNullableJson(row.before_json),
      after: parseNullableJson(row.after_json),
      reason: row.reason,
      createdAt: row.created_at
    }));
  }

  listHomeMemoryRuns(query: { homeId?: string } = {}): DbViewerListResponse<DbViewerRun> {
    const rows = query.homeId
      ? this.homeMemoryDb.prepare(`
        SELECT home_id, run_id, covered_sequence, reducer_version, schema_version, materialized_at
        FROM home_memory_runs
        WHERE home_id = ?
        ORDER BY materialized_at DESC
      `).all(query.homeId) as HomeMemoryRunRow[]
      : this.homeMemoryDb.prepare(`
        SELECT home_id, run_id, covered_sequence, reducer_version, schema_version, materialized_at
        FROM home_memory_runs
        ORDER BY materialized_at DESC
      `).all() as HomeMemoryRunRow[];
    return { items: rows.map(toRun) };
  }

  listHomeMemoryEvidence(query: DbViewerHomeMemoryQuery): DbViewerListResponse<DbViewerHomeMemoryItem> {
    const clauses = ['home_id = ?', 'run_id = ?'];
    const params: unknown[] = [query.homeId, query.runId];
    if (query.text?.trim()) {
      clauses.push('(id LIKE ? OR room_id LIKE ? OR device_id LIKE ? OR field LIKE ? OR evidence_category LIKE ? OR payload_json LIKE ?)');
      const like = `%${query.text.trim()}%`;
      params.push(like, like, like, like, like, like);
    }
    params.push(query.limit ?? 100);
    const rows = this.homeMemoryDb.prepare(`
      SELECT id, home_id, run_id, sequence, sim_time, room_id, device_id, field, evidence_category, profile_weight, payload_json
      FROM home_memory_evidence
      WHERE ${clauses.join(' AND ')}
      ORDER BY sequence DESC
      LIMIT ?
    `).all(...params) as HomeMemoryEvidenceRow[];
    return { items: rows.map(toEvidence) };
  }

  listHomeMemoryHypotheses(query: DbViewerHomeMemoryQuery): DbViewerListResponse<DbViewerHomeMemoryItem> {
    const clauses = ['home_id = ?', 'run_id = ?'];
    const params: unknown[] = [query.homeId, query.runId];
    if (query.text?.trim()) {
      clauses.push('(id LIKE ? OR type LIKE ? OR summary LIKE ? OR payload_json LIKE ?)');
      const like = `%${query.text.trim()}%`;
      params.push(like, like, like, like);
    }
    params.push(query.limit ?? 100);
    const rows = this.homeMemoryDb.prepare(`
      SELECT id, home_id, run_id, type, summary, confidence, updated_at, evidence_ids_json, payload_json
      FROM home_memory_profile_hypotheses
      WHERE ${clauses.join(' AND ')}
      ORDER BY confidence DESC, id ASC
      LIMIT ?
    `).all(...params) as HomeMemoryHypothesisRow[];
    return { items: rows.map(toHypothesis) };
  }

  listHomeMemoryPortraitSections(query: Omit<DbViewerHomeMemoryQuery, 'limit'>): DbViewerListResponse<DbViewerHomeMemoryItem> {
    const clauses = ['home_id = ?', 'run_id = ?'];
    const params: unknown[] = [query.homeId, query.runId];
    if (query.text?.trim()) {
      clauses.push('(id LIKE ? OR section_id LIKE ? OR summary LIKE ? OR payload_json LIKE ?)');
      const like = `%${query.text.trim()}%`;
      params.push(like, like, like, like);
    }
    const rows = this.homeMemoryDb.prepare(`
      SELECT id, home_id, run_id, section_id, summary, confidence, evidence_ids_json, payload_json
      FROM home_memory_portrait_sections
      WHERE ${clauses.join(' AND ')}
      ORDER BY section_id ASC
    `).all(...params) as HomeMemoryPortraitRow[];
    return { items: rows.map(toPortraitSection) };
  }

  resolveHomeMemorySource(source: {
    sourceType: DbViewerSourceType;
    sourceId: string;
    homeId: string;
    runId?: string | null;
  }): DbViewerSourceResolution {
    if (source.sourceType === 'device_event_query') {
      const query = this.getDeviceEventQuery(source.sourceId);
      if (!query || query.homeId !== source.homeId || (source.runId && query.runId !== source.runId)) {
        console.warn('[db-viewer] missing_source', JSON.stringify(source));
        return missingSource(source);
      }
      return {
        status: 'found',
        sourceType: source.sourceType,
        item: query
      };
    }
    const table = sourceTable(source.sourceType);
    if (!table) {
      return missingSource(source);
    }
    const row = source.runId
      ? this.homeMemoryDb.prepare(`SELECT * FROM ${table} WHERE id = ? AND home_id = ? AND run_id = ? LIMIT 1`).get(source.sourceId, source.homeId, source.runId)
      : this.homeMemoryDb.prepare(`SELECT * FROM ${table} WHERE id = ? AND home_id = ? LIMIT 1`).get(source.sourceId, source.homeId);
    if (!row) {
      console.warn('[db-viewer] missing_source', JSON.stringify(source));
      return missingSource(source);
    }
    return {
      status: 'found',
      sourceType: source.sourceType,
      item: rowToHomeMemoryItem(source.sourceType, row as Record<string, unknown>)
    };
  }

  listDeviceEvents(query: DbViewerDeviceEventQuery = {}): DbViewerListResponse<DbViewerDeviceEvent> {
    const db = requiredDeviceEventsDb(this.deviceEventsDb);
    const { join, where, params } = buildDeviceEventQuery(query);
    params.push(query.limit ?? 100);
    const rows = db.prepare(`
      SELECT e.*
      FROM device_value_events e
      ${join}
      ${where}
      ORDER BY e.sequence ASC, e.id ASC
      LIMIT ?
    `).all(...params) as DeviceEventRow[];
    return { items: rows.map(toDeviceEvent) };
  }

  getDeviceEvent(id: string): DbViewerDeviceEvent | null {
    const db = requiredDeviceEventsDb(this.deviceEventsDb);
    const row = db.prepare('SELECT * FROM device_value_events WHERE id = ?').get(id) as DeviceEventRow | undefined;
    return row ? toDeviceEvent(row) : null;
  }

  listDeviceEventsBySource(sourceEventId: string, query: Pick<DbViewerDeviceEventQuery, 'homeId' | 'runId' | 'limit'> = {}): DbViewerListResponse<DbViewerDeviceEvent> {
    return this.listDeviceEvents({ ...query, sourceEventId });
  }

  listDeviceEventsAroundSource(sourceEventId: string, query: { homeId?: string; runId?: string; windowMinutes?: number; limit?: number } = {}): {
    source: DbViewerDeviceEvent | null;
    items: DbViewerDeviceEvent[];
  } {
    const source = this.listDeviceEventsBySource(sourceEventId, {
      homeId: query.homeId,
      runId: query.runId,
      limit: 1
    }).items[0] ?? null;
    if (!source) {
      return { source: null, items: [] };
    }
    const sourceTime = parseSimTimeMs(source.simTime);
    const windowMinutes = query.windowMinutes ?? 30;
    if (Number.isNaN(sourceTime)) {
      return {
        source,
        items: this.listDeviceEvents({
          homeId: source.homeId,
          runId: source.runId,
          fromSequence: source.sequence - Math.round(windowMinutes),
          toSequence: source.sequence + Math.round(windowMinutes),
          limit: query.limit ?? 200
        }).items
      };
    }
    return {
      source,
      items: this.listDeviceEvents({
        homeId: source.homeId,
        runId: source.runId,
        fromSimTime: formatSimTime(sourceTime - windowMinutes * 60_000),
        toSimTime: formatSimTime(sourceTime + windowMinutes * 60_000),
        limit: query.limit ?? 200
      }).items
    };
  }

  listDeviceEventQueries(query: { homeId?: string; runId?: string; limit?: number } = {}): DbViewerListResponse<DbViewerDeviceEventQueryAudit> {
    const db = requiredDeviceEventsDb(this.deviceEventsDb);
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
    const rows = db.prepare(`
      SELECT *
      FROM device_event_queries
      ${where}
      ORDER BY created_at DESC, id ASC
      LIMIT ?
    `).all(...params) as DeviceEventQueryRow[];
    return { items: rows.map(toDeviceEventQuery) };
  }

  getDeviceEventQuery(id: string): DbViewerDeviceEventQueryAudit | null {
    const db = requiredDeviceEventsDb(this.deviceEventsDb);
    const row = db.prepare('SELECT * FROM device_event_queries WHERE id = ?').get(id) as DeviceEventQueryRow | undefined;
    return row ? toDeviceEventQuery(row) : null;
  }

  close(): void {
    this.homeMemoryDb.close();
    this.agentProfileDb.close();
    this.deviceEventsDb?.close();
  }

  private getClaimIndex(entryId: string): DbViewerClaimIndex | null {
    const row = this.agentProfileDb.prepare(`
      SELECT *
      FROM agent_profile_claim_index
      WHERE entry_id = ?
    `).get(entryId) as ClaimIndexRow | undefined;
    if (!row) {
      return null;
    }
    return {
      claimType: row.claim_type,
      predicate: row.predicate,
      objectType: row.object_type,
      objectId: row.object_id,
      objectValue: parseNullableJson(row.object_value_json),
      status: row.status,
      confidence: row.confidence,
      stability: row.stability,
      updatedAt: row.updated_at
    };
  }

  private listTimeWindows(entryId: string): DbViewerTimeWindow[] {
    const rows = this.agentProfileDb.prepare(`
      SELECT *
      FROM agent_profile_time_windows
      WHERE entry_id = ?
      ORDER BY day_type ASC, time_start ASC, id ASC
    `).all(entryId) as TimeWindowRow[];
    return rows.map((row) => ({
      id: row.id,
      entryId: row.entry_id,
      dayType: row.day_type,
      daysOfWeek: row.days_of_week_json ? JSON.parse(row.days_of_week_json) as number[] : null,
      timeStart: row.time_start,
      timeEnd: row.time_end,
      timezone: row.timezone,
      recurrence: row.recurrence,
      validFrom: row.valid_from,
      validTo: row.valid_to
    }));
  }
}

interface AgentProfileEntryRow {
  id: string;
  home_id: string;
  subject_type: string;
  subject_id: string;
  entry_type: string;
  title: string;
  summary: string;
  content_json: string;
  status: string;
  confidence: number;
  stability: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface AgentProfileSourceRow {
  id: string;
  entry_id: string;
  source_type: DbViewerSourceType;
  source_id: string;
  home_id: string;
  run_id: string | null;
  sequence: number | null;
  quote_or_observation: string | null;
  weight: number;
  created_at: string;
}

interface AgentProfileEventRow {
  id: string;
  entry_id: string;
  event_type: string;
  actor: string;
  before_json: string | null;
  after_json: string | null;
  reason: string;
  created_at: string;
}

interface ClaimIndexRow {
  claim_type: string;
  predicate: string;
  object_type: string | null;
  object_id: string | null;
  object_value_json: string | null;
  status: string;
  confidence: number;
  stability: string;
  updated_at: string;
}

interface TimeWindowRow {
  id: string;
  entry_id: string;
  day_type: string;
  days_of_week_json: string | null;
  time_start: string | null;
  time_end: string | null;
  timezone: string;
  recurrence: string;
  valid_from: string | null;
  valid_to: string | null;
}

interface HomeMemoryRunRow {
  home_id: string;
  run_id: string;
  covered_sequence: number;
  reducer_version: string;
  schema_version: number;
  materialized_at: string;
}

interface HomeMemoryEvidenceRow {
  id: string;
  home_id: string;
  run_id: string;
  sequence: number;
  sim_time: string;
  room_id: string;
  device_id: string;
  field: string;
  evidence_category: string;
  profile_weight: number;
  payload_json: string;
}

interface HomeMemoryHypothesisRow {
  id: string;
  home_id: string;
  run_id: string;
  type: string;
  summary: string;
  confidence: number;
  updated_at: string;
  evidence_ids_json: string;
  payload_json: string;
}

interface HomeMemoryPortraitRow {
  id: string;
  home_id: string;
  run_id: string;
  section_id: string;
  summary: string;
  confidence: number;
  evidence_ids_json: string;
  payload_json: string;
}

interface DeviceEventRow {
  id: string;
  import_id: string;
  source_event_id: string;
  source_event_type: string;
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
  created_by: string;
  created_at: string;
}

function toEntrySummary(row: AgentProfileEntryRow): DbViewerAgentProfileEntrySummary {
  return {
    id: row.id,
    homeId: row.home_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    entryType: row.entry_type,
    title: row.title,
    summary: row.summary,
    status: row.status,
    confidence: row.confidence,
    stability: row.stability,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toSource(row: AgentProfileSourceRow): DbViewerAgentProfileSource {
  return {
    id: row.id,
    entryId: row.entry_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    homeId: row.home_id,
    runId: row.run_id,
    sequence: row.sequence,
    quoteOrObservation: row.quote_or_observation,
    weight: row.weight,
    createdAt: row.created_at
  };
}

function toRun(row: HomeMemoryRunRow): DbViewerRun {
  return {
    homeId: row.home_id,
    runId: row.run_id,
    coveredSequence: row.covered_sequence,
    reducerVersion: row.reducer_version,
    schemaVersion: row.schema_version,
    materializedAt: row.materialized_at
  };
}

function toEvidence(row: HomeMemoryEvidenceRow): DbViewerHomeMemoryItem {
  return {
    id: row.id,
    homeId: row.home_id,
    runId: row.run_id,
    sequence: row.sequence,
    simTime: row.sim_time,
    roomId: row.room_id,
    deviceId: row.device_id,
    field: row.field,
    evidenceCategory: row.evidence_category,
    profileWeight: row.profile_weight,
    payload: JSON.parse(row.payload_json) as unknown
  };
}

function toHypothesis(row: HomeMemoryHypothesisRow): DbViewerHomeMemoryItem {
  return {
    id: row.id,
    homeId: row.home_id,
    runId: row.run_id,
    type: row.type,
    summary: row.summary,
    confidence: row.confidence,
    updatedAt: row.updated_at,
    evidenceIds: JSON.parse(row.evidence_ids_json) as string[],
    payload: JSON.parse(row.payload_json) as unknown
  };
}

function toPortraitSection(row: HomeMemoryPortraitRow): DbViewerHomeMemoryItem {
  return {
    id: row.id,
    homeId: row.home_id,
    runId: row.run_id,
    sectionId: row.section_id,
    summary: row.summary,
    confidence: row.confidence,
    evidenceIds: JSON.parse(row.evidence_ids_json) as string[],
    payload: JSON.parse(row.payload_json) as unknown
  };
}

function toDeviceEvent(row: DeviceEventRow): DbViewerDeviceEvent {
  return {
    id: row.id,
    importId: row.import_id,
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
    value: JSON.parse(row.value_json) as unknown,
    payload: JSON.parse(row.payload_json) as unknown
  };
}

function toDeviceEventQuery(row: DeviceEventQueryRow): DbViewerDeviceEventQueryAudit {
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

function rowToHomeMemoryItem(sourceType: DbViewerSourceType, row: Record<string, unknown>): DbViewerHomeMemoryItem {
  if (sourceType === 'home_memory_evidence') {
    return toEvidence(row as unknown as HomeMemoryEvidenceRow);
  }
  if (sourceType === 'home_memory_hypothesis') {
    return toHypothesis(row as unknown as HomeMemoryHypothesisRow);
  }
  return toPortraitSection(row as unknown as HomeMemoryPortraitRow);
}

function sourceTable(sourceType: DbViewerSourceType): string | null {
  if (sourceType === 'home_memory_evidence') {
    return 'home_memory_evidence';
  }
  if (sourceType === 'home_memory_hypothesis') {
    return 'home_memory_profile_hypotheses';
  }
  if (sourceType === 'home_memory_portrait_section') {
    return 'home_memory_portrait_sections';
  }
  return null;
}

function missingSource(source: {
  sourceType: DbViewerSourceType;
  sourceId: string;
  homeId: string;
  runId?: string | null;
}): DbViewerSourceResolution {
  return {
    status: 'missing',
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    homeId: source.homeId,
    runId: source.runId ?? null
  };
}

function missingTables(db: Database.Database, tables: string[]): string[] {
  const existing = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all() as Array<{ name: string }>)
    .map((row) => row.name));
  return tables.filter((table) => !existing.has(table));
}

function requiredDeviceEventsDb(db: Database.Database | null): Database.Database {
  if (!db) {
    throw new Error('Device Events DB is not configured for this viewer');
  }
  return db;
}

function buildDeviceEventQuery(query: DbViewerDeviceEventQuery): {
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

function parseNullableJson(value: string | null): unknown {
  return value ? JSON.parse(value) as unknown : null;
}

function toFtsQuery(text: string): string {
  const tokens = text.trim().toLowerCase().replace(/[^\p{L}\p{N}_\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return [...new Set(tokens)].map((token) => `"${token.replaceAll('"', '""')}"*`).join(' OR ');
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
