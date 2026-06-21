export type RoomId =
  | 'entrance'
  | 'living_room'
  | 'kitchen'
  | 'dining_room'
  | 'master_bedroom'
  | 'child_bedroom'
  | 'study'
  | 'bathroom'
  | 'garden';

export type HomeMode = 'morning' | 'away' | 'evening_home' | 'sleeping' | 'alert';

export type PersonKind = 'human' | 'pet';

export type Severity = 'info' | 'warning' | 'high';
export type AlertLifecycleStatus = 'active' | 'acknowledged' | 'resolved' | 'ignored';

export interface RoomDefinition {
  id: RoomId;
  name: string;
  type: 'entry' | 'living' | 'utility' | 'bedroom' | 'work' | 'outdoor';
  connectedRooms: RoomId[];
}

export interface PersonDefinition {
  id: string;
  kind: PersonKind;
  role: string;
  homeMember: boolean;
}

export interface DeviceDefinition {
  id: string;
  roomId: RoomId;
  type: string;
  name: string;
  metrics: string[];
}

export interface Catalog {
  rooms: RoomDefinition[];
  people: PersonDefinition[];
  devices: DeviceDefinition[];
}

export interface HomeDefinition {
  building: {
    id: string;
    name: string;
  };
  floors: Array<{
    id: string;
    name: string;
    level: number;
    rooms: RoomDefinition[];
    fixtures: {
      devices: DeviceDefinition[];
    };
  }>;
  topology: {
    connections: Array<{
      from: RoomId;
      to: RoomId;
    }>;
  };
  people: PersonDefinition[];
}

export interface SimClock {
  currentTime: string;
  speed: number;
  paused: boolean;
  sequence: number;
}

export interface RunContext {
  runId: string;
  seed: number;
  rngState: number;
  scenarioVersion: string;
  engineVersion: string;
  startedAt: string;
}

export interface PersonState {
  id: string;
  kind: PersonKind;
  location: RoomId | 'away';
  activity: string;
  behavior: PersonBehaviorContext;
  confidence: number;
  privacyMode: boolean;
}

export interface PersonBehaviorContext {
  routinePhase: string;
  intent: string;
  attentionTarget: string;
  energy: number;
}

export interface RoomState {
  id: RoomId;
  name: string;
  occupancy: boolean;
  humanOccupancy: boolean;
  motionDetected: boolean;
  people: string[];
  temperatureC: number;
  humidityPercent: number;
  lightsOn: boolean;
  activeDevices: string[];
}

export interface DeviceState {
  id: string;
  roomId: RoomId;
  type: string;
  state: Record<string, string | number | boolean | null>;
  lastReason: string;
}

export interface AlertState {
  id: string;
  severity: Severity;
  roomId: RoomId;
  message: string;
  recommendedAction: string;
  status: AlertLifecycleStatus;
  createdAt: string;
  resolvedAt?: string;
  sourceRuleId?: string;
  sourceEntityIds?: string[];
}

export interface HouseholdInventoryState {
  breakfastFoodServings: number;
  simpleFoodServings: number;
  preparedMeals: number;
  dirtyLaundryKg: number;
  dirtyDishes: number;
  trashBags: number;
  medicineDoses: number;
  packageCount: number;
  unfinishedChores: number;
  sleepDebtHours: number;
  deviceMaintenanceScore: number;
  healthRiskScore: number;
  pendingChores: string[];
}

export interface TwinSnapshot {
  homeId: string;
  runId: string;
  runContext: RunContext;
  scenarioId: string;
  simClock: SimClock;
  homeState: {
    occupancyCount: number;
    mode: HomeMode;
    securityMode: 'armed' | 'disarmed';
  };
  rooms: Record<RoomId, RoomState>;
  people: Record<string, PersonState>;
  devices: Record<string, DeviceState>;
  activities: Record<string, {
    activityId: string;
    participants: string[];
    roomId: RoomId;
    startedAt: string;
  }>;
  alerts: Record<string, AlertState>;
  worldState: {
    inventory: HouseholdInventoryState;
  };
}

export type EventSourceLayer = 'truth' | 'world' | 'sensor' | 'inference' | 'control';
export type EventObservability = 'private' | 'admin' | 'ml_observation' | 'public';

export interface EventLineage {
  eventTime: string;
  ingestTime: string;
  sourceLayer: EventSourceLayer;
  causeEventIds: string[];
  episodeId: string;
  parentEpisodeId?: string;
  observability: EventObservability;
  quality: {
    delayedMs?: number;
    dropped?: boolean;
    duplicated?: boolean;
    noisy?: boolean;
    confidence?: number;
  };
  schemaVersion: number;
  behaviorModelVersion: string;
}

