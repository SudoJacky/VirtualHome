import { describe, expect, it } from 'vitest';
import { createActivityDeviceEffectSteps } from '../src/sim/agents/activityDeviceEffects';

describe('activity device effects', () => {
  it('maps a remote work lunch pause into study and kitchen device evidence', () => {
    const steps = createActivityDeviceEffectSteps({
      activityId: 'remote_work_session',
      phase: 'pause',
      baseMinute: 720
    });

    expect(steps).toEqual([
      {
        minute: 720,
        actions: [
          {
            kind: 'setDevice',
            deviceId: 'study_light_01',
            state: { power: 'off', brightness: 0 },
            reason: 'routine:remote_work_lunch_break'
          },
          {
            kind: 'setDevice',
            deviceId: 'fridge_01',
            state: { doorOpen: true, powerW: 128 },
            reason: 'routine:remote_work_lunch_break'
          }
        ]
      },
      {
        minute: 723,
        actions: [
          {
            kind: 'setDevice',
            deviceId: 'fridge_01',
            state: { doorOpen: false, powerW: 92 },
            reason: 'routine:remote_work_lunch_done'
          }
        ]
      }
    ]);
  });

  it('maps child sleep wind-down into child bedroom light evidence', () => {
    const steps = createActivityDeviceEffectSteps({
      activityId: 'sleep',
      phase: 'wind_down',
      baseMinute: 1242,
      roomId: 'child_bedroom'
    });

    expect(steps).toEqual([
      {
        minute: 1242,
        actions: [
          {
            kind: 'setDevice',
            deviceId: 'child_light_01',
            state: { power: 'on', brightness: 34 },
            reason: 'routine:child_bedtime_wind_down'
          }
        ]
      },
      {
        minute: 1254,
        actions: [
          {
            kind: 'setDevice',
            deviceId: 'child_light_01',
            state: { power: 'off', brightness: 0 },
            reason: 'routine:child_bedtime_light_off'
          }
        ]
      }
    ]);
  });

  it('maps a remote work resume into study device evidence', () => {
    const steps = createActivityDeviceEffectSteps({
      activityId: 'remote_work_session',
      phase: 'resume',
      baseMinute: 755
    });

    expect(steps).toEqual([
      {
        minute: 755,
        actions: [
          {
            kind: 'setDevice',
            deviceId: 'study_light_01',
            state: { power: 'on', brightness: 58 },
            reason: 'routine:remote_work_afternoon'
          },
          {
            kind: 'setDevice',
            deviceId: 'study_co2_01',
            state: { co2: 650 },
            reason: 'routine:remote_work_afternoon'
          }
        ]
      }
    ]);
  });
});
