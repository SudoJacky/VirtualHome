import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';
import type { ProfileHypothesisType } from '../src/web/homeProfiler';
import { createHomeProfileHypotheses } from '../src/web/homeProfiler';

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

function profiledMemory() {
  return reduceDeviceEvents(createHomeMemory(), [
    deviceEvent({
      id: 'kitchen_fridge_morning_1',
      sourceEventId: 'source_kitchen_fridge_morning_1',
      sequence: 1,
      simTime: '2026-06-22T07:15:00',
      roomId: 'kitchen',
      deviceId: 'fridge_01',
      deviceType: 'fridge',
      field: 'doorOpen',
      value: true
    }),
    deviceEvent({
      id: 'kitchen_coffee_morning_1',
      sourceEventId: 'source_kitchen_coffee_morning_1',
      sequence: 2,
      simTime: '2026-06-22T07:20:00',
      roomId: 'kitchen',
      deviceId: 'coffee_maker_01',
      deviceType: 'coffee_maker',
      field: 'powerW',
      value: 800
    }),
    deviceEvent({
      id: 'kitchen_fridge_morning_2',
      sourceEventId: 'source_kitchen_fridge_morning_2',
      sequence: 3,
      simTime: '2026-06-22T07:25:00',
      roomId: 'kitchen',
      deviceId: 'fridge_01',
      deviceType: 'fridge',
      field: 'doorOpen',
      value: false
    }),
    deviceEvent({
      id: 'kitchen_daytime_1',
      sourceEventId: 'source_kitchen_daytime_1',
      sequence: 4,
      simTime: '2026-06-22T12:30:00',
      roomId: 'kitchen',
      deviceId: 'dishwasher_01',
      deviceType: 'dishwasher',
      field: 'cycle',
      value: 'rinse'
    }),
    deviceEvent({
      id: 'living_evening_1',
      sourceEventId: 'source_living_evening_1',
      sequence: 5,
      simTime: '2026-06-22T19:05:00',
      roomId: 'living',
      deviceId: 'tv_01',
      deviceType: 'tv',
      field: 'power',
      value: true
    }),
    deviceEvent({
      id: 'study_evening_1',
      sourceEventId: 'source_study_evening_1',
      sequence: 6,
      simTime: '2026-06-22T20:10:00',
      roomId: 'study',
      deviceId: 'desk_lamp_01',
      deviceType: 'lamp',
      field: 'brightness',
      value: 60
    }),
    deviceEvent({
      id: 'bathroom_night_1',
      sourceEventId: 'source_bathroom_night_1',
      sequence: 7,
      simTime: '2026-06-22T23:30:00',
      roomId: 'bathroom',
      deviceId: 'bathroom_motion_01',
      deviceType: 'motion_sensor',
      field: 'motion',
      value: true
    })
  ]);
}

