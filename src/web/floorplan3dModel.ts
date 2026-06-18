import type { RoomId, Severity, TwinEvent, TwinSnapshot } from '../shared/types';
import { devicePoints, getRoomLayout, roomLayouts, type DeviceAnimationHint, type DeviceMarkerKind, type RoomLayout } from './floorplanLayout';

export type FloorplanAlertSeverity = 'info' | 'warning' | 'critical';

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
}

export interface Floorplan3DDevice {
  id: string;
  roomId: RoomId;
  label: string;
  active: boolean;
  abnormal: boolean;
  markerKind: DeviceMarkerKind;
  orientation: number;
  animationHint: DeviceAnimationHint;
  statusLabel: string;
  x: number;
  z: number;
  y: number;
}

export interface Floorplan3DModel {
  rooms: Floorplan3DRoom[];
  people: Floorplan3DPerson[];
  devices: Floorplan3DDevice[];
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
        z: anchor.z
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
      markerKind: point?.markerKind ?? inferMarkerKind(device.type),
      orientation: point?.orientation ?? 0,
      animationHint: point?.animationHint ?? inferAnimationHint(device.type),
      statusLabel: summarizeDeviceState(device.type, device.state),
      x: point?.x ?? getRoomLayout(device.roomId).x,
      z: point?.z ?? getRoomLayout(device.roomId).z,
      y: point?.y ?? 0.32
    };
  });

  return { rooms, people, devices };
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
    living_light_01: 'Light',
    tv_01: 'TV',
    living_motion_01: 'Motion',
    kitchen_light_01: 'Light',
    kitchen_temp_01: 'Temp',
    fridge_01: 'Fridge',
    stove_01: 'Stove',
    range_hood_01: 'Hood',
    pm25_01: 'Air',
    dining_light_01: 'Light',
    master_sleep_01: 'Sleep',
    child_sleep_01: 'Sleep',
    study_co2_01: 'CO2',
    bathroom_water_01: 'Water',
    water_leak_01: 'Leak',
    water_valve_01: 'Valve',
    garden_soil_01: 'Soil',
    sprinkler_01: 'Sprinkler'
  };
  return labels[deviceId] ?? deviceId;
}

function isDeviceActive(type: string, state: Record<string, string | number | boolean | null>): boolean {
  if (type === 'door_lock') return state.locked === false;
  if (type === 'light') return state.power === 'on';
  if (type === 'tv') return state.power === 'on';
  if (type === 'fridge') return state.doorOpen === true || Number(state.powerW ?? 0) > 100;
  if (type === 'stove') return Number(state.powerW ?? 0) > 0;
  if (type === 'range_hood') return state.power === 'on' || Number(state.speed ?? 0) > 0;
  if (type === 'doorbell_camera') return state.motion === true || state.ringing === true;
  if (type === 'package_sensor') return state.packagePresent === true;
  if (type === 'robot_vacuum') return state.status === 'cleaning' || state.status === 'stuck';
  if (type === 'curtain') return Number(state.positionPercent ?? 0) > 0;
  if (type === 'smoke_sensor') return state.smokeDetected === true || Number(state.density ?? 0) > 0;
  if (type === 'dishwasher') return state.status === 'running' || state.status === 'done' || Number(state.powerW ?? 0) > 0;
  if (type === 'air_conditioner') return state.power === 'on';
  if (type === 'router') return state.online !== true || Number(state.latencyMs ?? 0) > 100;
  if (type === 'washer') return state.status === 'running' || state.status === 'done' || Number(state.powerW ?? 0) > 0;
  if (type === 'security_camera') return state.motion === true || state.recording === true;
  if (type === 'water_flow_sensor') return Number(state.flowLMin ?? 0) > 0;
  if (type === 'water_leak_sensor') return state.leakDetected === true;
  if (type === 'water_valve') return state.valveOpen === true;
  if (type === 'sprinkler') return state.valveOpen === true;
  if (type === 'sleep_sensor') return state.inBed === true;
  if (type === 'motion_sensor') return state.motion === true;
  return false;
}

function isDeviceAbnormal(type: string, state: Record<string, string | number | boolean | null>): boolean {
  if (type === 'door_lock') return state.locked === false;
  if (type === 'stove') return Number(state.powerW ?? 0) > 700;
  if (type === 'fridge') return state.doorOpen === true;
  if (type === 'water_flow_sensor') return Number(state.flowLMin ?? 0) > 6;
  if (type === 'water_leak_sensor') return state.leakDetected === true;
  if (type === 'router') return state.online !== true;
  if (type === 'robot_vacuum') return state.status === 'stuck';
  if (type === 'smoke_sensor') return state.smokeDetected === true;
  return false;
}

function inferMarkerKind(type: string): DeviceMarkerKind {
  if (type.includes('sensor')) return 'sensor';
  if (type.includes('camera') || type.includes('lock')) return 'security';
  if (type === 'robot_vacuum') return 'mobile';
  if (['light', 'curtain', 'water_valve', 'sprinkler', 'air_conditioner', 'range_hood'].includes(type)) return 'actuator';
  return 'appliance';
}

function inferAnimationHint(type: string): DeviceAnimationHint {
  if (type === 'light' || type === 'tv' || type === 'stove') return 'glow';
  if (type === 'curtain') return 'curtain';
  if (type === 'water_valve' || type === 'robot_vacuum') return 'rotate';
  if (type === 'washer' || type === 'dishwasher') return 'vibrate';
  if (type.includes('camera')) return 'scan';
  if (type === 'air_conditioner' || type === 'range_hood' || type === 'sprinkler') return 'airflow';
  if (type.includes('sensor')) return 'pulse';
  return 'none';
}

function summarizeDeviceState(type: string, state: Record<string, string | number | boolean | null>): string {
  if (type === 'light') return state.power === 'on' ? `on ${Number(state.brightness ?? 0)}%` : 'off';
  if (type === 'curtain') return `${Number(state.positionPercent ?? 0)}% open`;
  if (type === 'water_valve' || type === 'sprinkler') return state.valveOpen === true ? 'open' : 'closed';
  if (type === 'robot_vacuum') return String(state.status ?? 'idle');
  if (type === 'washer' || type === 'dishwasher') return String(state.status ?? 'idle');
  if (type === 'router') return state.online === true ? 'online' : 'offline';
  if (type === 'fridge') return state.doorOpen === true ? 'door open' : 'closed';
  if (type === 'door_lock') return state.locked === false ? 'unlocked' : 'locked';
  if (type.includes('sensor')) return isDeviceActive(type, state) ? 'triggered' : 'idle';
  return isDeviceActive(type, state) ? 'active' : 'idle';
}
