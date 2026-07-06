import type { RoomId } from '../../shared/types';
import type { ScenarioAction, ScenarioStep } from '../scenarios';

export type ActivityDeviceEffectPhase = 'pause' | 'resume' | 'wind_down';

export interface ActivityDeviceEffectInput {
  activityId: string;
  phase: ActivityDeviceEffectPhase;
  baseMinute: number;
  roomId?: RoomId;
}

export function createActivityDeviceEffectSteps(input: ActivityDeviceEffectInput): ScenarioStep[] {
  if (input.activityId === 'remote_work_session' && input.phase === 'pause') {
    return [
      step(input.baseMinute, [
        device('study_light_01', { power: 'off', brightness: 0 }, 'routine:remote_work_lunch_break'),
        device('fridge_01', { doorOpen: true, powerW: 128 }, 'routine:remote_work_lunch_break')
      ]),
      step(input.baseMinute + 3, [
        device('fridge_01', { doorOpen: false, powerW: 92 }, 'routine:remote_work_lunch_done')
      ])
    ];
  }

  if (input.activityId === 'remote_work_session' && input.phase === 'resume') {
    return [
      step(input.baseMinute, [
        device('study_light_01', { power: 'on', brightness: 58 }, 'routine:remote_work_afternoon'),
        device('study_co2_01', { co2: 650 }, 'routine:remote_work_afternoon')
      ])
    ];
  }

  if (input.activityId === 'sleep' && input.phase === 'wind_down' && input.roomId === 'child_bedroom') {
    return [
      step(input.baseMinute, [
        device('child_light_01', { power: 'on', brightness: 34 }, 'routine:child_bedtime_wind_down')
      ]),
      step(input.baseMinute + 12, [
        device('child_light_01', { power: 'off', brightness: 0 }, 'routine:child_bedtime_light_off')
      ])
    ];
  }

  return [];
}

function step(minute: number, actions: ScenarioAction[]): ScenarioStep {
  return { minute: clampMinute(minute), actions };
}

function device(deviceId: string, state: Record<string, string | number | boolean | null>, reason: string): ScenarioAction {
  return { kind: 'setDevice', deviceId, state, reason };
}

function clampMinute(minute: number): number {
  return Math.max(1, Math.min(1439, minute));
}
