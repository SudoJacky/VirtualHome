import type { HomeMode, RoomId } from '../../shared/types';
import { getRelationship } from './relationships';

export interface SocialPersonContext {
  location: RoomId | 'away';
  activity: string;
  available: boolean;
}

export interface SocialResourceClaim {
  personId: string;
  resourceId: string;
  priority: number;
}

export interface HouseholdSocialContext {
  currentTime: string;
  homeMode: HomeMode;
  people: Record<string, SocialPersonContext>;
  activeAlerts: Record<string, string>;
  resourceClaims: SocialResourceClaim[];
  availableResources: Record<string, number>;
  householdBacklog: {
    dirtyDishes: number;
    dirtyLaundryKg: number;
    packageCount: number;
    unfinishedChores: number;
    deviceMaintenanceScore: number;
  };
  externalSignals?: {
    visitorAtDoor?: boolean;
  };
  taskPressure: Record<string, number>;
}

export type SocialDecisionKind = 'conversation' | 'care_check' | 'resource_queue' | 'external_response';

export interface SocialDecision {
  kind: SocialDecisionKind;
  ruleId: string;
  actorIds: string[];
  reason: string;
  targetRoom?: RoomId;
  targetActivity?: string;
  conversationTopic?: string;
  resourceId?: string;
}

export function coordinateHousehold(context: HouseholdSocialContext): SocialDecision[] {
  const decisions: SocialDecision[] = [];
  const packagePickup = createPackagePickupDecision(context);
  if (packagePickup) {
    decisions.push(packagePickup);
  }
  const maintenanceVisit = createMaintenanceVisitDecision(context);
  if (maintenanceVisit) {
    decisions.push(maintenanceVisit);
  }
  const medicineRefill = createMedicineRefillDecision(context);
  if (medicineRefill) {
    decisions.push(medicineRefill);
  }
  const visitorGreeting = createVisitorGreetingDecision(context);
  if (visitorGreeting) {
    decisions.push(visitorGreeting);
  }
  const choreAssignment = createChoreAssignmentDecision(context);
  if (choreAssignment) {
    decisions.push(choreAssignment);
  }
  const mealInvitation = createMealInvitationDecision(context);
  if (mealInvitation) {
    decisions.push(mealInvitation);
  }
  const homeworkReminder = createHomeworkReminderDecision(context);
  if (homeworkReminder) {
    decisions.push(homeworkReminder);
  }
  const medicineReminder = createMedicineReminderDecision(context);
  if (medicineReminder) {
    decisions.push(medicineReminder);
  }
  const careCheck = createSeniorCareCheckDecision(context);
  if (careCheck) {
    decisions.push(careCheck);
  }
  decisions.push(...createResourceQueueDecisions(context));
  return decisions;
}

function createPackagePickupDecision(context: HouseholdSocialContext): SocialDecision | null {
  if (context.householdBacklog.packageCount <= 0) {
    return null;
  }
  const responderId = ['adult_1', 'adult_2', 'senior_1']
    .find((personId) => {
      const person = context.people[personId];
      return person?.available === true && person.location !== 'away';
    });
  if (!responderId) {
    return null;
  }
  return {
    kind: 'external_response',
    ruleId: 'package_pickup_response',
    actorIds: [responderId],
    targetRoom: 'entrance',
    targetActivity: 'collect_package',
    conversationTopic: 'package_delivery',
    reason: 'social:package_pickup_response'
  };
}

function createMaintenanceVisitDecision(context: HouseholdSocialContext): SocialDecision | null {
  if (context.householdBacklog.deviceMaintenanceScore > 4) {
    return null;
  }
  const minuteOfDay = minuteOfDayFromTime(context.currentTime);
  if (minuteOfDay < 9 * 60 || minuteOfDay > 18 * 60) {
    return null;
  }
  const responderId = ['adult_1', 'adult_2', 'senior_1']
    .find((personId) => {
      const person = context.people[personId];
      return person?.available === true && person.location !== 'away';
    });
  if (!responderId) {
    return null;
  }
  return {
    kind: 'external_response',
    ruleId: 'maintenance_visit_response',
    actorIds: [responderId],
    targetRoom: 'entrance',
    targetActivity: 'meet_maintenance_worker',
    conversationTopic: 'maintenance_visit',
    reason: 'social:maintenance_visit_response'
  };
}

