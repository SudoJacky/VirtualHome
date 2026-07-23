import type { DeviceEventValue, DeviceValueEvent } from './deviceEventSocket';
import {
  classifyDeviceEvidence,
  type DeviceCapability,
  type EvidenceCategory,
  type EvidenceStrength
} from './homeEvidenceClassifier';

export type TimeBucket = 'morning' | 'daytime' | 'evening' | 'night';
export type MemoryEpisodeKind = 'occupancy' | 'contact_activity' | 'device_usage' | 'appliance_usage';
export type MemoryEpisodeStatus = 'open' | 'closed';
export type ActivityEpisodeKind = 'return_home' | 'meal_preparation' | 'bedtime' | 'climate_response';

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
  sourceConfidence?: number;
  timeBucket: TimeBucket;
  evidenceCategory: EvidenceCategory;
  evidenceStrength: EvidenceStrength;
  capability: DeviceCapability;
  meaningfulChange: boolean;
  valueDelta?: number;
  profileWeight: number;
  evidenceReason: string;
}

export type SemanticSignalType =
  | 'presence_signal'
  | 'access_signal'
  | 'sleep_signal'
  | 'water_signal'
  | 'cooking_signal'
  | 'media_signal'
  | 'work_study_signal'
  | 'lighting_signal'
  | 'climate_signal'
  | 'environment_signal'
  | 'system_signal';

export type SemanticSignalCounts = Record<SemanticSignalType, number>;

export interface SemanticSignal {
  id: string;
  type: SemanticSignalType;
  homeId: string;
  runId: string;
  roomId: string;
  deviceId: string;
  deviceType: string;
  field: string;
  value: DeviceEventValue;
  simTime: string;
  startedAt: string;
  updatedAt: string;
  timeBucket: TimeBucket;
  strength: EvidenceStrength;
  profileWeight: number;
  sourceEvidenceIds: string[];
  reason: string;
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

export interface ActivityEpisode {
  id: string;
  kind: ActivityEpisodeKind;
  homeId: string;
  runId: string;
  roomIds: string[];
  deviceIds: string[];
  startedAt: string;
  startedSimTime: string;
  updatedAt: string;
  updatedSimTime: string;
  evidenceIds: string[];
  semanticSignalIds: string[];
  profileWeight: number;
  summary: string;
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

export interface HomeProfilePattern {
  id: string;
  count: number;
  dates: string[];
  weekdayCount: number;
  weekendCount: number;
  minutes: number[];
  gapsMinutes: number[];
  firstSimTime: string;
  lastSimTime: string;
  evidence: MemoryEvidence[];
}

export type HomeProfilePatterns = Record<string, HomeProfilePattern>;

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
  activityEpisodes: ActivityEpisode[];
  activityEpisodeCount: number;
  dailySummaries: Record<string, DailyProfileSummary>;
  dailySummaryCount: number;
  weeklySummaries: Record<string, WeeklyProfileSummary>;
  weeklySummaryCount: number;
  profilePatterns: HomeProfilePatterns;
  semanticSignals: SemanticSignal[];
  semanticSignalCount: number;
  semanticSignalCountsByType: SemanticSignalCounts;
  recentEvents: MemoryEvidence[];
  profileEventCount: number;
  profileEvidenceWeight: number;
  profileEvidenceByCategory: ProfileEvidenceCategoryCounts;
}

const ROOT_RECENT_LIMIT = 50;
const FIELD_RECENT_LIMIT = 20;
const SEMANTIC_SIGNAL_LIMIT = 80;

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
    activityEpisodes: [],
    activityEpisodeCount: 0,
    dailySummaries: {},
    dailySummaryCount: 0,
    weeklySummaries: {},
    weeklySummaryCount: 0,
    profilePatterns: {},
    semanticSignals: [],
    semanticSignalCount: 0,
    semanticSignalCountsByType: emptySemanticSignalCounts(),
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
  const sourceConfidences = indexSourceConfidences(events);
  return events.reduce((current, event) => (
    reduceDeviceEventWithConfidence(
      current,
      event,
      sourceConfidences.get(event.sourceEventId)
    )
  ), memory);
}

