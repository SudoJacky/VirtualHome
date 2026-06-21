import type { HouseholdInventoryState } from '../../shared/types';

export type HouseholdInventory = HouseholdInventoryState;

export interface InventoryDayContext {
  peopleHomeCount: number;
  mealsCooked: number;
  petPresent: boolean;
}

export function createInitialInventory(overrides: Partial<HouseholdInventory> = {}): HouseholdInventory {
  return normalizeInventory({
    breakfastFoodServings: 6,
    simpleFoodServings: 4,
    preparedMeals: 1,
    dirtyLaundryKg: 1.2,
    dirtyDishes: 2,
    trashBags: 0.2,
    medicineDoses: 14,
    packageCount: 0,
    unfinishedChores: 1,
    sleepDebtHours: 0,
    deviceMaintenanceScore: 8,
    healthRiskScore: 28,
    pendingChores: [],
    ...overrides
  });
}

export function resourcesFromInventory(inventory: HouseholdInventory): Record<string, number> {
  return {
    bathroom_sink: 1,
    breakfast_food: inventory.breakfastFoodServings > 0 ? 1 : 0,
    prepared_meal: inventory.preparedMeals > 0 ? 1 : 0,
    door_access: 1,
    study_desk: 1,
    homework_materials: 1,
    tv_01: 1,
    dirty_laundry: inventory.dirtyLaundryKg >= 3 ? 1 : 0,
    clean_dishes: inventory.dirtyDishes >= 4 ? 1 : 0,
    medicine: inventory.medicineDoses > 0 ? 1 : 0,
    cleaning_supplies: 1,
    garden_access: 1,
    pet_food: 1
  };
}

export function applyActivityToInventory(inventory: HouseholdInventory, activityId: string): HouseholdInventory {
  const next = structuredClone(inventory);
  if (activityId === 'prepare_breakfast') {
    next.breakfastFoodServings -= 1;
    next.dirtyDishes += 3;
    next.trashBags += 0.1;
  } else if (activityId === 'eat_simple_food') {
    next.simpleFoodServings -= 1;
    next.trashBags += 0.05;
  } else if (activityId === 'eat_meal') {
    next.preparedMeals -= 1;
    next.dirtyDishes += 4;
  } else if (activityId === 'laundry_cycle') {
    next.dirtyLaundryKg = Math.max(0, next.dirtyLaundryKg - 4);
    next.unfinishedChores = Math.max(0, next.unfinishedChores - 1);
  } else if (activityId === 'unload_dishwasher') {
    next.dirtyDishes = 0;
    next.unfinishedChores = Math.max(0, next.unfinishedChores - 1);
  } else if (activityId === 'take_medicine') {
    next.medicineDoses -= 1;
    next.healthRiskScore -= 12;
  }
  return normalizeInventory(next);
}

export function advanceInventoryOneDay(inventory: HouseholdInventory, context: InventoryDayContext): HouseholdInventory {
  const next = structuredClone(inventory);
  next.dirtyLaundryKg += context.peopleHomeCount * 0.72;
  next.dirtyDishes += context.mealsCooked * Math.max(2, context.peopleHomeCount);
  next.trashBags += context.mealsCooked * 0.28 + (context.petPresent ? 0.12 : 0);
  next.sleepDebtHours += context.peopleHomeCount > 0 ? 0.4 : 0;
  next.healthRiskScore += next.medicineDoses <= 0 ? 8 : 1;
  next.unfinishedChores += 1;
  return normalizeInventory(next);
}

function normalizeInventory(inventory: HouseholdInventory): HouseholdInventory {
  const pendingChores = new Set<string>();
  if (inventory.dirtyLaundryKg >= 3) pendingChores.add('laundry');
  if (inventory.dirtyDishes >= 4) pendingChores.add('dishes');
  if (inventory.trashBags >= 1) pendingChores.add('trash');
  if (inventory.medicineDoses <= 2) pendingChores.add('medicine_refill');
  for (const chore of inventory.pendingChores) pendingChores.add(chore);

  return {
    ...inventory,
    breakfastFoodServings: clampRound(inventory.breakfastFoodServings, 0),
    simpleFoodServings: clampRound(inventory.simpleFoodServings, 0),
    preparedMeals: clampRound(inventory.preparedMeals, 0),
    dirtyLaundryKg: clampRound(inventory.dirtyLaundryKg, 0),
    dirtyDishes: Math.max(0, Math.round(inventory.dirtyDishes)),
    trashBags: clampRound(inventory.trashBags, 0),
    medicineDoses: Math.max(0, Math.round(inventory.medicineDoses)),
    packageCount: Math.max(0, Math.round(inventory.packageCount)),
    unfinishedChores: Math.max(0, Math.round(inventory.unfinishedChores)),
    sleepDebtHours: clampRound(inventory.sleepDebtHours, 0),
    deviceMaintenanceScore: clampRound(inventory.deviceMaintenanceScore, 0, 100),
    healthRiskScore: clampRound(inventory.healthRiskScore, 0, 100),
    pendingChores: [...pendingChores].sort()
  };
}

function clampRound(value: number, min: number, max = Number.POSITIVE_INFINITY): number {
  return Math.min(max, Math.max(min, Math.round(value * 10) / 10));
}
