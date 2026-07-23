import type { DeviceEventValue } from './deviceEventSocket';
import type { HomeObservation, HomeObservationCapability } from './homeObservation';

export type HomeDerivedEpisodeKind =
  | 'door_access_episode'
  | 'cooking_episode'
  | 'sleep_episode'
  | 'work_study_episode'
  | 'laundry_episode'
  | 'vacuum_episode'
  | 'media_episode';

export interface HomeEpisodeFact {
  id: string;
  homeId: string;
  runId: string;
  kind: HomeDerivedEpisodeKind;
  status: 'open' | 'closed';
  roomIds: string[];
  deviceIds: string[];
  startedAt: string;
  startedSimTime: string;
  updatedAt: string;
  updatedSimTime: string;
  endedAt?: string;
  endedSimTime?: string;
  durationMinutes?: number;
  observationIds: string[];
  sourceEventIds: string[];
  evidenceIds: string[];
  lifecycle: Record<string, DeviceEventValue>;
  features: Record<string, number | string | boolean>;
}

export interface HomeDailyFeature {
  id: string;
  homeId: string;
  runId: string;
  date: string;
  observationCount: number;
  primaryMeasurementCount: number;
  lifecycleUpdateCount: number;
  meanQualityMultiplier: number;
  deviceIds: string[];
  deviceTypes: string[];
  capabilities: HomeObservationCapability[];
  observableDeviceIds: string[];
  observableDeviceTypes: string[];
  observableCapabilities: HomeObservationCapability[];
  roomIds: string[];
  episodeIdsByKind: Partial<Record<HomeDerivedEpisodeKind, string[]>>;
  supportPatternIds: string[];
  opportunityPatternIds: string[];
  anchorPatternIds: string[];
  basePatternIds: string[];
  patternEvidenceIds: Record<string, string[]>;
  patternSourceEventIds: Record<string, string[]>;
  patternSourceDeviceIds: Record<string, string[]>;
  patternOccurrenceMinutes: Record<string, number[]>;
  observableMinutesByCapability: Partial<Record<HomeObservationCapability, number[]>>;
  firstObservedAt: string;
  lastObservedAt: string;
}

export interface HomePatternCandidate {
  id: string;
  supportDays: number;
  opportunityDays: number;
  supportDates: string[];
  opportunityDates: string[];
  anchorDays: number;
  baseDays: number;
  confidence: number;
  lift: number | null;
  timeDispersionMinutes: number | null;
  sourceDiversity: number;
  contradictionCount: number;
  stabilityAcrossWeeks: number;
  evidenceIds: string[];
  firstObservedAt: string;
  lastObservedAt: string;
}

export interface HomeDerivedFeatureState {
  observationCount: number;
  latestPrimaryMeasurementsByDevice: Record<string, Record<string, DeviceEventValue>>;
  episodeFacts: Record<string, HomeEpisodeFact>;
  activeEpisodeFactIds: Record<string, string>;
  dailyFeatures: Record<string, HomeDailyFeature>;
  patternCandidates: Record<string, HomePatternCandidate>;
}

export interface HomeObservationEvidence {
  id: string;
  profileWeight: number;
}

const patternIds = [
  'door-lock-paired',
  'stove-range-hood-paired',
  'child-sleep-start',
  'study-weekday-daytime-work',
  'robot-vacuum-after-departure',
  'laundry-running',
  'living-evening-media'
] as const;

export function createHomeDerivedFeatureState(): HomeDerivedFeatureState {
  return {
    observationCount: 0,
    latestPrimaryMeasurementsByDevice: {},
    episodeFacts: {},
    activeEpisodeFactIds: {},
    dailyFeatures: {},
    patternCandidates: {}
  };
}

