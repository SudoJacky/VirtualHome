import type { DeviceEventValue, DeviceValueEvent } from './deviceEventSocket';
import {
  classifyDeviceEvidence,
  type EvidenceCategory,
  type EvidenceStrength
} from './homeEvidenceClassifier';

export type TimeBucket = 'morning' | 'daytime' | 'evening' | 'night';

type TimeBucketCounts = Record<TimeBucket, number>;
export type ProfileEvidenceCategoryCounts = Record<EvidenceCategory, number>;

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
  evidenceCategory: EvidenceCategory;
  evidenceStrength: EvidenceStrength;
  meaningfulChange: boolean;
  valueDelta?: number;
  profileWeight: number;
  evidenceReason: string;
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
  changeCount: number;
  telemetryCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastMeaningfulChangeAt?: string;
  recentEvents: MemoryEvidence[];
  evidenceCategory: EvidenceCategory;
  evidenceStrength: EvidenceStrength;
  profileWeight: number;
  evidenceReason: string;
  profileEventCount: number;
  profileEvidenceWeight: number;
  profileEvidenceByCategory: ProfileEvidenceCategoryCounts;
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
  profileEventCount: number;
  profileEvidenceWeight: number;
  profileEvidenceByCategory: ProfileEvidenceCategoryCounts;
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
  profileEventCount: number;
  profileEvidenceWeight: number;
  profileEvidenceByCategory: ProfileEvidenceCategoryCounts;
}

export interface HomeMemory {
  homeId: string | null;
  runId: string | null;
  totalEvents: number;
  rooms: Record<string, RoomMemory>;
  devices: Record<string, DeviceMemory>;
  fields: Record<string, FieldMemory>;
  recentEvents: MemoryEvidence[];
  profileEventCount: number;
  profileEvidenceWeight: number;
  profileEvidenceByCategory: ProfileEvidenceCategoryCounts;
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
    recentEvents: [],
    profileEventCount: 0,
    profileEvidenceWeight: 0,
    profileEvidenceByCategory: emptyProfileEvidenceCategories()
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
  const fieldId = getFieldId(event.deviceId, event.field);
  const classification = classifyDeviceEvidence(event);
  const change = analyzeFieldChange(baseMemory.fields[fieldId], event, classification);
  const evidence = toEvidence(event, timeBucket, classification, change);
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
    recentEvents: appendBounded(baseMemory.recentEvents, evidence, ROOT_RECENT_LIMIT),
    profileEventCount: incrementProfileEventCount(baseMemory.profileEventCount, evidence),
    profileEvidenceWeight: roundWeight(baseMemory.profileEvidenceWeight + evidence.profileWeight),
    profileEvidenceByCategory: incrementProfileEvidenceCategory(baseMemory.profileEvidenceByCategory, evidence)
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
      recentEvents: [evidence],
      profileEventCount: incrementProfileEventCount(0, evidence),
      profileEvidenceWeight: evidence.profileWeight,
      profileEvidenceByCategory: incrementProfileEvidenceCategory(emptyProfileEvidenceCategories(), evidence)
    };
  }

  return {
    ...current,
    devices: unique([...current.devices, event.deviceId]),
    activeFields: unique([...current.activeFields, fieldId]),
    eventCount: current.eventCount + 1,
    lastSeenAt: event.ts,
    timeBuckets: incrementBucket(current.timeBuckets, timeBucket),
    recentEvents: appendBounded(current.recentEvents, evidence, ROOT_RECENT_LIMIT),
    profileEventCount: incrementProfileEventCount(current.profileEventCount, evidence),
    profileEvidenceWeight: roundWeight(current.profileEvidenceWeight + evidence.profileWeight),
    profileEvidenceByCategory: incrementProfileEvidenceCategory(current.profileEvidenceByCategory, evidence)
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
      recentEvents: [evidence],
      profileEventCount: incrementProfileEventCount(0, evidence),
      profileEvidenceWeight: evidence.profileWeight,
      profileEvidenceByCategory: incrementProfileEvidenceCategory(emptyProfileEvidenceCategories(), evidence)
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
    recentEvents: appendBounded(current.recentEvents, evidence, ROOT_RECENT_LIMIT),
    profileEventCount: incrementProfileEventCount(current.profileEventCount, evidence),
    profileEvidenceWeight: roundWeight(current.profileEvidenceWeight + evidence.profileWeight),
    profileEvidenceByCategory: incrementProfileEvidenceCategory(current.profileEvidenceByCategory, evidence)
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
      changeCount: evidence.meaningfulChange ? 1 : 0,
      telemetryCount: evidence.meaningfulChange ? 0 : 1,
      firstSeenAt: event.ts,
      lastSeenAt: event.ts,
      lastMeaningfulChangeAt: evidence.meaningfulChange ? event.ts : undefined,
      recentEvents: [evidence],
      evidenceCategory: evidence.evidenceCategory,
      evidenceStrength: evidence.evidenceStrength,
      profileWeight: evidence.profileWeight,
      evidenceReason: evidence.evidenceReason,
      profileEventCount: incrementProfileEventCount(0, evidence),
      profileEvidenceWeight: evidence.profileWeight,
      profileEvidenceByCategory: incrementProfileEvidenceCategory(emptyProfileEvidenceCategories(), evidence),
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
    changeCount: current.changeCount + (evidence.meaningfulChange ? 1 : 0),
    telemetryCount: current.telemetryCount + (evidence.meaningfulChange ? 0 : 1),
    lastSeenAt: event.ts,
    lastMeaningfulChangeAt: evidence.meaningfulChange ? event.ts : current.lastMeaningfulChangeAt,
    recentEvents: appendBounded(current.recentEvents, evidence, FIELD_RECENT_LIMIT),
    evidenceCategory: evidence.evidenceCategory,
    evidenceStrength: evidence.evidenceStrength,
    profileWeight: evidence.profileWeight,
    evidenceReason: evidence.evidenceReason,
    profileEventCount: incrementProfileEventCount(current.profileEventCount, evidence),
    profileEvidenceWeight: roundWeight(current.profileEvidenceWeight + evidence.profileWeight),
    profileEvidenceByCategory: incrementProfileEvidenceCategory(current.profileEvidenceByCategory, evidence),
    ...numericStats,
    ...booleanStats
  };
}

