import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type AgentProfileSubjectType = 'household' | 'resident_slot' | 'room' | 'device' | 'routine' | 'preference' | 'risk' | 'unknown';
export type AgentProfileEntryType = 'conclusion' | 'preference' | 'hypothesis' | 'note' | 'task_memory' | 'contradiction' | 'question';
export type AgentProfileStatus = 'candidate' | 'active' | 'rejected' | 'superseded' | 'archived';
export type AgentProfileStability = 'volatile' | 'working' | 'stable';
export type AgentProfileActor = 'agent' | 'user' | 'system' | 'human_reviewer';
export type AgentProfileSourceType =
  | 'home_memory_evidence'
  | 'home_memory_hypothesis'
  | 'home_memory_portrait_section'
  | 'device_event_query'
  | 'user_statement'
  | 'agent_reasoning'
  | 'manual_review';
export type AgentProfileClaimType = 'routine' | 'preference' | 'risk' | 'habit' | 'identity' | 'constraint' | 'capability' | 'uncertainty';
export type AgentProfileDayType = 'weekday' | 'weekend' | 'daily' | 'specific_date' | 'unknown';
export type AgentProfileRecurrence = 'daily' | 'weekly' | 'one_off' | 'seasonal' | 'unknown';

export interface AgentProfileSourceInput {
  id?: string;
  sourceType: AgentProfileSourceType;
  sourceId: string;
  homeId: string;
  runId?: string | null;
  sequence?: number | null;
  quoteOrObservation?: string;
  weight?: number;
}

export interface AgentProfileClaimIndexInput {
  claimType: AgentProfileClaimType;
  predicate: string;
  objectType?: string | null;
  objectId?: string | null;
  objectValue?: unknown;
}

export interface AgentProfileTimeWindowInput {
  id?: string;
  dayType: AgentProfileDayType;
  daysOfWeek?: number[];
  timeStart?: string | null;
  timeEnd?: string | null;
  timezone: string;
  recurrence: AgentProfileRecurrence;
  validFrom?: string | null;
  validTo?: string | null;
}

export interface AgentProfileCreateEntryInput {
  id?: string;
  homeId: string;
  subjectType: AgentProfileSubjectType;
  subjectId: string;
  entryType: AgentProfileEntryType;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  status?: AgentProfileStatus;
  confidence: number;
  stability: AgentProfileStability;
  createdBy: AgentProfileActor;
  index?: AgentProfileClaimIndexInput;
  timeWindows?: AgentProfileTimeWindowInput[];
  sources: AgentProfileSourceInput[];
}

export interface AgentProfileEntry {
  id: string;
  homeId: string;
  subjectType: AgentProfileSubjectType;
  subjectId: string;
  entryType: AgentProfileEntryType;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  status: AgentProfileStatus;
  confidence: number;
  stability: AgentProfileStability;
  createdBy: AgentProfileActor;
  createdAt: string;
  updatedAt: string;
  supersedesEntryId: string | null;
  schemaVersion: number;
  sources?: AgentProfileSource[];
}

export interface AgentProfileSource {
  id: string;
  entryId: string;
  sourceType: AgentProfileSourceType;
  sourceId: string;
  homeId: string;
  runId: string | null;
  sequence: number | null;
  quoteOrObservation: string | null;
  weight: number;
  createdAt: string;
}

export interface AgentProfileQuery {
  homeId: string;
  structured?: {
    claimTypes?: AgentProfileClaimType[];
    predicates?: string[];
    subjectType?: AgentProfileSubjectType;
    subjectId?: string;
    dayType?: AgentProfileDayType;
    time?: string;
    statuses?: AgentProfileStatus[];
  };
  text?: string;
  limit?: number;
  includeSources?: boolean;
}

export interface AgentProfileQueryItem {
  entryId: string;
  summary: string;
  matchChannels: Array<'structured' | 'fts'>;
  score: number;
  confidence: number;
  status: AgentProfileStatus;
  stability: AgentProfileStability;
  sources: AgentProfileSource[];
}

