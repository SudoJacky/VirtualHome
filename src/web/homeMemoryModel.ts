import type { DeviceEventValue, DeviceValueEvent } from './deviceEventSocket';

export type TimeBucket = 'morning' | 'daytime' | 'evening' | 'night';

type TimeBucketCounts = Record<TimeBucket, number>;

export interface MemoryEvidence {
  id: string;
  sourceEventId: string;
  sourceEventType: DeviceValueEvent['sourceEventType'];
  runId: string;
  sequence: number;
  ts: string;
  simTime: string;
  homeId: string;
  roomId: string;
  deviceId: string;
  deviceType: string;
  field: string;
  value: DeviceEventValue;
  timeBucket: TimeBucket;
}

export interface FieldMemory {
  id: string;
  homeId: string;
  runId: string;
  roomId: string;
  deviceId: string;
  deviceType: string;
  field: string;
  currentValue: DeviceEventValue;
  previousValue?: DeviceEventValue;
  eventCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  recentEvents: MemoryEvidence[];
  numericMin?: number;
  numericMax?: number;
  trueCount?: number;
  falseCount?: number;
}

export interface DeviceMemory {
  deviceId: string;
  roomId: string;
  type: string;
  latestValues: Record<string, DeviceEventValue>;
  fields: string[];
  eventCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  timeBuckets: TimeBucketCounts;
  recentEvents: MemoryEvidence[];
}

export interface RoomMemory {
  roomId: string;
  devices: string[];
  activeFields: string[];
  eventCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  timeBuckets: TimeBucketCounts;
  recentEvents: MemoryEvidence[];
}

export interface HomeMemory {
  homeId: string | null;
  runId: string | null;
  totalEvents: number;
  rooms: Record<string, RoomMemory>;
  devices: Record<string, DeviceMemory>;
  fields: Record<string, FieldMemory>;
  recentEvents: MemoryEvidence[];
}

const ROOT_RECENT_LIMIT = 50;
const FIELD_RECENT_LIMIT = 20;

export function createHomeMemory(): HomeMemory {
  return {
    homeId: null,
    runId: null,
    totalEvents: 0,
    rooms: {},
    devices: {},
    fields: {},
    recentEvents: []
  };
}

export function getTimeBucket(simTime: string): TimeBucket {
  const writtenHour = /^\d{4}-\d{2}-\d{2}T(\d{2}):/.exec(simTime)?.[1];
  const parsedHour = writtenHour ? Number(writtenHour) : Number.NaN;

  if (Number.isNaN(parsedHour) || parsedHour < 0 || parsedHour > 23) {
    return 'night';
  }
  if (parsedHour >= 5 && parsedHour <= 10) {
    return 'morning';
  }
  if (parsedHour >= 11 && parsedHour <= 16) {
    return 'daytime';
  }
  if (parsedHour >= 17 && parsedHour <= 21) {
    return 'evening';
  }
  return 'night';
}

export function reduceDeviceEvents(memory: HomeMemory, events: DeviceValueEvent[]): HomeMemory {
  return events.reduce(reduceDeviceEvent, memory);
}

export function reduceDeviceEvent(memory: HomeMemory, event: DeviceValueEvent): HomeMemory {
  const baseMemory = memory.runId !== null && memory.runId !== event.runId ? createHomeMemory() : memory;
  const timeBucket = getTimeBucket(event.simTime);
  const evidence = toEvidence(event, timeBucket);
  const fieldId = getFieldId(event.deviceId, event.field);
  const fieldMemory = updateFieldMemory(baseMemory.fields[fieldId], event, evidence, fieldId);
  const deviceMemory = updateDeviceMemory(baseMemory.devices[event.deviceId], event, evidence, fieldId, timeBucket);
  const roomMemory = updateRoomMemory(baseMemory.rooms[event.roomId], event, evidence, fieldId, timeBucket);

  return {
    ...baseMemory,
    homeId: event.homeId,
    runId: event.runId,
    totalEvents: baseMemory.totalEvents + 1,
    rooms: {
      ...baseMemory.rooms,
      [event.roomId]: roomMemory
    },
    devices: {
      ...baseMemory.devices,
      [event.deviceId]: deviceMemory
    },
    fields: {
      ...baseMemory.fields,
      [fieldId]: fieldMemory
    },
    recentEvents: appendBounded(baseMemory.recentEvents, evidence, ROOT_RECENT_LIMIT)
  };
}

