import { describe, expect, it } from 'vitest';
import { createConversationDraft } from '../src/sim/social/conversationEvents';
import { coordinateHousehold } from '../src/sim/social/householdCoordinator';
import { getRelationship, getRelationshipNetwork } from '../src/sim/social/relationships';
import type { HouseholdSocialContext } from '../src/sim/social/householdCoordinator';

function baseSocialContext(): HouseholdSocialContext {
  return {
    currentTime: '2026-06-17T17:30:00+08:00',
    homeMode: 'evening_home',
    people: {
      adult_1: { location: 'living_room', activity: 'reading', available: true },
      adult_2: { location: 'study', activity: 'remote_work', available: false },
      child_1: { location: 'living_room', activity: 'watching_tv', available: true },
      senior_1: { location: 'garden', activity: 'gardening', available: true },
      pet_1: { location: 'living_room', activity: 'resting', available: true }
    },
    activeAlerts: {},
    resourceClaims: [],
    availableResources: {
      medicine: 1,
      prepared_meal: 1
    },
    householdBacklog: {
      dirtyDishes: 2,
      dirtyLaundryKg: 1.2,
      packageCount: 0,
      unfinishedChores: 1,
      deviceMaintenanceScore: 8
    },
    taskPressure: {
      child_1: 86
    }
  };
}

