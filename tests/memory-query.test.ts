import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';
import { createMemorySummary } from '../src/server/memoryQuery';

function deviceEvent(overrides: Partial<DeviceValueEvent> = {}): DeviceValueEvent {
  return {
    id: 'device_event_1',
    sourceEventId: 'source_event_1',
    sourceEventType: 'DeviceTelemetry',
    runId: 'run_a',
    sequence: 1,
    ts: '2026-06-22T00:00:00.000Z',
    simTime: '2026-06-22T08:00:00',
    homeId: 'home_1',
    roomId: 'kitchen',
    deviceId: 'kitchen_motion_01',
    deviceType: 'motion_sensor',
    field: 'motion',
    value: true,
    ...overrides
  };
}

describe('memory query', () => {
  it('includes derived household activity episodes in memory summary', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'entry_unlock',
        sourceEventId: 'source_entry_unlock',
        sequence: 1,
        ts: '2026-06-22T10:00:00.000Z',
        simTime: '2026-06-22T18:00:00',
        roomId: 'entrance',
        deviceId: 'front_lock_01',
        deviceType: 'door_lock',
        field: 'lock',
        value: 'unlocked'
      }),
      deviceEvent({
        id: 'kitchen_motion',
        sourceEventId: 'source_kitchen_motion',
        sequence: 2,
        ts: '2026-06-22T10:08:00.000Z',
        simTime: '2026-06-22T18:08:00',
        roomId: 'kitchen',
        deviceId: 'kitchen_motion_01',
        deviceType: 'motion_sensor',
        field: 'motion',
        value: true
      })
    ]);

    expect(createMemorySummary(memory).activityEpisodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'return_home',
        roomIds: ['entrance', 'kitchen'],
        evidenceIds: ['entry_unlock', 'kitchen_motion']
      })
    ]));
  });
});
