import { describe, expect, it } from 'vitest';
import { inferTwinState } from '../src/twin/inferenceModel';
import type { DeviceStateChangedEvent, DeviceTelemetryEvent, PersonMovedEvent, RoomId, ScenarioControlEvent } from '../src/shared/types';

const baseEvent = {
  id: 'evt_001',
  runId: 'run_001',
  ts: '2026-06-17T18:30:00+08:00',
  simTime: '2026-06-17T18:30:00+08:00',
  homeId: 'default_home',
  scenarioId: 'weekday_normal',
  sequence: 1,
  rngStateAfter: 123,
  lineage: {
    eventTime: '2026-06-17T18:30:00+08:00',
    ingestTime: '2026-06-17T18:30:00+08:00',
    causeEventIds: [],
    episodeId: 'test',
    quality: {},
    schemaVersion: 1,
    behaviorModelVersion: 'test'
  }
};

function motionEvent(roomId: RoomId, confidence: number): DeviceTelemetryEvent {
  return {
    ...baseEvent,
    id: `motion_${roomId}`,
    type: 'DeviceTelemetry',
    sourceLayer: 'sensor',
    lineage: { ...baseEvent.lineage, sourceLayer: 'sensor', observability: 'ml_observation' },
    roomId,
    deviceId: `${roomId}_motion_01`,
    deviceType: 'motion_sensor',
    measurements: { motion: true, confidence }
  };
}

function droppedSampleEvent(roomId: RoomId): DeviceTelemetryEvent {
  return {
    ...baseEvent,
    id: `dropped_${roomId}`,
    type: 'DeviceTelemetry',
    sourceLayer: 'sensor',
    lineage: {
      ...baseEvent.lineage,
      sourceLayer: 'sensor',
      observability: 'ml_observation',
      quality: { dropped: true }
    },
    roomId,
    deviceId: `${roomId}_motion_01`,
    deviceType: 'motion_sensor',
    measurements: { sample_dropped: true }
  };
}

function telemetryEvent(
  deviceId: string,
  deviceType: string,
  roomId: RoomId,
  measurements: DeviceTelemetryEvent['measurements']
): DeviceTelemetryEvent {
  return {
    ...baseEvent,
    id: `telemetry_${deviceId}`,
    type: 'DeviceTelemetry',
    sourceLayer: 'sensor',
    lineage: { ...baseEvent.lineage, sourceLayer: 'sensor', observability: 'ml_observation' },
    roomId,
    deviceId,
    deviceType,
    measurements
  };
}

function deviceStateEvent(deviceId: string, roomId: RoomId, state: DeviceStateChangedEvent['state']): DeviceStateChangedEvent {
  return {
    ...baseEvent,
    id: `state_${deviceId}`,
    type: 'DeviceStateChanged',
    sourceLayer: 'world',
    lineage: { ...baseEvent.lineage, sourceLayer: 'world', observability: 'admin' },
    roomId,
    deviceId,
    deviceType: deviceId.startsWith('fridge') ? 'fridge' : deviceId.startsWith('stove') ? 'stove' : 'router',
    state
  };
}

