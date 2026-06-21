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
  materialKind: 'wood' | 'tile' | 'carpet' | 'stone' | 'grass';
  wallHeight: number;
  wallThickness: number;
}

export interface FixtureLayout {
  id: string;
  roomId: RoomId;
  kind: FixtureKind;
  x: number;
  z: number;
  width: number;
  depth: number;
  height?: number;
  materialKind?: 'fabric' | 'wood' | 'ceramic' | 'leaf' | 'metal';
  rotation?: number;
}

export interface WallSegment {
  id: string;
  kind: 'exterior' | 'interior';
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
}

export interface RoomConnectionOpening {
  id: string;
  from: RoomId;
  to: RoomId;
  kind: 'doorway' | 'open-plan' | 'wide-opening';
  x: number;
  z: number;
  width: number;
  depth: number;
}

export const roomLayouts: RoomLayout[] = [
  { id: 'entrance', label: 'Entry', x: -5.3, z: -3.2, width: 1.8, depth: 2.2, floorColor: '#d8cbbb', materialKind: 'stone', wallHeight: 0.42, wallThickness: 0.1 },
  { id: 'living_room', label: 'Living Room', x: -1.9, z: -3.2, width: 5, depth: 2.2, floorColor: '#e5d6c4', materialKind: 'wood', wallHeight: 0.42, wallThickness: 0.1 },
  { id: 'kitchen', label: 'Kitchen', x: 2.9, z: -3.2, width: 3, depth: 2.2, floorColor: '#dbe4dc', materialKind: 'tile', wallHeight: 0.42, wallThickness: 0.1 },
  { id: 'dining_room', label: 'Dining', x: -4.4, z: -0.9, width: 3.6, depth: 2.2, floorColor: '#eadbc5', materialKind: 'wood', wallHeight: 0.42, wallThickness: 0.1 },
  { id: 'master_bedroom', label: 'Master', x: -0.4, z: -0.9, width: 3.6, depth: 2.2, floorColor: '#e6d8d0', materialKind: 'carpet', wallHeight: 0.42, wallThickness: 0.1 },
  { id: 'child_bedroom', label: 'Child Room', x: 2.9, z: -0.9, width: 1.6, depth: 2.2, floorColor: '#d9e2cf', materialKind: 'carpet', wallHeight: 0.42, wallThickness: 0.1 },
  { id: 'study', label: 'Study', x: 4.6, z: -0.9, width: 1.6, depth: 2.2, floorColor: '#d7ddd1', materialKind: 'wood', wallHeight: 0.42, wallThickness: 0.1 },
  { id: 'bathroom', label: 'Bath', x: -5.3, z: 1.55, width: 1.8, depth: 2.3, floorColor: '#d6e5e8', materialKind: 'tile', wallHeight: 0.42, wallThickness: 0.1 },
  { id: 'garden', label: 'Garden', x: 0.35, z: 2.4, width: 8.8, depth: 3.95, floorColor: '#cfe1c5', materialKind: 'grass', wallHeight: 0.28, wallThickness: 0.08 }
];

export const wallSegments: WallSegment[] = [
  { id: 'front-wall-west', kind: 'exterior', x: -4.1, z: -4.36, width: 4.2, depth: 0.14, height: 0.5 },
  { id: 'front-wall-east', kind: 'exterior', x: 2.9, z: -4.36, width: 5.1, depth: 0.14, height: 0.5 },
  { id: 'left-wall', kind: 'exterior', x: -6.25, z: -0.8, width: 0.14, depth: 7.15, height: 0.5 },
  { id: 'right-wall-house', kind: 'exterior', x: 5.48, z: -2.05, width: 0.14, depth: 4.6, height: 0.5 },
  { id: 'garden-back-wall', kind: 'exterior', x: 0.35, z: 4.43, width: 8.95, depth: 0.1, height: 0.28 },
  { id: 'garden-right-wall', kind: 'exterior', x: 4.82, z: 2.4, width: 0.1, depth: 4.05, height: 0.28 },
  { id: 'entry-living-wall', kind: 'interior', x: -4.38, z: -3.72, width: 0.1, depth: 1.15, height: 0.42 },
  { id: 'living-kitchen-short-wall', kind: 'interior', x: 0.68, z: -4.02, width: 0.1, depth: 0.62, height: 0.42 },
  { id: 'living-bedroom-west-wall', kind: 'interior', x: -4.95, z: -2.04, width: 2.55, depth: 0.1, height: 0.42 },
  { id: 'living-bedroom-east-wall', kind: 'interior', x: -0.15, z: -2.04, width: 3.2, depth: 0.1, height: 0.42 },
  { id: 'kitchen-private-wall', kind: 'interior', x: 3.45, z: -2.04, width: 1.85, depth: 0.1, height: 0.42 },
  { id: 'bath-dining-wall', kind: 'interior', x: -4.38, z: 0.25, width: 0.1, depth: 1.25, height: 0.42 },
  { id: 'dining-master-wall', kind: 'interior', x: -2.42, z: -0.9, width: 0.1, depth: 1.28, height: 0.42 },
  { id: 'master-child-wall', kind: 'interior', x: 1.55, z: -0.9, width: 0.1, depth: 1.28, height: 0.42 },
  { id: 'child-study-wall', kind: 'interior', x: 3.78, z: -0.9, width: 0.1, depth: 1.28, height: 0.42 },
  { id: 'house-garden-left-wall', kind: 'interior', x: -3.25, z: 0.42, width: 1.7, depth: 0.1, height: 0.34 },
  { id: 'house-garden-right-wall', kind: 'interior', x: 2.75, z: 0.42, width: 3.25, depth: 0.1, height: 0.34 }
];

export const roomConnectionOpenings: RoomConnectionOpening[] = [
  { id: 'entry-living-door', from: 'entrance', to: 'living_room', kind: 'doorway', x: -4.38, z: -2.95, width: 0.12, depth: 0.66 },
  { id: 'living-kitchen-open-plan', from: 'living_room', to: 'kitchen', kind: 'open-plan', x: 0.95, z: -3.08, width: 0.9, depth: 1.05 },
  { id: 'living-dining-open-plan', from: 'living_room', to: 'dining_room', kind: 'open-plan', x: -3.25, z: -2.03, width: 1.25, depth: 0.12 },
  { id: 'living-master-door', from: 'living_room', to: 'master_bedroom', kind: 'doorway', x: -1.25, z: -2.03, width: 0.78, depth: 0.12 },
  { id: 'kitchen-study-door', from: 'kitchen', to: 'study', kind: 'doorway', x: 4.28, z: -2.03, width: 0.72, depth: 0.12 },
  { id: 'dining-bath-door', from: 'dining_room', to: 'bathroom', kind: 'doorway', x: -4.38, z: 0.86, width: 0.12, depth: 0.74 },
  { id: 'master-child-door', from: 'master_bedroom', to: 'child_bedroom', kind: 'doorway', x: 1.55, z: -0.35, width: 0.12, depth: 0.68 },
  { id: 'child-study-door', from: 'child_bedroom', to: 'study', kind: 'doorway', x: 3.78, z: -0.35, width: 0.12, depth: 0.68 },
  { id: 'living-garden-wide-opening', from: 'living_room', to: 'garden', kind: 'wide-opening', x: -0.4, z: 0.42, width: 4.35, depth: 0.14 }
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

export function getRoomLayout(roomId: RoomId): RoomLayout {
  const layout = roomLayouts.find((room) => room.id === roomId);
  if (!layout) {
    throw new Error(`Missing 3D layout for room ${roomId}`);
  }
  return layout;
}