export function reduceHomeObservationFeatures(
  state: HomeDerivedFeatureState,
  observation: HomeObservation,
  evidence: HomeObservationEvidence[],
  refreshPatterns = true
): HomeDerivedFeatureState {
  const episodeFacts = { ...state.episodeFacts };
  const activeEpisodeFactIds = { ...state.activeEpisodeFactIds };
  let daily = updateDailyFeature(
    state.dailyFeatures[observation.simTime.slice(0, 10)],
    observation
  );
  const context: ObservationReductionContext = {
    observation,
    evidence,
    previousPrimaryMeasurements: state.latestPrimaryMeasurementsByDevice[observation.deviceId] ?? {},
    episodeFacts,
    activeEpisodeFactIds,
    daily
  };

  updateLifecycleOnActiveFacts(context);
  reduceDoorObservation(context);
  reduceSleepObservation(context);
  reduceCookingObservation(context);
  reduceWorkObservation(context);
  reduceLaundryObservation(context);
  reduceVacuumObservation(context);
  reduceMediaObservation(context);
  daily = refreshDailyOpportunities(context.daily);

  const dailyFeatures = {
    ...state.dailyFeatures,
    [daily.date]: daily
  };
  return {
    observationCount: state.observationCount + 1,
    latestPrimaryMeasurementsByDevice: {
      ...state.latestPrimaryMeasurementsByDevice,
      [observation.deviceId]: {
        ...(state.latestPrimaryMeasurementsByDevice[observation.deviceId] ?? {}),
        ...observation.primaryMeasurements
      }
    },
    episodeFacts,
    activeEpisodeFactIds,
    dailyFeatures,
    patternCandidates: refreshPatterns
      ? createPatternCandidates(dailyFeatures)
      : state.patternCandidates
  };
}

export function refreshHomePatternCandidates(
  state: HomeDerivedFeatureState
): Record<string, HomePatternCandidate> {
  return createPatternCandidates(state.dailyFeatures);
}

interface ObservationReductionContext {
  observation: HomeObservation;
  evidence: HomeObservationEvidence[];
  previousPrimaryMeasurements: Record<string, DeviceEventValue>;
  episodeFacts: Record<string, HomeEpisodeFact>;
  activeEpisodeFactIds: Record<string, string>;
  daily: HomeDailyFeature;
}

function reduceDoorObservation(context: ObservationReductionContext): void {
  if (!context.observation.context.capabilities.includes('access')) {
    return;
  }
  const locked = measurement(context.observation, 'locked', 'lock');
  const unlocked = locked === false || normalize(String(locked)) === 'unlocked';
  const relocked = locked === true || normalize(String(locked)) === 'locked';
  const activeKey = `door:${context.observation.deviceId}`;
  if (unlocked) {
    const fact = openEpisode(context, activeKey, 'door_access_episode', {
      hasUnlock: true,
      hasLock: false
    });
    context.daily = addPatternMarker(context.daily, 'anchor', 'door-lock-paired', context);
    context.episodeFacts[fact.id] = fact;
  } else if (relocked) {
    const fact = closeEpisode(context, activeKey, { hasLock: true });
    context.daily = addPatternMarker(context.daily, 'base', 'door-lock-paired', context);
    if (fact && minutesBetween(fact.startedSimTime, context.observation.simTime) <= 20) {
      context.daily = addPatternMarker(
        context.daily,
        'support',
        'door-lock-paired',
        context,
        fact
      );
    }
  }
}

function reduceSleepObservation(context: ObservationReductionContext): void {
  if (!context.observation.context.capabilities.includes('sleep')) {
    return;
  }
  const inBed = measurement(context.observation, 'inbed', 'asleep', 'sleeping');
  const activeKey = `sleep:${context.observation.deviceId}`;
  if (inBed === true) {
    openEpisode(context, activeKey, 'sleep_episode', {
      sleepRoom: context.observation.roomId,
      sleepDevice: context.observation.deviceId
    });
    const minute = minuteOfDay(context.observation.simTime);
    if (minute >= 20 * 60 + 30 && minute <= 22 * 60) {
      context.daily = addPatternMarker(
        addPatternMarker(context.daily, 'anchor', 'child-sleep-start', context),
        'support',
        'child-sleep-start',
        context
      );
    }
  } else if (inBed === false) {
    closeEpisode(context, activeKey);
  }
}

