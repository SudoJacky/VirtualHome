import type { HomeMode, RoomId } from '../../shared/types';
import { getActivityTemplate, listActivityTemplates, type ActivityTemplate } from './activityCatalog';
import type { NeedState } from './needs';
import type { PersonaProfile } from './persona';

export interface ActivityDecisionInput {
  personId: string;
  persona: PersonaProfile;
  needs: NeedState;
  currentActivity: string;
  currentRoom: RoomId | 'away';
  homeMode: HomeMode;
  minuteOfDay: number;
  availableResources: Record<string, number>;
  commitmentPressureByActivity?: Record<string, number>;
  familyRequestByActivity?: Record<string, number>;
  resourceConflictByResource?: Record<string, number>;
}

export interface ActivityDecision {
  personId: string;
  activityId: string;
  targetRoom: RoomId;
  score: number;
  reason: string;
}

export function selectActivity(input: ActivityDecisionInput): ActivityDecision {
  if (input.currentActivity === 'sleeping' && input.minuteOfDay >= 8 * 60 && input.minuteOfDay <= 12 * 60 && input.homeMode !== 'sleeping') {
    const wakeUp = getActivityTemplate('wake_up');
    return {
      personId: input.personId,
      activityId: wakeUp.id,
      targetRoom: wakeUp.targetRoom,
      score: 100,
      reason: 'daytime wake constraint'
    };
  }
  const ranked = listActivityTemplates()
    .map((template) => decisionForTemplate(input, template))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best) {
    return fallbackDecision(input, 'idle', 'living_room', 0, 'no candidate activity');
  }
  const template = getActivityTemplate(best.activityId);
  const missingResource = firstMissingResource(template, input.availableResources);
  if (missingResource && template.fallbackActivityIds?.length) {
    return fallbackDecisionForMissingResource(input, template, best.score, missingResource);
  }
  return best;
}

function decisionForTemplate(input: ActivityDecisionInput, template: ActivityTemplate): ActivityDecision {
  const goalPriority = scoreGoalPriority(input, template);
  const needRelief = scoreNeedRelief(input.needs, template);
  const habitPreference = scoreHabit(input.persona, template, input.minuteOfDay);
  const commitmentPressure = input.commitmentPressureByActivity?.[template.id] ?? 0;
  const familyRequest = input.familyRequestByActivity?.[template.id] ?? 0;
  const environmentFit = input.homeMode === 'sleeping' && template.id !== 'sleep' ? -40 : 0;
  const missingResource = firstMissingResource(template, input.availableResources);
  const resourceAvailability = missingResource ? template.fallbackActivityIds?.length ? -10 : -100 : 8;
  const resourceUrgency = scoreResourceUrgency(input, template);
  const movementCost = input.currentRoom === 'away' || input.currentRoom === template.targetRoom ? 0 : -6;
  const interruptionCost = input.currentActivity === 'sleeping' && template.id !== 'wake_up' && input.minuteOfDay < 8 * 60 ? -22 : 0;
  const conflictCost = scoreConflictCost(input, template);
  const boundedRandomness = deterministicJitter(`${input.personId}:${template.id}:${Math.floor(input.minuteOfDay / 30)}`);
  const score = goalPriority + needRelief + habitPreference + commitmentPressure * 0.5 + familyRequest * 0.45 + environmentFit + resourceAvailability + resourceUrgency + movementCost + interruptionCost + conflictCost + boundedRandomness;
  const reasonParts = [
    commitmentPressure > 0 ? `commitment:${Math.round(commitmentPressure)}` : '',
    familyRequest > 0 ? `family:${Math.round(familyRequest)}` : '',
    conflictCost < 0 ? `conflict:${Math.round(conflictCost * 10) / 10}` : '',
    `score:${Math.round(score * 10) / 10}`
  ].filter(Boolean);
  return {
    personId: input.personId,
    activityId: template.id,
    targetRoom: template.targetRoom,
    score: Math.round(score * 10) / 10,
    reason: reasonParts.join(' ')
  };
}

function scoreGoalPriority(input: ActivityDecisionInput, template: ActivityTemplate): number {
  if (input.currentActivity === 'sleeping' && input.minuteOfDay >= 7 * 60 && template.id === 'wake_up') return 70;
  if (input.persona.role === 'remote_worker' && template.id === 'remote_work_session' && input.minuteOfDay >= 8 * 60 && input.minuteOfDay <= 17 * 60) return 52;
  if (input.persona.role === 'student' && template.id === 'study_homework' && input.minuteOfDay >= 16 * 60) return 52;
  if (input.persona.role === 'senior' && template.id === 'take_medicine' && input.minuteOfDay >= 8 * 60 && input.minuteOfDay <= 10 * 60) return 45;
  if (input.persona.role === 'senior' && template.id === 'gardening' && input.minuteOfDay >= 9 * 60 && input.minuteOfDay <= 11 * 60) return 38;
  if (input.needs.hunger > 70 && template.id === 'prepare_breakfast') return 52;
  if (input.needs.hunger > 70 && template.id === 'eat_meal') return 45;
  if (input.needs.sleepiness > 82 && template.id === 'sleep') return 65;
  return 0;
}