function toEvidence(
  event: DeviceValueEvent,
  timeBucket: TimeBucket,
  classification: ReturnType<typeof classifyDeviceEvidence>,
  change: FieldChangeAnalysis
): MemoryEvidence {
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
    timeBucket,
    evidenceCategory: classification.category,
    evidenceStrength: classification.strength,
    meaningfulChange: change.meaningfulChange,
    valueDelta: change.valueDelta,
    profileWeight: change.profileWeight,
    evidenceReason: change.evidenceReason
  };
}

interface FieldChangeAnalysis {
  meaningfulChange: boolean;
  valueDelta?: number;
  profileWeight: number;
  evidenceReason: string;
}

function analyzeFieldChange(
  current: FieldMemory | undefined,
  event: DeviceValueEvent,
  classification: ReturnType<typeof classifyDeviceEvidence>
): FieldChangeAnalysis {
  if (!current) {
    return {
      meaningfulChange: true,
      profileWeight: classification.profileWeight,
      evidenceReason: classification.reason
    };
  }

  const valueDelta = numericDelta(current.currentValue, event.value);
  const meaningfulChange = isMeaningfulFieldChange(current.currentValue, event.value, classification, valueDelta);
  const telemetryReason = valueDelta !== undefined
    ? ` Delta ${formatDelta(valueDelta)} is treated as telemetry and does not add profile weight.`
    : ' Repeated telemetry does not add profile weight.';

  return {
    meaningfulChange,
    valueDelta,
    profileWeight: meaningfulChange ? classification.profileWeight : 0,
    evidenceReason: meaningfulChange ? classification.reason : `${classification.reason}${telemetryReason}`
  };
}

function isMeaningfulFieldChange(
  previousValue: DeviceEventValue,
  nextValue: DeviceEventValue,
  classification: ReturnType<typeof classifyDeviceEvidence>,
  valueDelta: number | undefined
): boolean {
  if (valueDelta !== undefined) {
    if (valueDelta === 0) {
      return false;
    }
    if (classification.category === 'environment_context') {
      return valueDelta >= 0.5;
    }
    return true;
  }

  return !Object.is(previousValue, nextValue);
}

function numericDelta(previousValue: DeviceEventValue, nextValue: DeviceEventValue): number | undefined {
  if (typeof previousValue !== 'number' || typeof nextValue !== 'number') {
    return undefined;
  }
  return roundWeight(Math.abs(nextValue - previousValue));
}

function formatDelta(delta: number): string {
  return Number(delta.toFixed(3)).toString();
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

function emptyProfileEvidenceCategories(): ProfileEvidenceCategoryCounts {
  return {
    human_activity: 0,
    device_usage: 0,
    environment_context: 0,
    system_status: 0
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

function incrementProfileEventCount(current: number, evidence: MemoryEvidence): number {
  return evidence.profileWeight > 0 ? current + 1 : current;
}

function incrementProfileEvidenceCategory(
  current: ProfileEvidenceCategoryCounts,
  evidence: MemoryEvidence
): ProfileEvidenceCategoryCounts {
  if (evidence.profileWeight <= 0) {
    return current;
  }

  return {
    ...current,
    [evidence.evidenceCategory]: current[evidence.evidenceCategory] + 1
  };
}

function roundWeight(value: number): number {
  return Number(value.toFixed(3));
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