function reduceCookingObservation(context: ObservationReductionContext): void {
  if (!context.observation.context.capabilities.includes('cooking')) {
    return;
  }
  const deviceType = normalize(context.observation.deviceType);
  const isStove = deviceType.includes('stove') || deviceType.includes('cooktop');
  const isHood = deviceType.includes('rangehood') || deviceType.includes('hood');
  const active = observationIsActive(context.observation);
  const inactive = observationIsExplicitlyInactive(context.observation);
  const activeKey = `cooking:${context.observation.roomId}`;
  const hasOpenEpisode = Boolean(context.activeEpisodeFactIds[activeKey]);

  if (
    active &&
    (isStove || isHood) &&
    (hasOpenEpisode || observationBecameActive(context))
  ) {
    const fact = openEpisode(context, activeKey, 'cooking_episode', {
      ...(isStove
        ? {
            hasStove: true,
            stoveStartedAt: context.observation.simTime
          }
        : {}),
      ...(isHood
        ? {
            hasRangeHood: true,
            rangeHoodStartedAt: context.observation.simTime
          }
        : {})
    });
    if (isStove) {
      context.daily = addPatternMarker(context.daily, 'anchor', 'stove-range-hood-paired', context);
    }
    if (isHood) {
      context.daily = addPatternMarker(context.daily, 'base', 'stove-range-hood-paired', context);
    }
    const stoveStartedAt = stringFeature(fact, 'stoveStartedAt');
    const hoodStartedAt = stringFeature(fact, 'rangeHoodStartedAt');
    if (
      fact.features.hasStove === true &&
      fact.features.hasRangeHood === true &&
      stoveStartedAt &&
      hoodStartedAt &&
      absoluteMinutesBetween(stoveStartedAt, hoodStartedAt) <= 5
    ) {
      context.daily = addPatternMarker(
        context.daily,
        'support',
        'stove-range-hood-paired',
        context,
        fact
      );
    }
  } else if (inactive && isStove) {
    closeEpisode(context, activeKey);
  }
}

function reduceWorkObservation(context: ObservationReductionContext): void {
  if (
    (
      !context.observation.context.capabilities.includes('work_study') &&
      !context.observation.context.roomRoles.includes('work')
    ) ||
    !isWorkActivityObservation(context.observation) ||
    isWeekend(context.observation.simTime)
  ) {
    return;
  }
  const minute = minuteOfDay(context.observation.simTime);
  if (minute < 8 * 60 || minute > 17 * 60) {
    return;
  }
  const date = context.observation.simTime.slice(0, 10);
  const id = `episode-fact:work_study_episode:${date}:${context.observation.roomId}`;
  const existing = context.episodeFacts[id];
  context.episodeFacts[id] = existing
    ? updateFact(
        existing,
        context,
        {},
        !existing.deviceIds.includes(context.observation.deviceId)
      )
    : createFact(context, id, 'work_study_episode', 'closed', {
        activity: 'work_study',
        weekday: true
      });
  context.daily = addEpisodeToDaily(context.daily, context.episodeFacts[id]);
  context.daily = addPatternMarker(
    addPatternMarker(context.daily, 'anchor', 'study-weekday-daytime-work', context),
    'support',
    'study-weekday-daytime-work',
    context
  );
}

function reduceLaundryObservation(context: ObservationReductionContext): void {
  if (!context.observation.context.capabilities.includes('laundry')) {
    return;
  }
  const activeKey = `laundry:${context.observation.deviceId}`;
  const active = observationMatchesState(context.observation, ['running', 'washing']) ||
    activePower(context.observation);
  if (
    active &&
    (
      Boolean(context.activeEpisodeFactIds[activeKey]) ||
      observationBecameActive(context)
    )
  ) {
    openEpisode(context, activeKey, 'laundry_episode', { activity: 'laundry' });
    context.daily = addPatternMarker(
      addPatternMarker(context.daily, 'anchor', 'laundry-running', context),
      'support',
      'laundry-running',
      context
    );
  } else if (
    observationMatchesState(context.observation, ['idle', 'done', 'off', 'waitingunload']) ||
    observationIsExplicitlyInactive(context.observation)
  ) {
    closeEpisode(context, activeKey);
  }
}

function reduceVacuumObservation(context: ObservationReductionContext): void {
  if (!context.observation.context.capabilities.includes('vacuum')) {
    return;
  }
  const activeKey = `vacuum:${context.observation.deviceId}`;
  if (observationMatchesState(context.observation, ['cleaning'])) {
    openEpisode(context, activeKey, 'vacuum_episode', { activity: 'vacuum' });
    context.daily = addPatternMarker(context.daily, 'anchor', 'robot-vacuum-after-departure', context);
    if (hasRecentDoorEpisode(context)) {
      context.daily = addPatternMarker(
        context.daily,
        'support',
        'robot-vacuum-after-departure',
        context
      );
    }
  } else if (observationMatchesState(context.observation, ['docked', 'idle', 'charging'])) {
    closeEpisode(context, activeKey);
  }
}

