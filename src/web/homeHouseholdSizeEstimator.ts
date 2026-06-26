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
export type SharedSleepZoneStrength = 'none' | 'weak' | 'medium' | 'strong';

export type HouseholdSizeDistribution = Record<ResidentCount, number>;

export interface HouseholdScoreTerm {
  label: string;
  value: number;
  formula: string;
}

export interface HouseholdResidentScoreBreakdown {
  count: ResidentCount;
  rawScore: number;
  clampedScore: number;
  probability: number;
  terms: HouseholdScoreTerm[];
}

export interface HouseholdSizeScoringBreakdown {
  routineEstimate: ResidentCount;
  slotEstimate: ResidentCount | null;
  sleepEstimate: ResidentCount | null;
  sharedSleepEstimate: ResidentCount | null;
  weakContextPenalty: number;
  totalScore: number;
  residents: HouseholdResidentScoreBreakdown[];
  confidence: {
    winningCount: ResidentCount;
    winningProbability: number;
    sampleSize: number;
    sampleCap: number;
    lowerBoundBoost: number;
    weakContextPenalty: number;
    formulaValue: number;
  };
}

export interface HouseholdSizeEstimate {
  estimate: ResidentCount;
  label: string;
  lowerBound: ResidentCount;
  confidence: number;
  distribution: HouseholdSizeDistribution;
  scoring: HouseholdSizeScoringBreakdown;
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
    residentSlots: {
      count: number;
      slots: string[];
    };
    sharedSleepZones: {
      count: number;
      rooms: string[];
      strength: SharedSleepZoneStrength;
      reasons: string[];
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
  const residentSlots = estimateResidentSlots(memory);
  const sharedSleepZones = estimateSharedSleepZones(memory, recurringSleepZones, routineClusters);
  const environmentContextRatio = memory.profileEventCount === 0
    ? 1
    : roundWeight(memory.profileEvidenceByCategory.environment_context / memory.profileEventCount);
  const lowerBound = clampResidentCount(Math.max(
    concurrentActivity.lowerBound,
    recurringSleepZones.count,
    sharedSleepZones.strength === 'strong' ? recurringSleepZones.count + sharedSleepZones.count : 1,
    1
  ));
  const scoringInput = {
    lowerBound,
    meaningfulRoomCount: meaningfulRoomIds.length,
    meaningfulEvidenceWeight,
    behaviorEpisodeCount: episodes.length,
    observedDayCount: dailySummaries.length,
    observedWeekCount: weeklySummaries.length,
    environmentContextRatio,
    concurrentRoomCount: concurrentActivity.roomCount,
    sleepZoneCount: recurringSleepZones.count,
    routineClusterCount: routineClusters.count,
    residentSlotCount: residentSlots.count,
    sharedSleepZoneCount: sharedSleepZones.count,
    sharedSleepZoneStrength: sharedSleepZones.strength
  };
  const scoring = createResidentScoringBreakdown(scoringInput);
  const distribution = scoring.distribution;
  const estimate = mostLikelyResidentCount(distribution);
  const confidenceInput = {
    meaningfulEvidenceWeight,
    behaviorEpisodeCount: episodes.length,
    observedDayCount: dailySummaries.length,
    observedWeekCount: weeklySummaries.length,
    environmentContextRatio,
    lowerBound
  };
  const confidence = estimateConfidence(distribution, confidenceInput);
  const confidenceBreakdown = createConfidenceBreakdown(distribution, confidenceInput);
  const evidence = createEvidenceText(concurrentActivity, recurringSleepZones, routineClusters, residentSlots, sharedSleepZones, environmentContextRatio);

  return {
    estimate,
    label: `${estimate} resident${estimate === 1 ? '' : 's'}`,
    lowerBound,
    confidence,
    distribution,
    scoring: {
      ...scoring.breakdown,
      confidence: confidenceBreakdown
    },
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
      routineClusters,
      residentSlots,
      sharedSleepZones
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

function estimateResidentSlots(memory: HomeMemory): HouseholdSizeEstimate['features']['residentSlots'] {
  const slots = new Set<string>();
  for (const signal of memory.semanticSignals) {
    if (signal.type === 'sleep_signal') {
      slots.add(signal.roomId.includes('child') ? 'child_sleep_slot' : 'main_sleep_slot');
    }
    if (signal.type === 'work_study_signal') {
      slots.add('remote_work_slot');
    }
    if (signal.type === 'media_signal' && signal.timeBucket === 'evening') {
      slots.add('shared_evening_slot');
    }
    if (signal.type === 'presence_signal' && signal.timeBucket === 'daytime') {
      slots.add('daytime_home_slot');
    }
  }

  const sortedSlots = [...slots].sort((left, right) => left.localeCompare(right));
  return {
    count: sortedSlots.length,
    slots: sortedSlots
  };
}

function estimateSharedSleepZones(
  memory: HomeMemory,
  sleepZones: HouseholdSizeEstimate['features']['recurringSleepZones'],
  routineClusters: HouseholdSizeEstimate['features']['routineClusters']
): HouseholdSizeEstimate['features']['sharedSleepZones'] {
  const mainSleepRooms = sleepZones.rooms.filter(isMainSleepRoom);
  if (mainSleepRooms.length === 0) {
    return {
      count: 0,
      rooms: [],
      strength: 'none',
      reasons: []
    };
  }

  const sleepDevicesByRoom = new Map<string, Set<string>>();
  const numericOccupancyRooms = new Set<string>();
  for (const field of Object.values(memory.fields)) {
    if (!mainSleepRooms.includes(field.roomId) || !isSleepField(field.deviceType, field.field)) {
      continue;
    }
    const deviceIds = sleepDevicesByRoom.get(field.roomId) ?? new Set<string>();
    deviceIds.add(field.deviceId);
    sleepDevicesByRoom.set(field.roomId, deviceIds);
    if (isSharedOccupancyField(field.field) && maxNumericValue(field) >= 2) {
      numericOccupancyRooms.add(field.roomId);
    }
  }

  const multiDeviceRooms = mainSleepRooms.filter((roomId) => (sleepDevicesByRoom.get(roomId)?.size ?? 0) >= 2);
  const strongRooms = sortedUnique([...numericOccupancyRooms, ...multiDeviceRooms]);
  if (strongRooms.length > 0) {
    return {
      count: strongRooms.length,
      rooms: strongRooms,
      strength: 'strong',
      reasons: ['sleep-zone evidence directly indicates multiple bed sides, sleep devices, or occupants']
    };
  }

  const hasChildSleep = routineClusters.clusters.includes('child_sleep_activity');
  const supportingFamilyRoutines = routineClusters.clusters.filter((cluster) => (
    cluster === 'meal_activity' ||
    cluster === 'shared_evening_activity' ||
    cluster === 'entry_activity' ||
    cluster === 'study_or_work_activity'
  ));
  if (hasChildSleep && supportingFamilyRoutines.length >= 2) {
    return {
      count: mainSleepRooms.length,
      rooms: mainSleepRooms,
      strength: 'medium',
      reasons: ['main sleep zone co-occurs with child sleep and family routine evidence']
    };
  }

  return {
    count: mainSleepRooms.length,
    rooms: mainSleepRooms,
    strength: 'weak',
    reasons: ['main bedroom sleep evidence may represent one or two adults, but no direct shared-bed signal is present']
  };
}

interface ResidentScoringInput {
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
  residentSlotCount: number;
  sharedSleepZoneCount: number;
  sharedSleepZoneStrength: SharedSleepZoneStrength;
}

function createResidentDistribution(input: ResidentScoringInput): HouseholdSizeDistribution {
  return createResidentScoringBreakdown(input).distribution;
}

function createResidentScoringBreakdown(input: ResidentScoringInput): { distribution: HouseholdSizeDistribution; breakdown: Omit<HouseholdSizeScoringBreakdown, 'confidence'> } {
  const routineEstimate = clampResidentCount(Math.round((input.meaningfulRoomCount + input.routineClusterCount) / 3));
  const slotEstimate = input.residentSlotCount >= 3 ? clampResidentCount(Math.ceil(input.residentSlotCount / 2)) : null;
  const sleepEstimate = input.sleepZoneCount > 0 ? clampResidentCount(input.sleepZoneCount) : null;
  const sharedSleepEstimate = input.sharedSleepZoneCount > 0 && input.sharedSleepZoneStrength !== 'none'
    ? clampResidentCount(input.sleepZoneCount + input.sharedSleepZoneCount)
    : null;
  const weakContextPenalty = input.environmentContextRatio >= 0.8 ? 1.4 : 0;
  const residents = RESIDENT_COUNTS.map((count) => {
    const terms: HouseholdScoreTerm[] = [{ label: 'Base score', value: 1, formula: '1' }];
    if (count < input.lowerBound) {
      terms.push({ label: 'Below lower bound penalty', value: -4, formula: `${count} < lowerBound(${input.lowerBound}) ? -4 : 0` });
    }
    terms.push({
      label: 'Lower-bound distance',
      value: count === input.lowerBound ? (input.lowerBound > 1 ? 1.8 : 0.4) : 0.4 / Math.max(1, Math.abs(count - input.lowerBound)),
      formula: count === input.lowerBound
        ? `count == lowerBound(${input.lowerBound}) ? ${input.lowerBound > 1 ? '1.8' : '0.4'}`
        : `0.4 / max(1, abs(${count} - ${input.lowerBound}))`
    });
    terms.push({
      label: 'Routine estimate distance',
      value: 1.2 / (Math.abs(count - routineEstimate) + 1),
      formula: `1.2 / (abs(${count} - routineEstimate(${routineEstimate})) + 1)`
    });
    if (sleepEstimate !== null) {
      terms.push({
        label: 'Sleep-zone estimate distance',
        value: 2.2 / (Math.abs(count - sleepEstimate) + 1),
        formula: `2.2 / (abs(${count} - sleepEstimate(${sleepEstimate})) + 1)`
      });
    }
    if (input.concurrentRoomCount >= 3 && count >= input.concurrentRoomCount) {
      terms.push({
        label: 'Concurrent-room support',
        value: 1.6 / (count - input.concurrentRoomCount + 1),
        formula: `1.6 / (${count} - concurrentRoomCount(${input.concurrentRoomCount}) + 1)`
      });
    }
    if (input.routineClusterCount >= 4 && count >= 3) {
      terms.push({
        label: 'Large-routine support',
        value: 0.8 / (count - 2),
        formula: `0.8 / (${count} - 2)`
      });
    }
    if (input.routineClusterCount >= 4 && count === 2) {
      terms.push({ label: 'Two-resident routine support', value: 0.45, formula: 'routineClusterCount >= 4 && count == 2 ? 0.45 : 0' });
    }
    if (slotEstimate !== null) {
      terms.push({
        label: 'Resident-slot estimate distance',
        value: 1.5 / (Math.abs(count - slotEstimate) + 1),
        formula: `1.5 / (abs(${count} - slotEstimate(${slotEstimate})) + 1)`
      });
    }
    if (input.residentSlotCount >= 3 && count >= 2) {
      terms.push({
        label: 'Resident-slot support',
        value: 0.65 / (count - 1),
        formula: `0.65 / (${count} - 1)`
      });
    }
    if (sharedSleepEstimate !== null) {
      if (input.sharedSleepZoneStrength === 'strong') {
        terms.push({
          label: 'Strong shared-sleep support',
          value: 2.8 / (Math.abs(count - sharedSleepEstimate) + 1),
          formula: `2.8 / (abs(${count} - sharedSleepEstimate(${sharedSleepEstimate})) + 1)`
        });
      } else if (input.sharedSleepZoneStrength === 'medium') {
        terms.push({
          label: 'Medium shared-sleep support',
          value: count === sharedSleepEstimate ? 3.2 : 0.5 / (Math.abs(count - sharedSleepEstimate) + 1),
          formula: count === sharedSleepEstimate
            ? `count == sharedSleepEstimate(${sharedSleepEstimate}) ? 3.2 : fallback`
            : `0.5 / (abs(${count} - sharedSleepEstimate(${sharedSleepEstimate})) + 1)`
        });
      } else if (count === sharedSleepEstimate) {
        terms.push({ label: 'Weak shared-sleep support', value: 0.45, formula: `count == sharedSleepEstimate(${sharedSleepEstimate}) ? 0.45 : 0` });
      }
    }
    if (input.meaningfulEvidenceWeight + input.behaviorEpisodeCount < 3 && count > 1) {
      terms.push({
        label: 'Sparse-evidence penalty',
        value: -1.5,
        formula: `meaningfulEvidenceWeight(${input.meaningfulEvidenceWeight}) + behaviorEpisodeCount(${input.behaviorEpisodeCount}) < 3 && count > 1 ? -1.5 : 0`
      });
    }
    if (weakContextPenalty > 0 && count > 1) {
      terms.push({
        label: 'Weak-context penalty',
        value: -weakContextPenalty,
        formula: `environmentContextRatio(${input.environmentContextRatio}) >= 0.8 && count > 1 ? -${weakContextPenalty} : 0`
      });
    }
    const rawScore = roundScore(terms.reduce((score, term) => score + term.value, 0));
    return {
      count,
      rawScore,
      clampedScore: Math.max(0.01, rawScore),
      probability: 0,
      terms: terms.map((term) => ({ ...term, value: roundScore(term.value) }))
    };
  });
  const scores = Object.fromEntries(residents.map((resident) => [resident.count, resident.clampedScore])) as HouseholdSizeDistribution;
  const distribution = normalizeDistribution(scores);
  const scoredResidents = residents.map((resident) => ({
    ...resident,
    probability: distribution[resident.count]
  }));

  return {
    distribution,
    breakdown: {
      routineEstimate,
      slotEstimate,
      sleepEstimate,
      sharedSleepEstimate,
      weakContextPenalty,
      totalScore: roundScore(RESIDENT_COUNTS.reduce((sum, count) => sum + scores[count], 0)),
      residents: scoredResidents
    }
  };
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

function createConfidenceBreakdown(
  distribution: HouseholdSizeDistribution,
  input: {
    meaningfulEvidenceWeight: number;
    behaviorEpisodeCount: number;
    observedDayCount: number;
    observedWeekCount: number;
    environmentContextRatio: number;
    lowerBound: ResidentCount;
  }
): HouseholdSizeScoringBreakdown['confidence'] {
  const winningCount = mostLikelyResidentCount(distribution);
  const winningProbability = distribution[winningCount];
  const sampleSize = input.meaningfulEvidenceWeight + input.behaviorEpisodeCount + Math.max(0, input.observedDayCount - 1) + Math.max(0, input.observedWeekCount - 1);
  const sampleCap = sampleSize <= 1 ? 0.45 : sampleSize <= 3 ? 0.62 : sampleSize <= 6 ? 0.78 : 0.9;
  const lowerBoundBoost = input.lowerBound >= 2 ? 0.08 : 0;
  const weakContextPenalty = input.environmentContextRatio >= 0.8 ? 0.18 : 0;

  return {
    winningCount,
    winningProbability,
    sampleSize: roundScore(sampleSize),
    sampleCap,
    lowerBoundBoost,
    weakContextPenalty,
    formulaValue: roundScore(winningProbability + 0.28 + lowerBoundBoost - weakContextPenalty)
  };
}

function createEvidenceText(
  concurrentActivity: HouseholdSizeEstimate['features']['concurrentActivity'],
  sleepZones: HouseholdSizeEstimate['features']['recurringSleepZones'],
  routineClusters: HouseholdSizeEstimate['features']['routineClusters'],
  residentSlots: HouseholdSizeEstimate['features']['residentSlots'],
  sharedSleepZones: HouseholdSizeEstimate['features']['sharedSleepZones'],
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
  if (residentSlots.count > 0) {
    evidence.push(`${residentSlots.count} resident slot${residentSlots.count === 1 ? '' : 's'}`);
  }
  if (sharedSleepZones.count > 0 && sharedSleepZones.strength !== 'none') {
    evidence.push(`${sharedSleepZones.strength} shared main sleep-zone candidate`);
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

function isSharedOccupancyField(field: string): boolean {
  const normalizedField = normalize(field);
  return (
    normalizedField.includes('occupancycount') ||
    normalizedField.includes('personcount') ||
    normalizedField.includes('peoplecount') ||
    normalizedField.includes('sleepercount') ||
    normalizedField.includes('bedside') ||
    normalizedField.includes('side')
  );
}

function isBedroomLikeRoom(roomId: string): boolean {
  return roomId.includes('bedroom');
}

function isMainSleepRoom(roomId: string): boolean {
  const normalizedRoom = normalize(roomId);
  return (
    normalizedRoom.includes('masterbedroom') ||
    normalizedRoom.includes('primarybedroom') ||
    normalizedRoom.includes('mainbedroom')
  );
}

function maxNumericValue(field: { currentValue: unknown; numericMax?: number }): number {
  if (typeof field.numericMax === 'number') {
    return field.numericMax;
  }
  return typeof field.currentValue === 'number' ? field.currentValue : 0;
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

function roundScore(value: number): number {
  return Number(value.toFixed(3));
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0.01, value));
}
