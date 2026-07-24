import type { DeviceDefinition, PersonDefinition, RoomDefinition, RoomId } from '../shared/types';
import type { ExternalContext } from './externalContext';
import type { ScenarioAction, ScenarioStep } from './scenarios';

export interface LifeEventHabit {
  id: string;
  repertoire: string;
  activity: string;
  residentIds: string[];
  recurrence: 'daily' | 'weekdays' | 'weekends' | 'workdays' | 'schooldays';
  window: { start: string; end: string };
  roomId?: RoomId;
  roomPurpose?: string;
  probability?: number;
}

export interface LifeEventCompileInput {
  habit: LifeEventHabit;
  minute: number;
  room: RoomDefinition;
  devices: readonly DeviceDefinition[];
  residents: readonly PersonDefinition[];
  environment: Readonly<ExternalContext>;
  seed: number;
}

export interface LifeEventDefinition {
  preferredRoomType: RoomDefinition['type'];
  compile(input: LifeEventCompileInput): ScenarioStep[];
}

export interface LifeEventRepertoire {
  id: string;
  version: string;
  activities: Readonly<Record<string, LifeEventDefinition>>;
}

export const coreHouseholdRepertoire: LifeEventRepertoire = {
  id: 'core_household',
  version: '1.0.0',
  activities: {
    wake_up: activity('bedroom', compileRoomActivity),
    sleep: activity('bedroom', compileRoomActivity),
    remote_work: activity('work', compileRoomActivity),
    meal: activity('living', compileRoomActivity),
    occupy_room: activity('living', compileRoomActivity),
    leave_home: activity('entry', compileLeaveHome),
    return_home: activity('entry', compileReturnHome)
  }
};

function activity(
  preferredRoomType: RoomDefinition['type'],
  compile: LifeEventDefinition['compile']
): LifeEventDefinition {
  return { preferredRoomType, compile };
}

function compileLeaveHome(input: LifeEventCompileInput): ScenarioStep[] {
  const actions: ScenarioAction[] = [];
  const following: ScenarioAction[] = [];
  const lock = input.devices.find((device) => device.type === 'door_lock');
  if (lock) {
    actions.push({
      kind: 'setDevice',
      deviceId: lock.id,
      state: { locked: false },
      reason: `habit:${input.habit.id}:departure_unlock`
    });
  }
  actions.push(...input.habit.residentIds.map((personId) => ({
    kind: 'movePerson' as const,
    personId,
    to: 'away' as const,
    activity: 'away'
  })));
  if (lock) {
    following.push({
      kind: 'setDevice',
      deviceId: lock.id,
      state: { locked: true },
      reason: `habit:${input.habit.id}:departure_lock`
    });
  }
  return pairedSteps(input.minute, actions, following);
}

function compileReturnHome(input: LifeEventCompileInput): ScenarioStep[] {
  const actions: ScenarioAction[] = [];
  const following: ScenarioAction[] = [];
  const lock = input.devices.find((device) => device.type === 'door_lock');
  if (lock) {
    actions.push({
      kind: 'setDevice',
      deviceId: lock.id,
      state: { locked: false },
      reason: `habit:${input.habit.id}:return_unlock`
    });
  }
  actions.push(...input.habit.residentIds.map((personId) => ({
    kind: 'movePerson' as const,
    personId,
    to: input.room.id,
    activity: 'returned_home'
  })));
  if (lock) {
    following.push({
      kind: 'setDevice',
      deviceId: lock.id,
      state: { locked: true },
      reason: `habit:${input.habit.id}:return_lock`
    });
  }
  return pairedSteps(input.minute, actions, following);
}