function indexSourceConfidences(events: DeviceValueEvent[]): Map<string, number> {
  const confidences = new Map<string, number>();
  for (const event of events) {
    if (normalize(event.field) !== 'confidence' || typeof event.value !== 'number') {
      continue;
    }
    confidences.set(event.sourceEventId, normalizeSourceConfidence(event.value));
  }
  return confidences;
}

export function reduceDeviceEvent(memory: HomeMemory, event: DeviceValueEvent): HomeMemory {
  return reduceDeviceEventWithConfidence(memory, event, undefined);
}

function reduceDeviceEventWithConfidence(
  memory: HomeMemory,
  event: DeviceValueEvent,
  sourceConfidence: number | undefined
): HomeMemory {
  const baseMemory = memory.runId !== null && memory.runId !== event.runId ? createHomeMemory() : memory;
  const timeBucket = getTimeBucket(event.simTime);
  const fieldId = getFieldId(event.deviceId, event.field);
  const classification = classifyDeviceEvidence(event);
  const previousField = baseMemory.fields[fieldId];
  const change = analyzeFieldChange(previousField, event, classification, sourceConfidence);
  const evidence = toEvidence(event, timeBucket, classification, change, sourceConfidence);
  const fieldMemory = updateFieldMemory(baseMemory.fields[fieldId], event, evidence, fieldId);
  const deviceMemory = updateDeviceMemory(baseMemory.devices[event.deviceId], event, evidence, fieldId, timeBucket);
  const roomMemory = updateRoomMemory(baseMemory.rooms[event.roomId], event, evidence, fieldId, timeBucket);
  const episodeMemory = updateEpisodeMemory(baseMemory, event, evidence, fieldId, timeBucket);
  const dailySummaries = updateDailySummaries(baseMemory.dailySummaries, event, evidence, fieldId, timeBucket, episodeMemory.startedEpisode);
  const weeklySummaries = updateWeeklySummaries(baseMemory.weeklySummaries, event, evidence, fieldId, timeBucket, episodeMemory.startedEpisode);
  const semanticSignals = semanticSignalsForEvidence(event, evidence);
  const activityEpisodes = updateActivityEpisodes(baseMemory, semanticSignals);
  const profilePatterns = updateProfilePatterns(baseMemory.profilePatterns, event, evidence, previousField);

  const nextMemory: HomeMemory = {
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
    activityEpisodes,
    activityEpisodeCount: activityEpisodes.length,
    dailySummaries,
    dailySummaryCount: Object.keys(dailySummaries).length,
    weeklySummaries,
    weeklySummaryCount: Object.keys(weeklySummaries).length,
    profilePatterns,
    semanticSignals: appendManyBounded(baseMemory.semanticSignals, semanticSignals, SEMANTIC_SIGNAL_LIMIT),
    semanticSignalCount: baseMemory.semanticSignalCount + semanticSignals.length,
    semanticSignalCountsByType: incrementSemanticSignalCounts(baseMemory.semanticSignalCountsByType, semanticSignals),
    recentEvents: appendBounded(baseMemory.recentEvents, evidence, ROOT_RECENT_LIMIT),
    profileEventCount: incrementProfileEventCount(baseMemory.profileEventCount, evidence),
    profileEvidenceWeight: roundWeight(baseMemory.profileEvidenceWeight + evidence.profileWeight),
    profileEvidenceByCategory: incrementProfileEvidenceCategory(baseMemory.profileEvidenceByCategory, evidence)
  };
  return {
    ...nextMemory,
    semanticSignals: pruneSemanticSignalsForIndexedEvidence(nextMemory.semanticSignals, nextMemory)
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
  change: FieldChangeAnalysis,
  sourceConfidence: number | undefined
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
    ...(sourceConfidence === undefined ? {} : { sourceConfidence }),
    timeBucket,
    evidenceCategory: classification.category,
    evidenceStrength: classification.strength,
    capability: classification.capability,
    meaningfulChange: change.meaningfulChange,
    valueDelta: change.valueDelta,
    profileWeight: change.profileWeight,
    evidenceReason: change.evidenceReason
  };
}

