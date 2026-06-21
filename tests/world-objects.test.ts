import { describe, expect, it } from 'vitest';
import { getDefaultHouseholdObjects, objectsByRoom, objectsWithAffordance } from '../src/sim/world/objects';
import { getAffordancesForActivity } from '../src/sim/world/affordances';

describe('household objects and affordances', () => {
  it('models furniture, consumables, movable items, waste, and fixtures with room affordances', () => {
    const objects = getDefaultHouseholdObjects();

    expect(objects.map((object) => object.kind)).toEqual(expect.arrayContaining([
      'furniture',
      'consumable',
      'movable',
      'waste',
      'fixture'
    ]));
    expect(objectsByRoom(objects, 'kitchen').map((object) => object.id)).toEqual(expect.arrayContaining([
      'kitchen_fridge',
      'pantry_food',
      'dirty_dishes'
    ]));
    expect(objectsWithAffordance(objects, 'sleep').map((object) => object.id)).toContain('master_bed');
    expect(getAffordancesForActivity('prepare_breakfast').map((affordance) => affordance.objectId)).toEqual(expect.arrayContaining([
      'kitchen_fridge',
      'stove_fixture',
      'pantry_food'
    ]));
  });
});