function compileRoomActivity(input: LifeEventCompileInput): ScenarioStep[] {
  const actions: ScenarioAction[] = [];
  const following: ScenarioAction[] = [];
  const residentActivity = input.habit.activity === 'sleep' ? 'sleeping' : input.habit.activity;
  actions.push(...input.habit.residentIds.map((personId) => ({
    kind: 'movePerson' as const,
    personId,
    to: input.room.id,
    activity: residentActivity
  })));
  actions.push({
    kind: 'startActivity',
    activityId: `${input.habit.repertoire}:${input.habit.activity}:${input.habit.id}`,
    participants: input.habit.residentIds,
    roomId: input.room.id,
    reason: `habit:${input.habit.id}`
  });

  if (input.habit.activity === 'sleep' || input.habit.activity === 'wake_up') {
    const sleepSensor = input.devices.find((device) => device.roomId === input.room.id && device.type === 'sleep_sensor');
    if (sleepSensor) {
      actions.push({
        kind: 'setDevice',
        deviceId: sleepSensor.id,
        state: { inBed: input.habit.activity === 'sleep' },
        reason: `habit:${input.habit.id}`
      });
    }
  }
  if (input.habit.activity === 'meal') {
    const fridge = input.devices.find((device) => device.type === 'fridge');
    if (fridge) {
      actions.push({
        kind: 'setDevice',
        deviceId: fridge.id,
        state: { doorOpen: true },
        reason: `habit:${input.habit.id}:food_prep`
      });
      following.push({
        kind: 'setDevice',
        deviceId: fridge.id,
        state: { doorOpen: false },
        reason: `habit:${input.habit.id}:food_prep_done`
      });
    }
    const stove = input.devices.find((device) => device.type === 'stove');
    if (stove) {
      actions.push({
        kind: 'setDevice',
        deviceId: stove.id,
        state: { powerW: 700, level: 4 },
        reason: `habit:${input.habit.id}:cooking`
      });
      following.push({
        kind: 'setDevice',
        deviceId: stove.id,
        state: { powerW: 0, level: 0 },
        reason: `habit:${input.habit.id}:cooking_done`
      });
      const rangeHood = input.devices.find((device) => (
        device.type === 'range_hood' && device.roomId === stove.roomId
      ));
      if (rangeHood) {
        actions.push({
          kind: 'setDevice',
          deviceId: rangeHood.id,
          state: { power: 'on', speed: 2 },
          reason: `habit:${input.habit.id}:ventilation`
        });
        following.push({
          kind: 'setDevice',
          deviceId: rangeHood.id,
          state: { power: 'off', speed: 0 },
          reason: `habit:${input.habit.id}:ventilation_done`
        });
      }
    }
  }
  if (input.habit.activity === 'remote_work') {
    const workLight = input.devices.find((device) => (
      device.type === 'light' && device.roomId === input.room.id
    ));
    if (workLight) {
      actions.push({
        kind: 'setDevice',
        deviceId: workLight.id,
        state: { power: 'on', brightness: 70 },
        reason: `habit:${input.habit.id}:work_light`
      });
      following.push({
        kind: 'setDevice',
        deviceId: workLight.id,
        state: { power: 'off', brightness: 0 },
        reason: `habit:${input.habit.id}:work_light_done`
      });
    }
    const router = input.devices.find((device) => (
      device.type === 'router' && device.roomId === input.room.id
    ));
    if (router) {
      actions.push({
        kind: 'setDevice',
        deviceId: router.id,
        state: { online: true, latencyMs: 24 },
        reason: `habit:${input.habit.id}:network_context`
      });
      following.push({
        kind: 'setDevice',
        deviceId: router.id,
        state: { online: true, latencyMs: 18 },
        reason: `habit:${input.habit.id}:network_context_done`
      });
    }
  }
  return pairedSteps(input.minute, actions, following);
}

function pairedSteps(minute: number, actions: ScenarioAction[], following: ScenarioAction[]): ScenarioStep[] {
  return [
    { minute: Math.max(1, minute), actions },
    ...(following.length > 0
      ? [{ minute: Math.min(1439, Math.max(1, minute + 1)), actions: following }]
      : [])
  ];
}
