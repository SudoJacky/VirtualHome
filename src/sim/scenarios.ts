import type { RoomId, ScenarioId, StaticScenarioId } from '../shared/types';

export type ScenarioAction =
  | { kind: 'movePerson'; personId: string; to: RoomId | 'away'; activity: string }
  | { kind: 'setHomeMode'; mode: 'morning' | 'away' | 'evening_home' | 'sleeping' | 'alert' }
  | { kind: 'setDevice'; deviceId: string; state: Record<string, string | number | boolean | null>; reason: string }
  | { kind: 'startActivity'; activityId: string; participants: string[]; roomId: RoomId; reason: string }
  | { kind: 'endActivity'; activityId: string; reason: string }
  | { kind: 'createAlert'; alertId: string; severity: 'info' | 'warning' | 'high'; roomId: RoomId; message: string; recommendedAction: string; reason: string };

export interface ScenarioStep {
  minute: number;
  actions: ScenarioAction[];
}

export interface ScenarioDefinition {
  id: ScenarioId;
  name: string;
  startTime: string;
  speed: number;
  initialMode: 'morning' | 'away' | 'evening_home' | 'sleeping' | 'alert';
  initialPeople: Record<string, { location: RoomId | 'away'; activity: string }>;
  calendar?: {
    date: string;
    dayType: 'weekday' | 'weekend';
    season: 'spring' | 'summer' | 'autumn' | 'winter';
    month: number;
    dayOfWeek: number;
    holidayName?: string | null;
    schoolDay?: boolean;
    workday?: boolean;
  };
  steps: ScenarioStep[];
}

