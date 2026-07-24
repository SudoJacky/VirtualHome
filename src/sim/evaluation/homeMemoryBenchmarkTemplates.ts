import type {
  DeviceDefinition,
  PersonDefinition,
  ResidentAgeBand,
  ResidentChronotype,
  ResidentRole,
  RoomDefinition
} from '../../shared/types';
import {
  coreAutomationPolicyModule,
  type AutomationPolicyModule
} from '../automationPolicy';
import type {
  HouseholdCompilerOptions,
  HouseholdHabit,
  HouseholdTemplate
} from '../householdTemplate';

export type HomeMemoryBenchmarkSplit = 'train' | 'validation' | 'blind';

export type HomeMemoryBenchmarkIntervention =
  | 'none'
  | 'child_removed'
  | 'pet_removed'
  | 'remote_work_removed'
  | 'automation_removed';

export type HomeMemoryBenchmarkSemanticFeature =
  | 'resident.child'
  | 'resident.pet'
  | 'routine.remote_work'
  | 'automation.optional_rules';

export interface HomeMemoryBenchmarkTemplateDefinition {
  householdGroupId: string;
  split: HomeMemoryBenchmarkSplit;
  template: HouseholdTemplate;
  compilerOptions: HouseholdCompilerOptions;
}

interface HouseholdSpec {
  householdGroupId: string;
  split: HomeMemoryBenchmarkSplit;
  name: string;
  commuterCount: number;
  remoteWorkerCount: number;
  homeAdultCount: number;
  childCount: number;
  seniorCount: number;
  petCount: number;
  chronotype: ResidentChronotype;
}

interface TemplateIds {
  rooms: {
    entry: string;
    living: string;
    kitchen: string;
    adultSleep: string;
    work?: string;
    childSleep?: string;
    bathroom: string;
    outdoor?: string;
  };
  devices: {
    doorLock: string;
    livingLight: string;
    livingMotion: string;
    tv: string;
    vacuum: string;
    fridge: string;
    stove: string;
    rangeHood: string;
    kitchenAir: string;
    adultSleep: string;
    workLight?: string;
    workAir?: string;
    router?: string;
    childSleep?: string;
    childLight?: string;
    washer: string;
    waterFlow: string;
    waterLeak: string;
    waterValve: string;
    gardenCamera?: string;
    gardenSoil?: string;
  };
}

export const benchmarkSafetyOnlyAutomationPolicy: AutomationPolicyModule = Object.freeze({
  ...coreAutomationPolicyModule,
  id: 'benchmark_safety_only',
  version: '1.0.0',
  enabledRules: Object.freeze([
    'stove_unattended_safety',
    'close_water_valve_on_leak'
  ] as const)
});

const householdSpecs: HouseholdSpec[] = [
  {
    householdGroupId: 'group_01',
    split: 'train',
    name: 'Atlas Family',
    commuterCount: 1,
    remoteWorkerCount: 1,
    homeAdultCount: 0,
    childCount: 1,
    seniorCount: 0,
    petCount: 1,
    chronotype: 'neutral'
  },
  {
    householdGroupId: 'group_02',
    split: 'train',
    name: 'Birch Working Couple',
    commuterCount: 1,
    remoteWorkerCount: 1,
    homeAdultCount: 0,
    childCount: 0,
    seniorCount: 0,
    petCount: 0,
    chronotype: 'early'
  },
  {
    householdGroupId: 'group_03',
    split: 'train',
    name: 'Cedar Senior Home',
    commuterCount: 0,
    remoteWorkerCount: 0,
    homeAdultCount: 1,
    childCount: 0,
    seniorCount: 1,
    petCount: 1,
    chronotype: 'early'
  },
  {
    householdGroupId: 'group_04',
    split: 'validation',
    name: 'Delta Family',
    commuterCount: 1,
    remoteWorkerCount: 1,
    homeAdultCount: 0,
    childCount: 1,
    seniorCount: 0,
    petCount: 1,
    chronotype: 'late'
  },
  {
    householdGroupId: 'group_05',
    split: 'validation',
    name: 'Ember Single Parent',
    commuterCount: 1,
    remoteWorkerCount: 0,
    homeAdultCount: 0,
    childCount: 1,
    seniorCount: 0,
    petCount: 0,
    chronotype: 'neutral'
  },
  {
    householdGroupId: 'group_06',
    split: 'blind',
    name: 'Fjord Multigenerational Home',
    commuterCount: 1,
    remoteWorkerCount: 1,
    homeAdultCount: 0,
    childCount: 1,
    seniorCount: 1,
    petCount: 1,
    chronotype: 'neutral'
  },
  {
    householdGroupId: 'group_07',
    split: 'blind',
    name: 'Grove Night Worker',
    commuterCount: 1,
    remoteWorkerCount: 0,
    homeAdultCount: 0,
    childCount: 0,
    seniorCount: 0,
    petCount: 0,
    chronotype: 'late'
  },
  {
    householdGroupId: 'group_08',
    split: 'blind',
    name: 'Harbor Retired Pair',
    commuterCount: 0,
    remoteWorkerCount: 0,
    homeAdultCount: 1,
    childCount: 0,
    seniorCount: 1,
    petCount: 1,
    chronotype: 'early'
  }
];

