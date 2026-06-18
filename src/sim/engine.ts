import { getCatalog } from './catalog';
import { generateDailyScenario, type DailyScenarioOptions } from './dailyPlan';
import { SeededRandom } from './random';
import { getScenario, type ScenarioAction, type ScenarioDefinition } from './scenarios';
import type {
  AlertCreatedEvent,
  Catalog,
  DeviceDefinition,
  DeviceState,
  DeviceStateChangedEvent,
  DeviceTelemetryEvent,
  HomeMode,
  PersonMovedEvent,
  RoomId,
  ScenarioControlEvent,
  ScenarioId,
  StaticScenarioId,
  TwinEvent,
  TwinSnapshot
} from '../shared/types';

export interface SimulatorOptions {
  seed?: number;
  homeId?: string;
}

export interface VirtualHomeSimulator {
  startScenario(id: StaticScenarioId): TwinEvent[];
  startDailyScenario(options: DailyScenarioOptions): TwinEvent[];
  advanceMinutes(minutes: number): TwinEvent[];
  setPaused(paused: boolean): TwinEvent[];
  getSnapshot(): TwinSnapshot;
  getEvents(): TwinEvent[];
  injectAbnormality(kind: 'door_left_open' | 'fridge_left_open' | 'network_offline' | 'senior_no_activity'): TwinEvent[];
}

interface RuntimeState {
  catalog: Catalog;
  activeScenario: ScenarioDefinition;
  snapshot: TwinSnapshot;
  elapsedMinutes: number;
  emittedEvents: TwinEvent[];
  executedStepKeys: Set<string>;
  triggeredRules: Set<string>;
  random: SeededRandom;
}

const defaultDeviceState: Record<string, Record<string, string | number | boolean | null>> = {
  door_lock: { locked: true },
  motion_sensor: { motion: false, confidence: 0 },
  doorbell_camera: { motion: false, ringing: false, batteryPercent: 96 },
  package_sensor: { packagePresent: false, weightKg: 0 },
  light: { power: 'off', brightness: 0 },
  tv: { power: 'off', app: null, volume: 0 },
  robot_vacuum: { status: 'docked', batteryPercent: 100, binFull: false },
  curtain: { positionPercent: 35 },
  temperature_humidity_sensor: { temperatureC: 25, humidityPercent: 55 },
  fridge: { doorOpen: false, compressorOn: true, powerW: 90 },
  stove: { powerW: 0, level: 0 },
  range_hood: { power: 'off', speed: 0 },
  air_quality_sensor: { pm25: 8, co2: 520 },
  smoke_sensor: { smokeDetected: false, density: 0 },
  dishwasher: { status: 'idle', remainingMin: 0, powerW: 0 },
  sleep_sensor: { inBed: true, heartRateSimulated: 62 },
  air_conditioner: { power: 'off', targetC: 26, mode: 'auto' },
  router: { online: true, latencyMs: 18 },
  water_flow_sensor: { flowLMin: 0, totalL: 0 },
  water_leak_sensor: { leakDetected: false },
  water_valve: { valveOpen: true },
  washer: { status: 'idle', remainingMin: 0, powerW: 0 },
  soil_moisture_sensor: { moisturePercent: 38 },
  security_camera: { motion: false, recording: false },
  sprinkler: { valveOpen: false }
};

class Simulator implements VirtualHomeSimulator {
  private readonly homeId: string;
  private state: RuntimeState;

  constructor(options: SimulatorOptions = {}) {
    const catalog = getCatalog();
    const random = new SeededRandom(options.seed ?? 1);
    this.homeId = options.homeId ?? 'home_001';
    this.state = {
      catalog,
      activeScenario: getScenario('weekday_normal'),
      snapshot: this.createInitialSnapshot(catalog, 'weekday_normal', '2026-06-17T00:00:00+08:00', 'morning', 60),
      elapsedMinutes: 0,
      emittedEvents: [],
      executedStepKeys: new Set(),
      triggeredRules: new Set(),
      random
    };
  }

  startScenario(id: StaticScenarioId): TwinEvent[] {
    return this.startScenarioDefinition(getScenario(id), id);
  }

