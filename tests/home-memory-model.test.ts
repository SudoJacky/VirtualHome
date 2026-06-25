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

  it('stores sensor telemetry as facts while keeping only meaningful profile evidence weight', () => {
    const events = Array.from({ length: 30 }, (_, index) => deviceEvent({
      id: `temperature_event_${index + 1}`,
      sourceEventId: `source_temperature_${index + 1}`,
      sequence: index + 1,
      deviceId: 'temperature_01',
      deviceType: 'temperature_sensor',
      field: 'temperature',
      value: 25 + index * 0.01
    }));

    const memory = reduceDeviceEvents(createHomeMemory(), events);

    expect(memory.totalEvents).toBe(30);
    expect(memory.profileEventCount).toBe(1);
    expect(memory.profileEvidenceWeight).toBeCloseTo(0.05);
    expect(memory.profileEvidenceByCategory).toMatchObject({
      environment_context: 1
    });
    expect(memory.rooms.kitchen.profileEvidenceWeight).toBeCloseTo(0.05);
    expect(memory.devices.temperature_01.profileEvidenceWeight).toBeCloseTo(0.05);
    expect(memory.fields['temperature_01:temperature']).toMatchObject({
      eventCount: 30,
      changeCount: 1,
      telemetryCount: 29,
      lastMeaningfulChangeAt: '2026-06-22T00:00:00.000Z',
      evidenceCategory: 'environment_context',
      evidenceStrength: 'weak',
      profileWeight: 0
    });
  });

  it('derives reusable semantic signals from device evidence', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'front_door_unlock',
        sourceEventId: 'source_front_door_unlock',
        sequence: 1,
        simTime: '2026-06-22T18:00:00',
        roomId: 'entrance',
        deviceId: 'front_lock_01',
        deviceType: 'door_lock',
        field: 'lock',
        value: 'unlocked'
      }),
      deviceEvent({
        id: 'bathroom_flow',
        sourceEventId: 'source_bathroom_flow',
        sequence: 2,
        simTime: '2026-06-22T18:05:00',
        roomId: 'bathroom',
        deviceId: 'bathroom_flow_01',
        deviceType: 'water_meter',
        field: 'flowRate',
        value: 2.4
      }),
      deviceEvent({
        id: 'bed_sleep',
        sourceEventId: 'source_bed_sleep',
        sequence: 3,
        simTime: '2026-06-22T23:00:00',
        roomId: 'master_bedroom',
        deviceId: 'sleep_sensor_01',
        deviceType: 'sleep_sensor',
        field: 'inBed',
        value: true
      })
    ]);

    expect(memory.semanticSignalCount).toBe(4);
    expect(memory.semanticSignalCountsByType).toMatchObject({
      access_signal: 1,
      presence_signal: 1,
      water_signal: 1,
      sleep_signal: 1
    });
    expect(memory.semanticSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'signal:front_door_unlock:access_signal',
        type: 'access_signal',
        roomId: 'entrance',
        deviceId: 'front_lock_01',
        sourceEvidenceIds: ['front_door_unlock'],
        strength: 'strong'
      }),
      expect.objectContaining({
        id: 'signal:front_door_unlock:presence_signal',
        type: 'presence_signal',
        roomId: 'entrance',
        sourceEvidenceIds: ['front_door_unlock']
      }),
      expect.objectContaining({
        id: 'signal:bathroom_flow:water_signal',
        type: 'water_signal',
        roomId: 'bathroom',
        value: 2.4
      }),
      expect.objectContaining({
        id: 'signal:bed_sleep:sleep_signal',
        type: 'sleep_signal',
        roomId: 'master_bedroom',
        timeBucket: 'night'
      })
    ]));
  });

  it('normalizes device capabilities before deriving semantic signals', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'living_presence_count',
        sourceEventId: 'source_living_presence_count',
        sequence: 1,
        simTime: '2026-06-22T19:00:00',
        roomId: 'living',
        deviceId: 'living_presence_01',
        deviceType: 'mmwave_presence_sensor',
        field: 'peopleCount',
        value: 2
      }),
      deviceEvent({
        id: 'living_ac_cooling',
        sourceEventId: 'source_living_ac_cooling',
        sequence: 2,
        simTime: '2026-06-22T19:05:00',
        roomId: 'living',
        deviceId: 'living_ac_01',
        deviceType: 'air_conditioner',
        field: 'mode',
        value: 'cooling'
      })
    ]);

    expect(memory.recentEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'living_presence_count',
        capability: expect.objectContaining({
          type: 'presence_detection',
          active: true
        }),
        evidenceCategory: 'human_activity',
        evidenceStrength: 'medium'
      }),
      expect.objectContaining({
        id: 'living_ac_cooling',
        capability: expect.objectContaining({
          type: 'climate_control',
          active: true
        }),
        evidenceCategory: 'device_usage'
      })
    ]));
    expect(memory.semanticSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'signal:living_presence_count:presence_signal',
        type: 'presence_signal',
        roomId: 'living',
        value: 2
      }),
      expect.objectContaining({
        id: 'signal:living_ac_cooling:climate_signal',
        type: 'climate_signal',
        roomId: 'living',
        value: 'cooling'
      })
    ]));
  });

  it('derives high-level household episodes from semantic signal sequences', () => {
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
      }),
      deviceEvent({
        id: 'stove_power',
        sourceEventId: 'source_stove_power',
        sequence: 3,
        ts: '2026-06-22T10:12:00.000Z',
        simTime: '2026-06-22T18:12:00',
        roomId: 'kitchen',
        deviceId: 'stove_01',
        deviceType: 'stove',
        field: 'powerW',
        value: 1500
      }),
      deviceEvent({
        id: 'bed_sleep',
        sourceEventId: 'source_bed_sleep',
        sequence: 4,
        ts: '2026-06-22T15:00:00.000Z',
        simTime: '2026-06-22T23:00:00',
        roomId: 'master_bedroom',
        deviceId: 'sleep_sensor_01',
        deviceType: 'sleep_sensor',
        field: 'inBed',
        value: true
      }),
      deviceEvent({
        id: 'temperature_hot',
        sourceEventId: 'source_temperature_hot',
        sequence: 5,
        ts: '2026-06-23T04:00:00.000Z',
        simTime: '2026-06-23T12:00:00',
        roomId: 'living',
        deviceId: 'living_temperature_01',
        deviceType: 'temperature_sensor',
        field: 'temperature',
        value: 29
      }),
      deviceEvent({
        id: 'ac_cooling',
        sourceEventId: 'source_ac_cooling',
        sequence: 6,
        ts: '2026-06-23T04:05:00.000Z',
        simTime: '2026-06-23T12:05:00',
        roomId: 'living',
        deviceId: 'living_ac_01',
        deviceType: 'air_conditioner',
        field: 'mode',
        value: 'cooling'
      })
    ]);

    expect(memory.activityEpisodeCount).toBe(4);
    expect(memory.activityEpisodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'return_home',
        roomIds: ['entrance', 'kitchen'],
        evidenceIds: ['entry_unlock', 'kitchen_motion']
      }),
      expect.objectContaining({
        kind: 'meal_preparation',
        roomIds: ['kitchen'],
        evidenceIds: expect.arrayContaining(['kitchen_motion', 'stove_power'])
      }),
      expect.objectContaining({
        kind: 'bedtime',
        roomIds: ['master_bedroom'],
        evidenceIds: ['bed_sleep']
      }),
      expect.objectContaining({
        kind: 'climate_response',
        roomIds: ['living'],
        evidenceIds: ['temperature_hot', 'ac_cooling']
      })
    ]));
  });

  it('tracks repeated same-value telemetry separately from meaningful changes', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'motion_event_1',
        sourceEventId: 'source_motion_event_1',
        sequence: 1,
        deviceId: 'motion_01',
        deviceType: 'motion_sensor',
        field: 'motion',
        value: true
      }),
      deviceEvent({
        id: 'motion_event_2',
        sourceEventId: 'source_motion_event_2',
        sequence: 2,
        deviceId: 'motion_01',
        deviceType: 'motion_sensor',
        field: 'motion',
        value: true
      }),
      deviceEvent({
        id: 'motion_event_3',
        sourceEventId: 'source_motion_event_3',
        sequence: 3,
        deviceId: 'motion_01',
        deviceType: 'motion_sensor',
        field: 'motion',
        value: true
      })
    ]);

    expect(memory.totalEvents).toBe(3);
    expect(memory.profileEventCount).toBe(1);
    expect(memory.profileEvidenceWeight).toBeCloseTo(0.55);
    expect(memory.fields['motion_01:motion']).toMatchObject({
      eventCount: 3,
      changeCount: 1,
      telemetryCount: 2,
      lastMeaningfulChangeAt: '2026-06-22T00:00:00.000Z',
      profileEventCount: 1,
      profileEvidenceWeight: 0.55
    });
    expect(memory.recentEvents[0]).toMatchObject({
      meaningfulChange: false,
      profileWeight: 0
    });
  });

  it('ignores tiny numeric drift for profile confidence while preserving numeric facts', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'temperature_event_1',
        sourceEventId: 'source_temperature_event_1',
        sequence: 1,
        deviceId: 'temperature_01',
        deviceType: 'temperature_sensor',
        field: 'temperature',
        value: 25
      }),
      deviceEvent({
        id: 'temperature_event_2',
        sourceEventId: 'source_temperature_event_2',
        sequence: 2,
        deviceId: 'temperature_01',
        deviceType: 'temperature_sensor',
        field: 'temperature',
        value: 25.2
      }),
      deviceEvent({
        id: 'temperature_event_3',
        sourceEventId: 'source_temperature_event_3',
        sequence: 3,
        ts: '2026-06-22T00:03:00.000Z',
        deviceId: 'temperature_01',
        deviceType: 'temperature_sensor',
        field: 'temperature',
        value: 25.8
      })
    ]);

    expect(memory.profileEventCount).toBe(2);
    expect(memory.profileEvidenceWeight).toBeCloseTo(0.1);
    expect(memory.fields['temperature_01:temperature']).toMatchObject({
      eventCount: 3,
      changeCount: 2,
      telemetryCount: 1,
      lastMeaningfulChangeAt: '2026-06-22T00:03:00.000Z',
      numericMin: 25,
      numericMax: 25.8
    });
    expect(memory.recentEvents.map((event) => event.meaningfulChange)).toEqual([true, false, true]);
    expect(memory.recentEvents.map((event) => event.profileWeight)).toEqual([0.05, 0, 0.05]);
  });

  it('compresses repeated motion activity into an occupancy episode', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'motion_event_1',
        sourceEventId: 'source_motion_event_1',
        sequence: 1,
        ts: '2026-06-22T00:00:00.000Z',
        simTime: '2026-06-22T08:00:00',
        deviceId: 'motion_01',
        deviceType: 'motion_sensor',
        field: 'motion',
        value: true
      }),
      deviceEvent({
        id: 'motion_event_2',
        sourceEventId: 'source_motion_event_2',
        sequence: 2,
        ts: '2026-06-22T00:01:00.000Z',
        simTime: '2026-06-22T08:01:00',
        deviceId: 'motion_01',
        deviceType: 'motion_sensor',
        field: 'motion',
        value: true
      }),
      deviceEvent({
        id: 'motion_event_3',
        sourceEventId: 'source_motion_event_3',
        sequence: 3,
        ts: '2026-06-22T00:05:00.000Z',
        simTime: '2026-06-22T08:05:00',
        deviceId: 'motion_01',
        deviceType: 'motion_sensor',
        field: 'motion',
        value: false
      })
    ]);

    const episode = Object.values(memory.episodes)[0];

    expect(memory.episodeCount).toBe(1);
    expect(memory.activeEpisodeIds).toEqual({});
    expect(episode).toMatchObject({
      kind: 'occupancy',
      status: 'closed',
      roomId: 'kitchen',
      deviceId: 'motion_01',
      field: 'motion',
      startedAt: '2026-06-22T00:00:00.000Z',
      endedAt: '2026-06-22T00:05:00.000Z',
      durationMinutes: 5,
      eventCount: 3,
      evidenceIds: ['motion_event_1', 'motion_event_2', 'motion_event_3']
    });
  });

  it('compresses appliance power usage into an episode with peak value', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'power_event_1',
        sourceEventId: 'source_power_event_1',
        sequence: 1,
        ts: '2026-06-22T00:00:00.000Z',
        simTime: '2026-06-22T08:00:00',
        deviceId: 'coffee_maker_01',
        deviceType: 'coffee_maker',
        field: 'powerW',
        value: 0
      }),
      deviceEvent({
        id: 'power_event_2',
        sourceEventId: 'source_power_event_2',
        sequence: 2,
        ts: '2026-06-22T00:02:00.000Z',
        simTime: '2026-06-22T08:02:00',
        deviceId: 'coffee_maker_01',
        deviceType: 'coffee_maker',
        field: 'powerW',
        value: 800
      }),
      deviceEvent({
        id: 'power_event_3',
        sourceEventId: 'source_power_event_3',
        sequence: 3,
        ts: '2026-06-22T00:04:00.000Z',
        simTime: '2026-06-22T08:04:00',
        deviceId: 'coffee_maker_01',
        deviceType: 'coffee_maker',
        field: 'powerW',
        value: 820
      }),
      deviceEvent({
        id: 'power_event_4',
        sourceEventId: 'source_power_event_4',
        sequence: 4,
        ts: '2026-06-22T00:10:00.000Z',
        simTime: '2026-06-22T08:10:00',
        deviceId: 'coffee_maker_01',
        deviceType: 'coffee_maker',
        field: 'powerW',
        value: 0
      })
    ]);

    const episode = Object.values(memory.episodes)[0];

    expect(memory.episodeCount).toBe(1);
    expect(episode).toMatchObject({
      kind: 'appliance_usage',
      status: 'closed',
      startedAt: '2026-06-22T00:02:00.000Z',
      endedAt: '2026-06-22T00:10:00.000Z',
      durationMinutes: 8,
      eventCount: 3,
      peakValue: 820,
      startValue: 800,
      latestValue: 0
    });
  });

  it('does not create behavior episodes for environment telemetry drift', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'temperature_event_1',
        sourceEventId: 'source_temperature_event_1',
        sequence: 1,
        deviceId: 'temperature_01',
        deviceType: 'temperature_sensor',
        field: 'temperature',
        value: 25
      }),
      deviceEvent({
        id: 'temperature_event_2',
        sourceEventId: 'source_temperature_event_2',
        sequence: 2,
        deviceId: 'temperature_01',
        deviceType: 'temperature_sensor',
        field: 'temperature',
        value: 25.8
      })
    ]);

    expect(memory.episodeCount).toBe(0);
    expect(memory.episodes).toEqual({});
    expect(memory.activeEpisodeIds).toEqual({});
  });

  it('stores daily summaries across observed simulation days', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'kitchen_motion_day_1',
        sourceEventId: 'source_kitchen_motion_day_1',
        sequence: 1,
        ts: '2026-06-22T00:00:00.000Z',
        simTime: '2026-06-22T08:00:00',
        roomId: 'kitchen',
        deviceId: 'kitchen_motion_01',
        deviceType: 'motion_sensor',
        field: 'motion',
        value: true
      }),
      deviceEvent({
        id: 'kitchen_motion_day_1_end',
        sourceEventId: 'source_kitchen_motion_day_1_end',
        sequence: 2,
        ts: '2026-06-22T00:10:00.000Z',
        simTime: '2026-06-22T08:10:00',
        roomId: 'kitchen',
        deviceId: 'kitchen_motion_01',
        deviceType: 'motion_sensor',
        field: 'motion',
        value: false
      }),
      deviceEvent({
        id: 'living_tv_day_2',
        sourceEventId: 'source_living_tv_day_2',
        sequence: 3,
        ts: '2026-06-23T11:00:00.000Z',
        simTime: '2026-06-23T19:00:00',
        roomId: 'living',
        deviceId: 'tv_01',
        deviceType: 'tv',
        field: 'power',
        value: true
      })
    ]);

    expect(memory.dailySummaryCount).toBe(2);
    expect(memory.weeklySummaryCount).toBe(1);
    expect(memory.dailySummaries['2026-06-22']).toMatchObject({
      date: '2026-06-22',
      eventCount: 2,
      profileEventCount: 2,
      episodeCount: 1,
      activeRooms: ['kitchen'],
      meaningfulRooms: ['kitchen'],
      activeDevices: ['kitchen_motion_01'],
      firstSeenAt: '2026-06-22T00:00:00.000Z',
      lastSeenAt: '2026-06-22T00:10:00.000Z'
    });
    expect(memory.dailySummaries['2026-06-22'].timeBuckets).toMatchObject({
      morning: 2
    });
    expect(memory.dailySummaries['2026-06-23']).toMatchObject({
      date: '2026-06-23',
      eventCount: 1,
      profileEventCount: 1,
      episodeCount: 1,
      activeRooms: ['living'],
      meaningfulRooms: ['living'],
      activeDevices: ['tv_01']
    });
    expect(Object.values(memory.weeklySummaries)[0]).toMatchObject({
      week: '2026-W26',
      dates: ['2026-06-22', '2026-06-23'],
      eventCount: 3,
      episodeCount: 2,
      activeRooms: ['kitchen', 'living'],
      meaningfulRooms: ['kitchen', 'living'],
      activeDevices: ['kitchen_motion_01', 'tv_01']
    });
  });

  it('keeps ignored system telemetry out of profile evidence counts', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'battery_event_1',
        sourceEventId: 'source_battery_event_1',
        sequence: 1,
        deviceId: 'temperature_01',
        deviceType: 'temperature_sensor',
        field: 'battery',
        value: 88
      })
    ]);

    expect(memory.totalEvents).toBe(1);
    expect(memory.profileEventCount).toBe(0);
    expect(memory.profileEvidenceWeight).toBe(0);
    expect(memory.fields['temperature_01:battery']).toMatchObject({
      evidenceCategory: 'system_status',
      evidenceStrength: 'ignored',
      profileWeight: 0
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