export function createHomeMemoryBenchmarkTemplateCatalog(): HomeMemoryBenchmarkTemplateDefinition[] {
  return householdSpecs.map((spec) => ({
    householdGroupId: spec.householdGroupId,
    split: spec.split,
    template: buildHouseholdTemplate(spec),
    compilerOptions: {}
  }));
}

export function applyHomeMemoryBenchmarkIntervention(
  definition: HomeMemoryBenchmarkTemplateDefinition,
  intervention: Exclude<HomeMemoryBenchmarkIntervention, 'none'>
): HomeMemoryBenchmarkTemplateDefinition {
  const template = structuredClone(definition.template);
  template.id = `${template.id}_${intervention}`;
  template.version = '1.0.0-intervention';
  template.name = `${template.name} — ${intervention}`;

  if (intervention === 'child_removed') {
    removeResidents(template, (resident) => resident.profile?.ageBand === 'child');
  } else if (intervention === 'pet_removed') {
    removeResidents(template, (resident) => resident.kind === 'pet');
  } else if (intervention === 'remote_work_removed') {
    template.habits = template.habits.filter((habit) => habit.activity !== 'remote_work');
    template.residents = template.residents.map((resident) => {
      if (resident.profile?.role !== 'remote_worker') {
        return resident;
      }
      return {
        ...resident,
        role: 'home adult',
        profile: {
          ...resident.profile,
          role: 'home_adult'
        }
      };
    });
  } else {
    template.automation = {
      id: benchmarkSafetyOnlyAutomationPolicy.id,
      version: benchmarkSafetyOnlyAutomationPolicy.version
    };
  }

  return {
    ...definition,
    template,
    compilerOptions: intervention === 'automation_removed'
      ? { ...definition.compilerOptions, automationPolicies: [benchmarkSafetyOnlyAutomationPolicy] }
      : definition.compilerOptions
  };
}

export function expectedHomeMemoryBenchmarkFeatures(
  definition: HomeMemoryBenchmarkTemplateDefinition
): HomeMemoryBenchmarkSemanticFeature[] {
  const features: HomeMemoryBenchmarkSemanticFeature[] = [];
  if (definition.template.residents.some((resident) => resident.profile?.ageBand === 'child')) {
    features.push('resident.child');
  }
  if (definition.template.residents.some((resident) => resident.kind === 'pet')) {
    features.push('resident.pet');
  }
  if (definition.template.habits.some((habit) => habit.activity === 'remote_work')) {
    features.push('routine.remote_work');
  }
  if (definition.template.automation.id !== benchmarkSafetyOnlyAutomationPolicy.id) {
    features.push('automation.optional_rules');
  }
  return features;
}

export function targetFeatureForIntervention(
  intervention: Exclude<HomeMemoryBenchmarkIntervention, 'none'>
): HomeMemoryBenchmarkSemanticFeature {
  if (intervention === 'child_removed') return 'resident.child';
  if (intervention === 'pet_removed') return 'resident.pet';
  if (intervention === 'remote_work_removed') return 'routine.remote_work';
  return 'automation.optional_rules';
}

