import { estimateHouseholdSizeFromMemory } from './homeHouseholdSizeEstimator';
import type { HomeMemory, MemoryEpisode, MemoryEvidence, RoomMemory, SemanticSignal, TimeBucket } from './homeMemoryModel';

export type ProfileHypothesisType =
  | 'household_size'
  | 'daily_rhythm'
  | 'room_habit'
  | 'device_routine'
  | 'presence_signal'
  | 'activity_cluster'
  | 'routine_window'
  | 'behavior_flow'
  | 'resident_slot'
  | 'room_function'
  | 'device_contribution'
  | 'state_anomaly';

export interface ProfileHypothesis {
  id: string;
  type: ProfileHypothesisType;
  label: string;
  summary: string;
  confidence: number;
  updatedAt: string;
  subjectIds: string[];
  evidence: MemoryEvidence[];
  supportingEvidence: MemoryEvidence[];
  contradictingEvidence: MemoryEvidence[];
  missingEvidence: string[];
}

const TIME_BUCKETS: TimeBucket[] = ['morning', 'daytime', 'evening', 'night'];
type ProfileHypothesisInput = Omit<ProfileHypothesis, 'updatedAt' | 'supportingEvidence' | 'contradictingEvidence' | 'missingEvidence'> & Partial<Pick<ProfileHypothesis, 'supportingEvidence' | 'contradictingEvidence' | 'missingEvidence'>>;

export function createHomeProfileHypotheses(memory: HomeMemory): ProfileHypothesis[] {
  if (memory.totalEvents === 0 || memory.recentEvents.length === 0) {
    return [];
  }

  const activeRooms = sortedRooms(memory);

  return [
    ...createDailyRhythms(memory),
    ...activeRooms.map((room) => createRoomHabit(room, memory)),
    ...activeRooms
      .filter((room) => room.devices.length >= 2 && room.eventCount >= 3)
      .map((room) => createDeviceRoutine(room, memory.totalEvents)),
    ...createActivityClusters(memory),
    ...createRoutineWindows(memory),
    ...createBehaviorFlows(memory),
    ...createRoomFunctions(memory),
    ...createResidentSlots(memory),
    ...createDeviceContributionHypotheses(memory),
    ...createStateAnomalies(memory),
    createPresenceSignal(memory),
    ...(activeRooms.length > 0 ? [createHouseholdSize(memory, activeRooms)] : [])
  ];
}

function createDailyRhythms(memory: HomeMemory): ProfileHypothesis[] {
  const dailySummaries = sortedDailySummaries(memory);
  const weeklySummaries = sortedWeeklySummaries(memory);
  const observedDayCount = dailySummaries.length;
  const observedWeekCount = weeklySummaries.length;

  return TIME_BUCKETS
    .filter((bucket) => memory.recentEvents.some((event) => event.timeBucket === bucket))
    .map((bucket) => {
      const evidence = memory.recentEvents.filter((event) => event.timeBucket === bucket);
      const rooms = sortedUnique(evidence.map((event) => event.roomId));
      const eventCount = evidence.length;
      const evidenceWeight = weightOf(evidence);
      const matchingDayCount = dailySummaries.filter((summary) => summary.timeBuckets[bucket] > 0).length;
      const multiWeekSignal = observedWeekCount > 1 ? observedWeekCount : 0;

      return hypothesis({
        id: `rhythm:${bucket}`,
        type: 'daily_rhythm',
        label: `${titleCase(bucket)} activity rhythm`,
        summary: `${eventCount} recent ${bucket} event${plural(eventCount)} across ${formatList(rooms)}, weighted ${formatWeight(evidenceWeight)} for profile inference, with ${matchingDayCount} day-level ${matchWord(matchingDayCount)} across ${observedDayCount} observed day${plural(observedDayCount)} and ${observedWeekCount} observed week${plural(observedWeekCount)}.`,
        confidence: confidenceFromCount(evidenceWeight + matchingDayCount + multiWeekSignal, memory.profileEvidenceWeight + observedDayCount + multiWeekSignal, 0.9, behaviorSampleSize(evidenceWeight, matchingDayCount + multiWeekSignal)),
        subjectIds: toRoomSubjectIds(rooms),
        evidence
      });
    });
}