function reduceMediaObservation(context: ObservationReductionContext): void {
  if (!context.observation.context.capabilities.includes('media')) {
    return;
  }
  const power = measurement(context.observation, 'power', 'powered', 'ison', 'status');
  if (power === undefined) {
    return;
  }
  const activeKey = `media:${context.observation.deviceId}`;
  if (isActiveValue(power)) {
    openEpisode(context, activeKey, 'media_episode', { activity: 'media' });
    const minute = minuteOfDay(context.observation.simTime);
    if (minute >= 17 * 60 || isWeekend(context.observation.simTime)) {
      context.daily = addPatternMarker(
        addPatternMarker(context.daily, 'anchor', 'living-evening-media', context),
        'support',
        'living-evening-media',
        context
      );
    }
  } else if (isInactiveValue(power)) {
    closeEpisode(context, activeKey);
  }
}

function openEpisode(
  context: ObservationReductionContext,
  activeKey: string,
  kind: HomeDerivedEpisodeKind,
  features: Record<string, number | string | boolean>
): HomeEpisodeFact {
  const activeId = context.activeEpisodeFactIds[activeKey];
  const existing = activeId ? context.episodeFacts[activeId] : undefined;
  const mergedFeatures = existing
    ? { ...features, ...existing.features }
    : features;
  const fact = existing
    ? updateFact(
        existing,
        context,
        mergedFeatures,
        !existing.deviceIds.includes(context.observation.deviceId) ||
          Object.keys(mergedFeatures).some((key) => existing.features[key] === undefined)
      )
    : createFact(
        context,
        `episode-fact:${kind}:${context.observation.sourceEventId}`,
        kind,
        'open',
        features
      );
  context.episodeFacts[fact.id] = fact;
  context.activeEpisodeFactIds[activeKey] = fact.id;
  context.daily = addEpisodeToDaily(context.daily, fact);
  return fact;
}

function closeEpisode(
  context: ObservationReductionContext,
  activeKey: string,
  features: Record<string, number | string | boolean> = {}
): HomeEpisodeFact | null {
  const activeId = context.activeEpisodeFactIds[activeKey];
  const existing = activeId ? context.episodeFacts[activeId] : undefined;
  if (!existing) {
    return null;
  }
  const updated = updateFact(existing, context, features);
  const fact: HomeEpisodeFact = {
    ...updated,
    status: 'closed',
    endedAt: context.observation.ts,
    endedSimTime: context.observation.simTime,
    durationMinutes: round(Math.max(
      0,
      minutesBetween(existing.startedSimTime, context.observation.simTime)
    ))
  };
  context.episodeFacts[fact.id] = fact;
  delete context.activeEpisodeFactIds[activeKey];
  context.daily = addEpisodeToDaily(context.daily, fact);
  return fact;
}

function createFact(
  context: ObservationReductionContext,
  id: string,
  kind: HomeDerivedEpisodeKind,
  status: HomeEpisodeFact['status'],
  features: Record<string, number | string | boolean>
): HomeEpisodeFact {
  return {
    id,
    homeId: context.observation.homeId,
    runId: context.observation.runId,
    kind,
    status,
    roomIds: [context.observation.roomId],
    deviceIds: [context.observation.deviceId],
    startedAt: context.observation.ts,
    startedSimTime: context.observation.simTime,
    updatedAt: context.observation.ts,
    updatedSimTime: context.observation.simTime,
    observationIds: [context.observation.id],
    sourceEventIds: [context.observation.sourceEventId],
    evidenceIds: meaningfulEvidenceIds(context),
    lifecycle: { ...context.observation.lifecycle },
    features
  };
}

function updateFact(
  fact: HomeEpisodeFact,
  context: ObservationReductionContext,
  features: Record<string, number | string | boolean> = {},
  includeEvidence = true
): HomeEpisodeFact {
  return {
    ...fact,
    roomIds: sortedUnique([...fact.roomIds, context.observation.roomId]),
    deviceIds: sortedUnique([...fact.deviceIds, context.observation.deviceId]),
    updatedAt: context.observation.ts,
    updatedSimTime: context.observation.simTime,
    observationIds: sortedUnique([...fact.observationIds, context.observation.id]),
    sourceEventIds: sortedUnique([...fact.sourceEventIds, context.observation.sourceEventId]),
    evidenceIds: includeEvidence
      ? sortedUnique([...fact.evidenceIds, ...meaningfulEvidenceIds(context)])
      : fact.evidenceIds,
    lifecycle: {
      ...fact.lifecycle,
      ...context.observation.lifecycle
    },
    features: {
      ...fact.features,
      ...features
    }
  };
}