function buildHouseholdTemplate(spec: HouseholdSpec): HouseholdTemplate {
  const prefix = spec.householdGroupId.replace('group_', 'g');
  const hasWorkRoom = spec.remoteWorkerCount > 0;
  const hasChildRoom = spec.childCount > 0;
  const hasOutdoor = spec.petCount > 0 || spec.seniorCount > 0;
  const ids = createIds(prefix, { hasWorkRoom, hasChildRoom, hasOutdoor });
  const rooms = createRooms(ids);
  const devices = createDevices(ids);
  const residents = createResidents(spec, ids, devices);
  const habits = createHabits(spec, ids, residents);

  return {
    schemaVersion: 'virtualhome.household/v1',
    id: `benchmark_${prefix}`,
    version: '1.0.0',
    name: spec.name,
    home: {
      building: {
        id: `vh_benchmark_${prefix}`,
        name: `Benchmark Home ${prefix.toUpperCase()}`
      },
      floors: [{
        id: `${prefix}_floor_1`,
        name: 'Main Floor',
        level: 1,
        rooms,
        fixtures: { devices }
      }],
      topology: {
        connections: createConnections(ids)
      }
    },
    residents,
    environment: {
      timezone: 'Asia/Singapore',
      utcOffset: '+08:00',
      weather: { mode: 'generated' }
    },
    repertoires: [{ id: 'core_household', version: '1.0.0' }],
    behaviors: [{ id: 'core_device_physics', version: '1.0.0' }],
    automation: {
      id: coreAutomationPolicyModule.id,
      version: coreAutomationPolicyModule.version
    },
    habits
  };
}

function createIds(
  prefix: string,
  options: { hasWorkRoom: boolean; hasChildRoom: boolean; hasOutdoor: boolean }
): TemplateIds {
  return {
    rooms: {
      entry: `${prefix}_r01`,
      living: `${prefix}_r02`,
      kitchen: `${prefix}_r03`,
      adultSleep: `${prefix}_r04`,
      ...(options.hasWorkRoom ? { work: `${prefix}_r05` } : {}),
      ...(options.hasChildRoom ? { childSleep: `${prefix}_r06` } : {}),
      bathroom: `${prefix}_r07`,
      ...(options.hasOutdoor ? { outdoor: `${prefix}_r08` } : {})
    },
    devices: {
      doorLock: `${prefix}_d01`,
      livingLight: `${prefix}_d02`,
      livingMotion: `${prefix}_d03`,
      tv: `${prefix}_d04`,
      vacuum: `${prefix}_d05`,
      fridge: `${prefix}_d06`,
      stove: `${prefix}_d07`,
      rangeHood: `${prefix}_d08`,
      kitchenAir: `${prefix}_d09`,
      adultSleep: `${prefix}_d10`,
      ...(options.hasWorkRoom
        ? {
            workLight: `${prefix}_d11`,
            workAir: `${prefix}_d12`,
            router: `${prefix}_d13`
          }
        : {}),
      ...(options.hasChildRoom
        ? {
            childSleep: `${prefix}_d14`,
            childLight: `${prefix}_d15`
          }
        : {}),
      washer: `${prefix}_d16`,
      waterFlow: `${prefix}_d17`,
      waterLeak: `${prefix}_d18`,
      waterValve: `${prefix}_d19`,
      ...(options.hasOutdoor
        ? {
            gardenCamera: `${prefix}_d20`,
            gardenSoil: `${prefix}_d21`
          }
        : {})
    }
  };
}

