import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';
import { HomeMemoryDatabase } from '../src/server/homeMemoryStore';
import { createHomeProfileHypotheses } from '../src/web/homeProfiler';
import { createHouseholdPortrait } from '../src/server/memoryQuery';

describe('home memory database', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createDb(): HomeMemoryDatabase {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-home-memory-'));
    dirs.push(dir);
    return new HomeMemoryDatabase(path.join(dir, 'home-memory.db'));
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

  it('materializes home memory layers and can clear a run', () => {
    const db = createDb();
    const memory = reduceDeviceEvents(createHomeMemory(), [
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
    ]);
    const hypotheses = createHomeProfileHypotheses(memory);
    const portrait = createHouseholdPortrait(memory);

    db.materializeMemory({
      memory,
      hypotheses,
      portrait,
      coveredSequence: 2,
      reducerVersion: 'test-reducer',
      schemaVersion: 1
    });

    expect(db.getRun('home_001', 'run_a')).toMatchObject({
      homeId: 'home_001',
      runId: 'run_a',
      coveredSequence: 2,
      reducerVersion: 'test-reducer'
    });
    expect(db.listEvidence({ homeId: 'home_001', runId: 'run_a', limit: 10 }).items.map((item) => item.id))
      .toEqual(expect.arrayContaining(['kitchen_motion', 'stove_power']));
    expect(db.listProfileHypotheses({ homeId: 'home_001', runId: 'run_a', limit: 50 }).items.length)
      .toBeGreaterThan(0);
    expect(db.listPortraitSections({ homeId: 'home_001', runId: 'run_a' }).items.map((item) => item.sectionId))
      .toContain('daily_rhythm');

    expect(db.clearRun('home_001', 'run_a')).toBe(true);
    expect(db.getRun('home_001', 'run_a')).toBeNull();

    db.close();
  });
});
