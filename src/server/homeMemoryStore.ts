import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { HouseholdPortrait } from './memoryQuery';
import type { HomeMemory, MemoryEvidence } from '../web/homeMemoryModel';
import type { ProfileHypothesis } from '../web/homeProfiler';

export interface HomeMemoryMaterializationInput {
  memory: HomeMemory;
  hypotheses: ProfileHypothesis[];
  portrait: HouseholdPortrait;
  coveredSequence: number;
  reducerVersion: string;
  schemaVersion: number;
}

export interface HomeMemoryRunRecord {
  homeId: string;
  runId: string;
  coveredSequence: number;
  reducerVersion: string;
  schemaVersion: number;
  materializedAt: string;
}

export interface HomeMemoryListQuery {
  homeId: string;
  runId: string;
  limit?: number;
}

export interface StoredHomeMemoryEvidence extends MemoryEvidence {
  payload: MemoryEvidence;
}

export interface StoredHomeMemoryHypothesis {
  id: string;
  homeId: string;
  runId: string;
  type: string;
  summary: string;
  confidence: number;
  updatedAt: string;
  evidenceIds: string[];
  payload: ProfileHypothesis;
}

export interface StoredHomeMemoryPortraitSection {
  id: string;
  homeId: string;
  runId: string;
  sectionId: string;
  summary: string;
  confidence: number;
  evidenceIds: string[];
  payload: HouseholdPortrait['sections'][number];
}

export class HomeMemoryDatabase {
  private readonly db: Database.Database;

  constructor(filename: string) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS home_memory_runs (
        home_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        covered_sequence INTEGER NOT NULL,
        reducer_version TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        materialized_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (home_id, run_id)
      );

