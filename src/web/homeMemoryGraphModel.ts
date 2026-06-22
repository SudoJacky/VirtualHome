import type { DeviceMemory, FieldMemory, HomeMemory, RoomMemory } from './homeMemoryModel';
import type { ProfileHypothesis } from './homeProfiler';

export type HomeMemoryGraphNodeKind = 'home' | 'room' | 'device' | 'field' | 'hypothesis';
export type HomeMemoryGraphEdgeKind = 'contains' | 'observes' | 'supports' | 'co-occurs';

export interface HomeMemoryGraphNode {
  id: string;
  kind: HomeMemoryGraphNodeKind;
  label: string;
  summary: string;
  activity: number;
  confidence?: number;
  x: number;
  y: number;
  z: number;
  relatedIds: string[];
}

export interface HomeMemoryGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: HomeMemoryGraphEdgeKind;
  strength: number;
}

export interface HomeMemoryGraphModel {
  nodes: HomeMemoryGraphNode[];
  edges: HomeMemoryGraphEdge[];
}

interface PositionedNodeInput {
  id: string;
  kind: HomeMemoryGraphNodeKind;
  label: string;
  summary: string;
  activity: number;
  confidence?: number;
  relatedIds: string[];
}

const RING_RADIUS_BY_KIND: Record<HomeMemoryGraphNodeKind, number> = {
  home: 0,
  room: 5,
  device: 9,
  field: 13,
  hypothesis: 17
};

const RING_Z_BY_KIND: Record<HomeMemoryGraphNodeKind, number> = {
  home: 0,
  room: 0,
  device: 1.5,
  field: -1.5,
  hypothesis: 3
};

export function createHomeMemoryGraphModel(memory: HomeMemory, hypotheses: ProfileHypothesis[]): HomeMemoryGraphModel {
  const homeId = `home:${memory.homeId ?? 'unknown'}`;
  const rooms = sortedValues(memory.rooms, (room) => room.roomId);
  const devices = sortedValues(memory.devices, (device) => device.deviceId);
  const fields = sortedValues(memory.fields, (field) => field.id);
  const sortedHypotheses = [...hypotheses].sort((left, right) => left.id.localeCompare(right.id));
  const nodeInputs: PositionedNodeInput[] = [
    {
      id: homeId,
      kind: 'home',
      label: memory.homeId ? titleCase(memory.homeId) : 'Unknown Home',
      summary: `${memory.totalEvents} total observed event${plural(memory.totalEvents)}.`,
      activity: memory.totalEvents,
      relatedIds: rooms.map((room) => `room:${room.roomId}`)
    },
    ...rooms.map((room) => roomNodeInput(room)),
    ...devices.map((device) => deviceNodeInput(device)),
    ...fields.map((field) => fieldNodeInput(field)),
    ...sortedHypotheses.map((hypothesis) => hypothesisNodeInput(hypothesis))
  ];
  const positionedNodes = assignPositions(nodeInputs);
  const nodeIds = new Set(positionedNodes.map((node) => node.id));
  const nodes = positionedNodes.map((node) => ({
    ...node,
    relatedIds: node.relatedIds.filter((relatedId) => nodeIds.has(relatedId))
  }));
  const edges = [
    ...rooms.map((room) => edge('contains', homeId, `room:${room.roomId}`, room.eventCount)),
    ...devices
      .filter((device) => nodeIds.has(`room:${device.roomId}`))
      .map((device) => edge('contains', `room:${device.roomId}`, `device:${device.deviceId}`, device.eventCount)),
    ...fields
      .filter((field) => nodeIds.has(`device:${field.deviceId}`))
      .map((field) => edge('observes', `device:${field.deviceId}`, `field:${field.deviceId}:${field.field}`, field.eventCount)),
    ...sortedHypotheses.flatMap((hypothesis) => {
      const hypothesisNodeId = `hypothesis:${hypothesis.id}`;

      return sortedUnique(hypothesis.subjectIds)
        .filter((subjectId) => nodeIds.has(subjectId))
        .map((subjectId) => edge('supports', hypothesisNodeId, subjectId, hypothesis.confidence));
    })
  ];

  return {
    nodes,
    edges
  };
}