  startDailyScenario(options: DailyScenarioOptions): TwinEvent[] {
    const scenario = generateDailyScenario(options);
    return this.startScenarioDefinition(scenario, options.date);
  }

  private startScenarioDefinition(scenario: ScenarioDefinition, eventValue: string): TwinEvent[] {
    this.state = {
      catalog: getCatalog(),
      activeScenario: scenario,
      snapshot: this.createInitialSnapshot(getCatalog(), scenario.id, scenario.startTime, scenario.initialMode, scenario.speed),
      elapsedMinutes: 0,
      emittedEvents: [],
      executedStepKeys: new Set(),
      triggeredRules: new Set(),
      random: this.state.random
    };

    for (const [personId, person] of Object.entries(scenario.initialPeople)) {
      this.state.snapshot.people[personId].location = person.location;
      this.state.snapshot.people[personId].activity = person.activity;
    }
    this.rebuildRooms();
    this.updateOccupancy();
    return [this.createScenarioEvent('start', eventValue)];
  }

  advanceMinutes(minutes: number): TwinEvent[] {
    if (this.state.snapshot.simClock.paused) {
      return [];
    }
    const emitted: TwinEvent[] = [];
    for (let index = 0; index < minutes; index += 1) {
      this.state.elapsedMinutes += 1;
      this.advanceClockOneMinute();
      emitted.push(...this.runDueScenarioSteps());
      this.rebuildRooms();
      this.updateOccupancy();
      emitted.push(...this.applyAmbientDynamics());
      this.rebuildRooms();
      this.updateOccupancy();
      emitted.push(...this.applyRules());
      emitted.push(...this.generateTelemetry());
      this.rebuildRooms();
      this.updateOccupancy();
    }
    this.state.emittedEvents.push(...emitted);
    return emitted;
  }

  setPaused(paused: boolean): TwinEvent[] {
    this.state.snapshot.simClock.paused = paused;
    const event = this.createScenarioEvent(paused ? 'pause' : 'resume', paused);
    this.state.emittedEvents.push(event);
    return [event];
  }

  getSnapshot(): TwinSnapshot {
    return structuredClone(this.state.snapshot);
  }

  getEvents(): TwinEvent[] {
    return structuredClone(this.state.emittedEvents);
  }

  injectAbnormality(kind: 'door_left_open' | 'fridge_left_open' | 'network_offline' | 'senior_no_activity'): TwinEvent[] {
    const alertMap = {
      door_left_open: ['door_left_open_001', 'warning', 'entrance', 'Front door has remained open', 'check_front_door'],
      fridge_left_open: ['fridge_left_open_001', 'warning', 'kitchen', 'Fridge door has remained open', 'close_fridge_door'],
      network_offline: ['network_offline_001', 'warning', 'study', 'Home network is offline', 'restart_router'],
      senior_no_activity: ['senior_no_activity_001', 'info', 'master_bedroom', 'Senior has no morning activity yet', 'check_in_with_senior']
    } as const;
    const [alertId, severity, roomId, message, recommendedAction] = alertMap[kind];
    const event = this.createAlertEvent(alertId, severity, roomId, message, recommendedAction, `manual_injection:${kind}`);
    this.state.emittedEvents.push(event);
    return [event];
  }

  private createInitialSnapshot(catalog: Catalog, scenarioId: ScenarioId, startTime: string, mode: HomeMode, speed: number): TwinSnapshot {
    const devices = Object.fromEntries(catalog.devices.map((device) => [device.id, this.createDeviceState(device)]));
    const rooms = catalog.rooms.reduce<TwinSnapshot['rooms']>((roomMap, room) => {
      roomMap[room.id] = {
        id: room.id,
        name: room.name,
        occupancy: false,
        people: [],
        temperatureC: room.id === 'garden' ? 21 : 25,
        humidityPercent: room.id === 'bathroom' ? 65 : 52,
        lightsOn: false,
        activeDevices: []
      };
      return roomMap;
    }, {} as TwinSnapshot['rooms']);
    const people = Object.fromEntries(catalog.people.map((person) => [
      person.id,
      {
        id: person.id,
        kind: person.kind,
        location: person.kind === 'pet' ? 'living_room' : 'master_bedroom',
        activity: 'idle',
        confidence: 0.9,
        privacyMode: true
      }
    ])) as TwinSnapshot['people'];

    return {
      homeId: this.homeId,
      scenarioId,
      simClock: {
        currentTime: startTime,
        speed,
        paused: false,
        sequence: 0
      },
      homeState: {
        occupancyCount: 0,
        mode,
        securityMode: 'disarmed'
      },
      rooms,
      people,
      devices,
      activities: {},
      alerts: {}
    };
  }