function createRooms(ids: TemplateIds): RoomDefinition[] {
  const livingConnections = [
    ids.rooms.entry,
    ids.rooms.kitchen,
    ids.rooms.adultSleep,
    ids.rooms.bathroom,
    ids.rooms.work,
    ids.rooms.childSleep,
    ids.rooms.outdoor
  ].filter((roomId): roomId is string => Boolean(roomId));
  return [
    room(ids.rooms.entry, 'Entry', 'entry', [ids.rooms.living], ['arrival', 'departure']),
    room(ids.rooms.living, 'Shared Room', 'living', livingConnections, ['dining', 'family_time', 'pet_rest']),
    room(ids.rooms.kitchen, 'Food Room', 'utility', [ids.rooms.living, ids.rooms.bathroom], ['food_preparation']),
    room(ids.rooms.adultSleep, 'Sleeping Room A', 'bedroom', [ids.rooms.living, ids.rooms.bathroom], ['adult_sleeping', 'sleeping']),
    ...(ids.rooms.work
      ? [room(ids.rooms.work, 'Focus Room', 'work', [ids.rooms.living], ['focused_work', 'working'])]
      : []),
    ...(ids.rooms.childSleep
      ? [room(ids.rooms.childSleep, 'Sleeping Room B', 'bedroom', [ids.rooms.living], ['child_sleeping', 'homework'])]
      : []),
    room(ids.rooms.bathroom, 'Utility Room', 'utility', [ids.rooms.living, ids.rooms.kitchen, ids.rooms.adultSleep], ['hygiene', 'laundry']),
    ...(ids.rooms.outdoor
      ? [room(ids.rooms.outdoor, 'Outdoor Room', 'outdoor', [ids.rooms.living], ['pet_activity', 'gardening', 'outdoor_activity'])]
      : [])
  ];
}

function room(
  id: string,
  name: string,
  type: RoomDefinition['type'],
  connectedRooms: string[],
  purposes: string[]
): RoomDefinition {
  return { id, name, type, connectedRooms, purposes };
}

function createConnections(ids: TemplateIds): Array<{ from: string; to: string }> {
  return [
    ids.rooms.entry,
    ids.rooms.kitchen,
    ids.rooms.adultSleep,
    ids.rooms.work,
    ids.rooms.childSleep,
    ids.rooms.bathroom,
    ids.rooms.outdoor
  ]
    .filter((roomId): roomId is string => Boolean(roomId))
    .map((roomId) => ({ from: ids.rooms.living, to: roomId }));
}

function createDevices(ids: TemplateIds): DeviceDefinition[] {
  return [
    device(ids.devices.doorLock, ids.rooms.entry, 'door_lock', ['locked']),
    device(ids.devices.livingLight, ids.rooms.living, 'light', ['power', 'brightness']),
    device(ids.devices.livingMotion, ids.rooms.living, 'motion_sensor', ['motion', 'confidence']),
    device(ids.devices.tv, ids.rooms.living, 'tv', ['power', 'volume']),
    device(ids.devices.vacuum, ids.rooms.living, 'robot_vacuum', ['status', 'battery_percent', 'bin_full']),
    device(ids.devices.fridge, ids.rooms.kitchen, 'fridge', ['door_open', 'power_w']),
    device(ids.devices.stove, ids.rooms.kitchen, 'stove', ['power_w', 'level']),
    device(ids.devices.rangeHood, ids.rooms.kitchen, 'range_hood', ['speed']),
    device(ids.devices.kitchenAir, ids.rooms.kitchen, 'air_quality_sensor', ['pm25', 'co2']),
    device(ids.devices.adultSleep, ids.rooms.adultSleep, 'sleep_sensor', ['in_bed']),
    ...(ids.rooms.work && ids.devices.workLight && ids.devices.workAir && ids.devices.router
      ? [
          device(ids.devices.workLight, ids.rooms.work, 'light', ['power', 'brightness']),
          device(ids.devices.workAir, ids.rooms.work, 'air_quality_sensor', ['pm25', 'co2']),
          device(ids.devices.router, ids.rooms.work, 'router', ['online', 'latency_ms'])
        ]
      : []),
    ...(ids.rooms.childSleep && ids.devices.childSleep && ids.devices.childLight
      ? [
          device(ids.devices.childSleep, ids.rooms.childSleep, 'sleep_sensor', ['in_bed']),
          device(ids.devices.childLight, ids.rooms.childSleep, 'light', ['power', 'brightness'])
        ]
      : []),
    device(ids.devices.washer, ids.rooms.bathroom, 'washer', ['status', 'remaining_min', 'power_w']),
    device(ids.devices.waterFlow, ids.rooms.bathroom, 'water_flow_sensor', ['flow_l_min']),
    device(ids.devices.waterLeak, ids.rooms.bathroom, 'water_leak_sensor', ['leak_detected']),
    device(ids.devices.waterValve, ids.rooms.bathroom, 'water_valve', ['valve_open']),
    ...(ids.rooms.outdoor && ids.devices.gardenCamera && ids.devices.gardenSoil
      ? [
          device(ids.devices.gardenCamera, ids.rooms.outdoor, 'security_camera', ['motion', 'recording']),
          device(ids.devices.gardenSoil, ids.rooms.outdoor, 'soil_moisture_sensor', ['moisture_percent'])
        ]
      : [])
  ];
}