function updateLifecycleOnActiveFacts(context: ObservationReductionContext): void {
  if (Object.keys(context.observation.lifecycle).length === 0) {
    return;
  }
  for (const [activeKey, factId] of Object.entries(context.activeEpisodeFactIds)) {
    const fact = context.episodeFacts[factId];
    if (
      fact &&
      fact.deviceIds.includes(context.observation.deviceId)
    ) {
      context.episodeFacts[factId] = updateFact(fact, context, {}, false);
    }
  }
}

function updateDailyFeature(
  current: HomeDailyFeature | undefined,
  observation: HomeObservation
): HomeDailyFeature {
  const date = observation.simTime.slice(0, 10);
  const observable = isObservableObservation(observation);
  if (!current) {
    return {
      id: `${observation.runId}:${date}`,
      homeId: observation.homeId,
      runId: observation.runId,
      date,
      observationCount: 1,
      primaryMeasurementCount: Object.keys(observation.primaryMeasurements).length,
      lifecycleUpdateCount: Object.keys(observation.lifecycle).length,
      meanQualityMultiplier: observation.qualityMultiplier,
      deviceIds: [observation.deviceId],
      deviceTypes: [observation.deviceType],
      capabilities: [...observation.context.capabilities],
      observableDeviceIds: observable ? [observation.deviceId] : [],
      observableDeviceTypes: observable ? [observation.deviceType] : [],
      observableCapabilities: observable ? [...observation.context.capabilities] : [],
      roomIds: [observation.roomId],
      episodeIdsByKind: {},
      supportPatternIds: [],
      opportunityPatternIds: [],
      anchorPatternIds: [],
      basePatternIds: [],
      patternEvidenceIds: {},
      patternSourceEventIds: {},
      patternSourceDeviceIds: {},
      patternOccurrenceMinutes: {},
      observableMinutesByCapability: observable
        ? Object.fromEntries(observation.context.capabilities.map((capability) => [
            capability,
            [minuteOfDay(observation.simTime)]
          ]))
        : {},
      firstObservedAt: observation.simTime,
      lastObservedAt: observation.simTime
    };
  }
  return {
    ...current,
    observationCount: current.observationCount + 1,
    primaryMeasurementCount: current.primaryMeasurementCount +
      Object.keys(observation.primaryMeasurements).length,
    lifecycleUpdateCount: current.lifecycleUpdateCount +
      Object.keys(observation.lifecycle).length,
    meanQualityMultiplier: round((
      current.meanQualityMultiplier * current.observationCount +
      observation.qualityMultiplier
    ) / (current.observationCount + 1)),
    deviceIds: sortedUnique([...current.deviceIds, observation.deviceId]),
    deviceTypes: sortedUnique([...current.deviceTypes, observation.deviceType]),
    capabilities: sortedUnique([
      ...current.capabilities,
      ...observation.context.capabilities
    ]),
    observableDeviceIds: observable
      ? sortedUnique([...current.observableDeviceIds, observation.deviceId])
      : current.observableDeviceIds,
    observableDeviceTypes: observable
      ? sortedUnique([...current.observableDeviceTypes, observation.deviceType])
      : current.observableDeviceTypes,
    observableCapabilities: observable
      ? sortedUnique([
          ...current.observableCapabilities,
          ...observation.context.capabilities
        ])
      : current.observableCapabilities,
    observableMinutesByCapability: observable
      ? mergeObservableMinutes(current.observableMinutesByCapability, observation)
      : current.observableMinutesByCapability,
    roomIds: sortedUnique([...current.roomIds, observation.roomId]),
    lastObservedAt: observation.simTime
  };
}

function addEpisodeToDaily(
  daily: HomeDailyFeature,
  fact: HomeEpisodeFact
): HomeDailyFeature {
  return {
    ...daily,
    episodeIdsByKind: {
      ...daily.episodeIdsByKind,
      [fact.kind]: sortedUnique([
        ...(daily.episodeIdsByKind[fact.kind] ?? []),
        fact.id
      ])
    }
  };
}