  private createDeviceState(device: DeviceDefinition): DeviceState {
    return {
      id: device.id,
      roomId: device.roomId,
      type: device.type,
      state: { ...(defaultDeviceState[device.type] ?? {}) },
      lastReason: 'initial'
    };
  }

  private runDueScenarioSteps(): TwinEvent[] {
    const scenario = this.state.activeScenario;
    const events: TwinEvent[] = [];
    for (const step of scenario.steps) {
      const key = `${scenario.id}:${step.minute}`;
      if (step.minute <= this.state.elapsedMinutes && !this.state.executedStepKeys.has(key)) {
        this.state.executedStepKeys.add(key);
        for (const action of step.actions) {
          events.push(...this.applyAction(action));
        }
      }
    }
    return events;
  }

  private applyAmbientDynamics(): TwinEvent[] {
    const events: TwinEvent[] = [];
    events.push(...this.movePetAroundHome());
    events.push(...this.advanceApplianceCycles());
    this.rebuildRooms();
    events.push(...this.syncMotionSensors());
    events.push(...this.syncSecurityCameras());
    events.push(...this.applyRandomHouseholdEvents());
    return events;
  }

  private advanceApplianceCycles(): TwinEvent[] {
    const events: TwinEvent[] = [];
    events.push(...this.advanceTimedDevice('dishwasher_01', 'dishwasher_cycle_done', 'Dishwasher cycle completed', 'empty_dishwasher'));
    events.push(...this.advanceTimedDevice('washer_01', 'washer_cycle_done', 'Washing machine cycle completed', 'move_laundry_to_dryer'));
    return events;
  }

  private advanceTimedDevice(deviceId: string, alertId: string, message: string, recommendedAction: string): TwinEvent[] {
    const device = this.state.snapshot.devices[deviceId];
    if (!device || device.state.status !== 'running') {
      return [];
    }

    const remainingMin = Math.max(0, Number(device.state.remainingMin ?? 0) - 1);
    if (remainingMin > 0) {
      const event = this.setDeviceStateIfChanged(deviceId, { remainingMin }, `ambient:${device.type}:countdown`);
      return event ? [event] : [];
    }

    return [
      this.setDeviceState(deviceId, { status: 'done', remainingMin: 0, powerW: 3 }, `ambient:${device.type}:done`),
      this.createAlertEvent(alertId, 'info', device.roomId, message, recommendedAction, `device:${deviceId}:done`)
    ];
  }

  private movePetAroundHome(): TwinEvent[] {
    const pet = this.state.snapshot.people.pet_1;
    if (!pet || pet.location === 'away') {
      return [];
    }

    const interval = this.state.snapshot.homeState.mode === 'sleeping' ? 17 : 7;
    if (this.state.elapsedMinutes % interval !== 0) {
      return [];
    }

    const destinations: RoomId[] = ['living_room', 'kitchen', 'dining_room', 'garden', 'master_bedroom'];
    const candidates = destinations.filter((roomId) => roomId !== pet.location);
    const to = candidates[Math.floor(this.state.random.range(0, candidates.length))] ?? 'living_room';
    const activities = ['wandering', 'sniffing', 'resting', 'checking_room'];
    const activity = activities[Math.floor(this.state.random.range(0, activities.length))] ?? 'wandering';
    const event = this.createPersonMovedEvent('pet_1', pet.location, to, activity);
    pet.location = to;
    pet.activity = activity;
    return [event];
  }

