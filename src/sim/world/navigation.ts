import type { RoomId } from '../../shared/types';

export type NavigableRoomId = RoomId | 'away';
export type NavigatorKind = 'human' | 'senior' | 'pet';

export interface RoomRoute {
  rooms: RoomId[];
  cost: number;
}

const roomGraph: Record<RoomId, RoomId[]> = {
  entrance: ['living_room'],
  living_room: ['entrance', 'kitchen', 'dining_room', 'master_bedroom', 'child_bedroom', 'study'],
  kitchen: ['living_room', 'dining_room', 'bathroom'],
  dining_room: ['living_room', 'kitchen', 'garden'],
  master_bedroom: ['living_room', 'bathroom'],
  child_bedroom: ['living_room'],
  bathroom: ['master_bedroom', 'kitchen'],
  study: ['living_room'],
  garden: ['dining_room']
};

export function findRoute(from: NavigableRoomId, to: NavigableRoomId, kind: NavigatorKind = 'human'): RoomRoute {
  if (from === 'away' || to === 'away') {
    throw new Error(`Cannot route between ${from} and ${to}`);
  }
  if (from === to) {
    return { rooms: [from], cost: movementCost(from, to, kind) };
  }
  const queue: RoomId[][] = [[from]];
  const visited = new Set<RoomId>([from]);
  while (queue.length > 0) {
    const path = queue.shift() ?? [];
    const room = path.at(-1);
    if (!room) continue;
    for (const next of roomGraph[room]) {
      if (visited.has(next)) continue;
      const candidate = [...path, next];
      if (next === to) {
        return { rooms: candidate, cost: movementCost(from, to, kind) };
      }
      visited.add(next);
      queue.push(candidate);
    }
  }
  throw new Error(`Cannot route between ${from} and ${to}`);
}

export function nextRoomToward(from: RoomId, to: RoomId): RoomId {
  return findRoute(from, to).rooms[1] ?? from;
}

export function movementCost(from: NavigableRoomId, to: NavigableRoomId, kind: NavigatorKind = 'human'): number {
  if (from === 'away' || to === 'away') {
    return 999;
  }
  const baseSteps = from === to ? 0 : Math.max(0, routeLength(from, to) - 1);
  const multiplier = kind === 'senior' ? 1.45 : kind === 'pet' ? 0.8 : 1;
  return Math.round(baseSteps * multiplier * 10) / 10;
}

function routeLength(from: RoomId, to: RoomId): number {
  if (from === to) return 1;
  const queue: RoomId[][] = [[from]];
  const visited = new Set<RoomId>([from]);
  while (queue.length > 0) {
    const path = queue.shift() ?? [];
    const room = path.at(-1);
    if (!room) continue;
    for (const next of roomGraph[room]) {
      if (visited.has(next)) continue;
      const candidate = [...path, next];
      if (next === to) return candidate.length;
      visited.add(next);
      queue.push(candidate);
    }
  }
  return 999;
}
