import type { HomeMemory, MemoryEpisode, MemoryEvidence, RoomMemory } from './homeMemoryModel';

export type ResidentCount = 1 | 2 | 3 | 4 | 5;
export type HouseholdRoutineCluster =
  | 'meal_activity'
  | 'study_or_work_activity'
  | 'shared_evening_activity'
  | 'bathroom_hygiene_activity'
  | 'child_sleep_activity'
  | 'main_sleep_activity'
  | 'entry_activity';

export type HouseholdSizeDistribution = Record<ResidentCount, number>;

export interface HouseholdSizeEstimate {
  estimate: ResidentCount;
  label: string;
  lowerBound: ResidentCount;
  confidence: number;
  distribution: HouseholdSizeDistribution;
  features: {
    meaningfulRoomCount: number;
    longWindowRoomCount: number;
    meaningfulEvidenceWeight: number;
    behaviorEpisodeCount: number;
    observedDayCount: number;
    observedWeekCount: number;
    environmentContextRatio: number;
    concurrentActivity: {
      lowerBound: ResidentCount;
      roomCount: number;
      rooms: string[];
      windowKey: string | null;
    };
    recurringSleepZones: {
      count: number;
      rooms: string[];
    };
    routineClusters: {
      count: number;
      clusters: HouseholdRoutineCluster[];
    };
  };
  evidence: string[];
  summary: string;
}

const RESIDENT_COUNTS: ResidentCount[] = [1, 2, 3, 4, 5];

export function estimateHouseholdSizeFromMemory(memory: HomeMemory): HouseholdSizeEstimate {
  const meaningfulEvents = householdSizeEvidence(memory.recentEvents);
  const episodes = behaviorEpisodes(memory);
  const dailySummaries = Object.values(memory.dailySummaries);
  const weeklySummaries = Object.values(memory.weeklySummaries);
  const longWindowRooms = sortedUnique([
    ...dailySummaries.flatMap((summary) => summary.meaningfulRooms),
    ...weeklySummaries.flatMap((summary) => summary.meaningfulRooms)
  ]);
  const episodeRooms = sortedUnique(episodes.map((episode) => episode.roomId));
  const meaningfulRooms = Object.values(memory.rooms).filter((room) => (
    meaningfulWeightOfRoom(room) > 0 || episodeRooms.includes(room.roomId) || longWindowRooms.includes(room.roomId)
  ));
  const meaningfulRoomIds = sortedUnique([
    ...meaningfulRooms.map((room) => room.roomId),
    ...longWindowRooms
  ]);
  const meaningfulEvidenceWeight = roundWeight(meaningfulRooms.reduce((total, room) => total + meaningfulWeightOfRoom(room), 0));
  const concurrentActivity = estimateConcurrentActivity(meaningfulEvents);
  const recurringSleepZones = estimateRecurringSleepZones(memory, meaningfulEvents, episodes);
  const routineClusters = estimateRoutineClusters(memory, meaningfulEvents, recurringSleepZones.rooms);
  const environmentContextRatio = memory.profileEventCount === 0
    ? 1
    : roundWeight(memory.profileEvidenceByCategory.environment_context / memory.profileEventCount);
  const lowerBound = clampResidentCount(Math.max(
    concurrentActivity.lowerBound,
    recurringSleepZones.count,
    1
  ));
  const distribution = createResidentDistribution({
    lowerBound,
    meaningfulRoomCount: meaningfulRoomIds.length,
    meaningfulEvidenceWeight,
    behaviorEpisodeCount: episodes.length,
    observedDayCount: dailySummaries.length,
    observedWeekCount: weeklySummaries.length,
    environmentContextRatio,
    concurrentRoomCount: concurrentActivity.roomCount,
    sleepZoneCount: recurringSleepZones.count,
    routineClusterCount: routineClusters.count
  });
  const estimate = mostLikelyResidentCount(distribution);
  const confidence = estimateConfidence(distribution, {
    meaningfulEvidenceWeight,
    behaviorEpisodeCount: episodes.length,
    observedDayCount: dailySummaries.length,
    observedWeekCount: weeklySummaries.length,
    environmentContextRatio,
    lowerBound
  });
  const evidence = createEvidenceText(concurrentActivity, recurringSleepZones, routineClusters, environmentContextRatio);

  return {
    estimate,
    label: `${estimate} resident${estimate === 1 ? '' : 's'}`,
    lowerBound,
    confidence,
    distribution,
    features: {
      meaningfulRoomCount: meaningfulRoomIds.length,
      longWindowRoomCount: longWindowRooms.length,
      meaningfulEvidenceWeight,
      behaviorEpisodeCount: episodes.length,
      observedDayCount: dailySummaries.length,
      observedWeekCount: weeklySummaries.length,
      environmentContextRatio,
      concurrentActivity,
      recurringSleepZones,
      routineClusters
    },
    evidence,
    summary: createEstimateSummary(estimate, lowerBound, confidence, distribution, evidence)
  };
}