  private syncMotionSensors(): TwinEvent[] {
    const events: TwinEvent[] = [];
    const sensors: Array<{ deviceId: string; roomId: RoomId }> = [
      { deviceId: 'entrance_motion_01', roomId: 'entrance' },
      { deviceId: 'living_motion_01', roomId: 'living_room' }
    ];

    for (const sensor of sensors) {
      const room = this.state.snapshot.rooms[sensor.roomId];
      const patch = {
        motion: room.occupancy,
        confidence: room.occupancy ? 0.84 : 0
      };
      const event = this.setDeviceStateIfChanged(sensor.deviceId, patch, `ambient:motion:${sensor.roomId}`);
      if (event) {
        events.push(event);
      }
    }

    return events;
  }

  private syncSecurityCameras(): TwinEvent[] {
    const events: TwinEvent[] = [];
    const entranceOccupied = this.state.snapshot.rooms.entrance.occupancy;
    const gardenOccupied = this.state.snapshot.rooms.garden.occupancy;
    const doorbellEvent = this.setDeviceStateIfChanged('doorbell_camera_01', {
      motion: entranceOccupied,
      ringing: false
    }, 'ambient:camera:entrance_motion');
    if (doorbellEvent) {
      events.push(doorbellEvent);
    }
    const gardenEvent = this.setDeviceStateIfChanged('garden_camera_01', {
      motion: gardenOccupied,
      recording: gardenOccupied
    }, 'ambient:camera:garden_motion');
    if (gardenEvent) {
      events.push(gardenEvent);
    }
    return events;
  }

  private applyRandomHouseholdEvents(): TwinEvent[] {
    const events: TwinEvent[] = [];
    events.push(...this.maybeDeliverPackage());
    events.push(...this.maybeStartRobotCleaning());
    events.push(...this.maybeStartDishwasher());
    events.push(...this.maybeStartWasher());
    events.push(...this.maybeNetworkJitter());
    return events;
  }

