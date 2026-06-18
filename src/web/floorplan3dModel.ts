import type { RoomId, Severity, TwinEvent, TwinSnapshot } from '../shared/types';
import { devicePoints, getRoomLayout, roomLayouts, type RoomLayout } from './floorplanLayout';

export type FloorplanAlertSeverity = 'info' | 'warning' | 'critical';
export type DeviceMarkerKind = 'sensor' | 'actuator' | 'appliance' | 'security' | 'lighting' | 'climate' | 'media' | 'mobile' | 'network';
export type DeviceAnimationHint = 'pulse' | 'glow' | 'slide' | 'rotate' | 'patrol' | 'vibrate' | 'airflow' | 'scan' | 'none';

export interface FloorplanPoint {
  x: number;
  z: number;
}

export interface Floorplan3DRoom extends RoomLayout {
  occupied: boolean;
  lit: boolean;
  temperatureC: number;
  humidityPercent: number;
  alertSeverity?: FloorplanAlertSeverity;
}

export interface Floorplan3DPerson {
  id: string;
  roomId: RoomId;
  label: string;
  activity: string;
  recent: boolean;
  x: number;
  z: number;
  movementPath: FloorplanPoint[];
}

export interface Floorplan3DDevice {
  id: string;
  roomId: RoomId;
  label: string;
  active: boolean;
  abnormal: boolean;
  markerKind: DeviceMarkerKind;
  animationHint: DeviceAnimationHint;
  statusLabel: string;
  x: number;
  z: number;
  y: number;
}

export interface FloorplanAutomationLink {
  id: string;
  ruleId: string;
  label: string;
  roomId: RoomId;
  sourceDeviceId?: string;
  targetDeviceId?: string;
  severity: FloorplanAlertSeverity;
}

export interface Floorplan3DModel {
  rooms: Floorplan3DRoom[];
  people: Floorplan3DPerson[];
  devices: Floorplan3DDevice[];
  automationLinks: FloorplanAutomationLink[];
}

export function createFloorplan3DModel(snapshot: TwinSnapshot, events: TwinEvent[]): Floorplan3DModel {
  const alertSeverityByRoom = new Map<RoomId, FloorplanAlertSeverity>();
  for (const alert of Object.values(snapshot.alerts)) {
    alertSeverityByRoom.set(alert.roomId, strongestSeverity(alertSeverityByRoom.get(alert.roomId), mapSeverity(alert.severity)));
  }

  const recentlyMovedPeople = new Set(events
    .filter((event) => event.type === 'PersonMoved')
    .slice(-8)
    .map((event) => event.personId));
  const latestMoveByPerson = new Map(events
    .filter((event) => event.type === 'PersonMoved')
    .map((event) => [event.personId, event]));

  const rooms = roomLayouts.map((layout) => {
    const room = snapshot.rooms[layout.id];
    return {
      ...layout,
      occupied: room.occupancy,
      lit: room.lightsOn,
      temperatureC: room.temperatureC,
      humidityPercent: room.humidityPercent,
      alertSeverity: alertSeverityByRoom.get(layout.id)
    };
  });

  const people = Object.values(snapshot.people)
    .filter((person) => person.location !== 'away')
    .map((person, index) => {
      const roomId = person.location as RoomId;
      const anchor = offsetWithinRoom(roomId, index, 0.26);
      return {
        id: person.id,
        roomId,
        label: getPersonLabel(person.id),
        activity: person.activity,
        recent: recentlyMovedPeople.has(person.id),
        x: anchor.x,
        z: anchor.z,
        movementPath: createMovementPath(person.id, roomId, anchor, index, latestMoveByPerson.get(person.id))
      };
    });

  const devices = Object.values(snapshot.devices).map((device) => {
    const point = devicePoints.find((candidate) => candidate.deviceId === device.id);
    const active = isDeviceActive(device.type, device.state);
    return {
      id: device.id,
      roomId: device.roomId,
      label: getDeviceLabel(device.id),
      active,
      abnormal: active && isDeviceAbnormal(device.type, device.state),
      markerKind: getMarkerKind(device.type),
      animationHint: getAnimationHint(device.type, device.state, active),
      statusLabel: getDeviceStatusLabel(device.type, device.state),
      x: point?.x ?? getRoomLayout(device.roomId).x,
      z: point?.z ?? getRoomLayout(device.roomId).z,
      y: point?.y ?? 0.32
    };
  });

  return {
    rooms,
    people,
    devices,
    automationLinks: createAutomationLinks(snapshot, events, alertSeverityByRoom)
  };
}

