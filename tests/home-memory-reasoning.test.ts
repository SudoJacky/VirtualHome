import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';
import { createHomeProfileHypotheses } from '../src/web/homeProfiler';
import {
  createEventEvidenceFlow,
  createHypothesisReasoning,
  createHypothesisWhiteBoxTrace
} from '../src/web/homeMemoryReasoning';
import { createMemoryDemoWalkthrough } from '../src/web/homeMemoryViewModel';

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
      'Semantic signals',
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
    expect(flow.steps[1].detail).toContain('presence signal');
    expect(flow.steps[1].metrics).toEqual([
      { label: 'Signals', value: '1' },
      { label: 'Types', value: 'presence signal' }
    ]);
    expect(flow.steps[2].detail).toContain('bathroom / bathroom_motion_01 / motion');
    expect(flow.steps[3].metrics).toEqual([
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
      { label: 'Estimate', value: '1 resident' },
      { label: 'Lower bound', value: '1' },
      { label: 'Distribution', value: '1:34%/2:18%/3:32%/4:12%/5:5%' },
      { label: 'Concurrent rooms', value: '1' },
      { label: 'Sleep zones', value: '0' },
      { label: 'Shared sleep candidate', value: 'none' },
      { label: 'Routine clusters', value: '4' },
      { label: 'Meaningful rooms', value: '4' },
      { label: 'Weighted evidence', value: '1' },
      { label: 'Behavior episodes', value: '1' },
      { label: 'Weak environment ratio', value: '0%' }
    ]);
    expect(reasoning.rule).toBe('Sparse or non-overlapping activity keeps the lower bound at 1 while routine clusters shape the probability distribution.');
    expect(reasoning.result).toContain('Estimated 1 resident');
    expect(reasoning.result).toContain('Distribution 1:34%, 2:18%, 3:32%, 4:12%, 5:5%');
    expect(reasoning.steps.map((step) => step.label)).toEqual([
      'Find concurrent lower bound',
      'Collect stable resident signals',
      'Score resident distribution',
      'Attach evidence'
    ]);
  });

  it('creates a detailed white-box trace for household size conclusions', () => {
    const memory = profiledMemory();
    const hypothesis = createHomeProfileHypotheses(memory).find((candidate) => candidate.type === 'household_size');

    expect(hypothesis).toBeDefined();
    const trace = createHypothesisWhiteBoxTrace(memory, hypothesis!);

    expect(trace.title).toBe('Why this conclusion was inferred');
    expect(trace.conclusion).toEqual({
      label: 'Probable household size',
      type: 'household_size',
      confidence: '62%',
      summary: expect.stringContaining('suggests 1 resident')
    });
    expect(trace.sections.map((section) => section.title)).toEqual([
      'Observed conclusion',
      'Direct evidence',
      'Semantic interpretation',
      'Aggregate features',
      'Candidate scoring',
      'Score ledger',
      'Confidence calculation',
      'Missing or weak evidence'
    ]);
    expect(trace.sections.find((section) => section.title === 'Aggregate features')?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Routine clusters', value: '4', note: expect.stringContaining('meal activity') }),
      { label: 'Environment weak-context ratio', value: '0%', note: 'High ratios cap resident-count confidence.' }
    ]));
    expect(trace.sections.find((section) => section.title === 'Candidate scoring')?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '1 resident', value: '34%' }),
      expect.objectContaining({ label: '3 residents', value: '32%' })
    ]));
    expect(trace.sections.find((section) => section.title === 'Score ledger')?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '1 resident total', value: expect.any(String), note: expect.stringContaining('probability 34%') }),
      expect.objectContaining({ label: '1R Base score', value: '+1', note: '1' }),
      expect.objectContaining({ label: '1R Routine estimate distance', note: expect.stringContaining('routineEstimate') })
    ]));
    expect(trace.sections.find((section) => section.title === 'Confidence calculation')?.rows).toEqual(expect.arrayContaining([
      { label: 'Final confidence', value: '62%', note: 'The UI should treat this as probabilistic, not ground truth.' }
    ]));
  });

  it('creates a white-box trace for non-household conclusions from evidence, semantics, and rule inputs', () => {
    const memory = profiledMemory();
    const hypothesis = createHomeProfileHypotheses(memory).find((candidate) => candidate.id === 'room:bathroom:habit');

    expect(hypothesis).toBeDefined();
    const trace = createHypothesisWhiteBoxTrace(memory, hypothesis!);

    expect(trace.conclusion).toEqual(expect.objectContaining({
      label: 'Bathroom habit',
      type: 'room_habit',
      confidence: '44%'
    }));
    expect(trace.sections.map((section) => section.title)).toEqual([
      'Observed conclusion',
      'Direct evidence',
      'Semantic interpretation',
      'Rule inputs',
      'Confidence calculation',
      'Missing or weak evidence'
    ]);
    expect(trace.sections.find((section) => section.title === 'Direct evidence')?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'bathroom_motion_01.motion',
        value: 'true',
        note: expect.stringContaining('bathroom')
      })
    ]));
    expect(trace.sections.find((section) => section.title === 'Semantic interpretation')?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'presence signal',
        value: 'bathroom'
      })
    ]));
  });

  it('builds a presenter walkthrough that follows the full event-to-memory explanation order', () => {
    const memory = profiledMemory();
    const hypotheses = createHomeProfileHypotheses(memory);
    const hypothesis = hypotheses.find((candidate) => candidate.type === 'household_size');

    expect(hypothesis).toBeDefined();
    const walkthrough = createMemoryDemoWalkthrough(memory, hypotheses, hypothesis!);

    expect(walkthrough.title).toBe('Presenter walkthrough');
    expect(walkthrough.subject).toBe('Probable household size');
    expect(walkthrough.stages.map((stage) => stage.title)).toEqual([
      '1. Device event stream',
      '2. Evidence classification',
      '3. Fact memory',
      '4. Semantic interpretation',
      '5. Episodes and summaries',
      '6. Profile hypothesis',
      '7. White-box calculation'
    ]);
    expect(walkthrough.stages[0].talkTrack).toContain('/ws/device-events');
    expect(walkthrough.stages[1].metrics).toEqual(expect.arrayContaining([
      { label: 'Category', value: 'human activity' },
      { label: 'Strength', value: 'medium' }
    ]));
    expect(walkthrough.stages[3].evidence).toContain('presence signal');
    expect(walkthrough.stages[4].metrics).toEqual(expect.arrayContaining([
      { label: 'Episodes', value: '4' },
      { label: 'Days', value: '1' },
      { label: 'Weeks', value: '1' }
    ]));
    expect(walkthrough.stages[5].talkTrack).toContain('Probable household size');
    expect(walkthrough.stages[6].evidence).toContain('Candidate scoring');
    expect(walkthrough.stages[6].evidence).toContain('Score ledger');
  });

  it('localizes the presenter walkthrough for Chinese demos', () => {
    const memory = profiledMemory();
    const hypotheses = createHomeProfileHypotheses(memory);
    const hypothesis = hypotheses.find((candidate) => candidate.type === 'household_size');

    expect(hypothesis).toBeDefined();
    const walkthrough = createMemoryDemoWalkthrough(memory, hypotheses, hypothesis!, 'zh');

    expect(walkthrough.title).toBe('演示串讲');
    expect(walkthrough.summary).toContain('设备事件');
    expect(walkthrough.stages.map((stage) => stage.title)).toEqual([
      '1. 设备事件流',
      '2. 证据分类',
      '3. 事实记忆',
      '4. 语义解释',
      '5. 行为片段与摘要',
      '6. 画像结论',
      '7. 白盒计算'
    ]);
    expect(walkthrough.stages[0].talkTrack).toContain('/ws/device-events');
    expect(walkthrough.stages[0].talkTrack).toContain('设备字段');
    expect(walkthrough.stages[0].evidence).toContain('变为');
    expect(walkthrough.stages[1].talkTrack).toContain('画像权重');
    expect(walkthrough.stages[5].talkTrack).toContain('概率画像');
    expect(walkthrough.stages[6].evidence).toContain('候选评分');
    expect(walkthrough.stages[6].evidence).toContain('评分账本');
  });
});
