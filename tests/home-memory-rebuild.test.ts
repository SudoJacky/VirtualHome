import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/server/deviceEventStream';
import { AgentProfileDatabase } from '../src/server/agentProfileStore';
import { DeviceEventDatabase } from '../src/server/deviceEventStore';
import { HomeMemoryDatabase } from '../src/server/homeMemoryStore';
import { rebuildHomeMemoryFromDeviceEvents } from '../src/sim/evaluation/homeMemoryRebuild';

describe('home memory rebuild from device events', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createPaths(): {
    dir: string;
    inputPath: string;
    deviceEventsDatabasePath: string;
    homeMemoryDatabasePath: string;
    agentProfileDatabasePath: string;
  } {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-memory-rebuild-'));
    dirs.push(dir);
    return {
      dir,
      inputPath: path.join(dir, 'home-memory-days.json'),
      deviceEventsDatabasePath: path.join(dir, 'device-events.db'),
      homeMemoryDatabasePath: path.join(dir, 'home-memory.db'),
      agentProfileDatabasePath: path.join(dir, 'agent-profile.db')
    };
  }

  function event(overrides: Partial<DeviceValueEvent> = {}): DeviceValueEvent {
    return {
      id: 'value_001',
      sourceEventId: 'source_001',
      sourceEventType: 'DeviceTelemetry',
      runId: 'run_rebuild',
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

  function writeDataset(inputPath: string, events: DeviceValueEvent[]): void {
    writeFileSync(inputPath, JSON.stringify({
      metadata: {
        schemaVersion: 1,
        source: '/ws/device-events',
        runId: 'run_rebuild',
        eventCount: events.length,
        sequenceRange: {
          from: events[0]?.sequence ?? 0,
          to: events[events.length - 1]?.sequence ?? 0
        }
      },
      events
    }), 'utf8');
  }

  it('rebuilds device events and home memory while only ensuring agent profile schema', () => {
    const paths = createPaths();
    writeDataset(paths.inputPath, [
      event(),
      event({
        id: 'value_002',
        sourceEventId: 'source_002',
        sequence: 2,
        simTime: '2026-06-22T08:05:00',
        deviceId: 'stove_01',
        deviceType: 'stove',
        field: 'powerW',
        value: 900
      })
    ]);

    const report = rebuildHomeMemoryFromDeviceEvents(paths);

    expect(report).toMatchObject({
      importedDeviceEventCount: 2,
      homeId: 'home_001',
      runId: 'run_rebuild'
    });

    const deviceDb = new DeviceEventDatabase(paths.deviceEventsDatabasePath);
    const homeDb = new HomeMemoryDatabase(paths.homeMemoryDatabasePath);
    const agentDb = new AgentProfileDatabase(paths.agentProfileDatabasePath);
    try {
      expect(deviceDb.listEvents({ homeId: 'home_001', runId: 'run_rebuild' }).items).toHaveLength(2);
      expect(homeDb.getRun('home_001', 'run_rebuild')).toMatchObject({ coveredSequence: 2 });
      expect(homeDb.listEvidence({ homeId: 'home_001', runId: 'run_rebuild' }).items.map((item) => item.sourceEventId))
        .toEqual(expect.arrayContaining(['source_001', 'source_002']));
      expect(agentDb.listEntries({ homeId: 'home_001' }).items).toEqual([]);
    } finally {
      deviceDb.close();
      homeDb.close();
      agentDb.close();
    }
  });

  it('validates input before clearing existing databases', () => {
    const paths = createPaths();
    writeDataset(paths.inputPath, [event()]);
    rebuildHomeMemoryFromDeviceEvents(paths);

    writeDataset(paths.inputPath, [
      event({ id: 'duplicate_id', sourceEventId: 'bad_source_1' }),
      event({ id: 'duplicate_id', sourceEventId: 'bad_source_2', sequence: 2 })
    ]);

    expect(() => rebuildHomeMemoryFromDeviceEvents(paths)).toThrow(/duplicate/i);

    const deviceDb = new DeviceEventDatabase(paths.deviceEventsDatabasePath);
    const homeDb = new HomeMemoryDatabase(paths.homeMemoryDatabasePath);
    try {
      expect(existsSync(paths.agentProfileDatabasePath)).toBe(true);
      expect(deviceDb.listEvents({ homeId: 'home_001', runId: 'run_rebuild' }).items.map((item) => item.id)).toEqual(['value_001']);
      expect(homeDb.getRun('home_001', 'run_rebuild')).toMatchObject({ coveredSequence: 1 });
    } finally {
      deviceDb.close();
      homeDb.close();
    }
  });
});