function updateRoomMemory(
  current: RoomMemory | undefined,
  event: DeviceValueEvent,
  evidence: MemoryEvidence,
  fieldId: string,
  timeBucket: TimeBucket
): RoomMemory {
  if (!current) {
    return {
      roomId: event.roomId,
      devices: [event.deviceId],
      activeFields: [fieldId],
      eventCount: 1,
      firstSeenAt: event.ts,
      lastSeenAt: event.ts,
      timeBuckets: incrementBucket(emptyBuckets(), timeBucket),
      recentEvents: [evidence]
    };
  }

  return {
    ...current,
    devices: unique([...current.devices, event.deviceId]),
    activeFields: unique([...current.activeFields, fieldId]),
    eventCount: current.eventCount + 1,
    lastSeenAt: event.ts,
    timeBuckets: incrementBucket(current.timeBuckets, timeBucket),
    recentEvents: appendBounded(current.recentEvents, evidence, ROOT_RECENT_LIMIT)
  };
}

function updateDeviceMemory(
  current: DeviceMemory | undefined,
  event: DeviceValueEvent,
  evidence: MemoryEvidence,
  fieldId: string,
  timeBucket: TimeBucket
): DeviceMemory {
  if (!current) {
    return {
      deviceId: event.deviceId,
      roomId: event.roomId,
      type: event.deviceType,
      latestValues: { [event.field]: event.value },
      fields: [fieldId],
      eventCount: 1,
      firstSeenAt: event.ts,
      lastSeenAt: event.ts,
      timeBuckets: incrementBucket(emptyBuckets(), timeBucket),
      recentEvents: [evidence]
    };
  }

  return {
    ...current,
    roomId: event.roomId,
    type: event.deviceType,
    latestValues: {
      ...current.latestValues,
      [event.field]: event.value
    },
    fields: unique([...current.fields, fieldId]),
    eventCount: current.eventCount + 1,
    lastSeenAt: event.ts,
    timeBuckets: incrementBucket(current.timeBuckets, timeBucket),
    recentEvents: appendBounded(current.recentEvents, evidence, ROOT_RECENT_LIMIT)
  };
}

function updateFieldMemory(
  current: FieldMemory | undefined,
  event: DeviceValueEvent,
  evidence: MemoryEvidence,
  fieldId: string
): FieldMemory {
  const numericStats = getNumericStats(current, event.value);
  const booleanStats = getBooleanStats(current, event.value);

  if (!current) {
    return {
      id: fieldId,
      homeId: event.homeId,
      runId: event.runId,
      roomId: event.roomId,
      deviceId: event.deviceId,
      deviceType: event.deviceType,
      field: event.field,
      currentValue: event.value,
      eventCount: 1,
      firstSeenAt: event.ts,
      lastSeenAt: event.ts,
      recentEvents: [evidence],
      ...numericStats,
      ...booleanStats
    };
  }

  return {
    ...current,
    homeId: event.homeId,
    runId: event.runId,
    roomId: event.roomId,
    deviceType: event.deviceType,
    currentValue: event.value,
    previousValue: current.currentValue,
    eventCount: current.eventCount + 1,
    lastSeenAt: event.ts,
    recentEvents: appendBounded(current.recentEvents, evidence, FIELD_RECENT_LIMIT),
    ...numericStats,
    ...booleanStats
  };
}

function toEvidence(event: DeviceValueEvent, timeBucket: TimeBucket): MemoryEvidence {
  return {
    id: event.id,
    sourceEventId: event.sourceEventId,
    sourceEventType: event.sourceEventType,
    runId: event.runId,
    sequence: event.sequence,
    ts: event.ts,
    simTime: event.simTime,
    homeId: event.homeId,
    roomId: event.roomId,
    deviceId: event.deviceId,
    deviceType: event.deviceType,
    field: event.field,
    value: event.value,
    timeBucket
  };
}

function getFieldId(deviceId: string, field: string): string {
  return `${deviceId}:${field}`;
}

function emptyBuckets(): TimeBucketCounts {
  return {
    morning: 0,
    daytime: 0,
    evening: 0,
    night: 0
  };
}

function incrementBucket(buckets: TimeBucketCounts, bucket: TimeBucket): TimeBucketCounts {
  return {
    ...buckets,
    [bucket]: buckets[bucket] + 1
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function appendBounded<T>(items: T[], item: T, limit: number): T[] {
  return [item, ...items].slice(0, limit);
}

function getNumericStats(current: FieldMemory | undefined, value: DeviceEventValue): Partial<FieldMemory> {
  if (typeof value !== 'number') {
    return {};
  }

  return {
    numericMin: Math.min(current?.numericMin ?? value, value),
    numericMax: Math.max(current?.numericMax ?? value, value)
  };
}

function getBooleanStats(current: FieldMemory | undefined, value: DeviceEventValue): Partial<FieldMemory> {
  if (typeof value !== 'boolean') {
    return {};
  }

  return {
    trueCount: (current?.trueCount ?? 0) + (value ? 1 : 0),
    falseCount: (current?.falseCount ?? 0) + (value ? 0 : 1)
  };
}
