import { describe, expect, it } from 'vitest';
import { selectActivity } from '../src/sim/agents/agentPolicy';
import { getPersona } from '../src/sim/personas/defaultFamily';
import type { NeedState } from '../src/sim/agents/needs';
import { createInitialInventory, resourcesFromInventory } from '../src/sim/world/inventory';

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
      availableResources: { breakfast_food: 0, simple_food: 1 }
    });

    expect(decision.activityId).toBe('eat_simple_food');
    expect(decision.reason).toContain('fallback');
  });

  it('uses takeout when cooking ingredients and simple food are unavailable', () => {
    const decision = selectActivity({
      personId: 'adult_1',
      persona: getPersona('adult_1'),
      needs: { ...baselineNeeds, hunger: 92 },
      currentActivity: 'idle',
      currentRoom: 'living_room',
      homeMode: 'morning',
      minuteOfDay: 7 * 60,
      availableResources: {
        breakfast_food: 0,
        simple_food: 0,
        door_access: 1
      }
    });

    expect(decision.activityId).toBe('order_takeout');
    expect(decision.reason).toContain('fallback');
    expect(decision.reason).toContain('simple_food');
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

  it('raises laundry priority when dirty laundry accumulates', () => {
    const lowLaundryDecision = selectActivity({
      personId: 'adult_1',
      persona: getPersona('adult_1'),
      needs: { ...baselineNeeds, taskPressure: 72, stress: 24 },
      currentActivity: 'idle',
      currentRoom: 'bathroom',
      homeMode: 'evening_home',
      minuteOfDay: 19 * 60,
      availableResources: resourcesFromInventory(createInitialInventory({
        dirtyLaundryKg: 0.8,
        dirtyDishes: 0
      }))
    });
    const highLaundryDecision = selectActivity({
      personId: 'adult_1',
      persona: getPersona('adult_1'),
      needs: { ...baselineNeeds, taskPressure: 72, stress: 24 },
      currentActivity: 'idle',
      currentRoom: 'bathroom',
      homeMode: 'evening_home',
      minuteOfDay: 19 * 60,
      availableResources: resourcesFromInventory(createInitialInventory({
        dirtyLaundryKg: 7.2,
        dirtyDishes: 0
      }))
    });

    expect(lowLaundryDecision.activityId).not.toBe('laundry_cycle');
    expect(highLaundryDecision.activityId).toBe('laundry_cycle');
    expect(highLaundryDecision.score).toBeGreaterThan(lowLaundryDecision.score);
  });

  it('raises trash priority when garbage accumulates across days', () => {
    const lowTrashDecision = selectActivity({
      personId: 'adult_1',
      persona: getPersona('adult_1'),
      needs: { ...baselineNeeds, taskPressure: 62, stress: 18 },
      currentActivity: 'idle',
      currentRoom: 'living_room',
      homeMode: 'evening_home',
      minuteOfDay: 19 * 60,
      availableResources: resourcesFromInventory(createInitialInventory({
        dirtyLaundryKg: 0.4,
        dirtyDishes: 0,
        trashBags: 0.2
      }))
    });
    const highTrashDecision = selectActivity({
      personId: 'adult_1',
      persona: getPersona('adult_1'),
      needs: { ...baselineNeeds, taskPressure: 62, stress: 18 },
      currentActivity: 'idle',
      currentRoom: 'living_room',
      homeMode: 'evening_home',
      minuteOfDay: 19 * 60,
      availableResources: resourcesFromInventory(createInitialInventory({
        dirtyLaundryKg: 0.4,
        dirtyDishes: 0,
        trashBags: 2.1
      }))
    });

    expect(lowTrashDecision.activityId).not.toBe('take_out_trash');
    expect(highTrashDecision.activityId).toBe('take_out_trash');
    expect(highTrashDecision.score).toBeGreaterThan(lowTrashDecision.score);
  });

  it('raises cooking priority for personas with stronger meal regularity', () => {
    const lowMealRegularity = {
      ...getPersona('adult_1'),
      mealRegularity: 0.18
    };
    const highMealRegularity = {
      ...getPersona('adult_1'),
      mealRegularity: 0.94
    };
    const sharedInput = {
      personId: 'adult_1',
      needs: { ...baselineNeeds, hunger: 68, taskPressure: 8, stress: 10 },
      currentActivity: 'idle',
      currentRoom: 'kitchen' as const,
      homeMode: 'morning' as const,
      minuteOfDay: 7 * 60,
      availableResources: {
        breakfast_food: 1,
        simple_food: 1,
        prepared_meal: 0,
        door_access: 1
      }
    };

    const lowDecision = selectActivity({
      ...sharedInput,
      persona: lowMealRegularity
    });
    const highDecision = selectActivity({
      ...sharedInput,
      persona: highMealRegularity
    });

    expect(highDecision.activityId).toBe('prepare_breakfast');
    expect(highDecision.score).toBeGreaterThan(lowDecision.score);
  });
});
