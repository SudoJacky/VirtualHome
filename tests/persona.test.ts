import { describe, expect, it } from 'vitest';
import { defaultFamilyPersonas, getPersona } from '../src/sim/personas/defaultFamily';

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
});