function estimateConcurrentActivity(events: MemoryEvidence[]): HouseholdSizeEstimate['features']['concurrentActivity'] {
  const windows = new Map<string, Set<string>>();

  for (const event of events) {
    const minute = minuteOfDay(event.simTime);
    const date = event.simTime.slice(0, 10);
    const windowStart = Math.floor(minute / 10) * 10;
    const windowKey = `${date}:${String(Math.floor(windowStart / 60)).padStart(2, '0')}:${String(windowStart % 60).padStart(2, '0')}`;
    const rooms = windows.get(windowKey) ?? new Set<string>();
    rooms.add(event.roomId);
    windows.set(windowKey, rooms);
  }

  const strongest = [...windows.entries()]
    .map(([windowKey, rooms]) => ({ windowKey, rooms: sortedUnique([...rooms]) }))
    .sort((left, right) => right.rooms.length - left.rooms.length || left.windowKey.localeCompare(right.windowKey))[0];

  if (!strongest) {
    return {
      lowerBound: 1,
      roomCount: 0,
      rooms: [],
      windowKey: null
    };
  }

  const roomCount = strongest.rooms.length;
  return {
    lowerBound: clampResidentCount(roomCount),
    roomCount,
    rooms: strongest.rooms,
    windowKey: strongest.windowKey
  };
}

function estimateRecurringSleepZones(
  memory: HomeMemory,
  events: MemoryEvidence[],
  episodes: MemoryEpisode[]
): HouseholdSizeEstimate['features']['recurringSleepZones'] {
  const rooms = sortedUnique([
    ...events
      .filter(isSleepZoneEvent)
      .map((event) => event.roomId),
    ...episodes
      .filter((episode) => episode.timeBucket === 'night' && isBedroomLikeRoom(episode.roomId) && episode.kind === 'occupancy')
      .map((episode) => episode.roomId),
    ...Object.values(memory.fields)
      .filter((field) => isSleepField(field.deviceType, field.field) && field.trueCount && field.trueCount > 0)
      .map((field) => field.roomId)
  ]);

  return {
    count: rooms.length,
    rooms
  };
}

function estimateRoutineClusters(
  memory: HomeMemory,
  events: MemoryEvidence[],
  sleepRooms: string[]
): HouseholdSizeEstimate['features']['routineClusters'] {
  const clusters = new Set<HouseholdRoutineCluster>();

  for (const event of events) {
    const field = normalize(event.field);
    const deviceType = normalize(event.deviceType);
    if (event.roomId === 'kitchen' && (event.timeBucket === 'morning' || event.timeBucket === 'evening')) {
      clusters.add('meal_activity');
    }
    if (event.roomId === 'study' && (event.timeBucket === 'daytime' || event.timeBucket === 'evening')) {
      clusters.add('study_or_work_activity');
    }
    if ((event.roomId === 'living_room' || event.roomId === 'living') && event.timeBucket === 'evening') {
      clusters.add('shared_evening_activity');
    }
    if (event.roomId === 'bathroom' && (field.includes('flow') || deviceType.includes('motion') || field === 'motion')) {
      clusters.add('bathroom_hygiene_activity');
    }
    if (event.roomId === 'entrance' || event.roomId === 'entry') {
      clusters.add('entry_activity');
    }
  }

  if (sleepRooms.some((room) => room.includes('child'))) {
    clusters.add('child_sleep_activity');
  }
  if (sleepRooms.some((room) => room.includes('master') || room.includes('bedroom'))) {
    clusters.add('main_sleep_activity');
  }
  if (Object.values(memory.devices).some((device) => device.roomId === 'study' && device.profileEvidenceWeight > 0)) {
    clusters.add('study_or_work_activity');
  }

  return {
    count: clusters.size,
    clusters: [...clusters].sort()
  };
}

