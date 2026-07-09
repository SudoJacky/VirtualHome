import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentProfileDatabase } from '../src/server/agentProfileStore';
import { DeviceEventDatabase } from '../src/server/deviceEventStore';
import { HomeMemoryDatabase } from '../src/server/homeMemoryStore';
import { createHouseholdPortrait } from '../src/server/memoryQuery';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';
import { createHomeProfileHypotheses } from '../src/web/homeProfiler';
import { DbViewerStore } from '../src/tools/dbViewer/store';

describe('db viewer store', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads agent profile and home memory databases without mutating them', () => {
    const fixture = createViewerFixture();
    const viewer = new DbViewerStore({
      homeMemoryDatabasePath: fixture.homeMemoryDatabasePath,
      agentProfileDatabasePath: fixture.agentProfileDatabasePath,
      deviceEventsDatabasePath: fixture.deviceEventsDatabasePath
    });

    try {
      expect(viewer.getHealth()).toMatchObject({
        status: 'ok',
        homeMemoryDatabasePath: fixture.homeMemoryDatabasePath,
        agentProfileDatabasePath: fixture.agentProfileDatabasePath,
        deviceEventsDatabasePath: fixture.deviceEventsDatabasePath,
        deviceEventsAvailable: true
      });

      const entries = viewer.listAgentProfileEntries({
        homeId: 'home_001',
        text: 'breakfast',
        status: 'active',
        limit: 10
      });
      expect(entries.items).toHaveLength(1);
      expect(entries.items[0]).toMatchObject({
        id: fixture.entryId,
        title: 'Weekday breakfast routine',
        status: 'active'
      });

      const detail = viewer.getAgentProfileEntry(fixture.entryId);
      expect(detail).toMatchObject({
        id: fixture.entryId,
        sources: expect.arrayContaining([expect.objectContaining({
          sourceType: 'home_memory_hypothesis',
          sourceId: fixture.hypothesisId
        }), expect.objectContaining({
          sourceType: 'device_event_query',
          sourceId: fixture.queryId
        })]),
        events: [expect.objectContaining({ eventType: 'created' })],
        claimIndex: expect.objectContaining({ predicate: 'eats_breakfast' }),
        timeWindows: [expect.objectContaining({ dayType: 'weekday' })]
      });

      expect(viewer.searchAgentProfileEntries({
        homeId: 'home_001',
        q: 'breakfast routine',
        limit: 5
      }).items[0]).toMatchObject({
        id: fixture.entryId,
        matchChannels: ['fts']
      });

      expect(viewer.resolveHomeMemorySource({
        sourceType: 'home_memory_hypothesis',
        sourceId: fixture.hypothesisId,
        homeId: 'home_001',
        runId: 'run_a'
      })).toMatchObject({
        status: 'found',
        sourceType: 'home_memory_hypothesis',
        item: expect.objectContaining({ id: fixture.hypothesisId })
      });
      expect(viewer.resolveHomeMemorySource({
        sourceType: 'device_event_query',
        sourceId: fixture.queryId,
        homeId: 'home_001',
        runId: 'run_a'
      })).toMatchObject({
        status: 'found',
        sourceType: 'device_event_query',
        item: expect.objectContaining({ id: fixture.queryId, resultCount: 2 })
      });

      expect(viewer.resolveHomeMemorySource({
        sourceType: 'home_memory_hypothesis',
        sourceId: 'missing_hypothesis',
        homeId: 'home_001',
        runId: 'run_a'
      })).toEqual({
        status: 'missing',
        sourceType: 'home_memory_hypothesis',
        sourceId: 'missing_hypothesis',
        homeId: 'home_001',
        runId: 'run_a'
      });

      expect(viewer.listHomeMemoryRuns({ homeId: 'home_001' }).items[0]).toMatchObject({
        homeId: 'home_001',
        runId: 'run_a'
      });
      expect(viewer.listHomeMemoryEvidence({ homeId: 'home_001', runId: 'run_a', limit: 10 }).items.length)
        .toBeGreaterThan(0);
      expect(viewer.listHomeMemoryHypotheses({ homeId: 'home_001', runId: 'run_a', limit: 10 }).items[0])
        .toMatchObject({ id: fixture.hypothesisId });
      expect(viewer.listHomeMemoryPortraitSections({ homeId: 'home_001', runId: 'run_a' }).items.length)
        .toBeGreaterThan(0);
      expect(viewer.listDeviceEvents({
        homeId: 'home_001',
        runId: 'run_a',
        roomId: 'kitchen',
        q: 'stove 900'
      }).items[0]).toMatchObject({ id: 'stove_power', value: 900 });
      expect(viewer.listDeviceEventsBySource('source_stove_power').items.map((item) => item.id)).toEqual(['stove_power']);
      expect(viewer.listDeviceEventsAroundSource('source_stove_power', { windowMinutes: 10 }).items.map((item) => item.id))
        .toEqual(['kitchen_motion', 'stove_power']);
      expect(viewer.getDeviceEventQuery(fixture.queryId)).toMatchObject({ id: fixture.queryId, resultCount: 2 });
    } finally {
      viewer.close();
    }
  });

  function createViewerFixture(): {
    homeMemoryDatabasePath: string;
    agentProfileDatabasePath: string;
    deviceEventsDatabasePath: string;
    entryId: string;
    hypothesisId: string;
    queryId: string;
  } {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-db-viewer-'));
    dirs.push(dir);
    const homeMemoryDatabasePath = path.join(dir, 'home-memory.db');
    const agentProfileDatabasePath = path.join(dir, 'agent-profile.db');
    const deviceEventsDatabasePath = path.join(dir, 'device-events.db');
    const events = [
      deviceEvent(),
      deviceEvent({
        id: 'stove_power',
        sourceEventId: 'source_stove_power',
        sequence: 2,
        simTime: '2026-06-22T08:05:00',
        deviceId: 'stove_01',
        deviceType: 'stove',
        field: 'powerW',
        value: 900
      })
    ];
    const deviceEventDb = new DeviceEventDatabase(deviceEventsDatabasePath);
    deviceEventDb.rebuildFromEvents({
      inputPath: 'test-input.json',
      inputSha256: 'sha256-test',
      schemaVersion: 1,
      events
    });
    const query = deviceEventDb.recordQueryAudit({
      id: 'query_breakfast_window',
      homeId: 'home_001',
      runId: 'run_a',
      query: { roomId: 'kitchen', fromSimTime: '2026-06-22T07:30:00', toSimTime: '2026-06-22T08:30:00' },
      resultCount: 2,
      summary: 'Breakfast window kitchen query.',
      createdBy: 'agent'
    });
    deviceEventDb.close();

    const memory = reduceDeviceEvents(createHomeMemory(), events);
    const hypotheses = createHomeProfileHypotheses(memory);
    const portrait = createHouseholdPortrait(memory);
    const homeMemoryDb = new HomeMemoryDatabase(homeMemoryDatabasePath);
    homeMemoryDb.materializeMemory({
      memory,
      hypotheses,
      portrait,
      coveredSequence: 2,
      reducerVersion: 'db-viewer-test',
      schemaVersion: 1
    });
    const hypothesisId = homeMemoryDb.listProfileHypotheses({
      homeId: 'home_001',
      runId: 'run_a',
      limit: 10
    }).items[0].id;
    homeMemoryDb.close();

    const agentProfileDb = new AgentProfileDatabase(agentProfileDatabasePath);
    const entry = agentProfileDb.createEntry({
      homeId: 'home_001',
      subjectType: 'household',
      subjectId: 'household',
      entryType: 'conclusion',
      title: 'Weekday breakfast routine',
      summary: 'The household usually has breakfast near 08:00 on weekdays.',
      content: {
        claim: 'The household usually has breakfast near 08:00 on weekdays.',
        reasoning: 'Home Memory hypothesis points to weekday morning kitchen activity.'
      },
      index: {
        claimType: 'routine',
        predicate: 'eats_breakfast',
        objectType: 'activity',
        objectId: 'breakfast'
      },
      timeWindows: [{
        dayType: 'weekday',
        timeStart: '07:30',
        timeEnd: '08:30',
        timezone: 'Asia/Singapore',
        recurrence: 'weekly'
      }],
      sources: [{
        sourceType: 'home_memory_hypothesis',
        sourceId: hypothesisId,
        homeId: 'home_001',
        runId: 'run_a',
        quoteOrObservation: 'Materialized Home Memory breakfast hypothesis.',
        weight: 0.8
      }, {
        sourceType: 'device_event_query',
        sourceId: query.id,
        homeId: 'home_001',
        runId: 'run_a',
        quoteOrObservation: 'Queried raw kitchen events around breakfast.',
        weight: 0.7
      }],
      status: 'active',
      confidence: 0.72,
      stability: 'working',
      createdBy: 'agent'
    });
    agentProfileDb.close();

    return {
      homeMemoryDatabasePath,
      agentProfileDatabasePath,
      deviceEventsDatabasePath,
      entryId: entry.id,
      hypothesisId,
      queryId: query.id
    };
  }

  function deviceEvent(overrides: Partial<DeviceValueEvent> = {}): DeviceValueEvent {
    return {
      id: 'kitchen_motion',
      sourceEventId: 'source_kitchen_motion',
      sourceEventType: 'DeviceTelemetry',
      runId: 'run_a',
      sequence: 1,
      ts: '2026-06-22T00:00:00.000Z',
      simTime: '2026-06-22T08:00:00',
      homeId: 'home_001',
      roomId: 'kitchen',
      deviceId: 'kitchen_motion_01',
      deviceType: 'motion_sensor',
      field: 'motion',
      value: true,
      ...overrides
    };
  }
});
