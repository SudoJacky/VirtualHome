import type { RoomId } from '../../shared/types';
import { createActivityDeviceEffectSteps } from '../agents/activityDeviceEffects';
import type { ScenarioAction, ScenarioStep } from '../scenarios';

export interface WeekdayResidentRoutineAnchorOptions {
  remoteWorkStartMinute: number;
  childSleepMinute: number;
}

export function createWeekdayResidentRoutineAnchorSteps(options: WeekdayResidentRoutineAnchorOptions): ScenarioStep[] {
  const lunchMinute = options.remoteWorkStartMinute + 180;
  const returnMinute = lunchMinute + 35;
  const childWindDownMinute = options.childSleepMinute - 18;

  return [
    step(lunchMinute, [
      move('adult_2', 'kitchen', 'lunch_break')
    ]),
    ...createActivityDeviceEffectSteps({
      activityId: 'remote_work_session',
      phase: 'pause',
      baseMinute: lunchMinute
    }),
    step(returnMinute, [
      move('adult_2', 'study', 'remote_work_afternoon')
    ]),
    ...createActivityDeviceEffectSteps({
      activityId: 'remote_work_session',
      phase: 'resume',
      baseMinute: returnMinute
    }),
    step(childWindDownMinute, [
      move('child_1', 'child_bedroom', 'bedtime_wind_down')
    ]),
    ...createActivityDeviceEffectSteps({
      activityId: 'sleep',
      phase: 'wind_down',
      baseMinute: childWindDownMinute,
      roomId: 'child_bedroom'
    })
  ];
}

function step(minute: number, actions: ScenarioAction[]): ScenarioStep {
  return { minute: clampMinute(minute), actions };
}

function move(personId: string, to: RoomId | 'away', activity: string): ScenarioAction {
  return { kind: 'movePerson', personId, to, activity };
}

function clampMinute(minute: number): number {
  return Math.max(1, Math.min(1439, minute));
}