function createResidentDistribution(input: {
  lowerBound: ResidentCount;
  meaningfulRoomCount: number;
  meaningfulEvidenceWeight: number;
  behaviorEpisodeCount: number;
  observedDayCount: number;
  observedWeekCount: number;
  environmentContextRatio: number;
  concurrentRoomCount: number;
  sleepZoneCount: number;
  routineClusterCount: number;
}): HouseholdSizeDistribution {
  const routineEstimate = clampResidentCount(Math.round((input.meaningfulRoomCount + input.routineClusterCount) / 3));
  const sleepEstimate = input.sleepZoneCount > 0 ? clampResidentCount(input.sleepZoneCount) : null;
  const weakContextPenalty = input.environmentContextRatio >= 0.8 ? 1.4 : 0;
  const scores = Object.fromEntries(RESIDENT_COUNTS.map((count) => {
    let score = 1;
    if (count < input.lowerBound) {
      score -= 4;
    }
    score += count === input.lowerBound ? (input.lowerBound > 1 ? 1.8 : 0.4) : 0.4 / Math.max(1, Math.abs(count - input.lowerBound));
    score += 1.2 / (Math.abs(count - routineEstimate) + 1);
    if (sleepEstimate !== null) {
      score += 2.2 / (Math.abs(count - sleepEstimate) + 1);
    }
    if (input.concurrentRoomCount >= 3 && count >= input.concurrentRoomCount) {
      score += 1.6 / (count - input.concurrentRoomCount + 1);
    }
    if (input.routineClusterCount >= 4 && count >= 3) {
      score += 0.8 / (count - 2);
    }
    if (input.routineClusterCount >= 4 && count === 2) {
      score += 0.45;
    }
    if (input.meaningfulEvidenceWeight + input.behaviorEpisodeCount < 3 && count > 1) {
      score -= 1.5;
    }
    if (weakContextPenalty > 0 && count > 1) {
      score -= weakContextPenalty;
    }
    return [count, Math.max(0.01, score)];
  })) as HouseholdSizeDistribution;

  return normalizeDistribution(scores);
}

function normalizeDistribution(scores: HouseholdSizeDistribution): HouseholdSizeDistribution {
  const total = RESIDENT_COUNTS.reduce((sum, count) => sum + scores[count], 0);
  const normalized = Object.fromEntries(RESIDENT_COUNTS.map((count) => [
    count,
    Number((scores[count] / total).toFixed(3))
  ])) as HouseholdSizeDistribution;
  const roundedTotal = RESIDENT_COUNTS.reduce((sum, count) => sum + normalized[count], 0);
  normalized[1] = Number((normalized[1] + (1 - roundedTotal)).toFixed(3));
  return normalized;
}

function mostLikelyResidentCount(distribution: HouseholdSizeDistribution): ResidentCount {
  return RESIDENT_COUNTS.reduce((best, count) => (
    distribution[count] > distribution[best] ? count : best
  ), 1);
}

function estimateConfidence(
  distribution: HouseholdSizeDistribution,
  input: {
    meaningfulEvidenceWeight: number;
    behaviorEpisodeCount: number;
    observedDayCount: number;
    observedWeekCount: number;
    environmentContextRatio: number;
    lowerBound: ResidentCount;
  }
): number {
  const estimate = mostLikelyResidentCount(distribution);
  const probability = distribution[estimate];
  const sampleSize = input.meaningfulEvidenceWeight + input.behaviorEpisodeCount + Math.max(0, input.observedDayCount - 1) + Math.max(0, input.observedWeekCount - 1);
  const sampleCap = sampleSize <= 1 ? 0.45 : sampleSize <= 3 ? 0.62 : sampleSize <= 6 ? 0.78 : 0.9;
  const lowerBoundBoost = input.lowerBound >= 2 ? 0.08 : 0;
  const weakContextPenalty = input.environmentContextRatio >= 0.8 ? 0.18 : 0;

  return clamp(Number(Math.min(sampleCap, probability + 0.28 + lowerBoundBoost - weakContextPenalty).toFixed(3)));
}

