import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/server/deviceEventStream';
import { DeviceEventDatabase } from '../src/server/deviceEventStore';

describe('device event database', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createDb(): DeviceEventDatabase {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-device-events-'));
    dirs.push(dir);
    return new DeviceEventDatabase(path.join(dir, 'device-events.db'));
  }

  function event(overrides: Partial<DeviceValueEvent> = {}): DeviceValueEvent {
    return {
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
      value: 850,
      ...overrides
    };
  }

  it('imports events and supports structured, FTS, source, around-source, aggregate, and audit queries', () => {
    const db = createDb();
    try {
      db.rebuildFromEvents({
        inputPath: 'data/home-memory-days.json',
        inputSha256: 'sha256-test',
        schemaVersion: 1,
        events: [
          event(),
          event({
            id: 'value_002',
            sourceEventId: 'source_002',
            sequence: 2,
            simTime: '2026-06-22T08:05:00',
            deviceId: 'kitchen_motion_01',
            deviceType: 'motion_sensor',
            field: 'motion',
            value: true
          }),
          event({
            id: 'value_003',
            sourceEventId: 'source_003',
            sequence: 3,
            simTime: '2026-06-22T11:30:00',
            roomId: 'living_room',
            deviceId: 'living_room_tv_01',
            deviceType: 'tv',
            field: 'power',
            value: 'off'
          })
        ]
      });

      expect(db.listEvents({
        homeId: 'home_001',
        runId: 'run_a',
        roomId: 'kitchen',
        deviceType: 'coffee_maker',
        field: 'powerW',
        fromSequence: 1,
        toSequence: 1
      }).items.map((item) => item.id)).toEqual(['value_001']);
      expect(db.listEvents({ homeId: 'home_001', runId: 'run_a', q: 'coffee maker 850' }).items[0])
        .toMatchObject({ id: 'value_001', value: 850 });
      expect(db.getEventsBySourceEventId('source_002').items.map((item) => item.id)).toEqual(['value_002']);
      expect(db.getEventsAroundSource({
        sourceEventId: 'source_002',
        windowMinutes: 10
      }).items.map((item) => item.id)).toEqual(['value_001', 'value_002']);
      expect(db.aggregateEvents({
        homeId: 'home_001',
        runId: 'run_a',
        groupBy: 'roomId'
      }).items).toEqual([
        { key: 'kitchen', count: 2 },
        { key: 'living_room', count: 1 }
      ]);

      const audit = db.recordQueryAudit({
        homeId: 'home_001',
        runId: 'run_a',
        query: { roomId: 'kitchen', fromSimTime: '2026-06-22T07:30:00' },
        resultCount: 2,
        summary: 'Breakfast window kitchen query.',
        createdBy: 'agent'
      });
      expect(db.getQuery(audit.id)).toMatchObject({
        id: audit.id,
        resultCount: 2,
        createdBy: 'agent'
      });
      expect(db.hasQuery(audit.id, 'home_001', 'run_a')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('validates duplicate event ids before clearing existing imported rows', () => {
    const db = createDb();
    try {
      db.rebuildFromEvents({
        inputPath: 'first.json',
        inputSha256: 'sha256-first',
        schemaVersion: 1,
        events: [event()]
      });

      expect(() => db.rebuildFromEvents({
        inputPath: 'bad.json',
        inputSha256: 'sha256-bad',
        schemaVersion: 1,
        events: [
          event({ id: 'duplicate_id', sourceEventId: 'bad_source_1' }),
          event({ id: 'duplicate_id', sourceEventId: 'bad_source_2', sequence: 2 })
        ]
      })).toThrow(/duplicate/i);

      expect(db.listEvents({ homeId: 'home_001', runId: 'run_a' }).items.map((item) => item.id)).toEqual(['value_001']);
    } finally {
      db.close();
    }
  });
});