function semanticSignalsForEvidence(event: DeviceValueEvent, evidence: MemoryEvidence): SemanticSignal[] {
  if (!evidence.meaningfulChange) {
    return [];
  }

  const field = normalize(event.field);
  const deviceType = normalize(event.deviceType);
  const qualityWeight = (weight: number) => roundWeight(weight * (evidence.sourceConfidence ?? 1));
  const signals: SemanticSignal[] = [];
  const add = (type: SemanticSignalType, reason: string, strength = evidence.evidenceStrength, profileWeight = evidence.profileWeight) => {
    signals.push({
      id: `signal:${evidence.id}:${type}`,
      type,
      homeId: event.homeId,
      runId: event.runId,
      roomId: event.roomId,
      deviceId: event.deviceId,
      deviceType: event.deviceType,
      field: event.field,
      value: event.value,
      simTime: event.simTime,
      startedAt: event.ts,
      updatedAt: event.ts,
      timeBucket: evidence.timeBucket,
      strength,
      profileWeight,
      sourceEvidenceIds: [evidence.id],
      reason
    });
  };

  if (evidence.evidenceCategory === 'system_status') {
    add('system_signal', `${event.field} is system state and is available for diagnostics, not profile inference.`, 'ignored', 0);
    return signals;
  }

  if (isAccessSignal(event.roomId, deviceType, field, event.value)) {
    add('access_signal', `${event.deviceId}.${event.field} indicates access or entry activity.`, 'strong', Math.max(evidence.profileWeight, qualityWeight(0.8)));
  }

  if (evidence.capability.type === 'sleep_context' && evidence.capability.active) {
    add('sleep_signal', `${event.deviceId}.${event.field} indicates sleep or in-bed context.`, evidence.evidenceStrength === 'ignored' ? 'medium' : evidence.evidenceStrength, Math.max(evidence.profileWeight, qualityWeight(0.6)));
    return signals;
  }

  if (evidence.evidenceCategory === 'environment_context') {
    add('environment_signal', `${event.field} contributes weak environment context.`, 'weak', evidence.profileWeight);
    return signals;
  }

  if (isWaterSignal(deviceType, field, event.value)) {
    add('water_signal', `${event.deviceId}.${event.field} indicates active water usage.`, evidence.evidenceStrength === 'weak' ? 'medium' : evidence.evidenceStrength, Math.max(evidence.profileWeight, qualityWeight(0.45)));
  }

  if (evidence.capability.type === 'climate_control' && evidence.capability.active) {
    add('climate_signal', `${event.deviceId}.${event.field} indicates active climate control.`, evidence.evidenceStrength === 'weak' ? 'medium' : evidence.evidenceStrength, Math.max(evidence.profileWeight, qualityWeight(0.45)));
  }

  if (isCookingSignal(event.roomId, deviceType, field, event.value)) {
    add('cooking_signal', `${event.deviceId}.${event.field} contributes kitchen or cooking activity context.`, evidence.evidenceStrength === 'weak' ? 'medium' : evidence.evidenceStrength, Math.max(evidence.profileWeight, qualityWeight(0.45)));
  }

  if (isMediaSignal(deviceType, field, event.value)) {
    add('media_signal', `${event.deviceId}.${event.field} indicates media or shared entertainment activity.`, evidence.evidenceStrength === 'weak' ? 'medium' : evidence.evidenceStrength, Math.max(evidence.profileWeight, qualityWeight(0.45)));
  }

  if (isWorkStudySignal(event.roomId, deviceType, field, event.value)) {
    add('work_study_signal', `${event.deviceId}.${event.field} contributes work or study activity context.`, evidence.evidenceStrength === 'weak' ? 'medium' : evidence.evidenceStrength, Math.max(evidence.profileWeight, qualityWeight(0.35)));
  }

  if (isLightingSignal(deviceType, field, event.value)) {
    add('lighting_signal', `${event.deviceId}.${event.field} is lighting context for nearby activity.`, evidence.evidenceStrength === 'strong' ? 'medium' : evidence.evidenceStrength, Math.min(Math.max(evidence.profileWeight, qualityWeight(0.2)), qualityWeight(0.45)));
  }

  if (evidence.evidenceCategory === 'human_activity' && !signals.some((signal) => signal.type === 'presence_signal')) {
    add('presence_signal', `${event.deviceId}.${event.field} indicates human presence or motion.`, evidence.evidenceStrength, evidence.profileWeight);
  }

  if (signals.length === 0 && evidence.evidenceCategory === 'device_usage' && isActiveValue(event.value)) {
    add('presence_signal', `${event.deviceId}.${event.field} is generic device usage and weakly supports presence.`, 'weak', Math.min(evidence.profileWeight, 0.25));
  }

  if (signals.some((signal) => signal.type === 'access_signal') && !signals.some((signal) => signal.type === 'presence_signal')) {
    add('presence_signal', `${event.deviceId}.${event.field} access activity weakly supports recent presence.`, 'medium', Math.min(Math.max(evidence.profileWeight, qualityWeight(0.45)), qualityWeight(0.7)));
  }

  return signals;
}

