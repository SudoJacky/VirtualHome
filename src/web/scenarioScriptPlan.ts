import type { StaticScenarioId } from '../shared/types';

export type ScenarioCardId =
  | StaticScenarioId
  | 'door_left_open'
  | 'fridge_left_open'
  | 'kitchen_air_quality'
  | 'network_offline';

export type ScenarioScriptAction =
  | { kind: 'startScenario'; scenarioId: StaticScenarioId }
  | { kind: 'advance'; minutes: number }
  | { kind: 'inject'; abnormality: 'door_left_open' | 'fridge_left_open' | 'network_offline' | 'senior_no_activity' }
  | { kind: 'resolve'; abnormality: 'door_left_open' | 'fridge_left_open' | 'network_offline' | 'senior_no_activity' }
  | { kind: 'commandDevice'; deviceId: string; command: string; value?: string | number | boolean | null };

export function createScenarioScriptPlan(cardId: string): ScenarioScriptAction[] {
  if (cardId === 'weekday_normal') {
    return [{ kind: 'startScenario', scenarioId: 'weekday_normal' }];
  }
  if (cardId === 'away_day') {
    return [{ kind: 'startScenario', scenarioId: 'away_day' }];
  }
  if (cardId === 'night_water_leak') {
    return [
      { kind: 'startScenario', scenarioId: 'night_water_leak' },
      { kind: 'advance', minutes: 10 }
    ];
  }
  if (cardId === 'kitchen_air_quality') {
    return [
      { kind: 'startScenario', scenarioId: 'weekday_normal' },
      { kind: 'advance', minutes: 750 }
    ];
  }
  if (cardId === 'fridge_left_open') {
    return [
      { kind: 'startScenario', scenarioId: 'weekday_normal' },
      { kind: 'advance', minutes: 45 },
      { kind: 'inject', abnormality: 'fridge_left_open' },
      { kind: 'advance', minutes: 2 },
      { kind: 'commandDevice', deviceId: 'fridge_01', command: 'close' }
    ];
  }
  if (cardId === 'door_left_open') {
    return [
      { kind: 'startScenario', scenarioId: 'away_day' },
      { kind: 'advance', minutes: 8 },
      { kind: 'inject', abnormality: 'door_left_open' }
    ];
  }
  if (cardId === 'network_offline') {
    return [
      { kind: 'startScenario', scenarioId: 'weekday_normal' },
      { kind: 'advance', minutes: 605 },
      { kind: 'inject', abnormality: 'network_offline' },
      { kind: 'advance', minutes: 2 },
      { kind: 'commandDevice', deviceId: 'router_01', command: 'restart' },
      { kind: 'advance', minutes: 2 }
    ];
  }
  return [];
}
