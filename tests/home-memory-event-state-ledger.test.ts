import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { createEventStateLedger } from '../src/web/homeMemoryEventStateLedger';

const STEP_TITLES = [
  '1. Raw Event',
  '2. Run / Time',
  '3. Classification',
  '4. Change Analysis',
  '5. MemoryEvidence',
  '6. FieldMemory',
  '7. DeviceMemory',
  '8. RoomMemory',
  '9. Low-Level Episode',
  '10. Daily / Weekly Summary',
  '11. Semantic Signal',
  '12. Activity Episode',
  '13. HomeMemory Root',
  '14. Hypothesis Impact'
];

function deviceEvent(overrides: Partial<DeviceValueEvent> = {}): DeviceValueEvent {
  return {
    id: 'event_1',
    sourceEventId: 'source_event_1',
    sourceEventType: 'DeviceTelemetry',
    runId: 'run_a',
    sequence: 1,
    ts: '2026-06-22T00:00:00.000Z',
    simTime: '2026-06-22T08:00:00',
    homeId: 'home_1',
    roomId: 'entry',
    deviceId: 'front_lock',
    deviceType: 'smart_lock',
    field: 'lock',
    value: 'locked',
    ...overrides
  };
}

describe('home memory event state ledger', () => {
  it('builds a 14-step ledger for an access event with prior replayed memory', () => {
    const ledger = createEventStateLedger([
      deviceEvent({
        id: 'entry_motion_detected',
        sourceEventId: 'source_entry_motion_detected',
        sequence: 1,
        deviceId: 'entry_motion',
        deviceType: 'motion_sensor',
        field: 'motion',
        value: true
      }),
      deviceEvent({
        id: 'front_lock_unlocked',
        sourceEventId: 'source_front_lock_unlocked',
        sequence: 2,
        value: 'unlocked'
      })
    ], 'front_lock_unlocked');

    expect(ledger).not.toBeNull();
    if (!ledger) {
      throw new Error('expected ledger');
    }

    expect(ledger.title).toBe('front_lock.lock -> unlocked');
    expect(ledger.steps.map((step) => step.title)).toEqual(STEP_TITLES);

    const classification = ledger.steps.find((step) => step.title === '3. Classification');
    expect(classification?.narration).toContain('access_control');
    expect(classification?.metrics).toEqual(expect.arrayContaining([
      { label: 'Capability', value: 'access_control' },
      { label: 'Evidence category', value: 'human_activity' },
      { label: 'Base weight', value: '1' }
    ]));

    const changeAnalysis = ledger.steps.find((step) => step.title === '4. Change Analysis');
    expect(changeAnalysis?.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'profileWeight',
        before: '0',
        after: '1'
      })
    ]));

    const memoryEvidence = ledger.steps.find((step) => step.title === '5. MemoryEvidence');
    expect(memoryEvidence?.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'recentEvents.length',
        before: '1',
        after: '2'
      })
    ]));

    const semanticSignal = ledger.steps.find((step) => step.title === '11. Semantic Signal');
    expect(semanticSignal?.narration).toContain('access_signal');
    expect(semanticSignal?.metrics).toEqual(expect.arrayContaining([
      { label: 'Types', value: 'presence_signal, access_signal' }
    ]));
    expect(semanticSignal?.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'semanticSignals.length',
        before: '1',
        after: '3'
      })
    ]));
    expect(semanticSignal?.changes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        before: 'none'
      })
    ]));

    const hypothesisImpact = ledger.steps.find((step) => step.title === '14. Hypothesis Impact');
    expect(hypothesisImpact?.relatedHypothesisIds).toEqual(expect.arrayContaining(['presence:recent-activity']));
  });

  it('explains repeated environment telemetry without producing a new semantic signal', () => {
    const ledger = createEventStateLedger([
      deviceEvent({
        id: 'temperature_1',
        sourceEventId: 'source_temperature_1',
        sequence: 1,
        roomId: 'living',
        deviceId: 'living_temperature',
        deviceType: 'temperature_sensor',
        field: 'temperature',
        value: 24
      }),
      deviceEvent({
        id: 'temperature_2',
        sourceEventId: 'source_temperature_2',
        sequence: 2,
        roomId: 'living',
        deviceId: 'living_temperature',
        deviceType: 'temperature_sensor',
        field: 'temperature',
        value: 24.2
      })
    ], 'temperature_2');

    expect(ledger).not.toBeNull();
    if (!ledger) {
      throw new Error('expected ledger');
    }

    const changeAnalysis = ledger.steps.find((step) => step.title === '4. Change Analysis');
    expect(changeAnalysis?.metrics).toEqual(expect.arrayContaining([
      { label: 'Value delta', value: '0.2' },
      { label: 'Meaningful change', value: 'false' },
      { label: 'Profile weight', value: '0' }
    ]));
    expect(changeAnalysis?.narration).toContain('0.5');

    const semanticSignal = ledger.steps.find((step) => step.title === '11. Semantic Signal');
    expect(semanticSignal?.narration).toContain('没有生成新的生活语义');
  });
});