function device(id: string, roomId: string, type: string, metrics: string[]): DeviceDefinition {
  return {
    id,
    roomId,
    type,
    name: `Device ${id}`,
    metrics
  };
}

function createResidents(
  spec: HouseholdSpec,
  ids: TemplateIds,
  devices: DeviceDefinition[]
): PersonDefinition[] {
  const residents: PersonDefinition[] = [];
  let index = 1;
  const add = (
    role: ResidentRole,
    ageBand: ResidentAgeBand,
    kind: PersonDefinition['kind'],
    chronotype: ResidentChronotype,
    primaryRooms: string[]
  ) => {
    const id = `${spec.householdGroupId.replace('group_', 'g')}_p${index.toString().padStart(2, '0')}`;
    index += 1;
    residents.push({
      id,
      kind,
      role: `${role.replaceAll('_', ' ')} resident`,
      homeMember: true,
      profile: {
        role,
        ageBand,
        chronotype,
        sleepNeedHours: ageBand === 'child' ? 9.5 : ageBand === 'senior' ? 8.5 : ageBand === 'pet' ? 12 : 8,
        mealRegularity: ageBand === 'pet' ? 0.9 : 0.75,
        chorePreference: ageBand === 'child' || ageBand === 'pet' ? 0.2 : 0.6,
        riskSensitivity: ageBand === 'senior' ? 0.85 : 0.7,
        sociability: ageBand === 'pet' ? 0.8 : 0.65,
        mobility: ageBand === 'senior' ? 'steady' : 'active',
        primaryRooms,
        deviceFamiliarity: Object.fromEntries(devices.slice(0, kind === 'pet' ? 0 : 3).map((item, deviceIndex) => [
          item.id,
          Math.max(0.5, 0.9 - deviceIndex * 0.1)
        ])),
        careResponsibilities: []
      }
    });
  };

  for (let count = 0; count < spec.commuterCount; count += 1) {
    add('commuter', 'adult', 'human', spec.chronotype, [ids.rooms.adultSleep, ids.rooms.living, ids.rooms.kitchen]);
  }
  for (let count = 0; count < spec.remoteWorkerCount; count += 1) {
    add('remote_worker', 'adult', 'human', spec.chronotype, [
      ids.rooms.adultSleep,
      ids.rooms.work ?? ids.rooms.living,
      ids.rooms.kitchen
    ]);
  }
  for (let count = 0; count < spec.homeAdultCount; count += 1) {
    add('home_adult', 'adult', 'human', spec.chronotype, [ids.rooms.adultSleep, ids.rooms.living, ids.rooms.kitchen]);
  }
  for (let count = 0; count < spec.childCount; count += 1) {
    add('student', 'child', 'human', 'neutral', [ids.rooms.childSleep ?? ids.rooms.adultSleep, ids.rooms.living]);
  }
  for (let count = 0; count < spec.seniorCount; count += 1) {
    add('senior', 'senior', 'human', 'early', [ids.rooms.adultSleep, ids.rooms.living, ids.rooms.outdoor ?? ids.rooms.living]);
  }
  for (let count = 0; count < spec.petCount; count += 1) {
    add('pet', 'pet', 'pet', 'early', [ids.rooms.living, ids.rooms.outdoor ?? ids.rooms.living]);
  }

  const dependants = residents
    .filter((resident) => resident.profile?.ageBand === 'child' || resident.kind === 'pet')
    .map((resident) => resident.id);
  return residents.map((resident) => (
    resident.kind === 'human' && resident.profile?.ageBand === 'adult'
      ? {
          ...resident,
          profile: {
            ...resident.profile,
            careResponsibilities: [...dependants]
          }
        }
      : resident
  ));
}

