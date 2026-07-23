import { describe, expect, it } from 'vitest';
import { defaultFamilyPersonas, getPersona, getPersonaForDefinition } from '../src/sim/personas/defaultFamily';
import type { Catalog, PersonDefinition } from '../src/shared/types';

describe('default family personas', () => {
  it('gives each family member stable long-term traits and home anchors', () => {
    expect(Object.keys(defaultFamilyPersonas)).toEqual(['adult_1', 'adult_2', 'child_1', 'senior_1', 'pet_1']);
    expect(getPersona('adult_2')).toMatchObject({
      personId: 'adult_2',
      role: 'remote_worker',
      chronotype: 'neutral',
      primaryRooms: ['study', 'kitchen', 'living_room'],
      deviceFamiliarity: expect.objectContaining({ router_01: 0.9 })
    });
    expect(getPersona('senior_1')).toMatchObject({
      role: 'senior',
      careResponsibilities: ['self_medication', 'plant_care'],
      mobility: 'steady'
    });
  });

  it('builds a persona for a template-defined resident without a default-family id', () => {
    const person: PersonDefinition = {
      id: 'resident_nurse',
      kind: 'human',
      role: 'commuter nurse',
      homeMember: true
    };
    const catalog: Catalog = {
      people: [person],
      devices: [],
      rooms: [{
        id: 'sleeping_room_a',
        name: 'Sleeping Room A',
        type: 'bedroom',
        connectedRooms: []
      }]
    };

    expect(getPersonaForDefinition(person, catalog)).toMatchObject({
      personId: 'resident_nurse',
      role: 'commuter',
      ageBand: 'adult',
      primaryRooms: ['sleeping_room_a']
    });
  });

  it('prefers an explicit template profile over a matching default-family id', () => {
    const person: PersonDefinition = {
      id: 'adult_1',
      kind: 'human',
      role: 'night shift clinician',
      homeMember: true,
      profile: {
        role: 'home_adult',
        ageBand: 'adult',
        chronotype: 'late',
        sleepNeedHours: 8.5,
        mealRegularity: 0.35,
        chorePreference: 0.2,
        riskSensitivity: 0.9,
        sociability: 0.4,
        mobility: 'steady',
        primaryRooms: ['sleeping_room_a'],
        deviceFamiliarity: {},
        careResponsibilities: []
      }
    };
    const catalog: Catalog = {
      people: [person],
      devices: [],
      rooms: [{
        id: 'sleeping_room_a',
        name: 'Sleeping Room A',
        type: 'bedroom',
        connectedRooms: []
      }]
    };

    expect(getPersonaForDefinition(person, catalog)).toMatchObject({
      personId: 'adult_1',
      role: 'home_adult',
      chronotype: 'late',
      sleepNeedHours: 8.5,
      primaryRooms: ['sleeping_room_a']
    });
  });
});