function createRoomHabit(room: RoomMemory, memory: HomeMemory): ProfileHypothesis {
  const strongestBucket = strongestTimeBucket(room.timeBuckets);
  const devices = sortedUnique(room.devices);
  const episodes = behaviorEpisodesForRoom(memory, room.roomId);
  const episodeCount = episodes.length;
  const profileSignal = room.profileEvidenceWeight + episodeCount;
  const totalSignal = memory.profileEvidenceWeight + memory.episodeCount;

  return hypothesis({
    id: `room:${room.roomId}:habit`,
    type: 'room_habit',
    label: `${titleCase(room.roomId)} habit`,
    summary: `${room.roomId} activity is strongest during ${strongestBucket}, based on ${room.eventCount} event${plural(room.eventCount)}, ${formatWeight(room.profileEvidenceWeight)} weighted profile evidence, and ${episodeCount} behavior episode${plural(episodeCount)}.`,
    confidence: confidenceFromCount(profileSignal, totalSignal, 0.85, behaviorSampleSize(room.profileEvidenceWeight, episodeCount)),
    subjectIds: [`room:${room.roomId}`, ...toDeviceSubjectIds(devices)],
    evidence: room.recentEvents
  });
}

function createDeviceRoutine(room: RoomMemory, totalEvents: number): ProfileHypothesis {
  const devices = sortedUnique(room.devices);
  const strongestBucket = strongestTimeBucket(room.timeBuckets);

  return hypothesis({
    id: `room:${room.roomId}:device-routine`,
    type: 'device_routine',
    label: `${titleCase(room.roomId)} device routine`,
    summary: `${devices.length} devices in ${room.roomId} show multi-device activity, strongest during ${strongestBucket}.`,
    confidence: confidenceFromCount(room.profileEvidenceWeight + devices.length, totalEvents + devices.length, 0.8, room.profileEvidenceWeight),
    subjectIds: [`room:${room.roomId}`, ...toDeviceSubjectIds(devices)],
    evidence: room.recentEvents
  });
}

function createActivityClusters(memory: HomeMemory): ProfileHypothesis[] {
  const hypotheses: ProfileHypothesis[] = [
    ...createRoomActivityClusters(memory),
    ...createEntryReturnClusters(memory)
  ];

  return hypotheses.sort((left, right) => left.id.localeCompare(right.id));
}

function createRoomActivityClusters(memory: HomeMemory): ProfileHypothesis[] {
  const signalsByRoom = groupSignalsByRoom(memory.semanticSignals.filter((signal) => signal.type !== 'environment_signal' && signal.type !== 'system_signal'));
  const hypotheses: ProfileHypothesis[] = [];

  for (const [roomId, signals] of signalsByRoom) {
    if (signals.some((signal) => signal.type === 'cooking_signal') && hasMealActivitySupport(signals)) {
      hypotheses.push(createActivityClusterHypothesis(memory, {
        id: `activity:meal:${roomId}`,
        label: `${titleCase(roomId)} meal activity`,
        summary: `${roomId} shows meal activity around ${strongestSignalBucket(signals)}, supported by ${describeSignalTypes(signals)}.`,
        roomIds: [roomId],
        signals,
        baseConfidence: 0.42
      }));
    }

    if (signals.some((signal) => signal.type === 'water_signal') && isBathroomLikeRoom(roomId)) {
      hypotheses.push(createActivityClusterHypothesis(memory, {
        id: `activity:hygiene:${roomId}`,
        label: `${titleCase(roomId)} hygiene activity`,
        summary: `${roomId} shows hygiene activity around ${strongestSignalBucket(signals)}, supported by water usage and nearby behavior context.`,
        roomIds: [roomId],
        signals,
        baseConfidence: 0.4
      }));
    }

    if (signals.some((signal) => signal.type === 'media_signal')) {
      hypotheses.push(createActivityClusterHypothesis(memory, {
        id: `activity:media:${roomId}`,
        label: `${titleCase(roomId)} media activity`,
        summary: `${roomId} shows media activity around ${strongestSignalBucket(signals)}, supported by entertainment device usage.`,
        roomIds: [roomId],
        signals,
        baseConfidence: 0.4
      }));
    }

    if (signals.some((signal) => signal.type === 'work_study_signal')) {
      hypotheses.push(createActivityClusterHypothesis(memory, {
        id: `activity:work_study:${roomId}`,
        label: `${titleCase(roomId)} work study activity`,
        summary: `${roomId} shows work or study activity around ${strongestSignalBucket(signals)}, supported by desk, plug, lighting, or office device context.`,
        roomIds: [roomId],
        signals,
        baseConfidence: 0.38
      }));
    }

    if (signals.some((signal) => signal.type === 'sleep_signal')) {
      hypotheses.push(createActivityClusterHypothesis(memory, {
        id: `activity:sleep:${roomId}`,
        label: `${titleCase(roomId)} sleep activity`,
        summary: `${roomId} shows sleep activity around ${strongestSignalBucket(signals)}, supported by sleep or in-bed context.`,
        roomIds: [roomId],
        signals,
        baseConfidence: 0.45
      }));
    }
  }

  return hypotheses;
}

