import type { RoomId } from '../shared/types';

export type FixtureKind =
  | 'bed'
  | 'bookcase'
  | 'counter'
  | 'desk'
  | 'plant'
  | 'sofa'
  | 'table'
  | 'tub'
  | 'wardrobe';

export type FloorMaterial = 'stone' | 'tile' | 'wood' | 'soft' | 'grass';
export type OpeningKind = 'door' | 'window';
export type WallSide = 'north' | 'south' | 'east' | 'west';
export type DeviceMarkerKind = 'sensor' | 'actuator' | 'appliance' | 'security' | 'mobile';
export type DeviceAnimationHint = 'airflow' | 'curtain' | 'glow' | 'none' | 'pulse' | 'rotate' | 'scan' | 'vibrate';

export interface RoomOpening {
  kind: OpeningKind;
  side: WallSide;
  offset: number;
  width: number;
}

export interface RoomLayout {
  id: RoomId;
  label: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  floorColor: string;
  floorMaterial: FloorMaterial;
  wallHeight: number;
  wallThickness: number;
  openings: RoomOpening[];
}

export interface FixtureLayout {
  id: string;
  roomId: RoomId;
  kind: FixtureKind;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation?: number;
  height?: number;
}

export interface DevicePoint {
  deviceId: string;
  roomId: RoomId;
  x: number;
  z: number;
  y?: number;
  markerKind: DeviceMarkerKind;
  orientation: number;
  animationHint: DeviceAnimationHint;
}

export const roomLayouts: RoomLayout[] = [
  room('entrance', 'Entry', -5.3, -3.2, 1.8, 2.2, '#d8cbbb', 'stone', [
    { kind: 'door', side: 'west', offset: 0, width: 0.62 },
    { kind: 'door', side: 'east', offset: -0.15, width: 0.64 }
  ]),
  room('living_room', 'Living Room', -1.9, -3.2, 5, 2.2, '#e5d6c4', 'wood', [
    { kind: 'door', side: 'west', offset: -0.1, width: 0.72 },
    { kind: 'window', side: 'south', offset: 1.45, width: 1.12 },
    { kind: 'door', side: 'north', offset: -1.65, width: 0.72 }
  ]),
  room('kitchen', 'Kitchen', 2.9, -3.2, 3, 2.2, '#dbe4dc', 'tile', [
    { kind: 'door', side: 'west', offset: 0, width: 0.68 },
    { kind: 'window', side: 'south', offset: 0.75, width: 0.86 }
  ]),
  room('dining_room', 'Dining', -4.4, -0.9, 3.6, 2.2, '#eadbc5', 'wood', [
    { kind: 'door', side: 'north', offset: 0.85, width: 0.74 },
    { kind: 'door', side: 'east', offset: -0.2, width: 0.68 }
  ]),
  room('master_bedroom', 'Master', -0.4, -0.9, 3.6, 2.2, '#e6d8d0', 'soft', [
    { kind: 'door', side: 'north', offset: -1.05, width: 0.72 },
    { kind: 'window', side: 'south', offset: 0.8, width: 0.95 }
  ]),
  room('child_bedroom', 'Child Room', 2.9, -0.9, 1.6, 2.2, '#d9e2cf', 'soft', [
    { kind: 'door', side: 'north', offset: -0.2, width: 0.58 },
    { kind: 'window', side: 'south', offset: 0.2, width: 0.58 }
  ]),
  room('study', 'Study', 4.6, -0.9, 1.6, 2.2, '#d7ddd1', 'wood', [
    { kind: 'door', side: 'north', offset: -0.15, width: 0.58 },
    { kind: 'window', side: 'east', offset: 0.15, width: 0.72 }
  ]),
  room('bathroom', 'Bath', -5.3, 1.55, 1.8, 2.3, '#d6e5e8', 'tile', [
    { kind: 'door', side: 'north', offset: 0.2, width: 0.58 },
    { kind: 'window', side: 'west', offset: 0.5, width: 0.5 }
  ]),
  room('garden', 'Garden', 0.35, 2.4, 8.8, 3.95, '#cfe1c5', 'grass', [
    { kind: 'door', side: 'south', offset: -3.7, width: 0.9 },
    { kind: 'door', side: 'north', offset: -2.8, width: 0.9 }
  ], 0.24, 0.07)
];

export const fixtureLayouts: FixtureLayout[] = [
  { id: 'entry-bench', roomId: 'entrance', kind: 'table', x: -4.85, z: -2.45, width: 0.8, depth: 0.25 },
  { id: 'living-sofa', roomId: 'living_room', kind: 'sofa', x: -2.6, z: -2.65, width: 1.6, depth: 0.55 },
  { id: 'living-table', roomId: 'living_room', kind: 'table', x: -1.2, z: -2.55, width: 0.8, depth: 0.35 },
  { id: 'kitchen-counter', roomId: 'kitchen', kind: 'counter', x: 2.9, z: -3.85, width: 2.5, depth: 0.35 },
  { id: 'kitchen-table', roomId: 'kitchen', kind: 'table', x: 2.2, z: -2.7, width: 0.6, depth: 0.6 },
  { id: 'dining-table', roomId: 'dining_room', kind: 'table', x: -4.4, z: -0.8, width: 1.25, depth: 0.8 },
  { id: 'master-bed', roomId: 'master_bedroom', kind: 'bed', x: -1.05, z: -0.45, width: 1.35, depth: 0.9 },
  { id: 'master-wardrobe', roomId: 'master_bedroom', kind: 'wardrobe', x: 0.85, z: -1.35, width: 0.35, depth: 0.9 },
  { id: 'child-bed', roomId: 'child_bedroom', kind: 'bed', x: 2.55, z: -0.55, width: 0.75, depth: 0.9 },
  { id: 'child-desk', roomId: 'child_bedroom', kind: 'desk', x: 3.25, z: -1.35, width: 0.65, depth: 0.35 },
  { id: 'study-desk', roomId: 'study', kind: 'desk', x: 4.45, z: -0.45, width: 0.75, depth: 0.4 },
  { id: 'study-bookcase', roomId: 'study', kind: 'bookcase', x: 5.15, z: -1.45, width: 0.3, depth: 0.85 },
  { id: 'bath-tub', roomId: 'bathroom', kind: 'tub', x: -5.35, z: 1.95, width: 1, depth: 0.55 },
  { id: 'garden-patio', roomId: 'garden', kind: 'table', x: -2.8, z: 3.55, width: 1.6, depth: 0.9 },
  { id: 'garden-plant-a', roomId: 'garden', kind: 'plant', x: 3.45, z: 1.65, width: 0.55, depth: 0.55 },
  { id: 'garden-plant-b', roomId: 'garden', kind: 'plant', x: 2.65, z: 3.15, width: 0.55, depth: 0.55 }
];