describe('home profiler', () => {
  const supportedTypes: ProfileHypothesisType[] = [
    'household_size',
    'daily_rhythm',
    'room_habit',
    'device_routine',
    'presence_signal',
    'activity_cluster'
  ];

  it('creates explainable profile hypotheses from room and time activity', () => {
    const hypotheses = createHomeProfileHypotheses(profiledMemory());

    expect(hypotheses).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'daily_rhythm', id: 'rhythm:morning' }),
      expect.objectContaining({ type: 'daily_rhythm', id: 'rhythm:daytime' }),
      expect.objectContaining({ type: 'daily_rhythm', id: 'rhythm:evening' }),
      expect.objectContaining({ type: 'daily_rhythm', id: 'rhythm:night' }),
      expect.objectContaining({
        type: 'room_habit',
        id: 'room:kitchen:habit',
        subjectIds: expect.arrayContaining(['room:kitchen', 'device:fridge_01'])
      }),
      expect.objectContaining({
        type: 'device_routine',
        id: 'room:kitchen:device-routine',
        subjectIds: expect.arrayContaining(['room:kitchen', 'device:fridge_01', 'device:coffee_maker_01'])
      }),
      expect.objectContaining({ type: 'presence_signal', id: 'presence:recent-activity' }),
      expect.objectContaining({ type: 'household_size', id: 'household:size' })
    ]));

    const kitchenHabit = hypotheses.find((hypothesis) => hypothesis.id === 'room:kitchen:habit');
    expect(kitchenHabit?.summary).toContain('morning');

    const kitchenRoutine = hypotheses.find((hypothesis) => hypothesis.id === 'room:kitchen:device-routine');
    expect(kitchenRoutine?.summary).toMatch(/multi-device activity/i);
    expect(kitchenRoutine?.summary).not.toMatch(/co-occurring/i);

    const householdSize = hypotheses.find((hypothesis) => hypothesis.type === 'household_size');
    expect(householdSize?.summary).toMatch(/likely|probable|may|suggest/i);
    expect(householdSize?.summary).toMatch(/1-3 residents/);

    const presence = hypotheses.find((hypothesis) => hypothesis.type === 'presence_signal');
    expect(presence?.summary).toMatch(/4 active rooms/);
    expect(presence?.summary).toMatch(/may indicate presence|weak presence signal/i);
    expect(presence?.summary).not.toMatch(/indicates presence/i);

    expect(supportedTypes).toContain('activity_cluster');
  });

  it('keeps evidence, confidence, and updatedAt grounded in newest evidence', () => {
    const hypotheses = createHomeProfileHypotheses(profiledMemory());

    for (const hypothesis of hypotheses) {
      expect(hypothesis.evidence.length).toBeGreaterThan(0);
      expect(hypothesis.confidence).toBeGreaterThan(0);
      expect(hypothesis.confidence).toBeLessThanOrEqual(1);
      expect(hypothesis.updatedAt).toBe(hypothesis.evidence[0].simTime);
    }

    const morningRhythm = hypotheses.find((hypothesis) => hypothesis.id === 'rhythm:morning');
    expect(morningRhythm?.updatedAt).toBe('2026-06-22T07:25:00');
  });

  it('caps confidence and keeps household size uncertain for sparse evidence', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'single_kitchen_event',
        sourceEventId: 'source_single_kitchen_event',
        sequence: 1,
        simTime: '2026-06-22T07:15:00',
        roomId: 'kitchen',
        deviceId: 'fridge_01',
        deviceType: 'fridge',
        field: 'doorOpen',
        value: true
      })
    ]);
    const hypotheses = createHomeProfileHypotheses(memory);

    expect(hypotheses.length).toBeGreaterThan(0);
    for (const hypothesis of hypotheses) {
      expect(hypothesis.confidence).toBeLessThanOrEqual(0.45);
    }

    const householdSize = hypotheses.find((hypothesis) => hypothesis.type === 'household_size');
    expect(householdSize?.summary).toMatch(/resident count remains uncertain/i);
    expect(householdSize?.summary).not.toMatch(/likely 1 resident/i);
  });

  it('does not treat high-frequency environment telemetry as strong household activity', () => {
    const rooms = ['kitchen', 'living', 'bedroom', 'bathroom', 'study'];
    const events = Array.from({ length: 60 }, (_, index) => {
      const roomId = rooms[index % rooms.length];
      return deviceEvent({
        id: `temperature_event_${index + 1}`,
        sourceEventId: `source_temperature_${index + 1}`,
        sequence: index + 1,
        simTime: `2026-06-22T08:${String(index % 60).padStart(2, '0')}:00`,
        roomId,
        deviceId: `${roomId}_temperature_01`,
        deviceType: 'temperature_sensor',
        field: 'temperature',
        value: 24 + index * 0.01
      });
    });
    const memory = reduceDeviceEvents(createHomeMemory(), events);
    const hypotheses = createHomeProfileHypotheses(memory);

    const householdSize = hypotheses.find((hypothesis) => hypothesis.type === 'household_size');
    const presence = hypotheses.find((hypothesis) => hypothesis.type === 'presence_signal');

    expect(memory.totalEvents).toBe(60);
    expect(memory.profileEventCount).toBe(5);
    expect(memory.profileEvidenceWeight).toBeCloseTo(0.25);
    expect(householdSize?.summary).toMatch(/environment|weak|uncertain/i);
    expect(householdSize?.summary).not.toMatch(/2-5 residents/);
    expect(householdSize?.confidence).toBeLessThanOrEqual(0.45);
    expect(presence?.confidence).toBeLessThanOrEqual(0.45);
  });

  it('uses behavior episodes when explaining presence, room habits, and household size', () => {
    const events = Array.from({ length: 20 }, (_, index) => deviceEvent({
      id: `motion_event_${index + 1}`,
      sourceEventId: `source_motion_${index + 1}`,
      sequence: index + 1,
      simTime: `2026-06-22T08:${String(index).padStart(2, '0')}:00`,
      roomId: 'living',
      deviceId: 'motion_01',
      deviceType: 'motion_sensor',
      field: 'motion',
      value: true
    }));
    const memory = reduceDeviceEvents(createHomeMemory(), events);
    const hypotheses = createHomeProfileHypotheses(memory);

    const presence = hypotheses.find((hypothesis) => hypothesis.type === 'presence_signal');
    const roomHabit = hypotheses.find((hypothesis) => hypothesis.type === 'room_habit');
    const householdSize = hypotheses.find((hypothesis) => hypothesis.type === 'household_size');

    expect(memory.totalEvents).toBe(20);
    expect(memory.episodeCount).toBe(1);
    expect(presence?.summary).toMatch(/1 behavior episode/i);
    expect(roomHabit?.summary).toMatch(/1 behavior episode/i);
    expect(householdSize?.summary).toMatch(/1 behavior episode/i);
    expect(householdSize?.summary).not.toMatch(/2-5 residents/);
  });

  it('uses daily summaries for longer-window rhythm and household reasoning', () => {
    const events = [
      deviceEvent({
        id: 'day_1_kitchen',
        sourceEventId: 'source_day_1_kitchen',
        sequence: 1,
        ts: '2026-06-22T00:00:00.000Z',
        simTime: '2026-06-22T07:30:00',
        roomId: 'kitchen',
        deviceId: 'kitchen_motion_01',
        deviceType: 'motion_sensor',
        field: 'motion',
        value: true
      }),
      deviceEvent({
        id: 'day_1_living',
        sourceEventId: 'source_day_1_living',
        sequence: 2,
        ts: '2026-06-22T11:00:00.000Z',
        simTime: '2026-06-22T19:00:00',
        roomId: 'living',
        deviceId: 'tv_01',
        deviceType: 'tv',
        field: 'power',
        value: true
      }),
      deviceEvent({
        id: 'day_2_kitchen',
        sourceEventId: 'source_day_2_kitchen',
        sequence: 3,
        ts: '2026-06-23T00:00:00.000Z',
        simTime: '2026-06-23T07:45:00',
        roomId: 'kitchen',
        deviceId: 'kitchen_motion_01',
        deviceType: 'motion_sensor',
        field: 'motion',
        value: true
      }),
      deviceEvent({
        id: 'day_2_study',
        sourceEventId: 'source_day_2_study',
        sequence: 4,
        ts: '2026-06-23T12:00:00.000Z',
        simTime: '2026-06-23T20:00:00',
        roomId: 'study',
        deviceId: 'desk_lamp_01',
        deviceType: 'lamp',
        field: 'power',
        value: true
      })
    ];
    const memory = reduceDeviceEvents(createHomeMemory(), events);
    const hypotheses = createHomeProfileHypotheses(memory);

    const morningRhythm = hypotheses.find((hypothesis) => hypothesis.id === 'rhythm:morning');
    const householdSize = hypotheses.find((hypothesis) => hypothesis.type === 'household_size');

    expect(memory.dailySummaryCount).toBe(2);
    expect(memory.weeklySummaryCount).toBe(1);
    expect(morningRhythm?.summary).toMatch(/2 observed days/i);
    expect(morningRhythm?.summary).toMatch(/1 observed week/i);
    expect(morningRhythm?.summary).toMatch(/2 day-level matches/i);
    expect(householdSize?.summary).toMatch(/2 observed days/i);
    expect(householdSize?.summary).toMatch(/1 observed week/i);
    expect(householdSize?.summary).toMatch(/3 long-window room/i);
  });

  it('returns no hypotheses for empty memory', () => {
    expect(createHomeProfileHypotheses(createHomeMemory())).toEqual([]);
  });

  it('returns deterministic hypotheses for the same memory input', () => {
    const memory = profiledMemory();

    expect(createHomeProfileHypotheses(memory)).toEqual(createHomeProfileHypotheses(memory));
  });
});
