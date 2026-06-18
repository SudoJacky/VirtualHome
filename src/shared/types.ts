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

export interface SimClock {
  currentTime: string;
  speed: number;
  paused: boolean;
  sequence: number;
}

export interface PersonState {
  id: string;
  kind: PersonKind;
  location: RoomId | 'away';
  activity: string;
  confidence: number;
  privacyMode: boolean;
}

export interface RoomState {
  id: RoomId;
  name: string;
  occupancy: boolean;
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
  createdAt: string;
}

export interface TwinSnapshot {
  homeId: string;
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
}

export interface BaseTwinEvent {
  id: string;
  type: string;
  ts: string;
  simTime: string;
  homeId: string;
  scenarioId: string;
  sequence: number;
  reason?: string;
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

export interface AutomationTriggeredEvent extends BaseTwinEvent {
  type: 'AutomationTriggered';
  ruleId: string;
  explanation: string;
  actions: string[];
}

export interface AlertCreatedEvent extends BaseTwinEvent {
  type: 'AlertCreated';
  alertId: string;
  severity: Severity;
  roomId: RoomId;
  message: string;
  recommendedAction: string;
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
  | AutomationTriggeredEvent
  | AlertCreatedEvent
  | ScenarioControlEvent;

export type StaticScenarioId = 'weekday_normal' | 'away_day' | 'night_water_leak';
export type ScenarioId = StaticScenarioId | `daily_${string}`;
