import type { HomeMode } from '../../shared/types';
import { getActivityTemplate } from './activityCatalog';
import type { PersonaProfile } from './persona';

export interface NeedState {
  sleepiness: number;
  sleepDebt: number;
  hunger: number;
  thirst: number;
  hygiene: number;
  bathroomNeed: number;
  fatigue: number;
  stress: number;
  mood: number;
  socialNeed: number;
  comfort: number;
  healthConcern: number;
  taskPressure: number;
}

export interface NeedAdvanceContext {
  minutes: number;
  activity: string;
  homeMode: HomeMode;
}

export function createInitialNeeds(persona: PersonaProfile): NeedState {
  return {
    sleepiness: persona.chronotype === 'early' ? 18 : 24,
    sleepDebt: Math.max(0, 8 - persona.sleepNeedHours) * 8,
    hunger: 34,
    thirst: 28,
    hygiene: 24,
    bathroomNeed: 18,
    fatigue: persona.ageBand === 'senior' ? 30 : 22,
    stress: persona.role === 'student' ? 30 : 24,
    mood: 68,
    socialNeed: Math.round(45 + persona.sociability * 15),
    comfort: 70,
    healthConcern: persona.ageBand === 'senior' ? 28 : 10,
    taskPressure: persona.role === 'remote_worker' || persona.role === 'student' ? 34 : 20
  };
}

export function advanceNeeds(needs: NeedState, persona: PersonaProfile, context: NeedAdvanceContext): NeedState {
  const hours = context.minutes / 60;
  const sleeping = context.activity === 'sleeping';
  const active = !sleeping && context.homeMode !== 'sleeping';
  return clampNeeds({
    ...needs,
    sleepiness: needs.sleepiness + (sleeping ? -18 : 7.5) * hours,
    sleepDebt: needs.sleepDebt + (sleeping ? -10 : 4.2) * hours,
    hunger: needs.hunger + (sleeping ? 2.4 : 7.2 / Math.max(0.5, persona.mealRegularity)) * hours,
    thirst: needs.thirst + (sleeping ? 1.8 : 8) * hours,
    hygiene: needs.hygiene + (active ? 5.6 : 1.2) * hours,
    bathroomNeed: needs.bathroomNeed + (sleeping ? 2 : 6.4) * hours,
    fatigue: needs.fatigue + (sleeping ? -12 : persona.mobility === 'limited' ? 7 : 5) * hours,
    stress: needs.stress + (context.activity.includes('work') || context.activity.includes('homework') ? 5 : -2) * hours,
    mood: needs.mood + (sleeping ? 1 : -0.8) * hours,
    socialNeed: needs.socialNeed + (persona.sociability * 2.8) * hours,
    comfort: needs.comfort + (context.homeMode === 'sleeping' ? 1 : -1.5) * hours,
    healthConcern: needs.healthConcern + (persona.ageBand === 'senior' && !sleeping ? 1.2 : -0.5) * hours,
    taskPressure: needs.taskPressure + taskPressureDelta(persona, context.activity) * hours
  });
}

export function applyActivityEffectsToNeeds(needs: NeedState, activityId: string): NeedState {
  try {
    const template = getActivityTemplate(activityId);
    return clampNeeds({
      ...needs,
      ...Object.fromEntries(template.effects.map((effect) => {
        const key = effect.need as keyof NeedState;
        const current = needs[key];
        return [key, typeof current === 'number' ? current + effect.delta : current];
      }))
    });
  } catch {
    return needs;
  }
}

function taskPressureDelta(persona: PersonaProfile, activity: string): number {
  if (persona.role === 'remote_worker') {
    return activity === 'remote_work' ? -8 : 5;
  }
  if (persona.role === 'student') {
    return activity === 'homework' ? -10 : 6;
  }
  return activity.includes('chore') ? -4 : 1.5;
}

function clampNeeds(needs: NeedState): NeedState {
  return Object.fromEntries(Object.entries(needs).map(([key, value]) => [
    key,
    Math.max(0, Math.min(100, Math.round(value * 10) / 10))
  ])) as unknown as NeedState;
}