function createHabits(
  spec: HouseholdSpec,
  ids: TemplateIds,
  residents: PersonDefinition[]
): HouseholdHabit[] {
  const habits: HouseholdHabit[] = [];
  for (const [index, resident] of residents.entries()) {
    const ageBand = resident.profile?.ageBand;
    const isPet = resident.kind === 'pet';
    const sleepRoom = ageBand === 'child'
      ? ids.rooms.childSleep ?? ids.rooms.adultSleep
      : isPet
        ? ids.rooms.living
        : ids.rooms.adultSleep;
    const wakeStart = ageBand === 'child' ? '06:35' : ageBand === 'senior' ? '06:00' : spec.chronotype === 'late' ? '07:20' : '06:25';
    const sleepStart = ageBand === 'child' ? '21:00' : ageBand === 'senior' ? '21:40' : isPet ? '22:10' : spec.chronotype === 'late' ? '23:15' : '22:30';
    habits.push(habit(`wake_${index}`, 'wake_up', [resident.id], 'daily', wakeStart, addMinutes(wakeStart, 20), sleepRoom));
    habits.push(habit(`sleep_${index}`, 'sleep', [resident.id], 'daily', sleepStart, addMinutes(sleepStart, 20), sleepRoom));

    if (resident.profile?.role === 'commuter') {
      habits.push(habit(`leave_${index}`, 'leave_home', [resident.id], 'workdays', '07:35', '07:55', undefined, 'departure'));
      habits.push(habit(`return_${index}`, 'return_home', [resident.id], 'workdays', '17:45', '18:15', undefined, 'arrival'));
    }
    if (resident.profile?.role === 'remote_worker') {
      habits.push(habit(`remote_${index}`, 'remote_work', [resident.id], 'workdays', '08:30', '09:00', ids.rooms.work));
    }
    if (ageBand === 'child') {
      habits.push(habit(`school_leave_${index}`, 'leave_home', [resident.id], 'schooldays', '07:30', '07:50', undefined, 'departure'));
      habits.push(habit(`school_return_${index}`, 'return_home', [resident.id], 'schooldays', '16:30', '17:00', undefined, 'arrival'));
    }
    if (isPet) {
      habits.push(habit(
        `pet_patrol_${index}`,
        'occupy_room',
        [resident.id],
        'daily',
        '08:20',
        '08:50',
        ids.rooms.outdoor ?? ids.rooms.living,
        undefined,
        0.8
      ));
    }
  }

  const humanIds = residents.filter((resident) => resident.kind === 'human').map((resident) => resident.id);
  const allResidentIds = residents.map((resident) => resident.id);
  if (humanIds.length > 0) {
    habits.push(habit('daily_meal', 'meal', humanIds, 'daily', '18:20', '18:50', undefined, 'dining'));
  }
  if (allResidentIds.length > 0) {
    habits.push(habit('shared_evening', 'occupy_room', allResidentIds, 'daily', '19:30', '20:00', undefined, 'family_time'));
  }
  return habits.map((item) => ({
    ...item,
    id: `${spec.householdGroupId}_${item.id}`
  }));
}

function habit(
  id: string,
  activity: string,
  residentIds: string[],
  recurrence: HouseholdHabit['recurrence'],
  start: string,
  end: string,
  roomId?: string,
  roomPurpose?: string,
  probability?: number
): HouseholdHabit {
  return {
    id,
    repertoire: 'core_household',
    activity,
    residentIds,
    recurrence,
    window: { start, end },
    ...(roomId ? { roomId } : {}),
    ...(roomPurpose ? { roomPurpose } : {}),
    ...(probability === undefined ? {} : { probability })
  };
}

function addMinutes(time: string, offset: number): string {
  const [hours, minutes] = time.split(':').map(Number);
  const total = hours * 60 + minutes + offset;
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}

function removeResidents(
  template: HouseholdTemplate,
  predicate: (resident: PersonDefinition) => boolean
): void {
  const removedIds = new Set(template.residents.filter(predicate).map((resident) => resident.id));
  template.residents = template.residents
    .filter((resident) => !removedIds.has(resident.id))
    .map((resident) => ({
      ...resident,
      ...(resident.profile
        ? {
            profile: {
              ...resident.profile,
              careResponsibilities: resident.profile.careResponsibilities.filter((id) => !removedIds.has(id))
            }
          }
        : {})
    }));
  template.habits = template.habits
    .map((habit) => ({
      ...habit,
      residentIds: habit.residentIds.filter((id) => !removedIds.has(id))
    }))
    .filter((habit) => habit.residentIds.length > 0);
}
