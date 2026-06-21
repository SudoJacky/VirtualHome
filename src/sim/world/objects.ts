import type { RoomId } from '../../shared/types';

export type HouseholdObjectKind = 'furniture' | 'consumable' | 'movable' | 'waste' | 'fixture';

export interface HouseholdObject {
  id: string;
  kind: HouseholdObjectKind;
  roomId: RoomId;
  displayName: string;
  affordances: string[];
  quantity?: number;
}

const defaultObjects: HouseholdObject[] = [
  object('master_bed', 'furniture', 'master_bedroom', 'Master bed', ['sleep', 'rest']),
  object('child_desk', 'furniture', 'child_bedroom', 'Child desk', ['study_homework']),
  object('study_desk', 'furniture', 'study', 'Study desk', ['remote_work_session']),
  object('kitchen_fridge', 'fixture', 'kitchen', 'Kitchen fridge', ['prepare_breakfast', 'store_food']),
  object('stove_fixture', 'fixture', 'kitchen', 'Stove', ['prepare_breakfast', 'cook_meal']),
  object('pantry_food', 'consumable', 'kitchen', 'Pantry food', ['prepare_breakfast', 'eat_simple_food'], 6),
  object('medicine_box', 'consumable', 'master_bedroom', 'Medicine box', ['take_medicine'], 14),
  object('dirty_dishes', 'waste', 'kitchen', 'Dirty dishes', ['unload_dishwasher'], 0),
  object('laundry_hamper', 'waste', 'bathroom', 'Laundry hamper', ['laundry_cycle'], 0),
  object('school_bag', 'movable', 'child_bedroom', 'School bag', ['study_homework', 'commute_out']),
  object('keys', 'movable', 'entrance', 'Keys', ['commute_out', 'arrive_home']),
  object('trash_bin', 'waste', 'kitchen', 'Trash bin', ['clean_room'], 0),
  object('garden_bed', 'fixture', 'garden', 'Garden bed', ['gardening'])
];

export function getDefaultHouseholdObjects(): HouseholdObject[] {
  return structuredClone(defaultObjects);
}

export function objectsByRoom(objects: HouseholdObject[], roomId: RoomId): HouseholdObject[] {
  return objects.filter((object) => object.roomId === roomId);
}

export function objectsWithAffordance(objects: HouseholdObject[], affordance: string): HouseholdObject[] {
  return objects.filter((object) => object.affordances.includes(affordance));
}

function object(
  id: string,
  kind: HouseholdObjectKind,
  roomId: RoomId,
  displayName: string,
  affordances: string[],
  quantity?: number
): HouseholdObject {
  return {
    id,
    kind,
    roomId,
    displayName,
    affordances,
    ...(quantity !== undefined ? { quantity } : {})
  };
}
