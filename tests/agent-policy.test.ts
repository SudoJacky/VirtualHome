import { describe, expect, it } from 'vitest';
import { selectActivity } from '../src/sim/agents/agentPolicy';
import { getPersona } from '../src/sim/personas/defaultFamily';
import type { NeedState } from '../src/sim/agents/needs';

const baselineNeeds: NeedState = {
  sleepiness: 20,
  sleepDebt: 10,
  hunger: 20,
  thirst: 20,
  hygiene: 20,
  bathroomNeed: 20,
  fatigue: 20,
  stress: 20,
  mood: 70,
  socialNeed: 30,
  comfort: 70,
  healthConcern: 10,
  taskPressure: 20
};

describe('agent policy', () => {
  it('selects persona-specific activities from needs and time context', () => {
    const remoteWorker = selectActivity({
      personId: 'adult_2',
      persona: getPersona('adult_2'),
      needs: { ...baselineNeeds, taskPressure: 78 },
      currentActivity: 'idle',
      currentRoom: 'kitchen',
      homeMode: 'morning',
      minuteOfDay: 9 * 60,
      availableResources: { breakfast_food: 2, study_desk: 1 }
    });
    const child = selectActivity({
      personId: 'child_1',
      persona: getPersona('child_1'),
      needs: { ...baselineNeeds, taskPressure: 82 },
      currentActivity: 'idle',
      currentRoom: 'living_room',
      homeMode: 'evening_home',
      minuteOfDay: 17 * 60,
      availableResources: { homework_materials: 1 }
    });

    expect(remoteWorker.activityId).toBe('remote_work_session');
    expect(remoteWorker.targetRoom).toBe('study');
    expect(child.activityId).toBe('study_homework');
    expect(child.targetRoom).toBe('child_bedroom');
  });

  it('falls back when a preferred activity lacks required resources', () => {
    const decision = selectActivity({
      personId: 'adult_1',
      persona: getPersona('adult_1'),
      needs: { ...baselineNeeds, hunger: 86 },
      currentActivity: 'idle',
      currentRoom: 'living_room',
      homeMode: 'morning',
      minuteOfDay: 7 * 60,
      availableResources: { breakfast_food: 0 }
    });

    expect(decision.activityId).toBe('eat_simple_food');
    expect(decision.reason).toContain('fallback');
  });

  it('uses scheduled commitment pressure when ranking candidate activities', () => {
    const decision = selectActivity({
      personId: 'senior_1',
      persona: getPersona('senior_1'),
      needs: { ...baselineNeeds, mood: 45, taskPressure: 25 },
      currentActivity: 'idle',
      currentRoom: 'living_room',
      homeMode: 'morning',
      minuteOfDay: 9 * 60,
      availableResources: { garden_access: 1 },
      commitmentPressureByActivity: {
        gardening: 90
      }
    });

    expect(decision.activityId).toBe('gardening');
    expect(decision.reason).toContain('commitment');
  });
});
