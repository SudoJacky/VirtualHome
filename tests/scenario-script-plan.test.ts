import { describe, expect, it } from 'vitest';
import { createScenarioScriptPlan } from '../src/web/scenarioScriptPlan';

describe('scenario script plan', () => {
  it('runs appliance injection scripts from an awake weekday context', () => {
    expect(createScenarioScriptPlan('fridge_left_open')).toEqual([
      { kind: 'startScenario', scenarioId: 'weekday_normal' },
      { kind: 'advance', minutes: 45 },
      { kind: 'inject', abnormality: 'fridge_left_open' },
      { kind: 'advance', minutes: 2 },
      { kind: 'commandDevice', deviceId: 'fridge_01', command: 'close' }
    ]);
  });

  it('keeps debug-only current-state injections out of scripted scenario cards', () => {
    const plan = createScenarioScriptPlan('door_left_open');

    expect(plan[0]).toEqual({ kind: 'startScenario', scenarioId: 'away_day' });
    expect(plan).toContainEqual({ kind: 'inject', abnormality: 'door_left_open' });
  });

  it('keeps dedicated built-in and telemetry scripts explicit', () => {
    expect(createScenarioScriptPlan('night_water_leak')).toEqual([
      { kind: 'startScenario', scenarioId: 'night_water_leak' },
      { kind: 'advance', minutes: 10 }
    ]);
    expect(createScenarioScriptPlan('kitchen_air_quality')).toEqual([
      { kind: 'startScenario', scenarioId: 'weekday_normal' },
      { kind: 'advance', minutes: 750 }
    ]);
  });

  it('turns the network outage card into a recovery storyline', () => {
    expect(createScenarioScriptPlan('network_offline')).toEqual([
      { kind: 'startScenario', scenarioId: 'weekday_normal' },
      { kind: 'advance', minutes: 605 },
      { kind: 'inject', abnormality: 'network_offline' },
      { kind: 'advance', minutes: 2 },
      { kind: 'commandDevice', deviceId: 'router_01', command: 'restart' },
      { kind: 'advance', minutes: 2 }
    ]);
  });

  it('turns senior no activity into a family check-in recovery storyline', () => {
    expect(createScenarioScriptPlan('senior_no_activity')).toEqual([
      { kind: 'startScenario', scenarioId: 'weekday_normal' },
      { kind: 'advance', minutes: 140 },
      { kind: 'inject', abnormality: 'senior_no_activity' },
      { kind: 'advance', minutes: 2 },
      { kind: 'resolve', abnormality: 'senior_no_activity' }
    ]);
  });
});