function scoreNeedRelief(needs: NeedState, template: ActivityTemplate): number {
  return template.effects.reduce((score, effect) => {
    const needValue = needs[effect.need as keyof NeedState];
    if (typeof needValue !== 'number') {
      return score;
    }
    return score + Math.max(0, needValue) * Math.max(0, -effect.delta) / 100;
  }, 0);
}

function scoreHabit(persona: PersonaProfile, template: ActivityTemplate, minuteOfDay: number): number {
  const roomAffinity = persona.primaryRooms.includes(template.targetRoom) ? 8 : 0;
  const roleAffinity = template.goals.some((goal) => persona.careResponsibilities.includes(goal)) ? 12 : 0;
  const choreAffinity = template.goals.includes('chore') ? persona.chorePreference * 12 : 0;
  const mealAffinity = scoreMealAffinity(persona, template);
  const chronotypeBonus = persona.chronotype === 'early' && minuteOfDay < 9 * 60 ? 4 : persona.chronotype === 'late' && minuteOfDay > 20 * 60 ? 4 : 0;
  return roomAffinity + roleAffinity + choreAffinity + mealAffinity + chronotypeBonus;
}

function scoreResourceUrgency(input: ActivityDecisionInput, template: ActivityTemplate): number {
  if (template.id === 'laundry_cycle') {
    return Math.min(42, Math.max(0, (input.availableResources.dirty_laundry ?? 0) - 1) * 7);
  }
  if (template.id === 'unload_dishwasher') {
    return Math.min(28, Math.max(0, (input.availableResources.clean_dishes ?? 0) - 4) * 4);
  }
  if (template.id === 'take_out_trash') {
    return Math.min(42, Math.max(0, (input.availableResources.trash_bags ?? 0) - 0.8) * 20);
  }
  if (template.id === 'take_medicine' && input.persona.role === 'senior') {
    return (input.availableResources.medicine ?? 0) > 0 ? 8 : 0;
  }
  return 0;
}

function scoreConflictCost(input: ActivityDecisionInput, template: ActivityTemplate): number {
  const conflicts = template.requiredResources.map((resource) => input.resourceConflictByResource?.[resource.resourceId] ?? 0);
  const strongestConflict = conflicts.length > 0 ? Math.max(...conflicts) : 0;
  return strongestConflict > 0 ? -strongestConflict * 0.55 : 0;
}

function scoreMealAffinity(persona: PersonaProfile, template: ActivityTemplate): number {
  if (template.id === 'prepare_breakfast') {
    return persona.mealRegularity * 18;
  }
  if (template.id === 'eat_meal') {
    return persona.mealRegularity * 12;
  }
  if (template.id === 'eat_simple_food' || template.id === 'order_takeout') {
    return (1 - persona.mealRegularity) * 6;
  }
  return 0;
}

function firstMissingResource(template: ActivityTemplate, availableResources: Record<string, number>): string | null {
  const missing = template.requiredResources.find((resource) => (availableResources[resource.resourceId] ?? 0) < resource.quantity);
  return missing?.resourceId ?? null;
}

function fallbackDecision(input: ActivityDecisionInput, activityId: string, targetRoom: RoomId, score: number, reason: string): ActivityDecision {
  return {
    personId: input.personId,
    activityId,
    targetRoom,
    score,
    reason
  };
}

function fallbackDecisionForMissingResource(
  input: ActivityDecisionInput,
  template: ActivityTemplate,
  score: number,
  missingResource: string
): ActivityDecision {
  for (const fallbackId of template.fallbackActivityIds ?? []) {
    const fallback = getActivityTemplate(fallbackId);
    const fallbackMissingResource = firstMissingResource(fallback, input.availableResources);
    if (!fallbackMissingResource) {
      return fallbackDecision(input, fallback.id, fallback.targetRoom, score - 5, `fallback: missing ${missingResource}`);
    }
    if (fallback.fallbackActivityIds?.length) {
      return fallbackDecisionForMissingResource(input, fallback, score - 5, fallbackMissingResource);
    }
  }
  return fallbackDecision(input, 'idle', input.currentRoom === 'away' ? 'living_room' : input.currentRoom, score - 20, `fallback unavailable: missing ${missingResource}`);
}

function deterministicJitter(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * 6 - 3;
}
