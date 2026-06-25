import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { estimateHouseholdSizeFromMemory } from '../src/web/homeHouseholdSizeEstimator';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';

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
    deviceId: 'fridge_01',
    deviceType: 'fridge',
    field: 'doorOpen',
    value: false,
    ...overrides
  };
}

describe('home household size estimator', () => {
  it('uses concurrent activity, recurring sleep zones, and routine clusters for a finer resident distribution', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'main_sleep_1',
        sequence: 1,
        simTime: '2026-06-22T23:05:00',
        roomId: 'master_bedroom',
        deviceId: 'master_sleep_01',
        deviceType: 'sleep_sensor',
        field: 'inBed',
        value: true
      }),
      deviceEvent({
        id: 'child_sleep_1',
        sequence: 2,
        simTime: '2026-06-22T23:07:00',
        roomId: 'child_bedroom',
        deviceId: 'child_sleep_01',
        deviceType: 'sleep_sensor',
        field: 'inBed',
        value: true
      }),
      deviceEvent({
        id: 'kitchen_stove_1',
        sequence: 3,
        simTime: '2026-06-23T18:02:00',
        roomId: 'kitchen',
        deviceId: 'stove_01',
        deviceType: 'stove',
        field: 'powerW',
        value: 840
      }),
      deviceEvent({
        id: 'study_co2_1',
        sequence: 4,
        simTime: '2026-06-23T18:04:00',
        roomId: 'study',
        deviceId: 'study_co2_01',
        deviceType: 'air_quality_sensor',
        field: 'co2',
        value: 980
      }),
      deviceEvent({
        id: 'living_motion_1',
        sequence: 5,
        simTime: '2026-06-23T18:06:00',
        roomId: 'living_room',
        deviceId: 'living_motion_01',
        deviceType: 'motion_sensor',
        field: 'motion',
        value: true
      }),
      deviceEvent({
        id: 'bathroom_flow_1',
        sequence: 6,
        simTime: '2026-06-24T07:15:00',
        roomId: 'bathroom',
        deviceId: 'bathroom_water_01',
        deviceType: 'water_flow_sensor',
        field: 'flowLMin',
        value: 4.2
      })
    ]);

    const estimate = estimateHouseholdSizeFromMemory(memory);

    expect(estimate.lowerBound).toBe(3);
    expect(estimate.estimate).toBe(3);
    expect(estimate.confidence).toBeGreaterThan(0.6);
    expect(estimate.features.concurrentActivity.lowerBound).toBe(3);
    expect(estimate.features.recurringSleepZones.rooms).toEqual(['child_bedroom', 'master_bedroom']);
    expect(estimate.features.routineClusters.clusters).toEqual(expect.arrayContaining([
      'meal_activity',
      'study_or_work_activity',
      'shared_evening_activity',
      'bathroom_hygiene_activity'
    ]));
    expect(estimate.distribution[3]).toBeGreaterThan(estimate.distribution[2]);
    expect(estimate.evidence).toEqual(expect.arrayContaining([
      '3-room concurrent activity lower bound',
      '2 recurring sleep zones',
      '6 routine clusters'
    ]));
  });

  it('keeps resident count uncertain for high-volume environment telemetry', () => {
    const events = Array.from({ length: 40 }, (_, index) => deviceEvent({
      id: `temperature_event_${index + 1}`,
      sourceEventId: `source_temperature_${index + 1}`,
      sequence: index + 1,
      simTime: `2026-06-22T08:${String(index).padStart(2, '0')}:00`,
      roomId: ['kitchen', 'living_room', 'study', 'bathroom'][index % 4],
      deviceId: `temperature_${index + 1}`,
      deviceType: 'temperature_sensor',
      field: 'temperature',
      value: 24 + index * 0.01
    }));
    const memory = reduceDeviceEvents(createHomeMemory(), events);

    const estimate = estimateHouseholdSizeFromMemory(memory);

    expect(estimate.lowerBound).toBe(1);
    expect(estimate.estimate).toBe(1);
    expect(estimate.confidence).toBeLessThanOrEqual(0.45);
    expect(estimate.features.environmentContextRatio).toBeGreaterThan(0.9);
    expect(estimate.distribution[1]).toBeGreaterThan(estimate.distribution[3]);
    expect(estimate.evidence).toContain('mostly weak environment context');
  });

  it('uses semantic resident slots as household-size evidence', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'main_sleep',
        sequence: 1,
        simTime: '2026-06-22T23:00:00',
        roomId: 'master_bedroom',
        deviceId: 'sleep_sensor_01',
        deviceType: 'sleep_sensor',
        field: 'inBed',
        value: true
      }),
      deviceEvent({
        id: 'study_work',
        sequence: 2,
        simTime: '2026-06-23T14:00:00',
        roomId: 'study',
        deviceId: 'desk_plug_01',
        deviceType: 'smart_plug',
        field: 'powerW',
        value: 95
      }),
      deviceEvent({
        id: 'living_media',
        sequence: 3,
        simTime: '2026-06-23T20:00:00',
        roomId: 'living_room',
        deviceId: 'tv_01',
        deviceType: 'tv',
        field: 'power',
        value: true
      })
    ]);

    const estimate = estimateHouseholdSizeFromMemory(memory);

    expect(estimate.features.residentSlots).toEqual({
      count: 3,
      slots: ['main_sleep_slot', 'remote_work_slot', 'shared_evening_slot']
    });
    expect(estimate.evidence).toContain('3 resident slots');
    expect(estimate.distribution[2]).toBeGreaterThan(estimate.distribution[1]);
  });

  it('raises a shared main sleep-zone candidate without changing the hard resident lower bound', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'main_sleep',
        sequence: 1,
        simTime: '2026-06-22T23:00:00',
        roomId: 'master_bedroom',
        deviceId: 'master_sleep_01',
        deviceType: 'sleep_sensor',
        field: 'inBed',
        value: true
      }),
      deviceEvent({
        id: 'child_sleep',
        sequence: 2,
        simTime: '2026-06-22T23:05:00',
        roomId: 'child_bedroom',
        deviceId: 'child_sleep_01',
        deviceType: 'sleep_sensor',
        field: 'inBed',
        value: true
      }),
      deviceEvent({
        id: 'entry_return',
        sequence: 3,
        simTime: '2026-06-23T17:40:00',
        roomId: 'entrance',
        deviceId: 'front_door_lock_01',
        deviceType: 'door_lock',
        field: 'lockState',
        value: 'unlocked'
      }),
      deviceEvent({
        id: 'kitchen_meal',
        sequence: 4,
        simTime: '2026-06-23T18:30:00',
        roomId: 'kitchen',
        deviceId: 'stove_01',
        deviceType: 'stove',
        field: 'powerW',
        value: 720
      }),
      deviceEvent({
        id: 'living_evening',
        sequence: 5,
        simTime: '2026-06-23T20:15:00',
        roomId: 'living_room',
        deviceId: 'tv_01',
        deviceType: 'tv',
        field: 'power',
        value: true
      })
    ]);

    const estimate = estimateHouseholdSizeFromMemory(memory);

    expect(estimate.lowerBound).toBe(2);
    expect(estimate.features).toMatchObject({
      sharedSleepZones: {
        count: 1,
        rooms: ['master_bedroom'],
        strength: 'medium'
      }
    });
    expect(estimate.distribution[3]).toBeGreaterThan(estimate.distribution[2]);
    expect(estimate.evidence).toContain('medium shared main sleep-zone candidate');
  });
});
