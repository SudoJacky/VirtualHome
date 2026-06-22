import { createCatalogFromHomeDefinition, getHomeDefinition } from './catalog';
import { generateDailyScenario, type DailyScenarioOptions } from './dailyPlan';
import { randomUUID } from 'node:crypto';
import { SeededRandom } from './random';
import { getScenario, type ScenarioAction, type ScenarioDefinition } from './scenarios';
import { getDeviceCapability, validateDeviceStatePatch } from '../shared/deviceRegistry';
import { getDeviceSupportedCommands } from '../shared/deviceInstanceCapabilities';
import { getSensorProfile, withSensorProfileOverrides } from './sensors/deviceProfiles';
import { observeBinarySensor, observeContactSensor, observeEnvironmentSensor, observeMotionSensor, observeNumericSensor, type SensorObservation } from './sensors/sensorModel';
import { selectActivity } from './agents/agentPolicy';
import { advanceNeeds, applyActivityEffectsToNeeds, createInitialNeeds, type NeedState } from './agents/needs';
import { commitmentPressureAtMinute, createDailyCommitments } from './agents/scheduler';
import { getPersona } from './personas/defaultFamily';
import { applyActivityToInventory, createInitialInventory, resourcesFromInventory } from './world/inventory';
import { getDefaultHouseholdObjects } from './world/objects';
import { createConversationDraft } from './social/conversationEvents';
import { coordinateHousehold, type HouseholdSocialContext, type SocialDecision } from './social/householdCoordinator';
import type {
  AbnormalityInjectedEvent,
  AlertCreatedEvent,
  AlertLifecycleStatus,
  Catalog,
  DeviceDefinition,
  DeviceState,
  DeviceStateChangedEvent,
  DeviceTelemetryEvent,
  EventObservability,
  EventSourceLayer,
  HomeMode,
  ObjectMovedEvent,
  PersonMovedEvent,
  RoomId,
  ScenarioControlEvent,
  ScenarioId,
  StaticScenarioId,
  RunContext,
  RuleRecoveredEvent,
  TwinEvent,
  TwinSnapshot,
  HomeDefinition
} from '../shared/types';

export interface SimulatorOptions {
  seed?: number;
  homeId?: string;
  homeDefinition?: HomeDefinition;
}

export interface VirtualHomeSimulator {
  startScenario(id: StaticScenarioId): TwinEvent[];
  startDailyScenario(options: DailyScenarioOptions): TwinEvent[];
  restore(snapshot: TwinSnapshot, events: TwinEvent[]): void;
  advanceMinutes(minutes: number): TwinEvent[];
  setPaused(paused: boolean): TwinEvent[];
  getSnapshot(): TwinSnapshot;
  getEvents(): TwinEvent[];
  injectAbnormality(kind: 'door_left_open' | 'fridge_left_open' | 'network_offline' | 'senior_no_activity'): TwinEvent[];
  resolveAbnormality(kind: 'door_left_open' | 'fridge_left_open' | 'network_offline' | 'senior_no_activity'): TwinEvent[];
  setAlertStatus(alertId: string, status: AlertLifecycleStatus): TwinEvent[] | null;
  commandDevice(deviceId: string, command: string, value?: string | number | boolean | null): TwinEvent[] | null;
}

type RuleLifecycleStatus = 'active' | 'cooldown';

interface RuleLifecycleState {
  status: RuleLifecycleStatus;
  cooldownUntilMinute: number;
}

type RuntimeEventKey = 'id' | 'runId' | 'ts' | 'simTime' | 'homeId' | 'scenarioId' | 'sequence' | 'sourceLayer' | 'lineage';
type TwinEventDraft = TwinEvent extends infer Event
  ? Event extends TwinEvent
    ? Omit<Event, RuntimeEventKey> & Partial<Pick<TwinEvent, 'sourceLayer' | 'lineage'>>
    : never
  : never;

interface RuntimeState {
  catalog: Catalog;
  activeScenario: ScenarioDefinition;
  snapshot: TwinSnapshot;
  elapsedMinutes: number;
  emittedEvents: TwinEvent[];
  executedStepKeys: Set<string>;
  profileLitRooms: Set<RoomId>;
  sensorObservations: Map<string, Record<string, unknown>>;
  personNeeds: Map<string, NeedState>;
  triggeredRules: Set<string>;
  ruleStates: Map<string, RuleLifecycleState>;
  random: SeededRandom;
}

interface BehaviorProfile {
  role: 'commuter' | 'remote_worker' | 'student' | 'senior' | 'pet';
  preferredRooms: RoomId[];
  activeLightLevel: number;
}

const behaviorProfiles: Record<string, BehaviorProfile> = {
  adult_1: { role: 'commuter', preferredRooms: ['bathroom', 'kitchen', 'entrance', 'living_room'], activeLightLevel: 68 },
  adult_2: { role: 'remote_worker', preferredRooms: ['study', 'kitchen', 'living_room'], activeLightLevel: 62 },
  child_1: { role: 'student', preferredRooms: ['child_bedroom', 'kitchen', 'living_room'], activeLightLevel: 70 },
  senior_1: { role: 'senior', preferredRooms: ['master_bedroom', 'dining_room', 'living_room', 'garden'], activeLightLevel: 74 },
  pet_1: { role: 'pet', preferredRooms: ['living_room', 'garden', 'kitchen', 'master_bedroom'], activeLightLevel: 0 }
};

const roomLightDevices: Partial<Record<RoomId, string>> = {
  dining_room: 'dining_light_01',
  kitchen: 'kitchen_light_01',
  living_room: 'living_light_01'
};

const ruleCooldownMinutes = 5;

export const alertEscalationPolicies = {
  door_left_open: {
    alertId: 'door_left_open_001',
    initialSeverity: 'warning',
    recommendedAction: 'check_front_door'
  },
  fridge_left_open: {
    alertId: 'fridge_left_open_001',
    initialSeverity: 'warning',
    recommendedAction: 'close_fridge_door',
    deviceId: 'fridge_01',
    highSeverityAfterOpenMinutes: 5,
    lifecyclePhase: 'alert'
  },
  network_offline: {
    alertId: 'network_offline_001',
    initialSeverity: 'warning',
    recommendedAction: 'restart_router'
  },
  senior_no_activity: {
    alertId: 'senior_no_activity_001',
    initialSeverity: 'info',
    recommendedAction: 'check_in_with_senior'
  }
} as const;

class Simulator implements VirtualHomeSimulator {
  private readonly homeId: string;
  private readonly baseSeed: number;
  private readonly homeDefinition: HomeDefinition;
  private state: RuntimeState;

  constructor(options: SimulatorOptions = {}) {
    this.homeDefinition = structuredClone(options.homeDefinition ?? getHomeDefinition());
    const catalog = createCatalogFromHomeDefinition(this.homeDefinition);
    this.baseSeed = options.seed ?? 1;
    const random = new SeededRandom(this.baseSeed);
    this.homeId = options.homeId ?? this.homeDefinition.building.id;
    const runContext = this.createRunContext(this.baseSeed, '2026-06-17T00:00:00+08:00', random);
    this.state = {
      catalog,
      activeScenario: getScenario('weekday_normal'),
      snapshot: this.createInitialSnapshot(catalog, 'weekday_normal', '2026-06-17T00:00:00+08:00', 'morning', 60, runContext),
      elapsedMinutes: 0,
      emittedEvents: [],
      executedStepKeys: new Set(),
      profileLitRooms: new Set(),
      sensorObservations: new Map(),
      personNeeds: createRuntimePersonNeeds(this.createInitialSnapshot(catalog, 'weekday_normal', '2026-06-17T00:00:00+08:00', 'morning', 60, runContext)),
      triggeredRules: new Set(),
      ruleStates: new Map(),
      random
    };
  }

  startScenario(id: StaticScenarioId): TwinEvent[] {
    return this.startScenarioDefinition(getScenario(id), id, this.baseSeed);
  }

  startDailyScenario(options: DailyScenarioOptions): TwinEvent[] {
    const scenario = generateDailyScenario(options);
    return this.startScenarioDefinition(scenario, options.date, options.seed ?? seedFromDate(options.date));
  }

  restore(snapshot: TwinSnapshot, events: TwinEvent[]): void {
    const catalog = createCatalogFromHomeDefinition(this.homeDefinition);
    const activeScenario = getScenarioForSnapshot(snapshot);
    const restoredSnapshot = structuredClone(snapshot);
    restoredSnapshot.worldState.objectLocations ??= createInitialObjectLocations();
    const restoredEvents = structuredClone(events);
    const replayedEvents = restoredEvents.filter((event) => event.runId === snapshot.runId && event.sequence > snapshot.simClock.sequence);
    replayEventsOntoSnapshot(restoredSnapshot, replayedEvents);
    const restoredRngState = rngStateAfterEvents(replayedEvents) ?? restoredSnapshot.runContext.rngState;
    restoredSnapshot.runContext.rngState = restoredRngState;
    const elapsedMinutes = minutesBetween(restoredSnapshot.runContext.startedAt, restoredSnapshot.simClock.currentTime);
    this.state = {
      catalog,
      activeScenario,
      snapshot: restoredSnapshot,
      elapsedMinutes,
      emittedEvents: restoredEvents,
      executedStepKeys: new Set(activeScenario.steps
        .filter((step) => step.minute <= elapsedMinutes)
        .map((step) => `${activeScenario.id}:${step.minute}`)),
      profileLitRooms: new Set(Object.values(restoredSnapshot.rooms)
        .filter((room) => room.lightsOn)
        .map((room) => room.id)),
      sensorObservations: restoreSensorObservations(restoredEvents, restoredSnapshot.runId, restoredSnapshot.simClock.sequence),
      personNeeds: restorePersonNeeds(restoredSnapshot, elapsedMinutes),
      triggeredRules: new Set(restoredEvents
        .filter((event) => event.type === 'AutomationTriggered')
        .map((event) => event.ruleId)),
      ruleStates: restoreRuleStates(restoredEvents, elapsedMinutes, restoredSnapshot.simClock.currentTime),
      random: new SeededRandom(restoredSnapshot.runContext.seed, restoredRngState)
    };
    this.updateAllPersonBehavior();
    this.rebuildRooms();
    this.updateOccupancy();
  }

