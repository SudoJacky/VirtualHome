import { describe, expect, it } from 'vitest';
import { createSimulator } from '../src/sim/engine';
import { createFloorplan3DModel } from '../src/web/floorplan3dModel';
import { buildReplayShareReport } from '../src/web/replayShareReport';

describe('replay share report', () => {
  it('creates a self-contained read-only event chain with source and target device models', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('night_water_leak');
    simulator.advanceMinutes(10);

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());
    const replay = model.eventReplays.find((item) => item.ruleId === 'close_water_valve_on_leak');
    expect(replay).toBeDefined();

    const report = buildReplayShareReport(replay!);

    expect(report).toMatchObject({
      schemaVersion: 1,
      readOnly: true,
      title: replay!.title,
      ruleId: 'close_water_valve_on_leak',
      sourceDeviceId: 'water_leak_01',
      targetDeviceId: 'water_valve_01'
    });
    expect(report.devices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        deviceId: 'water_leak_01',
        displayName: 'Bathroom Leak Sensor',
        role: 'source',
        timeline: expect.arrayContaining([
          expect.objectContaining({ phase: 'before', state: { leakDetected: false } }),
          expect.objectContaining({ phase: 'after', state: { leakDetected: true } })
        ])
      }),
      expect.objectContaining({
        deviceId: 'water_valve_01',
        displayName: 'Main Water Valve',
        role: 'target',
        timeline: expect.arrayContaining([
          expect.objectContaining({ phase: 'before', state: { valveOpen: true } }),
          expect.objectContaining({ phase: 'after', state: { valveOpen: false } })
        ])
      })
    ]));
    expect(report.steps.map((step) => step.kind)).toEqual(['precondition', 'sensor', 'automation', 'command', 'result']);
    expect(report.steps.find((step) => step.kind === 'command')).toMatchObject({
      deviceId: 'water_valve_01',
      commandStatus: 'acknowledged',
      commandReason: 'rule:close_water_valve_on_leak'
    });
  });
});
