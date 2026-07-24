import { createCatalogFromHomeDefinition, getHomeDefinition } from './catalog';
import { generateDailyScenario, type DailyScenarioOptions } from './dailyPlan';
import { randomUUID } from 'node:crypto';
import { SeededRandom } from './random';
import { getScenario, type ScenarioAction, type ScenarioDefinition } from './scenarios';
import { getDeviceCapability, validateDeviceStatePatch } from '../shared/deviceRegistry';
import { getDeviceSupportedCommands } from '../shared/deviceInstanceCapabilities';
import { getSensorProfile, withSensorProfileOverrides } from './sensors/deviceProfiles';
import { observeBinarySensor, observeContactSensor, observeEnvironmentSensor, observeMotionSensor, observeNumericSensor, type EnvironmentSensorReportingOptions, type SensorObservation } from './sensors/sensorModel';
import { selectActivity } from './agents/agentPolicy';
import { advanceNeeds, applyActivityEffectsToNeeds, createInitialNeeds, type NeedState } from './agents/needs';
import { commitmentPressureAtMinute, createDailyCommitments } from './agents/scheduler';
import { defaultFamilyPersonas, getPersona, getPersonaForDefinition } from './personas/defaultFamily';
import { applyActivityToInventory, createInitialInventory, resourcesFromInventory } from './world/inventory';
import { getDefaultHouseholdObjects } from './world/objects';
import { createConversationDraft } from './social/conversationEvents';
import { coordinateHousehold, type HouseholdSocialContext, type SocialDecision } from './social/householdCoordinator';
import { createExternalContext } from './externalContext';
import type { CompiledHouseholdRun } from './householdTemplate';
import { coreDeviceBehaviorModule, type DeviceBehaviorModule } from './deviceBehavior';
import {
  coreAutomationPolicyModule,
  isAutomationRuleEnabled,
  validateAutomationPolicyModule,
  type AutomationPolicyModule,
  type AutomationRuleId
} from './automationPolicy';
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
  PersonState,
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
  behaviors?: readonly DeviceBehaviorModule[];
  automationPolicies?: readonly AutomationPolicyModule[];
}

export interface VirtualHomeSimulator {
  startScenario(id: StaticScenarioId): TwinEvent[];
  startDailyScenario(options: DailyScenarioOptions): TwinEvent[];
  startCompiledHouseholdRun(run: CompiledHouseholdRun): TwinEvent[];
  restore(snapshot: TwinSnapshot, events: TwinEvent[]): void;
  restoreCompiledHouseholdRun(run: CompiledHouseholdRun, snapshot: TwinSnapshot, events: TwinEvent[]): void;
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
  lastEventByEntity: Map<string, string>;
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
  child_1: { role: 'student', preferredRooms: ['living_room', 'kitchen', 'child_bedroom'], activeLightLevel: 70 },
  senior_1: { role: 'senior', preferredRooms: ['master_bedroom', 'dining_room', 'living_room', 'garden'], activeLightLevel: 74 },
  pet_1: { role: 'pet', preferredRooms: ['living_room', 'garden', 'kitchen', 'master_bedroom'], activeLightLevel: 0 }
};

const roomLightDevices: Partial<Record<RoomId, string>> = {
  dining_room: 'dining_light_01',
  kitchen: 'kitchen_light_01',
  living_room: 'living_light_01',
  master_bedroom: 'master_light_01',
  child_bedroom: 'child_light_01',
  study: 'study_light_01'
};

const roomClimateDevices: Partial<Record<RoomId, string>> = {
  living_room: 'living_ac_01',
  master_bedroom: 'master_ac_01',
  child_bedroom: 'child_ac_01'
};