export interface AgentProfileEntryEvent {
  id: string;
  entryId: string;
  eventType: string;
  actor: AgentProfileActor;
  before: unknown;
  after: unknown;
  reason: string;
  createdAt: string;
}

export interface AgentProfileStatusUpdate {
  status: AgentProfileStatus;
  actor: AgentProfileActor;
  reason: string;
}

export interface AgentProfileEntryUpdate {
  title?: string;
  summary?: string;
  content?: Record<string, unknown>;
  index?: AgentProfileClaimIndexInput | null;
  timeWindows?: AgentProfileTimeWindowInput[];
  actor: AgentProfileActor;
  reason: string;
}

export class AgentProfileDatabase {
  private readonly db: Database.Database;

  constructor(filename: string) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_profile_entries (
        id TEXT PRIMARY KEY,
        home_id TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        entry_type TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        content_json TEXT NOT NULL,
        status TEXT NOT NULL,
        confidence REAL NOT NULL,
        stability TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        supersedes_entry_id TEXT,
        schema_version INTEGER NOT NULL,
        CHECK (confidence >= 0 AND confidence <= 1)
      );

      CREATE TABLE IF NOT EXISTS agent_profile_sources (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        home_id TEXT NOT NULL,
        run_id TEXT,
        sequence INTEGER,
        quote_or_observation TEXT,
        weight REAL NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        FOREIGN KEY (entry_id) REFERENCES agent_profile_entries(id) ON DELETE CASCADE,
        CHECK (weight >= 0 AND weight <= 1)
      );

