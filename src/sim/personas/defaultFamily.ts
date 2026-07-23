import type { Catalog, PersonDefinition, ResidentAgeBand, ResidentRole, RoomId } from '../../shared/types';
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

export function getPersonaForDefinition(person: PersonDefinition, catalog: Catalog): PersonaProfile {
  if (person.profile) {
    return structuredClone({ personId: person.id, ...person.profile });
  }
  const existing = defaultFamilyPersonas[person.id];
  if (existing) {
    return structuredClone(existing);
  }

  const role = inferResidentRole(person);
  const ageBand = inferAgeBand(person, role);
  return {
    personId: person.id,
    role,
    ageBand,
    chronotype: ageBand === 'senior' ? 'early' : 'neutral',
    sleepNeedHours: ageBand === 'child' ? 9 : ageBand === 'senior' ? 7.8 : ageBand === 'pet' ? 13 : 7.5,
    mealRegularity: ageBand === 'pet' ? 0.6 : 0.7,
    chorePreference: ageBand === 'child' || ageBand === 'pet' ? 0.2 : 0.5,
    riskSensitivity: ageBand === 'senior' ? 0.75 : ageBand === 'child' ? 0.45 : 0.6,
    sociability: 0.55,
    mobility: ageBand === 'senior' ? 'steady' : 'active',
    primaryRooms: inferPrimaryRooms(role, catalog),
    deviceFamiliarity: {},
    careResponsibilities: inferCareResponsibilities(role)
  };
}

function inferResidentRole(person: PersonDefinition): ResidentRole {
  if (person.kind === 'pet') return 'pet';
  const role = person.role.toLowerCase().replaceAll('-', ' ').replaceAll('_', ' ');
  if (role.includes('student') || role.includes('child')) return 'student';
  if (role.includes('senior') || role.includes('elder')) return 'senior';
  if (role.includes('remote') || role.includes('hybrid')) return 'remote_worker';
  if (role.includes('commut') || role.includes('office')) return 'commuter';
  return 'home_adult';
}

function inferAgeBand(person: PersonDefinition, role: ResidentRole): ResidentAgeBand {
  if (person.kind === 'pet') return 'pet';
  if (role === 'student') return 'child';
  if (role === 'senior') return 'senior';
  return 'adult';
}

function inferPrimaryRooms(role: ResidentRole, catalog: Catalog): RoomId[] {
  const preferredTypes = role === 'remote_worker'
    ? ['work', 'bedroom', 'living']
    : role === 'student'
      ? ['bedroom', 'work', 'living']
      : role === 'senior'
        ? ['bedroom', 'living', 'outdoor']
        : role === 'pet'
          ? ['living', 'outdoor', 'utility']
          : ['bedroom', 'living', 'entry'];
  const matches = catalog.rooms
    .filter((room) => preferredTypes.includes(room.type))
    .map((room) => room.id);
  return matches.length > 0 ? matches : catalog.rooms.map((room) => room.id);
}

function inferCareResponsibilities(role: ResidentRole): string[] {
  if (role === 'commuter') return ['commute'];
  if (role === 'remote_worker') return ['remote_work'];
  if (role === 'student') return ['homework'];
  if (role === 'senior') return ['self_medication'];
  return [];
}