describe('household social behavior model', () => {
  it('models typed relationships between people and pets', () => {
    expect(getRelationship('adult_1', 'child_1')).toMatchObject({
      kind: 'parent_child',
      authority: 0.9,
      careDuty: 0.85
    });
    expect(getRelationship('adult_1', 'senior_1')).toMatchObject({
      kind: 'adult_senior',
      careDuty: 0.75
    });
    expect(getRelationshipNetwork().some((relationship) => relationship.toId === 'pet_1')).toBe(true);
  });

  it('creates private truth conversations with lineage for family interactions', () => {
    const draft = createConversationDraft({
      conversationId: 'homework-reminder-001',
      currentTime: '2026-06-17T17:30:00+08:00',
      speakerId: 'adult_1',
      listenerIds: ['child_1'],
      topic: 'homework_reminder',
      intent: 'finish_homework',
      roomId: 'living_room',
      summary: 'Adult 1 reminds Child 1 to stop TV and start homework.'
    });

    expect(draft).toMatchObject({
      type: 'ConversationOccurred',
      conversationId: 'homework-reminder-001',
      speakerId: 'adult_1',
      listenerIds: ['child_1'],
      topic: 'homework_reminder',
      sourceLayer: 'truth',
      lineage: {
        eventTime: '2026-06-17T17:30:00+08:00',
        sourceLayer: 'truth',
        observability: 'private',
        episodeId: 'conversation:homework-reminder-001'
      }
    });
  });

  it('coordinates homework reminders, senior check-ins, and shared resource contention', () => {
    const context = baseSocialContext();
    context.activeAlerts.senior_no_activity_001 = 'senior_no_activity';
    context.resourceClaims = [
      { personId: 'adult_2', resourceId: 'quiet_study', priority: 80 },
      { personId: 'child_1', resourceId: 'quiet_study', priority: 62 },
      { personId: 'adult_1', resourceId: 'bathroom_sink', priority: 74 },
      { personId: 'child_1', resourceId: 'bathroom_sink', priority: 55 }
    ];

    const decisions = coordinateHousehold(context);

    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'conversation',
        ruleId: 'parent_homework_reminder',
        actorIds: ['adult_1', 'child_1'],
        targetRoom: 'living_room',
        targetActivity: 'homework',
        conversationTopic: 'homework_reminder'
      }),
      expect.objectContaining({
        kind: 'care_check',
        ruleId: 'senior_family_check_in',
        actorIds: ['adult_1', 'senior_1'],
        targetRoom: 'master_bedroom'
      }),
      expect.objectContaining({
        kind: 'resource_queue',
        ruleId: 'shared_resource_contention',
        actorIds: ['adult_2', 'child_1'],
        resourceId: 'quiet_study',
        targetActivity: 'waiting_for_quiet_study'
      }),
      expect.objectContaining({
        kind: 'resource_queue',
        ruleId: 'shared_resource_contention',
        actorIds: ['adult_1', 'child_1'],
        resourceId: 'bathroom_sink',
        targetActivity: 'waiting_for_bathroom_sink'
      })
    ]));
  });

  it('coordinates shared dinner invitations and medicine reminders', () => {
    const context = baseSocialContext();
    context.currentTime = '2026-06-17T18:45:00+08:00';
    context.people.adult_2 = { location: 'kitchen', activity: 'cooking_dinner', available: true };
    context.people.child_1 = { location: 'child_bedroom', activity: 'homework', available: true };
    context.people.senior_1 = { location: 'living_room', activity: 'idle', available: true };

    const dinnerDecisions = coordinateHousehold(context);

    expect(dinnerDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'conversation',
        ruleId: 'family_meal_invitation',
        actorIds: ['adult_2', 'adult_1', 'child_1', 'senior_1'],
        targetRoom: 'dining_room',
        targetActivity: 'dinner',
        conversationTopic: 'family_dinner_invitation'
      })
    ]));

    context.currentTime = '2026-06-17T08:30:00+08:00';
    context.people.adult_1 = { location: 'kitchen', activity: 'breakfast', available: true };
    context.people.adult_2 = { location: 'study', activity: 'remote_work', available: false };
    context.people.senior_1 = { location: 'living_room', activity: 'idle', available: true };

    const morningDecisions = coordinateHousehold(context);

    expect(morningDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'conversation',
        ruleId: 'senior_medicine_reminder',
        actorIds: ['adult_1', 'senior_1'],
        targetRoom: 'master_bedroom',
        targetActivity: 'take_medicine',
        conversationTopic: 'medicine_reminder'
      })
    ]));
  });

  it('coordinates package pickup and household chore assignment from backlog state', () => {
    const context = baseSocialContext();
    context.currentTime = '2026-06-17T15:30:00+08:00';
    context.people.adult_1 = { location: 'living_room', activity: 'idle', available: true };
    context.people.child_1 = { location: 'living_room', activity: 'idle', available: true };
    context.householdBacklog = {
      dirtyDishes: 7,
      dirtyLaundryKg: 1.5,
      packageCount: 1,
      unfinishedChores: 3,
      deviceMaintenanceScore: 8
    };
    context.taskPressure.child_1 = 30;

    const decisions = coordinateHousehold(context);

    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'external_response',
        ruleId: 'package_pickup_response',
        actorIds: ['adult_1'],
        targetRoom: 'entrance',
        targetActivity: 'collect_package',
        conversationTopic: 'package_delivery'
      }),
      expect.objectContaining({
        kind: 'conversation',
        ruleId: 'household_chore_assignment',
        actorIds: ['adult_1', 'child_1'],
        targetRoom: 'kitchen',
        targetActivity: 'unload_dishwasher',
        conversationTopic: 'chore_assignment'
      })
    ]));
  });

  it('coordinates a maintenance worker visit when device maintenance is degraded', () => {
    const context = baseSocialContext();
    context.currentTime = '2026-06-17T14:20:00+08:00';
    context.people.adult_1 = { location: 'living_room', activity: 'idle', available: true };
    context.people.adult_2 = { location: 'away', activity: 'commute', available: false };
    context.householdBacklog = {
      dirtyDishes: 1,
      dirtyLaundryKg: 0.8,
      packageCount: 0,
      unfinishedChores: 1,
      deviceMaintenanceScore: 3
    };

    const decisions = coordinateHousehold(context);

    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'external_response',
        ruleId: 'maintenance_visit_response',
        actorIds: ['adult_1'],
        targetRoom: 'entrance',
        targetActivity: 'meet_maintenance_worker',
        conversationTopic: 'maintenance_visit'
      })
    ]));
  });

  it('coordinates medicine refills when household medicine stock is low', () => {
    const context = baseSocialContext();
    context.currentTime = '2026-06-17T15:10:00+08:00';
    context.people.adult_1 = { location: 'living_room', activity: 'idle', available: true };
    context.people.adult_2 = { location: 'away', activity: 'commute', available: false };
    context.availableResources.medicine = 1;

    const decisions = coordinateHousehold(context);

    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'external_response',
        ruleId: 'medicine_refill_response',
        actorIds: ['adult_1'],
        targetRoom: 'entrance',
        targetActivity: 'refill_medicine',
        conversationTopic: 'medicine_refill'
      })
    ]));
  });

  it('coordinates caregiver lighting support when the senior needs room light', () => {
    const context = baseSocialContext();
    context.currentTime = '2026-06-17T19:20:00+08:00';
    context.people.adult_1 = { location: 'kitchen', activity: 'cleaning', available: true };
    context.people.adult_2 = { location: 'away', activity: 'commute', available: false };
    context.people.senior_1 = { location: 'living_room', activity: 'reading', available: true };
    context.externalSignals = {
      seniorNeedsLight: true
    };

    const decisions = coordinateHousehold(context);

    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'care_check',
        ruleId: 'senior_light_support',
        actorIds: ['adult_1', 'senior_1'],
        targetRoom: 'living_room',
        targetActivity: 'support_senior_lighting',
        conversationTopic: 'senior_light_support'
      })
    ]));
  });

  it('coordinates a caregiver fetching the family phone for the senior', () => {
    const context = baseSocialContext();
    context.currentTime = '2026-06-17T16:20:00+08:00';
    context.people.adult_1 = { location: 'kitchen', activity: 'cleaning', available: true };
    context.people.adult_2 = { location: 'away', activity: 'commute', available: false };
    context.people.senior_1 = { location: 'garden', activity: 'needs_phone', available: true };
    context.externalSignals = {
      seniorNeedsPhone: true
    };

    const decisions = coordinateHousehold(context);

    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'care_check',
        ruleId: 'senior_phone_fetch',
        actorIds: ['adult_1', 'senior_1'],
        targetRoom: 'garden',
        targetActivity: 'bring_family_phone',
        conversationTopic: 'senior_phone_fetch'
      })
    ]));
  });

  it('coordinates a visitor greeting when the doorbell rings without a package', () => {
    const context = baseSocialContext();
    context.currentTime = '2026-06-17T19:10:00+08:00';
    context.people.adult_1 = { location: 'living_room', activity: 'reading', available: true };
    context.people.adult_2 = { location: 'away', activity: 'commute', available: false };
    context.householdBacklog.packageCount = 0;
    context.externalSignals = {
      visitorAtDoor: true
    };

    const decisions = coordinateHousehold(context);

    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'external_response',
        ruleId: 'visitor_greeting_response',
        actorIds: ['adult_1'],
        targetRoom: 'entrance',
        targetActivity: 'greet_visitor',
        conversationTopic: 'visitor_arrival'
      })
    ]));
  });

  it('does not assign chores to the child when homework pressure is high', () => {
    const context = baseSocialContext();
    context.currentTime = '2026-06-17T17:30:00+08:00';
    context.people.adult_1 = { location: 'living_room', activity: 'reading', available: true };
    context.people.adult_2 = { location: 'study', activity: 'idle', available: true };
    context.people.child_1 = { location: 'living_room', activity: 'watching_tv', available: true };
    context.householdBacklog = {
      dirtyDishes: 7,
      dirtyLaundryKg: 1.5,
      packageCount: 0,
      unfinishedChores: 3,
      deviceMaintenanceScore: 8
    };
    context.taskPressure.child_1 = 86;

    const decisions = coordinateHousehold(context);
    const chore = decisions.find((decision) => decision.ruleId === 'household_chore_assignment');

    expect(chore?.actorIds).toEqual(['adult_1', 'adult_2']);
    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: 'parent_homework_reminder',
        actorIds: ['adult_1', 'child_1']
      })
    ]));
  });
});