function addPatternMarker(
  daily: HomeDailyFeature,
  marker: 'support' | 'anchor' | 'base',
  patternId: string,
  context: ObservationReductionContext,
  fact?: HomeEpisodeFact
): HomeDailyFeature {
  const listKey = marker === 'support'
    ? 'supportPatternIds'
    : marker === 'anchor'
      ? 'anchorPatternIds'
      : 'basePatternIds';
  return {
    ...daily,
    [listKey]: sortedUnique([...daily[listKey], patternId]),
    patternEvidenceIds: marker === 'support'
      ? {
          ...daily.patternEvidenceIds,
          [patternId]: sortedUnique([
            ...(daily.patternEvidenceIds[patternId] ?? []),
            ...(fact?.evidenceIds ?? context.evidence.map((item) => item.id))
          ])
        }
      : daily.patternEvidenceIds,
    patternSourceEventIds: marker === 'support'
      ? {
          ...daily.patternSourceEventIds,
          [patternId]: sortedUnique([
            ...(daily.patternSourceEventIds[patternId] ?? []),
            ...(fact?.sourceEventIds ?? [context.observation.sourceEventId])
          ])
        }
      : daily.patternSourceEventIds,
    patternSourceDeviceIds: marker === 'support'
      ? {
          ...daily.patternSourceDeviceIds,
          [patternId]: sortedUnique([
            ...(daily.patternSourceDeviceIds[patternId] ?? []),
            ...(fact?.deviceIds ?? [context.observation.deviceId])
          ])
        }
      : daily.patternSourceDeviceIds,
    patternOccurrenceMinutes: marker === 'support'
      ? {
          ...daily.patternOccurrenceMinutes,
          [patternId]: sortedUniqueNumbers([
            ...(daily.patternOccurrenceMinutes[patternId] ?? []),
            minuteOfDay(context.observation.simTime)
          ])
        }
      : daily.patternOccurrenceMinutes
  };
}

function refreshDailyOpportunities(daily: HomeDailyFeature): HomeDailyFeature {
  const capabilities = new Set(daily.observableCapabilities);
  const deviceTypes = daily.observableDeviceTypes.map(normalize);
  const opportunities = new Set(daily.opportunityPatternIds);
  if (capabilities.has('access') && daily.anchorPatternIds.includes('door-lock-paired')) {
    opportunities.add('door-lock-paired');
  }
  if (
    daily.anchorPatternIds.includes('stove-range-hood-paired') &&
    deviceTypes.some((type) => type.includes('stove') || type.includes('cooktop')) &&
    deviceTypes.some((type) => type.includes('rangehood') || type.includes('hood'))
  ) {
    opportunities.add('stove-range-hood-paired');
  }
  if (
    observableMinutes(daily, 'sleep')
      .some((minute) => minute >= 20 * 60 && minute <= 23 * 60)
  ) {
    opportunities.add('child-sleep-start');
  }
  if (
    (
      capabilities.has('work_study') ||
      daily.anchorPatternIds.includes('study-weekday-daytime-work')
    ) &&
    (
      daily.anchorPatternIds.includes('study-weekday-daytime-work') ||
      observableMinutes(daily, 'work_study')
        .some((minute) => minute >= 8 * 60 && minute <= 17 * 60)
    ) &&
    !isWeekendDate(daily.date)
  ) {
    opportunities.add('study-weekday-daytime-work');
  }
  if (capabilities.has('vacuum')) opportunities.add('robot-vacuum-after-departure');
  if (capabilities.has('laundry')) opportunities.add('laundry-running');
  if (capabilities.has('media')) opportunities.add('living-evening-media');
  return {
    ...daily,
    opportunityPatternIds: [...opportunities].sort((left, right) => left.localeCompare(right))
  };
}