function createEntryReturnClusters(memory: HomeMemory): ProfileHypothesis[] {
  return dedupeHypotheses(entryReturnPairs(memory).map(({ accessSignal, nextSignal }) => createActivityClusterHypothesis(memory, {
    id: `activity:entry_return:${accessSignal.roomId}:${nextSignal.roomId}`,
    label: `${titleCase(accessSignal.roomId)} to ${titleCase(nextSignal.roomId)} return flow`,
    summary: `Access activity at ${accessSignal.roomId} was followed by ${nextSignal.type.replace(/_/g, ' ')} in ${nextSignal.roomId} within ${Math.round(minutesBetween(accessSignal.simTime, nextSignal.simTime))} minutes, suggesting an entry-to-${nextSignal.roomId} flow.`,
    roomIds: [accessSignal.roomId, nextSignal.roomId],
    signals: [accessSignal, nextSignal],
    baseConfidence: 0.36
  })));
}

function entryReturnPairs(memory: HomeMemory): Array<{ accessSignal: SemanticSignal; nextSignal: SemanticSignal }> {
  const sortedSignals = [...memory.semanticSignals]
    .filter((signal) => signal.type !== 'environment_signal' && signal.type !== 'system_signal')
    .sort((left, right) => left.simTime.localeCompare(right.simTime) || left.id.localeCompare(right.id));
  const pairs: Array<{ accessSignal: SemanticSignal; nextSignal: SemanticSignal }> = [];

  for (const accessSignal of sortedSignals.filter((signal) => signal.type === 'access_signal')) {
    const nextSignal = sortedSignals.find((signal) => (
      signal.roomId !== accessSignal.roomId &&
      signal.simTime > accessSignal.simTime &&
      minutesBetween(accessSignal.simTime, signal.simTime) <= 30 &&
      ['presence_signal', 'cooking_signal', 'media_signal', 'work_study_signal', 'water_signal'].includes(signal.type)
    ));

    if (!nextSignal) {
      continue;
    }

    pairs.push({ accessSignal, nextSignal });
  }

  return pairs;
}

function createActivityClusterHypothesis(
  memory: HomeMemory,
  input: {
    id: string;
    label: string;
    summary: string;
    roomIds: string[];
    signals: SemanticSignal[];
    baseConfidence: number;
  }
): ProfileHypothesis {
  const evidence = evidenceForSignals(memory, input.signals);
  const devices = sortedUnique(input.signals.map((signal) => signal.deviceId));
  const weightedSignal = input.signals.reduce((total, signal) => total + signal.profileWeight, 0);
  const distinctTypes = sortedUnique(input.signals.map((signal) => signal.type));
  const confidence = confidenceWithSampleSize(
    input.baseConfidence + Math.min(0.3, weightedSignal / 6) + Math.min(0.15, distinctTypes.length / 20),
    input.signals.length + weightedSignal
  );

  return hypothesis({
    id: input.id,
    type: 'activity_cluster',
    label: input.label,
    summary: `${input.summary} It remains a probabilistic activity cluster, not a confirmed resident identity.`,
    confidence,
    subjectIds: [...toRoomSubjectIds(input.roomIds), ...toDeviceSubjectIds(devices)],
    evidence: evidence.length > 0 ? evidence : memory.recentEvents.slice(0, 1)
  });
}

function createRoutineWindows(memory: HomeMemory): ProfileHypothesis[] {
  const grouped = new Map<string, SemanticSignal[]>();
  for (const signal of memory.semanticSignals.filter((candidate) => candidate.type === 'cooking_signal' || candidate.type === 'sleep_signal' || candidate.type === 'work_study_signal' || candidate.type === 'media_signal')) {
    const activity = activityNameForSignal(signal);
    const key = `${activity}:${signal.roomId}:${signal.timeBucket}`;
    grouped.set(key, [...(grouped.get(key) ?? []), signal]);
  }

  return [...grouped.entries()]
    .map(([key, signals]) => {
      const [activity, roomId, bucket] = key.split(':') as [string, string, TimeBucket];
      const dates = sortedUnique(signals.map((signal) => signal.simTime.slice(0, 10)));
      return { activity, roomId, bucket, signals, dates };
    })
    .filter((group) => group.signals.length >= 2 || group.dates.length >= 2)
    .map((group) => createTypedSignalHypothesis(memory, {
      id: `routine:${group.activity}:${group.roomId}:${group.bucket}`,
      type: 'routine_window',
      label: `${titleCase(group.roomId)} ${group.activity} routine`,
      summary: `${group.roomId} shows a ${group.activity} routine around ${group.bucket}, with ${group.signals.length} signal${plural(group.signals.length)} across ${group.dates.length} observed day${plural(group.dates.length)}.`,
      roomIds: [group.roomId],
      signals: group.signals,
      baseConfidence: 0.36
    }));
}

