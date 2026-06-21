import type { PersonaProfile } from '../agents/persona';

export const defaultFamilyPersonas: Record<string, PersonaProfile> = {
  adult_1: {
    personId: 'adult_1',
    role: 'commuter',
    ageBand: 'adult',
    chronotype: 'early',
    sleepNeedHours: 7.4,
    mealRegularity: 0.72,
    chorePreference: 0.56,
    riskSensitivity: 0.68,
    sociability: 0.62,
    mobility: 'active',
    primaryRooms: ['master_bedroom', 'kitchen', 'entrance', 'living_room'],
    deviceFamiliarity: { fridge_01: 0.86, stove_01: 0.74, door_lock_01: 0.82 },
    careResponsibilities: ['commute', 'family_dinner', 'security_check']
  },
  adult_2: {
    personId: 'adult_2',
    role: 'remote_worker',
    ageBand: 'adult',
    chronotype: 'neutral',
    sleepNeedHours: 7.2,
    mealRegularity: 0.68,
    chorePreference: 0.5,
    riskSensitivity: 0.62,
    sociability: 0.55,
    mobility: 'active',
    primaryRooms: ['study', 'kitchen', 'living_room'],
    deviceFamiliarity: { router_01: 0.9, study_co2_01: 0.7, tv_01: 0.58 },
    careResponsibilities: ['remote_work', 'network_recovery']
  },
  child_1: {
    personId: 'child_1',
    role: 'student',
    ageBand: 'child',
    chronotype: 'neutral',
    sleepNeedHours: 9,
    mealRegularity: 0.76,
    chorePreference: 0.28,
    riskSensitivity: 0.42,
    sociability: 0.78,
    mobility: 'active',
    primaryRooms: ['child_bedroom', 'living_room', 'kitchen'],
    deviceFamiliarity: { tv_01: 0.7, child_sleep_01: 0.42 },
    careResponsibilities: ['homework']
  },
  senior_1: {
    personId: 'senior_1',
    role: 'senior',
    ageBand: 'senior',
    chronotype: 'early',
    sleepNeedHours: 7.8,
    mealRegularity: 0.82,
    chorePreference: 0.42,
    riskSensitivity: 0.78,
    sociability: 0.5,
    mobility: 'steady',
    primaryRooms: ['master_bedroom', 'living_room', 'garden'],
    deviceFamiliarity: { master_sleep_01: 0.5, sprinkler_01: 0.52, master_ac_01: 0.68 },
    careResponsibilities: ['self_medication', 'plant_care']
  },
  pet_1: {
    personId: 'pet_1',
    role: 'pet',
    ageBand: 'pet',
    chronotype: 'neutral',
    sleepNeedHours: 13,
    mealRegularity: 0.6,
    chorePreference: 0,
    riskSensitivity: 0.2,
    sociability: 0.72,
    mobility: 'active',
    primaryRooms: ['living_room', 'garden', 'kitchen'],
    deviceFamiliarity: {},
    careResponsibilities: []
  }
};

export function getPersona(personId: string): PersonaProfile {
  const persona = defaultFamilyPersonas[personId];
  if (!persona) {
    throw new Error(`Unknown persona: ${personId}`);
  }
  return structuredClone(persona);
}