function createPatternCandidates(
  dailyFeatures: Record<string, HomeDailyFeature>
): Record<string, HomePatternCandidate> {
  const days = Object.values(dailyFeatures).sort((left, right) => (
    left.date.localeCompare(right.date)
  ));
  return Object.fromEntries(patternIds.flatMap((id) => {
    const supportDays = days.filter((day) => day.supportPatternIds.includes(id));
    const opportunityDays = days.filter((day) => day.opportunityPatternIds.includes(id));
    const anchorDays = days.filter((day) => day.anchorPatternIds.includes(id));
    const baseDays = days.filter((day) => day.basePatternIds.includes(id));
    if (
      supportDays.length === 0 &&
      opportunityDays.length === 0 &&
      anchorDays.length === 0
    ) {
      return [];
    }
    const evidenceIds = sortedUnique(supportDays.flatMap((day) => (
      day.patternEvidenceIds[id] ?? []
    )));
    const sourceDeviceIds = sortedUnique(supportDays.flatMap((day) => (
      day.patternSourceDeviceIds[id] ?? []
    )));
    const occurrenceMinutes = supportDays.flatMap((day) => (
      day.patternOccurrenceMinutes[id] ?? []
    ));
    const opportunityCount = opportunityDays.length;
    const confidence = opportunityCount > 0
      ? supportDays.length / opportunityCount
      : 0;
    const conditionalProbability = opportunityCount > 0
      ? supportDays.length / opportunityCount
      : 0;
    const baseProbability = opportunityCount > 0
      ? baseDays.length / baseOpportunityCount(id, days)
      : 0;
    const observedDates = sortedUnique([
      ...supportDays.map((day) => day.date),
      ...opportunityDays.map((day) => day.date),
      ...anchorDays.map((day) => day.date)
    ]);
    return [[id, {
      id,
      supportDays: supportDays.length,
      opportunityDays: opportunityCount,
      supportDates: supportDays.map((day) => day.date),
      opportunityDates: opportunityDays.map((day) => day.date),
      anchorDays: anchorDays.length,
      baseDays: baseDays.length,
      confidence: round(confidence),
      lift: baseProbability > 0 ? round(conditionalProbability / baseProbability) : null,
      timeDispersionMinutes: occurrenceMinutes.length > 0
        ? round(standardDeviation(occurrenceMinutes))
        : null,
      sourceDiversity: sourceDeviceIds.length,
      contradictionCount: Math.max(0, opportunityDays.length - supportDays.length),
      stabilityAcrossWeeks: weeklyStability(opportunityDays, supportDays),
      evidenceIds,
      firstObservedAt: observedDates[0] ?? '',
      lastObservedAt: observedDates.at(-1) ?? ''
    } satisfies HomePatternCandidate]];
  }));
}

function hasRecentDoorEpisode(context: ObservationReductionContext): boolean {
  return Object.values(context.episodeFacts).some((fact) => (
    fact.kind === 'door_access_episode' &&
    fact.status === 'closed' &&
    fact.endedSimTime !== undefined &&
    minutesBetween(fact.endedSimTime, context.observation.simTime) >= 0 &&
    minutesBetween(fact.endedSimTime, context.observation.simTime) <= 45
  ));
}

function observationIsActive(observation: HomeObservation): boolean {
  return Object.values(observation.primaryMeasurements).some(isActiveValue);
}

function observationBecameActive(context: ObservationReductionContext): boolean {
  const previous = normalizedRecord(context.previousPrimaryMeasurements);
  return Object.entries(context.observation.primaryMeasurements).some(([field, value]) => (
    isActiveValue(value) &&
    !isActiveValue(previous[normalize(field)])
  ));
}

function isObservableObservation(observation: HomeObservation): boolean {
  const quality = normalizedRecord(observation.quality);
  const lifecycle = normalizedRecord(observation.lifecycle);
  if (quality.dropped === true || quality.sampledropped === true) {
    return false;
  }
  return Object.keys(observation.primaryMeasurements).length > 0 || lifecycle.online === true;
}

function baseOpportunityCount(
  patternId: string,
  days: HomeDailyFeature[]
): number {
  if (patternId === 'stove-range-hood-paired') {
    return Math.max(1, days.filter((day) => (
      day.observableDeviceTypes.some((type) => {
        const normalized = normalize(type);
        return normalized.includes('rangehood') || normalized.includes('hood');
      })
    )).length);
  }
  if (patternId === 'door-lock-paired') {
    return Math.max(1, days.filter((day) => (
      day.observableCapabilities.includes('access')
    )).length);
  }
  return Math.max(1, days.filter((day) => (
    day.opportunityPatternIds.includes(patternId)
  )).length);
}

function observationIsExplicitlyInactive(observation: HomeObservation): boolean {
  const values = Object.values(observation.primaryMeasurements);
  return values.length > 0 && values.every(isInactiveValue);
}