function createBehaviorFlows(memory: HomeMemory): ProfileHypothesis[] {
  return entryReturnPairs(memory).map(({ accessSignal, nextSignal }) => createTypedSignalHypothesis(memory, {
    id: `flow:return_home:${accessSignal.roomId}:${nextSignal.roomId}`,
    type: 'behavior_flow',
    label: `${titleCase(accessSignal.roomId)} to ${titleCase(nextSignal.roomId)} return home flow`,
    summary: `A return home flow is suggested because access activity at ${accessSignal.roomId} was followed by ${nextSignal.type.replace(/_/g, ' ')} in ${nextSignal.roomId} within ${Math.round(minutesBetween(accessSignal.simTime, nextSignal.simTime))} minutes.`,
    roomIds: [accessSignal.roomId, nextSignal.roomId],
    signals: [accessSignal, nextSignal],
    baseConfidence: 0.4
  }));
}

function createRoomFunctions(memory: HomeMemory): ProfileHypothesis[] {
  const hypotheses: ProfileHypothesis[] = [];
  for (const [roomId, signals] of groupSignalsByRoom(memory.semanticSignals)) {
    const signalTypes = new Set(signals.map((signal) => signal.type));
    const roomFunctions: Array<{ kind: string; label: string; condition: boolean }> = [
      { kind: 'cooking', label: 'cooking room', condition: signalTypes.has('cooking_signal') && hasMealActivitySupport(signals) },
      { kind: 'sleeping', label: 'sleeping room', condition: signalTypes.has('sleep_signal') },
      { kind: 'work_study', label: 'work or study room', condition: signalTypes.has('work_study_signal') },
      { kind: 'shared_living', label: 'shared living room', condition: signalTypes.has('media_signal') },
      { kind: 'entry_area', label: 'entry area', condition: signalTypes.has('access_signal') },
      { kind: 'hygiene', label: 'hygiene room', condition: signalTypes.has('water_signal') && isBathroomLikeRoom(roomId) }
    ];

    for (const roomFunction of roomFunctions.filter((candidate) => candidate.condition)) {
      hypotheses.push(createTypedSignalHypothesis(memory, {
        id: `room-function:${roomId}:${roomFunction.kind}`,
        type: 'room_function',
        label: `${titleCase(roomId)} ${roomFunction.label}`,
        summary: `${roomId} has ${roomFunction.label} likelihood based on ${describeSignalTypes(signals)}.`,
        roomIds: [roomId],
        signals,
        baseConfidence: 0.34
      }));
    }
  }
  return hypotheses.sort((left, right) => left.id.localeCompare(right.id));
}

function createResidentSlots(memory: HomeMemory): ProfileHypothesis[] {
  const hypotheses: ProfileHypothesis[] = [];
  for (const [roomId, signals] of groupSignalsByRoom(memory.semanticSignals)) {
    if (signals.some((signal) => signal.type === 'sleep_signal')) {
      const kind = roomId.includes('child') ? 'child_sleep' : 'main_sleep';
      hypotheses.push(createTypedSignalHypothesis(memory, {
        id: `resident-slot:${kind}:${roomId}`,
        type: 'resident_slot',
        label: `${titleCase(roomId)} ${kind.replace(/_/g, ' ')} slot`,
        summary: `${roomId} forms an anonymous ${kind.replace(/_/g, ' ')} resident slot from sleep-related signals. This is not identity recognition.`,
        roomIds: [roomId],
        signals,
        baseConfidence: 0.42
      }));
    }

    if (signals.some((signal) => signal.type === 'work_study_signal')) {
      hypotheses.push(createTypedSignalHypothesis(memory, {
        id: `resident-slot:remote_work:${roomId}`,
        type: 'resident_slot',
        label: `${titleCase(roomId)} remote work slot`,
        summary: `${roomId} forms an anonymous remote work or study slot from daytime work/study signals. This is not identity recognition.`,
        roomIds: [roomId],
        signals,
        baseConfidence: 0.36
      }));
    }
  }
  return hypotheses.sort((left, right) => left.id.localeCompare(right.id));
}