function roomNodeInput(room: RoomMemory): PositionedNodeInput {
  return {
    id: `room:${room.roomId}`,
    kind: 'room',
    label: titleCase(room.roomId),
    summary: `${room.eventCount} event${plural(room.eventCount)} across ${room.devices.length} device${plural(room.devices.length)}.`,
    activity: room.eventCount,
    relatedIds: sortedUnique([
      ...room.devices.map((deviceId) => `device:${deviceId}`),
      ...room.activeFields.map((fieldId) => `field:${fieldId}`)
    ])
  };
}

function deviceNodeInput(device: DeviceMemory): PositionedNodeInput {
  return {
    id: `device:${device.deviceId}`,
    kind: 'device',
    label: titleCase(device.deviceId),
    summary: `${titleCase(device.type)} in ${titleCase(device.roomId)} with ${device.fields.length} observed field${plural(device.fields.length)}.`,
    activity: device.eventCount,
    relatedIds: sortedUnique([
      `room:${device.roomId}`,
      ...device.fields.map((fieldId) => `field:${fieldId}`)
    ])
  };
}

function fieldNodeInput(field: FieldMemory): PositionedNodeInput {
  return {
    id: `field:${field.deviceId}:${field.field}`,
    kind: 'field',
    label: titleCase(field.field),
    summary: `${titleCase(field.deviceType)} ${titleCase(field.field)} is ${formatValue(field.currentValue)} after ${field.eventCount} event${plural(field.eventCount)}.`,
    activity: field.eventCount,
    relatedIds: [`device:${field.deviceId}`, `room:${field.roomId}`]
  };
}

function hypothesisNodeInput(hypothesis: ProfileHypothesis): PositionedNodeInput {
  return {
    id: `hypothesis:${hypothesis.id}`,
    kind: 'hypothesis',
    label: hypothesis.label,
    summary: hypothesis.summary,
    activity: hypothesis.confidence,
    confidence: hypothesis.confidence,
    relatedIds: sortedUnique(hypothesis.subjectIds)
  };
}

function edge(kind: HomeMemoryGraphEdgeKind, from: string, to: string, strength: number): HomeMemoryGraphEdge {
  return {
    id: `${kind}:${from}:${to}`,
    from,
    to,
    kind,
    strength
  };
}

function assignPositions(inputs: PositionedNodeInput[]): HomeMemoryGraphNode[] {
  const groups = new Map<HomeMemoryGraphNodeKind, PositionedNodeInput[]>();

  for (const input of inputs) {
    groups.set(input.kind, [...(groups.get(input.kind) ?? []), input]);
  }

  return inputs.map((input) => {
    const group = groups.get(input.kind) ?? [];
    const index = group.findIndex((candidate) => candidate.id === input.id);
    const angle = group.length === 0 ? 0 : (Math.PI * 2 * index) / group.length;
    const radius = RING_RADIUS_BY_KIND[input.kind];

    return {
      ...input,
      x: roundCoordinate(Math.cos(angle) * radius),
      y: roundCoordinate(Math.sin(angle) * radius),
      z: RING_Z_BY_KIND[input.kind]
    };
  });
}

function sortedValues<T>(record: Record<string, T>, getId: (value: T) => string): T[] {
  return Object.values(record).sort((left, right) => getId(left).localeCompare(getId(right)));
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function titleCase(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_:\s-]+/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? part : `${part[0].toUpperCase()}${part.slice(1)}`))
    .join(' ');
}

function formatValue(value: FieldMemory['currentValue']): string {
  if (typeof value === 'string') {
    return value;
  }
  return String(value);
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(3));
}

function plural(count: number): string {
  return count === 1 ? '' : 's';
}