export const scenarios: Record<StaticScenarioId, ScenarioDefinition> = {
  weekday_normal: {
    id: 'weekday_normal',
    name: '普通工作日',
    startTime: '2026-06-17T06:20:00+08:00',
    speed: 60,
    initialMode: 'morning',
    initialPeople: {
      adult_1: { location: 'master_bedroom', activity: 'sleeping' },
      adult_2: { location: 'master_bedroom', activity: 'sleeping' },
      child_1: { location: 'child_bedroom', activity: 'sleeping' },
      pet_1: { location: 'living_room', activity: 'resting' }
    },
    steps: [
      {
        minute: 1,
        actions: [
          { kind: 'movePerson', personId: 'adult_1', to: 'master_bedroom', activity: 'waking_up' },
          { kind: 'setDevice', deviceId: 'master_sleep_01', state: { inBed: false, heartRateSimulated: 72 }, reason: 'activity:waking_up' }
        ]
      },
      {
        minute: 5,
        actions: [
          { kind: 'movePerson', personId: 'adult_1', to: 'bathroom', activity: 'bathroom' },
          { kind: 'setDevice', deviceId: 'bathroom_water_01', state: { flowLMin: 5.4 }, reason: 'activity:bathroom' }
        ]
      },
      {
        minute: 10,
        actions: [
          { kind: 'movePerson', personId: 'adult_1', to: 'kitchen', activity: 'breakfast' },
          { kind: 'startActivity', activityId: 'breakfast', participants: ['adult_1'], roomId: 'kitchen', reason: 'schedule:weekday_morning' },
          { kind: 'setDevice', deviceId: 'kitchen_light_01', state: { power: 'on', brightness: 70 }, reason: 'activity:breakfast' },
          { kind: 'setDevice', deviceId: 'fridge_01', state: { doorOpen: true, powerW: 140 }, reason: 'activity:breakfast' },
          { kind: 'setDevice', deviceId: 'dining_light_01', state: { power: 'on', brightness: 45 }, reason: 'activity:breakfast' }
        ]
      },
      {
        minute: 25,
        actions: [
          { kind: 'movePerson', personId: 'child_1', to: 'kitchen', activity: 'breakfast' },
          { kind: 'startActivity', activityId: 'child_breakfast', participants: ['child_1'], roomId: 'kitchen', reason: 'schedule:school_day' }
        ]
      },
      {
        minute: 40,
        actions: [
          { kind: 'movePerson', personId: 'adult_2', to: 'kitchen', activity: 'coffee' },
          { kind: 'setDevice', deviceId: 'fridge_01', state: { doorOpen: false, powerW: 95 }, reason: 'activity:breakfast_done' }
        ]
      },
      {
        minute: 85,
        actions: [
          { kind: 'movePerson', personId: 'adult_1', to: 'away', activity: 'commuting' },
          { kind: 'movePerson', personId: 'child_1', to: 'away', activity: 'school' },
          { kind: 'movePerson', personId: 'adult_2', to: 'study', activity: 'remote_work' },
          { kind: 'setDevice', deviceId: 'door_lock_01', state: { locked: true }, reason: 'activity:morning_departure' },
          { kind: 'setDevice', deviceId: 'kitchen_light_01', state: { power: 'off', brightness: 0 }, reason: 'activity:breakfast_done' },
          { kind: 'setDevice', deviceId: 'dining_light_01', state: { power: 'off', brightness: 0 }, reason: 'activity:breakfast_done' },
          { kind: 'endActivity', activityId: 'breakfast', reason: 'schedule:morning_done' },
          { kind: 'endActivity', activityId: 'child_breakfast', reason: 'schedule:school_departure' }
        ]
      },
      {
        minute: 600,
        actions: [
          { kind: 'setHomeMode', mode: 'evening_home' },
          { kind: 'movePerson', personId: 'child_1', to: 'child_bedroom', activity: 'homework' },
          { kind: 'movePerson', personId: 'adult_1', to: 'living_room', activity: 'arrived_home' },
          { kind: 'setDevice', deviceId: 'child_sleep_01', state: { inBed: false, heartRateSimulated: 76 }, reason: 'activity:homework' }
        ]
      },
      {
        minute: 720,
        actions: [
          { kind: 'movePerson', personId: 'adult_2', to: 'kitchen', activity: 'cooking_dinner' },
          { kind: 'startActivity', activityId: 'cooking_dinner', participants: ['adult_2'], roomId: 'kitchen', reason: 'schedule:weekday_evening' },
          { kind: 'setDevice', deviceId: 'stove_01', state: { powerW: 850, level: 6 }, reason: 'activity:cooking_dinner' }
        ]
      },
      {
        minute: 760,
        actions: [
          { kind: 'movePerson', personId: 'adult_1', to: 'dining_room', activity: 'dinner' },
          { kind: 'movePerson', personId: 'adult_2', to: 'dining_room', activity: 'dinner' },
          { kind: 'movePerson', personId: 'child_1', to: 'dining_room', activity: 'dinner' },
          { kind: 'startActivity', activityId: 'family_dinner', participants: ['adult_1', 'adult_2', 'child_1'], roomId: 'dining_room', reason: 'schedule:weekday_evening' },
          { kind: 'setDevice', deviceId: 'stove_01', state: { powerW: 0, level: 0 }, reason: 'activity:cooking_done' },
          { kind: 'setDevice', deviceId: 'range_hood_01', state: { power: 'off', speed: 0 }, reason: 'activity:cooking_done' },
          { kind: 'setDevice', deviceId: 'dining_light_01', state: { power: 'on', brightness: 65 }, reason: 'activity:dinner' },
          { kind: 'endActivity', activityId: 'cooking_dinner', reason: 'schedule:dinner_ready' }
        ]
      },
      {
        minute: 835,
        actions: [
          { kind: 'movePerson', personId: 'adult_1', to: 'living_room', activity: 'watching_tv' },
          { kind: 'movePerson', personId: 'adult_2', to: 'living_room', activity: 'watching_tv' },
          { kind: 'movePerson', personId: 'child_1', to: 'living_room', activity: 'watching_tv' },
          { kind: 'startActivity', activityId: 'watching_tv', participants: ['adult_1', 'adult_2', 'child_1'], roomId: 'living_room', reason: 'schedule:weekday_evening' },
          { kind: 'setDevice', deviceId: 'tv_01', state: { power: 'on', app: 'streaming', volume: 18 }, reason: 'activity:watching_tv' },
          { kind: 'setDevice', deviceId: 'living_light_01', state: { power: 'on', brightness: 40 }, reason: 'activity:watching_tv' },
          { kind: 'endActivity', activityId: 'family_dinner', reason: 'schedule:dinner_done' }
        ]
      },
      {
        minute: 930,
        actions: [
          { kind: 'movePerson', personId: 'child_1', to: 'child_bedroom', activity: 'sleeping' },
          { kind: 'setDevice', deviceId: 'child_sleep_01', state: { inBed: true, heartRateSimulated: 64 }, reason: 'activity:child_sleeping' }
        ]
      },
      {
        minute: 1020,
        actions: [
          { kind: 'setHomeMode', mode: 'sleeping' },
          { kind: 'movePerson', personId: 'adult_1', to: 'master_bedroom', activity: 'sleeping' },
          { kind: 'movePerson', personId: 'adult_2', to: 'master_bedroom', activity: 'sleeping' },
          { kind: 'setDevice', deviceId: 'master_sleep_01', state: { inBed: true, heartRateSimulated: 61 }, reason: 'activity:sleeping' },
          { kind: 'setDevice', deviceId: 'dining_light_01', state: { power: 'off', brightness: 0 }, reason: 'activity:sleeping' },
          { kind: 'endActivity', activityId: 'watching_tv', reason: 'schedule:sleeping' }
        ]
      }
    ]
  },
  away_day: {
    id: 'away_day',
    name: '全家外出',
    startTime: '2026-06-17T08:00:00+08:00',
    speed: 60,
    initialMode: 'morning',
    initialPeople: {
      adult_1: { location: 'entrance', activity: 'leaving_home' },
      adult_2: { location: 'living_room', activity: 'preparing_to_leave' },
      child_1: { location: 'entrance', activity: 'leaving_home' },
      pet_1: { location: 'living_room', activity: 'resting' }
    },
    steps: [
      {
        minute: 2,
        actions: [
          { kind: 'movePerson', personId: 'adult_1', to: 'away', activity: 'commuting' },
          { kind: 'movePerson', personId: 'child_1', to: 'away', activity: 'school' },
          { kind: 'setDevice', deviceId: 'stove_01', state: { powerW: 1200, level: 8 }, reason: 'abnormality:stove_unattended' },
          { kind: 'setDevice', deviceId: 'door_lock_01', state: { locked: false }, reason: 'activity:leaving_home' }
        ]
      },
      {
        minute: 8,
        actions: [
          { kind: 'movePerson', personId: 'adult_2', to: 'away', activity: 'out' },
          { kind: 'setDevice', deviceId: 'door_lock_01', state: { locked: true }, reason: 'activity:last_person_left' }
        ]
      }
    ]
  },
  night_water_leak: {
    id: 'night_water_leak',
    name: '夜间漏水',
    startTime: '2026-06-17T02:10:00+08:00',
    speed: 60,
    initialMode: 'sleeping',
    initialPeople: {
      adult_1: { location: 'master_bedroom', activity: 'sleeping' },
      adult_2: { location: 'master_bedroom', activity: 'sleeping' },
      child_1: { location: 'child_bedroom', activity: 'sleeping' },
      pet_1: { location: 'living_room', activity: 'sleeping' }
    },
    steps: [
      {
        minute: 3,
        actions: [
          { kind: 'setDevice', deviceId: 'bathroom_water_01', state: { flowLMin: 8.8 }, reason: 'abnormality:night_water_leak' },
          { kind: 'setDevice', deviceId: 'water_leak_01', state: { leakDetected: true }, reason: 'abnormality:night_water_leak' },
          {
            kind: 'createAlert',
            alertId: 'water_leak_001',
            severity: 'high',
            roomId: 'bathroom',
            message: 'Bathroom leak detected while home is sleeping',
            recommendedAction: 'close_water_valve',
            reason: 'water_leak_sensor:true'
          }
        ]
      }
    ]
  }
};

export function getScenarioIds(): StaticScenarioId[] {
  return ['weekday_normal', 'away_day', 'night_water_leak'];
}

export function getScenario(id: StaticScenarioId): ScenarioDefinition {
  return scenarios[id];
}
