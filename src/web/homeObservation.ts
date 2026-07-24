import type { DeviceEventValue, DeviceValueEvent } from './deviceEventSocket';

export type HomeObservationFieldRole = 'primary' | 'quality' | 'lifecycle';

export type HomeObservationCapability =
  | 'access'
  | 'presence'
  | 'sleep'
  | 'cooking'
  | 'work_study'
  | 'laundry'
  | 'vacuum'
  | 'media'
  | 'climate'
  | 'water'
  | 'generic';

export type HomeObservationRoomRole =
  | 'entry'
  | 'living'
  | 'cooking'
  | 'sleep'
  | 'work'
  | 'utility';

export interface HomeObservation {
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
  primaryMeasurements: Record<string, DeviceEventValue>;
  quality: Record<string, DeviceEventValue>;
  lifecycle: Record<string, DeviceEventValue>;
  context: {
    capabilities: HomeObservationCapability[];
    roomRoles: HomeObservationRoomRole[];
  };
  qualityMultiplier: number;
  events: DeviceValueEvent[];
}

const qualityFields = new Set([
  'confidence',
  'delayedms',
  'dropped',
  'duplicated',
  'heartbeat',
  'noisy',
  'outoforder',
  'rssi',
  'sampledropped',
  'signal'
]);

const lifecycleFields = new Set([
  'battery',
  'batterylevel',
  'batterypercent',
  'cycleminutes',
  'firmware',
  'health',
  'lastseen',
  'latency',
  'latencyms',
  'lifecyclephase',
  'online',
  'openminutes',
  'remainingmin'
]);

