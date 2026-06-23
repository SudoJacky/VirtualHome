import type { DeviceEventValue, DeviceValueEvent } from './deviceEventSocket';
import {
  classifyDeviceEvidence,
  type EvidenceCategory,
  type EvidenceStrength
} from './homeEvidenceClassifier';

export type TimeBucket = 'morning' | 'daytime' | 'evening' | 'night';
export type MemoryEpisodeKind = 'occupancy' | 'contact_activity' | 'device_usage' | 'appliance_usage';
export type MemoryEpisodeStatus = 'open' | 'closed';

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

export interface MemoryEpisode {
  id: string;
  kind: MemoryEpisodeKind;
  status: MemoryEpisodeStatus;
  homeId: string;
  runId: string;
  roomId: string;
  deviceId: string;
  deviceType: string;
  field: string;
  fieldId: string;
  timeBucket: TimeBucket;
  startedAt: string;
  startedSimTime: string;
  updatedAt: string;
  updatedSimTime: string;
  endedAt?: string;
  endedSimTime?: string;
  durationMinutes?: number;
  eventCount: number;
  evidenceIds: string[];
  startValue: DeviceEventValue;
  latestValue: DeviceEventValue;
  peakValue?: number;
  profileWeight: number;
}

export interface DailyProfileSummary {
  date: string;
  homeId: string;
  runId: string;
  eventCount: number;
  profileEventCount: number;
  profileEvidenceWeight: number;
  profileEvidenceByCategory: ProfileEvidenceCategoryCounts;
  episodeCount: number;
  activeRooms: string[];
  meaningfulRooms: string[];
  activeDevices: string[];
  activeFields: string[];
  timeBuckets: TimeBucketCounts;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface WeeklyProfileSummary {
  week: string;
  homeId: string;
  runId: string;
  dates: string[];
  eventCount: number;
  profileEventCount: number;
  profileEvidenceWeight: number;
  profileEvidenceByCategory: ProfileEvidenceCategoryCounts;
  episodeCount: number;
  activeRooms: string[];
  meaningfulRooms: string[];
  activeDevices: string[];
  activeFields: string[];
  timeBuckets: TimeBucketCounts;
  firstSeenAt: string;
  lastSeenAt: string;
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
  episodes: Record<string, MemoryEpisode>;
  activeEpisodeIds: Record<string, string>;
  episodeCount: number;
  dailySummaries: Record<string, DailyProfileSummary>;
  dailySummaryCount: number;
  weeklySummaries: Record<string, WeeklyProfileSummary>;
  weeklySummaryCount: number;
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
    episodes: {},
    activeEpisodeIds: {},
    episodeCount: 0,
    dailySummaries: {},
    dailySummaryCount: 0,
    weeklySummaries: {},
    weeklySummaryCount: 0,
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
  const episodeMemory = updateEpisodeMemory(baseMemory, event, evidence, fieldId, timeBucket);
  const dailySummaries = updateDailySummaries(baseMemory.dailySummaries, event, evidence, fieldId, timeBucket, episodeMemory.startedEpisode);
  const weeklySummaries = updateWeeklySummaries(baseMemory.weeklySummaries, event, evidence, fieldId, timeBucket, episodeMemory.startedEpisode);

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
    episodes: episodeMemory.episodes,
    activeEpisodeIds: episodeMemory.activeEpisodeIds,
    episodeCount: episodeMemory.episodeCount,
    dailySummaries,
    dailySummaryCount: Object.keys(dailySummaries).length,
    weeklySummaries,
    weeklySummaryCount: Object.keys(weeklySummaries).length,
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

interface EpisodeMemoryUpdate {
  episodes: Record<string, MemoryEpisode>;
  activeEpisodeIds: Record<string, string>;
  episodeCount: number;
  startedEpisode?: MemoryEpisode;
}

interface EpisodeSignal {
  kind: MemoryEpisodeKind;
  active: boolean;
  peakValue?: number;
}

function updateEpisodeMemory(
  memory: HomeMemory,
  event: DeviceValueEvent,
  evidence: MemoryEvidence,
  fieldId: string,
  timeBucket: TimeBucket
): EpisodeMemoryUpdate {
  const signal = episodeSignalForEvent(event);

  if (!signal) {
    return {
      episodes: memory.episodes,
      activeEpisodeIds: memory.activeEpisodeIds,
      episodeCount: memory.episodeCount
    };
  }

  const activeKey = `${fieldId}:${signal.kind}`;
  const activeEpisodeId = memory.activeEpisodeIds[activeKey];
  const activeEpisode = activeEpisodeId ? memory.episodes[activeEpisodeId] : undefined;

  if (signal.active) {
    if (activeEpisode) {
      return {
        episodes: {
          ...memory.episodes,
          [activeEpisode.id]: updateActiveEpisode(activeEpisode, event, evidence, signal)
        },
        activeEpisodeIds: memory.activeEpisodeIds,
        episodeCount: memory.episodeCount
      };
    }

    const episode = createEpisode(event, evidence, fieldId, timeBucket, signal);
    return {
      episodes: {
        ...memory.episodes,
        [episode.id]: episode
      },
      activeEpisodeIds: {
        ...memory.activeEpisodeIds,
        [activeKey]: episode.id
      },
      episodeCount: memory.episodeCount + 1,
      startedEpisode: episode
    };
  }

  if (!activeEpisode) {
    return {
      episodes: memory.episodes,
      activeEpisodeIds: memory.activeEpisodeIds,
      episodeCount: memory.episodeCount
    };
  }

  const closedEpisode = closeEpisode(activeEpisode, event, evidence, signal);
  const activeEpisodeIds = { ...memory.activeEpisodeIds };
  delete activeEpisodeIds[activeKey];

  return {
    episodes: {
      ...memory.episodes,
      [closedEpisode.id]: closedEpisode
    },
    activeEpisodeIds,
    episodeCount: memory.episodeCount
  };
}

function updateDailySummaries(
  summaries: Record<string, DailyProfileSummary>,
  event: DeviceValueEvent,
  evidence: MemoryEvidence,
  fieldId: string,
  timeBucket: TimeBucket,
  startedEpisode: MemoryEpisode | undefined
): Record<string, DailyProfileSummary> {
  const date = getSummaryDate(event);
  const current = summaries[date];
  const next = current ? updateDailySummary(current, event, evidence, fieldId, timeBucket, startedEpisode) : createDailySummary(date, event, evidence, fieldId, timeBucket, startedEpisode);

  return {
    ...summaries,
    [date]: next
  };
}

function createDailySummary(
  date: string,
  event: DeviceValueEvent,
  evidence: MemoryEvidence,
  fieldId: string,
  timeBucket: TimeBucket,
  startedEpisode: MemoryEpisode | undefined
): DailyProfileSummary {
  return {
    date,
    homeId: event.homeId,
    runId: event.runId,
    eventCount: 1,
    profileEventCount: incrementProfileEventCount(0, evidence),
    profileEvidenceWeight: evidence.profileWeight,
    profileEvidenceByCategory: incrementProfileEvidenceCategory(emptyProfileEvidenceCategories(), evidence),
    episodeCount: startedEpisode ? 1 : 0,
    activeRooms: [event.roomId],
    meaningfulRooms: meaningfulRoomIdsForEvent(event, evidence, startedEpisode),
    activeDevices: [event.deviceId],
    activeFields: [fieldId],
    timeBuckets: incrementBucket(emptyBuckets(), timeBucket),
    firstSeenAt: event.ts,
    lastSeenAt: event.ts
  };
}

function updateDailySummary(
  current: DailyProfileSummary,
  event: DeviceValueEvent,
  evidence: MemoryEvidence,
  fieldId: string,
  timeBucket: TimeBucket,
  startedEpisode: MemoryEpisode | undefined
): DailyProfileSummary {
  return {
    ...current,
    homeId: event.homeId,
    runId: event.runId,
    eventCount: current.eventCount + 1,
    profileEventCount: incrementProfileEventCount(current.profileEventCount, evidence),
    profileEvidenceWeight: roundWeight(current.profileEvidenceWeight + evidence.profileWeight),
    profileEvidenceByCategory: incrementProfileEvidenceCategory(current.profileEvidenceByCategory, evidence),
    episodeCount: current.episodeCount + (startedEpisode ? 1 : 0),
    activeRooms: unique([...current.activeRooms, event.roomId]).sort((left, right) => left.localeCompare(right)),
    meaningfulRooms: unique([...current.meaningfulRooms, ...meaningfulRoomIdsForEvent(event, evidence, startedEpisode)]).sort((left, right) => left.localeCompare(right)),
    activeDevices: unique([...current.activeDevices, event.deviceId]).sort((left, right) => left.localeCompare(right)),
    activeFields: unique([...current.activeFields, fieldId]).sort((left, right) => left.localeCompare(right)),
    timeBuckets: incrementBucket(current.timeBuckets, timeBucket),
    lastSeenAt: event.ts
  };
}

function updateWeeklySummaries(
  summaries: Record<string, WeeklyProfileSummary>,
  event: DeviceValueEvent,
  evidence: MemoryEvidence,
  fieldId: string,
  timeBucket: TimeBucket,
  startedEpisode: MemoryEpisode | undefined
): Record<string, WeeklyProfileSummary> {
  const date = getSummaryDate(event);
  const week = getSummaryWeek(date);
  const current = summaries[week];
  const next = current ? updateWeeklySummary(current, date, event, evidence, fieldId, timeBucket, startedEpisode) : createWeeklySummary(week, date, event, evidence, fieldId, timeBucket, startedEpisode);

  return {
    ...summaries,
    [week]: next
  };
}

function createWeeklySummary(
  week: string,
  date: string,
  event: DeviceValueEvent,
  evidence: MemoryEvidence,
  fieldId: string,
  timeBucket: TimeBucket,
  startedEpisode: MemoryEpisode | undefined
): WeeklyProfileSummary {
  return {
    week,
    homeId: event.homeId,
    runId: event.runId,
    dates: [date],
    eventCount: 1,
    profileEventCount: incrementProfileEventCount(0, evidence),
    profileEvidenceWeight: evidence.profileWeight,
    profileEvidenceByCategory: incrementProfileEvidenceCategory(emptyProfileEvidenceCategories(), evidence),
    episodeCount: startedEpisode ? 1 : 0,
    activeRooms: [event.roomId],
    meaningfulRooms: meaningfulRoomIdsForEvent(event, evidence, startedEpisode),
    activeDevices: [event.deviceId],
    activeFields: [fieldId],
    timeBuckets: incrementBucket(emptyBuckets(), timeBucket),
    firstSeenAt: event.ts,
    lastSeenAt: event.ts
  };
}

function updateWeeklySummary(
  current: WeeklyProfileSummary,
  date: string,
  event: DeviceValueEvent,
  evidence: MemoryEvidence,
  fieldId: string,
  timeBucket: TimeBucket,
  startedEpisode: MemoryEpisode | undefined
): WeeklyProfileSummary {
  return {
    ...current,
    homeId: event.homeId,
    runId: event.runId,
    dates: unique([...current.dates, date]).sort((left, right) => left.localeCompare(right)),
    eventCount: current.eventCount + 1,
    profileEventCount: incrementProfileEventCount(current.profileEventCount, evidence),
    profileEvidenceWeight: roundWeight(current.profileEvidenceWeight + evidence.profileWeight),
    profileEvidenceByCategory: incrementProfileEvidenceCategory(current.profileEvidenceByCategory, evidence),
    episodeCount: current.episodeCount + (startedEpisode ? 1 : 0),
    activeRooms: unique([...current.activeRooms, event.roomId]).sort((left, right) => left.localeCompare(right)),
    meaningfulRooms: unique([...current.meaningfulRooms, ...meaningfulRoomIdsForEvent(event, evidence, startedEpisode)]).sort((left, right) => left.localeCompare(right)),
    activeDevices: unique([...current.activeDevices, event.deviceId]).sort((left, right) => left.localeCompare(right)),
    activeFields: unique([...current.activeFields, fieldId]).sort((left, right) => left.localeCompare(right)),
    timeBuckets: incrementBucket(current.timeBuckets, timeBucket),
    lastSeenAt: event.ts
  };
}

function createEpisode(
  event: DeviceValueEvent,
  evidence: MemoryEvidence,
  fieldId: string,
  timeBucket: TimeBucket,
  signal: EpisodeSignal
): MemoryEpisode {
  return {
    id: `episode:${fieldId}:${signal.kind}:${event.sequence}`,
    kind: signal.kind,
    status: 'open',
    homeId: event.homeId,
    runId: event.runId,
    roomId: event.roomId,
    deviceId: event.deviceId,
    deviceType: event.deviceType,
    field: event.field,
    fieldId,
    timeBucket,
    startedAt: event.ts,
    startedSimTime: event.simTime,
    updatedAt: event.ts,
    updatedSimTime: event.simTime,
    eventCount: 1,
    evidenceIds: [evidence.id],
    startValue: event.value,
    latestValue: event.value,
    peakValue: signal.peakValue,
    profileWeight: evidence.profileWeight
  };
}

function updateActiveEpisode(
  episode: MemoryEpisode,
  event: DeviceValueEvent,
  evidence: MemoryEvidence,
  signal: EpisodeSignal
): MemoryEpisode {
  return {
    ...episode,
    homeId: event.homeId,
    runId: event.runId,
    roomId: event.roomId,
    deviceType: event.deviceType,
    updatedAt: event.ts,
    updatedSimTime: event.simTime,
    eventCount: episode.eventCount + 1,
    evidenceIds: [...episode.evidenceIds, evidence.id],
    latestValue: event.value,
    peakValue: maxOptional(episode.peakValue, signal.peakValue),
    profileWeight: roundWeight(episode.profileWeight + evidence.profileWeight)
  };
}

function closeEpisode(
  episode: MemoryEpisode,
  event: DeviceValueEvent,
  evidence: MemoryEvidence,
  signal: EpisodeSignal
): MemoryEpisode {
  return {
    ...updateActiveEpisode(episode, event, evidence, signal),
    status: 'closed',
    endedAt: event.ts,
    endedSimTime: event.simTime,
    durationMinutes: durationMinutes(episode.startedAt, event.ts)
  };
}

function episodeSignalForEvent(event: DeviceValueEvent): EpisodeSignal | null {
  const field = normalize(event.field);
  const deviceType = normalize(event.deviceType);

  if (isMotionEpisodeField(deviceType, field)) {
    return booleanEpisodeSignal('occupancy', event.value);
  }

  if (isContactEpisodeField(field)) {
    return openClosedEpisodeSignal('contact_activity', event.value);
  }

  if (field === 'powerw' || field === 'wattage' || field === 'current') {
    if (typeof event.value !== 'number') {
      return null;
    }
    return {
      kind: 'appliance_usage',
      active: event.value > 0,
      peakValue: event.value > 0 ? event.value : undefined
    };
  }

  if (field === 'power' || field === 'state') {
    return powerStateEpisodeSignal(event.value);
  }

  return null;
}

function booleanEpisodeSignal(kind: MemoryEpisodeKind, value: DeviceEventValue): EpisodeSignal | null {
  if (typeof value === 'boolean') {
    return { kind, active: value };
  }
  return null;
}

function openClosedEpisodeSignal(kind: MemoryEpisodeKind, value: DeviceEventValue): EpisodeSignal | null {
  if (typeof value === 'boolean') {
    return { kind, active: value };
  }
  if (typeof value === 'string') {
    const normalized = normalize(value);
    if (normalized === 'open') return { kind, active: true };
    if (normalized === 'closed') return { kind, active: false };
  }
  return null;
}

function powerStateEpisodeSignal(value: DeviceEventValue): EpisodeSignal | null {
  if (typeof value === 'boolean') {
    return { kind: 'device_usage', active: value };
  }
  if (typeof value === 'string') {
    const normalized = normalize(value);
    if (normalized === 'on') return { kind: 'device_usage', active: true };
    if (normalized === 'off') return { kind: 'device_usage', active: false };
  }
  return null;
}

function isMotionEpisodeField(deviceType: string, field: string): boolean {
  return deviceType.includes('motion') || field === 'motion' || field === 'occupancy' || field === 'occupied';
}

function isContactEpisodeField(field: string): boolean {
  return field === 'contact' || field === 'dooropen' || field === 'open' || field === 'windowopen';
}

function maxOptional(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
}

function meaningfulRoomIdsForEvent(
  event: DeviceValueEvent,
  evidence: MemoryEvidence,
  startedEpisode: MemoryEpisode | undefined
): string[] {
  if (startedEpisode || (evidence.profileWeight > 0 && (evidence.evidenceCategory === 'human_activity' || evidence.evidenceCategory === 'device_usage'))) {
    return [event.roomId];
  }
  return [];
}

function durationMinutes(startedAt: string, endedAt: string): number | undefined {
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(endedAt);

  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return undefined;
  }

  return roundWeight(Math.max(0, (endMs - startMs) / 60000));
}

function getSummaryDate(event: DeviceValueEvent): string {
  const writtenDate = /^(\d{4}-\d{2}-\d{2})T/.exec(event.simTime)?.[1];
  if (writtenDate) {
    return writtenDate;
  }
  return event.ts.slice(0, 10);
}

function getSummaryWeek(date: string): string {
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.getTime())) {
    return `${date.slice(0, 4)}-W00`;
  }

  const utcDate = new Date(Date.UTC(parsedDate.getUTCFullYear(), parsedDate.getUTCMonth(), parsedDate.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

  return `${utcDate.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
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

function normalize(value: string): string {
  return value.replace(/[_\s-]+/g, '').toLowerCase();
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