  private startScenarioDefinition(scenario: ScenarioDefinition, eventValue: string, runSeed: number): TwinEvent[] {
    const catalog = createCatalogFromHomeDefinition(this.homeDefinition);
    const random = new SeededRandom(runSeed);
    const runContext = this.createRunContext(runSeed, scenario.startTime, random);
    this.state = {
      catalog,
      activeScenario: scenario,
      snapshot: this.createInitialSnapshot(catalog, scenario.id, scenario.startTime, scenario.initialMode, scenario.speed, runContext),
      elapsedMinutes: 0,
      emittedEvents: [],
      executedStepKeys: new Set(),
      profileLitRooms: new Set(),
      sensorObservations: new Map(),
      personNeeds: createRuntimePersonNeeds(this.createInitialSnapshot(catalog, scenario.id, scenario.startTime, scenario.initialMode, scenario.speed, runContext)),
      triggeredRules: new Set(),
      ruleStates: new Map(),
      random
    };

    for (const [personId, person] of Object.entries(scenario.initialPeople)) {
      this.state.snapshot.people[personId].location = person.location;
      this.state.snapshot.people[personId].activity = person.activity;
      this.updatePersonBehavior(personId);
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
      this.advancePersonNeeds(1);
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
    this.syncRunContext();
    return structuredClone(this.state.snapshot);
  }

  getEvents(): TwinEvent[] {
    return structuredClone(this.state.emittedEvents);
  }

  injectAbnormality(kind: 'door_left_open' | 'fridge_left_open' | 'network_offline' | 'senior_no_activity'): TwinEvent[] {
    const events: TwinEvent[] = [this.createAbnormalityInjectedEvent(kind)];
    if (kind === 'door_left_open') {
      events.push(this.setDeviceState('door_lock_01', { locked: false }, 'abnormality:door_left_open'));
      events.push(this.setDeviceState('doorbell_camera_01', { motion: true, ringing: false }, 'abnormality:door_left_open'));
    } else if (kind === 'fridge_left_open') {
      events.push(this.setDeviceState('fridge_01', { doorOpen: true, powerW: 148, lifecyclePhase: 'opened', openMinutes: 0 }, 'abnormality:fridge_left_open'));
    } else if (kind === 'network_offline') {
      events.push(this.setDeviceState('router_01', { online: true, latencyMs: 260, lifecyclePhase: 'degraded' }, 'abnormality:network_degraded'));
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'network_degraded',
        explanation: 'Router latency degraded before the network outage, so the twin records a prewarning phase.',
        actions: ['mark_router_degraded', 'warn_remote_work_reliability'],
        reason: 'router_01.lifecyclePhase:degraded',
        eventExplanation: {
          why: 'Router latency rose above the remote-work comfort threshold before connectivity dropped.',
          actorIds: ['adult_2'],
          affectedDeviceIds: ['router_01'],
          affectedRoomIds: ['study'],
          relatedIntent: 'focused_remote_work',
          expectedOutcome: 'Explain that the outage had a degraded prewarning phase before the router went offline.'
        }
      }));
      events.push(this.setDeviceState('router_01', { online: false, latencyMs: 0, lifecyclePhase: 'offline' }, 'abnormality:network_offline'));
    } else if (kind === 'senior_no_activity') {
      events.push(...this.createRoutedPersonMovedEvents('senior_1', 'master_bedroom', 'no_activity'));
      events.push(this.setDeviceState('master_sleep_01', { inBed: true, heartRateSimulated: 60 }, 'abnormality:senior_no_activity'));
    }
    this.rebuildRooms();
    this.updateOccupancy();
    events.push(...this.applyRules());
    this.state.emittedEvents.push(...events);
    return events;
  }

  private createAbnormalityInjectedEvent(kind: AbnormalityInjectedEvent['kind']): AbnormalityInjectedEvent {
    return this.createEvent({
      type: 'AbnormalityInjected',
      kind,
      affectedEntities: affectedEntitiesForAbnormality(kind),
      reason: `abnormality:${kind}`
    });
  }

  resolveAbnormality(kind: 'door_left_open' | 'fridge_left_open' | 'network_offline' | 'senior_no_activity'): TwinEvent[] {
    const events: TwinEvent[] = [];
    if (kind === 'door_left_open') {
      events.push(this.setDeviceState('door_lock_01', { locked: true }, 'recovery:door_left_open'));
      events.push(this.setDeviceState('doorbell_camera_01', { motion: false, ringing: false }, 'recovery:door_left_open'));
      events.push(...this.recoverRuleIfActive('door_left_open', ['door_lock_01.locked:true', 'doorbell_camera_01.motion:false']));
    } else if (kind === 'fridge_left_open') {
      events.push(this.setDeviceState('fridge_01', { doorOpen: false, powerW: 90, lifecyclePhase: 'recovered', openMinutes: 0 }, 'recovery:fridge_left_open'));
      events.push(...this.recoverRuleIfActive('fridge_left_open', ['fridge_01.doorOpen:false']));
    } else if (kind === 'network_offline') {
      events.push(this.setDeviceState('router_01', { online: true, latencyMs: 18, lifecyclePhase: 'recovered' }, 'recovery:network_offline'));
      events.push(...this.recoverRuleIfActive('network_offline', ['router_01.online:true']));
    } else if (kind === 'senior_no_activity') {
      events.push(...this.createSeniorCheckInEvents());
      events.push(...this.createRoutedPersonMovedEvents('senior_1', 'living_room', 'morning_check_in'));
      events.push(this.setDeviceState('master_sleep_01', { inBed: false, heartRateSimulated: 70 }, 'recovery:senior_no_activity'));
      events.push(...this.recoverRuleIfActive('senior_no_activity', ['senior_1.activity:morning_check_in', 'master_sleep_01.inBed:false']));
    }
    this.rebuildRooms();
    this.updateOccupancy();
    this.state.emittedEvents.push(...events);
    return events;
  }

  setAlertStatus(alertId: string, status: AlertLifecycleStatus): TwinEvent[] | null {
    const alert = this.state.snapshot.alerts[alertId];
    if (!alert) {
      return null;
    }
    const previousStatus = alert.status;
    alert.status = status;
    if (status === 'active') {
      delete alert.resolvedAt;
    } else if (status === 'resolved') {
      alert.resolvedAt = this.state.snapshot.simClock.currentTime;
    }
    const event = this.createEvent({
      type: 'AlertStatusChanged',
      alertId,
      previousStatus,
      status,
      reason: `operator:alert:${status}`
    });
    this.state.emittedEvents.push(event);
    return [event];
  }

  commandDevice(deviceId: string, command: string, value: string | number | boolean | null = null): TwinEvent[] | null {
    const device = this.state.snapshot.devices[deviceId];
    if (!device) {
      return null;
    }
    if (!getDeviceSupportedCommands(deviceId, device.type).includes(command)) {
      return null;
    }
    const approach = this.createOperatorApproachEvents(device, command);
    const stateEvents = this.createDeviceCommandStateEvents(deviceId, device, command, value);
    const recoveryEvents = this.recoverRuleForDeviceCommand(deviceId, command);
    const returnEvents = this.createOperatorReturnEvents(approach.context, device, command);
    this.rebuildRooms();
    this.updateOccupancy();
    const events = [...approach.events, ...stateEvents, ...recoveryEvents, ...returnEvents];
    this.state.emittedEvents.push(...events);
    return events;
  }

  private createDeviceCommandStateEvents(deviceId: string, device: DeviceState, command: string, value: string | number | boolean | null): DeviceStateChangedEvent[] {
    const reason = `operator:device_command:${command}`;
    if (deviceId === 'router_01' && command === 'restart') {
      return [
        this.setDeviceState(deviceId, { online: false, latencyMs: 0, lifecyclePhase: 'restarting' }, reason)
      ];
    }
    return [
      this.setDeviceState(deviceId, commandPatch(device.type, command, value, device.state), reason)
    ];
  }

  private createInitialSnapshot(catalog: Catalog, scenarioId: ScenarioId, startTime: string, mode: HomeMode, speed: number, runContext: RunContext): TwinSnapshot {
    const devices = Object.fromEntries(catalog.devices.map((device) => [device.id, this.createDeviceState(device)]));
    const rooms = catalog.rooms.reduce<TwinSnapshot['rooms']>((roomMap, room) => {
      roomMap[room.id] = {
        id: room.id,
        name: room.name,
        occupancy: false,
        humanOccupancy: false,
        motionDetected: false,
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
        behavior: createBehaviorContext(person.id, 'idle', person.kind === 'pet' ? 'living_room' : 'master_bedroom', mode),
        confidence: 0.9,
        privacyMode: true
      }
    ])) as TwinSnapshot['people'];

    return {
      homeId: this.homeId,
      runId: runContext.runId,
      runContext,
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
      alerts: {},
      worldState: {
        inventory: createInitialInventory(),
        objectLocations: createInitialObjectLocations()
      }
    };
  }

  private createDeviceState(device: DeviceDefinition): DeviceState {
    return {
      id: device.id,
      roomId: device.roomId,
      type: device.type,
      state: getDeviceCapability(device.type).defaultState,
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
    events.push(...this.advanceRobotVacuumLifecycle());
    events.push(...this.advanceRouterRestartLifecycle());
    events.push(...this.advanceFridgeDoorLifecycle());
    this.rebuildRooms();
    events.push(...this.applyAutonomousAgentPolicy());
    this.rebuildRooms();
    events.push(...this.applyBehaviorProfileInteractions());
    this.rebuildRooms();
    events.push(...this.syncMotionSensors());
    events.push(...this.syncSecurityCameras());
    events.push(...this.applyRandomHouseholdEvents());
    return events;
  }

  private advanceApplianceCycles(): TwinEvent[] {
    const events: TwinEvent[] = [];
    events.push(...this.advanceTimedDevice('dishwasher_01', 'dishwasher_cycle_done', 'Dishwasher is waiting to be unloaded', 'empty_dishwasher'));
    events.push(...this.advanceTimedDevice('washer_01', 'washer_cycle_done', 'Washing machine is waiting to be unloaded', 'move_laundry_to_dryer'));
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

    const waitingRuleId = `${device.type}_waiting_unload`;
    return [
      this.setDeviceState(deviceId, { status: 'waiting_unload', remainingMin: 0, powerW: 2 }, `ambient:${device.type}:waiting_unload`),
      this.createAlertEvent(alertId, 'info', device.roomId, message, recommendedAction, `device:${deviceId}:waiting_unload`),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: waitingRuleId,
        explanation: `${device.type === 'dishwasher' ? 'Dishwasher' : 'Washing machine'} cycle finished and is waiting for a person to unload it.`,
        actions: [recommendedAction],
        reason: `device:${deviceId}:waiting_unload`,
        eventExplanation: {
          why: `${device.id} completed its running cycle and now needs household handling.`,
          actorIds: [],
          affectedDeviceIds: [deviceId],
          affectedRoomIds: [device.roomId],
          expectedOutcome: `${device.type === 'washer' ? 'Laundry is moved before it sits wet.' : 'Clean dishes are unloaded and the appliance returns to idle.'}`
        }
      })
    ];
  }

  private advanceFridgeDoorLifecycle(): TwinEvent[] {
    const fridge = this.state.snapshot.devices.fridge_01;
    if (!fridge || fridge.state.doorOpen !== true) {
      return [];
    }
    const previousPhase = String(fridge.state.lifecyclePhase ?? 'opened');
    const openMinutes = Math.max(1, Number(fridge.state.openMinutes ?? 0) + 1);
    const policy = alertEscalationPolicies.fridge_left_open;
    const lifecyclePhase = openMinutes >= policy.highSeverityAfterOpenMinutes ? policy.lifecyclePhase : openMinutes >= 1 ? 'still_open' : 'opened';
    const powerW = Math.max(Number(fridge.state.powerW ?? 148), lifecyclePhase === 'alert' ? 176 : 156);
    const events: TwinEvent[] = [
      this.setDeviceState('fridge_01', {
        lifecyclePhase,
        openMinutes,
        powerW
      }, lifecyclePhase === 'alert' ? 'ambient:fridge:alert' : 'ambient:fridge:still_open')
    ];
    const kitchenClimate = this.state.snapshot.devices.kitchen_temp_01;
    if (kitchenClimate) {
      const kitchenRoom = this.state.snapshot.rooms.kitchen;
      const temperatureC = this.round(this.clamp(Number(kitchenRoom.temperatureC ?? kitchenClimate.state.temperatureC ?? 25) + (lifecyclePhase === 'alert' ? 0.42 : 0.16), 17, 31));
      const humidityPercent = Number(kitchenRoom.humidityPercent ?? kitchenClimate.state.humidityPercent ?? 55);
      events.push(this.setDeviceState('kitchen_temp_01', { temperatureC, humidityPercent }, 'ambient:fridge:kitchen_temperature_drift'));
      this.state.snapshot.rooms.kitchen.temperatureC = temperatureC;
      this.state.snapshot.rooms.kitchen.humidityPercent = humidityPercent;
    }
    if (lifecyclePhase === 'alert' && previousPhase !== 'alert') {
      const alert = this.state.snapshot.alerts.fridge_left_open_001;
      if (alert && alert.status !== 'resolved') {
        alert.severity = 'high';
      }
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'fridge_left_open_escalated',
        explanation: 'The fridge door remained open long enough to escalate energy and kitchen temperature impact.',
        actions: ['escalate_fridge_alert', 'prioritize_close_fridge_door', 'track_kitchen_temperature_drift'],
        reason: 'fridge_01.lifecyclePhase:alert',
        eventExplanation: {
          why: 'The fridge door has stayed open for five simulated minutes, increasing compressor load and kitchen temperature drift.',
          actorIds: [],
          affectedDeviceIds: ['fridge_01', 'kitchen_temp_01'],
          affectedRoomIds: ['kitchen'],
          relatedIntent: 'close_fridge',
          expectedOutcome: 'Escalate the alert so a household member closes the fridge before energy and comfort impact grows.'
        }
      }));
    }
    return events;
  }

  private advanceRobotVacuumLifecycle(): TwinEvent[] {
    const vacuum = this.state.snapshot.devices.robot_vacuum_01;
    if (!vacuum) {
      return [];
    }
    if (vacuum.state.status === 'assisted') {
      return [
        this.setDeviceState('robot_vacuum_01', { status: 'cleaning' }, 'ambient:robot_vacuum:resume_after_assist')
      ];
    }
    if (vacuum.state.status !== 'cleaning') {
      return [];
    }

    const cycleMinutes = Math.max(1, Number(vacuum.state.cycleMinutes ?? 0) + 1);
    const batteryPercent = this.clamp(Number(vacuum.state.batteryPercent ?? 92) - 1.5, 20, 100);
    if (cycleMinutes === 3) {
      return [
        this.setDeviceState('robot_vacuum_01', { status: 'stuck', cycleMinutes, batteryPercent: this.round(batteryPercent) }, 'ambient:robot_vacuum:stuck'),
        this.createAlertEvent('robot_vacuum_stuck_001', 'warning', 'living_room', 'Robot vacuum needs help in the living room', 'clear_robot_path', 'rule:robot_vacuum_stuck'),
        this.createEvent({
          type: 'AutomationTriggered',
          ruleId: 'robot_vacuum_stuck',
          explanation: 'Robot vacuum cleaning paused because the robot reported a stuck condition.',
          actions: ['raise_robot_help_alert', 'wait_for_household_assist'],
          reason: 'robot_vacuum_01.status:stuck',
          eventExplanation: {
            why: 'robot_vacuum_01 became stuck during its cleaning lifecycle.',
            actorIds: [],
            affectedDeviceIds: ['robot_vacuum_01'],
            affectedRoomIds: ['living_room'],
            expectedOutcome: 'Ask a household member to clear the path so cleaning can resume.'
          }
        })
      ];
    }
    if (cycleMinutes >= 6) {
      const events: TwinEvent[] = [
        this.setDeviceState('robot_vacuum_01', { status: 'docked', cycleMinutes: 0, batteryPercent: this.round(batteryPercent), binFull: false }, 'ambient:robot_vacuum:docked')
      ];
      const alert = this.state.snapshot.alerts.robot_vacuum_stuck_001;
      if (alert && alert.status !== 'resolved') {
        const previousStatus = alert.status;
        alert.status = 'resolved';
        alert.resolvedAt = this.state.snapshot.simClock.currentTime;
        events.push(this.createEvent({
          type: 'AlertStatusChanged',
          alertId: alert.id,
          previousStatus,
          status: 'resolved',
          reason: 'robot_vacuum_01.status:docked'
        }));
      }
      return events;
    }
    return [
      this.setDeviceState('robot_vacuum_01', { cycleMinutes, batteryPercent: this.round(batteryPercent) }, 'ambient:robot_vacuum:cleaning')
    ];
  }

  private advanceRouterRestartLifecycle(): TwinEvent[] {
    const router = this.state.snapshot.devices.router_01;
    if (!router) {
      return [];
    }
    if (router.state.lifecyclePhase === 'restarting') {
      return [
        this.setDeviceState('router_01', { online: true, latencyMs: 80, lifecyclePhase: 'reconnecting' }, 'ambient:router:reconnecting')
      ];
    }
    if (router.state.lifecyclePhase === 'reconnecting') {
      return [
        this.setDeviceState('router_01', { online: true, latencyMs: 18, lifecyclePhase: 'recovered' }, 'ambient:router:recovered'),
        ...this.recoverRuleIfActiveOrAlert('network_offline', ['router_01.online:true'])
      ];
    }
    return [];
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
    return this.createRoutedPersonMovedEvents('pet_1', to, activity);
  }

  private applyAutonomousAgentPolicy(): TwinEvent[] {
    const events: TwinEvent[] = [];
    const minuteOfDay = minuteOfDayFromTime(this.state.snapshot.simClock.currentTime);
    if (this.state.snapshot.homeState.mode === 'sleeping') {
      return events;
    }

    for (const person of Object.values(this.state.snapshot.people)) {
      if (person.kind !== 'human' || person.location === 'away') {
        continue;
      }
      const daytimeSleepCandidate = person.activity === 'sleeping' && minuteOfDay >= 8 * 60 && minuteOfDay <= 12 * 60;
      const morningFoodCandidate = ['idle', 'wake_up', 'waking_up'].includes(person.activity) &&
        minuteOfDay >= 6 * 60 + 30 &&
        minuteOfDay <= 9 * 60 + 30;
      const persona = getPersona(person.id);
      const needs = this.state.personNeeds.get(person.id) ?? createInitialNeeds(persona);
      const accumulatedFoodCandidate = ['idle', 'reading', 'resting', 'wake_up', 'waking_up'].includes(person.activity) && needs.hunger >= 75;
      const lunchtimeFoodCandidate = accumulatedFoodCandidate &&
        persona.role !== 'student' &&
        minuteOfDay >= 10 * 60 &&
        minuteOfDay <= 14 * 60;
      if (!daytimeSleepCandidate && !morningFoodCandidate && !lunchtimeFoodCandidate) {
        continue;
      }
      const decision = selectActivity({
        personId: person.id,
        persona,
        needs: morningFoodCandidate ? { ...needs, hunger: Math.max(needs.hunger, 86) } : needs,
        currentActivity: person.activity,
        currentRoom: person.location,
        homeMode: this.state.snapshot.homeState.mode,
        minuteOfDay,
        availableResources: resourcesFromInventory(this.state.snapshot.worldState.inventory),
        commitmentPressureByActivity: this.commitmentPressureByActivity(person.id, persona, minuteOfDay)
      });
      if (decision.activityId !== 'wake_up') {
        const canChooseFood = (morningFoodCandidate || lunchtimeFoodCandidate) && ['prepare_breakfast', 'eat_simple_food', 'eat_meal', 'order_takeout'].includes(decision.activityId);
        if (!canChooseFood) {
          continue;
        }
      }
      const moveEvents = this.createRoutedPersonMovedEvents(person.id, decision.targetRoom, decision.activityId, `agent_policy:${decision.activityId}`);
      this.state.snapshot.worldState.inventory = applyActivityToInventory(this.state.snapshot.worldState.inventory, decision.activityId);
      this.applyActivityEffectsToPerson(person.id, decision.activityId);
      events.push(...moveEvents);
      if (decision.activityId === 'order_takeout') {
        events.push(this.createEvent({
          type: 'ExternalInteractionOccurred',
          interactionId: `takeout_delivery_${this.state.snapshot.simClock.sequence + 1}`,
          actorKind: 'courier',
          purpose: 'takeout_delivery',
          roomId: 'entrance',
          status: 'completed',
          relatedDeviceIds: ['doorbell_camera_01'],
          reason: `agent_policy:${decision.activityId}`
        }));
      }
    }
    return events;
  }

  private advancePersonNeeds(minutes: number): void {
    for (const person of Object.values(this.state.snapshot.people)) {
      if (person.kind !== 'human') {
        continue;
      }
      const persona = getPersona(person.id);
      const currentNeeds = this.state.personNeeds.get(person.id) ?? createInitialNeeds(persona);
      this.state.personNeeds.set(person.id, advanceNeeds(currentNeeds, persona, {
        minutes,
        activity: person.activity,
        homeMode: this.state.snapshot.homeState.mode
      }));
    }
  }

  private applyActivityEffectsToPerson(personId: string, activityId: string): void {
    const person = this.state.snapshot.people[personId];
    if (!person || person.kind !== 'human') {
      return;
    }
    const persona = getPersona(personId);
    const currentNeeds = this.state.personNeeds.get(personId) ?? createInitialNeeds(persona);
    this.state.personNeeds.set(personId, applyActivityEffectsToNeeds(currentNeeds, activityId));
  }

  private commitmentPressureByActivity(personId: string, persona: ReturnType<typeof getPersona>, minuteOfDay: number): Record<string, number> {
    const commitments = createDailyCommitments({
      persona,
      date: this.state.snapshot.runContext.startedAt.slice(0, 10),
      seed: this.state.snapshot.runContext.seed
    }).filter((commitment) => commitment.personId === personId);
    const pressureByActivity: Record<string, number> = {};
    for (const commitment of commitments) {
      const pressure = commitmentPressureAtMinute(commitments, minuteOfDay, commitment.activityId);
      if (pressure > 0) {
        pressureByActivity[commitment.activityId] = pressure;
      }
    }
    return pressureByActivity;
  }

  private applyBehaviorProfileInteractions(): TwinEvent[] {
    const events: TwinEvent[] = [];
    events.push(...this.applyCommuterArrivalScene());
    events.push(...this.applySocialCoordination());
    events.push(...this.applyHumanActivityLighting());
    events.push(...this.applyChildHomeworkFocus());
    events.push(...this.applyRemoteWorkComfort());
    events.push(...this.applyFamilyDinnerReadiness());
    events.push(...this.applySeniorMorningSupport());
    events.push(...this.applySeniorWellnessCheck());
    events.push(...this.applySeniorGardenCare());
    events.push(...this.applyPetGardenSafety());
    return events;
  }

  private applySocialCoordination(): TwinEvent[] {
    const events: TwinEvent[] = [];
    for (const decision of coordinateHousehold(this.createSocialContext())) {
      if (decision.ruleId === 'parent_homework_reminder') {
        events.push(...this.applyParentHomeworkReminder(decision));
      } else if (decision.ruleId === 'family_meal_invitation') {
        events.push(...this.applyFamilyMealInvitation(decision));
      } else if (decision.ruleId === 'senior_medicine_reminder') {
        events.push(...this.applySeniorMedicineReminder(decision));
      } else if (decision.ruleId === 'senior_light_support') {
        events.push(...this.applySeniorLightSupport(decision));
      } else if (decision.ruleId === 'senior_phone_fetch') {
        events.push(...this.applySeniorPhoneFetch(decision));
      } else if (decision.ruleId === 'package_pickup_response') {
        events.push(...this.applyPackagePickupResponse(decision));
      } else if (decision.ruleId === 'maintenance_visit_response') {
        events.push(...this.applyMaintenanceVisitResponse(decision));
      } else if (decision.ruleId === 'medicine_refill_response') {
        events.push(...this.applyMedicineRefillResponse(decision));
      } else if (decision.ruleId === 'visitor_greeting_response') {
        events.push(...this.applyVisitorGreetingResponse(decision));
      } else if (decision.ruleId === 'household_chore_assignment') {
        events.push(...this.applyHouseholdChoreAssignment(decision));
      } else if (decision.ruleId === 'shared_resource_contention') {
        events.push(...this.applySharedResourceContention(decision));
      }
    }
    return events;
  }

  private createSocialContext(): HouseholdSocialContext {
    const people: HouseholdSocialContext['people'] = {};
    for (const person of Object.values(this.state.snapshot.people)) {
      people[person.id] = {
        location: person.location,
        activity: person.activity,
        available: isAvailableForSocialCoordination(person.kind, person.location, person.activity)
      };
    }

    const activeAlerts: Record<string, string> = {};
    for (const alert of Object.values(this.state.snapshot.alerts)) {
      if (alert.status === 'active' || alert.status === 'acknowledged') {
        activeAlerts[alert.id] = alert.sourceRuleId ?? alert.id;
      }
    }

    const resourceClaims = [];
    const adultWorker = this.state.snapshot.people.adult_2;
    const child = this.state.snapshot.people.child_1;
    if (adultWorker?.location === 'study' && adultWorker.activity === 'remote_work') {
      resourceClaims.push({ personId: 'adult_2', resourceId: 'quiet_study', priority: 80 });
    }
    if (child?.location === 'study' && child.activity === 'homework') {
      resourceClaims.push({ personId: 'child_1', resourceId: 'quiet_study', priority: 70 });
    }
    for (const person of Object.values(this.state.snapshot.people)) {
      if (person.kind !== 'human' || person.location === 'away' || !['bathroom', 'bathroom_routine'].includes(person.activity)) {
        continue;
      }
      resourceClaims.push({
        personId: person.id,
        resourceId: 'bathroom_sink',
        priority: person.location === 'bathroom' ? 74 : 55
      });
    }

    return {
      currentTime: this.state.snapshot.simClock.currentTime,
      homeMode: this.state.snapshot.homeState.mode,
      people,
      activeAlerts,
      resourceClaims,
      availableResources: resourcesFromInventory(this.state.snapshot.worldState.inventory),
      householdBacklog: {
        dirtyDishes: this.state.snapshot.worldState.inventory.dirtyDishes,
        dirtyLaundryKg: this.state.snapshot.worldState.inventory.dirtyLaundryKg,
        packageCount: this.state.snapshot.worldState.inventory.packageCount,
        unfinishedChores: this.state.snapshot.worldState.inventory.unfinishedChores,
        deviceMaintenanceScore: this.state.snapshot.worldState.inventory.deviceMaintenanceScore
      },
      externalSignals: {
        visitorAtDoor: this.isVisitorAtDoor(),
        seniorNeedsLight: this.isSeniorWaitingForLightSupport(),
        seniorNeedsPhone: this.isSeniorWaitingForPhoneSupport()
      },
      taskPressure: {
        child_1: this.estimateChildTaskPressure()
      }
    };
  }

  private isVisitorAtDoor(): boolean {
    const doorbell = this.state.snapshot.devices.doorbell_camera_01;
    const packageSensor = this.state.snapshot.devices.package_sensor_01;
    return doorbell?.state.motion === true &&
      doorbell.state.ringing === true &&
      packageSensor?.state.packagePresent !== true &&
      this.state.snapshot.worldState.inventory.packageCount <= 0;
  }

  private isSeniorWaitingForLightSupport(): boolean {
    const senior = this.state.snapshot.people.senior_1;
    if (!senior || senior.location === 'away' || !['reading', 'idle', 'morning_rest'].includes(senior.activity)) {
      return false;
    }
    const minuteOfDay = minuteOfDayFromTime(this.state.snapshot.simClock.currentTime);
    if (minuteOfDay < 18 * 60 || minuteOfDay > 22 * 60) {
      return false;
    }
    const lightDeviceId = roomLightDevices[senior.location];
    const lightDevice = lightDeviceId ? this.state.snapshot.devices[lightDeviceId] : undefined;
    return Boolean(lightDeviceId && lightDevice && lightDevice.state.power !== 'on');
  }

  private isSeniorWaitingForPhoneSupport(): boolean {
    const senior = this.state.snapshot.people.senior_1;
    if (!senior || senior.location === 'away' || senior.activity !== 'needs_phone') {
      return false;
    }
    const phoneLocation = this.state.snapshot.worldState.objectLocations.family_phone ?? 'living_room';
    return phoneLocation !== senior.location;
  }

  private applyParentHomeworkReminder(decision: SocialDecision): TwinEvent[] {
    if (
      this.state.triggeredRules.has(decision.ruleId) ||
      !decision.targetRoom ||
      !decision.targetActivity ||
      !decision.conversationTopic
    ) {
      return [];
    }
    const [parentId, childId] = decision.actorIds;
    const parent = parentId ? this.state.snapshot.people[parentId] : undefined;
    const child = childId ? this.state.snapshot.people[childId] : undefined;
    if (!parent || !child || parent.location === 'away' || child.location === 'away') {
      return [];
    }

    this.state.triggeredRules.add(decision.ruleId);
    const events: TwinEvent[] = [
      this.createEvent(createConversationDraft({
        conversationId: `${decision.ruleId}_${this.state.snapshot.simClock.sequence + 1}`,
        currentTime: this.state.snapshot.simClock.currentTime,
        speakerId: parent.id,
        listenerIds: [child.id],
        topic: decision.conversationTopic,
        intent: 'finish_homework',
        roomId: parent.location,
        summary: `${parent.id} reminds ${child.id} to stop entertainment and start homework.`,
        reason: decision.reason
      }))
    ];

    events.push(...this.createRoutedPersonMovedEvents(child.id, decision.targetRoom, decision.targetActivity, decision.reason));
    events.push(this.createEvent({
      type: 'AutomationTriggered',
      ruleId: decision.ruleId,
      explanation: 'A parent noticed the child watching TV during homework time and redirected the child to homework.',
      actions: ['remind_child_to_start_homework', 'move_child_to_study_area'],
      reason: decision.reason,
      eventExplanation: {
        why: `${parent.id} has family authority for child_1 and child_1 has high homework pressure.`,
        actorIds: [parent.id, child.id],
        affectedDeviceIds: ['tv_01', 'child_sleep_01'],
        affectedRoomIds: ['living_room', decision.targetRoom],
        relatedIntent: 'finish_homework',
        expectedOutcome: 'Shift the child from entertainment to homework before quiet-focus automation applies.'
      }
    }));
    return events;
  }

  private applyPackagePickupResponse(decision: SocialDecision): TwinEvent[] {
    if (
      this.state.triggeredRules.has(decision.ruleId) ||
      !decision.targetRoom ||
      !decision.targetActivity ||
      this.state.snapshot.worldState.inventory.packageCount <= 0
    ) {
      return [];
    }
    const actorId = decision.actorIds[0];
    const actor = actorId ? this.state.snapshot.people[actorId] : undefined;
    if (!actor || actor.location === 'away') {
      return [];
    }

    this.state.triggeredRules.add(decision.ruleId);
    this.state.snapshot.worldState.inventory.packageCount = Math.max(0, this.state.snapshot.worldState.inventory.packageCount - 1);
    const events: TwinEvent[] = [
      this.createEvent({
        type: 'ExternalInteractionOccurred',
        interactionId: `${decision.ruleId}_${this.state.snapshot.simClock.sequence + 1}`,
        actorKind: 'courier',
        purpose: 'package_delivery',
        roomId: 'entrance',
        status: 'completed',
        relatedDeviceIds: ['doorbell_camera_01', 'package_sensor_01'],
        reason: decision.reason
      }),
      ...this.createRoutedPersonMovedEvents(actor.id, decision.targetRoom, decision.targetActivity, decision.reason),
      this.setDeviceState('package_sensor_01', { packagePresent: false, weightKg: 0 }, 'social:package_pickup_response:collected'),
      this.setDeviceState('doorbell_camera_01', { motion: false, ringing: false }, 'social:package_pickup_response:acknowledged'),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: decision.ruleId,
        explanation: 'A courier delivery was acknowledged and a household member collected the package from the entrance.',
        actions: ['acknowledge_courier_delivery', 'move_household_member_to_entrance', 'clear_package_sensor', 'reduce_package_backlog'],
        reason: decision.reason,
        eventExplanation: {
          why: `${actor.id} is available while the entrance package sensor reports a package.`,
          actorIds: [actor.id],
          affectedDeviceIds: ['doorbell_camera_01', 'package_sensor_01'],
          affectedRoomIds: ['entrance'],
          relatedIntent: 'handle_delivery',
          expectedOutcome: 'Turn an external courier event into a concrete household response and clear the package backlog.'
        }
      })
    ];
    return events;
  }

  private applyMaintenanceVisitResponse(decision: SocialDecision): TwinEvent[] {
    if (
      this.state.triggeredRules.has(decision.ruleId) ||
      !decision.targetRoom ||
      !decision.targetActivity ||
      this.state.snapshot.worldState.inventory.deviceMaintenanceScore > 4
    ) {
      return [];
    }
    const actorId = decision.actorIds[0];
    const actor = actorId ? this.state.snapshot.people[actorId] : undefined;
    if (!actor || actor.location === 'away') {
      return [];
    }

    this.state.triggeredRules.add(decision.ruleId);
    this.state.snapshot.worldState.inventory.deviceMaintenanceScore = Math.max(
      this.state.snapshot.worldState.inventory.deviceMaintenanceScore,
      8
    );
    const events: TwinEvent[] = [
      this.createEvent({
        type: 'ExternalInteractionOccurred',
        interactionId: `${decision.ruleId}_${this.state.snapshot.simClock.sequence + 1}`,
        actorKind: 'repair',
        purpose: 'maintenance_visit',
        roomId: 'entrance',
        status: 'completed',
        relatedDeviceIds: ['router_01', 'robot_vacuum_01'],
        reason: decision.reason
      }),
      ...this.createRoutedPersonMovedEvents(actor.id, decision.targetRoom, decision.targetActivity, decision.reason),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: decision.ruleId,
        explanation: 'A degraded maintenance score caused the household to meet a repair worker and restore device maintenance confidence.',
        actions: ['acknowledge_repair_visit', 'move_household_member_to_entrance', 'raise_device_maintenance_score'],
        reason: decision.reason,
        eventExplanation: {
          why: `${actor.id} is available while device maintenance score is degraded.`,
          actorIds: [actor.id],
          affectedDeviceIds: ['router_01', 'robot_vacuum_01'],
          affectedRoomIds: ['entrance'],
          relatedIntent: 'handle_maintenance_visit',
          expectedOutcome: 'Represent a repair visit as concrete household coordination and improve long-term device maintenance state.'
        }
      })
    ];
    return events;
  }

  private applyMedicineRefillResponse(decision: SocialDecision): TwinEvent[] {
    if (
      this.state.triggeredRules.has(decision.ruleId) ||
      !decision.targetRoom ||
      !decision.targetActivity ||
      this.state.snapshot.worldState.inventory.medicineDoses > 2
    ) {
      return [];
    }
    const actorId = decision.actorIds[0];
    const actor = actorId ? this.state.snapshot.people[actorId] : undefined;
    if (!actor || actor.location === 'away') {
      return [];
    }

    this.state.triggeredRules.add(decision.ruleId);
    this.state.snapshot.worldState.inventory = applyActivityToInventory(
      this.state.snapshot.worldState.inventory,
      decision.targetActivity
    );
    return [
      this.createEvent({
        type: 'ExternalInteractionOccurred',
        interactionId: `${decision.ruleId}_${this.state.snapshot.simClock.sequence + 1}`,
        actorKind: 'courier',
        purpose: 'medicine_refill',
        roomId: 'entrance',
        status: 'completed',
        relatedDeviceIds: ['doorbell_camera_01', 'package_sensor_01'],
        reason: decision.reason
      }),
      ...this.createRoutedPersonMovedEvents(actor.id, decision.targetRoom, decision.targetActivity, decision.reason),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: decision.ruleId,
        explanation: 'Low household medicine stock caused an available family member to collect a refill and restock the medicine box.',
        actions: ['detect_low_medicine_stock', 'collect_medicine_refill', 'restock_medicine_box', 'clear_medicine_refill_chore'],
        reason: decision.reason,
        eventExplanation: {
          why: `${actor.id} is available while household medicine stock is low.`,
          actorIds: [actor.id],
          affectedDeviceIds: ['doorbell_camera_01', 'package_sensor_01'],
          affectedRoomIds: ['entrance', 'master_bedroom'],
          relatedIntent: 'maintain_medicine_supply',
          expectedOutcome: 'Keep long-term medicine stock from staying depleted across days.'
        }
      })
    ];
  }

  private applyVisitorGreetingResponse(decision: SocialDecision): TwinEvent[] {
    if (
      this.state.triggeredRules.has(decision.ruleId) ||
      !decision.targetRoom ||
      !decision.targetActivity ||
      !this.isVisitorAtDoor()
    ) {
      return [];
    }
    const actorId = decision.actorIds[0];
    const actor = actorId ? this.state.snapshot.people[actorId] : undefined;
    if (!actor || actor.location === 'away') {
      return [];
    }

    this.state.triggeredRules.add(decision.ruleId);
    return [
      this.createEvent({
        type: 'ExternalInteractionOccurred',
        interactionId: `${decision.ruleId}_${this.state.snapshot.simClock.sequence + 1}`,
        actorKind: 'visitor',
        purpose: 'visitor_arrival',
        roomId: 'entrance',
        status: 'completed',
        relatedDeviceIds: ['doorbell_camera_01'],
        reason: decision.reason
      }),
      ...this.createRoutedPersonMovedEvents(actor.id, decision.targetRoom, decision.targetActivity, decision.reason),
      this.setDeviceState('doorbell_camera_01', { motion: false, ringing: false }, 'social:visitor_greeting_response:acknowledged'),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: decision.ruleId,
        explanation: 'A visitor was detected at the door and an available household member greeted them at the entrance.',
        actions: ['acknowledge_visitor_arrival', 'move_household_member_to_entrance', 'clear_doorbell_signal'],
        reason: decision.reason,
        eventExplanation: {
          why: `${actor.id} is available while the doorbell camera reports a ringing visitor without a package.`,
          actorIds: [actor.id],
          affectedDeviceIds: ['doorbell_camera_01'],
          affectedRoomIds: ['entrance'],
          relatedIntent: 'greet_visitor',
          expectedOutcome: 'Represent a visitor arrival as concrete household coordination rather than a passive camera event.'
        }
      })
    ];
  }

  private applyHouseholdChoreAssignment(decision: SocialDecision): TwinEvent[] {
    if (
      this.state.triggeredRules.has(decision.ruleId) ||
      !decision.targetRoom ||
      !decision.targetActivity ||
      !decision.conversationTopic ||
      this.state.snapshot.worldState.inventory.dirtyDishes < 4
    ) {
      return [];
    }
    const [assignerId, assigneeId] = decision.actorIds;
    const assigner = assignerId ? this.state.snapshot.people[assignerId] : undefined;
    const assignee = assigneeId ? this.state.snapshot.people[assigneeId] : undefined;
    if (!assigner || !assignee || assigner.location === 'away' || assignee.location === 'away') {
      return [];
    }

    this.state.triggeredRules.add(decision.ruleId);
    this.state.snapshot.worldState.inventory = applyActivityToInventory(this.state.snapshot.worldState.inventory, decision.targetActivity);
    return [
      this.createEvent(createConversationDraft({
        conversationId: `${decision.ruleId}_${this.state.snapshot.simClock.sequence + 1}`,
        currentTime: this.state.snapshot.simClock.currentTime,
        speakerId: assigner.id,
        listenerIds: [assignee.id],
        topic: decision.conversationTopic,
        intent: 'share_household_work',
        roomId: assigner.location,
        summary: `${assigner.id} assigns dish cleanup to ${assignee.id}.`,
        reason: decision.reason
      })),
      ...this.createRoutedPersonMovedEvents(assignee.id, decision.targetRoom, decision.targetActivity, decision.reason),
      this.setDeviceState('dishwasher_01', { status: 'idle', remainingMin: 0, powerW: 0 }, 'social:household_chore_assignment:unloaded'),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: decision.ruleId,
        explanation: 'A household chore was assigned based on dirty dish backlog and completed by an available family member.',
        actions: ['assign_dish_cleanup', 'move_assignee_to_kitchen', 'clear_dirty_dish_backlog', 'update_chore_backlog'],
        reason: decision.reason,
        eventExplanation: {
          why: `${assigner.id} is available to coordinate chores and dirty dishes exceed the backlog threshold.`,
          actorIds: [assigner.id, assignee.id],
          affectedDeviceIds: ['dishwasher_01'],
          affectedRoomIds: ['kitchen'],
          relatedIntent: 'share_household_work',
          expectedOutcome: 'Represent household chores as social coordination rather than anonymous device state changes.'
        }
      })
    ];
  }

  private applyFamilyMealInvitation(decision: SocialDecision): TwinEvent[] {
    if (
      this.state.triggeredRules.has(decision.ruleId) ||
      !decision.targetRoom ||
      !decision.targetActivity ||
      !decision.conversationTopic ||
      decision.actorIds.length < 2
    ) {
      return [];
    }

    const host = this.state.snapshot.people[decision.actorIds[0]];
    if (!host || host.location === 'away') {
      return [];
    }

    this.state.triggeredRules.add(decision.ruleId);
    const participants = ['adult_1', 'adult_2', 'child_1', 'senior_1']
      .filter((personId) => decision.actorIds.includes(personId))
      .filter((personId) => this.state.snapshot.people[personId]?.location !== 'away');
    const events: TwinEvent[] = [
      this.createEvent(createConversationDraft({
        conversationId: `${decision.ruleId}_${this.state.snapshot.simClock.sequence + 1}`,
        currentTime: this.state.snapshot.simClock.currentTime,
        speakerId: host.id,
        listenerIds: participants.filter((personId) => personId !== host.id),
        topic: decision.conversationTopic,
        intent: 'family_time',
        roomId: host.location,
        summary: `${host.id} calls the household to dinner.`,
        reason: decision.reason
      }))
    ];

    for (const personId of participants) {
      const person = this.state.snapshot.people[personId];
      if (!person || person.location === 'away') {
        continue;
      }
      events.push(...this.createRoutedPersonMovedEvents(person.id, decision.targetRoom, decision.targetActivity, decision.reason));
    }

    this.state.snapshot.activities.family_dinner = {
      activityId: 'family_dinner',
      participants,
      roomId: 'dining_room',
      startedAt: this.state.snapshot.simClock.currentTime
    };
    events.push(this.createEvent({
      type: 'ActivityStarted',
      activityId: 'family_dinner',
      participants,
      roomId: 'dining_room',
      reason: decision.reason
    }));
    events.push(this.setDeviceState('dining_light_01', { power: 'on', brightness: 64 }, 'social:family_meal_invitation:dining_light'));
    events.push(this.setDeviceState('stove_01', { powerW: 0, level: 0 }, 'social:family_meal_invitation:dinner_ready'));
    events.push(this.setDeviceState('range_hood_01', { power: 'off', speed: 0 }, 'social:family_meal_invitation:dinner_ready'));
    events.push(this.createEvent({
      type: 'AutomationTriggered',
      ruleId: decision.ruleId,
      explanation: 'Dinner preparation became a household invitation, so available family members gather in the dining room.',
      actions: ['invite_family_to_dinner', 'move_available_family_to_dining_room', 'set_dining_light', 'mark_dinner_ready'],
      reason: decision.reason,
      eventExplanation: {
        why: `${host.id} is preparing dinner and available family members can join.`,
        actorIds: participants,
        affectedDeviceIds: ['dining_light_01', 'stove_01', 'range_hood_01'],
        affectedRoomIds: ['kitchen', 'dining_room'],
        relatedIntent: 'family_time',
        expectedOutcome: 'Represent dinner as a coordinated household activity instead of isolated movements.'
      }
    }));
    return events;
  }

  private applySeniorMedicineReminder(decision: SocialDecision): TwinEvent[] {
    if (
      this.state.triggeredRules.has(decision.ruleId) ||
      !decision.targetRoom ||
      !decision.targetActivity ||
      !decision.conversationTopic ||
      this.state.snapshot.worldState.inventory.medicineDoses <= 0
    ) {
      return [];
    }
    const [caregiverId, seniorId] = decision.actorIds;
    const caregiver = caregiverId ? this.state.snapshot.people[caregiverId] : undefined;
    const senior = seniorId ? this.state.snapshot.people[seniorId] : undefined;
    if (!caregiver || !senior || caregiver.location === 'away' || senior.location === 'away') {
      return [];
    }

    this.state.triggeredRules.add(decision.ruleId);
    const events: TwinEvent[] = [
      this.createEvent(createConversationDraft({
        conversationId: `${decision.ruleId}_${this.state.snapshot.simClock.sequence + 1}`,
        currentTime: this.state.snapshot.simClock.currentTime,
        speakerId: caregiver.id,
        listenerIds: [senior.id],
        topic: decision.conversationTopic,
        intent: 'support_health_routine',
        roomId: caregiver.location,
        summary: `${caregiver.id} reminds ${senior.id} to take morning medicine.`,
        reason: decision.reason
      }))
    ];

    this.state.snapshot.worldState.inventory = applyActivityToInventory(this.state.snapshot.worldState.inventory, decision.targetActivity);
    events.push(...this.createRoutedPersonMovedEvents(senior.id, decision.targetRoom, decision.targetActivity, decision.reason));
    events.push(this.setDeviceState('master_sleep_01', { inBed: false, heartRateSimulated: 72 }, 'social:senior_medicine_reminder:wellness_signal'));
    events.push(this.createEvent({
      type: 'AutomationTriggered',
      ruleId: decision.ruleId,
      explanation: 'A family caregiver reminded the senior to take medicine, updating the medication stock and health risk.',
      actions: ['remind_senior_take_medicine', 'move_senior_to_medicine_box', 'consume_medicine_dose', 'update_wellness_signal'],
      reason: decision.reason,
      eventExplanation: {
        why: `${caregiver.id} has care responsibility and medicine is available during the morning health window.`,
        actorIds: [caregiver.id, senior.id],
        affectedDeviceIds: ['master_sleep_01'],
        affectedRoomIds: [decision.targetRoom],
        relatedIntent: 'support_health_routine',
        expectedOutcome: 'Reduce senior health risk while preserving a concrete family interaction trail.'
      }
    }));
    return events;
  }

  private applySeniorLightSupport(decision: SocialDecision): TwinEvent[] {
    if (
      this.state.triggeredRules.has(decision.ruleId) ||
      !decision.targetRoom ||
      !decision.targetActivity ||
      !decision.conversationTopic
    ) {
      return [];
    }
    const [caregiverId, seniorId] = decision.actorIds;
    const caregiver = caregiverId ? this.state.snapshot.people[caregiverId] : undefined;
    const senior = seniorId ? this.state.snapshot.people[seniorId] : undefined;
    const lightDeviceId = roomLightDevices[decision.targetRoom];
    const lightDevice = lightDeviceId ? this.state.snapshot.devices[lightDeviceId] : undefined;
    if (!caregiver || !senior || !lightDeviceId || !lightDevice || caregiver.location === 'away' || senior.location !== decision.targetRoom || lightDevice.state.power === 'on') {
      return [];
    }

    this.state.triggeredRules.add(decision.ruleId);
    const events: TwinEvent[] = [
      this.createEvent(createConversationDraft({
        conversationId: `${decision.ruleId}_${this.state.snapshot.simClock.sequence + 1}`,
        currentTime: this.state.snapshot.simClock.currentTime,
        speakerId: caregiver.id,
        listenerIds: [senior.id],
        topic: decision.conversationTopic,
        intent: 'support_senior_comfort',
        roomId: caregiver.location,
        summary: `${caregiver.id} turns on the room light for ${senior.id}.`,
        reason: decision.reason
      }))
    ];
    events.push(...this.createRoutedPersonMovedEvents(caregiver.id, decision.targetRoom, decision.targetActivity, decision.reason));
    events.push(this.setDeviceState(lightDeviceId, { power: 'on', brightness: 56 }, 'social:senior_light_support:room_light'));
    events.push(this.createEvent({
      type: 'AutomationTriggered',
      ruleId: decision.ruleId,
      explanation: 'A caregiver noticed the senior needed room lighting and turned on the light for them.',
      actions: ['notice_senior_needs_light', 'move_caregiver_to_room', 'turn_on_room_light_for_senior'],
      reason: decision.reason,
      eventExplanation: {
        why: `${caregiver.id} has senior care responsibility while ${senior.id} is in a dark ${decision.targetRoom}.`,
        actorIds: [caregiver.id, senior.id],
        affectedDeviceIds: [lightDeviceId],
        affectedRoomIds: [decision.targetRoom],
        relatedIntent: 'support_senior_comfort',
        expectedOutcome: 'Represent one household member helping another instead of anonymous automatic lighting.'
      }
    }));
    return events;
  }

  private applySeniorPhoneFetch(decision: SocialDecision): TwinEvent[] {
    if (
      this.state.triggeredRules.has(decision.ruleId) ||
      !decision.targetRoom ||
      !decision.targetActivity ||
      !decision.conversationTopic
    ) {
      return [];
    }
    const [caregiverId, seniorId] = decision.actorIds;
    const caregiver = caregiverId ? this.state.snapshot.people[caregiverId] : undefined;
    const senior = seniorId ? this.state.snapshot.people[seniorId] : undefined;
    const phoneLocation = this.state.snapshot.worldState.objectLocations.family_phone ?? 'living_room';
    if (
      !caregiver ||
      !senior ||
      caregiver.location === 'away' ||
      senior.location !== decision.targetRoom ||
      phoneLocation === decision.targetRoom
    ) {
      return [];
    }

    this.state.triggeredRules.add(decision.ruleId);
    const events: TwinEvent[] = [
      this.createEvent(createConversationDraft({
        conversationId: `${decision.ruleId}_${this.state.snapshot.simClock.sequence + 1}`,
        currentTime: this.state.snapshot.simClock.currentTime,
        speakerId: caregiver.id,
        listenerIds: [senior.id],
        topic: decision.conversationTopic,
        intent: 'support_senior_comfort',
        roomId: caregiver.location,
        summary: `${caregiver.id} fetches the family phone for ${senior.id}.`,
        reason: decision.reason
      }))
    ];

    events.push(...this.createRoutedPersonMovedEvents(caregiver.id, phoneLocation, 'fetch_family_phone', decision.reason));
    events.push(...this.createRoutedPersonMovedEvents(caregiver.id, decision.targetRoom, decision.targetActivity, decision.reason));
    events.push(this.moveObject('family_phone', phoneLocation, decision.targetRoom, caregiver.id, decision.reason));
    this.state.snapshot.worldState.objectLocations.family_phone = decision.targetRoom;
    events.push(this.createEvent({
      type: 'AutomationTriggered',
      ruleId: decision.ruleId,
      explanation: 'A caregiver fetched the family phone and brought it to the senior.',
      actions: ['notice_senior_needs_phone', 'move_caregiver_to_family_phone', 'bring_family_phone_to_senior'],
      reason: decision.reason,
      eventExplanation: {
        why: `${caregiver.id} has senior care responsibility while ${senior.id} needs the family phone in ${decision.targetRoom}.`,
        actorIds: [caregiver.id, senior.id],
        affectedDeviceIds: [],
        affectedRoomIds: Array.from(new Set([phoneLocation, decision.targetRoom])),
        relatedIntent: 'support_senior_comfort',
        expectedOutcome: 'Represent one household member fetching an object for another with concrete movement and object state.'
      }
    }));
    return events;
  }

  private applySharedResourceContention(decision: SocialDecision): TwinEvent[] {
    if (this.state.triggeredRules.has(`${decision.ruleId}:${decision.resourceId}`) || !decision.resourceId) {
      return [];
    }
    this.state.triggeredRules.add(`${decision.ruleId}:${decision.resourceId}`);
    const winnerId = decision.actorIds[0];
    const waitingIds = decision.actorIds.slice(1);
    const winner = winnerId ? this.state.snapshot.people[winnerId] : undefined;
    const events: TwinEvent[] = [];
    if (winner && waitingIds.length > 0) {
      events.push(this.createEvent(createConversationDraft({
        conversationId: `${decision.ruleId}_${decision.resourceId}_${this.state.snapshot.simClock.sequence + 1}`,
        currentTime: this.state.snapshot.simClock.currentTime,
        speakerId: winner.id,
        listenerIds: waitingIds,
        topic: 'resource_contention',
        intent: 'coordinate_shared_resource',
        roomId: winner.location === 'away' ? this.roomForSharedResource(decision.resourceId) : winner.location,
        summary: `${winner.id} keeps ${decision.resourceId} while ${waitingIds.join(', ')} waits.`,
        reason: decision.reason
      })));
    }
    for (const personId of waitingIds) {
      const person = this.state.snapshot.people[personId];
      if (!person || person.location === 'away' || !decision.targetActivity) {
        continue;
      }
      person.activity = decision.targetActivity;
      this.updatePersonBehavior(person.id);
    }
    events.push(
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: decision.ruleId,
        explanation: `The household detected contention for ${decision.resourceId} and queued lower-priority use.`,
        actions: ['prioritize_current_resource_user', 'queue_shared_resource_request'],
        reason: decision.reason,
        eventExplanation: {
          why: `${decision.actorIds.join(', ')} requested ${decision.resourceId} at the same time.`,
          actorIds: decision.actorIds,
          affectedDeviceIds: [],
          affectedRoomIds: [this.roomForSharedResource(decision.resourceId)],
          relatedIntent: 'coordinate_shared_resource',
          expectedOutcome: 'Avoid unrealistic simultaneous use of a constrained household resource.'
        }
      })
    );
    return events;
  }

  private roomForSharedResource(resourceId: string): RoomId {
    if (resourceId === 'bathroom_sink') {
      return 'bathroom';
    }
    if (resourceId === 'quiet_study') {
      return 'study';
    }
    if (resourceId === 'tv_01') {
      return 'living_room';
    }
    if (resourceId === 'kitchen_stove') {
      return 'kitchen';
    }
    return 'living_room';
  }

  private estimateChildTaskPressure(): number {
    const child = this.state.snapshot.people.child_1;
    if (!child || child.location === 'away') {
      return 0;
    }
    if (child.activity === 'homework') {
      return 48;
    }
    const minuteOfDay = minuteOfDayFromTime(this.state.snapshot.simClock.currentTime);
    if (minuteOfDay >= 16 * 60 && minuteOfDay <= 20 * 60 && ['watching_tv', 'playing', 'weekend_play'].includes(child.activity)) {
      return 86;
    }
    return 42;
  }

  private applyHumanActivityLighting(): TwinEvent[] {
    const events: TwinEvent[] = [];
    const humanRooms = new Set<RoomId>();
    for (const person of Object.values(this.state.snapshot.people)) {
      if (person.kind !== 'human' || person.location === 'away' || person.activity === 'sleeping') {
        continue;
      }
      const profile = behaviorProfiles[person.id];
      humanRooms.add(person.location);
      this.state.profileLitRooms.add(person.location);

      const lightDeviceId = roomLightDevices[person.location];
      const lightDevice = lightDeviceId ? this.state.snapshot.devices[lightDeviceId] : undefined;
      if (lightDeviceId && lightDevice && lightDevice.state.power !== 'on') {
        const brightness = profile?.activeLightLevel ?? 64;
        const event = this.setDeviceStateIfChanged(lightDeviceId, { power: 'on', brightness }, `habit:${person.id}:${person.activity}:lights_on`);
        if (event) {
          events.push(event);
        }
      }
    }

    for (const roomId of [...this.state.profileLitRooms]) {
      if (humanRooms.has(roomId)) {
        continue;
      }
      this.state.profileLitRooms.delete(roomId);
      const lightDeviceId = roomLightDevices[roomId];
      const lightDevice = lightDeviceId ? this.state.snapshot.devices[lightDeviceId] : undefined;
      if (lightDeviceId && lightDevice?.lastReason.startsWith('habit:')) {
        const event = this.setDeviceStateIfChanged(lightDeviceId, { power: 'off', brightness: 0 }, `habit:${roomId}:vacant_lights_off`);
        if (event) {
          events.push(event);
        }
      }
    }

    return events;
  }

  private applyPetGardenSafety(): TwinEvent[] {
    const pet = this.state.snapshot.people.pet_1;
    const sprinkler = this.state.snapshot.devices.sprinkler_01;
    if (!pet || pet.location !== 'garden' || sprinkler?.state.valveOpen !== true) {
      return [];
    }

    const stateEvent = this.setDeviceStateIfChanged('sprinkler_01', { valveOpen: false }, 'habit:pet_1:garden:sprinkler_pause');
    if (!stateEvent) {
      return [];
    }

    return [
      stateEvent,
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'pet_garden_sprinkler_pause',
        explanation: 'Pet movement is detected in the garden, so watering pauses to keep the zone safe.',
        actions: ['pause_garden_sprinkler'],
        reason: 'habit:pet_1:garden',
        eventExplanation: {
          why: 'pet_1 is in pet_patrol with intent explore_home.',
          actorIds: ['pet_1'],
          affectedDeviceIds: ['sprinkler_01'],
          affectedRoomIds: ['garden'],
          relatedIntent: 'explore_home',
          expectedOutcome: 'Pause watering while the pet is inside the sprinkler zone.'
        }
      })
    ];
  }

  private applyCommuterArrivalScene(): TwinEvent[] {
    const commuter = this.state.snapshot.people.adult_1;
    if (
      !commuter ||
      commuter.location !== 'living_room' ||
      commuter.activity !== 'arrived_home' ||
      this.state.triggeredRules.has('commuter_arrival_scene')
    ) {
      return [];
    }

    this.state.triggeredRules.add('commuter_arrival_scene');
    return [
      this.setDeviceState('living_light_01', { power: 'on', brightness: 58 }, 'habit:adult_1:arrived_home:arrival_scene'),
      this.setDeviceState('living_curtain_01', { positionPercent: 35 }, 'habit:adult_1:arrived_home:privacy'),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'commuter_arrival_scene',
        explanation: 'Adult 1 has arrived home, so the twin sets a modest living-room arrival scene.',
        actions: ['set_living_light_arrival_level', 'lower_living_curtain_for_evening_privacy'],
        reason: 'habit:adult_1:arrived_home',
        eventExplanation: {
          why: 'adult_1 is in evening_return with intent decompress_after_commute.',
          actorIds: ['adult_1'],
          affectedDeviceIds: ['living_light_01', 'living_curtain_01'],
          affectedRoomIds: ['living_room'],
          relatedIntent: 'decompress_after_commute',
          expectedOutcome: 'Prepare a calm living-room arrival state after the commute.'
        }
      })
    ];
  }

  private applyChildHomeworkFocus(): TwinEvent[] {
    const child = this.state.snapshot.people.child_1;
    if (
      !child ||
      child.location !== 'child_bedroom' ||
      child.activity !== 'homework' ||
      this.state.triggeredRules.has('child_homework_focus')
    ) {
      return [];
    }

    this.state.triggeredRules.add('child_homework_focus');
    return [
      this.setDeviceState('child_sleep_01', { inBed: false, heartRateSimulated: 78 }, 'habit:child_1:homework:desk_time'),
      this.setDeviceState('tv_01', { power: 'off', app: null, volume: 0 }, 'habit:child_1:homework:quiet_focus'),
      this.setDeviceState('living_light_01', { power: 'on', brightness: 32 }, 'habit:child_1:homework:reduce_living_room_distraction'),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'child_homework_focus',
        explanation: 'The student is doing homework, so entertainment is kept quiet and the bedroom sleep pad reflects desk time.',
        actions: ['mark_child_out_of_bed', 'turn_off_tv_for_homework', 'dim_living_light_for_homework'],
        reason: 'habit:child_1:homework',
        eventExplanation: {
          why: 'child_1 is in after_school with intent finish_homework.',
          actorIds: ['child_1'],
          affectedDeviceIds: ['child_sleep_01', 'tv_01', 'living_light_01'],
          affectedRoomIds: ['child_bedroom', 'living_room'],
          relatedIntent: 'finish_homework',
          expectedOutcome: 'Reduce entertainment distraction while the student finishes homework.'
        }
      })
    ];
  }

  private applyRemoteWorkComfort(): TwinEvent[] {
    const worker = this.state.snapshot.people.adult_2;
    if (!worker || worker.location !== 'study' || worker.activity !== 'remote_work') {
      return [];
    }

    this.state.profileLitRooms.add('study');
    if (this.state.triggeredRules.has('remote_work_comfort')) {
      return [];
    }

    this.state.triggeredRules.add('remote_work_comfort');
    return [
      this.setDeviceState('study_co2_01', { co2: 680 }, 'habit:adult_2:remote_work:comfort'),
      this.setDeviceState('router_01', { online: true, latencyMs: 42 }, 'habit:adult_2:remote_work:network_load'),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'remote_work_comfort',
        explanation: 'Adult 2 is working from the study, so the twin raises study comfort and network context.',
        actions: ['mark_study_active', 'track_study_co2', 'track_router_load', 'prioritize_router_for_video_calls', 'enable_focus_notification_policy'],
        reason: 'habit:adult_2:remote_work',
        eventExplanation: {
          why: 'adult_2 is in workday with intent focused_remote_work.',
          actorIds: ['adult_2'],
          affectedDeviceIds: ['study_co2_01', 'router_01'],
          affectedRoomIds: ['study'],
          relatedIntent: 'focused_remote_work',
          expectedOutcome: 'Keep the study comfortable and network state visible during remote work.'
        }
      })
    ];
  }

  private applyFamilyDinnerReadiness(): TwinEvent[] {
    const adult = this.state.snapshot.people.adult_1;
    const dinner = this.state.snapshot.activities.family_dinner;
    if (
      !adult ||
      adult.activity !== 'dinner' ||
      adult.location !== 'dining_room' ||
      !dinner ||
      this.state.triggeredRules.has('family_dinner_readiness')
    ) {
      return [];
    }

    this.state.triggeredRules.add('family_dinner_readiness');
    return [
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'family_dinner_readiness',
        explanation: 'Adult 1 has joined family dinner, so the twin confirms dining comfort and nearby kitchen appliance safety.',
        actions: ['confirm_fridge_closed', 'confirm_stove_safe', 'set_dining_light_for_family_dinner'],
        reason: 'habit:adult_1:dinner',
        eventExplanation: {
          why: 'adult_1 is in evening meal with intent family dinner.',
          actorIds: ['adult_1'],
          affectedDeviceIds: ['fridge_01', 'stove_01', 'dining_light_01'],
          affectedRoomIds: ['kitchen', 'dining_room'],
          relatedIntent: 'family_time',
          expectedOutcome: 'Keep dinner comfortable while confirming kitchen appliance risk is low.'
        }
      })
    ];
  }

  private applySeniorMorningSupport(): TwinEvent[] {
    const senior = this.state.snapshot.people.senior_1;
    if (
      !senior ||
      senior.location !== 'master_bedroom' ||
      senior.activity !== 'morning_rest' ||
      this.state.snapshot.homeState.mode === 'sleeping' ||
      this.state.triggeredRules.has('senior_morning_support')
    ) {
      return [];
    }

    this.state.triggeredRules.add('senior_morning_support');
    return [
      this.setDeviceState('master_ac_01', { power: 'on', targetC: 25, mode: 'auto' }, 'habit:senior_1:morning_rest:bedroom_comfort'),
      this.setDeviceState('master_sleep_01', { inBed: true, heartRateSimulated: 62 }, 'habit:senior_1:morning_rest:activity_watch'),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'senior_morning_support',
        explanation: 'Senior morning rest continues, so the twin keeps the bedroom comfortable and prepares a family check-in path.',
        actions: ['set_bedroom_comfort_for_senior', 'watch_sleep_activity_sensor', 'prepare_family_check_in'],
        reason: 'habit:senior_1:morning_rest',
        eventExplanation: {
          why: 'senior_1 is still in morning rest, so the twin prepares a gentle support path before raising an alert.',
          actorIds: ['senior_1'],
          affectedDeviceIds: ['master_ac_01', 'master_sleep_01'],
          affectedRoomIds: ['master_bedroom'],
          relatedIntent: 'steady_routine',
          expectedOutcome: 'Keep the bedroom comfortable while making a family check-in easy if activity stays low.'
        }
      })
    ];
  }

  private applySeniorGardenCare(): TwinEvent[] {
    const senior = this.state.snapshot.people.senior_1;
    const sprinkler = this.state.snapshot.devices.sprinkler_01;
    if (
      !senior ||
      senior.location !== 'garden' ||
      !['gardening', 'plant_care'].includes(senior.activity) ||
      sprinkler?.state.valveOpen === true ||
      this.state.triggeredRules.has('senior_garden_care')
    ) {
      return [];
    }

    this.state.triggeredRules.add('senior_garden_care');
    const soil = this.state.snapshot.devices.garden_soil_01;
    const moisturePercent = this.round(this.clamp(Number(soil.state.moisturePercent ?? 38) + 2.4, 20, 75));
    return [
      this.setDeviceState('sprinkler_01', { valveOpen: true }, `habit:senior_1:${senior.activity}:garden_care`),
      this.setDeviceState('garden_soil_01', { moisturePercent }, `habit:senior_1:${senior.activity}:soil_check`),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'senior_garden_care',
        explanation: 'Senior garden activity is active, so the twin starts a short watering assist and updates soil context.',
        actions: ['start_garden_sprinkler', 'update_soil_moisture_context'],
        reason: `habit:senior_1:${senior.activity}`,
        eventExplanation: {
          why: 'senior_1 is in daytime_care with intent care_for_plants.',
          actorIds: ['senior_1'],
          affectedDeviceIds: ['sprinkler_01', 'garden_soil_01'],
          affectedRoomIds: ['garden'],
          relatedIntent: 'care_for_plants',
          expectedOutcome: 'Assist plant care while keeping soil context current.'
        }
      })
    ];
  }

  private applySeniorWellnessCheck(): TwinEvent[] {
    const senior = this.state.snapshot.people.senior_1;
    if (
      !senior ||
      this.state.elapsedMinutes < 120 ||
      this.state.triggeredRules.has('senior_wellness_check') ||
      senior.location !== 'master_bedroom' ||
      !['sleeping', 'morning_rest', 'idle'].includes(senior.activity)
    ) {
      return [];
    }

    this.state.triggeredRules.add('senior_wellness_check');
    return [
      this.createAlertEvent(
        'senior_inactive_001',
        'info',
        'master_bedroom',
        'Senior has not started normal morning activity yet',
        'check_in_with_senior',
        'habit:senior_1:no_morning_activity'
      ),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'senior_wellness_check',
        explanation: 'Senior morning activity has not started within the expected window.',
        actions: ['raise_wellness_signal', 'prepare_check_in'],
        reason: 'habit:senior_1:no_morning_activity'
      })
    ];
  }

  private syncMotionSensors(): TwinEvent[] {
    const events: TwinEvent[] = [];
    const sensors: Array<{ deviceId: string; roomId: RoomId }> = [
      { deviceId: 'entrance_motion_01', roomId: 'entrance' },
      { deviceId: 'living_motion_01', roomId: 'living_room' }
    ];

    for (const sensor of sensors) {
      const room = this.state.snapshot.rooms[sensor.roomId];
      const observation = observeMotionSensor({
        deviceId: sensor.deviceId,
        roomId: sensor.roomId,
        deviceType: 'motion_sensor',
        worldState: {
          humanOccupancy: room.humanOccupancy,
          petOccupancy: room.people.some((personId) => this.state.snapshot.people[personId]?.kind === 'pet'),
          motionDetected: room.motionDetected
        },
        previousObservation: this.state.sensorObservations.get(sensor.deviceId),
        currentTime: this.state.snapshot.simClock.currentTime,
        randomSeed: this.state.random.getState()
      }, getSensorProfile('motion_sensor'));
      if (!observation) {
        continue;
      }
      this.state.sensorObservations.set(sensor.deviceId, observation.observedState);
      const telemetryEvent = this.createTelemetryEventFromObservation(observation);
      events.push(telemetryEvent);
      for (const additionalEvent of observation.additionalEvents ?? []) {
        events.push(this.createEvent(additionalEvent));
      }

      const patch = telemetryMeasurementsToDeviceState(observation.event.measurements);
      if (Object.keys(patch).length > 0) {
        const stateEvent = this.setDeviceStateIfChanged(sensor.deviceId, patch, `sensor:motion:${room.humanOccupancy ? 'human' : 'non_human'}:${sensor.roomId}`);
        if (stateEvent) {
          events.push(stateEvent);
        }
      }
    }

    return events;
  }

  private syncSecurityCameras(): TwinEvent[] {
    return [
      ...this.syncSecurityCameraMotion('doorbell_camera_01', 'entrance'),
      ...this.syncSecurityCameraMotion('garden_camera_01', 'garden')
    ];
  }

  private syncSecurityCameraMotion(deviceId: 'doorbell_camera_01' | 'garden_camera_01', roomId: RoomId): TwinEvent[] {
    const room = this.state.snapshot.rooms[roomId];
    const observation = observeMotionSensor({
      deviceId,
      roomId,
      deviceType: this.state.snapshot.devices[deviceId].type,
      worldState: {
        humanOccupancy: room.humanOccupancy,
        petOccupancy: room.people.some((personId) => this.state.snapshot.people[personId]?.kind === 'pet'),
        motionDetected: room.motionDetected
      },
      previousObservation: this.state.sensorObservations.get(deviceId),
      currentTime: this.state.snapshot.simClock.currentTime,
      randomSeed: this.state.random.getState()
    }, getSensorProfile(this.state.snapshot.devices[deviceId].type));

    if (!observation) {
      return [];
    }

    this.state.sensorObservations.set(deviceId, observation.observedState);
    const events: TwinEvent[] = [this.createTelemetryEventFromObservation(observation)];
    for (const additionalEvent of observation.additionalEvents ?? []) {
      events.push(this.createEvent(additionalEvent));
    }

    const motion = observation.event.measurements.motion;
    if (typeof motion !== 'boolean') {
      return events;
    }

    const patch: Record<string, string | number | boolean | null> = deviceId === 'doorbell_camera_01'
      ? { motion, ringing: false }
      : { motion, recording: motion };
    const stateEvent = this.setDeviceStateIfChanged(deviceId, patch, `sensor:camera:${motion ? 'motion' : 'clear'}:${roomId}`);
    if (stateEvent) {
      events.push(stateEvent);
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
      const events = this.createRoutedPersonMovedEvents(action.personId, action.to, action.activity);
      this.applyActivityEffectsToPerson(action.personId, action.activity);
      return events;
    }

    if (action.kind === 'setHomeMode') {
      this.state.snapshot.homeState.mode = action.mode;
      this.updateAllPersonBehavior();
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
      for (const participantId of action.participants) {
        this.applyActivityEffectsToPerson(participantId, action.activityId);
      }
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
        reason: 'kitchen_occupied_and_stove_power',
        eventExplanation: {
          why: 'Kitchen occupancy and stove power indicate active cooking.',
          actorIds: peopleInRoom(snapshot, 'kitchen'),
          affectedDeviceIds: ['range_hood_01', 'kitchen_light_01', 'stove_01'],
          affectedRoomIds: ['kitchen'],
          expectedOutcome: 'Ventilate cooking byproducts and keep the work area lit.'
        }
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
        reason: 'stove_power_without_kitchen_occupancy',
        eventExplanation: {
          why: 'The stove is drawing high power while no one is in the kitchen.',
          actorIds: [],
          affectedDeviceIds: ['stove_01'],
          affectedRoomIds: ['kitchen'],
          expectedOutcome: 'Remove unattended cooking risk before it escalates.'
        }
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
        reason: 'occupancy_count:0',
        eventExplanation: {
          why: 'All human family members are away and the entrance is secured.',
          actorIds: ['adult_1', 'adult_2', 'child_1', 'senior_1'],
          affectedDeviceIds: ['door_lock_01', 'living_light_01', 'tv_01'],
          affectedRoomIds: ['entrance', 'living_room'],
          expectedOutcome: 'Reduce unattended energy use and keep security armed.'
        }
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
        reason: 'water_leak_sensor:true',
        eventExplanation: {
          why: 'The bathroom leak sensor is active while the household is sleeping.',
          actorIds: [],
          affectedDeviceIds: ['water_leak_01', 'water_valve_01'],
          affectedRoomIds: ['bathroom'],
          expectedOutcome: 'Stop water flow and raise an urgent leak response workflow.'
        }
      }));
    }

    if (
      snapshot.devices.fridge_01.state.doorOpen === true &&
      ['opened', 'still_open', 'alert'].includes(String(snapshot.devices.fridge_01.state.lifecyclePhase ?? '')) &&
      this.canTriggerRule('fridge_left_open')
    ) {
      this.activateRule('fridge_left_open');
      const policy = alertEscalationPolicies.fridge_left_open;
      events.push(this.createAlertEvent(policy.alertId, policy.initialSeverity, 'kitchen', 'Fridge door has remained open', policy.recommendedAction, 'rule:fridge_left_open'));
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'fridge_left_open',
        explanation: 'The fridge reported doorOpen=true, so the twin raised a kitchen appliance warning.',
        actions: ['notify_close_fridge_door', 'track_fridge_power'],
        reason: 'fridge_01.doorOpen:true',
        eventExplanation: {
          why: 'The fridge door remains open and power draw is elevated.',
          actorIds: peopleInRoom(snapshot, 'kitchen'),
          affectedDeviceIds: ['fridge_01'],
          affectedRoomIds: ['kitchen'],
          expectedOutcome: 'Prompt a household member to close the fridge before energy use and temperature drift escalate.'
        }
      }));
    }

    if (
      snapshot.devices.router_01.state.online === false &&
      snapshot.devices.router_01.lastReason === 'abnormality:network_offline' &&
      this.canTriggerRule('network_offline')
    ) {
      this.activateRule('network_offline');
      const policy = alertEscalationPolicies.network_offline;
      events.push(this.createAlertEvent(policy.alertId, policy.initialSeverity, 'study', 'Home network is offline', policy.recommendedAction, 'rule:network_offline'));
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'network_offline',
        explanation: 'The router reported offline, so the twin prepared a network recovery recommendation.',
        actions: ['notify_network_offline', 'recommend_router_restart'],
        reason: 'router_01.online:false',
        eventExplanation: {
          why: 'router_01 is offline while household routines depend on connectivity.',
          actorIds: ['adult_2'],
          affectedDeviceIds: ['router_01'],
          affectedRoomIds: ['study'],
          relatedIntent: 'focused_remote_work',
          expectedOutcome: 'Route attention to the study and restore network service.'
        }
      }));
    }

    if (
      snapshot.devices.door_lock_01.state.locked === false &&
      snapshot.devices.doorbell_camera_01.state.motion === true &&
      snapshot.devices.door_lock_01.lastReason === 'abnormality:door_left_open' &&
      this.canTriggerRule('door_left_open')
    ) {
      this.activateRule('door_left_open');
      const policy = alertEscalationPolicies.door_left_open;
      events.push(this.createAlertEvent(policy.alertId, policy.initialSeverity, 'entrance', 'Front door has remained open', policy.recommendedAction, 'rule:door_left_open'));
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'door_left_open',
        explanation: 'The front lock is unlocked while entrance camera motion is active.',
        actions: ['notify_front_door', 'focus_entrance_camera'],
        reason: 'door_lock_01.locked:false',
        eventExplanation: {
          why: 'The entrance door is unlocked while entrance motion is active.',
          actorIds: [],
          affectedDeviceIds: ['door_lock_01', 'doorbell_camera_01'],
          affectedRoomIds: ['entrance'],
          expectedOutcome: 'Focus the entrance and prompt someone to secure the door.'
        }
      }));
    }

    if (
      snapshot.people.senior_1?.activity === 'no_activity' &&
      snapshot.devices.master_sleep_01.state.inBed === true &&
      this.canTriggerRule('senior_no_activity')
    ) {
      this.activateRule('senior_no_activity');
      const policy = alertEscalationPolicies.senior_no_activity;
      events.push(this.createAlertEvent(policy.alertId, policy.initialSeverity, 'master_bedroom', 'Senior has no morning activity yet', policy.recommendedAction, 'rule:senior_no_activity'));
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'senior_no_activity',
        explanation: 'The senior activity fact remains no_activity while the sleep sensor still reports in bed.',
        actions: ['prepare_check_in', 'notify_caregiver'],
        reason: 'senior_1.activity:no_activity',
        eventExplanation: {
          why: 'senior_1 remains in wellness_watch with no morning activity.',
          actorIds: ['senior_1'],
          affectedDeviceIds: ['master_sleep_01'],
          affectedRoomIds: ['master_bedroom'],
          relatedIntent: 'needs_check_in',
          expectedOutcome: 'Create a privacy-preserving check-in workflow for the senior family member.'
        }
      }));
    }

    return events;
  }

  private generateTelemetry(): TwinEvent[] {
    const events: TwinEvent[] = [];
    for (const device of this.state.catalog.devices) {
      if (!['temperature_humidity_sensor', 'air_quality_sensor', 'water_flow_sensor', 'soil_moisture_sensor', 'fridge', 'door_lock', 'water_leak_sensor', 'sleep_sensor', 'router', 'stove', 'dishwasher', 'washer'].includes(device.type)) {
        continue;
      }
      const state = this.state.snapshot.devices[device.id].state;
      const measurements: Record<string, number | boolean> = {};
      let sensorObservation: SensorObservation | null = null;
      if (device.type === 'temperature_humidity_sensor') {
        const room = this.state.snapshot.rooms[device.roomId];
        const roomOccupied = room.humanOccupancy;
        const stoveHeat = device.roomId === 'kitchen' ? Number(this.state.snapshot.devices.stove_01.state.powerW ?? 0) / 9000 : 0;
        const worldTemperatureC = this.round(this.clamp((Number(room.temperatureC) || Number(state.temperatureC) || 25) + this.state.random.range(-0.12, 0.18) + (roomOccupied ? 0.03 : -0.02) + stoveHeat, 17, 31));
        const worldHumidityPercent = this.round(this.clamp((Number(room.humidityPercent) || Number(state.humidityPercent) || 55) + this.state.random.range(-0.25, 0.35) + (roomOccupied ? 0.04 : -0.03), 35, 78));
        sensorObservation = observeEnvironmentSensor({
          deviceId: device.id,
          roomId: device.roomId,
          deviceType: device.type,
          worldState: {
            temperatureC: worldTemperatureC,
            humidityPercent: worldHumidityPercent
          },
          previousObservation: this.state.sensorObservations.get(device.id),
          currentTime: this.state.snapshot.simClock.currentTime,
          randomSeed: this.state.random.getState()
        }, withSensorProfileOverrides(getSensorProfile(device.type), { samplingIntervalSec: 1 }));
        if (!sensorObservation) {
          continue;
        }
        Object.assign(measurements, sensorObservation.event.measurements);
        if (typeof measurements.temperature_c === 'number') {
          state.temperatureC = measurements.temperature_c;
        }
        if (typeof measurements.humidity_percent === 'number') {
          state.humidityPercent = measurements.humidity_percent;
        }
        room.temperatureC = worldTemperatureC;
        room.humidityPercent = worldHumidityPercent;
      } else if (device.type === 'air_quality_sensor') {
        const cooking = this.state.snapshot.activities.breakfast || this.state.snapshot.activities.cooking_dinner;
        const humanOccupancy = this.state.snapshot.rooms[device.roomId].people
          .filter((personId) => this.state.snapshot.people[personId]?.kind === 'human')
          .length;
        const remoteWorkLoad = device.roomId === 'study' && this.state.snapshot.people.adult_2?.location === 'study' && this.state.snapshot.people.adult_2.activity === 'remote_work' ? 145 : 0;
        const worldPm25 = this.round(this.clamp((cooking ? 18 : 8) + this.state.random.range(-1, 1), 2, 60));
        const worldCo2 = this.round(this.clamp((cooking ? 690 : 530) + humanOccupancy * 42 + remoteWorkLoad + this.state.random.range(-8, 8), 420, 1200));
        sensorObservation = observeEnvironmentSensor({
          deviceId: device.id,
          roomId: device.roomId,
          deviceType: device.type,
          worldState: {
            pm25: worldPm25,
            co2: worldCo2
          },
          previousObservation: this.state.sensorObservations.get(device.id),
          currentTime: this.state.snapshot.simClock.currentTime,
          randomSeed: this.state.random.getState()
        }, withSensorProfileOverrides(getSensorProfile(device.type), { samplingIntervalSec: 1 }));
        if (!sensorObservation) {
          continue;
        }
        Object.assign(measurements, sensorObservation.event.measurements);
        if (typeof measurements.pm25 === 'number') {
          state.pm25 = measurements.pm25;
        }
        if (typeof measurements.co2 === 'number') {
          state.co2 = measurements.co2;
        }
      } else if (device.type === 'fridge' || device.type === 'door_lock') {
        const contactOpen = device.type === 'fridge'
          ? state.doorOpen === true
          : state.locked === false;
        sensorObservation = observeContactSensor({
          deviceId: device.id,
          roomId: device.roomId,
          deviceType: device.type,
          worldState: {
            contactOpen
          },
          previousObservation: this.state.sensorObservations.get(device.id),
          currentTime: this.state.snapshot.simClock.currentTime,
          randomSeed: this.state.random.getState()
        }, withSensorProfileOverrides(getSensorProfile('contact_sensor'), { samplingIntervalSec: 1 }));
        if (!sensorObservation) {
          continue;
        }
        Object.assign(measurements, sensorObservation.event.measurements);
      } else if (device.type === 'water_leak_sensor') {
        sensorObservation = observeBinarySensor({
          deviceId: device.id,
          roomId: device.roomId,
          deviceType: device.type,
          worldState: {
            leakDetected: state.leakDetected === true
          },
          previousObservation: this.state.sensorObservations.get(device.id),
          currentTime: this.state.snapshot.simClock.currentTime,
          randomSeed: this.state.random.getState()
        }, withSensorProfileOverrides(getSensorProfile(device.type), { samplingIntervalSec: 1 }), {
          worldKey: 'leakDetected',
          measurementName: 'leak_detected'
        });
        if (!sensorObservation) {
          continue;
        }
        Object.assign(measurements, sensorObservation.event.measurements);
      } else if (device.type === 'sleep_sensor') {
        sensorObservation = observeBinarySensor({
          deviceId: device.id,
          roomId: device.roomId,
          deviceType: device.type,
          worldState: {
            inBed: state.inBed === true
          },
          previousObservation: this.state.sensorObservations.get(device.id),
          currentTime: this.state.snapshot.simClock.currentTime,
          randomSeed: this.state.random.getState()
        }, withSensorProfileOverrides(getSensorProfile(device.type), { samplingIntervalSec: 1 }), {
          worldKey: 'inBed',
          measurementName: 'in_bed'
        });
        if (!sensorObservation) {
          continue;
        }
        Object.assign(measurements, sensorObservation.event.measurements);
      } else if (device.type === 'router') {
        const previousObservation = this.state.sensorObservations.get(device.id);
        const routerProfile = withSensorProfileOverrides(getSensorProfile(device.type), { samplingIntervalSec: 1 });
        const onlineObservation = observeBinarySensor({
          deviceId: device.id,
          roomId: device.roomId,
          deviceType: device.type,
          worldState: {
            online: state.online === true
          },
          previousObservation,
          currentTime: this.state.snapshot.simClock.currentTime,
          randomSeed: this.state.random.getState()
        }, routerProfile, {
          worldKey: 'online',
          measurementName: 'online',
          inactiveValue: true
        });
        const latencyObservation = observeNumericSensor({
          deviceId: device.id,
          roomId: device.roomId,
          deviceType: device.type,
          worldState: {
            latencyMs: Number(state.latencyMs ?? 18)
          },
          previousObservation,
          currentTime: this.state.snapshot.simClock.currentTime,
          randomSeed: this.state.random.getState()
        }, routerProfile, {
          worldKey: 'latencyMs',
          measurementName: 'latency_ms',
          inactiveValue: 18
        });
        sensorObservation = mergeSensorObservations(onlineObservation, latencyObservation);
        if (!sensorObservation) {
          continue;
        }
        Object.assign(measurements, sensorObservation.event.measurements);
      } else if (['stove', 'dishwasher', 'washer'].includes(device.type)) {
        sensorObservation = observeNumericSensor({
          deviceId: device.id,
          roomId: device.roomId,
          deviceType: device.type,
          worldState: {
            powerW: Number(state.powerW ?? 0)
          },
          previousObservation: this.state.sensorObservations.get(device.id),
          currentTime: this.state.snapshot.simClock.currentTime,
          randomSeed: this.state.random.getState()
        }, withSensorProfileOverrides(getSensorProfile('power_meter'), { samplingIntervalSec: 1 }), {
          worldKey: 'powerW',
          measurementName: 'power_w'
        });
        if (!sensorObservation) {
          continue;
        }
        Object.assign(measurements, sensorObservation.event.measurements);
      } else if (device.type === 'water_flow_sensor') {
        const roomOccupied = this.state.snapshot.rooms[device.roomId].humanOccupancy;
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
        sensorObservation = observeNumericSensor({
          deviceId: device.id,
          roomId: device.roomId,
          deviceType: device.type,
          worldState: {
            flowLMin
          },
          previousObservation: this.state.sensorObservations.get(device.id),
          currentTime: this.state.snapshot.simClock.currentTime,
          randomSeed: this.state.random.getState()
        }, withSensorProfileOverrides(getSensorProfile(device.type), { samplingIntervalSec: 1 }), {
          worldKey: 'flowLMin',
          measurementName: 'flow_l_min',
          noiseAmplitude: 0.04
        });
        if (!sensorObservation) {
          continue;
        }
        Object.assign(measurements, sensorObservation.event.measurements);
        if (typeof measurements.flow_l_min === 'number') {
          state.flowLMin = measurements.flow_l_min;
        }
      } else if (device.type === 'soil_moisture_sensor') {
        const sprinklerOn = this.state.snapshot.devices.sprinkler_01.state.valveOpen === true;
        const moisturePercent = this.round(this.clamp((Number(state.moisturePercent) || 38) + (sprinklerOn ? 0.55 : -0.03) + this.state.random.range(-0.04, 0.04), 20, 75));
        state.moisturePercent = moisturePercent;
        measurements.moisture_percent = moisturePercent;
      }
      if (sensorObservation) {
        this.state.sensorObservations.set(device.id, sensorObservation.observedState);
        events.push(this.createTelemetryEventFromObservation(sensorObservation));
        for (const additionalEvent of sensorObservation.additionalEvents ?? []) {
          events.push(this.createEvent(additionalEvent));
        }
        continue;
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

  private createTelemetryEventFromObservation(observation: SensorObservation): DeviceTelemetryEvent {
    return this.createEvent(observation.event);
  }

  private setDeviceState(deviceId: string, patch: Record<string, string | number | boolean | null>, reason: string): DeviceStateChangedEvent {
    const device = this.state.snapshot.devices[deviceId];
    let validPatch: Record<string, string | number | boolean | null>;
    try {
      validPatch = validateDeviceStatePatch(device.type, patch);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid state patch for ${deviceId} (${device.type}): ${message}`);
    }
    device.state = { ...device.state, ...validPatch };
    device.lastReason = reason;
    return this.createEvent({
      type: 'DeviceStateChanged',
      roomId: device.roomId,
      deviceId,
      deviceType: device.type,
      state: structuredClone(device.state),
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

  private canTriggerRule(ruleId: string): boolean {
    const lifecycle = this.state.ruleStates.get(ruleId);
    return !lifecycle || lifecycle.status === 'cooldown' && this.state.elapsedMinutes >= lifecycle.cooldownUntilMinute;
  }

  private activateRule(ruleId: string): void {
    this.state.triggeredRules.add(ruleId);
    this.state.ruleStates.set(ruleId, {
      status: 'active',
      cooldownUntilMinute: this.state.elapsedMinutes
    });
  }

  private recoverRuleIfActive(ruleId: string, recoveredFacts: string[]): RuleRecoveredEvent[] {
    const lifecycle = this.state.ruleStates.get(ruleId);
    if (lifecycle?.status !== 'active') {
      return [];
    }
    return [this.createRuleRecoveredEvent(ruleId, recoveredFacts)];
  }

  private recoverRuleIfActiveOrAlert(ruleId: string, recoveredFacts: string[]): RuleRecoveredEvent[] {
    const activeRecovery = this.recoverRuleIfActive(ruleId, recoveredFacts);
    if (activeRecovery.length > 0) {
      return activeRecovery;
    }
    if (!this.hasUnresolvedAlertForRule(ruleId)) {
      return [];
    }
    return [this.createRuleRecoveredEvent(ruleId, recoveredFacts)];
  }

  private createRuleRecoveredEvent(ruleId: string, recoveredFacts: string[]): RuleRecoveredEvent {
    const cooldownUntilMinute = this.state.elapsedMinutes + ruleCooldownMinutes;
    this.state.ruleStates.set(ruleId, {
      status: 'cooldown',
      cooldownUntilMinute
    });
    const cooldownUntil = new Date(this.state.snapshot.simClock.currentTime);
    cooldownUntil.setMinutes(cooldownUntil.getMinutes() + ruleCooldownMinutes);
    resolveAlertsForRule(this.state.snapshot, ruleId, this.state.snapshot.simClock.currentTime);
    return this.createEvent({
      type: 'RuleRecovered',
      ruleId,
      recoveredFacts,
      cooldownUntil: formatShanghaiTime(cooldownUntil),
      reason: `rule:${ruleId}:recovered`
    });
  }

  private hasUnresolvedAlertForRule(ruleId: string): boolean {
    const sourceAlertIds = Object.values(this.state.snapshot.alerts)
      .filter((alert) => alert.sourceRuleId === ruleId)
      .map((alert) => alert.id);
    const alertIds = sourceAlertIds.length > 0 ? sourceAlertIds : legacyAlertIdsForRule(ruleId);
    return alertIds.some((alertId) => {
      const alert = this.state.snapshot.alerts[alertId];
      return alert && (alert.status === 'active' || alert.status === 'acknowledged');
    });
  }

  private createAlertEvent(alertId: string, severity: 'info' | 'warning' | 'high', roomId: RoomId, message: string, recommendedAction: string, reason: string): AlertCreatedEvent {
    const sourceRuleId = sourceRuleIdFromReason(reason);
    const sourceEntityIds = sourceRuleId ? sourceEntityIdsForRule(sourceRuleId) : undefined;
    this.state.snapshot.alerts[alertId] = {
      id: alertId,
      severity,
      roomId,
      message,
      recommendedAction,
      status: 'active',
      createdAt: this.state.snapshot.simClock.currentTime,
      ...(sourceRuleId ? { sourceRuleId } : {}),
      ...(sourceEntityIds ? { sourceEntityIds } : {})
    };
    return this.createEvent({
      type: 'AlertCreated',
      alertId,
      severity,
      roomId,
      message,
      recommendedAction,
      ...(sourceRuleId ? { sourceRuleId } : {}),
      ...(sourceEntityIds ? { sourceEntityIds } : {}),
      reason
    });
  }

  private createRoutedPersonMovedEvents(
    personId: string,
    to: RoomId | 'away',
    activity: string,
    reason = `activity:${activity}`
  ): PersonMovedEvent[] {
    const person = this.state.snapshot.people[personId];
    if (!person) {
      return [];
    }

    const from = person.location;
    if (from === 'away' || to === 'away') {
      person.location = to;
      person.activity = activity;
      this.updatePersonBehavior(personId);
      return [this.createPersonMovedEvent(personId, from, to, activity, reason)];
    }

    const path = this.roomPath(from, to);
    if (path.length <= 1) {
      person.location = to;
      person.activity = activity;
      this.updatePersonBehavior(personId);
      return [this.createPersonMovedEvent(personId, from, to, activity, reason, 0)];
    }

    const events: PersonMovedEvent[] = [];
    for (let index = 1; index < path.length; index += 1) {
      const stepFrom = path[index - 1];
      const stepTo = path[index];
      const isFinalStep = index === path.length - 1;
      person.location = stepTo;
      person.activity = isFinalStep ? activity : `walking_to_${to}`;
      events.push(this.createPersonMovedEvent(personId, stepFrom, stepTo, person.activity, reason, 1));
    }
    this.updatePersonBehavior(personId);
    return events;
  }

  private createPersonMovedEvent(personId: string, from: RoomId | 'away', to: RoomId | 'away', activity: string, reason = `activity:${activity}`, travelMinutes?: number): PersonMovedEvent {
    return this.createEvent({
      type: 'PersonMoved',
      personId,
      from,
      to,
      activity,
      ...(travelMinutes !== undefined ? { travelMinutes } : {}),
      reason
    });
  }

  private moveObject(objectId: string, from: RoomId, to: RoomId, carriedByPersonId: string | undefined, reason: string): ObjectMovedEvent {
    return this.createEvent({
      type: 'ObjectMoved',
      objectId,
      from,
      to,
      ...(carriedByPersonId ? { carriedByPersonId } : {}),
      reason
    });
  }

  private createTimedPersonMovedEvent(personId: string, from: RoomId | 'away', to: RoomId | 'away', activity: string, reason: string, travelMinutes: number): PersonMovedEvent {
    if (travelMinutes > 0) {
      for (let minute = 0; minute < travelMinutes; minute += 1) {
        this.advanceClockOneMinute();
      }
    }
    return this.createPersonMovedEvent(personId, from, to, activity, reason, travelMinutes);
  }

  private createOperatorApproachEvents(device: DeviceState, command: string): {
    events: PersonMovedEvent[];
    context: {
      operatorId: string;
      originalLocation: RoomId;
      originalActivity: string;
    } | null;
  } {
    const operator = this.selectDeviceOperator(device.roomId);
    if (!operator) {
      return { events: [], context: null };
    }

    const from = operator.location;
    const finalActivity = `controlling_${device.id}`;
    const reason = `operator:approach_device:${device.id}:${command}`;
    if (from === 'away') {
      return { events: [], context: null };
    }
    const context = {
      operatorId: operator.id,
      originalLocation: from,
      originalActivity: operator.activity
    };
    const path = this.roomPath(from, device.roomId);
    if (path.length <= 1) {
      operator.location = device.roomId;
      operator.activity = finalActivity;
      this.updatePersonBehavior(operator.id);
      return {
        events: [this.createPersonMovedEvent(operator.id, from, device.roomId, finalActivity, reason, 0)],
        context
      };
    }

    const events: PersonMovedEvent[] = [];
    for (let index = 1; index < path.length; index += 1) {
      const stepFrom = path[index - 1];
      const stepTo = path[index];
      const isFinalStep = index === path.length - 1;
      const activity = isFinalStep ? finalActivity : `walking_to_${device.id}`;
      operator.location = stepTo;
      operator.activity = activity;
      events.push(this.createTimedPersonMovedEvent(operator.id, stepFrom, stepTo, activity, reason, 1));
    }
    this.updatePersonBehavior(operator.id);
    return { events, context };
  }

  private createOperatorReturnEvents(
    context: { operatorId: string; originalLocation: RoomId; originalActivity: string } | null,
    device: DeviceState,
    command: string
  ): PersonMovedEvent[] {
    if (!context) {
      return [];
    }
    const operator = this.state.snapshot.people[context.operatorId];
    if (!operator || operator.location === 'away') {
      return [];
    }
    const reason = `operator:return_from_device:${device.id}:${command}`;
    const path = this.roomPath(operator.location, context.originalLocation);
    if (path.length <= 1) {
      operator.activity = context.originalActivity;
      this.updatePersonBehavior(operator.id);
      return [
        this.createPersonMovedEvent(operator.id, operator.location, context.originalLocation, context.originalActivity, reason, 0)
      ];
    }

    const events: PersonMovedEvent[] = [];
    for (let index = 1; index < path.length; index += 1) {
      const stepFrom = path[index - 1];
      const stepTo = path[index];
      const isFinalStep = index === path.length - 1;
      const activity = isFinalStep ? context.originalActivity : `returning_to_${context.originalLocation}`;
      operator.location = stepTo;
      operator.activity = activity;
      events.push(this.createTimedPersonMovedEvent(operator.id, stepFrom, stepTo, activity, reason, 1));
    }
    this.updatePersonBehavior(operator.id);
    return events;
  }

  private createSeniorCheckInEvents(): TwinEvent[] {
    const caregiver = this.selectSeniorCaregiver('master_bedroom');
    if (!caregiver) {
      return [];
    }

    const reason = 'operator:senior_check_in:senior_no_activity';
    const path = caregiver.location === 'away' ? [] : this.roomPath(caregiver.location, 'master_bedroom');
    const events: TwinEvent[] = [];
    if (path.length <= 1) {
      const from = caregiver.location === 'away' ? 'master_bedroom' : caregiver.location;
      caregiver.location = 'master_bedroom';
      caregiver.activity = 'checking_senior_1';
      events.push(this.createPersonMovedEvent(caregiver.id, from, 'master_bedroom', 'checking_senior_1', reason));
    } else {
      for (let index = 1; index < path.length; index += 1) {
        const stepFrom = path[index - 1];
        const stepTo = path[index];
        const isFinalStep = index === path.length - 1;
        const activity = isFinalStep ? 'checking_senior_1' : 'walking_to_senior_1';
        caregiver.location = stepTo;
        caregiver.activity = activity;
        events.push(this.createPersonMovedEvent(caregiver.id, stepFrom, stepTo, activity, reason));
      }
    }
    this.updatePersonBehavior(caregiver.id);
    events.push(this.createEvent({
      type: 'AutomationTriggered',
      ruleId: 'senior_check_in_completed',
      explanation: 'A family member checked on the senior activity alert and confirmed a normal morning response.',
      actions: ['visit_senior_room', 'confirm_senior_activity', 'recover_senior_no_activity_alert'],
      reason,
      eventExplanation: {
        why: `${caregiver.id} responded to the senior inactivity workflow before clearing the alert.`,
        actorIds: [caregiver.id, 'senior_1'],
        affectedDeviceIds: ['master_sleep_01'],
        affectedRoomIds: ['master_bedroom'],
        relatedIntent: 'check_on_senior',
        expectedOutcome: 'Confirm the senior is responsive and recover the no-activity workflow.'
      }
    }));
    return events;
  }

  private selectDeviceOperator(roomId: RoomId): TwinSnapshot['people'][string] | null {
    const humansAtHome = Object.values(this.state.snapshot.people)
      .filter((person) => person.kind === 'human' && person.location !== 'away');
    const adultCandidates = humansAtHome.filter((person) => person.id.startsWith('adult_'));
    const candidates = adultCandidates.length > 0 ? adultCandidates : humansAtHome;
    if (candidates.length === 0) {
      return null;
    }

    return [...candidates].sort((left, right) => (
      this.operatorScore(left, roomId) - this.operatorScore(right, roomId) ||
      left.id.localeCompare(right.id)
    ))[0] ?? null;
  }

  private selectSeniorCaregiver(roomId: RoomId): TwinSnapshot['people'][string] | null {
    const candidates = Object.values(this.state.snapshot.people)
      .filter((person) => person.kind === 'human' && person.id !== 'senior_1' && person.location !== 'away');
    if (candidates.length === 0) {
      return null;
    }
    return [...candidates].sort((left, right) => (
      this.operatorScore(left, roomId) - this.operatorScore(right, roomId) ||
      left.id.localeCompare(right.id)
    ))[0] ?? null;
  }

  private operatorScore(person: TwinSnapshot['people'][string], targetRoomId: RoomId): number {
    const roomDistance = person.location === 'away' ? 100 : this.roomDistance(person.location, targetRoomId);
    const sleepPenalty = person.activity === 'sleeping' ? 20 : 0;
    return roomDistance + sleepPenalty;
  }

  private roomDistance(from: RoomId, to: RoomId): number {
    if (from === to) {
      return 0;
    }

    const visited = new Set<RoomId>([from]);
    const queue: Array<{ roomId: RoomId; distance: number }> = [{ roomId: from, distance: 0 }];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }
      for (const next of this.connectedRooms(current.roomId)) {
        if (next === to) {
          return current.distance + 1;
        }
        if (!visited.has(next)) {
          visited.add(next);
          queue.push({ roomId: next, distance: current.distance + 1 });
        }
      }
    }
    return 100;
  }

  private roomPath(from: RoomId, to: RoomId): RoomId[] {
    if (from === to) {
      return [from];
    }

    const visited = new Set<RoomId>([from]);
    const queue: Array<{ roomId: RoomId; path: RoomId[] }> = [{ roomId: from, path: [from] }];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }
      for (const next of this.connectedRooms(current.roomId)) {
        if (visited.has(next)) {
          continue;
        }
        const path = [...current.path, next];
        if (next === to) {
          return path;
        }
        visited.add(next);
        queue.push({ roomId: next, path });
      }
    }
    return [from, to];
  }

  private connectedRooms(roomId: RoomId): RoomId[] {
    const room = this.state.catalog.rooms.find((candidate) => candidate.id === roomId);
    const definitionConnections = this.homeDefinition.topology.connections.flatMap((connection) => {
      if (connection.from === roomId) return [connection.to];
      if (connection.to === roomId) return [connection.from];
      return [];
    });
    return [...new Set([...(room?.connectedRooms ?? []), ...definitionConnections])];
  }

  private recoverRuleForDeviceCommand(deviceId: string, command: string): RuleRecoveredEvent[] {
    if (deviceId === 'fridge_01' && command === 'close') {
      return this.recoverRuleIfActiveOrAlert('fridge_left_open', ['fridge_01.doorOpen:false']);
    }
    return [];
  }

  private updatePersonBehavior(personId: string): void {
    const person = this.state.snapshot.people[personId];
    if (!person) {
      return;
    }
    person.behavior = createBehaviorContext(personId, person.activity, person.location, this.state.snapshot.homeState.mode);
  }

  private updateAllPersonBehavior(): void {
    for (const personId of Object.keys(this.state.snapshot.people)) {
      this.updatePersonBehavior(personId);
    }
  }

  private createScenarioEvent(command: ScenarioControlEvent['command'], value: string | number | boolean): ScenarioControlEvent {
    return this.createEvent({
      type: 'ScenarioControl',
      command,
      value,
      reason: `scenario:${value}`
    });
  }

  private createEvent<T extends TwinEventDraft>(event: T): T & {
    id: string;
    runId: string;
    ts: string;
    simTime: string;
    homeId: string;
    scenarioId: string;
    sequence: number;
    sourceLayer: EventSourceLayer;
    lineage: TwinEvent['lineage'];
    rngStateAfter?: number;
  } {
    this.state.snapshot.simClock.sequence += 1;
    const sequence = this.state.snapshot.simClock.sequence;
    this.syncRunContext();
    const sourceLayer = event.sourceLayer ?? inferEventSourceLayer(event);
    const observability = observabilityForSourceLayer(sourceLayer);
    const simTime = this.state.snapshot.simClock.currentTime;
    const lineage = event.lineage ?? {
      eventTime: simTime,
      ingestTime: simTime,
      sourceLayer,
      causeEventIds: [],
      episodeId: event.reason ?? event.type,
      observability,
      quality: {},
      schemaVersion: 1,
      behaviorModelVersion: this.state.snapshot.runContext.engineVersion
    };
    const completedEvent = {
      ...event,
      id: `${this.state.snapshot.runId}_evt_${String(sequence).padStart(6, '0')}`,
      runId: this.state.snapshot.runId,
      ts: simTime,
      simTime,
      homeId: this.homeId,
      scenarioId: this.state.snapshot.scenarioId,
      sequence,
      sourceLayer,
      lineage,
      rngStateAfter: this.state.random.getState()
    };
    return completedEvent as T & {
      id: string;
      runId: string;
      ts: string;
      simTime: string;
      homeId: string;
      scenarioId: string;
      sequence: number;
      sourceLayer: EventSourceLayer;
      lineage: TwinEvent['lineage'];
      rngStateAfter?: number;
    };
  }

  private rebuildRooms(): void {
    for (const room of Object.values(this.state.snapshot.rooms)) {
      room.people = [];
      room.activeDevices = [];
      room.occupancy = false;
      room.humanOccupancy = false;
      room.motionDetected = false;
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
      room.humanOccupancy = room.people.some((personId) => this.state.snapshot.people[personId]?.kind === 'human');
      room.motionDetected = room.people.length > 0;
      room.occupancy = room.humanOccupancy;
      room.lightsOn ||= this.state.profileLitRooms.has(room.id);
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

  private createRunContext(seed: number, startedAt: string, random: SeededRandom): RunContext {
    return {
      runId: `run_${randomUUID()}`,
      seed,
      rngState: random.getState(),
      scenarioVersion: 'scenario-v1',
      engineVersion: 'engine-v1',
      startedAt
    };
  }

  private syncRunContext(): void {
    this.state.snapshot.runContext.rngState = this.state.random.getState();
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

function seedFromDate(date: string): number {
  return [...date].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
}

function getScenarioForSnapshot(snapshot: TwinSnapshot): ScenarioDefinition {
  if (snapshot.scenarioId.startsWith('daily_')) {
    const date = snapshot.scenarioId.slice('daily_'.length).replaceAll('_', '-');
    return generateDailyScenario({ date, seed: snapshot.runContext.seed });
  }
  return getScenario(snapshot.scenarioId as StaticScenarioId);
}

function replayEventsOntoSnapshot(snapshot: TwinSnapshot, events: TwinEvent[]): void {
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (event.runId !== snapshot.runId) {
      continue;
    }

    switch (event.type) {
      case 'DeviceStateChanged': {
        const device = snapshot.devices[event.deviceId];
        if (device) {
          device.state = { ...device.state, ...event.state };
          device.lastReason = event.reason ?? device.lastReason;
        }
        break;
      }
      case 'DeviceTelemetry':
        replayTelemetryEvent(snapshot, event);
        break;
      case 'PersonMoved': {
        const person = snapshot.people[event.personId];
        if (person) {
          person.location = event.to;
          person.activity = event.activity;
          person.behavior = createBehaviorContext(event.personId, person.activity, person.location, snapshot.homeState.mode);
        }
        break;
      }
      case 'ObjectMoved':
        snapshot.worldState.objectLocations[event.objectId] = event.to;
        break;
      case 'ActivityStarted':
        snapshot.activities[event.activityId] = {
          activityId: event.activityId,
          participants: [...event.participants],
          roomId: event.roomId,
          startedAt: event.simTime
        };
        break;
      case 'ActivityEnded':
        delete snapshot.activities[event.activityId];
        break;
      case 'ConversationOccurred':
        break;
      case 'ExternalInteractionOccurred':
        break;
      case 'AlertCreated':
        snapshot.alerts[event.alertId] = {
          id: event.alertId,
          severity: event.severity,
          roomId: event.roomId,
          message: event.message,
          recommendedAction: event.recommendedAction,
          status: 'active',
          createdAt: event.simTime,
          ...(event.sourceRuleId ? { sourceRuleId: event.sourceRuleId } : {}),
          ...(event.sourceEntityIds ? { sourceEntityIds: [...event.sourceEntityIds] } : {})
        };
        break;
      case 'AlertStatusChanged': {
        const alert = snapshot.alerts[event.alertId];
        if (alert) {
          alert.status = event.status;
          if (event.status === 'active') {
            delete alert.resolvedAt;
          }
        }
        break;
      }
      case 'ScenarioControl':
        if (event.command === 'pause' || event.command === 'resume') {
          snapshot.simClock.paused = Boolean(event.value);
        } else if (event.command === 'speed' && typeof event.value === 'number') {
          snapshot.simClock.speed = event.value;
        }
        break;
      case 'AutomationTriggered':
        break;
      case 'RuleRecovered':
        resolveAlertsForRule(snapshot, event.ruleId, event.simTime);
        break;
      case 'AbnormalityInjected':
        break;
    }

    snapshot.simClock.currentTime = event.simTime;
    snapshot.simClock.sequence = Math.max(snapshot.simClock.sequence, event.sequence);
  }
}

function replayTelemetryEvent(snapshot: TwinSnapshot, event: DeviceTelemetryEvent): void {
  const device = snapshot.devices[event.deviceId];
  const room = snapshot.rooms[event.roomId];
  const measurementStateKeys: Record<string, string> = {
    temperature_c: 'temperatureC',
    humidity_percent: 'humidityPercent',
    pm25: 'pm25',
    co2: 'co2',
    flow_l_min: 'flowLMin',
    total_l: 'totalL',
    moisture_percent: 'moisturePercent',
    leak_detected: 'leakDetected',
    in_bed: 'inBed',
    online: 'online',
    power_w: 'powerW'
  };

  if (device) {
    for (const [measurement, value] of Object.entries(event.measurements)) {
      const stateKey = measurementStateKeys[measurement];
      if (stateKey) {
        device.state[stateKey] = value;
      }
    }
  }
  if (room) {
    if (typeof event.measurements.temperature_c === 'number') {
      room.temperatureC = event.measurements.temperature_c;
    }
    if (typeof event.measurements.humidity_percent === 'number') {
      room.humidityPercent = event.measurements.humidity_percent;
    }
  }
}

function telemetryMeasurementsToDeviceState(measurements: Record<string, number | boolean>): Record<string, string | number | boolean | null> {
  const measurementStateKeys: Record<string, string> = {
    motion: 'motion',
    confidence: 'confidence',
    temperature_c: 'temperatureC',
    humidity_percent: 'humidityPercent',
    pm25: 'pm25',
    co2: 'co2',
    flow_l_min: 'flowLMin',
    total_l: 'totalL',
    moisture_percent: 'moisturePercent',
    leak_detected: 'leakDetected',
    in_bed: 'inBed',
    online: 'online',
    power_w: 'powerW'
  };
  return Object.fromEntries(Object.entries(measurements)
    .map(([measurement, value]) => [measurementStateKeys[measurement], value] as const)
    .filter(([stateKey]) => Boolean(stateKey)));
}

function mergeSensorObservations(
  first: SensorObservation | null,
  second: SensorObservation | null
): SensorObservation | null {
  if (!first) return second;
  if (!second) return first;
  return {
    event: {
      ...first.event,
      measurements: {
        ...first.event.measurements,
        ...second.event.measurements
      },
      lineage: {
        ...first.event.lineage,
        quality: {
          ...first.event.lineage.quality,
          ...second.event.lineage.quality
        }
      }
    },
    additionalEvents: [
      ...(first.additionalEvents ?? []),
      ...(second.additionalEvents ?? [])
    ],
    observedState: {
      ...first.observedState,
      ...second.observedState
    }
  };
}

function restoreSensorObservations(events: TwinEvent[], runId: string, sequence: number): Map<string, Record<string, unknown>> {
  const observations = new Map<string, Record<string, unknown>>();
  for (const event of events) {
    if (event.runId !== runId || event.sequence > sequence || event.type !== 'DeviceTelemetry') {
      continue;
    }
    observations.set(event.deviceId, {
      ...telemetryMeasurementsToObservation(event.measurements),
      lastObservedAt: event.lineage.eventTime
    });
  }
  return observations;
}

function createInitialObjectLocations(): Record<string, RoomId> {
  return Object.fromEntries(getDefaultHouseholdObjects()
    .map((object) => [object.id, object.roomId]));
}

function createRuntimePersonNeeds(snapshot: TwinSnapshot): Map<string, NeedState> {
  const needs = new Map<string, NeedState>();
  for (const person of Object.values(snapshot.people)) {
    if (person.kind !== 'human') {
      continue;
    }
    needs.set(person.id, createInitialNeeds(getPersona(person.id)));
  }
  return needs;
}

function restorePersonNeeds(snapshot: TwinSnapshot, elapsedMinutes: number): Map<string, NeedState> {
  const needs = createRuntimePersonNeeds(snapshot);
  for (const person of Object.values(snapshot.people)) {
    if (person.kind !== 'human') {
      continue;
    }
    const persona = getPersona(person.id);
    const current = needs.get(person.id) ?? createInitialNeeds(persona);
    needs.set(person.id, advanceNeeds(current, persona, {
      minutes: elapsedMinutes,
      activity: person.activity,
      homeMode: snapshot.homeState.mode
    }));
  }
  return needs;
}

function telemetryMeasurementsToObservation(measurements: Record<string, number | boolean>): Record<string, number | boolean> {
  const measurementStateKeys: Record<string, string> = {
    motion: 'motion',
    confidence: 'confidence',
    temperature_c: 'temperatureC',
    humidity_percent: 'humidityPercent',
    pm25: 'pm25',
    co2: 'co2',
    flow_l_min: 'flowLMin',
    total_l: 'totalL',
    moisture_percent: 'moisturePercent',
    leak_detected: 'leakDetected',
    in_bed: 'inBed',
    online: 'online',
    power_w: 'powerW'
  };
  return Object.fromEntries(Object.entries(measurements)
    .map(([measurement, value]) => [measurementStateKeys[measurement], value] as const)
    .filter(([stateKey]) => Boolean(stateKey)));
}

function minuteOfDayFromTime(time: string): number {
  const match = time.match(/T(\d{2}):(\d{2}):/);
  if (!match) {
    return 0;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function commandPatch(
  deviceType: string,
  command: string,
  value: string | number | boolean | null,
  currentState: Record<string, string | number | boolean | null>
): Record<string, string | number | boolean | null> {
  if (deviceType === 'tv') {
    if (command === 'turn_on') return { power: 'on', app: currentState.app ?? 'Broadcast', volume: Math.max(Number(currentState.volume ?? 18), 18), lifecyclePhase: 'on' };
    if (command === 'turn_off') return { power: 'off', app: null, volume: 0, lifecyclePhase: 'off' };
    if (command === 'set_volume') return { power: 'on', volume: numericCommandValue(value, 40, 0, 100), lifecyclePhase: currentState.lifecyclePhase === 'paused' ? 'paused' : 'watching' };
    if (command === 'set_input') return { power: 'on', app: enumCommandValue(value, ['Streaming', 'HDMI 1', 'Game', 'Broadcast'], String(currentState.app ?? 'Streaming')), lifecyclePhase: 'watching' };
    if (command === 'pause') return { power: 'on', volume: 0, lifecyclePhase: 'paused' };
  }
  if (deviceType === 'robot_vacuum') {
    if (command === 'start') return { status: 'cleaning', batteryPercent: numericCommandValue(currentState.batteryPercent ?? 92, 92, 0, 100), binFull: false, cycleMinutes: 0 };
    if (command === 'assist') return { status: 'assisted', cycleMinutes: numericCommandValue(currentState.cycleMinutes ?? 0, 0, 0, 120) };
    if (command === 'dock') return { status: 'docked', cycleMinutes: 0 };
    if (command === 'pause') return { status: 'stuck', cycleMinutes: numericCommandValue(currentState.cycleMinutes ?? 0, 0, 0, 120) };
  }
  if (command === 'lock') return { locked: true };
  if (command === 'unlock') return { locked: false };
  if (command === 'turn_on') return { power: 'on', brightness: typeof currentState.brightness === 'number' ? Math.max(currentState.brightness, 60) : currentState.brightness ?? 1 };
  if (command === 'turn_off') return { power: 'off', brightness: typeof currentState.brightness === 'number' ? 0 : currentState.brightness ?? 0 };
  if (command === 'set_brightness') return { power: 'on', brightness: numericCommandValue(value, 60, 0, 100) };
  if (command === 'set_volume') return { power: 'on', volume: numericCommandValue(value, 40, 0, 100) };
  if (command === 'set_input') return { power: 'on', app: enumCommandValue(value, ['Streaming', 'HDMI 1', 'Game', 'Broadcast'], String(currentState.app ?? 'Streaming')) };
  if (command === 'open') {
    if (deviceType === 'fridge') return { doorOpen: true, compressorOn: true, powerW: 148, lifecyclePhase: 'opened' };
    return deviceType === 'curtain' ? { positionPercent: 100 } : { valveOpen: true };
  }
  if (command === 'close') {
    if (deviceType === 'fridge') return { doorOpen: false, compressorOn: true, powerW: 90, lifecyclePhase: 'recovered', openMinutes: 0 };
    return deviceType === 'curtain' ? { positionPercent: 0 } : { valveOpen: false };
  }
  if (command === 'set_position') return { positionPercent: numericCommandValue(value, 50, 0, 100) };
  if (command === 'set_target') return { power: 'on', targetC: numericCommandValue(value, 26, 16, 30) };
  if (command === 'set_mode') {
    const options = deviceType === 'air_conditioner'
      ? ['auto', 'cool', 'heat', 'fan']
      : deviceType === 'washer'
        ? ['normal', 'quick', 'heavy', 'delicate']
        : [];
    const mode = enumCommandValue(value, options, String(currentState.mode ?? options[0] ?? 'auto'));
    return deviceType === 'air_conditioner' ? { power: 'on', mode } : { mode };
  }
  if (command === 'set_level') return { powerW: numericCommandValue(value, 0, 0, 1400), level: numericCommandValue(value, 0, 0, 9) };
  if (command === 'set_speed') return { power: 'on', speed: numericCommandValue(value, 2, 0, 5) };
  if (command === 'start') {
    if (deviceType === 'dishwasher') return { status: 'running', remainingMin: 45, powerW: 620 };
    if (deviceType === 'washer') return { status: 'running', remainingMin: 55, powerW: 480 };
    return { status: 'running', powerW: Number(currentState.powerW ?? 450) || 450 };
  }
  if (command === 'stop' || command === 'pause') return { status: command === 'pause' ? 'paused' : 'idle', remainingMin: 0, powerW: 0 };
  if (command === 'dock') return { status: 'docked' };
  if (command === 'restart') return { online: true, latencyMs: 18, lifecyclePhase: 'recovered' };
  if (command === 'record') return { recording: true };
  if (command === 'ring') return { ringing: true };
  return {};
}

function numericCommandValue(value: string | number | boolean | null, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : fallback;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function enumCommandValue(value: string | number | boolean | null, options: string[], fallback: string): string {
  const text = typeof value === 'string' ? value : fallback;
  return options.includes(text) ? text : fallback;
}

function createBehaviorContext(
  personId: string,
  activity: string,
  location: RoomId | 'away',
  homeMode: HomeMode
): TwinSnapshot['people'][string]['behavior'] {
  if (activity.startsWith('controlling_')) {
    const targetDeviceId = activity.slice('controlling_'.length);
    const intent = targetDeviceId === 'router_01'
      ? 'restart_router'
      : targetDeviceId === 'fridge_01'
        ? 'close_fridge'
        : 'operate_device';
    return {
      routinePhase: 'device_response',
      intent,
      attentionTarget: targetDeviceId,
      energy: personId === 'senior_1' ? 44 : 66
    };
  }

  if (activity === 'checking_senior_1') {
    return {
      routinePhase: 'care_response',
      intent: 'check_on_senior',
      attentionTarget: 'senior_1',
      energy: 58
    };
  }

  if (activity === 'fetch_family_phone' || activity === 'bring_family_phone') {
    return {
      routinePhase: 'care_response',
      intent: 'support_senior_comfort',
      attentionTarget: 'family_phone',
      energy: 56
    };
  }

  if (activity === 'sleeping' || homeMode === 'sleeping' && location !== 'away') {
    return {
      routinePhase: 'sleep',
      intent: 'rest',
      attentionTarget: location,
      energy: 18
    };
  }

  if (personId === 'adult_1') {
    if (activity === 'commuting' || location === 'away') {
      return { routinePhase: 'workday', intent: 'commute', attentionTarget: 'entrance', energy: 48 };
    }
    if (activity === 'arrived_home') {
      return { routinePhase: 'evening_return', intent: 'decompress_after_commute', attentionTarget: 'living_room', energy: 55 };
    }
    if (activity === 'breakfast' || activity === 'bathroom' || activity === 'waking_up' || activity === 'wake_up') {
      return { routinePhase: 'morning_routine', intent: 'prepare_for_day', attentionTarget: location, energy: 64 };
    }
    return { routinePhase: homeMode, intent: 'family_time', attentionTarget: location, energy: 60 };
  }

  if (personId === 'adult_2') {
    if (activity === 'remote_work') {
      return { routinePhase: 'workday', intent: 'focused_remote_work', attentionTarget: 'router_01', energy: 70 };
    }
    if (activity === 'cooking_dinner') {
      return { routinePhase: 'evening_meal', intent: 'prepare_dinner', attentionTarget: 'stove_01', energy: 62 };
    }
    if (activity === 'coffee' || activity === 'breakfast' || activity === 'wake_up' || activity === 'waking_up') {
      return { routinePhase: 'morning_routine', intent: 'start_day', attentionTarget: 'kitchen', energy: 58 };
    }
    return { routinePhase: homeMode, intent: 'support_household', attentionTarget: location, energy: 60 };
  }

  if (personId === 'child_1') {
    if (activity === 'school' || location === 'away') {
      return { routinePhase: 'school_day', intent: 'attend_school', attentionTarget: 'away', energy: 72 };
    }
    if (activity === 'homework') {
      return { routinePhase: 'after_school', intent: 'finish_homework', attentionTarget: 'child_bedroom', energy: 62 };
    }
    if (activity === 'watching_tv' || activity === 'playing' || activity === 'weekend_play') {
      return { routinePhase: 'free_time', intent: 'play_or_relax', attentionTarget: location, energy: 78 };
    }
    return { routinePhase: homeMode, intent: 'follow_family_routine', attentionTarget: location, energy: 68 };
  }

  if (personId === 'senior_1') {
    if (activity === 'gardening' || activity === 'plant_care') {
      return { routinePhase: 'daytime_care', intent: 'care_for_plants', attentionTarget: 'sprinkler_01', energy: 52 };
    }
    if (activity === 'no_activity') {
      return { routinePhase: 'wellness_watch', intent: 'needs_check_in', attentionTarget: 'master_sleep_01', energy: 25 };
    }
    if (activity === 'morning_check_in') {
      return { routinePhase: 'wellness_recovery', intent: 'respond_to_check_in', attentionTarget: 'living_room', energy: 45 };
    }
    return { routinePhase: homeMode, intent: 'steady_routine', attentionTarget: location, energy: 50 };
  }

  if (personId === 'pet_1') {
    return {
      routinePhase: homeMode === 'sleeping' ? 'quiet_pet_patrol' : 'pet_patrol',
      intent: activity === 'resting' || activity === 'sleeping' ? 'rest' : 'explore_home',
      attentionTarget: location,
      energy: activity === 'resting' || activity === 'sleeping' ? 35 : 82
    };
  }

  return {
    routinePhase: homeMode,
    intent: activity,
    attentionTarget: location,
    energy: 50
  };
}

function peopleInRoom(snapshot: TwinSnapshot, roomId: RoomId): string[] {
  return Object.values(snapshot.people)
    .filter((person) => person.location === roomId)
    .map((person) => person.id);
}

function resolveAlertsForRule(snapshot: TwinSnapshot, ruleId: string, resolvedAt: string): void {
  const sourceAlertIds = Object.values(snapshot.alerts)
    .filter((alert) => alert.sourceRuleId === ruleId)
    .map((alert) => alert.id);
  const alertIds = sourceAlertIds.length > 0 ? sourceAlertIds : legacyAlertIdsForRule(ruleId);
  for (const alertId of alertIds) {
    const alert = snapshot.alerts[alertId];
    if (!alert) {
      continue;
    }
    alert.status = 'resolved';
    alert.resolvedAt = resolvedAt;
  }
}

function legacyAlertIdsForRule(ruleId: string): string[] {
  const alertIds: Record<string, string[]> = {
    close_water_valve_on_leak: ['water_leak_001'],
    door_left_open: ['door_left_open_001'],
    fridge_left_open: ['fridge_left_open_001'],
    network_offline: ['network_offline_001'],
    senior_no_activity: ['senior_no_activity_001', 'senior_inactive_001']
  };
  return alertIds[ruleId] ?? [];
}

function isAvailableForSocialCoordination(kind: string, location: RoomId | 'away', activity: string): boolean {
  if (kind !== 'human' || location === 'away') {
    return false;
  }
  return ![
    'sleeping',
    'remote_work',
    'cooking_dinner',
    'prepare_breakfast',
    'take_medicine'
  ].includes(activity) &&
    !activity.startsWith('controlling_') &&
    !activity.startsWith('waiting_for_') &&
    !activity.startsWith('walking_to_') &&
    !activity.startsWith('returning_to_');
}

function sourceRuleIdFromReason(reason: string): string | undefined {
  return reason.startsWith('rule:') ? reason.slice('rule:'.length) : undefined;
}

function inferEventSourceLayer(event: Omit<TwinEvent, 'id' | 'runId' | 'ts' | 'simTime' | 'homeId' | 'scenarioId' | 'sequence' | 'sourceLayer' | 'lineage'>): EventSourceLayer {
  if (event.type === 'ScenarioControl' || event.type === 'AbnormalityInjected' || event.type === 'AlertStatusChanged') {
    return 'control';
  }
  if (event.type === 'PersonMoved' || event.type === 'ActivityStarted' || event.type === 'ActivityEnded' || event.type === 'ConversationOccurred' || event.type === 'ExternalInteractionOccurred') {
    return 'truth';
  }
  if (event.type === 'DeviceTelemetry') {
    return 'sensor';
  }
  if (event.type === 'DeviceStateChanged' || event.type === 'ObjectMoved') {
    return 'world';
  }
  return 'inference';
}

function observabilityForSourceLayer(sourceLayer: EventSourceLayer): EventObservability {
  if (sourceLayer === 'sensor') {
    return 'ml_observation';
  }
  if (sourceLayer === 'truth') {
    return 'private';
  }
  return 'admin';
}

function sourceEntityIdsForRule(ruleId: string): string[] {
  const sourceEntityIds: Record<string, string[]> = {
    close_water_valve_on_leak: ['water_leak_01', 'water_valve_01'],
    door_left_open: ['door_lock_01', 'doorbell_camera_01'],
    fridge_left_open: ['fridge_01'],
    network_offline: ['router_01'],
    senior_no_activity: ['senior_1', 'master_sleep_01'],
    senior_wellness_check: ['senior_1', 'master_sleep_01'],
    sleep_mode: ['living_light_01', 'tv_01'],
    cooking_ventilation: ['stove_01', 'range_hood_01', 'kitchen_light_01'],
    stove_unattended_safety: ['stove_01'],
    away_mode: ['door_lock_01', 'living_light_01', 'tv_01'],
    pet_garden_sprinkler_pause: ['pet_1', 'sprinkler_01'],
    remote_work_comfort: ['adult_2', 'study_co2_01', 'router_01']
  };
  return sourceEntityIds[ruleId] ? [...sourceEntityIds[ruleId]] : [];
}

function rngStateAfterEvents(events: TwinEvent[]): number | undefined {
  return [...events]
    .sort((left, right) => right.sequence - left.sequence)
    .find((event) => typeof event.rngStateAfter === 'number')
    ?.rngStateAfter;
}

function restoreRuleStates(events: TwinEvent[], elapsedMinutes: number, currentTime: string): Map<string, RuleLifecycleState> {
  const states = new Map<string, RuleLifecycleState>();
  for (const event of events) {
    if (event.type === 'AutomationTriggered') {
      states.set(event.ruleId, {
        status: 'active',
        cooldownUntilMinute: elapsedMinutes
      });
    } else if (event.type === 'RuleRecovered') {
      states.set(event.ruleId, {
        status: 'cooldown',
        cooldownUntilMinute: elapsedMinutes + minutesBetween(currentTime, event.cooldownUntil)
      });
    }
  }
  for (const [ruleId, lifecycle] of states) {
    if (lifecycle.status === 'cooldown' && elapsedMinutes >= lifecycle.cooldownUntilMinute) {
      states.delete(ruleId);
    }
  }
  return states;
}

function affectedEntitiesForAbnormality(kind: AbnormalityInjectedEvent['kind']): string[] {
  if (kind === 'door_left_open') {
    return ['door_lock_01', 'doorbell_camera_01'];
  }
  if (kind === 'fridge_left_open') {
    return ['fridge_01'];
  }
  if (kind === 'network_offline') {
    return ['router_01'];
  }
  return ['senior_1', 'master_sleep_01'];
}

function minutesBetween(startTime: string, endTime: string): number {
  return Math.max(0, Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000));
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