function createEvidenceText(
  concurrentActivity: HouseholdSizeEstimate['features']['concurrentActivity'],
  sleepZones: HouseholdSizeEstimate['features']['recurringSleepZones'],
  routineClusters: HouseholdSizeEstimate['features']['routineClusters'],
  environmentContextRatio: number
): string[] {
  const evidence: string[] = [];
  if (concurrentActivity.roomCount > 1) {
    evidence.push(`${concurrentActivity.roomCount}-room concurrent activity lower bound`);
  }
  if (sleepZones.count > 0) {
    evidence.push(`${sleepZones.count} recurring sleep zone${sleepZones.count === 1 ? '' : 's'}`);
  }
  if (routineClusters.count > 0) {
    evidence.push(`${routineClusters.count} routine cluster${routineClusters.count === 1 ? '' : 's'}`);
  }
  if (environmentContextRatio >= 0.8) {
    evidence.push('mostly weak environment context');
  }
  return evidence.length > 0 ? evidence : ['sparse device-only evidence'];
}

function createEstimateSummary(
  estimate: ResidentCount,
  lowerBound: ResidentCount,
  confidence: number,
  distribution: HouseholdSizeDistribution,
  evidence: string[]
): string {
  const distributionText = RESIDENT_COUNTS
    .map((count) => `${count}:${Math.round(distribution[count] * 100)}%`)
    .join(', ');
  return `Estimated ${estimate} resident${estimate === 1 ? '' : 's'} with lower bound ${lowerBound} and ${Math.round(confidence * 100)}% confidence. Distribution ${distributionText}. Evidence: ${evidence.join('; ')}.`;
}

function householdSizeEvidence(events: MemoryEvidence[]): MemoryEvidence[] {
  return events.filter((event) => (
    (
      event.profileWeight > 0 &&
      (event.evidenceCategory === 'human_activity' || event.evidenceCategory === 'device_usage')
    ) ||
    isOccupancyContextEvent(event)
  ));
}

function behaviorEpisodes(memory: HomeMemory): MemoryEpisode[] {
  return Object.values(memory.episodes);
}

function meaningfulWeightOfRoom(room: RoomMemory): number {
  const weakContextWeight = room.profileEvidenceByCategory.environment_context * 0.05;
  return Math.max(0, roundWeight(room.profileEvidenceWeight - weakContextWeight));
}

function isSleepZoneEvent(event: MemoryEvidence): boolean {
  return isSleepField(event.deviceType, event.field) && event.value === true;
}

function isOccupancyContextEvent(event: MemoryEvidence): boolean {
  const field = normalize(event.field);
  if (isSleepZoneEvent(event)) {
    return true;
  }
  if (field === 'co2' && typeof event.value === 'number') {
    return event.value >= 900;
  }
  if (field === 'pm25' && typeof event.value === 'number') {
    return event.value >= 35;
  }
  if (field.includes('flow') && typeof event.value === 'number') {
    return event.value > 0;
  }
  return false;
}

function isSleepField(deviceType: string, field: string): boolean {
  const normalizedDeviceType = normalize(deviceType);
  const normalizedField = normalize(field);
  return (
    normalizedDeviceType.includes('sleep') ||
    normalizedField === 'inbed' ||
    normalizedField === 'asleep' ||
    normalizedField === 'sleeping'
  );
}

function isBedroomLikeRoom(roomId: string): boolean {
  return roomId.includes('bedroom');
}

function minuteOfDay(simTime: string): number {
  const match = /T(\d{2}):(\d{2})/.exec(simTime);
  if (!match) {
    return 0;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function clampResidentCount(value: number): ResidentCount {
  return Math.min(5, Math.max(1, value)) as ResidentCount;
}

function normalize(value: string): string {
  return value.replace(/[_\s-]+/g, '').toLowerCase();
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function roundWeight(value: number): number {
  return Number(value.toFixed(3));
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0.01, value));
}