describe('twin inference model', () => {
  it('uses priors and schedule constraints when no observations are available', () => {
    const result = inferTwinState([], {
      currentTime: '2026-06-17T23:15:00+08:00',
      peopleIds: ['adult_1'],
      rooms: ['master_bedroom', 'living_room', 'kitchen']
    });

    expect(result.inputSummary.acceptedEventCount).toBe(0);
    expect(result.homeMode.top).toBe('sleeping');
    expect(result.people.adult_1.room.top).toBe('master_bedroom');
    expect(result.people.adult_1.room.confidence).toBeLessThan(0.7);
  });

  it('rejects truth and control events instead of reading simulator labels', () => {
    const truthEvent: PersonMovedEvent = {
      ...baseEvent,
      id: 'truth_person_move',
      type: 'PersonMoved',
      sourceLayer: 'truth',
      lineage: { ...baseEvent.lineage, sourceLayer: 'truth', observability: 'private' },
      personId: 'adult_1',
      from: 'living_room',
      to: 'kitchen',
      activity: 'cooking'
    };
    const controlEvent: ScenarioControlEvent = {
      ...baseEvent,
      id: 'control_inject',
      type: 'ScenarioControl',
      sourceLayer: 'control',
      lineage: { ...baseEvent.lineage, sourceLayer: 'control', observability: 'admin' },
      command: 'inject',
      value: 'fridge_left_open'
    };

    const result = inferTwinState([truthEvent, controlEvent, motionEvent('living_room', 0.82)], {
      currentTime: '2026-06-17T18:30:00+08:00',
      peopleIds: ['adult_1'],
      rooms: ['living_room', 'kitchen']
    });

    expect(result.inputSummary.acceptedEventCount).toBe(1);
    expect(result.inputSummary.rejectedEventTypes).toEqual(expect.arrayContaining(['PersonMoved', 'ScenarioControl']));
    expect(result.people.adult_1.room.top).toBe('living_room');
    expect(result.people.adult_1.activity.top).not.toBe('cooking');
  });

  it('converts motion and public device observations into probabilistic room and activity beliefs', () => {
    const result = inferTwinState([
      motionEvent('kitchen', 0.91),
      deviceStateEvent('fridge_01', 'kitchen', { doorOpen: true, powerW: 148 })
    ], {
      currentTime: '2026-06-17T18:30:00+08:00',
      peopleIds: ['adult_1', 'child_1'],
      rooms: ['living_room', 'kitchen', 'child_bedroom']
    });

    expect(result.people.adult_1.room.top).toBe('kitchen');
    expect(result.people.adult_1.activity.top).toBe('meal_prep_or_kitchen_visit');
    expect(result.homeMode.top).toBe('dinner');
    expect(result.homeMode.probabilities.dinner).toBeGreaterThan(0.4);
  });

  it('forecasts short horizon state and anomaly risk from observation-only input', () => {
    const result = inferTwinState([
      deviceStateEvent('fridge_01', 'kitchen', { doorOpen: true, powerW: 148 }),
      deviceStateEvent('router_01', 'study', { online: false, latencyMs: 0 })
    ], {
      currentTime: '2026-06-17T18:30:00+08:00',
      peopleIds: ['adult_2'],
      rooms: ['study', 'kitchen', 'living_room']
    });

    expect(result.forecasts.map((forecast) => forecast.horizonMinutes)).toEqual([15, 30, 60]);
    expect(result.risks.fridge_left_open.probability).toBeGreaterThan(0.75);
    expect(result.risks.network_impact.probability).toBeGreaterThan(0.75);
    expect(result.forecasts[2].risks.fridge_left_open).toBeGreaterThan(result.forecasts[0].risks.fridge_left_open);
  });

  it('shifts future home mode forecasts with the prediction horizon', () => {
    const result = inferTwinState([
      motionEvent('kitchen', 0.82)
    ], {
      currentTime: '2026-06-17T08:20:00+08:00',
      peopleIds: ['adult_1'],
      rooms: ['living_room', 'kitchen', 'entrance']
    });

    const fifteenMinute = result.forecasts.find((forecast) => forecast.horizonMinutes === 15);
    const sixtyMinute = result.forecasts.find((forecast) => forecast.horizonMinutes === 60);

    expect(fifteenMinute?.homeMode.probabilities.breakfast).toBeGreaterThan(sixtyMinute?.homeMode.probabilities.breakfast ?? 1);
    expect(sixtyMinute?.homeMode.probabilities.away).toBeGreaterThan(fifteenMinute?.homeMode.probabilities.away ?? 1);
  });

  it('forecasts future person room and activity distributions by horizon', () => {
    const result = inferTwinState([], {
      currentTime: '2026-06-17T17:10:00+08:00',
      peopleIds: ['adult_2'],
      rooms: ['living_room', 'study', 'kitchen']
    });

    const fifteenMinute = result.forecasts.find((forecast) => forecast.horizonMinutes === 15);
    const sixtyMinute = result.forecasts.find((forecast) => forecast.horizonMinutes === 60);

    expect(fifteenMinute?.people.adult_2.room.probabilities.study)
      .toBeGreaterThan(sixtyMinute?.people.adult_2.room.probabilities.study ?? 1);
    expect(sixtyMinute?.people.adult_2.room.probabilities.living_room)
      .toBeGreaterThan(fifteenMinute?.people.adult_2.room.probabilities.living_room ?? 1);
    expect(fifteenMinute?.people.adult_2.activity.probabilities.remote_work_or_study)
      .toBeGreaterThan(sixtyMinute?.people.adult_2.activity.probabilities.remote_work_or_study ?? 1);
  });

  it('flags unattended stove risk from public device state and missing kitchen motion', () => {
    const result = inferTwinState([
      deviceStateEvent('stove_01', 'kitchen', { powerW: 1300, level: 7 })
    ], {
      currentTime: '2026-06-17T18:30:00+08:00',
      peopleIds: ['adult_1'],
      rooms: ['living_room', 'kitchen', 'study']
    });

    expect(result.inputSummary.acceptedEventCount).toBe(1);
    expect(result.risks.stove_unattended).toMatchObject({
      probability: expect.any(Number),
      drivers: expect.arrayContaining(['stove_01.powerW'])
    });
    expect(result.risks.stove_unattended.probability).toBeGreaterThan(0.7);
    expect(result.forecasts[2].risks.stove_unattended).toBeGreaterThan(result.forecasts[0].risks.stove_unattended);
  });

  it('lowers stove unattended risk when kitchen motion suggests supervision', () => {
    const unattended = inferTwinState([
      deviceStateEvent('stove_01', 'kitchen', { powerW: 1300, level: 7 })
    ], {
      currentTime: '2026-06-17T18:30:00+08:00',
      peopleIds: ['adult_1'],
      rooms: ['living_room', 'kitchen', 'study']
    });
    const supervised = inferTwinState([
      deviceStateEvent('stove_01', 'kitchen', { powerW: 1300, level: 7 }),
      motionEvent('kitchen', 0.88)
    ], {
      currentTime: '2026-06-17T18:30:00+08:00',
      peopleIds: ['adult_1'],
      rooms: ['living_room', 'kitchen', 'study']
    });

    expect(supervised.risks.stove_unattended.probability).toBeLessThan(unattended.risks.stove_unattended.probability);
    expect(supervised.risks.stove_unattended.drivers).toEqual(expect.arrayContaining(['kitchen_motion_observation']));
  });

  it('reduces belief confidence when sensor observations include dropped samples', () => {
    const clean = inferTwinState([motionEvent('kitchen', 0.91)], {
      currentTime: '2026-06-17T18:30:00+08:00',
      peopleIds: ['adult_1'],
      rooms: ['living_room', 'kitchen', 'child_bedroom']
    });
    const degraded = inferTwinState([motionEvent('kitchen', 0.91), droppedSampleEvent('kitchen')], {
      currentTime: '2026-06-17T18:30:00+08:00',
      peopleIds: ['adult_1'],
      rooms: ['living_room', 'kitchen', 'child_bedroom']
    });

    expect(degraded.inputSummary.droppedObservationEvents).toBe(1);
    expect(degraded.people.adult_1.room.top).toBe('kitchen');
    expect(degraded.people.adult_1.room.confidence).toBeLessThan(clean.people.adult_1.room.confidence);
  });

  it('uses non-motion sensor telemetry for appliance and connectivity risks', () => {
    const result = inferTwinState([
      telemetryEvent('router_01', 'router', 'study', { online: false, confidence: 0.96 }),
      telemetryEvent('stove_01', 'stove', 'kitchen', { power_w: 1180 })
    ], {
      currentTime: '2026-06-17T18:30:00+08:00',
      peopleIds: ['adult_2'],
      rooms: ['study', 'kitchen', 'living_room']
    });

    expect(result.inputSummary.acceptedEventCount).toBe(2);
    expect(result.risks.network_impact).toMatchObject({
      probability: expect.any(Number),
      drivers: expect.arrayContaining(['router_01.online=false'])
    });
    expect(result.risks.network_impact.probability).toBeGreaterThan(0.75);
    expect(result.risks.stove_unattended).toMatchObject({
      probability: expect.any(Number),
      drivers: expect.arrayContaining(['stove_01.powerW'])
    });
    expect(result.risks.stove_unattended.probability).toBeGreaterThan(0.75);
  });

  it('uses air quality telemetry to infer room occupancy and likely work activity', () => {
    const result = inferTwinState([
      telemetryEvent('study_co2_01', 'air_quality_sensor', 'study', { co2: 1180, confidence: 0.88 })
    ], {
      currentTime: '2026-06-17T14:30:00+08:00',
      peopleIds: ['adult_1'],
      rooms: ['living_room', 'study', 'kitchen']
    });

    expect(result.inputSummary.acceptedEventCount).toBe(1);
    expect(result.people.adult_1.room.top).toBe('study');
    expect(result.people.adult_1.activity.top).toBe('remote_work_or_study');
    expect(result.people.adult_1.activity.probabilities.remote_work_or_study)
      .toBeGreaterThan(result.people.adult_1.activity.probabilities.household_leisure);
  });

  it('uses kitchen air and power telemetry to infer meal preparation activity', () => {
    const result = inferTwinState([
      telemetryEvent('pm25_01', 'air_quality_sensor', 'kitchen', { pm25: 62, co2: 760, confidence: 0.83 }),
      telemetryEvent('stove_01', 'stove', 'kitchen', { power_w: 720 })
    ], {
      currentTime: '2026-06-17T12:10:00+08:00',
      peopleIds: ['adult_1'],
      rooms: ['living_room', 'study', 'kitchen']
    });

    expect(result.people.adult_1.room.top).toBe('kitchen');
    expect(result.people.adult_1.activity.top).toBe('meal_prep_or_kitchen_visit');
    expect(result.people.adult_1.activity.probabilities.meal_prep_or_kitchen_visit)
      .toBeGreaterThan(result.people.adult_1.activity.probabilities.away_or_unknown);
  });

  it('raises senior wellness and leak risks from sensor telemetry without truth labels', () => {
    const result = inferTwinState([
      telemetryEvent('master_sleep_01', 'sleep_sensor', 'master_bedroom', { in_bed: true, confidence: 0.96 }),
      telemetryEvent('water_leak_01', 'water_leak_sensor', 'bathroom', { leak_detected: true, confidence: 0.96 })
    ], {
      currentTime: '2026-06-17T10:15:00+08:00',
      peopleIds: ['senior_1'],
      rooms: ['master_bedroom', 'bathroom', 'living_room']
    });

    expect(result.inputSummary.acceptedEventCount).toBe(2);
    expect(result.risks.senior_no_activity).toMatchObject({
      probability: expect.any(Number),
      drivers: expect.arrayContaining(['master_sleep_01.in_bed'])
    });
    expect(result.risks.senior_no_activity.probability).toBeGreaterThan(0.7);
    expect(result.risks.water_leak).toMatchObject({
      probability: expect.any(Number),
      drivers: expect.arrayContaining(['water_leak_01.leak_detected'])
    });
    expect(result.risks.water_leak.probability).toBeGreaterThan(0.8);
    expect(result.homeMode.top).toBe('alert');
  });
});