function createMovementPath(
  personId: string,
  roomId: RoomId,
  anchor: FloorplanPoint,
  index: number,
  latestMove: Extract<TwinEvent, { type: 'PersonMoved' }> | undefined
): FloorplanPoint[] {
  if (!latestMove || latestMove.to !== roomId) {
    return [anchor];
  }

  const previous = latestMove.from === 'away'
    ? roomEntryPoint(roomId)
    : offsetWithinRoom(latestMove.from, index, 0.2);

  return [
    previous,
    midpoint(previous, anchor),
    anchor
  ];
}

function roomEntryPoint(roomId: RoomId): FloorplanPoint {
  const layout = getRoomLayout(roomId);
  return {
    x: layout.x - layout.width / 2 + 0.18,
    z: layout.z
  };
}

function midpoint(from: FloorplanPoint, to: FloorplanPoint): FloorplanPoint {
  return {
    x: (from.x + to.x) / 2,
    z: (from.z + to.z) / 2
  };
}

function createAutomationLinks(
  snapshot: TwinSnapshot,
  events: TwinEvent[],
  alertSeverityByRoom: Map<RoomId, FloorplanAlertSeverity>
): FloorplanAutomationLink[] {
  return events
    .filter((event): event is Extract<TwinEvent, { type: 'AutomationTriggered' }> => event.type === 'AutomationTriggered')
    .slice(-6)
    .reverse()
    .map((event) => {
      const link = automationLinkForRule(event.ruleId);
      const roomId = link?.roomId ?? inferAutomationRoom(snapshot, events, event.sequence);
      return {
        id: event.id,
        ruleId: event.ruleId,
        label: event.explanation,
        roomId,
        sourceDeviceId: link?.sourceDeviceId,
        targetDeviceId: link?.targetDeviceId,
        severity: strongestSeverity(alertSeverityByRoom.get(roomId), link?.severity ?? 'info')
      };
    });
}

function automationLinkForRule(ruleId: string): Pick<FloorplanAutomationLink, 'roomId' | 'sourceDeviceId' | 'targetDeviceId' | 'severity'> | undefined {
  const links: Record<string, Pick<FloorplanAutomationLink, 'roomId' | 'sourceDeviceId' | 'targetDeviceId' | 'severity'>> = {
    close_water_valve_on_leak: {
      roomId: 'bathroom',
      sourceDeviceId: 'water_leak_01',
      targetDeviceId: 'water_valve_01',
      severity: 'critical'
    },
    cooking_ventilation: {
      roomId: 'kitchen',
      sourceDeviceId: 'pm25_01',
      targetDeviceId: 'range_hood_01',
      severity: 'warning'
    },
    fridge_left_open: {
      roomId: 'kitchen',
      sourceDeviceId: 'fridge_01',
      targetDeviceId: 'fridge_01',
      severity: 'warning'
    },
    sprinkler_on: {
      roomId: 'garden',
      sourceDeviceId: 'garden_soil_01',
      targetDeviceId: 'sprinkler_01',
      severity: 'info'
    },
    network_jitter: {
      roomId: 'study',
      sourceDeviceId: 'router_01',
      targetDeviceId: 'router_01',
      severity: 'warning'
    }
  };
  return links[ruleId];
}