function createMedicineRefillDecision(context: HouseholdSocialContext): SocialDecision | null {
  if ((context.availableResources.medicine ?? 0) > 2) {
    return null;
  }
  const minuteOfDay = minuteOfDayFromTime(context.currentTime);
  if (minuteOfDay < 9 * 60 || minuteOfDay > 19 * 60) {
    return null;
  }
  const responderId = ['adult_1', 'adult_2', 'senior_1']
    .find((personId) => {
      const person = context.people[personId];
      return person?.available === true && person.location !== 'away';
    });
  if (!responderId) {
    return null;
  }
  return {
    kind: 'external_response',
    ruleId: 'medicine_refill_response',
    actorIds: [responderId],
    targetRoom: 'entrance',
    targetActivity: 'refill_medicine',
    conversationTopic: 'medicine_refill',
    reason: 'social:medicine_refill_response'
  };
}

function createVisitorGreetingDecision(context: HouseholdSocialContext): SocialDecision | null {
  if (context.externalSignals?.visitorAtDoor !== true || context.householdBacklog.packageCount > 0) {
    return null;
  }
  const minuteOfDay = minuteOfDayFromTime(context.currentTime);
  if (minuteOfDay < 8 * 60 || minuteOfDay > 21 * 60 + 30) {
    return null;
  }
  const responderId = ['adult_1', 'adult_2', 'senior_1']
    .find((personId) => {
      const person = context.people[personId];
      return person?.available === true && person.location !== 'away';
    });
  if (!responderId) {
    return null;
  }
  return {
    kind: 'external_response',
    ruleId: 'visitor_greeting_response',
    actorIds: [responderId],
    targetRoom: 'entrance',
    targetActivity: 'greet_visitor',
    conversationTopic: 'visitor_arrival',
    reason: 'social:visitor_greeting_response'
  };
}

function createChoreAssignmentDecision(context: HouseholdSocialContext): SocialDecision | null {
  if (context.householdBacklog.dirtyDishes < 4 || context.householdBacklog.unfinishedChores <= 0) {
    return null;
  }
  const assignerId = ['adult_1', 'adult_2']
    .find((personId) => {
      const person = context.people[personId];
      return person?.available === true && person.location !== 'away';
    });
  if (!assignerId) {
    return null;
  }
  const assigneeId = ['child_1', 'adult_2', 'adult_1']
    .filter((personId) => personId !== assignerId)
    .find((personId) => {
      const person = context.people[personId];
      return person?.available === true &&
        person.location !== 'away' &&
        !person.activity.startsWith('waiting_for_') &&
        !isProtectedHomeworkTime(context, personId);
    });
  if (!assigneeId) {
    return null;
  }
  return {
    kind: 'conversation',
    ruleId: 'household_chore_assignment',
    actorIds: [assignerId, assigneeId],
    targetRoom: 'kitchen',
    targetActivity: 'unload_dishwasher',
    conversationTopic: 'chore_assignment',
    reason: 'social:household_chore_assignment'
  };
}

function isProtectedHomeworkTime(context: HouseholdSocialContext, personId: string): boolean {
  if (personId !== 'child_1') {
    return false;
  }
  return (context.taskPressure.child_1 ?? 0) >= 70 ||
    ['watching_tv', 'playing', 'weekend_play', 'homework'].includes(context.people.child_1?.activity ?? '');
}

function createMealInvitationDecision(context: HouseholdSocialContext): SocialDecision | null {
  const minuteOfDay = minuteOfDayFromTime(context.currentTime);
  if (minuteOfDay < 18 * 60 + 40 || minuteOfDay > 20 * 60) {
    return null;
  }
  const cookId = ['adult_2', 'adult_1']
    .find((personId) => {
      const person = context.people[personId];
      return person?.location === 'kitchen' && ['cooking_dinner', 'prepare_dinner'].includes(person.activity);
    });
  if (!cookId) {
    return null;
  }

  const invitees = ['adult_1', 'adult_2', 'child_1', 'senior_1']
    .filter((personId) => personId !== cookId)
    .filter((personId) => {
      const person = context.people[personId];
      return person?.available === true && person.location !== 'away' && person.activity !== 'dinner';
    });
  if (invitees.length === 0) {
    return null;
  }

  return {
    kind: 'conversation',
    ruleId: 'family_meal_invitation',
    actorIds: [cookId, ...invitees],
    targetRoom: 'dining_room',
    targetActivity: 'dinner',
    conversationTopic: 'family_dinner_invitation',
    reason: 'social:family_meal_invitation'
  };
}