export interface BaseTwinEvent {
  id: string;
  runId: string;
  type: string;
  ts: string;
  simTime: string;
  homeId: string;
  scenarioId: string;
  sequence: number;
  rngStateAfter?: number;
  sourceLayer: EventSourceLayer;
  lineage: EventLineage;
  reason?: string;
  eventExplanation?: EventExplanation;
}

export interface EventExplanation {
  why: string;
  actorIds: string[];
  affectedDeviceIds: string[];
  affectedRoomIds: RoomId[];
  relatedIntent?: string;
  expectedOutcome: string;
}

export interface DeviceTelemetryEvent extends BaseTwinEvent {
  type: 'DeviceTelemetry';
  roomId: RoomId;
  deviceId: string;
  deviceType: string;
  measurements: Record<string, number | boolean>;
}

export interface DeviceStateChangedEvent extends BaseTwinEvent {
  type: 'DeviceStateChanged';
  roomId: RoomId;
  deviceId: string;
  deviceType: string;
  state: Record<string, string | number | boolean | null>;
}

export interface PersonMovedEvent extends BaseTwinEvent {
  type: 'PersonMoved';
  personId: string;
  from: RoomId | 'away';
  to: RoomId | 'away';
  activity: string;
  travelMinutes?: number;
}

export interface ActivityStartedEvent extends BaseTwinEvent {
  type: 'ActivityStarted';
  activityId: string;
  participants: string[];
  roomId: RoomId;
}

export interface ActivityEndedEvent extends BaseTwinEvent {
  type: 'ActivityEnded';
  activityId: string;
  participants: string[];
  roomId: RoomId;
}

export interface ConversationOccurredEvent extends BaseTwinEvent {
  type: 'ConversationOccurred';
  conversationId: string;
  speakerId: string;
  listenerIds: string[];
  topic: string;
  intent: string;
  roomId: RoomId;
  summary: string;
}

export interface ExternalInteractionOccurredEvent extends BaseTwinEvent {
  type: 'ExternalInteractionOccurred';
  interactionId: string;
  actorKind: 'courier' | 'visitor' | 'repair';
  purpose: string;
  roomId: RoomId;
  status: 'detected' | 'acknowledged' | 'completed' | 'scheduled';
  relatedDeviceIds: string[];
}

export interface AutomationTriggeredEvent extends BaseTwinEvent {
  type: 'AutomationTriggered';
  ruleId: string;
  explanation: string;
  actions: string[];
}

export interface RuleRecoveredEvent extends BaseTwinEvent {
  type: 'RuleRecovered';
  ruleId: string;
  recoveredFacts: string[];
  cooldownUntil: string;
}

export interface AbnormalityInjectedEvent extends BaseTwinEvent {
  type: 'AbnormalityInjected';
  kind: 'door_left_open' | 'fridge_left_open' | 'network_offline' | 'senior_no_activity';
  affectedEntities: string[];
}

export interface AlertCreatedEvent extends BaseTwinEvent {
  type: 'AlertCreated';
  alertId: string;
  severity: Severity;
  roomId: RoomId;
  message: string;
  recommendedAction: string;
  sourceRuleId?: string;
  sourceEntityIds?: string[];
}

export interface AlertStatusChangedEvent extends BaseTwinEvent {
  type: 'AlertStatusChanged';
  alertId: string;
  previousStatus: AlertLifecycleStatus;
  status: AlertLifecycleStatus;
}

export interface ScenarioControlEvent extends BaseTwinEvent {
  type: 'ScenarioControl';
  command: 'start' | 'pause' | 'resume' | 'speed' | 'inject';
  value: string | number | boolean;
}

export type TwinEvent =
  | DeviceTelemetryEvent
  | DeviceStateChangedEvent
  | PersonMovedEvent
  | ActivityStartedEvent
  | ActivityEndedEvent
  | ConversationOccurredEvent
  | ExternalInteractionOccurredEvent
  | AutomationTriggeredEvent
  | RuleRecoveredEvent
  | AbnormalityInjectedEvent
  | AlertCreatedEvent
  | AlertStatusChangedEvent
  | ScenarioControlEvent;

export type StaticScenarioId = 'weekday_normal' | 'away_day' | 'night_water_leak';
export type ScenarioId = StaticScenarioId | `daily_${string}`;