function inferAutomationRoom(snapshot: TwinSnapshot, events: TwinEvent[], sequence: number): RoomId {
  const nearbyDeviceEvent = events
    .filter((event): event is Extract<TwinEvent, { type: 'DeviceStateChanged' }> => event.type === 'DeviceStateChanged')
    .find((event) => Math.abs(event.sequence - sequence) <= 2);
  return nearbyDeviceEvent?.roomId ?? Object.values(snapshot.rooms).find((room) => room.occupancy)?.id ?? 'living_room';
}

function offsetWithinRoom(roomId: RoomId, index: number, spacing: number): { x: number; z: number } {
  const layout = getRoomLayout(roomId);
  const column = index % 3;
  const row = Math.floor(index / 3);
  return {
    x: layout.x - spacing + column * spacing,
    z: layout.z + spacing + row * spacing
  };
}

function strongestSeverity(
  current: FloorplanAlertSeverity | undefined,
  next: FloorplanAlertSeverity
): FloorplanAlertSeverity {
  const rank: Record<FloorplanAlertSeverity, number> = { info: 0, warning: 1, critical: 2 };
  return current && rank[current] > rank[next] ? current : next;
}

function mapSeverity(severity: Severity): FloorplanAlertSeverity {
  if (severity === 'high') return 'critical';
  return severity;
}

function getPersonLabel(personId: string): string {
  const labels: Record<string, string> = {
    adult_1: 'A1',
    adult_2: 'A2',
    child_1: 'C',
    senior_1: 'S',
    pet_1: 'P'
  };
  return labels[personId] ?? personId.slice(0, 2).toUpperCase();
}

function getDeviceLabel(deviceId: string): string {
  const labels: Record<string, string> = {
    door_lock_01: 'Lock',
    entrance_motion_01: 'Motion',
    doorbell_camera_01: 'Doorbell',
    package_sensor_01: 'Package',
    living_light_01: 'Light',
    tv_01: 'TV',
    living_motion_01: 'Motion',
    robot_vacuum_01: 'Vacuum',
    living_curtain_01: 'Curtain',
    kitchen_light_01: 'Light',
    kitchen_temp_01: 'Temp',
    fridge_01: 'Fridge',
    stove_01: 'Stove',
    range_hood_01: 'Hood',
    pm25_01: 'Air',
    smoke_01: 'Smoke',
    dishwasher_01: 'Dish',
    dining_light_01: 'Light',
    master_sleep_01: 'Sleep',
    master_ac_01: 'AC',
    child_sleep_01: 'Sleep',
    study_co2_01: 'CO2',
    router_01: 'Router',
    bathroom_water_01: 'Water',
    water_leak_01: 'Leak',
    water_valve_01: 'Valve',
    washer_01: 'Washer',
    garden_soil_01: 'Soil',
    garden_camera_01: 'Camera',
    sprinkler_01: 'Sprinkler'
  };
  return labels[deviceId] ?? deviceId;
}

function getMarkerKind(type: string): DeviceMarkerKind {
  if (type === 'light') return 'lighting';
  if (type === 'door_lock' || type === 'water_valve' || type === 'range_hood' || type === 'sprinkler' || type === 'curtain') return 'actuator';
  if (type.includes('sensor')) return 'sensor';
  if (type === 'doorbell_camera' || type === 'security_camera') return 'security';
  if (type === 'robot_vacuum') return 'mobile';
  if (type === 'router') return 'network';
  if (type === 'air_conditioner') return 'climate';
  if (type === 'tv') return 'media';
  return 'appliance';
}

function getAnimationHint(type: string, state: Record<string, string | number | boolean | null>, active: boolean): DeviceAnimationHint {
  if (type === 'light') return active ? 'glow' : 'none';
  if (type === 'curtain') return 'slide';
  if (type === 'water_valve') return 'rotate';
  if (type === 'robot_vacuum') return state.status === 'cleaning' ? 'patrol' : active ? 'pulse' : 'none';
  if (type === 'washer' || type === 'dishwasher') return state.status === 'running' ? 'vibrate' : 'none';
  if (type === 'air_conditioner' || type === 'range_hood') return active ? 'airflow' : 'none';
  if (type === 'doorbell_camera' || type === 'security_camera') return active ? 'scan' : 'scan';
  if (type.includes('sensor')) return active ? 'pulse' : 'pulse';
  return active ? 'pulse' : 'none';
}

