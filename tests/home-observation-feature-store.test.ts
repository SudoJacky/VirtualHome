import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { extractHomeBehaviorEpisodes } from '../src/web/homeBehaviorEpisodes';
import { extractHomeInferenceFeatures } from '../src/web/homeInferenceFeatures';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';
import {
  classifyHomeObservationField,
  reconstructHomeObservations
} from '../src/web/homeObservation';

function deviceEvent(overrides: Partial<DeviceValueEvent> = {}): DeviceValueEvent {
  return {
    id: 'event_1',
    sourceEventId: 'source_1',
    sourceEventType: 'DeviceTelemetry',
    runId: 'run_observation',
    sequence: 1,
    ts: '2026-06-22T10:00:00.000Z',
    simTime: '2026-06-22T18:00:00',
    homeId: 'home_neutral',
    roomId: 'zone_r3',
    deviceId: 'appliance_a',
    deviceType: 'stove',
    field: 'powerW',
    value: 900,
    ...overrides
  };
}

function sourceFields(
  sourceEventId: string,
  sequence: number,
  simTime: string,
  deviceId: string,
  deviceType: string,
  fields: Record<string, DeviceValueEvent['value']>
): DeviceValueEvent[] {
  return Object.entries(fields).map(([field, value]) => deviceEvent({
    id: `${sourceEventId}:${field}`,
    sourceEventId,
    sequence,
    simTime,
    ts: `${simTime}.000Z`,
    deviceId,
    deviceType,
    field,
    value
  }));
}