      CREATE TABLE IF NOT EXISTS agent_profile_claim_index (
        entry_id TEXT PRIMARY KEY,
        home_id TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        claim_type TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object_type TEXT,
        object_id TEXT,
        object_value_json TEXT,
        status TEXT NOT NULL,
        confidence REAL NOT NULL,
        stability TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (entry_id) REFERENCES agent_profile_entries(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS agent_profile_time_windows (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        day_type TEXT NOT NULL,
        days_of_week_json TEXT,
        time_start TEXT,
        time_end TEXT,
        timezone TEXT NOT NULL,
        recurrence TEXT NOT NULL,
        valid_from TEXT,
        valid_to TEXT,
        FOREIGN KEY (entry_id) REFERENCES agent_profile_entries(id) ON DELETE CASCADE
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS agent_profile_fts USING fts5(
        entry_id UNINDEXED,
        home_id UNINDEXED,
        title,
        summary,
        content_text,
        source_text,
        tokenize = 'unicode61'
      );

      CREATE TABLE IF NOT EXISTS agent_profile_entry_events (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (entry_id) REFERENCES agent_profile_entries(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS agent_profile_entries_home_status_idx
        ON agent_profile_entries(home_id, status, updated_at);
      CREATE INDEX IF NOT EXISTS agent_profile_entries_subject_idx
        ON agent_profile_entries(home_id, subject_type, subject_id, status);
      CREATE INDEX IF NOT EXISTS agent_profile_sources_entry_idx
        ON agent_profile_sources(entry_id);
      CREATE INDEX IF NOT EXISTS agent_profile_sources_source_idx
        ON agent_profile_sources(source_type, source_id);
      CREATE INDEX IF NOT EXISTS agent_profile_claim_index_lookup_idx
        ON agent_profile_claim_index(home_id, claim_type, predicate, status, confidence);
      CREATE INDEX IF NOT EXISTS agent_profile_time_windows_lookup_idx
        ON agent_profile_time_windows(day_type, time_start, time_end, recurrence);
    `);
  }

  createEntry(input: AgentProfileCreateEntryInput): AgentProfileEntry {
    validateCreateInput(input);
    const id = input.id ?? `entry_${randomUUID()}`;
    const now = new Date().toISOString();
    const status = input.status ?? 'candidate';
    validateStatusSources(status, input.entryType, input.sources);
    const entryRow = {
      id,
      homeId: input.homeId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      entryType: input.entryType,
      title: input.title,
      summary: input.summary,
      content: input.content,
      status,
      confidence: input.confidence,
      stability: input.stability,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      supersedesEntryId: null,
      schemaVersion: 1
    } satisfies AgentProfileEntry;

    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO agent_profile_entries
          (id, home_id, subject_type, subject_id, entry_type, title, summary, content_json, status, confidence, stability, created_by, created_at, updated_at, supersedes_entry_id, schema_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.homeId,
        input.subjectType,
        input.subjectId,
        input.entryType,
        input.title,
        input.summary,
        JSON.stringify(input.content),
        status,
        input.confidence,
        input.stability,
        input.createdBy,
        now,
        now,
        null,
        1
      );
      for (const source of input.sources) {
        this.insertSource(id, source, now);
      }
      if (input.index) {
        this.upsertClaimIndex(id, input, status, now);
      }
      for (const window of input.timeWindows ?? []) {
        this.insertTimeWindow(id, window);
      }
      this.insertEvent(id, 'created', input.createdBy, null, entryRow, 'Created profile entry.', now);
      this.reindexEntry(id);
    });
    transaction();
    return this.getEntry(id, { includeSources: true }) ?? entryRow;
  }

  getEntry(id: string, options: { includeSources?: boolean } = {}): AgentProfileEntry | null {
    const row = this.db.prepare('SELECT * FROM agent_profile_entries WHERE id = ?').get(id) as AgentProfileEntryRow | undefined;
    if (!row) {
      return null;
    }
    const entry = toEntry(row);
    return options.includeSources ? { ...entry, sources: this.getSources(id) } : entry;
  }

  listEntries(query: { homeId?: string; status?: AgentProfileStatus; limit?: number } = {}): { items: AgentProfileEntry[] } {
    const limit = query.limit ?? 100;
    const rows = query.homeId && query.status
      ? this.db.prepare('SELECT * FROM agent_profile_entries WHERE home_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ?').all(query.homeId, query.status, limit)
      : query.homeId
        ? this.db.prepare('SELECT * FROM agent_profile_entries WHERE home_id = ? ORDER BY updated_at DESC LIMIT ?').all(query.homeId, limit)
        : this.db.prepare('SELECT * FROM agent_profile_entries ORDER BY updated_at DESC LIMIT ?').all(limit);
    return { items: (rows as AgentProfileEntryRow[]).map(toEntry) };
  }

  queryEntries(query: AgentProfileQuery): { items: AgentProfileQueryItem[] } {
    const limit = query.limit ?? 10;
    const matches = new Map<string, { channels: Set<'structured' | 'fts'>; score: number }>();
    if (query.structured) {
      for (const row of this.queryStructured(query)) {
        const current = matches.get(row.entry_id) ?? { channels: new Set<'structured' | 'fts'>(), score: 0 };
        current.channels.add('structured');
        current.score += 1 + row.confidence;
        matches.set(row.entry_id, current);
      }
    }
    if (query.text?.trim()) {
      for (const row of this.queryFts(query.homeId, query.text, limit * 3)) {
        const current = matches.get(row.entry_id) ?? { channels: new Set<'structured' | 'fts'>(), score: 0 };
        current.channels.add('fts');
        current.score += normalizeFtsRank(row.rank);
        matches.set(row.entry_id, current);
      }
    }

    const items = [...matches.entries()]
      .map(([entryId, match]) => {
        const entry = this.getEntry(entryId, { includeSources: query.includeSources });
        if (!entry) {
          return null;
        }
        return {
          entryId,
          summary: entry.summary,
          matchChannels: [...match.channels].sort(),
          score: round3(match.score + entry.confidence),
          confidence: entry.confidence,
          status: entry.status,
          stability: entry.stability,
          sources: query.includeSources ? entry.sources ?? [] : []
        } satisfies AgentProfileQueryItem;
      })
      .filter((item): item is AgentProfileQueryItem => Boolean(item))
      .sort((left, right) => right.score - left.score || right.confidence - left.confidence || left.entryId.localeCompare(right.entryId))
      .slice(0, limit);

    return { items };
  }

  updateEntryStatus(id: string, update: AgentProfileStatusUpdate): AgentProfileEntry {
    const entry = this.getEntry(id, { includeSources: true });
    if (!entry) {
      throw new Error(`Agent profile entry not found: ${id}`);
    }
    validateStatusSources(update.status, entry.entryType, entry.sources ?? []);
    const now = new Date().toISOString();
    const after = { ...entry, status: update.status, updatedAt: now };
    const transaction = this.db.transaction(() => {
      this.db.prepare('UPDATE agent_profile_entries SET status = ?, updated_at = ? WHERE id = ?').run(update.status, now, id);
      this.db.prepare('UPDATE agent_profile_claim_index SET status = ?, updated_at = ? WHERE entry_id = ?').run(update.status, now, id);
      this.insertEvent(id, 'status_changed', update.actor, entry, after, update.reason, now);
    });
    transaction();
    return this.getEntry(id, { includeSources: true }) ?? after;
  }

  updateEntry(id: string, update: AgentProfileEntryUpdate): AgentProfileEntry {
    const current = this.getEntry(id, { includeSources: true });
    if (!current) {
      throw new Error(`Agent profile entry not found: ${id}`);
    }
    const now = new Date().toISOString();
    const nextTitle = update.title ?? current.title;
    const nextSummary = update.summary ?? current.summary;
    const nextContent = update.content ?? current.content;
    const after = {
      ...current,
      title: nextTitle,
      summary: nextSummary,
      content: nextContent,
      updatedAt: now
    };
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE agent_profile_entries
        SET title = ?, summary = ?, content_json = ?, updated_at = ?
        WHERE id = ?
      `).run(nextTitle, nextSummary, JSON.stringify(nextContent), now, id);
      if (update.index !== undefined) {
        this.db.prepare('DELETE FROM agent_profile_claim_index WHERE entry_id = ?').run(id);
        if (update.index) {
          this.db.prepare(`
            INSERT INTO agent_profile_claim_index
              (entry_id, home_id, subject_type, subject_id, claim_type, predicate, object_type, object_id, object_value_json, status, confidence, stability, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            id,
            current.homeId,
            current.subjectType,
            current.subjectId,
            update.index.claimType,
            update.index.predicate,
            update.index.objectType ?? null,
            update.index.objectId ?? null,
            update.index.objectValue === undefined ? null : JSON.stringify(update.index.objectValue),
            current.status,
            current.confidence,
            current.stability,
            now
          );
        }
      }
      if (update.timeWindows !== undefined) {
        this.db.prepare('DELETE FROM agent_profile_time_windows WHERE entry_id = ?').run(id);
        for (const window of update.timeWindows) {
          this.insertTimeWindow(id, window);
        }
      }
      this.insertEvent(id, 'updated', update.actor, current, after, update.reason, now);
      this.reindexEntry(id);
    });
    transaction();
    return this.getEntry(id, { includeSources: true }) ?? after;
  }

  addSource(
    entryId: string,
    source: AgentProfileSourceInput,
    options: { actor: AgentProfileActor; reason: string }
  ): AgentProfileSource {
    const entry = this.getEntry(entryId, { includeSources: true });
    if (!entry) {
      throw new Error(`Agent profile entry not found: ${entryId}`);
    }
    if (source.homeId !== entry.homeId) {
      throw new Error('Agent profile source homeId must match entry homeId');
    }
    const now = new Date().toISOString();
    const sourceId = source.id ?? `source_${randomUUID()}`;
    const transaction = this.db.transaction(() => {
      this.insertSource(entryId, { ...source, id: sourceId }, now);
      this.insertEvent(entryId, 'source_added', options.actor, entry.sources ?? [], source, options.reason, now);
      this.reindexEntry(entryId);
    });
    transaction();
    return this.getSources(entryId).find((item) => item.id === sourceId) ?? {
      id: sourceId,
      entryId,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      homeId: source.homeId,
      runId: source.runId ?? null,
      sequence: source.sequence ?? null,
      quoteOrObservation: source.quoteOrObservation ?? null,
      weight: source.weight ?? 1,
      createdAt: now
    };
  }

  deleteEntry(id: string): boolean {
    const result = this.db.prepare('DELETE FROM agent_profile_entries WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM agent_profile_fts WHERE entry_id = ?').run(id);
    return result.changes > 0;
  }

  getEntryEvents(entryId: string): AgentProfileEntryEvent[] {
    const rows = this.db.prepare('SELECT * FROM agent_profile_entry_events WHERE entry_id = ? ORDER BY created_at ASC').all(entryId) as AgentProfileEntryEventRow[];
    return rows.map((row) => ({
      id: row.id,
      entryId: row.entry_id,
      eventType: row.event_type,
      actor: row.actor as AgentProfileActor,
      before: row.before_json ? JSON.parse(row.before_json) : null,
      after: row.after_json ? JSON.parse(row.after_json) : null,
      reason: row.reason,
      createdAt: row.created_at
    }));
  }

  close(): void {
    this.db.close();
  }

  private getSources(entryId: string): AgentProfileSource[] {
    const rows = this.db.prepare('SELECT * FROM agent_profile_sources WHERE entry_id = ? ORDER BY created_at ASC, id ASC').all(entryId) as AgentProfileSourceRow[];
    return rows.map(toSource);
  }

  private insertSource(entryId: string, source: AgentProfileSourceInput, createdAt: string): void {
    this.db.prepare(`
      INSERT INTO agent_profile_sources
        (id, entry_id, source_type, source_id, home_id, run_id, sequence, quote_or_observation, weight, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      source.id ?? `source_${randomUUID()}`,
      entryId,
      source.sourceType,
      source.sourceId,
      source.homeId,
      source.runId ?? null,
      source.sequence ?? null,
      source.quoteOrObservation ?? null,
      source.weight ?? 1,
      createdAt
    );
  }

  private upsertClaimIndex(
    entryId: string,
    input: AgentProfileCreateEntryInput,
    status: AgentProfileStatus,
    updatedAt: string
  ): void {
    if (!input.index) {
      return;
    }
    this.db.prepare(`
      INSERT INTO agent_profile_claim_index
        (entry_id, home_id, subject_type, subject_id, claim_type, predicate, object_type, object_id, object_value_json, status, confidence, stability, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entryId,
      input.homeId,
      input.subjectType,
      input.subjectId,
      input.index.claimType,
      input.index.predicate,
      input.index.objectType ?? null,
      input.index.objectId ?? null,
      input.index.objectValue === undefined ? null : JSON.stringify(input.index.objectValue),
      status,
      input.confidence,
      input.stability,
      updatedAt
    );
  }

  private insertTimeWindow(entryId: string, window: AgentProfileTimeWindowInput): void {
    this.db.prepare(`
      INSERT INTO agent_profile_time_windows
        (id, entry_id, day_type, days_of_week_json, time_start, time_end, timezone, recurrence, valid_from, valid_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      window.id ?? `window_${randomUUID()}`,
      entryId,
      window.dayType,
      window.daysOfWeek ? JSON.stringify(window.daysOfWeek) : null,
      window.timeStart ?? null,
      window.timeEnd ?? null,
      window.timezone,
      window.recurrence,
      window.validFrom ?? null,
      window.validTo ?? null
    );
  }

  private reindexEntry(entryId: string): void {
    const entry = this.getEntry(entryId, { includeSources: true });
    if (!entry) {
      return;
    }
    const index = this.getClaimIndex(entryId);
    const sources = entry.sources ?? [];
    this.db.prepare('DELETE FROM agent_profile_fts WHERE entry_id = ?').run(entryId);
    this.db.prepare(`
      INSERT INTO agent_profile_fts (entry_id, home_id, title, summary, content_text, source_text)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      entryId,
      entry.homeId,
      `${entry.title} ${searchTokens(entry.title, index)}`,
      `${entry.summary} ${searchTokens(entry.summary, index)}`,
      `${contentToText(entry.content)} ${index?.claimType ?? ''} ${index?.predicate ?? ''} ${searchTokens(contentToText(entry.content), index)}`,
      sources.map((source) => `${source.sourceType} ${source.sourceId} ${source.quoteOrObservation ?? ''}`).join(' ')
    );
  }

  private getClaimIndex(entryId: string): AgentProfileClaimIndexInput | undefined {
    const row = this.db.prepare(`
      SELECT claim_type, predicate, object_type, object_id, object_value_json
      FROM agent_profile_claim_index
      WHERE entry_id = ?
    `).get(entryId) as {
      claim_type: AgentProfileClaimType;
      predicate: string;
      object_type: string | null;
      object_id: string | null;
      object_value_json: string | null;
    } | undefined;
    return row ? {
      claimType: row.claim_type,
      predicate: row.predicate,
      objectType: row.object_type,
      objectId: row.object_id,
      objectValue: row.object_value_json ? JSON.parse(row.object_value_json) : undefined
    } : undefined;
  }

  private insertEvent(
    entryId: string,
    eventType: string,
    actor: AgentProfileActor,
    before: unknown,
    after: unknown,
    reason: string,
    createdAt: string
  ): void {
    this.db.prepare(`
      INSERT INTO agent_profile_entry_events
        (id, entry_id, event_type, actor, before_json, after_json, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `event_${randomUUID()}`,
      entryId,
      eventType,
      actor,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      reason,
      createdAt
    );
  }

  private queryStructured(query: AgentProfileQuery): StructuredMatchRow[] {
    const structured = query.structured;
    if (!structured) {
      return [];
    }
    const clauses = ['c.home_id = ?'];
    const params: unknown[] = [query.homeId];
    if (structured.claimTypes?.length) {
      clauses.push(`c.claim_type IN (${placeholders(structured.claimTypes.length)})`);
      params.push(...structured.claimTypes);
    }
    if (structured.predicates?.length) {
      clauses.push(`c.predicate IN (${placeholders(structured.predicates.length)})`);
      params.push(...structured.predicates);
    }
    if (structured.subjectType) {
      clauses.push('c.subject_type = ?');
      params.push(structured.subjectType);
    }
    if (structured.subjectId) {
      clauses.push('c.subject_id = ?');
      params.push(structured.subjectId);
    }
    const statuses = structured.statuses?.length ? structured.statuses : ['active', 'candidate'];
    clauses.push(`c.status IN (${placeholders(statuses.length)})`);
    params.push(...statuses);
    let joinTime = '';
    if (structured.dayType || structured.time) {
      joinTime = 'JOIN agent_profile_time_windows t ON t.entry_id = c.entry_id';
      if (structured.dayType) {
        clauses.push('t.day_type = ?');
        params.push(structured.dayType);
      }
      if (structured.time) {
        clauses.push('(t.time_start IS NULL OR t.time_start <= ?)');
        clauses.push('(t.time_end IS NULL OR t.time_end >= ?)');
        params.push(structured.time, structured.time);
      }
    }
    return this.db.prepare(`
      SELECT c.entry_id, c.confidence
      FROM agent_profile_claim_index c
      ${joinTime}
      WHERE ${clauses.join(' AND ')}
    `).all(...params) as StructuredMatchRow[];
  }

  private queryFts(homeId: string, text: string, limit: number): FtsMatchRow[] {
    const match = toFtsQuery(text);
    if (!match) {
      return [];
    }
    return this.db.prepare(`
      SELECT entry_id, bm25(agent_profile_fts) AS rank
      FROM agent_profile_fts
      WHERE home_id = ? AND agent_profile_fts MATCH ?
      ORDER BY rank ASC
      LIMIT ?
    `).all(homeId, match, limit) as FtsMatchRow[];
  }
}

interface AgentProfileEntryRow {
  id: string;
  home_id: string;
  subject_type: AgentProfileSubjectType;
  subject_id: string;
  entry_type: AgentProfileEntryType;
  title: string;
  summary: string;
  content_json: string;
  status: AgentProfileStatus;
  confidence: number;
  stability: AgentProfileStability;
  created_by: AgentProfileActor;
  created_at: string;
  updated_at: string;
  supersedes_entry_id: string | null;
  schema_version: number;
}

interface AgentProfileSourceRow {
  id: string;
  entry_id: string;
  source_type: AgentProfileSourceType;
  source_id: string;
  home_id: string;
  run_id: string | null;
  sequence: number | null;
  quote_or_observation: string | null;
  weight: number;
  created_at: string;
}

interface AgentProfileEntryEventRow {
  id: string;
  entry_id: string;
  event_type: string;
  actor: AgentProfileActor;
  before_json: string | null;
  after_json: string | null;
  reason: string;
  created_at: string;
}

interface StructuredMatchRow {
  entry_id: string;
  confidence: number;
}

interface FtsMatchRow {
  entry_id: string;
  rank: number;
}

function toEntry(row: AgentProfileEntryRow): AgentProfileEntry {
  return {
    id: row.id,
    homeId: row.home_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    entryType: row.entry_type,
    title: row.title,
    summary: row.summary,
    content: JSON.parse(row.content_json) as Record<string, unknown>,
    status: row.status,
    confidence: row.confidence,
    stability: row.stability,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    supersedesEntryId: row.supersedes_entry_id,
    schemaVersion: row.schema_version
  };
}

function toSource(row: AgentProfileSourceRow): AgentProfileSource {
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

function validateCreateInput(input: AgentProfileCreateEntryInput): void {
  if (!input.homeId || !input.subjectId || !input.title || !input.summary) {
    throw new Error('Agent profile entry requires homeId, subjectId, title, and summary');
  }
  if (input.confidence < 0 || input.confidence > 1) {
    throw new Error('Agent profile confidence must be between 0 and 1');
  }
  const executable = ['conclusion', 'preference', 'hypothesis', 'contradiction'].includes(input.entryType);
  if (executable && input.sources.length === 0) {
    throw new Error('Agent profile executable entries require at least one source');
  }
  if (executable && !input.index) {
    throw new Error('Agent profile executable entries require a structured index');
  }
  if (input.sources.some((source) => source.homeId !== input.homeId)) {
    throw new Error('Agent profile source homeId must match entry homeId');
  }
  if (input.index?.claimType === 'routine' && (input.timeWindows?.length ?? 0) === 0) {
    throw new Error('Agent profile routine entries require at least one time window');
  }
}

function validateStatusSources(
  status: AgentProfileStatus,
  entryType: AgentProfileEntryType,
  sources: Array<AgentProfileSourceInput | AgentProfileSource>
): void {
  if (status !== 'active') {
    return;
  }
  if (entryType === 'question') {
    return;
  }
  const hasStrongSource = sources.some((source) => (
    source.sourceType.startsWith('home_memory_') ||
    source.sourceType === 'device_event_query' ||
    source.sourceType === 'manual_review'
  ));
  if (!hasStrongSource) {
    throw new Error(`Agent profile status ${status} requires Home Memory or manual review source`);
  }
}

function contentToText(content: Record<string, unknown>): string {
  return Object.values(content)
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    .join(' ');
}

function searchTokens(text: string, index?: AgentProfileClaimIndexInput): string {
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  if (/早餐|早饭|早上|吃饭|breakfast|morning|eats_breakfast/.test(lower) || index?.predicate === 'eats_breakfast') {
    tokens.push('早餐', '早饭', '早上', '吃饭', '习惯', 'breakfast', 'weekday', 'morning', 'kitchen', 'routine', 'eats_breakfast');
  }
  if (/routine|习惯|规律/.test(lower) || index?.claimType === 'routine') {
    tokens.push('routine', 'habit', '习惯', '规律');
  }
  return [...new Set(tokens)].join(' ');
}

function toFtsQuery(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/[^\p{L}\p{N}_\s]/gu, ' ');
  if (!normalized) {
    return '';
  }
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (/早餐|早饭|早上|吃饭/.test(normalized)) {
    tokens.push('早餐', '早饭', '早上', '吃饭', '习惯', 'breakfast', 'morning', 'eats_breakfast');
  }
  if (/习惯|routine|规律/.test(normalized)) {
    tokens.push('习惯', 'routine', 'habit');
  }
  return [...new Set(tokens)].map(quoteFtsToken).join(' OR ');
}

function quoteFtsToken(token: string): string {
  return `"${token.replaceAll('"', '""')}"`;
}

function normalizeFtsRank(rank: number): number {
  return round3(Math.max(0.1, Math.min(1, Math.abs(rank) || 0.5)));
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

function placeholders(length: number): string {
  return Array.from({ length }, () => '?').join(', ');
}