function createDeviceContributionHypotheses(memory: HomeMemory): ProfileHypothesis[] {
  const grouped = new Map<string, SemanticSignal[]>();
  for (const signal of memory.semanticSignals.filter((candidate) => candidate.type !== 'environment_signal' && candidate.type !== 'system_signal')) {
    grouped.set(signal.deviceId, [...(grouped.get(signal.deviceId) ?? []), signal]);
  }

  return [...grouped.entries()]
    .map(([deviceId, signals]) => ({
      deviceId,
      signals,
      score: signals.reduce((total, signal) => total + signal.profileWeight, 0)
    }))
    .filter((group) => group.score >= 0.8 || group.signals.length >= 2)
    .sort((left, right) => right.score - left.score || left.deviceId.localeCompare(right.deviceId))
    .slice(0, 5)
    .map((group) => createTypedSignalHypothesis(memory, {
      id: `device-contribution:${group.deviceId}`,
      type: 'device_contribution',
      label: `${titleCase(group.deviceId)} profile contribution`,
      summary: `${group.deviceId} is a high-contribution profile device with ${formatWeight(group.score)} semantic signal weight from ${describeSignalTypes(group.signals)}.`,
      roomIds: sortedUnique(group.signals.map((signal) => signal.roomId)),
      signals: group.signals,
      baseConfidence: 0.36
    }));
}

function createStateAnomalies(memory: HomeMemory): ProfileHypothesis[] {
  const environmentSignals = memory.semanticSignals.filter((signal) => (
    signal.type === 'environment_signal' &&
    ((normalizeSignalField(signal.field) === 'co2' && typeof signal.value === 'number' && signal.value >= 900) ||
      (normalizeSignalField(signal.field) === 'pm25' && typeof signal.value === 'number' && signal.value >= 35))
  ));
  const behaviorSignals = memory.semanticSignals.filter((signal) => signal.type !== 'environment_signal' && signal.type !== 'system_signal');

  return environmentSignals
    .filter((signal) => !behaviorSignals.some((behavior) => behavior.roomId === signal.roomId && absoluteMinutesBetween(signal.simTime, behavior.simTime) <= 30))
    .map((signal) => createTypedSignalHypothesis(memory, {
      id: `state-anomaly:environment-without-response:${signal.roomId}:${normalizeSignalField(signal.field)}`,
      type: 'state_anomaly',
      label: `${titleCase(signal.roomId)} environment without response`,
      summary: `${signal.roomId} has elevated ${signal.field} without a nearby behavior or device response signal, so this is a weak anomaly candidate.`,
      roomIds: [signal.roomId],
      signals: [signal],
      baseConfidence: 0.24
    }));
}

function createTypedSignalHypothesis(
  memory: HomeMemory,
  input: {
    id: string;
    type: ProfileHypothesisType;
    label: string;
    summary: string;
    roomIds: string[];
    signals: SemanticSignal[];
    baseConfidence: number;
  }
): ProfileHypothesis {
  const evidence = evidenceForSignals(memory, input.signals);
  const devices = sortedUnique(input.signals.map((signal) => signal.deviceId));
  const weightedSignal = input.signals.reduce((total, signal) => total + signal.profileWeight, 0);
  const confidence = confidenceWithSampleSize(
    input.baseConfidence + Math.min(0.28, weightedSignal / 8) + Math.min(0.12, input.signals.length / 20),
    input.signals.length + weightedSignal
  );

  return hypothesis({
    id: input.id,
    type: input.type,
    label: input.label,
    summary: input.summary,
    confidence,
    subjectIds: [...toRoomSubjectIds(input.roomIds), ...toDeviceSubjectIds(devices)],
    evidence: evidence.length > 0 ? evidence : memory.recentEvents.slice(0, 1)
  });
}