describe('home source observations and derived feature store', () => {
  it('reconstructs one source event into measurements, quality, lifecycle, and context', () => {
    const observations = reconstructHomeObservations(sourceFields(
      'source_cook',
      7,
      '2026-06-22T18:00:00',
      'cooktop_x7',
      'induction_cooktop',
      {
        powerW: 900,
        confidence: 0.8,
        noisy: true,
        remainingMin: 25
      }
    ));

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      sourceEventId: 'source_cook',
      primaryMeasurements: { powerW: 900 },
      quality: { confidence: 0.8, noisy: true },
      lifecycle: { remainingMin: 25 },
      context: {
        capabilities: ['cooking']
      },
      qualityMultiplier: 0.48
    });
    expect(classifyHomeObservationField('confidence')).toBe('quality');
    expect(classifyHomeObservationField('sample_dropped')).toBe('quality');
    expect(classifyHomeObservationField('remainingMin')).toBe('lifecycle');
    expect(classifyHomeObservationField('powerW')).toBe('primary');
  });

  it('derives latency and dropped samples as Observation quality metadata', () => {
    const events = sourceFields(
      'source_delayed',
      8,
      '2026-06-22T18:00:00+08:00',
      'motion_x1',
      'motion_sensor',
      {
        motion: true,
        sample_dropped: true
      }
    ).map((event) => ({
      ...event,
      ts: '2026-06-22T10:05:00.000Z'
    }));
    const observation = reconstructHomeObservations(events)[0];
    const memory = reduceDeviceEvents(createHomeMemory(), events);

    expect(observation).toMatchObject({
      primaryMeasurements: { motion: true },
      quality: {
        sample_dropped: true,
        delayedMs: 300_000
      },
      qualityMultiplier: 0.175
    });
    expect(memory.dailyFeatures['2026-06-22']).toMatchObject({
      observationCount: 1,
      primaryMeasurementCount: 1,
      observableDeviceIds: []
    });
    expect(memory.recentEvents.map((event) => event.id)).not.toContain(
      'source_delayed:sample_dropped'
    );
  });

  it('counts coupling by observable day and episode instead of telemetry rows', () => {
    const events = [
      ...sourceFields('day1_stove_start', 1, '2026-06-22T18:00:00', 'cooktop_x7', 'stove', {
        powerW: 900,
        confidence: 0.5,
        remainingMin: 30
      }),
      ...sourceFields('day1_lifecycle', 2, '2026-06-22T18:01:00', 'cooktop_x7', 'stove', {
        remainingMin: 29
      }),
      ...sourceFields('day1_stove_telemetry', 3, '2026-06-22T18:02:00', 'cooktop_x7', 'stove', {
        powerW: 850
      }),
      ...sourceFields('day1_hood_start', 4, '2026-06-22T18:03:00', 'ventilator_q2', 'range_hood', {
        power: 'on'
      }),
      ...sourceFields('day1_stove_stop', 5, '2026-06-22T18:20:00', 'cooktop_x7', 'stove', {
        powerW: 0
      }),
      ...sourceFields('day2_stove_start', 6, '2026-06-23T18:00:00', 'cooktop_x7', 'stove', {
        powerW: 900
      }),
      ...sourceFields('day2_stove_telemetry', 7, '2026-06-23T18:10:00', 'cooktop_x7', 'stove', {
        powerW: 850
      }),
      ...sourceFields('day2_hood_late', 8, '2026-06-23T18:12:00', 'ventilator_q2', 'range_hood', {
        power: 'on'
      }),
      ...sourceFields('day2_stove_stop', 9, '2026-06-23T18:20:00', 'cooktop_x7', 'stove', {
        powerW: 0
      }),
      ...sourceFields('day3_stove_start', 10, '2026-06-24T18:00:00', 'cooktop_x7', 'stove', {
        powerW: 900
      }),
      ...sourceFields('day3_hood_offline', 11, '2026-06-24T18:01:00', 'ventilator_q2', 'range_hood', {
        online: false
      }),
      ...sourceFields('day3_stove_stop', 12, '2026-06-24T18:20:00', 'cooktop_x7', 'stove', {
        powerW: 0
      })
    ];

    const memory = reduceDeviceEvents(createHomeMemory(), events);
    const candidate = memory.patternCandidates['stove-range-hood-paired'];
    const cookingEpisodes = Object.values(memory.episodeFacts)
      .filter((episode) => episode.kind === 'cooking_episode');

    expect(memory.totalEvents).toBe(14);
    expect(memory.observationCount).toBe(12);
    expect(memory.dailyFeatures['2026-06-22']).toMatchObject({
      observationCount: 5,
      primaryMeasurementCount: 4,
      lifecycleUpdateCount: 2
    });
    expect(cookingEpisodes).toHaveLength(3);
    expect(cookingEpisodes[0]).toMatchObject({
      startedSimTime: '2026-06-22T18:00:00',
      lifecycle: { remainingMin: 29 }
    });
    expect(cookingEpisodes[0].evidenceIds).not.toContain('day1_lifecycle:remainingMin');
    expect(cookingEpisodes[0].evidenceIds).not.toContain('day1_stove_telemetry:powerW');
    expect(cookingEpisodes[2].deviceIds).toEqual(['cooktop_x7']);
    expect(memory.recentEvents.map((event) => event.id))
      .not.toContain('day1_lifecycle:remainingMin');
    expect(memory.fields['cooktop_x7:powerW'].recentEvents
      .find((event) => event.id === 'day1_stove_start:powerW')?.sourceConfidence)
      .toBe(0.5);
    expect(candidate).toMatchObject({
      supportDays: 1,
      opportunityDays: 2,
      anchorDays: 3,
      baseDays: 2,
      confidence: 0.5,
      lift: 0.5,
      sourceDiversity: 2,
      contradictionCount: 1
    });
    expect(candidate.evidenceIds).toEqual(expect.arrayContaining([
      'day1_stove_start:powerW',
      'day1_hood_start:power'
    ]));
  });

  it('extracts a sleep feature from neutral room and device ids', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      ...sourceFields('sleep_start', 1, '2026-06-22T21:05:00', 'sensor_x9', 'sleep_sensor', {
        inBed: true
      }),
      ...sourceFields('sleep_stop', 2, '2026-06-23T06:45:00', 'sensor_x9', 'sleep_sensor', {
        inBed: false
      })
    ].map((event) => ({ ...event, roomId: 'zone_r6' })));

    const features = extractHomeInferenceFeatures(
      memory,
      extractHomeBehaviorEpisodes(memory)
    );
    const feature = features.find((item) => (
      item.id === 'feature:early_sleep_zone_around_21'
    ));

    expect(feature).toMatchObject({
      type: 'recurring_time_window',
      scope: {
        rooms: ['zone_r6'],
        devices: ['sensor_x9']
      }
    });
    expect(JSON.stringify(feature)).not.toContain('child_bedroom');
    expect(feature?.summary).toMatch(/early sleep-zone.*21:05/i);
  });

  it('uses work-capable room context without treating environment telemetry as work', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      ...sourceFields('work_air', 1, '2026-06-22T09:00:00', 'sensor_air', 'air_quality_sensor', {
        co2: 850
      }),
      ...sourceFields('work_router', 2, '2026-06-22T09:01:00', 'network_node', 'router', {
        online: true,
        latencyMs: 24
      }),
      ...sourceFields('work_light', 3, '2026-06-22T09:02:00', 'fixture_light', 'light', {
        power: 'on',
        brightness: 70
      })
    ].map((event) => ({ ...event, roomId: 'zone_r5' })));

    const workEpisodes = Object.values(memory.episodeFacts)
      .filter((episode) => episode.kind === 'work_study_episode');

    expect(workEpisodes).toHaveLength(1);
    expect(workEpisodes[0]).toMatchObject({
      startedSimTime: '2026-06-22T09:02:00',
      deviceIds: ['fixture_light']
    });
    expect(workEpisodes[0].evidenceIds).not.toContain('work_air:co2');
  });
});