export const devicePoints: DevicePoint[] = [
  device('door_lock_01', 'entrance', -6, -3.1, 'security', Math.PI / 2, 'pulse'),
  device('entrance_motion_01', 'entrance', -5, -3.85, 'sensor', 0, 'pulse', 0.45),
  device('doorbell_camera_01', 'entrance', -5.95, -2.45, 'security', Math.PI / 2, 'scan', 0.5),
  device('package_sensor_01', 'entrance', -4.75, -2.6, 'sensor', 0, 'pulse'),
  device('living_light_01', 'living_room', -2, -3.25, 'actuator', 0, 'glow', 0.5),
  device('tv_01', 'living_room', 0.25, -3.9, 'appliance', Math.PI, 'glow'),
  device('living_motion_01', 'living_room', -3.65, -2.5, 'sensor', 0, 'pulse', 0.45),
  device('robot_vacuum_01', 'living_room', -0.25, -2.55, 'mobile', 0, 'rotate'),
  device('living_curtain_01', 'living_room', 0.35, -3.2, 'actuator', Math.PI, 'curtain', 0.55),
  device('kitchen_light_01', 'kitchen', 3, -3.3, 'actuator', 0, 'glow', 0.5),
  device('kitchen_temp_01', 'kitchen', 1.65, -3.95, 'sensor', 0, 'pulse', 0.45),
  device('fridge_01', 'kitchen', 4.05, -2.65, 'appliance', -Math.PI / 2, 'pulse'),
  device('stove_01', 'kitchen', 2.3, -3.8, 'appliance', Math.PI, 'glow'),
  device('range_hood_01', 'kitchen', 2.3, -3.95, 'actuator', Math.PI, 'airflow', 0.65),
  device('pm25_01', 'kitchen', 3.8, -3.9, 'sensor', 0, 'pulse', 0.45),
  device('smoke_01', 'kitchen', 3.15, -2.35, 'sensor', 0, 'pulse', 0.55),
  device('dishwasher_01', 'kitchen', 3.65, -3.8, 'appliance', Math.PI, 'vibrate'),
  device('dining_light_01', 'dining_room', -4.4, -0.95, 'actuator', 0, 'glow', 0.5),
  device('master_sleep_01', 'master_bedroom', -1.05, -0.45, 'sensor', 0, 'pulse'),
  device('master_ac_01', 'master_bedroom', 0.9, -0.45, 'actuator', -Math.PI / 2, 'airflow', 0.5),
  device('child_sleep_01', 'child_bedroom', 2.55, -0.55, 'sensor', 0, 'pulse'),
  device('study_co2_01', 'study', 5.1, -1.25, 'sensor', 0, 'pulse', 0.45),
  device('router_01', 'study', 4.25, -1.25, 'appliance', 0, 'pulse'),
  device('bathroom_water_01', 'bathroom', -5.8, 2.2, 'sensor', 0, 'pulse'),
  device('water_leak_01', 'bathroom', -5.25, 2.25, 'sensor', 0, 'pulse'),
  device('water_valve_01', 'bathroom', -4.65, 2.25, 'actuator', Math.PI / 2, 'rotate'),
  device('washer_01', 'bathroom', -4.75, 1.1, 'appliance', 0, 'vibrate'),
  device('garden_soil_01', 'garden', 2.1, 3.25, 'sensor', 0, 'pulse'),
  device('garden_camera_01', 'garden', -3.6, 1.1, 'security', -Math.PI / 2, 'scan', 0.5),
  device('sprinkler_01', 'garden', 1.5, 2.6, 'actuator', 0, 'airflow')
];

export function getRoomLayout(roomId: RoomId): RoomLayout {
  const layout = roomLayouts.find((room) => room.id === roomId);
  if (!layout) {
    throw new Error(`Missing 3D layout for room ${roomId}`);
  }
  return layout;
}

function room(
  id: RoomId,
  label: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  floorColor: string,
  floorMaterial: FloorMaterial,
  openings: RoomOpening[],
  wallHeight = 0.42,
  wallThickness = 0.1
): RoomLayout {
  return { id, label, x, z, width, depth, floorColor, floorMaterial, wallHeight, wallThickness, openings };
}

function device(
  deviceId: string,
  roomId: RoomId,
  x: number,
  z: number,
  markerKind: DeviceMarkerKind,
  orientation: number,
  animationHint: DeviceAnimationHint,
  y?: number
): DevicePoint {
  return { deviceId, roomId, x, z, y, markerKind, orientation, animationHint };
}
