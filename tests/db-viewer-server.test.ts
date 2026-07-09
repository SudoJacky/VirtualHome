import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentProfileDatabase } from '../src/server/agentProfileStore';
import { DeviceEventDatabase } from '../src/server/deviceEventStore';
import { HomeMemoryDatabase } from '../src/server/homeMemoryStore';
import { createDbViewerServer } from '../src/tools/dbViewer/server';

describe('db viewer server', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exposes read-only viewer APIs and validates query params', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-db-viewer-api-'));
    dirs.push(dir);
    const homeMemoryDatabasePath = path.join(dir, 'home-memory.db');
    const agentProfileDatabasePath = path.join(dir, 'agent-profile.db');
    const deviceEventsDatabasePath = path.join(dir, 'device-events.db');
    const homeMemoryDb = new HomeMemoryDatabase(homeMemoryDatabasePath);
    const agentProfileDb = new AgentProfileDatabase(agentProfileDatabasePath);
    const deviceEventDb = new DeviceEventDatabase(deviceEventsDatabasePath);
    homeMemoryDb.close();
    deviceEventDb.rebuildFromEvents({
      inputPath: 'test-input.json',
      inputSha256: 'sha256-test',
      schemaVersion: 1,
      events: [{
        id: 'value_001',
        sourceEventId: 'source_001',
        sourceEventType: 'DeviceTelemetry',
        runId: 'run_a',
        sequence: 1,
        ts: '2026-06-22T00:00:00.000Z',
        simTime: '2026-06-22T08:00:00',
        homeId: 'home_001',
        roomId: 'kitchen',
        deviceId: 'coffee_maker_01',
        deviceType: 'coffee_maker',
        field: 'powerW',
        value: 850
      }]
    });
    deviceEventDb.recordQueryAudit({
      id: 'query_breakfast_window',
      homeId: 'home_001',
      runId: 'run_a',
      query: { q: 'coffee 850' },
      resultCount: 1,
      summary: 'Coffee maker query.',
      createdBy: 'agent'
    });
    deviceEventDb.close();
    const entry = agentProfileDb.createEntry({
      homeId: 'home_001',
      subjectType: 'household',
      subjectId: 'household',
      entryType: 'question',
      title: 'Validate breakfast',
      summary: 'Need more breakfast evidence.',
      content: { question: 'Is breakfast near 08:00?' },
      sources: [],
      confidence: 0.1,
      stability: 'volatile',
      createdBy: 'agent'
    });
    agentProfileDb.close();

    const app = createDbViewerServer({
      homeMemoryDatabasePath,
      agentProfileDatabasePath,
      deviceEventsDatabasePath,
      serveClient: false
    });

    try {
      const health = await app.inject({ method: 'GET', url: '/api/db-viewer/health' });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toMatchObject({ status: 'ok', deviceEventsAvailable: true });

      const entries = await app.inject({
        method: 'GET',
        url: '/api/db-viewer/agent-profile/entries?homeId=home_001'
      });
      expect(entries.statusCode).toBe(200);
      expect(entries.json().items[0]).toMatchObject({ id: entry.id, title: 'Validate breakfast' });

      const detail = await app.inject({
        method: 'GET',
        url: `/api/db-viewer/agent-profile/entries/${entry.id}`
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({ id: entry.id, events: [expect.objectContaining({ eventType: 'created' })] });

      const deviceEvents = await app.inject({
        method: 'GET',
        url: '/api/db-viewer/device-events?homeId=home_001&runId=run_a&q=coffee%20850'
      });
      expect(deviceEvents.statusCode).toBe(200);
      expect(deviceEvents.json().items[0]).toMatchObject({ id: 'value_001', value: 850 });

      const queryAudit = await app.inject({
        method: 'GET',
        url: '/api/db-viewer/device-event-queries/query_breakfast_window'
      });
      expect(queryAudit.statusCode).toBe(200);
      expect(queryAudit.json()).toMatchObject({ id: 'query_breakfast_window', resultCount: 1 });

      const invalid = await app.inject({
        method: 'GET',
        url: '/api/db-viewer/agent-profile/entries?limit=0'
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error.code).toBe('VALIDATION_ERROR');
    } finally {
      await app.close();
    }
  });
});
