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

export interface RoomLayout {
  id: RoomId;
  label: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  floorColor: string;
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
}

export interface DevicePoint {
  deviceId: string;
  roomId: RoomId;
  x: number;
  z: number;
  y?: number;
}

export const roomLayouts: RoomLayout[] = [
  { id: 'entrance', label: 'Entry', x: -5.3, z: -3.2, width: 1.8, depth: 2.2, floorColor: '#d8cbbb' },
  { id: 'living_room', label: 'Living Room', x: -1.9, z: -3.2, width: 5, depth: 2.2, floorColor: '#e5d6c4' },
  { id: 'kitchen', label: 'Kitchen', x: 2.9, z: -3.2, width: 3, depth: 2.2, floorColor: '#dbe4dc' },
  { id: 'dining_room', label: 'Dining', x: -4.4, z: -0.9, width: 3.6, depth: 2.2, floorColor: '#eadbc5' },
  { id: 'master_bedroom', label: 'Master', x: -0.4, z: -0.9, width: 3.6, depth: 2.2, floorColor: '#e6d8d0' },
  { id: 'child_bedroom', label: 'Child Room', x: 2.9, z: -0.9, width: 1.6, depth: 2.2, floorColor: '#d9e2cf' },
  { id: 'study', label: 'Study', x: 4.6, z: -0.9, width: 1.6, depth: 2.2, floorColor: '#d7ddd1' },
  { id: 'bathroom', label: 'Bath', x: -5.3, z: 1.55, width: 1.8, depth: 2.3, floorColor: '#d6e5e8' },
  { id: 'garden', label: 'Garden', x: 0.35, z: 2.4, width: 8.8, depth: 3.95, floorColor: '#cfe1c5' }
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
  { deviceId: 'door_lock_01', roomId: 'entrance', x: -6, z: -3.1 },
  { deviceId: 'entrance_motion_01', roomId: 'entrance', x: -5, z: -3.85, y: 0.45 },
  { deviceId: 'doorbell_camera_01', roomId: 'entrance', x: -5.95, z: -2.45, y: 0.5 },
  { deviceId: 'package_sensor_01', roomId: 'entrance', x: -4.75, z: -2.6 },
  { deviceId: 'living_light_01', roomId: 'living_room', x: -2, z: -3.25, y: 0.5 },
  { deviceId: 'tv_01', roomId: 'living_room', x: 0.25, z: -3.9 },
  { deviceId: 'living_motion_01', roomId: 'living_room', x: -3.65, z: -2.5, y: 0.45 },
  { deviceId: 'robot_vacuum_01', roomId: 'living_room', x: -0.25, z: -2.55 },
  { deviceId: 'living_curtain_01', roomId: 'living_room', x: 0.35, z: -3.2, y: 0.55 },
  { deviceId: 'kitchen_light_01', roomId: 'kitchen', x: 3, z: -3.3, y: 0.5 },
  { deviceId: 'kitchen_temp_01', roomId: 'kitchen', x: 1.65, z: -3.95, y: 0.45 },
  { deviceId: 'fridge_01', roomId: 'kitchen', x: 4.05, z: -2.65 },
  { deviceId: 'stove_01', roomId: 'kitchen', x: 2.3, z: -3.8 },
  { deviceId: 'range_hood_01', roomId: 'kitchen', x: 2.3, z: -3.95, y: 0.65 },
  { deviceId: 'pm25_01', roomId: 'kitchen', x: 3.8, z: -3.9, y: 0.45 },
  { deviceId: 'smoke_01', roomId: 'kitchen', x: 3.15, z: -2.35, y: 0.55 },
  { deviceId: 'dishwasher_01', roomId: 'kitchen', x: 3.65, z: -3.8 },
  { deviceId: 'dining_light_01', roomId: 'dining_room', x: -4.4, z: -0.95, y: 0.5 },
  { deviceId: 'master_sleep_01', roomId: 'master_bedroom', x: -1.05, z: -0.45 },
  { deviceId: 'master_ac_01', roomId: 'master_bedroom', x: 0.9, z: -0.45, y: 0.5 },
  { deviceId: 'child_sleep_01', roomId: 'child_bedroom', x: 2.55, z: -0.55 },
  { deviceId: 'study_co2_01', roomId: 'study', x: 5.1, z: -1.25, y: 0.45 },
  { deviceId: 'router_01', roomId: 'study', x: 4.25, z: -1.25 },
  { deviceId: 'bathroom_water_01', roomId: 'bathroom', x: -5.8, z: 2.2 },
  { deviceId: 'water_leak_01', roomId: 'bathroom', x: -5.25, z: 2.25 },
  { deviceId: 'water_valve_01', roomId: 'bathroom', x: -4.65, z: 2.25 },
  { deviceId: 'washer_01', roomId: 'bathroom', x: -4.75, z: 1.1 },
  { deviceId: 'garden_soil_01', roomId: 'garden', x: 2.1, z: 3.25 },
  { deviceId: 'garden_camera_01', roomId: 'garden', x: -3.6, z: 1.1, y: 0.5 },
  { deviceId: 'sprinkler_01', roomId: 'garden', x: 1.5, z: 2.6 }
];

export function getRoomLayout(roomId: RoomId): RoomLayout {
  const layout = roomLayouts.find((room) => room.id === roomId);
  if (!layout) {
    throw new Error(`Missing 3D layout for room ${roomId}`);
  }
  return layout;
}