function updateActivityEpisodes(memory: HomeMemory, newSignals: SemanticSignal[]): ActivityEpisode[] {
  if (newSignals.length === 0) {
    return memory.activityEpisodes;
  }

  const allSignals = [...memory.semanticSignals, ...newSignals]
    .sort((left, right) => left.simTime.localeCompare(right.simTime) || left.id.localeCompare(right.id));
  const nextEpisodes = [...memory.activityEpisodes];

  for (const signal of newSignals) {
    for (const episode of activityEpisodesForSignal(signal, allSignals)) {
      const existingIndex = nextEpisodes.findIndex((current) => current.id === episode.id);
      if (existingIndex >= 0) {
        if (episode.kind !== 'return_home') {
          nextEpisodes[existingIndex] = mergeActivityEpisodes(nextEpisodes[existingIndex], episode);
        }
      } else {
        nextEpisodes.unshift(episode);
      }
    }
  }

  return nextEpisodes.slice(0, ROOT_RECENT_LIMIT);
}

function activityEpisodesForSignal(signal: SemanticSignal, allSignals: SemanticSignal[]): ActivityEpisode[] {
  const episodes: ActivityEpisode[] = [];

  if (signal.type !== 'access_signal') {
    const accessSignal = latestNearbySignal(allSignals, signal, (candidate) => candidate.type === 'access_signal' && candidate.roomId !== signal.roomId, 30);
    if (accessSignal && isBehaviorSignal(signal)) {
      episodes.push(createActivityEpisode('return_home', [accessSignal, signal], `Access activity at ${accessSignal.roomId} was followed by ${signal.type.replace(/_/g, ' ')} in ${signal.roomId}.`));
    }
  }

  if (signal.type === 'cooking_signal') {
    const supportingSignals = nearbySignals(allSignals, signal, (candidate) => (
      candidate.roomId === signal.roomId &&
      candidate.id !== signal.id &&
      ['presence_signal', 'water_signal', 'lighting_signal', 'cooking_signal'].includes(candidate.type)
    ), 45);
    episodes.push(createActivityEpisode('meal_preparation', [...supportingSignals, signal], `${signal.roomId} has cooking activity with nearby household context.`));
  }

  if (signal.type === 'sleep_signal') {
    episodes.push(createActivityEpisode('bedtime', [signal], `${signal.roomId} has sleep or in-bed context.`));
  }

  if (signal.type === 'climate_signal') {
    const environmentSignal = latestNearbySignal(allSignals, signal, (candidate) => (
      candidate.roomId === signal.roomId && candidate.type === 'environment_signal'
    ), 30);
    if (environmentSignal) {
      episodes.push(createActivityEpisode('climate_response', [environmentSignal, signal], `${signal.roomId} climate control followed nearby environment context.`));
    }
  }

  return episodes;
}

function createActivityEpisode(kind: ActivityEpisodeKind, signals: SemanticSignal[], summary: string): ActivityEpisode {
  const sortedSignals = [...signals].sort((left, right) => left.simTime.localeCompare(right.simTime) || left.id.localeCompare(right.id));
  const first = sortedSignals[0];
  const last = sortedSignals[sortedSignals.length - 1];
  const roomIds = sortedUniqueByFirstSeen(sortedSignals.map((signal) => signal.roomId));
  const deviceIds = sortedUniqueByFirstSeen(sortedSignals.map((signal) => signal.deviceId));
  const evidenceIds = sortedUniqueByFirstSeen(sortedSignals.flatMap((signal) => signal.sourceEvidenceIds));

  return {
    id: `activity:${kind}:${roomIds.join('+')}:${first.simTime}`,
    kind,
    homeId: first.homeId,
    runId: first.runId,
    roomIds,
    deviceIds,
    startedAt: first.startedAt,
    startedSimTime: first.simTime,
    updatedAt: last.updatedAt,
    updatedSimTime: last.simTime,
    evidenceIds,
    semanticSignalIds: sortedSignals.map((signal) => signal.id),
    profileWeight: roundWeight(sortedSignals.reduce((total, signal) => total + signal.profileWeight, 0)),
    summary
  };
}

