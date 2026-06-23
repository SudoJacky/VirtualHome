import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import {
  createHomeMemory,
  getTimeBucket,
  reduceDeviceEvent,
  reduceDeviceEvents
} from '../src/web/homeMemoryModel';

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
    deviceId: 'coffee_maker_01',
    deviceType: 'coffee_maker',
    field: 'powerW',
    value: 120,
    ...overrides
  };
}

describe('home memory model', () => {
  it('creates explicit empty root metadata', () => {
    expect(createHomeMemory()).toMatchObject({
      homeId: null,
      runId: null,
      totalEvents: 0
    });
  });

  it('classifies time buckets from the written simTime hour', () => {
    expect(getTimeBucket('2026-06-22T05:00:00.000Z')).toBe('morning');
    expect(getTimeBucket('2026-06-22T10:59:00.000Z')).toBe('morning');
    expect(getTimeBucket('2026-06-22T11:00:00.000Z')).toBe('daytime');
    expect(getTimeBucket('2026-06-22T16:59:00.000Z')).toBe('daytime');
    expect(getTimeBucket('2026-06-22T17:00:00.000Z')).toBe('evening');
    expect(getTimeBucket('2026-06-22T21:59:00.000Z')).toBe('evening');
    expect(getTimeBucket('2026-06-22T22:00:00.000Z')).toBe('night');
    expect(getTimeBucket('2026-06-22T04:59:00.000Z')).toBe('night');
    expect(getTimeBucket('2026-06-22T05:00:00.000+08:00')).toBe('morning');
    expect(getTimeBucket('2026-06-22 05:00:00.000Z')).toBe('night');
    expect(getTimeBucket('not-a-date')).toBe('night');
  });

  it('creates room, device, and field memory from device events', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({ id: 'device_event_1', sequence: 1, field: 'powerW', value: 120 }),
      deviceEvent({ id: 'device_event_2', sequence: 2, field: 'brewMode', value: 'espresso' })
    ]);

    expect(memory.homeId).toBe('home_1');
    expect(memory.totalEvents).toBe(2);
    expect(memory.rooms.kitchen.eventCount).toBe(2);
    expect(memory.devices.coffee_maker_01.latestValues).toEqual({
      powerW: 120,
      brewMode: 'espresso'
    });
    expect(memory.fields['coffee_maker_01:powerW']).toMatchObject({
      deviceId: 'coffee_maker_01',
      field: 'powerW',
      currentValue: 120,
      eventCount: 1
    });
  });

  it('bounds recent events while counting morning activity by room and device', () => {
    const events = Array.from({ length: 70 }, (_, index) => deviceEvent({
      id: `motion_event_${index + 1}`,
      sourceEventId: `source_motion_${index + 1}`,
      sequence: index + 1,
      simTime: `2026-06-22T08:${String(index % 60).padStart(2, '0')}:00`,
      deviceId: 'motion_01',
      deviceType: 'motion_sensor',
      field: 'motion',
      value: index % 2 === 0
    }));

    const memory = reduceDeviceEvents(createHomeMemory(), events);

    expect(memory.recentEvents).toHaveLength(50);
    expect(memory.recentEvents[0].id).toBe('motion_event_70');
    expect(memory.recentEvents.at(-1)?.id).toBe('motion_event_21');
    expect(memory.rooms.kitchen.recentEvents).toHaveLength(50);
    expect(memory.rooms.kitchen.recentEvents[0].id).toBe('motion_event_70');
    expect(memory.rooms.kitchen.recentEvents.at(-1)?.id).toBe('motion_event_21');
    expect(memory.rooms.kitchen.timeBuckets.morning).toBe(70);
    expect(memory.devices.motion_01.recentEvents).toHaveLength(50);
    expect(memory.devices.motion_01.recentEvents[0].id).toBe('motion_event_70');
    expect(memory.devices.motion_01.recentEvents.at(-1)?.id).toBe('motion_event_21');
    expect(memory.devices.motion_01.eventCount).toBe(70);
    expect(memory.fields['motion_01:motion'].recentEvents).toHaveLength(20);
    expect(memory.fields['motion_01:motion'].recentEvents[0].id).toBe('motion_event_70');
    expect(memory.fields['motion_01:motion'].recentEvents.at(-1)?.id).toBe('motion_event_51');
  });

  it('tracks field aggregates and previous values', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({ id: 'power_event_1', sequence: 1, field: 'powerW', value: 120 }),
      deviceEvent({ id: 'power_event_2', sequence: 2, field: 'powerW', value: 80 }),
      deviceEvent({ id: 'power_event_3', sequence: 3, field: 'powerW', value: 140 }),
      deviceEvent({ id: 'door_event_1', sequence: 4, deviceId: 'fridge_01', deviceType: 'fridge', field: 'doorOpen', value: true }),
      deviceEvent({ id: 'door_event_2', sequence: 5, deviceId: 'fridge_01', deviceType: 'fridge', field: 'doorOpen', value: false }),
      deviceEvent({ id: 'door_event_3', sequence: 6, deviceId: 'fridge_01', deviceType: 'fridge', field: 'doorOpen', value: true })
    ]);

    expect(memory.fields['coffee_maker_01:powerW']).toMatchObject({
      currentValue: 140,
      previousValue: 80,
      eventCount: 3,
      numericMin: 80,
      numericMax: 140
    });
    expect(memory.fields['fridge_01:doorOpen']).toMatchObject({
      currentValue: true,
      previousValue: false,
      eventCount: 3,
      trueCount: 2,
      falseCount: 1
    });
  });

  it('does not mutate previous memory records when reducing another event', () => {
    const firstMemory = reduceDeviceEvent(createHomeMemory(), deviceEvent({
      id: 'power_event_1',
      sequence: 1,
      field: 'powerW',
      value: 120
    }));
    const firstRootRecent = firstMemory.recentEvents;
    const firstRoom = firstMemory.rooms.kitchen;
    const firstDevice = firstMemory.devices.coffee_maker_01;
    const firstField = firstMemory.fields['coffee_maker_01:powerW'];

    const secondMemory = reduceDeviceEvent(firstMemory, deviceEvent({
      id: 'power_event_2',
      sequence: 2,
      field: 'powerW',
      value: 80
    }));

    expect(secondMemory).not.toBe(firstMemory);
    expect(firstMemory.recentEvents).toBe(firstRootRecent);
    expect(firstMemory.rooms.kitchen).toBe(firstRoom);
    expect(firstMemory.devices.coffee_maker_01).toBe(firstDevice);
    expect(firstMemory.fields['coffee_maker_01:powerW']).toBe(firstField);
    expect(firstMemory.recentEvents.map((event) => event.id)).toEqual(['power_event_1']);
    expect(firstRoom.recentEvents.map((event) => event.id)).toEqual(['power_event_1']);
    expect(firstDevice.recentEvents.map((event) => event.id)).toEqual(['power_event_1']);
    expect(firstField.recentEvents.map((event) => event.id)).toEqual(['power_event_1']);
    expect(firstField.currentValue).toBe(120);
    expect(secondMemory.fields['coffee_maker_01:powerW'].currentValue).toBe(80);
  });

  it('resets memory when a different run arrives', () => {
    const firstRun = reduceDeviceEvent(createHomeMemory(), deviceEvent({
      id: 'coffee_event_1',
      runId: 'run_a',
      deviceId: 'coffee_maker_01',
      field: 'powerW',
      value: 120
    }));

    const secondRun = reduceDeviceEvent(firstRun, deviceEvent({
      id: 'fridge_event_1',
      runId: 'run_b',
      sequence: 1,
      deviceId: 'fridge_01',
      deviceType: 'fridge',
      field: 'doorOpen',
      value: false
    }));

    expect(secondRun.runId).toBe('run_b');
    expect(secondRun.totalEvents).toBe(1);
    expect(secondRun.devices.coffee_maker_01).toBeUndefined();
    expect(secondRun.fields['fridge_01:doorOpen']).toMatchObject({
      deviceId: 'fridge_01',
      field: 'doorOpen',
      currentValue: false
    });
  });
});
