import type { RoomId } from '../../shared/types';
import type { DistributionSpec } from '../sensors/deviceProfiles';

export interface ResourceRequirement {
  resourceId: string;
  quantity: number;
}

export interface ActivityEffect {
  need: string;
  delta: number;
}

export interface ActivityTemplate {
  id: string;
  goals: string[];
  preconditions: string[];
  requiredResources: ResourceRequirement[];
  participantRules: string[];
  durationDistribution: DistributionSpec;
  interruptibility: number;
  targetRoom: RoomId;
  steps: string[];
  effects: ActivityEffect[];
  fallbackActivityIds?: string[];
}

const activityTemplates: ActivityTemplate[] = [
  activity('sleep', ['restore_energy'], [], [], 'master_bedroom', { kind: 'uniform', min: 360, max: 540 }, 0.08, ['lie_down'], [{ need: 'sleepiness', delta: -70 }]),
  activity('wake_up', ['start_day'], [], [], 'master_bedroom', { kind: 'uniform', min: 5, max: 15 }, 0.7, ['leave_bed'], [{ need: 'sleepiness', delta: -8 }]),
  activity('bathroom_routine', ['hygiene'], [], [{ resourceId: 'bathroom_sink', quantity: 1 }], 'bathroom', { kind: 'uniform', min: 8, max: 18 }, 0.45, ['use_bathroom', 'wash'], [{ need: 'hygiene', delta: -45 }, { need: 'bathroomNeed', delta: -70 }]),
  activity('prepare_breakfast', ['reduce_hunger'], ['awake'], [{ resourceId: 'breakfast_food', quantity: 1 }], 'kitchen', { kind: 'uniform', min: 12, max: 28 }, 0.35, ['open_fridge', 'use_stove', 'serve_food'], [{ need: 'hunger', delta: -35 }], ['eat_simple_food']),
  activity('eat_simple_food', ['reduce_hunger'], [], [{ resourceId: 'simple_food', quantity: 1 }], 'kitchen', { kind: 'uniform', min: 4, max: 9 }, 0.7, ['grab_food'], [{ need: 'hunger', delta: -20 }], ['order_takeout']),
  activity('order_takeout', ['reduce_hunger'], [], [{ resourceId: 'door_access', quantity: 1 }], 'entrance', { kind: 'uniform', min: 12, max: 35 }, 0.55, ['place_order', 'collect_delivery'], [{ need: 'hunger', delta: -42 }, { need: 'mood', delta: 4 }]),
  activity('eat_meal', ['reduce_hunger', 'social'], [], [{ resourceId: 'prepared_meal', quantity: 1 }], 'dining_room', { kind: 'uniform', min: 18, max: 36 }, 0.3, ['sit', 'eat'], [{ need: 'hunger', delta: -55 }, { need: 'socialNeed', delta: -18 }]),
  activity('commute_out', ['workday'], [], [{ resourceId: 'door_access', quantity: 1 }], 'entrance', { kind: 'uniform', min: 6, max: 15 }, 0.2, ['collect_bag', 'leave_home'], [{ need: 'taskPressure', delta: -15 }]),
  activity('arrive_home', ['return_home'], [], [{ resourceId: 'door_access', quantity: 1 }], 'entrance', { kind: 'uniform', min: 3, max: 8 }, 0.6, ['unlock', 'enter'], [{ need: 'stress', delta: -12 }]),
  activity('remote_work_session', ['work'], [], [{ resourceId: 'study_desk', quantity: 1 }], 'study', { kind: 'uniform', min: 45, max: 150 }, 0.25, ['sit_at_desk', 'video_calls'], [{ need: 'taskPressure', delta: -42 }, { need: 'stress', delta: 10 }]),
  activity('study_homework', ['schoolwork'], [], [{ resourceId: 'homework_materials', quantity: 1 }], 'child_bedroom', { kind: 'uniform', min: 35, max: 80 }, 0.22, ['open_books', 'focus'], [{ need: 'taskPressure', delta: -50 }, { need: 'stress', delta: 8 }]),
  activity('watch_tv', ['relax'], [], [{ resourceId: 'tv_01', quantity: 1 }], 'living_room', { kind: 'uniform', min: 20, max: 90 }, 0.75, ['sit', 'watch'], [{ need: 'stress', delta: -25 }, { need: 'mood', delta: 10 }]),
  activity('laundry_cycle', ['chore'], [], [{ resourceId: 'dirty_laundry', quantity: 1 }], 'bathroom', { kind: 'uniform', min: 8, max: 18 }, 0.35, ['load_washer'], [{ need: 'taskPressure', delta: -12 }]),
  activity('unload_dishwasher', ['chore'], [], [{ resourceId: 'clean_dishes', quantity: 1 }], 'kitchen', { kind: 'uniform', min: 5, max: 12 }, 0.5, ['empty_rack'], [{ need: 'taskPressure', delta: -10 }]),
  activity('take_out_trash', ['chore'], [], [{ resourceId: 'trash_bags', quantity: 1 }], 'entrance', { kind: 'uniform', min: 5, max: 12 }, 0.45, ['tie_bag', 'carry_out'], [{ need: 'taskPressure', delta: -12 }, { need: 'comfort', delta: 6 }]),
  activity('take_medicine', ['health'], [], [{ resourceId: 'medicine', quantity: 1 }], 'master_bedroom', { kind: 'uniform', min: 2, max: 5 }, 0.2, ['take_pill'], [{ need: 'healthConcern', delta: -35 }]),
  activity('senior_check_in', ['care'], [], [], 'living_room', { kind: 'uniform', min: 4, max: 10 }, 0.3, ['talk'], [{ need: 'healthConcern', delta: -18 }, { need: 'socialNeed', delta: -20 }]),
  activity('clean_room', ['chore'], [], [{ resourceId: 'cleaning_supplies', quantity: 1 }], 'living_room', { kind: 'uniform', min: 10, max: 25 }, 0.45, ['tidy'], [{ need: 'taskPressure', delta: -10 }]),
  activity('gardening', ['plant_care'], [], [{ resourceId: 'garden_access', quantity: 1 }], 'garden', { kind: 'uniform', min: 15, max: 40 }, 0.5, ['inspect_plants'], [{ need: 'mood', delta: 12 }, { need: 'taskPressure', delta: -8 }]),
  activity('pet_care', ['care'], [], [{ resourceId: 'pet_food', quantity: 1 }], 'kitchen', { kind: 'uniform', min: 4, max: 10 }, 0.65, ['feed_pet'], [{ need: 'mood', delta: 8 }])
];

export function listActivityTemplates(): ActivityTemplate[] {
  return structuredClone(activityTemplates);
}

export function getActivityTemplate(id: string): ActivityTemplate {
  const template = activityTemplates.find((activity) => activity.id === id);
  if (!template) {
    throw new Error(`Unknown activity template: ${id}`);
  }
  return structuredClone(template);
}

function activity(
  id: string,
  goals: string[],
  preconditions: string[],
  requiredResources: ResourceRequirement[],
  targetRoom: RoomId,
  durationDistribution: DistributionSpec,
  interruptibility: number,
  steps: string[],
  effects: ActivityEffect[],
  fallbackActivityIds: string[] = []
): ActivityTemplate {
  return {
    id,
    goals,
    preconditions,
    requiredResources,
    participantRules: [],
    durationDistribution,
    interruptibility,
    targetRoom,
    steps,
    effects,
    ...(fallbackActivityIds.length > 0 ? { fallbackActivityIds } : {})
  };
}
