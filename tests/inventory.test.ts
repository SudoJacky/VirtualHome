import { describe, expect, it } from 'vitest';
import {
  advanceInventoryOneDay,
  applyActivityToInventory,
  createInitialInventory,
  resourcesFromInventory
} from '../src/sim/world/inventory';

describe('household inventory and resources', () => {
  it('maps accumulated household state into activity resources', () => {
    const inventory = createInitialInventory({
      breakfastFoodServings: 0,
      simpleFoodServings: 0,
      dirtyLaundryKg: 5.2,
      dirtyDishes: 8,
      medicineDoses: 2
    });
    const resources = resourcesFromInventory(inventory);

    expect(resources.breakfast_food).toBe(0);
    expect(resources.simple_food).toBe(0);
    expect(resources.dirty_laundry).toBe(5.2);
    expect(resources.clean_dishes).toBe(8);
    expect(resources.medicine).toBe(2);
  });

  it('updates inventory when meals, laundry, dishwasher, medicine, and trash activities happen', () => {
    const inventory = createInitialInventory({
      breakfastFoodServings: 3,
      dirtyLaundryKg: 4.5,
      dirtyDishes: 6,
      trashBags: 1.4,
      medicineDoses: 1
    });
    const afterBreakfast = applyActivityToInventory(inventory, 'prepare_breakfast');
    const afterLaundry = applyActivityToInventory(afterBreakfast, 'laundry_cycle');
    const afterDishwasher = applyActivityToInventory(afterLaundry, 'unload_dishwasher');
    const afterMedicine = applyActivityToInventory(afterDishwasher, 'take_medicine');
    const afterTrash = applyActivityToInventory(afterMedicine, 'take_out_trash');
    const afterTakeout = applyActivityToInventory(createInitialInventory({ simpleFoodServings: 0, trashBags: 0.2 }), 'order_takeout');

    expect(afterBreakfast.breakfastFoodServings).toBe(2);
    expect(afterBreakfast.dirtyDishes).toBeGreaterThan(inventory.dirtyDishes);
    expect(afterLaundry.dirtyLaundryKg).toBeLessThan(afterBreakfast.dirtyLaundryKg);
    expect(afterDishwasher.dirtyDishes).toBe(0);
    expect(afterMedicine.medicineDoses).toBe(0);
    expect(afterMedicine.healthRiskScore).toBeLessThan(afterDishwasher.healthRiskScore);
    expect(afterTrash.trashBags).toBe(0);
    expect(afterTrash.pendingChores).not.toContain('trash');
    expect(afterTakeout.simpleFoodServings).toBe(0);
    expect(afterTakeout.trashBags).toBeGreaterThan(0.2);
  });

  it('accumulates long-term chores across days instead of resetting every day', () => {
    const firstDay = advanceInventoryOneDay(createInitialInventory(), {
      peopleHomeCount: 4,
      mealsCooked: 2,
      petPresent: true
    });
    const secondDay = advanceInventoryOneDay(firstDay, {
      peopleHomeCount: 4,
      mealsCooked: 1,
      petPresent: true
    });

    expect(secondDay.dirtyLaundryKg).toBeGreaterThan(firstDay.dirtyLaundryKg);
    expect(secondDay.dirtyDishes).toBeGreaterThan(firstDay.dirtyDishes);
    expect(secondDay.trashBags).toBeGreaterThan(firstDay.trashBags);
    expect(secondDay.pendingChores).toEqual(expect.arrayContaining(['laundry', 'dishes']));
  });
});