export function reconstructHomeObservations(
  events: DeviceValueEvent[]
): HomeObservation[] {
  const roomDeviceTypes = indexRoomDeviceTypes(events);
  const groups = new Map<string, DeviceValueEvent[]>();
  for (const event of events) {
    const key = `${event.sourceEventId}:${event.sequence}:${event.deviceId}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.values()]
    .map((group) => createObservation(group, roomDeviceTypes))
    .sort((left, right) => (
      left.sequence - right.sequence ||
      left.simTime.localeCompare(right.simTime) ||
      left.sourceEventId.localeCompare(right.sourceEventId)
    ));
}

export function classifyHomeObservationField(
  field: string
): HomeObservationFieldRole {
  const normalized = normalize(field);
  if (qualityFields.has(normalized)) {
    return 'quality';
  }
  if (lifecycleFields.has(normalized)) {
    return 'lifecycle';
  }
  return 'primary';
}

export function inferHomeObservationCapabilities(
  deviceType: string
): HomeObservationCapability[] {
  const type = normalize(deviceType);
  const capabilities: HomeObservationCapability[] = [];
  if (type.includes('lock') || type.includes('door')) capabilities.push('access');
  if (type.includes('motion') || type.includes('presence')) capabilities.push('presence');
  if (type.includes('sleep') || type.includes('bed')) capabilities.push('sleep');
  if (
    type.includes('stove') ||
    type.includes('oven') ||
    type.includes('rangehood') ||
    type.includes('cooktop') ||
    type.includes('microwave') ||
    type.includes('fridge') ||
    type.includes('kettle')
  ) capabilities.push('cooking');
  if (
    type.includes('router') ||
    type.includes('computer') ||
    type.includes('desk') ||
    type.includes('office')
  ) capabilities.push('work_study');
  if (type.includes('washer') || type.includes('dryer')) capabilities.push('laundry');
  if (type.includes('robotvacuum') || type.includes('vacuum')) capabilities.push('vacuum');
  if (
    type === 'tv' ||
    type.includes('television') ||
    type.includes('speaker') ||
    type.includes('media') ||
    type.includes('console')
  ) capabilities.push('media');
  if (
    type.includes('airconditioner') ||
    type.includes('thermostat') ||
    type.includes('hvac') ||
    type.includes('heater')
  ) capabilities.push('climate');
  if (type.includes('water') || type.includes('flow') || type.includes('valve')) {
    capabilities.push('water');
  }
  return capabilities.length > 0 ? sortedUnique(capabilities) : ['generic'];
}

function createObservation(
  sourceEvents: DeviceValueEvent[],
  roomDeviceTypes: Map<string, Set<string>>
): HomeObservation {
  const events = [...sourceEvents].sort((left, right) => (
    left.field.localeCompare(right.field) || left.id.localeCompare(right.id)
  ));
  const first = events[0];
  if (!first) {
    throw new Error('Cannot reconstruct an Observation from an empty source-event group');
  }
  for (const event of events.slice(1)) {
    if (
      event.runId !== first.runId ||
      event.homeId !== first.homeId ||
      event.deviceId !== first.deviceId ||
      event.roomId !== first.roomId ||
      event.sequence !== first.sequence
    ) {
      throw new Error(
        `Source event ${first.sourceEventId} mixes incompatible device-event context`
      );
    }
  }

  const primaryMeasurements: Record<string, DeviceEventValue> = {};
  const quality: Record<string, DeviceEventValue> = {};
  const lifecycle: Record<string, DeviceEventValue> = {};
  for (const event of events) {
    const target = classifyHomeObservationField(event.field) === 'quality'
      ? quality
      : classifyHomeObservationField(event.field) === 'lifecycle'
        ? lifecycle
        : primaryMeasurements;
    target[event.field] = event.value;
  }
  const delayedMs = timestampDelayMs(first.simTime, first.ts);
  if (delayedMs > 0 && !Object.keys(quality).some((field) => normalize(field) === 'delayedms')) {
    quality.delayedMs = delayedMs;
  }
  return {
    id: `observation:${first.runId}:${first.sequence}:${first.deviceId}:${first.sourceEventId}`,
    sourceEventId: first.sourceEventId,
    sourceEventType: first.sourceEventType,
    runId: first.runId,
    sequence: first.sequence,
    ts: first.ts,
    simTime: first.simTime,
    homeId: first.homeId,
    roomId: first.roomId,
    deviceId: first.deviceId,
    deviceType: first.deviceType,
    primaryMeasurements,
    quality,
    lifecycle,
    context: {
      capabilities: inferHomeObservationCapabilities(first.deviceType),
      roomRoles: inferRoomRoles(roomDeviceTypes.get(first.roomId) ?? new Set())
    },
    qualityMultiplier: observationQualityMultiplier(quality),
    events
  };
}

function timestampDelayMs(eventTime: string, ingestTime: string): number {
  if (!hasExplicitTimezone(eventTime) || !hasExplicitTimezone(ingestTime)) {
    return 0;
  }
  const eventMs = Date.parse(eventTime);
  const ingestMs = Date.parse(ingestTime);
  if (!Number.isFinite(eventMs) || !Number.isFinite(ingestMs)) {
    return 0;
  }
  return Math.max(0, ingestMs - eventMs);
}

function hasExplicitTimezone(value: string): boolean {
  return /(?:z|[+-]\d{2}:\d{2})$/i.test(value);
}

function observationQualityMultiplier(
  quality: Record<string, DeviceEventValue>
): number {
  const normalized = Object.fromEntries(Object.entries(quality).map(([field, value]) => [
    normalize(field),
    value
  ]));
  let multiplier = typeof normalized.confidence === 'number'
    ? clamp(normalized.confidence)
    : 1;
  if (normalized.noisy === true) multiplier *= 0.6;
  if (normalized.duplicated === true) multiplier *= 0.5;
  if (normalized.outoforder === true) multiplier *= 0.8;
  if (normalized.dropped === true || normalized.sampledropped === true) multiplier *= 0.25;
  if (typeof normalized.delayedms === 'number') {
    if (normalized.delayedms >= 300_000) multiplier *= 0.7;
    else if (normalized.delayedms >= 60_000) multiplier *= 0.85;
  }
  return Number(clamp(multiplier).toFixed(3));
}

function indexRoomDeviceTypes(
  events: DeviceValueEvent[]
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const event of events) {
    const types = index.get(event.roomId) ?? new Set<string>();
    types.add(event.deviceType);
    index.set(event.roomId, types);
  }
  return index;
}

function inferRoomRoles(deviceTypes: Set<string>): HomeObservationRoomRole[] {
  const capabilities = new Set([...deviceTypes].flatMap(inferHomeObservationCapabilities));
  const roles: HomeObservationRoomRole[] = [];
  if (capabilities.has('access')) roles.push('entry');
  if (capabilities.has('media') || capabilities.has('vacuum')) roles.push('living');
  if (capabilities.has('cooking')) roles.push('cooking');
  if (capabilities.has('sleep')) roles.push('sleep');
  if (capabilities.has('work_study')) roles.push('work');
  if (capabilities.has('laundry') || capabilities.has('water')) roles.push('utility');
  return roles;
}

function sortedUnique<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0, value));
}

function normalize(value: string): string {
  return value.replace(/[_\s-]+/g, '').toLowerCase();
}