function getDeviceStatusLabel(type: string, state: Record<string, string | number | boolean | null>): string {
  if (type === 'light') return state.power === 'on' ? `on ${state.brightness ?? 100}%` : 'off';
  if (type === 'door_lock') return state.locked === false ? 'unlocked' : 'locked';
  if (type === 'fridge') return state.doorOpen === true ? 'door open' : 'normal';
  if (type === 'stove') return Number(state.powerW ?? 0) > 0 ? `${state.powerW}W` : 'off';
  if (type === 'range_hood') return Number(state.speed ?? 0) > 0 ? `speed ${state.speed}` : 'off';
  if (type === 'water_valve') return state.valveOpen === false ? 'closed' : 'open';
  if (type === 'sprinkler') return state.valveOpen === true ? 'watering' : 'off';
  if (type === 'robot_vacuum' || type === 'washer' || type === 'dishwasher') return String(state.status ?? 'idle');
  if (type === 'router') return state.online === false ? 'offline' : `${state.latencyMs ?? 0}ms`;
  if (type === 'package_sensor') return state.packagePresent === true ? `${state.weightKg ?? 0}kg package` : 'clear';
  if (type === 'doorbell_camera' || type === 'security_camera') return state.motion === true ? 'motion' : 'watching';
  if (type.includes('sensor')) return Object.entries(state).map(([key, value]) => `${key}=${value}`).slice(0, 1).join(', ') || 'ready';
  return Object.values(state).some(Boolean) ? 'active' : 'idle';
}

function isDeviceActive(type: string, state: Record<string, string | number | boolean | null>): boolean {
  if (type === 'door_lock') return state.locked === false;
  if (type === 'light') return state.power === 'on';
  if (type === 'tv') return state.power === 'on';
  if (type === 'fridge') return state.doorOpen === true || Number(state.powerW ?? 0) > 100;
  if (type === 'stove') return Number(state.powerW ?? 0) > 0;
  if (type === 'range_hood') return state.power === 'on' || Number(state.speed ?? 0) > 0;
  if (type === 'water_flow_sensor') return Number(state.flowLMin ?? 0) > 0;
  if (type === 'water_leak_sensor') return state.leakDetected === true;
  if (type === 'water_valve') return state.valveOpen === true;
  if (type === 'sprinkler') return state.valveOpen === true;
  if (type === 'sleep_sensor') return state.inBed === true;
  if (type === 'motion_sensor') return state.motion === true;
  if (type === 'package_sensor') return state.packagePresent === true;
  if (type === 'doorbell_camera' || type === 'security_camera') return state.motion === true || state.ringing === true || state.recording === true;
  if (type === 'robot_vacuum') return state.status === 'cleaning' || state.status === 'stuck';
  if (type === 'curtain') return Number(state.positionPercent ?? 0) > 0;
  if (type === 'smoke_sensor') return state.smokeDetected === true;
  if (type === 'dishwasher' || type === 'washer') return state.status === 'running' || state.status === 'done' || Number(state.powerW ?? 0) > 0;
  if (type === 'air_conditioner') return state.power === 'on';
  if (type === 'router') return state.online === false || Number(state.latencyMs ?? 0) > 100;
  return false;
}

function isDeviceAbnormal(type: string, state: Record<string, string | number | boolean | null>): boolean {
  if (type === 'door_lock') return state.locked === false;
  if (type === 'stove') return Number(state.powerW ?? 0) > 700;
  if (type === 'fridge') return state.doorOpen === true;
  if (type === 'water_flow_sensor') return Number(state.flowLMin ?? 0) > 6;
  if (type === 'water_leak_sensor') return state.leakDetected === true;
  if (type === 'robot_vacuum') return state.status === 'stuck';
  if (type === 'smoke_sensor') return state.smokeDetected === true;
  if (type === 'router') return state.online === false || Number(state.latencyMs ?? 0) > 120;
  return false;
}