function activePower(observation: HomeObservation): boolean {
  return Object.entries(observation.primaryMeasurements).some(([field, value]) => (
    ['powerw', 'wattage', 'current'].includes(normalize(field)) &&
    typeof value === 'number' &&
    value > 5
  ));
}

function isWorkActivityObservation(observation: HomeObservation): boolean {
  const deviceType = normalize(observation.deviceType);
  if (observation.context.capabilities.includes('work_study')) {
    return observationIsActive(observation);
  }
  if (!observation.context.roomRoles.includes('work')) {
    return false;
  }
  if (deviceType.includes('light')) {
    const power = measurement(observation, 'power', 'powered', 'ison');
    return power !== undefined && isActiveValue(power);
  }
  if (deviceType.includes('plug')) {
    return activePower(observation) ||
      observationMatchesState(observation, ['on', 'active']);
  }
  return false;
}

function observationMatchesState(
  observation: HomeObservation,
  states: string[]
): boolean {
  return Object.values(observation.primaryMeasurements).some((value) => (
    states.includes(normalize(String(value)))
  ));
}

function measurement(
  observation: HomeObservation,
  ...normalizedFields: string[]
): DeviceEventValue | undefined {
  return Object.entries(observation.primaryMeasurements)
    .find(([field]) => normalizedFields.includes(normalize(field)))
    ?.[1];
}

function normalizedRecord(
  values: Record<string, DeviceEventValue>
): Record<string, DeviceEventValue> {
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [
    normalize(field),
    value
  ]));
}

function meaningfulEvidenceIds(context: ObservationReductionContext): string[] {
  return context.evidence
    .filter((item) => item.profileWeight > 0)
    .map((item) => item.id);
}

function mergeObservableMinutes(
  current: HomeDailyFeature['observableMinutesByCapability'],
  observation: HomeObservation
): HomeDailyFeature['observableMinutesByCapability'] {
  const minute = minuteOfDay(observation.simTime);
  return observation.context.capabilities.reduce((next, capability) => ({
    ...next,
    [capability]: sortedUniqueNumbers([
      ...(next[capability] ?? []),
      minute
    ])
  }), { ...current });
}

function observableMinutes(
  daily: HomeDailyFeature,
  capability: HomeObservationCapability
): number[] {
  return daily.observableMinutesByCapability[capability] ?? [];
}

function stringFeature(fact: HomeEpisodeFact, key: string): string | null {
  const value = fact.features[key];
  return typeof value === 'string' ? value : null;
}

function isActiveValue(value: DeviceEventValue): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  return ['on', 'open', 'unlocked', 'active', 'running', 'cleaning', 'true', 'watching']
    .includes(normalize(String(value)));
}

function isInactiveValue(value: DeviceEventValue): boolean {
  if (typeof value === 'boolean') return !value;
  if (typeof value === 'number') return value === 0;
  return ['off', 'closed', 'locked', 'idle', 'docked', 'charging', 'done', 'false']
    .includes(normalize(String(value)));
}

function weeklyStability(
  opportunityDays: HomeDailyFeature[],
  supportDays: HomeDailyFeature[]
): number {
  const supportDates = new Set(supportDays.map((day) => day.date));
  const byWeek = new Map<string, string[]>();
  for (const day of opportunityDays) {
    const week = isoWeek(day.date);
    byWeek.set(week, [...(byWeek.get(week) ?? []), day.date]);
  }
  const rates = [...byWeek.values()].map((dates) => (
    dates.filter((date) => supportDates.has(date)).length / dates.length
  ));
  if (rates.length <= 1) {
    return rates.length === 1 ? 1 : 0;
  }
  return round(Math.max(0, 1 - standardDeviation(rates)));
}

function isoWeek(dateText: string): string {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function standardDeviation(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }
  const average = values.reduce((total, value) => total + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length
  );
}

function minuteOfDay(simTime: string): number {
  const match = /T(\d{2}):(\d{2})/.exec(simTime);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function isWeekend(simTime: string): boolean {
  return isWeekendDate(simTime.slice(0, 10));
}

function isWeekendDate(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

function minutesBetween(start: string, end: string): number {
  return (Date.parse(end) - Date.parse(start)) / 60000;
}

function absoluteMinutesBetween(left: string, right: string): number {
  return Math.abs(minutesBetween(left, right));
}

function sortedUnique<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sortedUniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function normalize(value: string): string {
  return value.replace(/[_\s-]+/g, '').toLowerCase();
}