function mergeActivityEpisodes(current: ActivityEpisode, next: ActivityEpisode): ActivityEpisode {
  return {
    ...current,
    roomIds: sortedUniqueByFirstSeen([...current.roomIds, ...next.roomIds]),
    deviceIds: sortedUniqueByFirstSeen([...current.deviceIds, ...next.deviceIds]),
    updatedAt: next.updatedAt > current.updatedAt ? next.updatedAt : current.updatedAt,
    updatedSimTime: next.updatedSimTime > current.updatedSimTime ? next.updatedSimTime : current.updatedSimTime,
    evidenceIds: sortedUniqueByFirstSeen([...current.evidenceIds, ...next.evidenceIds]),
    semanticSignalIds: sortedUniqueByFirstSeen([...current.semanticSignalIds, ...next.semanticSignalIds]),
    profileWeight: roundWeight(current.profileWeight + next.profileWeight),
    summary: next.summary
  };
}

function latestNearbySignal(
  signals: SemanticSignal[],
  anchor: SemanticSignal,
  predicate: (signal: SemanticSignal) => boolean,
  maxMinutes: number
): SemanticSignal | null {
  return nearbySignals(signals, anchor, predicate, maxMinutes)
    .filter((signal) => signal.simTime <= anchor.simTime)
    .at(-1) ?? null;
}

function nearbySignals(
  signals: SemanticSignal[],
  anchor: SemanticSignal,
  predicate: (signal: SemanticSignal) => boolean,
  maxMinutes: number
): SemanticSignal[] {
  return signals.filter((signal) => (
    predicate(signal) &&
    absoluteMinutesBetween(signal.simTime, anchor.simTime) <= maxMinutes
  ));
}

function isBehaviorSignal(signal: SemanticSignal): boolean {
  return signal.type !== 'environment_signal' && signal.type !== 'system_signal';
}