function createPresenceSignal(memory: HomeMemory): ProfileHypothesis {
  const rooms = sortedUnique(memory.recentEvents.map((event) => event.roomId));
  const episodes = behaviorEpisodes(memory);
  const episodeRooms = sortedUnique(episodes.map((episode) => episode.roomId));
  const activeRoomCount = sortedUnique([...rooms, ...episodeRooms]).length;
  const presenceEvidence = meaningfulEvidence(memory.recentEvents);
  const meaningfulRoomCount = sortedUnique([
    ...presenceEvidence.map((event) => event.roomId),
    ...episodeRooms
  ]).length;
  const meaningfulWeight = weightOf(presenceEvidence);
  const behaviorSignal = meaningfulWeight + episodes.length;

  return hypothesis({
    id: 'presence:recent-activity',
    type: 'presence_signal',
    label: 'Recent presence signal',
    summary: behaviorSignal > 0
      ? `Recent meaningful device activity and ${episodes.length} behavior episode${plural(episodes.length)} may indicate presence across ${meaningfulRoomCount} active room${plural(meaningfulRoomCount)}.`
      : `Recent activity across ${activeRoomCount} room${plural(activeRoomCount)} is mostly weak environment context; presence remains uncertain.`,
    confidence: confidenceWithSampleSize(
      behaviorSignal > 0
        ? 0.25 + Math.min(0.45, behaviorSignal / 8) + Math.min(0.15, meaningfulRoomCount / 20)
        : 0.2,
      behaviorSampleSize(meaningfulWeight, episodes.length)
    ),
    subjectIds: toRoomSubjectIds(rooms),
    evidence: memory.recentEvents
  });
}

function createHouseholdSize(memory: HomeMemory, activeRooms: RoomMemory[]): ProfileHypothesis {
  const estimate = estimateHouseholdSizeFromMemory(memory);
  const rooms = activeRooms.map((room) => room.roomId);
  const episodes = behaviorEpisodes(memory);
  const episodeRooms = sortedUnique(episodes.map((episode) => episode.roomId));
  const dailySummaries = sortedDailySummaries(memory);
  const weeklySummaries = sortedWeeklySummaries(memory);
  const observedDayCount = dailySummaries.length;
  const observedWeekCount = weeklySummaries.length;
  const longWindowRooms = sortedUnique([
    ...dailySummaries.flatMap((summary) => summary.meaningfulRooms),
    ...weeklySummaries.flatMap((summary) => summary.meaningfulRooms)
  ]);
  const meaningfulRooms = activeRooms.filter((room) => meaningfulWeightOfRoom(room) > 0 || episodeRooms.includes(room.roomId));
  const activeRoomCount = sortedUnique([
    ...meaningfulRooms.map((room) => room.roomId),
    ...longWindowRooms
  ]).length;
  const meaningfulWeight = meaningfulRooms.reduce((total, room) => total + meaningfulWeightOfRoom(room), 0);
  const multiDaySignal = observedDayCount > 1 ? observedDayCount : 0;
  const multiWeekSignal = observedWeekCount > 1 ? observedWeekCount : 0;
  const behaviorSignal = meaningfulWeight + episodes.length + multiDaySignal + multiWeekSignal;
  const sparseEvidence = behaviorSignal <= 3;
  const mostlyWeakContext = activeRoomCount === 0;
  const distributionText = formatHouseholdDistribution(estimate.distribution);

  return hypothesis({
    id: 'household:size',
    type: 'household_size',
    label: 'Probable household size',
    summary: mostlyWeakContext
        ? `Observed activity is mostly weak environment context across ${rooms.length} room${plural(rooms.length)}; resident count remains uncertain.`
      : sparseEvidence
        ? `Meaningful activity across ${activeRoomCount} active room${plural(activeRoomCount)} with ${formatWeight(meaningfulWeight)} weighted evidence, ${episodes.length} behavior episode${plural(episodes.length)}, ${observedDayCount} observed day${plural(observedDayCount)}, and ${observedWeekCount} observed week${plural(observedWeekCount)} is sparse; ${longWindowRooms.length} long-window room${plural(longWindowRooms.length)} remain insufficient, so resident count remains uncertain. Current probabilistic estimate is ${estimate.label}, lower bound ${estimate.lowerBound}, distribution ${distributionText}.`
        : `Meaningful activity across ${activeRoomCount} active room${plural(activeRoomCount)} with ${formatWeight(meaningfulWeight)} weighted evidence, ${episodes.length} behavior episode${plural(episodes.length)}, ${observedDayCount} observed day${plural(observedDayCount)}, and ${observedWeekCount} observed week${plural(observedWeekCount)} suggests ${estimate.label}; lower bound ${estimate.lowerBound}, distribution ${distributionText}. This uses ${longWindowRooms.length} long-window room${plural(longWindowRooms.length)}, ${estimate.features.concurrentActivity.roomCount} concurrent room${plural(estimate.features.concurrentActivity.roomCount)}, ${estimate.features.recurringSleepZones.count} sleep zone${plural(estimate.features.recurringSleepZones.count)}, and ${estimate.features.routineClusters.count} routine cluster${plural(estimate.features.routineClusters.count)}, so it remains probabilistic rather than a confirmed resident count.`,
    confidence: confidenceWithSampleSize(
      mostlyWeakContext
        ? 0.25
        : estimate.confidence,
      behaviorSampleSize(meaningfulWeight, episodes.length)
    ),
    subjectIds: toRoomSubjectIds(rooms),
    evidence: memory.recentEvents
  });
}

