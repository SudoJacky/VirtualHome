import { createInitialInventory, resourcesFromInventory, type HouseholdInventory } from './inventory';

export type HouseholdResourceMap = Record<string, number>;

export function createDefaultResourceMap(overrides: Partial<HouseholdInventory> = {}): HouseholdResourceMap {
  return resourcesFromInventory(createInitialInventory(overrides));
}