function sortedUniqueByFirstSeen(values: string[]): string[] {
  return [...new Set(values)];
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

function updateProfilePatterns(
  patterns: HomeProfilePatterns,
  event: DeviceValueEvent,
  evidence: MemoryEvidence,
  currentField: FieldMemory | undefined
): HomeProfilePatterns {
  if (!evidence.meaningfulChange || evidence.profileWeight <= 0) {
    return patterns;
  }

  const field = normalize(event.field);
  const deviceType = normalize(event.deviceType);
  const roomId = normalize(event.roomId);
  const date = getSummaryDate(event);
  const minute = minuteOfDay(event.simTime);
  const weekend = isWeekendDate(date);
  const activated = becameActive(currentField, event.value);
  const enteredCleaning = becameMatchingValue(currentField, event.value, (value) => normalize(String(value)) === 'cleaning');
  const enteredRunning = becameMatchingValue(currentField, event.value, (value) => normalize(String(value)) === 'running');
  let next = patterns;

  const add = (id: string, gapsMinutes: number[] = []) => {
    next = addProfilePattern(next, id, evidence, date, minute, weekend, gapsMinutes);
  };

  if (deviceType.includes('lock') && field === 'locked' && event.value === false) {
    add('door-lock-unlock');
  }

  if (deviceType.includes('lock') && field === 'locked' && event.value === true && activated) {
    const lastUnlock = latestPatternEvidence(next['door-lock-unlock'], date);
    add('door-lock-lock');
    if (lastUnlock) {
      const gap = minutesBetweenSimTimes(lastUnlock.simTime, event.simTime);
      if (gap >= 0 && gap <= 15) {
        add('door-lock-paired', [gap]);
      }
    }
  }

  if (roomId.includes('kitchen') && deviceType.includes('fridge') && isContactLikeField(field) && activated) {
    if (!weekend && minute >= 6 * 60 && minute <= 7 * 60 + 45) {
      add('weekday-breakfast-fridge');
    }
    if (minute >= 18 * 60 && minute <= 20 * 60 + 30) {
      add('dinner-fridge');
    }
  }

  if (roomId.includes('kitchen') && deviceType.includes('stove') && isPowerLikeField(field) && activated) {
    add('stove-active');
    if (!weekend && minute >= 6 * 60 && minute <= 7 * 60 + 45) {
      add('weekday-breakfast-stove');
    }
    if (weekend && minute >= 8 * 60 && minute <= 13 * 60) {
      add('weekend-brunch-stove');
    }
    if (minute >= 18 * 60 && minute <= 20 * 60 + 30) {
      add('dinner-stove');
    }
    const lastHood = latestPatternEvidence(next['range-hood-on'], date);
    if (lastHood) {
      const gap = Math.abs(minutesBetweenSimTimes(lastHood.simTime, event.simTime));
      if (gap <= 5) {
        add('stove-range-hood-paired', [gap]);
      }
    }
  }

  if (deviceType.includes('rangehood') && field === 'power' && activated) {
    add('range-hood-on');
    if (minute >= 18 * 60 && minute <= 20 * 60 + 30) {
      add('dinner-range-hood');
    }
    const lastStove = latestPatternEvidence(next['stove-active'], date);
    if (lastStove) {
      const gap = Math.abs(minutesBetweenSimTimes(lastStove.simTime, event.simTime));
      if (gap <= 5) {
        add('stove-range-hood-paired', [gap]);
      }
    }
  }

  if (deviceType.includes('sleep') && isInBedField(field) && event.value === true && activated) {
    if (roomId.includes('child') && minute >= 20 * 60 + 30 && minute <= 22 * 60) {
      add('child-sleep-start');
    }
    if ((roomId.includes('master') || roomId.includes('main')) && (minute >= 22 * 60 || minute <= 60)) {
      add('main-sleep-start');
    }
  }

  if (!weekend && roomId.includes('study') && minute >= 8 * 60 && minute <= 17 * 60 && activated && isStudyWorkDeviceSignal(deviceType, field, event.value)) {
    add('study-weekday-daytime-work');
  }

  if (deviceType.includes('robotvacuum') && field === 'status' && enteredCleaning) {
    const lastLock = latestPatternEvidence(next['door-lock-lock'], date);
    if (lastLock) {
      const gap = minutesBetweenSimTimes(lastLock.simTime, event.simTime);
      if (gap >= 0 && gap <= 45) {
        add('robot-vacuum-after-departure', [gap]);
      }
    }
  }

  if (deviceType.includes('washer') && ((field === 'status' && enteredRunning) || (isPowerLikeField(field) && activated))) {
    add('laundry-running');
  }

  if (deviceType.includes('sprinkler') && field.includes('valve') && activated && minute >= 5 * 60 && minute <= 7 * 60) {
    add('garden-summer-morning-sprinkler');
  }

  if (roomId.includes('garden') && deviceType.includes('camera') && field === 'motion' && event.value === true && activated) {
    add('garden-camera-motion');
  }

  if (roomId.includes('living') && deviceType.includes('tv') && field === 'power' && activated && (minute >= 17 * 60 || weekend)) {
    add('living-evening-media');
  }

  return next;
}

function addProfilePattern(
  patterns: HomeProfilePatterns,
  id: string,
  evidence: MemoryEvidence,
  date: string,
  minute: number,
  weekend: boolean,
  gapsMinutes: number[]
): HomeProfilePatterns {
  const current = patterns[id];
  if (current?.evidence[0]?.sourceEventId === evidence.sourceEventId) {
    return patterns;
  }
  const nextPattern: HomeProfilePattern = current
    ? {
      ...current,
      count: current.count + 1,
      dates: unique([...current.dates, date]).sort((left, right) => left.localeCompare(right)),
      weekdayCount: current.weekdayCount + (weekend ? 0 : 1),
      weekendCount: current.weekendCount + (weekend ? 1 : 0),
      minutes: appendNumberBounded(current.minutes, minute, 120),
      gapsMinutes: appendManyNumbersBounded(current.gapsMinutes, gapsMinutes, 120),
      lastSimTime: evidence.simTime,
      evidence: appendBounded(current.evidence, evidence, 20)
    }
    : {
      id,
      count: 1,
      dates: [date],
      weekdayCount: weekend ? 0 : 1,
      weekendCount: weekend ? 1 : 0,
      minutes: [minute],
      gapsMinutes,
      firstSimTime: evidence.simTime,
      lastSimTime: evidence.simTime,
      evidence: [evidence]
    };

  return {
    ...patterns,
    [id]: nextPattern
  };
}

function latestPatternEvidence(pattern: HomeProfilePattern | undefined, date: string): MemoryEvidence | null {
  return pattern?.evidence.find((candidate) => getEvidenceDate(candidate) === date) ?? null;
}

function getEvidenceDate(evidence: MemoryEvidence): string {
  return /^(\d{4}-\d{2}-\d{2})T/.exec(evidence.simTime)?.[1] ?? evidence.ts.slice(0, 10);
}

function isWeekendDate(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

function minuteOfDay(simTime: string): number {
  const match = /T(\d{2}):(\d{2})/.exec(simTime);
  if (!match) {
    return 0;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesBetweenSimTimes(start: string, end: string): number {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return Number.POSITIVE_INFINITY;
  }
  return (endMs - startMs) / 60000;
}

function isContactLikeField(field: string): boolean {
  return field === 'dooropen' || field === 'contactopen' || field === 'contact' || field === 'open';
}

function isPowerLikeField(field: string): boolean {
  return field === 'power' || field === 'powerw' || field === 'wattage' || field === 'current';
}

function isInBedField(field: string): boolean {
  return field === 'inbed' || field === 'asleep' || field === 'sleeping';
}

function isStudyWorkDeviceSignal(deviceType: string, field: string, value: DeviceEventValue): boolean {
  if (!isActiveValue(value)) {
    return false;
  }
  return (
    deviceType.includes('light') ||
    deviceType.includes('router') ||
    deviceType.includes('computer') ||
    deviceType.includes('desk') ||
    field === 'online' ||
    field.includes('latency')
  );
}

function appendNumberBounded(items: number[], item: number, limit: number): number[] {
  return [item, ...items].slice(0, limit);
}

function appendManyNumbersBounded(items: number[], nextItems: number[], limit: number): number[] {
  return [...nextItems, ...items].slice(0, limit);
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

function isAccessSignal(roomId: string, deviceType: string, field: string, value: DeviceEventValue): boolean {
  if (deviceType.includes('lock') || field === 'lock') {
    return (
      (typeof value === 'string' && (normalize(value) === 'unlocked' || normalize(value) === 'open')) ||
      (field === 'locked' && value === false)
    );
  }
  return (
    isContactEpisodeField(field) &&
    isActiveValue(value) &&
    (
      normalize(roomId).includes('entrance') ||
      normalize(roomId).includes('entry') ||
      deviceType.includes('door') ||
      deviceType.includes('window') ||
      deviceType.includes('entry')
    )
  );
}

function isSleepSemanticSignal(deviceType: string, field: string, value: DeviceEventValue): boolean {
  return (
    (deviceType.includes('sleep') || field === 'inbed' || field === 'asleep' || field === 'sleeping')
    && isActiveValue(value)
  );
}

function isWaterSignal(deviceType: string, field: string, value: DeviceEventValue): boolean {
  return (
    (deviceType.includes('water') || field.includes('flow') || field.includes('valve'))
    && isActiveValue(value)
  );
}

function isCookingSignal(roomId: string, deviceType: string, field: string, value: DeviceEventValue): boolean {
  if (!isActiveValue(value)) {
    return false;
  }
  const room = normalize(roomId);
  return (
    room.includes('kitchen') ||
    deviceType.includes('stove') ||
    deviceType.includes('oven') ||
    deviceType.includes('microwave') ||
    deviceType.includes('coffee') ||
    deviceType.includes('dishwasher') ||
    deviceType.includes('kettle') ||
    deviceType.includes('cook') ||
    field.includes('cook')
  );
}

function isMediaSignal(deviceType: string, field: string, value: DeviceEventValue): boolean {
  return (
    isActiveValue(value) &&
    (
      deviceType.includes('tv') ||
      deviceType.includes('speaker') ||
      deviceType.includes('media') ||
      deviceType.includes('console') ||
      field.includes('media')
    )
  );
}

function isWorkStudySignal(roomId: string, deviceType: string, field: string, value: DeviceEventValue): boolean {
  return (
    isActiveValue(value) &&
    (
      normalize(roomId).includes('study') ||
      deviceType.includes('computer') ||
      deviceType.includes('desk') ||
      deviceType.includes('office') ||
      field.includes('work')
    )
  );
}

function isLightingSignal(deviceType: string, field: string, value: DeviceEventValue): boolean {
  return (
    isActiveValue(value) &&
    (
      deviceType.includes('light') ||
      deviceType.includes('lamp') ||
      field.includes('brightness') ||
      field === 'light' ||
      field === 'lightlevel'
    )
  );
}

function isActiveValue(value: DeviceEventValue): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value > 0;
  }
  const normalized = normalize(String(value));
  return normalized === 'on' || normalized === 'open' || normalized === 'unlocked' || normalized === 'active' || normalized === 'running' || normalized === 'true';
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

function becameActive(current: FieldMemory | undefined, nextValue: DeviceEventValue): boolean {
  return isActiveValue(nextValue) && !isActiveValue(current?.currentValue ?? null);
}

function becameMatchingValue(
  current: FieldMemory | undefined,
  nextValue: DeviceEventValue,
  matches: (value: DeviceEventValue) => boolean
): boolean {
  return matches(nextValue) && !matches(current?.currentValue ?? null);
}

function durationMinutes(startedAt: string, endedAt: string): number | undefined {
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(endedAt);

  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return undefined;
  }

  return roundWeight(Math.max(0, (endMs - startMs) / 60000));
}

function absoluteMinutesBetween(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs((rightMs - leftMs) / 60000);
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
  classification: ReturnType<typeof classifyDeviceEvidence>,
  sourceConfidence: number | undefined
): FieldChangeAnalysis {
  const confidence = sourceConfidence === undefined ? 1 : normalizeSourceConfidence(sourceConfidence);
  const weightedProfileValue = roundWeight(classification.profileWeight * confidence);
  const qualityReason = sourceConfidence === undefined
    ? ''
    : ` Source confidence ${Number(confidence.toFixed(3))} scales profile weight.`;
  if (!current) {
    return {
      meaningfulChange: true,
      profileWeight: weightedProfileValue,
      evidenceReason: `${classification.reason}${qualityReason}`
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
    profileWeight: meaningfulChange ? weightedProfileValue : 0,
    evidenceReason: meaningfulChange ? `${classification.reason}${qualityReason}` : `${classification.reason}${telemetryReason}`
  };
}

function normalizeSourceConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0, value));
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

function emptySemanticSignalCounts(): SemanticSignalCounts {
  return {
    presence_signal: 0,
    access_signal: 0,
    sleep_signal: 0,
    water_signal: 0,
    cooking_signal: 0,
    media_signal: 0,
    work_study_signal: 0,
    lighting_signal: 0,
    climate_signal: 0,
    environment_signal: 0,
    system_signal: 0
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

function appendManyBounded<T>(items: T[], nextItems: T[], limit: number): T[] {
  if (nextItems.length === 0) {
    return items;
  }
  return [[...nextItems].reverse(), items].flat().slice(0, limit);
}

function pruneSemanticSignalsForIndexedEvidence(signals: SemanticSignal[], memory: HomeMemory): SemanticSignal[] {
  const evidenceIds = new Set([
    ...memory.recentEvents,
    ...Object.values(memory.rooms).flatMap((room) => room.recentEvents),
    ...Object.values(memory.devices).flatMap((device) => device.recentEvents),
    ...Object.values(memory.fields).flatMap((field) => field.recentEvents)
  ].map((evidence) => evidence.id));

  return signals
    .map((signal) => ({
      ...signal,
      sourceEvidenceIds: signal.sourceEvidenceIds.filter((evidenceId) => evidenceIds.has(evidenceId))
    }))
    .filter((signal) => signal.sourceEvidenceIds.length > 0);
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

function incrementSemanticSignalCounts(current: SemanticSignalCounts, signals: SemanticSignal[]): SemanticSignalCounts {
  if (signals.length === 0) {
    return current;
  }

  return signals.reduce((next, signal) => ({
    ...next,
    [signal.type]: next[signal.type] + 1
  }), current);
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