function createHomeworkReminderDecision(context: HouseholdSocialContext): SocialDecision | null {
  const child = context.people.child_1;
  if (
    !child ||
    child.location === 'away' ||
    !['watching_tv', 'playing', 'weekend_play'].includes(child.activity) ||
    (context.taskPressure.child_1 ?? 0) < 70
  ) {
    return null;
  }

  const parentId = selectAvailableParent(context);
  if (!parentId) {
    return null;
  }

  return {
    kind: 'conversation',
    ruleId: 'parent_homework_reminder',
    actorIds: [parentId, 'child_1'],
    targetRoom: 'child_bedroom',
    targetActivity: 'homework',
    conversationTopic: 'homework_reminder',
    reason: 'social:parent_homework_reminder'
  };
}

function createMedicineReminderDecision(context: HouseholdSocialContext): SocialDecision | null {
  const minuteOfDay = minuteOfDayFromTime(context.currentTime);
  const senior = context.people.senior_1;
  if (
    minuteOfDay < 8 * 60 ||
    minuteOfDay > 10 * 60 ||
    !senior ||
    senior.location === 'away' ||
    senior.activity === 'take_medicine' ||
    (context.availableResources.medicine ?? 0) <= 0
  ) {
    return null;
  }

  const caregiverId = selectSeniorCaregiver(context);
  if (!caregiverId) {
    return null;
  }

  return {
    kind: 'conversation',
    ruleId: 'senior_medicine_reminder',
    actorIds: [caregiverId, 'senior_1'],
    targetRoom: 'master_bedroom',
    targetActivity: 'take_medicine',
    conversationTopic: 'medicine_reminder',
    reason: 'social:senior_medicine_reminder'
  };
}

function createSeniorCareCheckDecision(context: HouseholdSocialContext): SocialDecision | null {
  const alertRule = context.activeAlerts.senior_no_activity_001 ?? context.activeAlerts.senior_inactive_001;
  if (alertRule !== 'senior_no_activity') {
    return null;
  }

  const caregiverId = selectSeniorCaregiver(context);
  if (!caregiverId) {
    return null;
  }

  return {
    kind: 'care_check',
    ruleId: 'senior_family_check_in',
    actorIds: [caregiverId, 'senior_1'],
    targetRoom: 'master_bedroom',
    targetActivity: 'checking_senior_1',
    conversationTopic: 'senior_check_in',
    reason: 'social:senior_family_check_in'
  };
}

function selectSeniorCaregiver(context: HouseholdSocialContext): string | null {
  return ['adult_1', 'adult_2']
    .filter((personId) => context.people[personId]?.available && context.people[personId]?.location !== 'away')
    .sort((left, right) => (
      (getRelationship(right, 'senior_1')?.careDuty ?? 0) - (getRelationship(left, 'senior_1')?.careDuty ?? 0) ||
      left.localeCompare(right)
    ))[0] ?? null;
}

function minuteOfDayFromTime(time: string): number {
  const match = time.match(/T(\d{2}):(\d{2}):/);
  if (!match) {
    return 12 * 60;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function createResourceQueueDecisions(context: HouseholdSocialContext): SocialDecision[] {
  const claimsByResource = new Map<string, SocialResourceClaim[]>();
  for (const claim of context.resourceClaims) {
    const claims = claimsByResource.get(claim.resourceId) ?? [];
    claims.push(claim);
    claimsByResource.set(claim.resourceId, claims);
  }

  const decisions: SocialDecision[] = [];
  for (const [resourceId, claims] of claimsByResource) {
    if (claims.length < 2) {
      continue;
    }
    const ordered = [...claims].sort((left, right) => right.priority - left.priority || left.personId.localeCompare(right.personId));
    decisions.push({
      kind: 'resource_queue',
      ruleId: 'shared_resource_contention',
      actorIds: ordered.map((claim) => claim.personId),
      resourceId,
      targetActivity: `waiting_for_${resourceId}`,
      reason: `social:resource_contention:${resourceId}`
    });
  }
  return decisions;
}

function selectAvailableParent(context: HouseholdSocialContext): string | null {
  return ['adult_1', 'adult_2']
    .filter((personId) => {
      const person = context.people[personId];
      return person?.available === true && person.location !== 'away' && (getRelationship(personId, 'child_1')?.authority ?? 0) > 0.5;
    })
    .sort((left, right) => (
      (getRelationship(right, 'child_1')?.authority ?? 0) - (getRelationship(left, 'child_1')?.authority ?? 0) ||
      left.localeCompare(right)
    ))[0] ?? null;
}