function hypothesis(input: ProfileHypothesisInput): ProfileHypothesis {
  return {
    ...input,
    supportingEvidence: input.supportingEvidence ?? input.evidence,
    contradictingEvidence: input.contradictingEvidence ?? [],
    missingEvidence: input.missingEvidence ?? missingEvidenceForHypothesis(input),
    confidence: clamp(input.confidence),
    updatedAt: input.evidence[0].simTime
  };
}

function missingEvidenceForHypothesis(input: ProfileHypothesisInput): string[] {
  const missing: string[] = [];
  if (input.confidence < 0.8) {
    missing.push('More observations across additional days would improve confidence.');
  }
  if (input.type === 'household_size') {
    missing.push('Independent sleep, behavior-flow, or resident-slot evidence would make household size more precise.');
  } else if (input.type === 'activity_cluster' || input.type === 'routine_window' || input.type === 'behavior_flow') {
    missing.push('Repeated semantic signals across more days would make this behavior pattern more stable.');
  } else if (input.type === 'state_anomaly') {
    missing.push('A longer baseline is needed before treating this as a strong anomaly.');
  } else {
    missing.push('Additional independent device evidence would make this hypothesis stronger.');
  }
  return sortedUnique(missing);
}

function sortedRooms(memory: HomeMemory): RoomMemory[] {
  return Object.values(memory.rooms)
    .filter((room) => room.eventCount > 0 && room.recentEvents.length > 0)
    .sort((left, right) => left.roomId.localeCompare(right.roomId));
}

function strongestTimeBucket(buckets: Record<TimeBucket, number>): TimeBucket {
  return TIME_BUCKETS.reduce((strongest, bucket) => {
    if (buckets[bucket] > buckets[strongest]) {
      return bucket;
    }
    return strongest;
  }, TIME_BUCKETS[0]);
}

function sortedDailySummaries(memory: HomeMemory): HomeMemory['dailySummaries'][string][] {
  return Object.values(memory.dailySummaries).sort((left, right) => left.date.localeCompare(right.date));
}

function sortedWeeklySummaries(memory: HomeMemory): HomeMemory['weeklySummaries'][string][] {
  return Object.values(memory.weeklySummaries).sort((left, right) => left.week.localeCompare(right.week));
}

function meaningfulEvidence(events: HomeMemory['recentEvents']): HomeMemory['recentEvents'] {
  return events.filter((event) => event.evidenceCategory === 'human_activity' || event.evidenceCategory === 'device_usage');
}