const defaultRuleCooldownMinutes = 5;
const ruleCooldownMinutesByRule: Partial<Record<string, number>> = {
  close_water_valve_on_leak: 15,
  senior_no_activity: 10,
  senior_wellness_check: 10,
  fridge_left_open: 6,
  door_left_open: 4,
  network_offline: 3,
  robot_vacuum_stuck: 2
};

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
  private readonly behaviorModulesByIdentity: Map<string, DeviceBehaviorModule>;
  private readonly automationPoliciesByIdentity: Map<string, AutomationPolicyModule>;
  private state: RuntimeState;

  constructor(options: SimulatorOptions = {}) {
    this.homeDefinition = structuredClone(options.homeDefinition ?? getHomeDefinition());
    const catalog = createCatalogFromHomeDefinition(this.homeDefinition);
    this.baseSeed = options.seed ?? 1;
    const random = new SeededRandom(this.baseSeed);
    this.homeId = options.homeId ?? this.homeDefinition.building.id;
    this.behaviorModulesByIdentity = new Map();
    for (const behavior of [coreDeviceBehaviorModule, ...(options.behaviors ?? [])]) {
      const identity = `${behavior.id}@${behavior.version}`;
      if (this.behaviorModulesByIdentity.has(identity)) {
        throw new Error(`Duplicate device behavior module ${identity}`);
      }
      this.behaviorModulesByIdentity.set(identity, behavior);
    }
    this.automationPoliciesByIdentity = new Map();
    for (const policy of [coreAutomationPolicyModule, ...(options.automationPolicies ?? [])]) {
      const identity = `${policy.id}@${policy.version}`;
      if (this.automationPoliciesByIdentity.has(identity)) {
        throw new Error(`Duplicate automation policy ${identity}`);
      }
      const issues = validateAutomationPolicyModule(policy);
      if (issues.length > 0) {
        throw new Error(`Invalid automation policy ${identity}: ${issues.join('; ')}`);
      }
      this.automationPoliciesByIdentity.set(identity, policy);
    }
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
      lastEventByEntity: new Map(),
      personNeeds: createRuntimePersonNeeds(this.createInitialSnapshot(catalog, 'weekday_normal', '2026-06-17T00:00:00+08:00', 'morning', 60, runContext), catalog),
      triggeredRules: new Set(),
      ruleStates: new Map(),
      random
    };
    this.rebuildRooms();
    this.updateOccupancy();
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
    this.restoreWithScenario(snapshot, events, catalog, activeScenario);
  }

  restoreCompiledHouseholdRun(run: CompiledHouseholdRun, snapshot: TwinSnapshot, events: TwinEvent[]): void {
    const identity = snapshot.runContext.householdRun;
    if (!identity) {
      throw new Error('Snapshot is not a compiled household run');
    }
    const mismatches = [
      ['templateId', identity.templateId, run.templateId],
      ['templateVersion', identity.templateVersion, run.templateVersion],
      ['templateDigest', identity.templateDigest, run.templateDigest],
      ['compilerVersion', identity.compilerVersion, run.compilerVersion],
      ['date', identity.date, run.date],
      ['timezone', identity.timezone, run.timezone]
    ].filter(([, actual, expected]) => actual !== expected);
    if (mismatches.length > 0) {
      throw new Error(`Compiled household restore is incompatible: ${mismatches.map(([field]) => field).join(', ')}`);
    }
    if (JSON.stringify(identity.environmentSnapshot) !== JSON.stringify(run.environmentSnapshot)) {
      throw new Error('Compiled household restore is incompatible: environmentSnapshot');
    }
    if (JSON.stringify(identity.repertoireVersions) !== JSON.stringify(run.repertoireVersions)) {
      throw new Error('Compiled household restore is incompatible: repertoireVersions');
    }
    if (JSON.stringify(identity.behaviorVersions) !== JSON.stringify(run.behaviorVersions)) {
      throw new Error('Compiled household restore is incompatible: behaviorVersions');
    }
    if (JSON.stringify(identity.automationPolicyVersion) !== JSON.stringify(run.automationPolicyVersion)) {
      throw new Error('Compiled household restore is incompatible: automationPolicyVersion');
    }
    this.assertBehaviorModulesInstalled(run.behaviorVersions);
    this.assertAutomationPolicyInstalled(run.automationPolicyVersion);
    if (snapshot.scenarioId !== run.lifePlan.id) {
      throw new Error('Compiled household restore is incompatible: lifePlan');
    }
    const catalog = createCatalogFromHomeDefinition(this.homeDefinition);
    this.restoreWithScenario(snapshot, events, catalog, run.lifePlan);
  }

  private restoreWithScenario(snapshot: TwinSnapshot, events: TwinEvent[], catalog: Catalog, activeScenario: ScenarioDefinition): void {
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
      lastEventByEntity: restoreLastEventByEntity(restoredEvents, restoredSnapshot.runId, restoredSnapshot.simClock.sequence),
      personNeeds: restorePersonNeeds(restoredSnapshot, elapsedMinutes, catalog),
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

  private startScenarioDefinition(
    scenario: ScenarioDefinition,
    eventValue: string,
    runSeed: number,
    householdRun?: NonNullable<RunContext['householdRun']>
  ): TwinEvent[] {
    const catalog = createCatalogFromHomeDefinition(this.homeDefinition);
    const random = new SeededRandom(runSeed);
    const runContext = this.createRunContext(runSeed, scenario.startTime, random);
    runContext.householdRun = householdRun;
    this.state = {
      catalog,
      activeScenario: scenario,
      snapshot: this.createInitialSnapshot(catalog, scenario.id, scenario.startTime, scenario.initialMode, scenario.speed, runContext),
      elapsedMinutes: 0,
      emittedEvents: [],
      executedStepKeys: new Set(),
      profileLitRooms: new Set(),
      sensorObservations: new Map(),
      lastEventByEntity: new Map(),
      personNeeds: createRuntimePersonNeeds(this.createInitialSnapshot(catalog, scenario.id, scenario.startTime, scenario.initialMode, scenario.speed, runContext), catalog),
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
    const affectedEntities: string[] = [];
    let primaryDevice: DeviceState | undefined;
    let secondaryDevice: DeviceState | undefined;
    let affectedResident: PersonState | undefined;
    let affectedRoom: RoomId | undefined;
    if (kind === 'door_left_open') {
      primaryDevice = this.requireDeviceOfType('door_lock', kind);
      secondaryDevice = this.requireDeviceOfType('doorbell_camera', kind, primaryDevice.roomId);
      affectedEntities.push(primaryDevice.id, secondaryDevice.id);
    } else if (kind === 'fridge_left_open') {
      primaryDevice = this.requireDeviceOfType('fridge', kind);
      affectedEntities.push(primaryDevice.id);
    } else if (kind === 'network_offline') {
      primaryDevice = this.requireDeviceOfType('router', kind);
      affectedEntities.push(primaryDevice.id);
    } else {
      affectedResident = Object.values(this.state.snapshot.people)
        .find((person) => this.personaFor(person.id).role === 'senior');
      if (!affectedResident && this.state.snapshot.runContext.householdRun) {
        throw new Error(`Cannot inject ${kind}: home has no resident with role senior`);
      }
      affectedRoom = affectedResident
        ? affectedResident.location === 'away'
          ? this.primaryRoomForPerson(affectedResident.id)
          : affectedResident.location
        : this.deviceOfType('sleep_sensor')?.roomId;
      if (!affectedRoom) {
        throw new Error(`Cannot inject ${kind}: no senior room or sleep sensor is available`);
      }
      primaryDevice = this.requireDeviceOfType('sleep_sensor', kind, affectedRoom);
      affectedEntities.push(affectedResident?.id ?? 'senior_1', primaryDevice.id);
    }

    const events: TwinEvent[] = [this.createAbnormalityInjectedEvent(kind, affectedEntities)];
    if (kind === 'door_left_open') {
      events.push(this.setDeviceState(primaryDevice!.id, { locked: false }, 'abnormality:door_left_open'));
      events.push(this.setDeviceState(secondaryDevice!.id, { motion: true, ringing: false }, 'abnormality:door_left_open'));
    } else if (kind === 'fridge_left_open') {
      events.push(this.setDeviceState(primaryDevice!.id, { doorOpen: true, powerW: 148, lifecyclePhase: 'opened', openMinutes: 0 }, 'abnormality:fridge_left_open'));
    } else if (kind === 'network_offline') {
      const router = primaryDevice!;
      events.push(this.setDeviceState(router.id, { online: true, latencyMs: 260, lifecyclePhase: 'degraded' }, 'abnormality:network_degraded'));
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'network_degraded',
        explanation: 'Router latency degraded before the network outage, so the twin records a prewarning phase.',
        actions: ['mark_router_degraded', 'warn_remote_work_reliability'],
        reason: `${router.id}.lifecyclePhase:degraded`,
        eventExplanation: {
          why: 'Router latency rose above the remote-work comfort threshold before connectivity dropped.',
          actorIds: ['adult_2'],
          affectedDeviceIds: [router.id],
          affectedRoomIds: [router.roomId],
          relatedIntent: 'focused_remote_work',
          expectedOutcome: 'Explain that the outage had a degraded prewarning phase before the router went offline.'
        }
      }));
      events.push(this.setDeviceState(router.id, { online: false, latencyMs: 0, lifecyclePhase: 'offline' }, 'abnormality:network_offline'));
    } else {
      if (affectedResident) {
        events.push(...this.createRoutedPersonMovedEvents(affectedResident.id, affectedRoom!, 'no_activity'));
      }
      events.push(this.setDeviceState(primaryDevice!.id, { inBed: true, heartRateSimulated: 60 }, 'abnormality:senior_no_activity'));
    }
    this.rebuildRooms();
    this.updateOccupancy();
    events.push(...this.applyRules());
    this.state.emittedEvents.push(...events);
    return events;
  }

  private createAbnormalityInjectedEvent(kind: AbnormalityInjectedEvent['kind'], affectedEntities: string[]): AbnormalityInjectedEvent {
    return this.createEvent({
      type: 'AbnormalityInjected',
      kind,
      affectedEntities,
      reason: `abnormality:${kind}`
    });
  }

  resolveAbnormality(kind: 'door_left_open' | 'fridge_left_open' | 'network_offline' | 'senior_no_activity'): TwinEvent[] {
    const events: TwinEvent[] = [];
    if (kind === 'door_left_open') {
      const doorLock = this.requireDeviceOfType('door_lock', kind);
      const entranceCamera = this.requireDeviceOfType('doorbell_camera', kind, doorLock.roomId);
      events.push(this.setDeviceState(doorLock.id, { locked: true }, 'recovery:door_left_open'));
      events.push(this.setDeviceState(entranceCamera.id, { motion: false, ringing: false }, 'recovery:door_left_open'));
      events.push(...this.recoverRuleIfActive('door_left_open', [`${doorLock.id}.locked:true`, `${entranceCamera.id}.motion:false`]));
    } else if (kind === 'fridge_left_open') {
      const fridge = this.requireDeviceOfType('fridge', kind);
      events.push(this.setDeviceState(fridge.id, { doorOpen: false, powerW: 90, lifecyclePhase: 'recovered', openMinutes: 0 }, 'recovery:fridge_left_open'));
      events.push(...this.recoverRuleIfActive('fridge_left_open', [`${fridge.id}.doorOpen:false`]));
    } else if (kind === 'network_offline') {
      const router = this.requireDeviceOfType('router', kind);
      events.push(this.setDeviceState(router.id, { online: true, latencyMs: 18, lifecyclePhase: 'recovered' }, 'recovery:network_offline'));
      events.push(...this.recoverRuleIfActive('network_offline', [`${router.id}.online:true`]));
    } else if (kind === 'senior_no_activity') {
      const senior = this.requireResidentByRole('senior', kind);
      const currentRoom = senior.location === 'away' ? this.primaryRoomForPerson(senior.id) : senior.location;
      if (!currentRoom) {
        throw new Error(`Cannot resolve ${kind}: resident ${senior.id} has no available room`);
      }
      const sleepSensor = this.requireDeviceOfType('sleep_sensor', kind, currentRoom);
      const destination = this.primaryRoomForPurpose('relaxing') ?? currentRoom;
      events.push(...this.createSeniorCheckInEvents(senior, currentRoom, sleepSensor));
      events.push(...this.createRoutedPersonMovedEvents(senior.id, destination, 'morning_check_in'));
      events.push(this.setDeviceState(sleepSensor.id, { inBed: false, heartRateSimulated: 70 }, 'recovery:senior_no_activity'));
      events.push(...this.recoverRuleIfActive('senior_no_activity', [`${senior.id}.activity:morning_check_in`, `${sleepSensor.id}.inBed:false`]));
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
    if (device.type === 'router' && command === 'restart') {
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
        temperatureC: room.type === 'outdoor' ? 21 : 25,
        humidityPercent: room.type === 'utility' ? 65 : 52,
        lightsOn: false,
        activeDevices: []
      };
      return roomMap;
    }, {} as TwinSnapshot['rooms']);
    const people = Object.fromEntries(catalog.people.map((person) => {
      const persona = getPersonaForDefinition(person, catalog);
      const initialRoom = persona.primaryRooms.find((roomId) => rooms[roomId])
        ?? catalog.rooms.find((room) => room.type === (person.kind === 'pet' ? 'living' : 'bedroom'))?.id
        ?? catalog.rooms[0]?.id;
      if (!initialRoom) {
        throw new Error(`Cannot initialize resident ${person.id}: home has no rooms`);
      }
      return [person.id, {
        id: person.id,
        kind: person.kind,
        location: initialRoom,
        activity: 'idle',
        behavior: createBehaviorContext(person.id, 'idle', initialRoom, mode),
        confidence: 0.9,
        privacyMode: true
      }
    ]})) as TwinSnapshot['people'];

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
    const usesCompiledHouseholdBehavior = this.state.activeScenario.id.startsWith('household_');
    if (!usesCompiledHouseholdBehavior) {
      events.push(...this.movePetAroundHome());
    }
    events.push(...this.advanceApplianceCycles());
    events.push(...this.advanceRobotVacuumLifecycle());
    events.push(...this.advanceRouterRestartLifecycle());
    events.push(...this.advanceFridgeDoorLifecycle());
    events.push(...this.advanceWaterFlowAfterValveClosure());
    events.push(...this.advanceConfiguredDeviceBehaviors());
    this.advanceWeatherClimateDynamics();
    this.advanceAirConditionerClimateEffects();
    events.push(...this.applyPersonStateConsistency());
    this.rebuildRooms();
    if (!usesCompiledHouseholdBehavior) {
      events.push(...this.applyAutonomousAgentPolicy());
      this.rebuildRooms();
      events.push(...this.applyBehaviorProfileInteractions());
      this.rebuildRooms();
    }
    events.push(...this.syncMotionSensors());
    events.push(...this.syncSecurityCameras());
    if (!usesCompiledHouseholdBehavior) {
      events.push(...this.applyRandomHouseholdEvents());
    }
    return events;
  }

  private advanceConfiguredDeviceBehaviors(): TwinEvent[] {
    const versions = this.state.snapshot.runContext.householdRun?.behaviorVersions;
    if (!versions) {
      return [];
    }
    const modules = this.activeDeviceBehaviorModules();
    const ownerByDeviceType = this.deviceBehaviorOwners(modules);

    const events: TwinEvent[] = [];
    for (const module of modules) {
      if (module.implementation !== 'effects') {
        continue;
      }
      const effects = module.advance(Object.freeze({
        elapsedMinutes: this.state.elapsedMinutes,
        simTime: this.state.snapshot.simClock.currentTime,
        seed: this.state.snapshot.runContext.seed,
        homeMode: this.state.snapshot.homeState.mode,
        devices: structuredClone(Object.values(this.state.snapshot.devices)),
        rooms: structuredClone(Object.values(this.state.snapshot.rooms))
      }));
      for (const effect of effects) {
        const device = this.state.snapshot.devices[effect.deviceId];
        if (!device) {
          throw new Error(`Device behavior ${module.id}@${module.version} targeted missing device ${effect.deviceId}`);
        }
        if (!module.deviceTypes.includes(device.type) || ownerByDeviceType.get(device.type) !== module.id) {
          throw new Error(`Device behavior ${module.id}@${module.version} does not own device type ${device.type}`);
        }
        if (!effect.reason.trim()) {
          throw new Error(`Device behavior ${module.id}@${module.version} returned an empty reason`);
        }
        events.push(this.setDeviceState(
          effect.deviceId,
          effect.state,
          `behavior:${module.id}@${module.version}:${effect.reason}`
        ));
      }
    }
    return events;
  }

  private advanceApplianceCycles(): TwinEvent[] {
    const events: TwinEvent[] = [];
    const dishwasher = this.deviceOfType('dishwasher');
    const washer = this.deviceOfType('washer');
    if (dishwasher && this.nativeDeviceBehaviorEnabled('dishwasher')) {
      events.push(...this.advanceTimedDevice(dishwasher.id, 'dishwasher_cycle_done', 'Dishwasher is waiting to be unloaded', 'empty_dishwasher'));
    }
    if (washer && this.nativeDeviceBehaviorEnabled('washer')) {
      events.push(...this.advanceTimedDevice(washer.id, 'washer_cycle_done', 'Washing machine is waiting to be unloaded', 'move_laundry_to_dryer'));
    }
    events.push(...this.advanceWasherUnloadLifecycle());
    return events;
  }

  private advanceWasherUnloadLifecycle(): TwinEvent[] {
    if (!this.nativeDeviceBehaviorEnabled('washer')) {
      return [];
    }
    const washer = this.deviceOfType('washer');
    if (!washer || washer.state.status !== 'waiting_unload' || !String(washer.lastReason).startsWith('ambient:washer:waiting_unload')) {
      return [];
    }
    const events: TwinEvent[] = [
      this.setDeviceState(washer.id, { status: 'idle', remainingMin: 0, powerW: 0 }, 'household_activity:laundry_unloaded')
    ];
    const activity = this.state.snapshot.activities.laundry_cycle;
    if (activity) {
      delete this.state.snapshot.activities.laundry_cycle;
      for (const participantId of activity.participants) {
        const participant = this.state.snapshot.people[participantId];
        if (participant && participant.location !== 'away') {
          events.push(...this.createRoutedPersonMovedEvents(participantId, 'study', 'remote_work', 'household_activity:laundry_unloaded'));
        }
      }
      events.push(this.createEvent({
        type: 'ActivityEnded',
        activityId: 'laundry_cycle',
        participants: activity.participants,
        roomId: activity.roomId,
        reason: 'household_activity:laundry_unloaded'
      }));
    }
    const alert = this.state.snapshot.alerts.washer_cycle_done;
    if (alert && alert.status !== 'resolved') {
      const previousStatus = alert.status;
      alert.status = 'resolved';
      alert.resolvedAt = this.state.snapshot.simClock.currentTime;
      events.push(this.createEvent({
        type: 'AlertStatusChanged',
        alertId: alert.id,
        previousStatus,
        status: 'resolved',
        reason: 'household_activity:laundry_unloaded'
      }));
    }
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
    if (!this.nativeDeviceBehaviorEnabled('fridge')) {
      return [];
    }
    const fridge = this.deviceOfType('fridge');
    if (!fridge || fridge.state.doorOpen !== true) {
      return [];
    }
    const previousPhase = String(fridge.state.lifecyclePhase ?? 'opened');
    const openMinutes = Math.max(1, Number(fridge.state.openMinutes ?? 0) + 1);
    const alertPolicy = alertEscalationPolicies.fridge_left_open;
    const lifecyclePhase = openMinutes >= this.activeAutomationPolicy().thresholds.fridgeOpenMinutes ? alertPolicy.lifecyclePhase : openMinutes >= 1 ? 'still_open' : 'opened';
    const powerW = Math.max(Number(fridge.state.powerW ?? 148), lifecyclePhase === 'alert' ? 176 : 156);
    const events: TwinEvent[] = [
      this.setDeviceState(fridge.id, {
        lifecyclePhase,
        openMinutes,
        powerW
      }, lifecyclePhase === 'alert' ? 'ambient:fridge:alert' : 'ambient:fridge:still_open')
    ];
    const roomClimate = this.deviceOfType('temperature_humidity_sensor', fridge.roomId);
    const fridgeRoom = this.state.snapshot.rooms[fridge.roomId];
    if (roomClimate && fridgeRoom) {
      const temperatureC = this.round(this.clamp(Number(fridgeRoom.temperatureC ?? roomClimate.state.temperatureC ?? 25) + (lifecyclePhase === 'alert' ? 0.42 : 0.16), 17, 31));
      const humidityPercent = Number(fridgeRoom.humidityPercent ?? roomClimate.state.humidityPercent ?? 55);
      events.push(this.setDeviceState(roomClimate.id, { temperatureC, humidityPercent }, 'ambient:fridge:room_temperature_drift'));
      fridgeRoom.temperatureC = temperatureC;
      fridgeRoom.humidityPercent = humidityPercent;
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
        reason: `${fridge.id}.lifecyclePhase:alert`,
        eventExplanation: {
          why: 'The fridge door has stayed open for five simulated minutes, increasing compressor load and kitchen temperature drift.',
          actorIds: [],
          affectedDeviceIds: [fridge.id, roomClimate?.id].filter((id): id is string => Boolean(id)),
          affectedRoomIds: [fridge.roomId],
          relatedIntent: 'close_fridge',
          expectedOutcome: 'Escalate the alert so a household member closes the fridge before energy and comfort impact grows.'
        }
      }));
    }
    return events;
  }

  private advanceWaterFlowAfterValveClosure(): TwinEvent[] {
    if (!this.nativeDeviceBehaviorEnabled('water_valve') || !this.nativeDeviceBehaviorEnabled('water_flow_sensor')) {
      return [];
    }
    const waterValve = this.deviceOfType('water_valve');
    const bathroomWater = waterValve ? this.deviceOfType('water_flow_sensor', waterValve.roomId) : undefined;
    if (!waterValve || !bathroomWater || waterValve.state.valveOpen !== false || Number(bathroomWater.state.flowLMin ?? 0) <= 0) {
      return [];
    }
    if (!String(waterValve.lastReason).startsWith('rule:close_water_valve_on_leak')) {
      return [];
    }
    return [
      this.setDeviceState(bathroomWater.id, { flowLMin: 0 }, 'rule:close_water_valve_on_leak:flow_stopped')
    ];
  }

  private advanceWeatherClimateDynamics(): void {
    const weather = this.currentWeatherContext();
    const minute = minuteOfDayFromTime(this.state.snapshot.simClock.currentTime);
    for (const room of Object.values(this.state.snapshot.rooms)) {
      const currentTemperature = Number(room.temperatureC ?? 25);
      const currentHumidity = Number(room.humidityPercent ?? 55);
      const ac = this.nativeDeviceBehaviorEnabled('air_conditioner')
        ? this.deviceOfType('air_conditioner', room.id)
        : undefined;
      const acActive = ac?.state.power === 'on';
      const outdoorTemperature = room.id === 'garden'
        ? weather.outdoorTemperatureC
        : indoorWeatherTarget(room.id, weather.outdoorTemperatureC, minute);
      const strongSolarHeat = weather.outdoorTemperatureC >= 30 && minute >= 11 * 60 && minute <= 15 * 60;
      const weatherCoupling = acActive ? 0.018 : room.id === 'garden' ? 0.28 : strongSolarHeat ? 0.075 : 0.035;
      const occupantHeat = room.humanOccupancy && !acActive ? 0.025 : 0;
      const applianceHeat = kitchenApplianceHeat(
        this.nativeDeviceBehaviorEnabled('stove') ? this.deviceOfType('stove', room.id) : undefined,
        this.nativeDeviceBehaviorEnabled('fridge') ? this.deviceOfType('fridge', room.id) : undefined
      );
      const ventilationCooling = kitchenVentilationCooling(
        this.nativeDeviceBehaviorEnabled('range_hood') ? this.deviceOfType('range_hood', room.id) : undefined,
        currentTemperature,
        outdoorTemperature
      );
      const nextTemperature = currentTemperature +
        (outdoorTemperature - currentTemperature) * weatherCoupling +
        occupantHeat +
        applianceHeat -
        ventilationCooling;
      const humidityTarget = humidityTargetForWeather(weather.condition, room.id);
      const humidityCoupling = acActive ? 0.01 : 0.035;
      const nextHumidity = currentHumidity + (humidityTarget - currentHumidity) * humidityCoupling - (acActive ? 0.04 : 0);

      room.temperatureC = this.round(this.clamp(nextTemperature, room.id === 'garden' ? -10 : 16, room.id === 'garden' ? 45 : 32));
      room.humidityPercent = this.round(this.clamp(nextHumidity, 35, 82));
    }
  }

  private advanceAirConditionerClimateEffects(): void {
    if (!this.nativeDeviceBehaviorEnabled('air_conditioner')) {
      return;
    }
    for (const ac of this.devicesOfType('air_conditioner')) {
      const room = this.state.snapshot.rooms[ac.roomId];
      if (!ac || !room || ac.state.power !== 'on') {
        continue;
      }
      const mode = String(ac.state.mode ?? 'auto');
      const targetC = Number(ac.state.targetC ?? 26);
      const currentTemperature = Number(room.temperatureC ?? targetC);
      const currentHumidity = Number(room.humidityPercent ?? 55);
      const delta = targetC - currentTemperature;
      let nextTemperature = currentTemperature;
      let nextHumidity = currentHumidity;

      if (mode === 'cool' && delta < 0) {
        nextTemperature += Math.max(delta, -0.35);
        nextHumidity -= 0.08;
      } else if (mode === 'heat' && delta > 0) {
        nextTemperature += Math.min(delta, 0.32);
        nextHumidity -= 0.04;
      } else if (mode === 'auto' && Math.abs(delta) > 0.2) {
        nextTemperature += Math.sign(delta) * Math.min(Math.abs(delta), 0.18);
      }

      room.temperatureC = this.round(this.clamp(nextTemperature, 16, 32));
      room.humidityPercent = this.round(this.clamp(nextHumidity, 35, 78));
    }
  }

  private advanceRobotVacuumLifecycle(): TwinEvent[] {
    if (!this.nativeDeviceBehaviorEnabled('robot_vacuum')) {
      return [];
    }
    const vacuum = this.deviceOfType('robot_vacuum');
    if (!vacuum) {
      return [];
    }
    if (this.state.snapshot.homeState.mode === 'sleeping' && ['cleaning', 'assisted'].includes(String(vacuum.state.status))) {
      return [
        this.setDeviceState(vacuum.id, { status: 'docked', cycleMinutes: 0, batteryPercent: vacuum.state.batteryPercent ?? 90, binFull: false }, 'rule:sleep_mode:quiet_robot_dock')
      ];
    }
    if (vacuum.state.status === 'assisted') {
      return [
        this.setDeviceState(vacuum.id, { status: 'cleaning' }, 'device_lifecycle:robot_vacuum:resume_after_assist')
      ];
    }
    if (vacuum.state.status === 'stuck') {
      const cycleMinutes = Math.max(1, Number(vacuum.state.cycleMinutes ?? 0) + 1);
      const batteryPercent = this.clamp(Number(vacuum.state.batteryPercent ?? 92) - 0.6, 20, 100);
      const actor = this.selectRobotVacuumAssistActor(vacuum.roomId);
      if (cycleMinutes >= 6 && actor && this.state.snapshot.homeState.mode !== 'away') {
        const events: TwinEvent[] = actor
          ? this.createRoutedPersonMovedEvents(actor.id, vacuum.roomId, `controlling_${vacuum.id}`, 'social:robot_vacuum_assist')
          : [];
        events.push(this.setDeviceState(vacuum.id, { status: 'assisted', cycleMinutes, batteryPercent: this.round(batteryPercent) }, 'social:robot_vacuum_assist'));
        events.push(this.createEvent({
          type: 'AutomationTriggered',
          ruleId: 'robot_vacuum_assisted',
          explanation: 'A household member noticed the stuck robot vacuum and cleared the path so cleaning can resume.',
          actions: ['route_household_member_to_robot', 'clear_robot_path', 'resume_robot_cleaning'],
          reason: `${vacuum.id}.status:stuck_waiting`,
          eventExplanation: {
            why: 'The robot vacuum stayed stuck while an awake household member was home.',
            actorIds: actor ? [actor.id] : [],
            affectedDeviceIds: [vacuum.id],
            affectedRoomIds: [vacuum.roomId],
            expectedOutcome: 'Clear the stuck condition without requiring an explicit operator command.'
          }
        }));
        return events;
      }
      if (cycleMinutes >= 12) {
        const events: TwinEvent[] = [
          this.setDeviceState(vacuum.id, { status: 'docked', cycleMinutes: 0, batteryPercent: this.round(batteryPercent), binFull: false }, 'device_lifecycle:robot_vacuum:stuck_timeout_docked')
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
            reason: `${vacuum.id}.status:stuck_timeout_docked`
          }));
        }
        events.push(...this.recoverRuleIfActive('robot_vacuum_stuck', [`${vacuum.id}.status:docked`]));
        return events;
      }
      vacuum.state.cycleMinutes = cycleMinutes;
      vacuum.state.batteryPercent = this.round(batteryPercent);
      if (cycleMinutes === 4 || cycleMinutes === 8) {
        return [
          this.setDeviceState(vacuum.id, { cycleMinutes, batteryPercent: this.round(batteryPercent) }, 'device_lifecycle:robot_vacuum:stuck_waiting')
        ];
      }
      return [];
    }
    if (vacuum.state.status !== 'cleaning') {
      return [];
    }

    const cycleMinutes = Math.max(1, Number(vacuum.state.cycleMinutes ?? 0) + 1);
    const batteryPercent = this.clamp(Number(vacuum.state.batteryPercent ?? 92) - 1.5, 20, 100);
    if (this.shouldRobotVacuumReportStuck(vacuum, cycleMinutes)) {
      this.activateRule('robot_vacuum_stuck');
      return [
        this.setDeviceState(vacuum.id, { status: 'stuck', cycleMinutes, batteryPercent: this.round(batteryPercent) }, 'device_lifecycle:robot_vacuum:stuck'),
        this.createAlertEvent('robot_vacuum_stuck_001', 'warning', vacuum.roomId, `Robot vacuum needs help in ${this.state.snapshot.rooms[vacuum.roomId]?.name ?? vacuum.roomId}`, 'clear_robot_path', 'rule:robot_vacuum_stuck'),
        this.createEvent({
          type: 'AutomationTriggered',
          ruleId: 'robot_vacuum_stuck',
          explanation: 'Robot vacuum cleaning paused because the robot reported a stuck condition.',
          actions: ['raise_robot_help_alert', 'wait_for_household_assist'],
          reason: `${vacuum.id}.status:stuck`,
          eventExplanation: {
            why: `${vacuum.id} became stuck during its cleaning lifecycle.`,
            actorIds: [],
            affectedDeviceIds: [vacuum.id],
            affectedRoomIds: [vacuum.roomId],
            expectedOutcome: 'Ask a household member to clear the path so cleaning can resume.'
          }
        })
      ];
    }
    if (cycleMinutes >= this.robotVacuumTargetCycleMinutes(vacuum)) {
      const events: TwinEvent[] = [
        this.setDeviceState(vacuum.id, { status: 'docked', cycleMinutes: 0, batteryPercent: this.round(batteryPercent), binFull: false }, 'device_lifecycle:robot_vacuum:docked')
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
          reason: `${vacuum.id}.status:docked`
        }));
      }
      events.push(...this.recoverRuleIfActive('robot_vacuum_stuck', [`${vacuum.id}.status:docked`]));
      return events;
    }
    return [
      this.setDeviceState(vacuum.id, { cycleMinutes, batteryPercent: this.round(batteryPercent) }, 'device_lifecycle:robot_vacuum:cleaning')
    ];
  }

  private shouldRobotVacuumReportStuck(vacuum: DeviceState, cycleMinutes: number): boolean {
    if (this.state.triggeredRules.has('robot_vacuum_stuck') || cycleMinutes < 3) {
      return false;
    }
    const minuteOfDay = minuteOfDayFromTime(this.state.snapshot.simClock.currentTime);
    const weekdayMorningRoutineCleaning = (
      minuteOfDay >= 7 * 60 &&
      minuteOfDay <= 9 * 60 &&
      vacuum?.state.status === 'cleaning'
    );
    if (weekdayMorningRoutineCleaning && this.state.snapshot.runContext.seed % 5 !== 0) {
      return false;
    }
    const clutterPressure = Math.min(2, Math.max(0, this.state.snapshot.worldState.inventory.unfinishedChores));
    const seedOffset = this.state.snapshot.runContext.seed % 3;
    return cycleMinutes === 3 + Math.min(seedOffset, clutterPressure);
  }

  private robotVacuumTargetCycleMinutes(vacuum: DeviceState): number {
    const occupancyPenalty = this.state.snapshot.rooms[vacuum.roomId]?.humanOccupancy ? 1 : 0;
    return 6 + this.state.snapshot.runContext.seed % 3 + occupancyPenalty;
  }

  private advanceRouterRestartLifecycle(): TwinEvent[] {
    if (!this.nativeDeviceBehaviorEnabled('router')) {
      return [];
    }
    const router = this.deviceOfType('router');
    if (!router) {
      return [];
    }
    if (router.state.lifecyclePhase === 'restarting') {
      return [
        this.setDeviceState(router.id, { online: true, latencyMs: 80, lifecyclePhase: 'reconnecting' }, 'ambient:router:reconnecting')
      ];
    }
    if (router.state.lifecyclePhase === 'reconnecting') {
      return [
        this.setDeviceState(router.id, { online: true, latencyMs: 18, lifecyclePhase: 'recovered' }, 'ambient:router:recovered'),
        ...this.recoverRuleIfActiveOrAlert('network_offline', [`${router.id}.online:true`])
      ];
    }
    return [];
  }

  private movePetAroundHome(): TwinEvent[] {
    const pet = this.state.snapshot.people.pet_1;
    if (!pet || pet.location === 'away') {
      return [];
    }

    if (this.state.snapshot.homeState.mode === 'sleeping' || pet.activity === 'sleeping') {
      return [];
    }

    const interval = pet.activity === 'resting' ? 60 : 45;
    if (this.state.elapsedMinutes % interval !== 0) {
      return [];
    }

    const destinations: RoomId[] = ['living_room', 'kitchen', 'dining_room', 'garden', 'master_bedroom'];
    const candidates = destinations.filter((roomId) => roomId !== pet.location);
    const to = candidates[Math.floor(this.state.random.range(0, candidates.length))] ?? 'living_room';
    const activities = this.state.elapsedMinutes < 90
      ? ['wandering', 'sniffing', 'checking_room']
      : ['wandering', 'sniffing', 'resting', 'checking_room'];
    const activity = activities[Math.floor(this.state.random.range(0, activities.length))] ?? 'wandering';
    return this.createRoutedPersonMovedEvents('pet_1', to, activity);
  }

  private applyPersonStateConsistency(): TwinEvent[] {
    const events: TwinEvent[] = [];
    for (const person of Object.values(this.state.snapshot.people)) {
      if (person.kind === 'human' && person.activity === 'school' && person.location !== 'away') {
        events.push(...this.createRoutedPersonMovedEvents(person.id, 'away', 'school', 'rule:school_location_consistency'));
      }
    }
    return events;
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
      const persona = this.personaFor(person.id);
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
      const persona = this.personaFor(person.id);
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
    const persona = this.personaFor(personId);
    const currentNeeds = this.state.personNeeds.get(personId) ?? createInitialNeeds(persona);
    this.state.personNeeds.set(personId, applyActivityEffectsToNeeds(currentNeeds, activityId));
  }

  private commitmentPressureByActivity(personId: string, persona: ReturnType<typeof getPersonaForDefinition>, minuteOfDay: number): Record<string, number> {
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

  startCompiledHouseholdRun(run: CompiledHouseholdRun): TwinEvent[] {
    if (run.homeDefinition.building.id !== this.homeDefinition.building.id) {
      throw new Error(`Compiled household ${run.homeDefinition.building.id} does not match simulator home ${this.homeDefinition.building.id}`);
    }
    this.assertBehaviorModulesInstalled(run.behaviorVersions);
    this.assertAutomationPolicyInstalled(run.automationPolicyVersion);
    return this.startScenarioDefinition(
      run.lifePlan,
      `${run.templateId}@${run.templateVersion}`,
      run.seed,
      {
        templateId: run.templateId,
        templateVersion: run.templateVersion,
        templateDigest: run.templateDigest,
        compilerVersion: run.compilerVersion,
        date: run.date,
        timezone: run.timezone,
        repertoireVersions: structuredClone(run.repertoireVersions),
        behaviorVersions: structuredClone(run.behaviorVersions),
        automationPolicyVersion: structuredClone(run.automationPolicyVersion),
        environmentSnapshot: structuredClone(run.environmentSnapshot)
      }
    );
  }

  private personaFor(personId: string): ReturnType<typeof getPersonaForDefinition> {
    return personaForCatalog(personId, this.state.catalog);
  }

  private assertBehaviorModulesInstalled(behaviorVersions: Record<string, string>): void {
    for (const [id, version] of Object.entries(behaviorVersions)) {
      if (!this.behaviorModulesByIdentity.has(`${id}@${version}`)) {
        throw new Error(`Compiled household requires device behavior module ${id}@${version}`);
      }
    }
  }

  private assertAutomationPolicyInstalled(reference: { id: string; version: string }): void {
    if (!this.automationPoliciesByIdentity.has(`${reference.id}@${reference.version}`)) {
      throw new Error(`Compiled household requires automation policy ${reference.id}@${reference.version}`);
    }
  }

  private activeAutomationPolicy(): AutomationPolicyModule {
    const reference = this.state.snapshot.runContext.householdRun?.automationPolicyVersion ?? coreAutomationPolicyModule;
    const policy = this.automationPoliciesByIdentity.get(`${reference.id}@${reference.version}`);
    if (!policy) {
      throw new Error(`Active household requires missing automation policy ${reference.id}@${reference.version}`);
    }
    return policy;
  }

  private automationRuleEnabled(ruleId: AutomationRuleId): boolean {
    return isAutomationRuleEnabled(this.activeAutomationPolicy(), ruleId);
  }

  private activeDeviceBehaviorModules(): DeviceBehaviorModule[] {
    const versions = this.state.snapshot.runContext.householdRun?.behaviorVersions;
    if (!versions) {
      return [coreDeviceBehaviorModule];
    }
    return Object.entries(versions).map(([id, version]) => {
      const module = this.behaviorModulesByIdentity.get(`${id}@${version}`);
      if (!module) {
        throw new Error(`Active household requires missing device behavior module ${id}@${version}`);
      }
      return module;
    });
  }

  private deviceBehaviorOwners(modules = this.activeDeviceBehaviorModules()): Map<string, string> {
    const owners = new Map<string, string>();
    for (const module of modules) {
      for (const deviceType of module.deviceTypes) {
        const owner = owners.get(deviceType);
        if (!owner || module.replaces?.includes(owner)) {
          owners.set(deviceType, module.id);
        }
      }
    }
    return owners;
  }

  private nativeDeviceBehaviorEnabled(deviceType: string): boolean {
    return this.deviceBehaviorOwners().get(deviceType) === coreDeviceBehaviorModule.id;
  }

  private deviceOfType(type: string, roomId?: RoomId): DeviceState | undefined {
    const definition = this.state.catalog.devices.find((device) => (
      device.type === type && (roomId === undefined || device.roomId === roomId)
    ));
    return definition ? this.state.snapshot.devices[definition.id] : undefined;
  }

  private devicesOfType(type: string): DeviceState[] {
    return this.state.catalog.devices
      .filter((device) => device.type === type)
      .map((device) => this.state.snapshot.devices[device.id])
      .filter((device): device is DeviceState => Boolean(device));
  }

  private requireDeviceOfType(type: string, operation: string, roomId?: RoomId): DeviceState {
    const device = this.deviceOfType(type, roomId);
    if (!device) {
      const roomContext = roomId ? ` in room ${roomId}` : '';
      throw new Error(`Cannot ${operation}: home has no ${type} device${roomContext}`);
    }
    return device;
  }

  private requireResidentByRole(role: string, operation: string): PersonState {
    const resident = Object.values(this.state.snapshot.people).find((person) => this.personaFor(person.id).role === role);
    if (!resident) {
      throw new Error(`Cannot ${operation}: home has no resident with role ${role}`);
    }
    return resident;
  }

  private primaryRoomForPerson(personId: string): RoomId | undefined {
    const person = this.state.catalog.people.find((candidate) => candidate.id === personId);
    return person?.profile?.primaryRooms.find((roomId) => Boolean(this.state.snapshot.rooms[roomId]))
      ?? this.state.catalog.rooms.find((room) => room.type !== 'outdoor')?.id;
  }

  private primaryRoomForPurpose(purpose: string): RoomId | undefined {
    return this.state.catalog.rooms.find((room) => room.purposes?.includes(purpose))?.id;
  }

  private applyBehaviorProfileInteractions(): TwinEvent[] {
    const events: TwinEvent[] = [];
    events.push(...this.applyCommuterArrivalScene());
    events.push(...this.applySocialCoordination());
    events.push(...this.applyHumanActivityLighting());
    events.push(...this.applyRoomClimateComfort());
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
    if (!this.isCookingReadyForMealInvitation(host.id)) {
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

  private isCookingReadyForMealInvitation(cookId: string): boolean {
    const cook = this.state.snapshot.people[cookId];
    if (!cook || cook.location !== 'kitchen' || !['cooking_dinner', 'prepare_dinner'].includes(cook.activity)) {
      return true;
    }
    const stovePowerW = Number(this.state.snapshot.devices.stove_01.state.powerW ?? 0);
    if (stovePowerW <= 100) {
      return true;
    }
    const activeCooking = Object.values(this.state.snapshot.activities)
      .filter((activity) => activity.participants.includes(cookId))
      .filter((activity) => ['cooking_dinner', 'daily_dinner', 'weekend_brunch'].includes(activity.activityId))
      .map((activity) => minutesBetween(activity.startedAt, this.state.snapshot.simClock.currentTime));
    const cookingMinutes = activeCooking.length > 0 ? Math.max(...activeCooking) : 0;
    return cookingMinutes >= 45;
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
    if (!this.currentCalendarContext().schoolDay) {
      return child.activity === 'homework' ? 35 : 0;
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

  private currentCalendarContext(): ReturnType<typeof createExternalContext>['calendar'] {
    return createExternalContext({
      date: this.state.snapshot.simClock.currentTime.slice(0, 10),
      seed: this.state.snapshot.runContext.seed
    }).calendar;
  }

  private currentWeatherContext(): ReturnType<typeof createExternalContext>['weather'] {
    const calendar = this.state.activeScenario.calendar;
    if (
      calendar?.weatherCondition &&
      typeof calendar.outdoorTemperatureC === 'number' &&
      typeof calendar.precipitationMm === 'number' &&
      calendar.date === this.state.snapshot.simClock.currentTime.slice(0, 10)
    ) {
      return {
        condition: calendar.weatherCondition,
        outdoorTemperatureC: calendar.outdoorTemperatureC,
        precipitationMm: calendar.precipitationMm
      };
    }
    return createExternalContext({
      date: this.state.snapshot.simClock.currentTime.slice(0, 10),
      seed: this.state.snapshot.runContext.seed
    }).weather;
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

  private applyRoomClimateComfort(): TwinEvent[] {
    const events: TwinEvent[] = [];
    for (const [roomId, deviceId] of Object.entries(roomClimateDevices) as Array<[RoomId, string]>) {
      const ac = this.state.snapshot.devices[deviceId];
      const room = this.state.snapshot.rooms[roomId];
      if (!ac || !room) {
        continue;
      }

      const occupants = room.people
        .map((personId) => this.state.snapshot.people[personId])
        .filter((person): person is PersonState => Boolean(person) && person.kind === 'human' && person.location !== 'away');
      const temperatureC = Number(room.temperatureC ?? 25);
      const humidityPercent = Number(room.humidityPercent ?? 55);
      const roomOccupied = occupants.length > 0 && this.state.snapshot.homeState.mode !== 'away';
      const climateRuleControlled = this.isClimateRuleControlled(ac.lastReason, roomId);

      if (!roomOccupied) {
        events.push(...this.setRoomClimateIfChanged({
          deviceId,
          roomId,
          patch: { power: 'off' },
          reason: `habit:climate:${roomId}:vacant_or_comfortable`,
          explanation: `${roomId} is empty, so the twin releases rule-controlled air conditioning.`,
          actions: [`turn_off_${roomId}_ac_when_vacant`],
          occupants: [],
          temperatureC,
          humidityPercent,
          allowedToChange: climateRuleControlled
        }));
        continue;
      }

      const awakeActor = occupants.find((person) => person.activity !== 'sleeping' && this.state.snapshot.homeState.mode !== 'sleeping');
      const actorPrefix = awakeActor ? `operator:climate:${roomId}:${awakeActor.id}` : `automation:climate:${roomId}`;
      if (temperatureC >= 28.5) {
        events.push(...this.setRoomClimateIfChanged({
          deviceId,
          roomId,
          patch: { power: 'on', targetC: 25, mode: 'cool' },
          reason: `${actorPrefix}:occupied_cooling`,
          explanation: `${roomId} is occupied and warm, so climate control cools the room to a conservative comfort target.`,
          actions: [`set_${roomId}_ac_cooling_target`],
          occupants,
          actor: awakeActor,
          temperatureC,
          humidityPercent,
          allowedToChange: true
        }));
        continue;
      }

      if (temperatureC <= 17.5) {
        events.push(...this.setRoomClimateIfChanged({
          deviceId,
          roomId,
          patch: { power: 'on', targetC: 21, mode: 'heat' },
          reason: `${actorPrefix}:occupied_heating`,
          explanation: `${roomId} is occupied and cold, so climate control warms the room to a conservative comfort target.`,
          actions: [`set_${roomId}_ac_heating_target`],
          occupants,
          actor: awakeActor,
          temperatureC,
          humidityPercent,
          allowedToChange: true
        }));
        continue;
      }

      events.push(...this.setRoomClimateIfChanged({
        deviceId,
        roomId,
        patch: { power: 'off' },
        reason: `habit:climate:${roomId}:vacant_or_comfortable`,
        explanation: `${roomId} temperature is back in the comfort range, so the twin stops rule-controlled climate support.`,
        actions: [`turn_off_${roomId}_ac_after_comfort_recovers`],
        occupants,
        temperatureC,
        humidityPercent,
        allowedToChange: false
      }));
    }
    return events;
  }

  private setRoomClimateIfChanged(input: {
    deviceId: string;
    roomId: RoomId;
    patch: Record<string, string | number | boolean | null>;
    reason: string;
    explanation: string;
    actions: string[];
    occupants: PersonState[];
    actor?: PersonState;
    temperatureC: number;
    humidityPercent: number;
    allowedToChange: boolean;
  }): TwinEvent[] {
    const device = this.state.snapshot.devices[input.deviceId];
    const changedPatch = device
      ? Object.fromEntries(Object.entries(input.patch).filter(([key, value]) => device.state[key] !== value))
      : {};
    if (!input.allowedToChange || Object.keys(changedPatch).length === 0) {
      return [];
    }

    const events: TwinEvent[] = [];
    if (input.actor) {
      const originalLocation = input.actor.location;
      const originalActivity = input.actor.activity;
      events.push(...this.createRoutedPersonMovedEvents(input.actor.id, input.roomId, `controlling_${input.deviceId}`, input.reason));
      input.actor.location = originalLocation;
      input.actor.activity = originalActivity;
      this.updatePersonBehavior(input.actor.id);
    }
    events.push(this.setDeviceState(input.deviceId, changedPatch, input.reason));
    events.push(this.createEvent({
      type: 'AutomationTriggered',
      ruleId: 'room_climate_comfort',
      explanation: input.explanation,
      actions: input.actions,
      reason: input.reason,
      eventExplanation: {
        why: `${input.roomId} is ${input.temperatureC.toFixed(1)}C / ${input.humidityPercent.toFixed(0)}% with ${input.occupants.length} human occupant${input.occupants.length === 1 ? '' : 's'}.`,
        actorIds: input.actor ? [input.actor.id] : input.occupants.map((person) => person.id),
        affectedDeviceIds: [input.deviceId],
        affectedRoomIds: [input.roomId],
        relatedIntent: 'room_comfort',
        expectedOutcome: 'Keep climate changes tied to room occupancy, user action, or sleep comfort instead of random device activity.'
      }
    }));
    return events;
  }

  private isClimateRuleControlled(reason: string | undefined, roomId: RoomId): boolean {
    return typeof reason === 'string' && (
      reason.startsWith(`habit:climate:${roomId}:`) ||
      reason.startsWith(`operator:climate:${roomId}:`) ||
      reason.startsWith(`automation:climate:${roomId}:`)
    );
  }

  private devicePatchChanges(deviceId: string, patch: Record<string, string | number | boolean | null>): boolean {
    const device = this.state.snapshot.devices[deviceId];
    return Boolean(device) && Object.entries(patch).some(([key, value]) => device.state[key] !== value);
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
      child.location !== 'living_room' ||
      child.activity !== 'homework' ||
      this.state.triggeredRules.has('child_homework_focus')
    ) {
      return [];
    }

    this.state.triggeredRules.add('child_homework_focus');
    return [
      this.setDeviceState('tv_01', { power: 'off', app: null, volume: 0 }, 'habit:child_1:homework:quiet_focus'),
      this.setDeviceState('living_light_01', { power: 'on', brightness: 32 }, 'habit:child_1:homework:reduce_living_room_distraction'),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'child_homework_focus',
        explanation: 'The student is doing homework in the living room, so entertainment is kept quiet.',
        actions: ['turn_off_tv_for_homework', 'dim_living_light_for_homework'],
        reason: 'habit:child_1:homework',
        eventExplanation: {
          why: 'child_1 is in after_school with intent finish_homework.',
          actorIds: ['child_1'],
          affectedDeviceIds: ['tv_01', 'living_light_01'],
          affectedRoomIds: ['living_room'],
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
      this.setDeviceState('router_01', { online: true, latencyMs: 24 }, 'habit:adult_2:remote_work:network_load'),
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
    const sensors = this.state.catalog.devices.filter((device) => device.type === 'motion_sensor');

    for (const sensor of sensors) {
      const room = this.state.snapshot.rooms[sensor.roomId];
      if (!room) {
        throw new Error(`Motion sensor ${sensor.id} references missing room ${sensor.roomId}`);
      }
      const observation = observeMotionSensor({
        deviceId: sensor.id,
        roomId: sensor.roomId,
        deviceType: 'motion_sensor',
        worldState: {
          humanOccupancy: room.humanOccupancy,
          petOccupancy: room.people.some((personId) => this.state.snapshot.people[personId]?.kind === 'pet'),
          motionDetected: room.motionDetected
        },
        previousObservation: this.state.sensorObservations.get(sensor.id),
        currentTime: this.state.snapshot.simClock.currentTime,
        randomSeed: this.state.random.getState()
      }, getSensorProfile('motion_sensor'));
      if (!observation) {
        continue;
      }
      this.state.sensorObservations.set(sensor.id, observation.observedState);
      const telemetryEvent = this.createTelemetryEventFromObservation(observation);
      events.push(telemetryEvent);
      for (const additionalEvent of observation.additionalEvents ?? []) {
        events.push(this.createEvent(additionalEvent));
      }

      const patch = telemetryMeasurementsToDeviceState(observation.event.measurements);
      if (Object.keys(patch).length > 0) {
        const stateEvent = this.setDeviceStateIfChanged(sensor.id, patch, `sensor:motion:${room.humanOccupancy ? 'human' : 'non_human'}:${sensor.roomId}`);
        if (stateEvent) {
          events.push(stateEvent);
        }
      }
    }

    return events;
  }

  private syncSecurityCameras(): TwinEvent[] {
    return this.state.catalog.devices
      .filter((device) => device.type === 'doorbell_camera' || device.type === 'security_camera')
      .flatMap((device) => this.syncSecurityCameraMotion(device.id));
  }

  private syncSecurityCameraMotion(deviceId: string): TwinEvent[] {
    const device = this.state.snapshot.devices[deviceId];
    if (!device) {
      throw new Error(`Security camera ${deviceId} is missing from the snapshot`);
    }
    const roomId = device.roomId;
    const room = this.state.snapshot.rooms[roomId];
    if (!room) {
      throw new Error(`Security camera ${deviceId} references missing room ${roomId}`);
    }
    if (device.type === 'security_camera' && !room.humanOccupancy) {
      return [];
    }

    const observation = observeMotionSensor({
      deviceId,
      roomId,
      deviceType: device.type,
      worldState: {
        humanOccupancy: room.humanOccupancy,
        petOccupancy: room.people.some((personId) => this.state.snapshot.people[personId]?.kind === 'pet'),
        motionDetected: room.motionDetected
      },
      previousObservation: this.state.sensorObservations.get(deviceId),
      currentTime: this.state.snapshot.simClock.currentTime,
      randomSeed: this.state.random.getState()
    }, getSensorProfile(device.type));

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

    const patch: Record<string, string | number | boolean | null> = device.type === 'doorbell_camera'
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
    const doorbell = this.state.catalog.devices.find((device) => device.type === 'doorbell_camera');
    const packageSensor = this.state.catalog.devices.find((device) => device.type === 'package_sensor');
    if (!doorbell || !packageSensor || doorbell.roomId !== packageSensor.roomId) {
      return [];
    }
    if (this.state.triggeredRules.has('package_delivery') || this.state.elapsedMinutes < 45 || this.state.elapsedMinutes > 420) {
      return [];
    }
    if (this.state.random.next() >= 0.018) {
      return [];
    }

    this.state.triggeredRules.add('package_delivery');
    return [
      this.setDeviceState(doorbell.id, { motion: true, ringing: true }, 'external:package_delivery'),
      this.setDeviceState(packageSensor.id, {
        packagePresent: true,
        weightKg: this.round(this.state.random.range(0.4, 3.6))
      }, 'external:package_delivery'),
      this.createAlertEvent('package_delivery_001', 'info', doorbell.roomId, 'Package delivered at the front door', 'bring_package_inside', 'external:package_delivery'),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'package_delivery',
        explanation: 'Doorbell camera and package sensor detected a delivery.',
        actions: ['ring_doorbell_camera', 'mark_package_present', 'notify_household'],
        reason: 'external:package_delivery'
      })
    ];
  }

  private maybeStartRobotCleaning(): TwinEvent[] {
    const vacuum = this.deviceOfType('robot_vacuum');
    if (!vacuum || this.state.triggeredRules.has('robot_cleaning') || this.state.elapsedMinutes < 90 || this.state.elapsedMinutes > 540 || vacuum.state.status !== 'docked') {
      return [];
    }
    const weekendCleaning = Object.values(this.state.snapshot.people).some((person) => (
      person.kind === 'human' &&
      ['weekend_cleaning', 'tidying'].includes(person.activity)
    ));
    const awayCleaningWindow = this.state.snapshot.homeState.mode === 'away';
    if (!awayCleaningWindow && !weekendCleaning) {
      return [];
    }
    if (!awayCleaningWindow && (!this.allowsNoisyAutomation() || this.state.snapshot.rooms[vacuum.roomId]?.humanOccupancy)) {
      return [];
    }
    if (this.state.random.next() >= (awayCleaningWindow ? 0.004 : 0.014)) {
      return [];
    }

    this.state.triggeredRules.add('robot_cleaning');
    return [
      this.setDeviceState(vacuum.id, {
        status: 'cleaning',
        batteryPercent: 92,
        cycleMinutes: 0,
        binFull: false
      }, 'scheduled_automation:robot_cleaning'),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'robot_cleaning',
        explanation: 'Robot vacuum started a scheduled daytime cleaning run while the living room was unoccupied.',
        actions: ['start_robot_vacuum'],
        reason: 'scheduled_automation:robot_cleaning'
      })
    ];
  }

  private maybeStartDishwasher(): TwinEvent[] {
    const dishwasher = this.deviceOfType('dishwasher');
    if (!dishwasher) {
      return [];
    }
    const dinnerDone = !this.state.snapshot.activities.family_dinner && this.state.elapsedMinutes > 760;
    const breakfastDone = !this.state.snapshot.activities.breakfast && this.state.elapsedMinutes > 85;
    const actor = this.selectAwakeHumanForHouseholdActivity(['kitchen', 'dining_room', 'living_room']);
    if (
      this.state.triggeredRules.has('dishwasher_cycle') ||
      dishwasher.state.status !== 'idle' ||
      (!breakfastDone && !dinnerDone) ||
      this.state.snapshot.worldState.inventory.dirtyDishes < 4 ||
      !this.allowsNoisyAutomation() ||
      !actor
    ) {
      return [];
    }
    if (this.state.random.next() >= 0.02) {
      return [];
    }

    this.state.triggeredRules.add('dishwasher_cycle');
    const reason = 'household_activity:load_dishwasher';
    const activityEvents = this.startHouseholdActivity(actor.id, dishwasher.roomId, 'load_dishwasher', reason);
    this.state.snapshot.worldState.inventory = applyActivityToInventory(this.state.snapshot.worldState.inventory, 'load_dishwasher');
    this.applyActivityEffectsToPerson(actor.id, 'load_dishwasher');
    return [
      ...activityEvents,
      this.setDeviceState(dishwasher.id, { status: 'running', remainingMin: 45, powerW: 620 }, reason),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'dishwasher_cycle',
        explanation: 'A household member loaded the dishwasher after a meal and started the cycle.',
        actions: ['load_dishwasher', 'start_dishwasher_cycle'],
        reason,
        eventExplanation: {
          why: `${actor.id} is awake near the kitchen/dining area and dirty dishes exceed the run threshold.`,
          actorIds: [actor.id],
          affectedDeviceIds: [dishwasher.id],
          affectedRoomIds: [dishwasher.roomId],
          relatedIntent: 'household_chore',
          expectedOutcome: 'Dirty dishes are loaded before the dishwasher starts instead of the appliance starting anonymously.'
        }
      })
    ];
  }

  private maybeStartWasher(): TwinEvent[] {
    const washer = this.deviceOfType('washer');
    if (!washer) {
      return [];
    }
    const actor = this.selectAwakeHumanForHouseholdActivity(['bathroom', 'master_bedroom', 'kitchen']);
    if (
      this.state.triggeredRules.has('washer_cycle') ||
      washer.state.status !== 'idle' ||
      this.state.snapshot.worldState.inventory.dirtyLaundryKg < 3 ||
      !this.allowsNoisyAutomation() ||
      !actor ||
      this.state.elapsedMinutes < 180 ||
      this.state.elapsedMinutes > 780
    ) {
      return [];
    }
    if (this.state.random.next() >= 0.012) {
      return [];
    }

    this.state.triggeredRules.add('washer_cycle');
    const reason = 'household_activity:laundry_cycle';
    const activityEvents = this.startHouseholdActivity(actor.id, washer.roomId, 'laundry_cycle', reason);
    this.state.snapshot.worldState.inventory = applyActivityToInventory(this.state.snapshot.worldState.inventory, 'laundry_cycle');
    this.applyActivityEffectsToPerson(actor.id, 'laundry_cycle');
    return [
      ...activityEvents,
      this.setDeviceState(washer.id, { status: 'running', remainingMin: 55, powerW: 480 }, reason),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'washer_cycle',
        explanation: 'A household member loaded enough laundry and started the washing machine.',
        actions: ['load_washer', 'start_washer_cycle'],
        reason,
        eventExplanation: {
          why: `${actor.id} is awake and dirty laundry exceeds the load threshold.`,
          actorIds: [actor.id],
          affectedDeviceIds: [washer.id],
          affectedRoomIds: [washer.roomId],
          relatedIntent: 'household_chore',
          expectedOutcome: 'Laundry is loaded by a person before the washer starts.'
        }
      })
    ];
  }

  private maybeNetworkJitter(): TwinEvent[] {
    const router = this.deviceOfType('router');
    if (!router || this.state.triggeredRules.has('network_jitter') || router.state.online !== true || this.state.elapsedMinutes < 60) {
      return [];
    }
    if (this.state.random.next() >= 0.01) {
      return [];
    }

    this.state.triggeredRules.add('network_jitter');
    return [
      this.setDeviceState(router.id, { online: true, latencyMs: 145 }, 'external:network_jitter'),
      this.createAlertEvent('network_jitter_001', 'warning', router.roomId, 'Home network latency is elevated', 'check_router', 'external:network_jitter'),
      this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'network_jitter',
        explanation: 'Router telemetry reported elevated latency.',
        actions: ['notify_network_jitter'],
        reason: 'external:network_jitter'
      })
    ];
  }

  private allowsNoisyAutomation(): boolean {
    const mode = this.state.snapshot.homeState.mode;
    if (mode === 'sleeping' || mode === 'away') {
      return false;
    }
    return this.hasAwakeHumanHome();
  }

  private hasAwakeHumanHome(): boolean {
    return Object.values(this.state.snapshot.people).some((person) => (
      person.kind === 'human' &&
      person.location !== 'away' &&
      person.activity !== 'sleeping'
    ));
  }

  private selectAwakeHumanForHouseholdActivity(preferredRooms: RoomId[]): PersonState | undefined {
    const candidates = Object.values(this.state.snapshot.people).filter((person): person is PersonState => (
      person.kind === 'human' &&
      person.location !== 'away' &&
      person.activity !== 'sleeping' &&
      !person.activity.startsWith('walking_to_') &&
      !person.activity.startsWith('controlling_')
    ));
    return candidates.find((person) => person.location !== 'away' && preferredRooms.includes(person.location)) ?? candidates[0];
  }

  private selectRobotVacuumAssistActor(roomId: RoomId): PersonState | undefined {
    const interruptibleActivities = new Set(['reading', 'watching_tv', 'slow_morning', 'weekend_cleaning', 'tidying']);
    const candidates = Object.values(this.state.snapshot.people).filter((person): person is PersonState => (
      person.kind === 'human' &&
      person.location !== 'away' &&
      person.activity !== 'sleeping' &&
      !person.activity.startsWith('walking_to_') &&
      !person.activity.startsWith('controlling_') &&
      interruptibleActivities.has(person.activity)
    ));
    return candidates.find((person) => person.location === roomId) ?? candidates[0];
  }

  private startHouseholdActivity(personId: string, roomId: RoomId, activityId: string, reason: string): TwinEvent[] {
    const events: TwinEvent[] = this.createRoutedPersonMovedEvents(personId, roomId, activityId, reason);
    this.state.snapshot.activities[activityId] = {
      activityId,
      participants: [personId],
      roomId,
      startedAt: this.state.snapshot.simClock.currentTime
    };
    events.push(this.createEvent({
      type: 'ActivityStarted',
      activityId,
      participants: [personId],
      roomId,
      reason
    }));
    return events;
  }

  private applyQuietModeDeviceConstraints(reason: string): TwinEvent[] {
    const events: TwinEvent[] = [];
    for (const device of Object.values(this.state.snapshot.devices)) {
      const patch: Record<string, string | number | boolean | null> | null = device.type === 'light'
        ? { power: 'off', brightness: 0 }
        : device.type === 'tv'
          ? { power: 'off', app: null, volume: 0, lifecyclePhase: 'off' }
          : device.type === 'range_hood'
            ? { power: 'off', speed: 0 }
            : null;
      if (!patch) {
        continue;
      }
      const event = this.setDeviceStateIfChanged(device.id, patch, reason);
      if (event) {
        events.push(event);
      }
    }

    const vacuum = this.deviceOfType('robot_vacuum');
    if (vacuum && ['cleaning', 'stuck', 'assisted'].includes(String(vacuum.state.status))) {
      events.push(this.setDeviceState(vacuum.id, {
        status: 'docked',
        cycleMinutes: 0,
        batteryPercent: vacuum.state.batteryPercent ?? 90,
        binFull: false
      }, `${reason}:robot_dock`));
    }

    for (const device of Object.values(this.state.snapshot.devices).filter((candidate) => ['dishwasher', 'washer'].includes(candidate.type))) {
      if (device.state.status !== 'running' || device.lastReason.startsWith('operator:')) {
        continue;
      }
      const event = this.setDeviceStateIfChanged(device.id, { status: 'paused', powerW: 2 }, `${reason}:pause_chore_appliance`);
      if (event) {
        events.push(event);
      }
    }

    return events;
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
      if (action.deviceId === 'washer_01' && action.reason === 'routine:laundry_chore') {
        this.state.triggeredRules.add('washer_cycle');
        if (this.state.snapshot.devices.washer_01.state.status !== 'idle') {
          return [];
        }
      }
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
    const automationPolicy = this.activeAutomationPolicy();
    const humansHome = Object.values(snapshot.people).filter((person) => person.kind === 'human' && person.location !== 'away').length;
    const doorLock = Object.values(snapshot.devices).find((device) => device.type === 'door_lock');
    const doorLocked = doorLock?.state.locked === true;
    if (this.automationRuleEnabled('sleep_mode') && snapshot.homeState.mode === 'sleeping') {
      events.push(...this.applyQuietModeDeviceConstraints('rule:sleep_mode'));
      if (!this.state.triggeredRules.has('sleep_mode')) {
        this.state.triggeredRules.add('sleep_mode');
        events.push(this.createEvent({
          type: 'AutomationTriggered',
          ruleId: 'sleep_mode',
          explanation: 'The household is sleeping, so public lights and noisy shared devices are quieted.',
          actions: ['turn_off_public_lights', 'turn_off_tv', 'turn_off_range_hood', 'dock_robot_vacuum', 'pause_non_operator_chore_appliances'],
          reason: 'home_mode:sleeping'
        }));
      }
    }

    const stove = Object.values(snapshot.devices).find((device) => device.type === 'stove');
    const cookingRoom = stove ? snapshot.rooms[stove.roomId] : undefined;
    const rangeHood = stove
      ? Object.values(snapshot.devices).find((device) => device.type === 'range_hood' && device.roomId === stove.roomId)
      : undefined;
    const cookingLight = stove
      ? Object.values(snapshot.devices).find((device) => device.type === 'light' && device.roomId === stove.roomId)
      : undefined;
    const stovePowerW = Number(stove?.state.powerW ?? 0);
    if (
      stove &&
      this.automationRuleEnabled('cooking_ventilation') &&
      cookingRoom?.occupancy &&
      stovePowerW > automationPolicy.thresholds.cookingVentilationOnPowerW &&
      !this.state.triggeredRules.has('cooking_ventilation')
    ) {
      this.state.triggeredRules.add('cooking_ventilation');
      const hoodEvent = rangeHood ? this.setDeviceStateIfChanged(rangeHood.id, { power: 'on', speed: 2 }, 'rule:cooking_ventilation') : null;
      const lightEvent = cookingLight ? this.setDeviceStateIfChanged(cookingLight.id, { power: 'on', brightness: 80 }, 'rule:cooking_ventilation') : null;
      if (hoodEvent) {
        events.push(hoodEvent);
      }
      if (lightEvent) {
        events.push(lightEvent);
      }
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'cooking_ventilation',
        explanation: 'Kitchen occupancy and stove power indicate cooking.',
        actions: ['turn_on_range_hood', 'turn_on_kitchen_light'],
        reason: 'kitchen_occupied_and_stove_power',
        eventExplanation: {
          why: 'Kitchen occupancy and stove power indicate active cooking.',
          actorIds: peopleInRoom(snapshot, stove.roomId),
          affectedDeviceIds: [rangeHood?.id, cookingLight?.id, stove.id].filter((id): id is string => Boolean(id)),
          affectedRoomIds: [stove.roomId],
          expectedOutcome: 'Ventilate cooking byproducts and keep the work area lit.'
        }
      }));
    }

    if (
      this.automationRuleEnabled('cooking_ventilation') &&
      stovePowerW <= automationPolicy.thresholds.cookingVentilationOffPowerW &&
      rangeHood?.state.power === 'on' &&
      rangeHood.lastReason.startsWith('rule:cooking_ventilation') &&
      !Object.values(snapshot.people).some((person) => (
        person.kind === 'human' &&
        person.location === stove?.roomId &&
        ['cooking_dinner', 'prepare_dinner', 'brunch'].includes(person.activity)
      ))
    ) {
      const hoodEvent = this.setDeviceStateIfChanged(rangeHood.id, { power: 'off', speed: 0 }, 'rule:cooking_ventilation_complete');
      if (hoodEvent) {
        events.push(hoodEvent);
        events.push(this.createEvent({
          type: 'AutomationTriggered',
          ruleId: 'cooking_ventilation_complete',
          explanation: 'The stove is off and cooking activity has left the kitchen, so ventilation stops after clearing residual cooking air.',
          actions: ['turn_off_range_hood_after_cooking'],
          reason: 'stove_power_off_after_cooking',
          eventExplanation: {
            why: 'The stove power is low and no active cook remains in the kitchen.',
            actorIds: [],
            affectedDeviceIds: [rangeHood.id, ...(stove ? [stove.id] : [])],
            affectedRoomIds: stove ? [stove.roomId] : [],
            expectedOutcome: 'Avoid range hood idle runtime after cooking has ended.'
          }
        }));
      }
    }

    if (
      stove &&
      this.automationRuleEnabled('stove_unattended_safety') &&
      stovePowerW > automationPolicy.thresholds.unattendedStovePowerW &&
      !cookingRoom?.occupancy &&
      !this.state.triggeredRules.has('stove_unattended_safety')
    ) {
      this.state.triggeredRules.add('stove_unattended_safety');
      events.push(this.setDeviceState(stove.id, { powerW: 0, level: 0 }, 'rule:stove_unattended_safety'));
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'stove_unattended_safety',
        explanation: 'The stove was drawing high power while the kitchen was empty.',
        actions: ['turn_off_stove', 'raise_warning'],
        reason: 'stove_power_without_kitchen_occupancy',
        eventExplanation: {
          why: 'The stove is drawing high power while no one is in the kitchen.',
          actorIds: [],
          affectedDeviceIds: [stove.id],
          affectedRoomIds: [stove.roomId],
          expectedOutcome: 'Remove unattended cooking risk before it escalates.'
        }
      }));
    }

    if (this.automationRuleEnabled('away_mode') && humansHome === 0 && doorLocked && snapshot.homeState.mode !== 'away' && !this.state.triggeredRules.has('away_mode')) {
      this.state.triggeredRules.add('away_mode');
      snapshot.homeState.mode = 'away';
      snapshot.homeState.securityMode = 'armed';
      events.push(...this.applyQuietModeDeviceConstraints('rule:away_mode'));
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'away_mode',
        explanation: 'All human family members are away and the front door is locked, so non-essential devices are quieted.',
        actions: ['set_home_mode:away', 'arm_security', 'turn_off_public_lights', 'turn_off_tv', 'turn_off_range_hood', 'dock_robot_vacuum'],
        reason: 'occupancy_count:0',
        eventExplanation: {
          why: 'All human family members are away and the entrance is secured.',
          actorIds: Object.values(snapshot.people).filter((person) => person.kind === 'human').map((person) => person.id),
          affectedDeviceIds: [
            doorLock?.id,
            ...Object.values(snapshot.devices)
              .filter((device) => ['light', 'tv', 'range_hood', 'robot_vacuum'].includes(device.type))
              .map((device) => device.id)
          ].filter((id): id is string => Boolean(id)),
          affectedRoomIds: doorLock ? [doorLock.roomId] : [],
          expectedOutcome: 'Reduce unattended energy use and keep security armed.'
        }
      }));
    }

    const leakSensor = Object.values(snapshot.devices).find((device) => device.type === 'water_leak_sensor');
    const waterValve = Object.values(snapshot.devices).find((device) => device.type === 'water_valve');
    if (
      leakSensor?.state.leakDetected === true &&
      this.automationRuleEnabled('close_water_valve_on_leak') &&
      waterValve &&
      waterValve.state.valveOpen !== false &&
      !this.state.triggeredRules.has('close_water_valve_on_leak')
    ) {
      this.state.triggeredRules.add('close_water_valve_on_leak');
      snapshot.homeState.mode = 'alert';
      events.push(this.setDeviceState(waterValve.id, { valveOpen: false }, 'rule:close_water_valve_on_leak'));
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'close_water_valve_on_leak',
        explanation: 'Bathroom leak sensor is active while the home is sleeping.',
        actions: ['close_water_valve', 'raise_high_alert'],
        reason: 'water_leak_sensor:true',
        eventExplanation: {
          why: 'The bathroom leak sensor is active while the household is sleeping.',
          actorIds: [],
          affectedDeviceIds: [leakSensor.id, waterValve.id],
          affectedRoomIds: [leakSensor.roomId],
          expectedOutcome: 'Stop water flow and raise an urgent leak response workflow.'
        }
      }));
    }

    const fridge = Object.values(snapshot.devices).find((device) => device.type === 'fridge');
    if (
      fridge?.state.doorOpen === true &&
      this.automationRuleEnabled('fridge_left_open') &&
      ['opened', 'still_open', 'alert'].includes(String(fridge.state.lifecyclePhase ?? '')) &&
      (
        fridge.lastReason === 'abnormality:fridge_left_open' ||
        Number(fridge.state.openMinutes ?? 0) >= automationPolicy.thresholds.fridgeOpenMinutes
      ) &&
      this.canTriggerRule('fridge_left_open')
    ) {
      this.activateRule('fridge_left_open');
      const policy = alertEscalationPolicies.fridge_left_open;
      events.push(this.createAlertEvent(policy.alertId, policy.initialSeverity, fridge.roomId, 'Fridge door has remained open', policy.recommendedAction, 'rule:fridge_left_open'));
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'fridge_left_open',
        explanation: 'The fridge reported doorOpen=true, so the twin raised a kitchen appliance warning.',
        actions: ['notify_close_fridge_door', 'track_fridge_power'],
        reason: `${fridge.id}.doorOpen:true`,
        eventExplanation: {
          why: 'The fridge door remains open and power draw is elevated.',
          actorIds: peopleInRoom(snapshot, fridge.roomId),
          affectedDeviceIds: [fridge.id],
          affectedRoomIds: [fridge.roomId],
          expectedOutcome: 'Prompt a household member to close the fridge before energy use and temperature drift escalate.'
        }
      }));
    }

    const router = Object.values(snapshot.devices).find((device) => device.type === 'router');
    if (
      router?.state.online === false &&
      this.automationRuleEnabled('network_offline') &&
      router.lastReason === 'abnormality:network_offline' &&
      this.canTriggerRule('network_offline')
    ) {
      this.activateRule('network_offline');
      const policy = alertEscalationPolicies.network_offline;
      events.push(this.createAlertEvent(policy.alertId, policy.initialSeverity, router.roomId, 'Home network is offline', policy.recommendedAction, 'rule:network_offline'));
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'network_offline',
        explanation: 'The router reported offline, so the twin prepared a network recovery recommendation.',
        actions: ['notify_network_offline', 'recommend_router_restart'],
        reason: `${router.id}.online:false`,
        eventExplanation: {
          why: `${router.id} is offline while household routines depend on connectivity.`,
          actorIds: Object.values(snapshot.people)
            .filter((person) => person.kind === 'human' && person.location !== 'away')
            .map((person) => person.id),
          affectedDeviceIds: [router.id],
          affectedRoomIds: [router.roomId],
          relatedIntent: 'focused_remote_work',
          expectedOutcome: 'Route attention to the study and restore network service.'
        }
      }));
    }

    const entranceCamera = doorLock
      ? Object.values(snapshot.devices).find((device) => device.type === 'doorbell_camera' && device.roomId === doorLock.roomId)
      : undefined;
    if (
      doorLock?.state.locked === false &&
      this.automationRuleEnabled('door_left_open') &&
      entranceCamera?.state.motion === true &&
      doorLock.lastReason === 'abnormality:door_left_open' &&
      this.canTriggerRule('door_left_open')
    ) {
      this.activateRule('door_left_open');
      const policy = alertEscalationPolicies.door_left_open;
      events.push(this.createAlertEvent(policy.alertId, policy.initialSeverity, doorLock.roomId, 'Front door has remained open', policy.recommendedAction, 'rule:door_left_open'));
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'door_left_open',
        explanation: 'The front lock is unlocked while entrance camera motion is active.',
        actions: ['notify_front_door', 'focus_entrance_camera'],
        reason: `${doorLock.id}.locked:false`,
        eventExplanation: {
          why: 'The entrance door is unlocked while entrance motion is active.',
          actorIds: [],
          affectedDeviceIds: [doorLock.id, entranceCamera.id],
          affectedRoomIds: [doorLock.roomId],
          expectedOutcome: 'Focus the entrance and prompt someone to secure the door.'
        }
      }));
    }

    const senior = Object.values(snapshot.people).find((person) => this.personaFor(person.id).role === 'senior');
    const seniorSleepSensor = senior?.location === 'away'
      ? undefined
      : Object.values(snapshot.devices).find((device) => device.type === 'sleep_sensor' && device.roomId === senior?.location);
    if (
      senior?.activity === 'no_activity' &&
      this.automationRuleEnabled('senior_no_activity') &&
      seniorSleepSensor?.state.inBed === true &&
      this.canTriggerRule('senior_no_activity')
    ) {
      this.activateRule('senior_no_activity');
      const policy = alertEscalationPolicies.senior_no_activity;
      events.push(this.createAlertEvent(policy.alertId, policy.initialSeverity, senior.location as RoomId, 'Senior has no morning activity yet', policy.recommendedAction, 'rule:senior_no_activity'));
      events.push(this.createEvent({
        type: 'AutomationTriggered',
        ruleId: 'senior_no_activity',
        explanation: 'The senior activity fact remains no_activity while the sleep sensor still reports in bed.',
        actions: ['prepare_check_in', 'notify_caregiver'],
        reason: `${senior.id}.activity:no_activity`,
        eventExplanation: {
          why: `${senior.id} remains in wellness_watch with no morning activity.`,
          actorIds: [senior.id],
          affectedDeviceIds: [seniorSleepSensor.id],
          affectedRoomIds: [senior.location as RoomId],
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
        const worldTemperatureC = this.round(this.clamp((Number(room.temperatureC) || Number(state.temperatureC) || 25) + this.state.random.range(-0.12, 0.18) + (roomOccupied ? 0.03 : -0.02), 17, 31));
        const worldHumidityPercent = this.round(this.clamp((Number(room.humidityPercent) || Number(state.humidityPercent) || 55) + this.state.random.range(-0.25, 0.35) + (roomOccupied ? 0.04 : -0.03), 35, 78));
        room.temperatureC = worldTemperatureC;
        room.humidityPercent = worldHumidityPercent;
        state.temperatureC = worldTemperatureC;
        state.humidityPercent = worldHumidityPercent;
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
        }, withSensorProfileOverrides(getSensorProfile(device.type), { samplingIntervalSec: 1 }), this.environmentSensorReportingPolicy(device.id, {
          temperatureC: 0.5,
          humidityPercent: 3
        }));
        if (!sensorObservation) {
          continue;
        }
        Object.assign(measurements, sensorObservation.event.measurements);
        sensorObservation.event.measurements = { ...measurements };
      } else if (device.type === 'air_quality_sensor') {
        const cooking = this.state.snapshot.activities.breakfast || this.state.snapshot.activities.cooking_dinner;
        const humanOccupancy = this.state.snapshot.rooms[device.roomId].people
          .filter((personId) => this.state.snapshot.people[personId]?.kind === 'human')
          .length;
        const remoteWorkLoad = device.roomId === 'study' && this.state.snapshot.people.adult_2?.location === 'study' && this.state.snapshot.people.adult_2.activity === 'remote_work' ? 145 : 0;
        const worldPm25 = this.round(this.clamp((cooking ? 18 : 8) + this.state.random.range(-1, 1), 2, 60));
        const worldCo2 = this.round(this.clamp((cooking ? 690 : 530) + humanOccupancy * 42 + remoteWorkLoad + this.state.random.range(-8, 8), 420, 1200));
        state.pm25 = worldPm25;
        state.co2 = worldCo2;
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
        }, withSensorProfileOverrides(getSensorProfile(device.type), { samplingIntervalSec: 1 }), this.environmentSensorReportingPolicy(device.id, {
          pm25: 5,
          co2: 75
        }));
        if (!sensorObservation) {
          continue;
        }
        Object.assign(measurements, sensorObservation.event.measurements);
      } else if (device.type === 'fridge' || device.type === 'door_lock') {
        const contactOpen = device.type === 'fridge'
          ? state.doorOpen === true
          : state.locked === false;
        const contactProfile = device.type === 'fridge'
          ? withSensorProfileOverrides(getSensorProfile('contact_sensor'), {
              samplingIntervalSec: 1,
              falsePositiveRate: 0,
              outOfOrderRate: 0
            })
          : withSensorProfileOverrides(getSensorProfile('contact_sensor'), {
              samplingIntervalSec: 1,
              falsePositiveRate: 0,
              duplicateRate: 0.005,
              cooldownSec: 120
            });
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
        }, contactProfile);
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
        }, withSensorProfileOverrides(getSensorProfile(device.type), {
          samplingIntervalSec: 1,
          falsePositiveRate: 0,
          falseNegativeRate: 0
        }), {
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
        }, withSensorProfileOverrides(getSensorProfile(device.type), {
          samplingIntervalSec: 1,
          falsePositiveRate: 0,
          falseNegativeRate: 0,
          cooldownSec: 180
        }), {
          worldKey: 'inBed',
          measurementName: 'in_bed'
        });
        if (!sensorObservation) {
          continue;
        }
        Object.assign(measurements, sensorObservation.event.measurements);
      } else if (device.type === 'router') {
        const previousObservation = this.state.sensorObservations.get(device.id);
        const routerProfile = withSensorProfileOverrides(getSensorProfile(device.type), {
          samplingIntervalSec: 1,
          falsePositiveRate: 0,
          falseNegativeRate: 0
        });
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
        const leakSensor = this.deviceOfType('water_leak_sensor', device.roomId);
        const waterValve = this.deviceOfType('water_valve', device.roomId) ?? this.deviceOfType('water_valve');
        const leakActive = leakSensor?.state.leakDetected === true;
        const valveOpen = waterValve?.state.valveOpen !== false;
        const currentFlow = Number(state.flowLMin) || 0;
        if (!leakActive && currentFlow <= 0) {
          state.flowLMin = 0;
          this.state.sensorObservations.set(device.id, {
            flowLMin: 0,
            lastObservedAt: this.state.snapshot.simClock.currentTime
          });
          continue;
        }
        const nextFlow = leakActive && valveOpen
          ? currentFlow
          : this.clamp(currentFlow + (roomOccupied ? this.state.random.range(-0.15, 0.08) : -0.7), 0, 12);
        const flowLMin = nextFlow < 0.3 ? 0 : this.round(nextFlow);
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
        if (!valveOpen && flowLMin === 0) {
          measurements.flow_l_min = 0;
          sensorObservation.event.measurements = { ...measurements };
          sensorObservation.observedState.flowLMin = 0;
          state.flowLMin = 0;
        } else if (typeof measurements.flow_l_min === 'number') {
          state.flowLMin = measurements.flow_l_min;
        }
      } else if (device.type === 'soil_moisture_sensor') {
        const sprinklerOn = this.deviceOfType('sprinkler', device.roomId)?.state.valveOpen === true;
        const moisturePercent = this.round(this.clamp((Number(state.moisturePercent) || 38) + (sprinklerOn ? 0.55 : -0.03) + this.state.random.range(-0.04, 0.04), 20, 75));
        state.moisturePercent = moisturePercent;
        sensorObservation = observeEnvironmentSensor({
          deviceId: device.id,
          roomId: device.roomId,
          deviceType: device.type,
          worldState: {
            moisturePercent
          },
          previousObservation: this.state.sensorObservations.get(device.id),
          currentTime: this.state.snapshot.simClock.currentTime,
          randomSeed: this.state.random.getState()
        }, withSensorProfileOverrides(getSensorProfile(device.type), { samplingIntervalSec: 1 }), this.environmentSensorReportingPolicy(device.id, {
          moisturePercent: 2
        }));
        if (!sensorObservation) {
          continue;
        }
        Object.assign(measurements, sensorObservation.event.measurements);
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

  private environmentSensorReportingPolicy(
    deviceId: string,
    thresholds: NonNullable<EnvironmentSensorReportingOptions['thresholds']>
  ): EnvironmentSensorReportingOptions {
    return {
      thresholds,
      heartbeatIntervalMinutes: 15,
      heartbeatOffsetMinutes: this.environmentHeartbeatOffsetMinutes(deviceId)
    };
  }

  private environmentHeartbeatOffsetMinutes(deviceId: string): number {
    const source = `${this.state.snapshot.runContext.seed}:${deviceId}`;
    let hash = 0;
    for (const char of source) {
      hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
    }
    return hash % 15;
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
    if (device.type === 'fridge') {
      if (validPatch.doorOpen === false) {
        validPatch = {
          ...validPatch,
          lifecyclePhase: validPatch.lifecyclePhase ?? 'closed',
          openMinutes: 0
        };
      } else if (validPatch.doorOpen === true && device.state.doorOpen !== true) {
        validPatch = {
          ...validPatch,
          lifecyclePhase: validPatch.lifecyclePhase ?? 'opened',
          openMinutes: validPatch.openMinutes ?? 0
        };
      }
    }
    device.state = { ...device.state, ...validPatch };
    device.lastReason = reason;
    return this.createEvent({
      type: 'DeviceStateChanged',
      roomId: device.roomId,
      deviceId,
      deviceType: device.type,
      state: structuredClone(validPatch),
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
    const cooldownMinutes = cooldownMinutesForRule(ruleId);
    const cooldownUntilMinute = this.state.elapsedMinutes + cooldownMinutes;
    this.state.ruleStates.set(ruleId, {
      status: 'cooldown',
      cooldownUntilMinute
    });
    const cooldownUntil = new Date(this.state.snapshot.simClock.currentTime);
    cooldownUntil.setMinutes(cooldownUntil.getMinutes() + cooldownMinutes);
    resolveAlertsForRule(this.state.snapshot, ruleId, this.state.snapshot.simClock.currentTime);
    return this.createEvent({
      type: 'RuleRecovered',
      ruleId,
      recoveredFacts,
      cooldownUntil: this.formatSimTime(cooldownUntil),
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

  private sourceEntityIdsForRule(ruleId: string): string[] {
    const devices = Object.values(this.state.snapshot.devices);
    const idsForTypes = (...types: string[]) => devices
      .filter((device) => types.includes(device.type))
      .map((device) => device.id);
    if (ruleId === 'close_water_valve_on_leak') {
      return idsForTypes('water_leak_sensor', 'water_valve');
    }
    if (ruleId === 'door_left_open') {
      return idsForTypes('door_lock', 'doorbell_camera');
    }
    if (ruleId === 'fridge_left_open') {
      return idsForTypes('fridge');
    }
    if (ruleId === 'network_offline') {
      return idsForTypes('router');
    }
    if (ruleId === 'senior_no_activity' || ruleId === 'senior_wellness_check') {
      const seniors = Object.values(this.state.snapshot.people)
        .filter((person) => this.personaFor(person.id).role === 'senior');
      const sensorIds = seniors.flatMap((senior) => {
        const roomId = senior.location === 'away' ? this.primaryRoomForPerson(senior.id) : senior.location;
        return roomId
          ? idsForTypes('sleep_sensor').filter((id) => this.state.snapshot.devices[id]?.roomId === roomId)
          : [];
      });
      return [...seniors.map((senior) => senior.id), ...sensorIds];
    }
    if (ruleId === 'sleep_mode' || ruleId === 'away_mode') {
      return idsForTypes('door_lock', 'light', 'tv', 'range_hood', 'robot_vacuum', 'dishwasher', 'washer');
    }
    if (ruleId === 'cooking_ventilation') {
      return idsForTypes('stove', 'range_hood', 'light');
    }
    if (ruleId === 'stove_unattended_safety') {
      return idsForTypes('stove');
    }
    return legacySourceEntityIdsForRule(ruleId);
  }

  private createAlertEvent(alertId: string, severity: 'info' | 'warning' | 'high', roomId: RoomId, message: string, recommendedAction: string, reason: string): AlertCreatedEvent {
    const sourceRuleId = sourceRuleIdFromReason(reason);
    const sourceEntityIds = sourceRuleId ? this.sourceEntityIdsForRule(sourceRuleId) : undefined;
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

  private createSeniorCheckInEvents(senior: PersonState, seniorRoom: RoomId, sleepSensor: DeviceState): TwinEvent[] {
    const caregiver = this.selectSeniorCaregiver(senior.id, seniorRoom);
    if (!caregiver) {
      return [];
    }

    const reason = 'operator:senior_check_in:senior_no_activity';
    const path = caregiver.location === 'away' ? [] : this.roomPath(caregiver.location, seniorRoom);
    const events: TwinEvent[] = [];
    if (path.length <= 1) {
      const from = caregiver.location === 'away' ? seniorRoom : caregiver.location;
      caregiver.location = seniorRoom;
      caregiver.activity = `checking_${senior.id}`;
      events.push(this.createPersonMovedEvent(caregiver.id, from, seniorRoom, `checking_${senior.id}`, reason));
    } else {
      for (let index = 1; index < path.length; index += 1) {
        const stepFrom = path[index - 1];
        const stepTo = path[index];
        const isFinalStep = index === path.length - 1;
        const activity = isFinalStep ? `checking_${senior.id}` : `walking_to_${senior.id}`;
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
        actorIds: [caregiver.id, senior.id],
        affectedDeviceIds: [sleepSensor.id],
        affectedRoomIds: [seniorRoom],
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

  private selectSeniorCaregiver(seniorId: string, roomId: RoomId): TwinSnapshot['people'][string] | null {
    const candidates = Object.values(this.state.snapshot.people)
      .filter((person) => person.kind === 'human' && person.id !== seniorId && person.location !== 'away');
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
    const device = this.state.snapshot.devices[deviceId];
    if (device?.type === 'fridge' && command === 'close') {
      return this.recoverRuleIfActiveOrAlert('fridge_left_open', [`${deviceId}.doorOpen:false`]);
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
    const compiledHouseholdMode = Boolean(this.state.snapshot.runContext.householdRun);
    const entityIds = compiledHouseholdMode ? entityIdsForCausality(event) : [];
    const inferredCauseEventIds = compiledHouseholdMode
      ? [...new Set(entityIds
          .map((entityId) => this.state.lastEventByEntity.get(entityId))
          .filter((eventId): eventId is string => Boolean(eventId)))]
      : [];
    const lineage = event.lineage ?? {
      eventTime: simTime,
      ingestTime: simTime,
      sourceLayer,
      causeEventIds: inferredCauseEventIds,
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
    for (const entityId of entityIds) {
      this.state.lastEventByEntity.set(entityId, completedEvent.id);
    }
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
    this.state.snapshot.simClock.currentTime = this.formatSimTime(current);
  }

  private formatSimTime(value: Date): string {
    return formatTimeInZone(
      value,
      this.state.snapshot.runContext.householdRun?.timezone ?? 'Asia/Shanghai'
    );
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

function indoorWeatherTarget(roomId: RoomId, outdoorTemperatureC: number, minuteOfDay: number): number {
  if (roomId === 'garden') {
    return outdoorTemperatureC;
  }
  const solarGain = minuteOfDay >= 11 * 60 && minuteOfDay <= 15 * 60 ? 1.1 : minuteOfDay >= 16 * 60 && minuteOfDay <= 18 * 60 ? 0.45 : 0;
  const envelopeBuffer = outdoorTemperatureC >= 30 ? 4.2 : outdoorTemperatureC <= 12 ? -8.5 : -1.2;
  const roomOffset = roomId === 'kitchen' ? 0.5 : roomId.includes('bedroom') ? -0.4 : 0;
  return outdoorTemperatureC - envelopeBuffer + solarGain + roomOffset;
}

function kitchenApplianceHeat(stove: DeviceState | undefined, fridge: DeviceState | undefined): number {
  const stovePower = Number(stove?.state.powerW ?? 0);
  const cookingHeat = stovePower > 0 ? Math.min(0.22, stovePower / 7000) : 0;
  const fridgeHeat = fridge?.state.doorOpen === true ? 0.035 : 0;
  return cookingHeat + fridgeHeat;
}

function kitchenVentilationCooling(rangeHood: DeviceState | undefined, currentTemperatureC: number, targetTemperatureC: number): number {
  if (rangeHood?.state.power !== 'on' || currentTemperatureC <= targetTemperatureC) {
    return 0;
  }
  const speed = Math.max(1, Number(rangeHood.state.speed ?? 1));
  return Math.min(0.18, 0.04 * speed + (currentTemperatureC - targetTemperatureC) * 0.012);
}

function humidityTargetForWeather(condition: ReturnType<typeof createExternalContext>['weather']['condition'], roomId: RoomId): number {
  const weatherHumidity = condition === 'heavy_rain' ? 72 : condition === 'light_rain' ? 66 : condition === 'hot' ? 58 : condition === 'cold' ? 38 : 52;
  if (roomId === 'bathroom') {
    return Math.max(weatherHumidity, 62);
  }
  if (roomId === 'kitchen') {
    return weatherHumidity + 3;
  }
  return weatherHumidity;
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
      if (event.deviceType === 'temperature_humidity_sensor' && (measurement === 'temperature_c' || measurement === 'humidity_percent')) {
        continue;
      }
      const stateKey = measurementStateKeys[measurement];
      if (stateKey) {
        device.state[stateKey] = value;
      }
    }
  }
  if (room && event.deviceType !== 'temperature_humidity_sensor') {
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
    const observation = telemetryMeasurementsToObservation(event.measurements);
    const reportedAt = Object.fromEntries(Object.keys(observation)
      .map((stateKey) => [`${stateKey}ReportedAt`, event.lineage.eventTime] as const));
    const previous = observations.get(event.deviceId) ?? {};
    observations.set(event.deviceId, {
      ...previous,
      ...observation,
      ...reportedAt,
      lastObservedAt: event.lineage.eventTime
    });
  }
  return observations;
}

function createInitialObjectLocations(): Record<string, RoomId> {
  return Object.fromEntries(getDefaultHouseholdObjects()
    .map((object) => [object.id, object.roomId]));
}

function createRuntimePersonNeeds(snapshot: TwinSnapshot, catalog: Catalog): Map<string, NeedState> {
  const needs = new Map<string, NeedState>();
  for (const person of Object.values(snapshot.people)) {
    if (person.kind !== 'human') {
      continue;
    }
    needs.set(person.id, createInitialNeeds(personaForCatalog(person.id, catalog)));
  }
  return needs;
}

function restorePersonNeeds(snapshot: TwinSnapshot, elapsedMinutes: number, catalog: Catalog): Map<string, NeedState> {
  const needs = createRuntimePersonNeeds(snapshot, catalog);
  for (const person of Object.values(snapshot.people)) {
    if (person.kind !== 'human') {
      continue;
    }
    const persona = personaForCatalog(person.id, catalog);
    const current = needs.get(person.id) ?? createInitialNeeds(persona);
    needs.set(person.id, advanceNeeds(current, persona, {
      minutes: elapsedMinutes,
      activity: person.activity,
      homeMode: snapshot.homeState.mode
    }));
  }
  return needs;
}

function personaForCatalog(personId: string, catalog: Catalog): ReturnType<typeof getPersonaForDefinition> {
  const definition = catalog.people.find((candidate) => candidate.id === personId);
  if (definition) {
    return getPersonaForDefinition(definition, catalog);
  }
  if (defaultFamilyPersonas[personId]) {
    return getPersona(personId);
  }
  throw new Error(`Unknown resident definition: ${personId}`);
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
      return { routinePhase: 'after_school', intent: 'finish_homework', attentionTarget: 'living_room', energy: 62 };
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

function cooldownMinutesForRule(ruleId: string): number {
  return ruleCooldownMinutesByRule[ruleId] ?? defaultRuleCooldownMinutes;
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

function legacySourceEntityIdsForRule(ruleId: string): string[] {
  const sourceEntityIds: Record<string, string[]> = {
    close_water_valve_on_leak: ['water_leak_01', 'water_valve_01'],
    door_left_open: ['door_lock_01', 'doorbell_camera_01'],
    fridge_left_open: ['fridge_01'],
    network_offline: ['router_01'],
    senior_no_activity: ['senior_1', 'master_sleep_01'],
    senior_wellness_check: ['senior_1', 'master_sleep_01'],
    sleep_mode: ['living_light_01', 'kitchen_light_01', 'dining_light_01', 'tv_01', 'range_hood_01', 'robot_vacuum_01', 'dishwasher_01', 'washer_01'],
    cooking_ventilation: ['stove_01', 'range_hood_01', 'kitchen_light_01'],
    stove_unattended_safety: ['stove_01'],
    away_mode: ['door_lock_01', 'living_light_01', 'kitchen_light_01', 'dining_light_01', 'tv_01', 'range_hood_01', 'robot_vacuum_01'],
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

function entityIdsForCausality(event: unknown): string[] {
  if (!event || typeof event !== 'object') {
    return [];
  }
  const candidate = event as {
    deviceId?: unknown;
    personId?: unknown;
    objectId?: unknown;
    participants?: unknown;
    affectedEntities?: unknown;
    sourceEntityIds?: unknown;
    eventExplanation?: {
      actorIds?: unknown;
      affectedDeviceIds?: unknown;
    };
  };
  const values: unknown[] = [
    candidate.deviceId,
    candidate.personId,
    candidate.objectId,
    ...(Array.isArray(candidate.participants) ? candidate.participants : []),
    ...(Array.isArray(candidate.affectedEntities) ? candidate.affectedEntities : []),
    ...(Array.isArray(candidate.sourceEntityIds) ? candidate.sourceEntityIds : []),
    ...(Array.isArray(candidate.eventExplanation?.actorIds) ? candidate.eventExplanation.actorIds : []),
    ...(Array.isArray(candidate.eventExplanation?.affectedDeviceIds) ? candidate.eventExplanation.affectedDeviceIds : [])
  ];
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function restoreLastEventByEntity(events: TwinEvent[], runId: string, sequence: number): Map<string, string> {
  const result = new Map<string, string>();
  for (const event of events
    .filter((candidate) => candidate.runId === runId && candidate.sequence <= sequence)
    .sort((left, right) => left.sequence - right.sequence)) {
    for (const entityId of entityIdsForCausality(event)) {
      result.set(entityId, event.id);
    }
  }
  return result;
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

function minutesBetween(startTime: string, endTime: string): number {
  return Math.max(0, Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000));
}

function formatTimeInZone(value: Date, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset'
  }).formatToParts(value).map((part) => [part.type, part.value]));
  const offset = parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName?.replace(/^GMT/, '');
  if (!offset || !/^[+-]\d{2}:\d{2}$/.test(offset)) {
    throw new Error(`Cannot format simulation time in timezone ${timeZone}`);
  }
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}
