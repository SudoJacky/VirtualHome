import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentProfileDatabase } from '../src/server/agentProfileStore';

describe('agent profile database', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createDb(): AgentProfileDatabase {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-agent-profile-'));
    dirs.push(dir);
    return new AgentProfileDatabase(path.join(dir, 'agent-profile.db'));
  }

  it('creates an entry with source, structured index, time window, FTS, and audit event', () => {
    const db = createDb();

    const entry = db.createEntry({
      homeId: 'home_001',
      subjectType: 'household',
      subjectId: 'household',
      entryType: 'conclusion',
      title: 'Weekday breakfast routine',
      summary: '用户一般工作日早上八点吃早饭。',
      content: {
        claim: '用户一般工作日早上八点吃早饭。',
        reasoning: 'Kitchen activity appears around weekday breakfast time.',
        missingEvidence: ['More observed days would improve confidence.'],
        alternatives: ['Could be one-off kitchen activity.']
      },
      index: {
        claimType: 'routine',
        predicate: 'eats_breakfast',
        objectType: 'activity',
        objectId: 'breakfast'
      },
      timeWindows: [{
        dayType: 'weekday',
        daysOfWeek: [1, 2, 3, 4, 5],
        timeStart: '07:30',
        timeEnd: '08:30',
        timezone: 'Asia/Singapore',
        recurrence: 'weekly'
      }],
      sources: [{
        sourceType: 'home_memory_evidence',
        sourceId: 'evidence_breakfast_1',
        homeId: 'home_001',
        runId: 'run_a',
        sequence: 42,
        quoteOrObservation: 'Kitchen motion and stove power around 08:00.',
        weight: 0.8
      }],
      confidence: 0.72,
      stability: 'working',
      createdBy: 'agent'
    });

    expect(db.getEntry(entry.id, { includeSources: true })).toMatchObject({
      id: entry.id,
      summary: '用户一般工作日早上八点吃早饭。',
      sources: [expect.objectContaining({
        sourceType: 'home_memory_evidence',
        sourceId: 'evidence_breakfast_1'
      })]
    });
    expect(db.queryEntries({
      homeId: 'home_001',
      structured: {
        claimTypes: ['routine'],
        predicates: ['eats_breakfast'],
        dayType: 'weekday',
        time: '08:05',
        statuses: ['candidate', 'active']
      },
      text: '早餐习惯',
      includeSources: true
    }).items[0]).toMatchObject({
      entryId: entry.id,
      matchChannels: expect.arrayContaining(['structured', 'fts']),
      sources: [expect.objectContaining({ sourceId: 'evidence_breakfast_1' })]
    });
    expect(db.getEntryEvents(entry.id)).toEqual([
      expect.objectContaining({ eventType: 'created', actor: 'agent' })
    ]);

    db.close();
  });

  it('rejects executable profile entries without a source', () => {
    const db = createDb();

    expect(() => db.createEntry({
      homeId: 'home_001',
      subjectType: 'household',
      subjectId: 'household',
      entryType: 'conclusion',
      title: 'Unsupported conclusion',
      summary: 'No source.',
      content: { claim: 'No source.' },
      index: {
        claimType: 'routine',
        predicate: 'unknown'
      },
      sources: [],
      confidence: 0.5,
      stability: 'working',
      createdBy: 'agent'
    })).toThrow(/source/i);

    db.close();
  });

  it('rejects sources from a different home on create', () => {
    const db = createDb();

    try {
      expect(() => db.createEntry({
        homeId: 'home_001',
        subjectType: 'household',
        subjectId: 'household',
        entryType: 'conclusion',
        title: 'Cross-home source',
        summary: 'This should not be accepted.',
        content: { claim: 'This should not be accepted.' },
        index: {
          claimType: 'identity',
          predicate: 'household_pattern'
        },
        sources: [{
          sourceType: 'home_memory_hypothesis',
          sourceId: 'hypothesis_1',
          homeId: 'home_002'
        }],
        confidence: 0.5,
        stability: 'working',
        createdBy: 'agent'
      })).toThrow(/homeId/i);
    } finally {
      db.close();
    }
  });

  it('supports CRUD status changes and deletion with audit', () => {
    const db = createDb();
    const entry = db.createEntry({
      homeId: 'home_001',
      subjectType: 'household',
      subjectId: 'household',
      entryType: 'question',
      title: 'Validate breakfast routine',
      summary: 'Need more evidence about weekday breakfast.',
      content: { question: 'Does weekday breakfast happen around 08:00?' },
      sources: [],
      confidence: 0.1,
      stability: 'volatile',
      createdBy: 'agent'
    });

    const updated = db.updateEntryStatus(entry.id, {
      status: 'archived',
      actor: 'agent',
      reason: 'Question is no longer relevant.'
    });

    expect(updated.status).toBe('archived');
    expect(db.deleteEntry(entry.id)).toBe(true);
    expect(db.getEntry(entry.id)).toBeNull();

    db.close();
  });

  it('updates entry content, adds sources, and finds updated text through search', () => {
    const db = createDb();
    const entry = db.createEntry({
      homeId: 'home_001',
      subjectType: 'household',
      subjectId: 'household',
      entryType: 'question',
      title: 'Validate breakfast routine',
      summary: 'Need more evidence about weekday breakfast.',
      content: { question: 'Does weekday breakfast happen around 08:00?' },
      sources: [],
      confidence: 0.1,
      stability: 'volatile',
      createdBy: 'agent'
    });

    const updated = db.updateEntry(entry.id, {
      title: 'Updated breakfast note',
      summary: 'Breakfast routine should be reviewed after the next week.',
      content: { question: 'Review the breakfast routine after more weekday evidence.' },
      actor: 'agent',
      reason: 'Clarify follow-up timing.'
    });
    const source = db.addSource(entry.id, {
      sourceType: 'user_statement',
      sourceId: 'message_1',
      homeId: 'home_001',
      quoteOrObservation: 'User asked to keep tracking breakfast habits.',
      weight: 0.6
    }, {
      actor: 'agent',
      reason: 'Attach user request as provenance.'
    });

    expect(updated.summary).toContain('next week');
    expect(source.sourceId).toBe('message_1');
    expect(db.queryEntries({
      homeId: 'home_001',
      text: 'breakfast next week',
      includeSources: true
    }).items[0]).toMatchObject({
      entryId: entry.id,
      matchChannels: ['fts'],
      sources: [expect.objectContaining({ sourceId: 'message_1' })]
    });
    expect(db.getEntryEvents(entry.id).map((event) => event.eventType)).toEqual([
      'created',
      'updated',
      'source_added'
    ]);

    db.close();
  });
});