function behaviorEpisodes(memory: HomeMemory): MemoryEpisode[] {
  return Object.values(memory.episodes).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function behaviorEpisodesForRoom(memory: HomeMemory, roomId: string): MemoryEpisode[] {
  return behaviorEpisodes(memory).filter((episode) => episode.roomId === roomId);
}

function behaviorSampleSize(weightedEvidence: number, episodeCount: number): number {
  return Math.max(weightedEvidence, episodeCount);
}

function meaningfulWeightOfRoom(room: RoomMemory): number {
  const weakContextWeight = room.profileEvidenceByCategory.environment_context * 0.05;
  return Math.max(0, Number((room.profileEvidenceWeight - weakContextWeight).toFixed(3)));
}

function weightOf(events: HomeMemory['recentEvents']): number {
  return Number(events.reduce((total, event) => total + event.profileWeight, 0).toFixed(3));
}

function groupSignalsByRoom(signals: SemanticSignal[]): Map<string, SemanticSignal[]> {
  const grouped = new Map<string, SemanticSignal[]>();
  for (const signal of signals) {
    const roomSignals = grouped.get(signal.roomId) ?? [];
    grouped.set(signal.roomId, [...roomSignals, signal]);
  }
  return new Map([...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function strongestSignalBucket(signals: SemanticSignal[]): TimeBucket {
  const buckets = { morning: 0, daytime: 0, evening: 0, night: 0 } satisfies Record<TimeBucket, number>;
  for (const signal of signals) {
    buckets[signal.timeBucket] += 1;
  }
  return strongestTimeBucket(buckets);
}

function describeSignalTypes(signals: SemanticSignal[]): string {
  return sortedUnique(signals.map((signal) => signal.type.replace(/_/g, ' '))).join(', ');
}

function activityNameForSignal(signal: SemanticSignal): string {
  if (signal.type === 'cooking_signal') return 'meal';
  if (signal.type === 'sleep_signal') return 'sleep';
  if (signal.type === 'work_study_signal') return 'work_study';
  if (signal.type === 'media_signal') return 'media';
  return signal.type.replace(/_signal$/, '');
}

function hasMealActivitySupport(signals: SemanticSignal[]): boolean {
  const devices = sortedUnique(signals.map((signal) => signal.deviceId));
  const supportingTypes = new Set(signals.map((signal) => signal.type));
  return (
    devices.length >= 2 ||
    supportingTypes.has('presence_signal') ||
    supportingTypes.has('water_signal') ||
    supportingTypes.has('lighting_signal') ||
    signals.some((signal) => {
      const deviceType = signal.deviceType.toLowerCase();
      return deviceType.includes('stove') || deviceType.includes('oven') || deviceType.includes('microwave') || deviceType.includes('coffee') || deviceType.includes('kettle');
    })
  );
}

function evidenceForSignals(memory: HomeMemory, signals: SemanticSignal[]): MemoryEvidence[] {
  const ids = new Set(signals.flatMap((signal) => signal.sourceEvidenceIds));
  return memory.recentEvents.filter((event) => ids.has(event.id));
}

function isBathroomLikeRoom(roomId: string): boolean {
  const normalized = roomId.toLowerCase();
  return normalized.includes('bathroom') || normalized.includes('wash') || normalized.includes('toilet');
}

function minutesBetween(startedAt: string, endedAt: string): number {
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(endedAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, (endMs - startMs) / 60000);
}

function absoluteMinutesBetween(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs((rightMs - leftMs) / 60000);
}

function normalizeSignalField(field: string): string {
  return field.replace(/[_\s-]+/g, '').toLowerCase();
}

function dedupeHypotheses(hypotheses: ProfileHypothesis[]): ProfileHypothesis[] {
  const seen = new Set<string>();
  const deduped: ProfileHypothesis[] = [];
  for (const hypothesis of hypotheses) {
    if (!seen.has(hypothesis.id)) {
      seen.add(hypothesis.id);
      deduped.push(hypothesis);
    }
  }
  return deduped;
}

function confidenceFromCount(count: number, total: number, max: number, sampleSize = count): number {
  if (count <= 0 || total <= 0) {
    return 0.1;
  }
  return confidenceWithSampleSize(0.2 + Math.min(max - 0.2, count / total), sampleSize);
}

function confidenceWithSampleSize(value: number, sampleSize: number): number {
  return clamp(Math.min(value, sampleSizeConfidenceCap(sampleSize)));
}

function sampleSizeConfidenceCap(sampleSize: number): number {
  if (sampleSize <= 1) {
    return 0.45;
  }
  if (sampleSize <= 2) {
    return 0.55;
  }
  if (sampleSize <= 3) {
    return 0.65;
  }
  if (sampleSize <= 5) {
    return 0.8;
  }
  return 1;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0.01, Number(value.toFixed(3))));
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function toRoomSubjectIds(roomIds: string[]): string[] {
  return roomIds.map((roomId) => `room:${roomId}`);
}

function toDeviceSubjectIds(deviceIds: string[]): string[] {
  return deviceIds.map((deviceId) => `device:${deviceId}`);
}

function formatList(values: string[]): string {
  if (values.length === 0) {
    return 'no rooms';
  }
  return values.join(', ');
}

function formatWeight(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function formatHouseholdDistribution(distribution: ReturnType<typeof estimateHouseholdSizeFromMemory>['distribution']): string {
  return ([1, 2, 3, 4, 5] as const)
    .map((count) => `${count}:${Math.round(distribution[count] * 100)}%`)
    .join('/');
}

function matchWord(count: number): string {
  return count === 1 ? 'match' : 'matches';
}

function plural(count: number): string {
  return count === 1 ? '' : 's';
}

function titleCase(value: string): string {
  return value.replace(/(^|_)([a-z])/g, (_, separator: string, letter: string) => {
    return `${separator === '_' ? ' ' : ''}${letter.toUpperCase()}`;
  });
}
