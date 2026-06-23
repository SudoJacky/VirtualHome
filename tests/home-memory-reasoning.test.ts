import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';
import { createHomeProfileHypotheses } from '../src/web/homeProfiler';
import {
  createEventEvidenceFlow,
  createHypothesisReasoning
} from '../src/web/homeMemoryReasoning';

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
      id: 'living_evening_1',
      sourceEventId: 'source_living_evening_1',
      sequence: 3,
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
      sequence: 4,
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
      sequence: 5,
      simTime: '2026-06-22T23:30:00',
      roomId: 'bathroom',
      deviceId: 'bathroom_motion_01',
      deviceType: 'motion_sensor',
      field: 'motion',
      value: true
    })
  ]);
}

describe('home memory reasoning flow', () => {
  it('explains how a device event flows into fact memory and related hypotheses', () => {
    const memory = profiledMemory();
    const hypotheses = createHomeProfileHypotheses(memory);
    const latestEvent = memory.recentEvents[0];

    const flow = createEventEvidenceFlow(memory, hypotheses, latestEvent);

    expect(flow).not.toBeNull();
    if (!flow) {
      throw new Error('expected event flow');
    }
    expect(flow.title).toBe('bathroom_motion_01.motion changed to true');
    expect(flow.steps.map((step) => step.label)).toEqual([
      'Device event',
      'Fact memory',
      'Evidence aggregate',
      'Hypothesis update'
    ]);
    expect(flow.steps[0].metrics).toEqual([
      { label: 'Category', value: 'human activity' },
      { label: 'Strength', value: 'medium' },
      { label: 'Change', value: 'meaningful' },
      { label: 'Profile weight', value: '0.55' }
    ]);
    expect(flow.steps[1].detail).toContain('bathroom / bathroom_motion_01 / motion');
    expect(flow.steps[2].metrics).toEqual([
      { label: 'Room events', value: '1' },
      { label: 'Device events', value: '1' },
      { label: 'Field events', value: '1' }
    ]);
    expect(flow.relatedHypotheses.map((hypothesis) => hypothesis.id)).toEqual(expect.arrayContaining([
      'presence:recent-activity',
      'household:size',
      'room:bathroom:habit'
    ]));
  });

  it('explains the household size inference using rule inputs and the matched rule', () => {
    const memory = profiledMemory();
    const hypothesis = createHomeProfileHypotheses(memory).find((candidate) => candidate.type === 'household_size');

    expect(hypothesis).toBeDefined();
    const reasoning = createHypothesisReasoning(memory, hypothesis!);

    expect(reasoning.title).toBe('Probable household size');
    expect(reasoning.inputs).toEqual([
      { label: 'Meaningful rooms', value: '4' },
      { label: 'Weighted evidence', value: '2.6' },
      { label: 'Raw events', value: '5' }
    ]);
    expect(reasoning.rule).toBe('Sparse evidence keeps the resident count uncertain.');
    expect(reasoning.result).toBe('Uncertain resident count');
    expect(reasoning.steps.map((step) => step.label)).toEqual([
      'Collect room activity',
      'Count observed events',
      'Evaluate household size rule',
      'Attach evidence'
    ]);
  });
});
