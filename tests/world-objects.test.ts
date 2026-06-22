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
      'dirty_dishes',
      'kitchen_cabinet'
    ]));
    expect(objectsByRoom(objects, 'living_room').map((object) => object.id)).toEqual(expect.arrayContaining([
      'living_sofa',
      'family_phone'
    ]));
    expect(objectsByRoom(objects, 'bathroom').map((object) => object.id)).toEqual(expect.arrayContaining([
      'bathroom_sink',
      'bathtub',
      'clothing_pile'
    ]));
    expect(objectsByRoom(objects, 'entrance').map((object) => object.id)).toEqual(expect.arrayContaining([
      'front_door',
      'hallway_passage'
    ]));
    expect(objectsWithAffordance(objects, 'sleep').map((object) => object.id)).toContain('master_bed');
    expect(getAffordancesForActivity('prepare_breakfast').map((affordance) => affordance.objectId)).toEqual(expect.arrayContaining([
      'kitchen_fridge',
      'stove_fixture',
      'pantry_food',
      'kitchen_cabinet'
    ]));
    expect(getAffordancesForActivity('bathroom_routine').map((affordance) => affordance.objectId)).toEqual(expect.arrayContaining([
      'bathroom_sink',
      'bathtub'
    ]));
  });
});