  private maybeDeliverPackage(): TwinEvent[] {
    if (this.state.triggeredRules.has('package_delivery') || this.state.elapsedMinutes < 45 || this.state.elapsedMinutes > 420) {
      return [];
    }
    if (this.state.random.next() >= 0.018) {
      return [];
    }

    this.state.triggeredRules.add('package_delivery');
    return [
      this.setDeviceState('doorbell_camera_01', { motion: true, ringing: true }, 'random:package_delivery'),
      this.setDeviceState('package_sensor_01', {
        packagePresent: true,
        weightKg: this.round(this.state.random.range(0.4, 3.6))
      }, 'random:package_delivery'),
      this.createAlertEvent('package_delivery_001', 'info', 'entrance', 'Package delivered at the front door', 'bring_package_inside', 'random:package_delivery'),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'package_delivery',
        explanation: 'Doorbell camera and package sensor detected a delivery.',
        actions: ['ring_doorbell_camera', 'mark_package_present', 'notify_household'],
        reason: 'random:delivery'
      })
    ];
  }

  private maybeStartRobotCleaning(): TwinEvent[] {
    const vacuum = this.state.snapshot.devices.robot_vacuum_01;
    if (this.state.triggeredRules.has('robot_cleaning') || this.state.elapsedMinutes < 90 || this.state.elapsedMinutes > 540 || vacuum.state.status !== 'docked') {
      return [];
    }
    if (this.state.snapshot.homeState.mode === 'sleeping' || this.state.random.next() >= 0.014) {
      return [];
    }

    this.state.triggeredRules.add('robot_cleaning');
    const stuck = this.state.random.next() < 0.22;
    const events: TwinEvent[] = [
      this.setDeviceState('robot_vacuum_01', {
        status: stuck ? 'stuck' : 'cleaning',
        batteryPercent: stuck ? 78 : 92,
        binFull: false
      }, stuck ? 'random:robot_stuck' : 'random:robot_cleaning'),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'robot_cleaning',
        explanation: stuck ? 'Robot vacuum started but reported it is stuck.' : 'Robot vacuum started a daytime cleaning run.',
        actions: stuck ? ['pause_robot_vacuum', 'raise_robot_help_alert'] : ['start_robot_vacuum'],
        reason: stuck ? 'random:robot_stuck' : 'random:cleaning'
      })
    ];
    if (stuck) {
      events.push(this.createAlertEvent('robot_vacuum_stuck_001', 'warning', 'living_room', 'Robot vacuum needs help in the living room', 'clear_robot_path', 'random:robot_stuck'));
    }
    return events;
  }

  private maybeStartDishwasher(): TwinEvent[] {
    const dishwasher = this.state.snapshot.devices.dishwasher_01;
    const dinnerDone = !this.state.snapshot.activities.family_dinner && this.state.elapsedMinutes > 760;
    const breakfastDone = !this.state.snapshot.activities.breakfast && this.state.elapsedMinutes > 85;
    if (this.state.triggeredRules.has('dishwasher_cycle') || dishwasher.state.status !== 'idle' || (!breakfastDone && !dinnerDone)) {
      return [];
    }
    if (this.state.random.next() >= 0.02) {
      return [];
    }

    this.state.triggeredRules.add('dishwasher_cycle');
    return [
      this.setDeviceState('dishwasher_01', { status: 'running', remainingMin: 45, powerW: 620 }, 'random:dishwasher_cycle'),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'dishwasher_cycle',
        explanation: 'Recent meal activity made the dishwasher likely to run.',
        actions: ['start_dishwasher_cycle'],
        reason: 'random:post_meal_cleanup'
      })
    ];
  }

  private maybeStartWasher(): TwinEvent[] {
    const washer = this.state.snapshot.devices.washer_01;
    const humansHome = Object.values(this.state.snapshot.people).some((person) => person.kind === 'human' && person.location !== 'away');
    if (this.state.triggeredRules.has('washer_cycle') || washer.state.status !== 'idle' || !humansHome || this.state.elapsedMinutes < 180 || this.state.elapsedMinutes > 780) {
      return [];
    }
    if (this.state.random.next() >= 0.012) {
      return [];
    }

    this.state.triggeredRules.add('washer_cycle');
    return [
      this.setDeviceState('washer_01', { status: 'running', remainingMin: 55, powerW: 480 }, 'random:washer_cycle'),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'washer_cycle',
        explanation: 'Household routine started a washing machine cycle.',
        actions: ['start_washer_cycle'],
        reason: 'random:laundry'
      })
    ];
  }

  private maybeNetworkJitter(): TwinEvent[] {
    const router = this.state.snapshot.devices.router_01;
    if (this.state.triggeredRules.has('network_jitter') || router.state.online !== true || this.state.elapsedMinutes < 60) {
      return [];
    }
    if (this.state.random.next() >= 0.01) {
      return [];
    }

    this.state.triggeredRules.add('network_jitter');
    return [
      this.setDeviceState('router_01', { online: true, latencyMs: 145 }, 'random:network_jitter'),
      this.createAlertEvent('network_jitter_001', 'warning', 'study', 'Home network latency is elevated', 'check_router', 'random:network_jitter'),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'network_jitter',
        explanation: 'Router telemetry reported elevated latency.',
        actions: ['notify_network_jitter'],
        reason: 'random:router_latency'
      })
    ];
  }

  private applyAction(action: ScenarioAction): TwinEvent[] {
    if (action.kind === 'movePerson') {
      const person = this.state.snapshot.people[action.personId];
      const event = this.createPersonMovedEvent(action.personId, person.location, action.to, action.activity);
      person.location = action.to;
      person.activity = action.activity;
      return [event];
    }

    if (action.kind === 'setHomeMode') {
      this.state.snapshot.homeState.mode = action.mode;
      return [];
    }

    if (action.kind === 'setDevice') {
      return [this.setDeviceState(action.deviceId, action.state, action.reason)];
    }

    if (action.kind === 'startActivity') {
      this.state.snapshot.activities[action.activityId] = {
        activityId: action.activityId,
        participants: action.participants,
        roomId: action.roomId,
        startedAt: this.state.snapshot.simClock.currentTime
      };
      return [this.createEvent({
        type: 'ActivityStarted',
        activityId: action.activityId,
        participants: action.participants,
        roomId: action.roomId,
        reason: action.reason
      })];
    }

    if (action.kind === 'endActivity') {
      const activity = this.state.snapshot.activities[action.activityId];
      delete this.state.snapshot.activities[action.activityId];
      if (!activity) {
        return [];
      }
      return [this.createEvent({
        type: 'ActivityEnded',
        activityId: action.activityId,
        participants: activity.participants,
        roomId: activity.roomId,
        reason: action.reason
      })];
    }

    if (action.kind === 'createAlert') {
      return [this.createAlertEvent(action.alertId, action.severity, action.roomId, action.message, action.recommendedAction, action.reason)];
    }

    return [];
  }

  private applyRules(): TwinEvent[] {
    const events: TwinEvent[] = [];
    const snapshot = this.state.snapshot;
    const humansHome = Object.values(snapshot.people).filter((person) => person.kind === 'human' && person.location !== 'away').length;
    const doorLocked = snapshot.devices.door_lock_01.state.locked === true;
    if (snapshot.homeState.mode === 'sleeping' && !this.state.triggeredRules.has('sleep_mode')) {
      this.state.triggeredRules.add('sleep_mode');
      events.push(this.setDeviceState('living_light_01', { power: 'off', brightness: 0 }, 'rule:sleep_mode'));
      events.push(this.setDeviceState('tv_01', { power: 'off', app: null, volume: 0 }, 'rule:sleep_mode'));
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'sleep_mode',
        explanation: 'The household is sleeping, so shared room devices are quieted.',
        actions: ['turn_off_living_light', 'turn_off_tv', 'keep_bedrooms_quiet'],
        reason: 'home_mode:sleeping'
      }));
    }

    if (
      snapshot.rooms.kitchen.occupancy &&
      Number(snapshot.devices.stove_01.state.powerW ?? 0) > 500 &&
      !this.state.triggeredRules.has('cooking_ventilation')
    ) {
      this.state.triggeredRules.add('cooking_ventilation');
      events.push(this.setDeviceState('range_hood_01', { power: 'on', speed: 2 }, 'rule:cooking_ventilation'));
      events.push(this.setDeviceState('kitchen_light_01', { power: 'on', brightness: 80 }, 'rule:cooking_ventilation'));
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'cooking_ventilation',
        explanation: 'Kitchen occupancy and stove power indicate cooking.',
        actions: ['turn_on_range_hood', 'turn_on_kitchen_light'],
        reason: 'kitchen_occupied_and_stove_power'
      }));
    }

    if (
      Number(snapshot.devices.stove_01.state.powerW ?? 0) > 1000 &&
      !snapshot.rooms.kitchen.occupancy &&
      !this.state.triggeredRules.has('stove_unattended_safety')
    ) {
      this.state.triggeredRules.add('stove_unattended_safety');
      events.push(this.setDeviceState('stove_01', { powerW: 0, level: 0 }, 'rule:stove_unattended_safety'));
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'stove_unattended_safety',
        explanation: 'The stove was drawing high power while the kitchen was empty.',
        actions: ['turn_off_stove', 'raise_warning'],
        reason: 'stove_power_without_kitchen_occupancy'
      }));
    }

    if (humansHome === 0 && doorLocked && snapshot.homeState.mode !== 'away' && !this.state.triggeredRules.has('away_mode')) {
      this.state.triggeredRules.add('away_mode');
      snapshot.homeState.mode = 'away';
      snapshot.homeState.securityMode = 'armed';
      events.push(this.setDeviceState('living_light_01', { power: 'off', brightness: 0 }, 'rule:away_mode'));
      events.push(this.setDeviceState('tv_01', { power: 'off', app: null, volume: 0 }, 'rule:away_mode'));
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'away_mode',
        explanation: 'All human family members are away and the front door is locked.',
        actions: ['set_home_mode:away', 'arm_security', 'turn_off_lights', 'turn_off_tv'],
        reason: 'occupancy_count:0'
      }));
    }

    if (
      snapshot.devices.water_leak_01.state.leakDetected === true &&
      snapshot.devices.water_valve_01.state.valveOpen !== false &&
      !this.state.triggeredRules.has('close_water_valve_on_leak')
    ) {
      this.state.triggeredRules.add('close_water_valve_on_leak');
      snapshot.homeState.mode = 'alert';
      events.push(this.setDeviceState('water_valve_01', { valveOpen: false }, 'rule:close_water_valve_on_leak'));
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'close_water_valve_on_leak',
        explanation: 'Bathroom leak sensor is active while the home is sleeping.',
        actions: ['close_water_valve', 'raise_high_alert'],
        reason: 'water_leak_sensor:true'
      }));
    }

    return events;
  }

  private generateTelemetry(): TwinEvent[] {
    const events: TwinEvent[] = [];
    for (const device of this.state.catalog.devices) {
      if (!['temperature_humidity_sensor', 'air_quality_sensor', 'water_flow_sensor', 'soil_moisture_sensor'].includes(device.type)) {
        continue;
      }
      const state = this.state.snapshot.devices[device.id].state;
      const measurements: Record<string, number | boolean> = {};
      if (device.type === 'temperature_humidity_sensor') {
        const room = this.state.snapshot.rooms[device.roomId];
        const roomOccupied = room.people.length > 0;
        const stoveHeat = device.roomId === 'kitchen' ? Number(this.state.snapshot.devices.stove_01.state.powerW ?? 0) / 9000 : 0;
        const temperatureC = this.round(this.clamp((Number(state.temperatureC) || 25) + this.state.random.range(-0.12, 0.18) + (roomOccupied ? 0.03 : -0.02) + stoveHeat, 17, 31));
        const humidityPercent = this.round(this.clamp((Number(state.humidityPercent) || 55) + this.state.random.range(-0.25, 0.35) + (roomOccupied ? 0.04 : -0.03), 35, 78));
        state.temperatureC = temperatureC;
        state.humidityPercent = humidityPercent;
        room.temperatureC = temperatureC;
        room.humidityPercent = humidityPercent;
        measurements.temperature_c = temperatureC;
        measurements.humidity_percent = humidityPercent;
      } else if (device.type === 'air_quality_sensor') {
        const cooking = this.state.snapshot.activities.breakfast || this.state.snapshot.activities.cooking_dinner;
        const occupancy = this.state.snapshot.rooms[device.roomId].people.length;
        const pm25 = this.round(this.clamp((cooking ? 18 : 8) + this.state.random.range(-1, 1), 2, 60));
        const co2 = this.round(this.clamp((cooking ? 690 : 530) + occupancy * 42 + this.state.random.range(-8, 8), 420, 1200));
        state.pm25 = pm25;
        state.co2 = co2;
        measurements.pm25 = pm25;
        measurements.co2 = co2;
      } else if (device.type === 'water_flow_sensor') {
        const roomOccupied = this.state.snapshot.rooms[device.roomId].occupancy;
        const leakActive = this.state.snapshot.devices.water_leak_01.state.leakDetected === true;
        const valveOpen = this.state.snapshot.devices.water_valve_01.state.valveOpen !== false;
        const currentFlow = Number(state.flowLMin) || 0;
        const nextFlow = leakActive && valveOpen
          ? currentFlow
          : this.clamp(currentFlow + (roomOccupied ? this.state.random.range(-0.15, 0.08) : -0.7), 0, 12);
        const flowLMin = this.round(nextFlow);
        const totalL = this.round((Number(state.totalL) || 0) + flowLMin);
        state.flowLMin = flowLMin;
        state.totalL = totalL;
        measurements.flow_l_min = flowLMin;
        measurements.total_l = totalL;
      } else if (device.type === 'soil_moisture_sensor') {
        const sprinklerOn = this.state.snapshot.devices.sprinkler_01.state.valveOpen === true;
        const moisturePercent = this.round(this.clamp((Number(state.moisturePercent) || 38) + (sprinklerOn ? 0.55 : -0.03) + this.state.random.range(-0.04, 0.04), 20, 75));
        state.moisturePercent = moisturePercent;
        measurements.moisture_percent = moisturePercent;
      }
      events.push(this.createEvent({
        type: 'DeviceTelemetry',
        roomId: device.roomId,
        deviceId: device.id,
        deviceType: device.type,
        measurements
      }));
    }
    return events;
  }

  private setDeviceState(deviceId: string, patch: Record<string, string | number | boolean | null>, reason: string): DeviceStateChangedEvent {
    const device = this.state.snapshot.devices[deviceId];
    device.state = { ...device.state, ...patch };
    device.lastReason = reason;
    return this.createEvent({
      type: 'DeviceStateChanged',
      roomId: device.roomId,
      deviceId,
      deviceType: device.type,
      state: device.state,
      reason
    });
  }

  private setDeviceStateIfChanged(deviceId: string, patch: Record<string, string | number | boolean | null>, reason: string): DeviceStateChangedEvent | null {
    const device = this.state.snapshot.devices[deviceId];
    const changed = Object.entries(patch).some(([key, value]) => device.state[key] !== value);
    if (!changed) {
      return null;
    }
    return this.setDeviceState(deviceId, patch, reason);
  }

  private createAlertEvent(alertId: string, severity: 'info' | 'warning' | 'high', roomId: RoomId, message: string, recommendedAction: string, reason: string): AlertCreatedEvent {
    this.state.snapshot.alerts[alertId] = {
      id: alertId,
      severity,
      roomId,
      message,
      recommendedAction,
      createdAt: this.state.snapshot.simClock.currentTime
    };
    return this.createEvent({
      type: 'AlertCreated',
      alertId,
      severity,
      roomId,
      message,
      recommendedAction,
      reason
    });
  }

  private createPersonMovedEvent(personId: string, from: RoomId | 'away', to: RoomId | 'away', activity: string): PersonMovedEvent {
    return this.createEvent({
      type: 'PersonMoved',
      personId,
      from,
      to,
      activity,
      reason: `activity:${activity}`
    });
  }

  private createScenarioEvent(command: ScenarioControlEvent['command'], value: string | number | boolean): ScenarioControlEvent {
    return this.createEvent({
      type: 'ScenarioControl',
      command,
      value,
      reason: `scenario:${value}`
    });
  }

  private createEvent<T extends Omit<TwinEvent, 'id' | 'ts' | 'simTime' | 'homeId' | 'scenarioId' | 'sequence'>>(event: T): T & {
    id: string;
    ts: string;
    simTime: string;
    homeId: string;
    scenarioId: string;
    sequence: number;
  } {
    this.state.snapshot.simClock.sequence += 1;
    const sequence = this.state.snapshot.simClock.sequence;
    return {
      ...event,
      id: `evt_${String(sequence).padStart(6, '0')}`,
      ts: this.state.snapshot.simClock.currentTime,
      simTime: this.state.snapshot.simClock.currentTime,
      homeId: this.homeId,
      scenarioId: this.state.snapshot.scenarioId,
      sequence
    };
  }

  private rebuildRooms(): void {
    for (const room of Object.values(this.state.snapshot.rooms)) {
      room.people = [];
      room.activeDevices = [];
      room.occupancy = false;
      room.lightsOn = false;
    }
    for (const person of Object.values(this.state.snapshot.people)) {
      if (person.location !== 'away') {
        this.state.snapshot.rooms[person.location].people.push(person.id);
      }
    }
    for (const device of Object.values(this.state.snapshot.devices)) {
      const room = this.state.snapshot.rooms[device.roomId];
      if (device.state.power === 'on' || device.state.locked === false || device.state.valveOpen === true || Number(device.state.powerW ?? 0) > 0) {
        room.activeDevices.push(device.id);
      }
      if (device.type === 'light' && device.state.power === 'on') {
        room.lightsOn = true;
      }
    }
    for (const room of Object.values(this.state.snapshot.rooms)) {
      room.occupancy = room.people.length > 0;
    }
  }

  private updateOccupancy(): void {
    this.state.snapshot.homeState.occupancyCount = Object.values(this.state.snapshot.people)
      .filter((person) => person.kind === 'human' && person.location !== 'away')
      .length;
  }

  private advanceClockOneMinute(): void {
    const current = new Date(this.state.snapshot.simClock.currentTime);
    current.setMinutes(current.getMinutes() + 1);
    this.state.snapshot.simClock.currentTime = formatShanghaiTime(current);
  }

  private round(value: number): number {
    return Math.round(value * 10) / 10;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}

export function createSimulator(options?: SimulatorOptions): VirtualHomeSimulator {
  return new Simulator(options);
}

function formatShanghaiTime(value: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}