      CREATE TABLE IF NOT EXISTS home_memory_evidence (
        id TEXT PRIMARY KEY,
        home_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        sim_time TEXT NOT NULL,
        room_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        field TEXT NOT NULL,
        evidence_category TEXT NOT NULL,
        profile_weight REAL NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS home_memory_fields (
        id TEXT NOT NULL,
        home_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        field TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (home_id, run_id, id)
      );

      CREATE TABLE IF NOT EXISTS home_memory_devices (
        id TEXT NOT NULL,
        home_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (home_id, run_id, id)
      );

      CREATE TABLE IF NOT EXISTS home_memory_rooms (
        id TEXT NOT NULL,
        home_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (home_id, run_id, id)
      );

      CREATE TABLE IF NOT EXISTS home_memory_episodes (
        id TEXT NOT NULL,
        home_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_sim_time TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (home_id, run_id, id)
      );

      CREATE TABLE IF NOT EXISTS home_memory_activity_episodes (
        id TEXT NOT NULL,
        home_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        updated_sim_time TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (home_id, run_id, id)
      );

      CREATE TABLE IF NOT EXISTS home_memory_daily_summaries (
        id TEXT NOT NULL,
        home_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (home_id, run_id, id)
      );

      CREATE TABLE IF NOT EXISTS home_memory_weekly_summaries (
        id TEXT NOT NULL,
        home_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (home_id, run_id, id)
      );

      CREATE TABLE IF NOT EXISTS home_memory_semantic_signals (
        id TEXT NOT NULL,
        home_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        type TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (home_id, run_id, id)
      );

      CREATE TABLE IF NOT EXISTS home_memory_profile_hypotheses (
        id TEXT NOT NULL,
        home_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        type TEXT NOT NULL,
        summary TEXT NOT NULL,
        confidence REAL NOT NULL,
        updated_at TEXT NOT NULL,
        evidence_ids_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (home_id, run_id, id)
      );

      CREATE TABLE IF NOT EXISTS home_memory_portrait_sections (
        id TEXT NOT NULL,
        home_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        section_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        confidence REAL NOT NULL,
        evidence_ids_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (home_id, run_id, id)
      );

      CREATE TABLE IF NOT EXISTS home_memory_materializations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        home_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        covered_sequence INTEGER NOT NULL,
        reducer_version TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        materialized_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS home_memory_evidence_run_idx
        ON home_memory_evidence(home_id, run_id, sequence);
      CREATE INDEX IF NOT EXISTS home_memory_hypotheses_run_idx
        ON home_memory_profile_hypotheses(home_id, run_id, confidence);
      CREATE INDEX IF NOT EXISTS home_memory_portrait_sections_run_idx
        ON home_memory_portrait_sections(home_id, run_id, section_id);
    `);
  }

  materializeMemory(input: HomeMemoryMaterializationInput): HomeMemoryRunRecord {
    const homeId = requiredMemoryId(input.memory.homeId, 'homeId');
    const runId = requiredMemoryId(input.memory.runId, 'runId');
    const materializedAt = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      this.deleteRunRows(homeId, runId);
      this.db.prepare(`
        INSERT INTO home_memory_runs
          (home_id, run_id, covered_sequence, reducer_version, schema_version, materialized_at, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        homeId,
        runId,
        input.coveredSequence,
        input.reducerVersion,
        input.schemaVersion,
        materializedAt,
        JSON.stringify(input.memory)
      );
      this.db.prepare(`
        INSERT INTO home_memory_materializations
          (home_id, run_id, covered_sequence, reducer_version, schema_version, materialized_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(homeId, runId, input.coveredSequence, input.reducerVersion, input.schemaVersion, materializedAt);

      const insertEvidence = this.db.prepare(`
        INSERT INTO home_memory_evidence
          (id, home_id, run_id, sequence, sim_time, room_id, device_id, field, evidence_category, profile_weight, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const evidence of collectUniqueEvidence(input.memory)) {
        insertEvidence.run(
          evidence.id,
          evidence.homeId,
          evidence.runId,
          evidence.sequence,
          evidence.simTime,
          evidence.roomId,
          evidence.deviceId,
          evidence.field,
          evidence.evidenceCategory,
          evidence.profileWeight,
          JSON.stringify(evidence)
        );
      }

      const insertField = this.db.prepare(`
        INSERT INTO home_memory_fields (id, home_id, run_id, room_id, device_id, field, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const field of Object.values(input.memory.fields)) {
        insertField.run(field.id, field.homeId, field.runId, field.roomId, field.deviceId, field.field, JSON.stringify(field));
      }

      const insertDevice = this.db.prepare(`
        INSERT INTO home_memory_devices (id, home_id, run_id, room_id, payload_json)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const device of Object.values(input.memory.devices)) {
        insertDevice.run(device.deviceId, homeId, runId, device.roomId, JSON.stringify(device));
      }

      const insertRoom = this.db.prepare(`
        INSERT INTO home_memory_rooms (id, home_id, run_id, payload_json)
        VALUES (?, ?, ?, ?)
      `);
      for (const room of Object.values(input.memory.rooms)) {
        insertRoom.run(room.roomId, homeId, runId, JSON.stringify(room));
      }

      const insertEpisode = this.db.prepare(`
        INSERT INTO home_memory_episodes (id, home_id, run_id, kind, status, updated_sim_time, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const episode of Object.values(input.memory.episodes)) {
        insertEpisode.run(episode.id, episode.homeId, episode.runId, episode.kind, episode.status, episode.updatedSimTime, JSON.stringify(episode));
      }

      const insertActivityEpisode = this.db.prepare(`
        INSERT INTO home_memory_activity_episodes (id, home_id, run_id, kind, updated_sim_time, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const episode of input.memory.activityEpisodes) {
        insertActivityEpisode.run(episode.id, episode.homeId, episode.runId, episode.kind, episode.updatedSimTime, JSON.stringify(episode));
      }

      const insertDaily = this.db.prepare(`
        INSERT INTO home_memory_daily_summaries (id, home_id, run_id, payload_json)
        VALUES (?, ?, ?, ?)
      `);
      for (const summary of Object.values(input.memory.dailySummaries)) {
        insertDaily.run(summary.date, summary.homeId, summary.runId, JSON.stringify(summary));
      }

      const insertWeekly = this.db.prepare(`
        INSERT INTO home_memory_weekly_summaries (id, home_id, run_id, payload_json)
        VALUES (?, ?, ?, ?)
      `);
      for (const summary of Object.values(input.memory.weeklySummaries)) {
        insertWeekly.run(summary.week, summary.homeId, summary.runId, JSON.stringify(summary));
      }

      const insertSemantic = this.db.prepare(`
        INSERT INTO home_memory_semantic_signals (id, home_id, run_id, type, updated_at, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const signal of input.memory.semanticSignals) {
        insertSemantic.run(signal.id, signal.homeId, signal.runId, signal.type, signal.updatedAt, JSON.stringify(signal));
      }

      const insertHypothesis = this.db.prepare(`
        INSERT INTO home_memory_profile_hypotheses
          (id, home_id, run_id, type, summary, confidence, updated_at, evidence_ids_json, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const hypothesis of uniqueById(input.hypotheses)) {
        insertHypothesis.run(
          hypothesis.id,
          homeId,
          runId,
          hypothesis.type,
          hypothesis.summary,
          hypothesis.confidence,
          hypothesis.updatedAt,
          JSON.stringify(hypothesis.evidence.map((evidence) => evidence.id)),
          JSON.stringify(hypothesis)
        );
      }

      const insertPortraitSection = this.db.prepare(`
        INSERT INTO home_memory_portrait_sections
          (id, home_id, run_id, section_id, summary, confidence, evidence_ids_json, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const section of input.portrait.sections) {
        insertPortraitSection.run(
          `${runId}:${section.id}`,
          input.portrait.homeId ?? homeId,
          input.portrait.runId ?? runId,
          section.id,
          section.summary,
          section.confidence,
          JSON.stringify(section.evidenceIds),
          JSON.stringify(section)
        );
      }
    });
    transaction();
    return {
      homeId,
      runId,
      coveredSequence: input.coveredSequence,
      reducerVersion: input.reducerVersion,
      schemaVersion: input.schemaVersion,
      materializedAt
    };
  }

  getRun(homeId: string, runId: string): HomeMemoryRunRecord | null {
    const row = this.db.prepare(`
      SELECT home_id, run_id, covered_sequence, reducer_version, schema_version, materialized_at
      FROM home_memory_runs
      WHERE home_id = ? AND run_id = ?
    `).get(homeId, runId) as HomeMemoryRunRow | undefined;
    return row ? toRunRecord(row) : null;
  }

  listRuns(homeId?: string): HomeMemoryRunRecord[] {
    const rows = homeId
      ? this.db.prepare(`
        SELECT home_id, run_id, covered_sequence, reducer_version, schema_version, materialized_at
        FROM home_memory_runs
        WHERE home_id = ?
        ORDER BY materialized_at DESC
      `).all(homeId) as HomeMemoryRunRow[]
      : this.db.prepare(`
        SELECT home_id, run_id, covered_sequence, reducer_version, schema_version, materialized_at
        FROM home_memory_runs
        ORDER BY materialized_at DESC
      `).all() as HomeMemoryRunRow[];
    return rows.map(toRunRecord);
  }

  listEvidence(query: HomeMemoryListQuery): { items: StoredHomeMemoryEvidence[] } {
    const rows = this.db.prepare(`
      SELECT payload_json
      FROM home_memory_evidence
      WHERE home_id = ? AND run_id = ?
      ORDER BY sequence DESC
      LIMIT ?
    `).all(query.homeId, query.runId, query.limit ?? 50) as Array<{ payload_json: string }>;
    return {
      items: rows.map((row) => {
        const payload = JSON.parse(row.payload_json) as MemoryEvidence;
        return { ...payload, payload };
      })
    };
  }

  listProfileHypotheses(query: HomeMemoryListQuery): { items: StoredHomeMemoryHypothesis[] } {
    const rows = this.db.prepare(`
      SELECT id, home_id, run_id, type, summary, confidence, updated_at, evidence_ids_json, payload_json
      FROM home_memory_profile_hypotheses
      WHERE home_id = ? AND run_id = ?
      ORDER BY confidence DESC, id ASC
      LIMIT ?
    `).all(query.homeId, query.runId, query.limit ?? 100) as HomeMemoryHypothesisRow[];
    return { items: rows.map(toHypothesisRecord) };
  }

  listPortraitSections(query: Omit<HomeMemoryListQuery, 'limit'>): { items: StoredHomeMemoryPortraitSection[] } {
    const rows = this.db.prepare(`
      SELECT id, home_id, run_id, section_id, summary, confidence, evidence_ids_json, payload_json
      FROM home_memory_portrait_sections
      WHERE home_id = ? AND run_id = ?
      ORDER BY section_id ASC
    `).all(query.homeId, query.runId) as HomeMemoryPortraitSectionRow[];
    return { items: rows.map(toPortraitSectionRecord) };
  }

  hasSource(sourceType: string, sourceId: string, homeId: string, runId?: string | null): boolean {
    if (sourceType === 'home_memory_evidence') {
      return Boolean(this.sourceExists('home_memory_evidence', sourceId, homeId, runId));
    }
    if (sourceType === 'home_memory_hypothesis') {
      return Boolean(this.sourceExists('home_memory_profile_hypotheses', sourceId, homeId, runId));
    }
    if (sourceType === 'home_memory_portrait_section') {
      return Boolean(this.sourceExists('home_memory_portrait_sections', sourceId, homeId, runId));
    }
    return false;
  }

  clearRun(homeId: string, runId: string): boolean {
    const existing = this.getRun(homeId, runId);
    if (!existing) {
      return false;
    }
    const transaction = this.db.transaction(() => this.deleteRunRows(homeId, runId));
    transaction();
    return true;
  }

  clearAll(): void {
    const transaction = this.db.transaction(() => {
      for (const table of homeMemoryMaterializedTables()) {
        this.db.prepare(`DELETE FROM ${table}`).run();
      }
    });
    transaction();
  }

  close(): void {
    this.db.close();
  }

  private sourceExists(table: string, sourceId: string, homeId: string, runId?: string | null): boolean {
    const row = runId
      ? this.db.prepare(`SELECT 1 AS found FROM ${table} WHERE id = ? AND home_id = ? AND run_id = ? LIMIT 1`).get(sourceId, homeId, runId)
      : this.db.prepare(`SELECT 1 AS found FROM ${table} WHERE id = ? AND home_id = ? LIMIT 1`).get(sourceId, homeId);
    return Boolean(row);
  }

  private deleteRunRows(homeId: string, runId: string): void {
    for (const table of homeMemoryMaterializedTables()) {
      this.db.prepare(`DELETE FROM ${table} WHERE home_id = ? AND run_id = ?`).run(homeId, runId);
    }
  }
}

interface HomeMemoryRunRow {
  home_id: string;
  run_id: string;
  covered_sequence: number;
  reducer_version: string;
  schema_version: number;
  materialized_at: string;
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

interface HomeMemoryPortraitSectionRow {
  id: string;
  home_id: string;
  run_id: string;
  section_id: string;
  summary: string;
  confidence: number;
  evidence_ids_json: string;
  payload_json: string;
}

function toRunRecord(row: HomeMemoryRunRow): HomeMemoryRunRecord {
  return {
    homeId: row.home_id,
    runId: row.run_id,
    coveredSequence: row.covered_sequence,
    reducerVersion: row.reducer_version,
    schemaVersion: row.schema_version,
    materializedAt: row.materialized_at
  };
}

function toHypothesisRecord(row: HomeMemoryHypothesisRow): StoredHomeMemoryHypothesis {
  return {
    id: row.id,
    homeId: row.home_id,
    runId: row.run_id,
    type: row.type,
    summary: row.summary,
    confidence: row.confidence,
    updatedAt: row.updated_at,
    evidenceIds: JSON.parse(row.evidence_ids_json) as string[],
    payload: JSON.parse(row.payload_json) as ProfileHypothesis
  };
}

function toPortraitSectionRecord(row: HomeMemoryPortraitSectionRow): StoredHomeMemoryPortraitSection {
  return {
    id: row.id,
    homeId: row.home_id,
    runId: row.run_id,
    sectionId: row.section_id,
    summary: row.summary,
    confidence: row.confidence,
    evidenceIds: JSON.parse(row.evidence_ids_json) as string[],
    payload: JSON.parse(row.payload_json) as HouseholdPortrait['sections'][number]
  };
}

function collectUniqueEvidence(memory: HomeMemory): MemoryEvidence[] {
  const evidence = [
    ...memory.recentEvents,
    ...Object.values(memory.rooms).flatMap((room) => room.recentEvents),
    ...Object.values(memory.devices).flatMap((device) => device.recentEvents),
    ...Object.values(memory.fields).flatMap((field) => field.recentEvents)
  ];
  return [...new Map(evidence.map((item) => [item.id, item])).values()]
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function homeMemoryMaterializedTables(): string[] {
  return [
    'home_memory_runs',
    'home_memory_evidence',
    'home_memory_fields',
    'home_memory_devices',
    'home_memory_rooms',
    'home_memory_episodes',
    'home_memory_activity_episodes',
    'home_memory_daily_summaries',
    'home_memory_weekly_summaries',
    'home_memory_semantic_signals',
    'home_memory_profile_hypotheses',
    'home_memory_portrait_sections',
    'home_memory_materializations'
  ];
}

function requiredMemoryId(value: string | null, label: string): string {
  if (!value) {
    throw new Error(`Cannot materialize Home Memory without ${label}`);
  }
  return value;
}
