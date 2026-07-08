import type { HomeMemory, MemoryEvidence } from './homeMemoryModel';

export type HomeBehaviorEpisodeKind =
  | 'door_access_episode'
  | 'cooking_episode'
  | 'sleep_episode'
  | 'work_study_episode'
  | 'laundry_episode'
  | 'vacuum_episode'
  | 'media_episode';

export interface HomeBehaviorEpisode {
  id: string;
  kind: HomeBehaviorEpisodeKind;
  roomIds: string[];
  deviceIds: string[];
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  features: Record<string, number | string | boolean>;
  evidenceIds: string[];
}

export function extractHomeBehaviorEpisodes(memory: HomeMemory): HomeBehaviorEpisode[] {
  const evidence = collectEpisodeEvidence(memory)
    .filter((event) => event.profileWeight > 0)
    .sort(compareEvidenceAsc);

  return dedupeEpisodes([
    ...extractDoorAccessEpisodes(evidence),
    ...extractStateEpisodes(evidence, 'sleep_episode', isSleepStart, isSleepEnd, sleepFeatures),
    ...extractPatternStartEpisodes(evidence, 'sleep_episode', isSleepStart, sleepFeatures),
    ...extractCookingEpisodes(evidence),
    ...extractWorkStudyEpisodes(evidence),
    ...extractStateEpisodes(evidence, 'laundry_episode', isLaundryStart, isLaundryEnd, () => ({ activity: 'laundry' })),
    ...extractPatternStartEpisodes(evidence, 'laundry_episode', isLaundryStart, () => ({ activity: 'laundry' })),
    ...extractStateEpisodes(evidence, 'vacuum_episode', isVacuumStart, isVacuumEnd, () => ({ activity: 'vacuum' })),
    ...extractPatternStartEpisodes(evidence, 'vacuum_episode', isVacuumStart, () => ({ activity: 'vacuum' })),
    ...extractStateEpisodes(evidence, 'media_episode', isMediaStart, isMediaEnd, () => ({ activity: 'media' })),
    ...extractPatternStartEpisodes(evidence, 'media_episode', isMediaStart, () => ({ activity: 'media' }))
  ]).sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id));
}

function collectEpisodeEvidence(memory: HomeMemory): MemoryEvidence[] {
  const byId = new Map<string, MemoryEvidence>();
  for (const event of memory.recentEvents) {
    byId.set(event.id, event);
  }
  for (const pattern of Object.values(memory.profilePatterns)) {
    for (const event of pattern.evidence) {
      byId.set(event.id, event);
    }
  }
  return [...byId.values()];
}

function extractDoorAccessEpisodes(evidence: MemoryEvidence[]): HomeBehaviorEpisode[] {
  const episodes: HomeBehaviorEpisode[] = [];
  const doorEvidence = evidence.filter(isDoorEvidence);

  for (let index = 0; index < doorEvidence.length; index += 1) {
    const start = doorEvidence[index];
    if (!isDoorUnlock(start) && !isDoorContactOpen(start)) {
      continue;
    }
    const window = doorEvidence.filter((event) => minutesBetween(start.simTime, event.simTime) >= 0 && minutesBetween(start.simTime, event.simTime) <= 20);
    const end = window.find((event) => event !== start && isDoorLock(event));
    if (!end) {
      continue;
    }
    const episodeEvidence = window.filter((event) => event.simTime <= end.simTime);
    episodes.push(createEpisode('door_access_episode', episodeEvidence, {
      hasUnlock: episodeEvidence.some(isDoorUnlock),
      hasLock: episodeEvidence.some(isDoorLock),
      contactTransitions: episodeEvidence.filter(isDoorContactEvidence).length
    }));
  }

  return episodes;
}

function extractCookingEpisodes(evidence: MemoryEvidence[]): HomeBehaviorEpisode[] {
  const episodes: HomeBehaviorEpisode[] = [];
  const anchors = evidence.filter(isCookingAnchor);

  for (const anchor of anchors) {
    const nearby = evidence.filter((event) => (
      normalize(event.roomId).includes('kitchen') &&
      Math.abs(minutesBetween(anchor.simTime, event.simTime)) <= 45 &&
      (isCookingContext(event) || isCookingAnchor(event))
    ));
    if (!nearby.some(isRangeHoodEvidence)) {
      continue;
    }
    episodes.push(createEpisode('cooking_episode', nearby, {
      hasStove: nearby.some(isStoveEvidence),
      hasRangeHood: nearby.some(isRangeHoodEvidence),
      deviceCount: sortedUnique(nearby.map((event) => event.deviceId)).length
    }));
  }

  return episodes;
}

function extractWorkStudyEpisodes(evidence: MemoryEvidence[]): HomeBehaviorEpisode[] {
  const byDate = new Map<string, MemoryEvidence[]>();
  for (const event of evidence.filter(isWorkStudyEvidence)) {
    const date = event.simTime.slice(0, 10);
    byDate.set(date, [...(byDate.get(date) ?? []), event]);
  }

  return [...byDate.values()]
    .filter((items) => items.length >= 2)
    .map((items) => createEpisode('work_study_episode', items, {
      activity: 'work_study',
      weekday: !isWeekend(items[0].simTime),
      deviceCount: sortedUnique(items.map((event) => event.deviceId)).length
    }));
}

function extractPatternStartEpisodes(
  evidence: MemoryEvidence[],
  kind: HomeBehaviorEpisodeKind,
  isStart: (event: MemoryEvidence) => boolean,
  features: (items: MemoryEvidence[]) => Record<string, number | string | boolean>
): HomeBehaviorEpisode[] {
  return evidence
    .filter(isStart)
    .map((event) => createEpisode(kind, [event], features([event])));
}

function extractStateEpisodes(
  evidence: MemoryEvidence[],
  kind: HomeBehaviorEpisodeKind,
  isStart: (event: MemoryEvidence) => boolean,
  isEnd: (event: MemoryEvidence, start: MemoryEvidence) => boolean,
  features: (items: MemoryEvidence[]) => Record<string, number | string | boolean>
): HomeBehaviorEpisode[] {
  const episodes: HomeBehaviorEpisode[] = [];
  const openByDevice = new Map<string, MemoryEvidence>();

  for (const event of evidence) {
    const open = openByDevice.get(event.deviceId);
    if (open && isEnd(event, open)) {
      const items = evidence.filter((candidate) => (
        candidate.deviceId === event.deviceId &&
        candidate.simTime >= open.simTime &&
        candidate.simTime <= event.simTime
      ));
      episodes.push(createEpisode(kind, items, features(items)));
      openByDevice.delete(event.deviceId);
      continue;
    }

    if (!open && isStart(event)) {
      openByDevice.set(event.deviceId, event);
    }
  }

  return episodes;
}

function createEpisode(
  kind: HomeBehaviorEpisodeKind,
  evidence: MemoryEvidence[],
  features: Record<string, number | string | boolean>
): HomeBehaviorEpisode {
  const sorted = [...evidence].sort(compareEvidenceAsc);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  return {
    id: `behavior:${kind}:${first.deviceId}:${first.simTime}`,
    kind,
    roomIds: sortedUnique(sorted.map((event) => event.roomId)),
    deviceIds: sortedUnique(sorted.map((event) => event.deviceId)),
    startedAt: first.simTime,
    endedAt: last.simTime,
    durationMinutes: Math.max(0, Number(minutesBetween(first.simTime, last.simTime).toFixed(3))),
    features,
    evidenceIds: sortedUnique(sorted.map((event) => event.id))
  };
}

function dedupeEpisodes(episodes: HomeBehaviorEpisode[]): HomeBehaviorEpisode[] {
  const seen = new Set<string>();
  const deduped: HomeBehaviorEpisode[] = [];

  for (const episode of episodes) {
    const key = `${episode.kind}:${episode.startedAt}:${episode.deviceIds.join(',')}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(episode);
    }
  }

  return deduped;
}

function compareEvidenceAsc(left: MemoryEvidence, right: MemoryEvidence): number {
  return left.simTime.localeCompare(right.simTime) || left.sequence - right.sequence || left.id.localeCompare(right.id);
}

function isDoorEvidence(event: MemoryEvidence): boolean {
  return normalize(event.deviceType).includes('doorlock') || normalize(event.roomId).includes('entrance');
}

function isDoorUnlock(event: MemoryEvidence): boolean {
  const field = normalize(event.field);
  return (field === 'locked' && event.value === false) || (field === 'lock' && normalize(String(event.value)) === 'unlocked');
}

function isDoorLock(event: MemoryEvidence): boolean {
  const field = normalize(event.field);
  return (field === 'locked' && event.value === true) || (field === 'lock' && normalize(String(event.value)) === 'locked');
}

function isDoorContactEvidence(event: MemoryEvidence): boolean {
  return normalize(event.field).includes('contactopen');
}

function isDoorContactOpen(event: MemoryEvidence): boolean {
  return isDoorContactEvidence(event) && event.value === true;
}

function isSleepStart(event: MemoryEvidence): boolean {
  return normalize(event.deviceType).includes('sleep') && isInBedField(event.field) && event.value === true;
}

function isSleepEnd(event: MemoryEvidence): boolean {
  return normalize(event.deviceType).includes('sleep') && isInBedField(event.field) && event.value === false;
}

function sleepFeatures(items: MemoryEvidence[]): Record<string, number | string | boolean> {
  return {
    sleepRoom: items[0]?.roomId ?? '',
    sleepDevice: items[0]?.deviceId ?? ''
  };
}

function isCookingAnchor(event: MemoryEvidence): boolean {
  return isStoveEvidence(event) && isActiveNumericOrState(event);
}

function isCookingContext(event: MemoryEvidence): boolean {
  return isFridgeEvidence(event) || isRangeHoodEvidence(event) || isCookingAnchor(event);
}

function isStoveEvidence(event: MemoryEvidence): boolean {
  return normalize(event.deviceType).includes('stove') || normalize(event.deviceId).includes('stove');
}

function isRangeHoodEvidence(event: MemoryEvidence): boolean {
  const device = normalize(`${event.deviceType}:${event.deviceId}`);
  return device.includes('rangehood') || device.includes('hood');
}

function isFridgeEvidence(event: MemoryEvidence): boolean {
  return normalize(event.deviceType).includes('fridge') || normalize(event.deviceId).includes('fridge');
}

function isWorkStudyEvidence(event: MemoryEvidence): boolean {
  const room = normalize(event.roomId);
  const deviceType = normalize(event.deviceType);
  const field = normalize(event.field);
  return (
    room.includes('study') &&
    isActiveNumericOrState(event) &&
    (deviceType.includes('router') || deviceType.includes('light') || field.includes('online') || field.includes('latency'))
  );
}

function isLaundryStart(event: MemoryEvidence): boolean {
  return normalize(event.deviceType).includes('washer') && isActiveNumericOrState(event);
}

function isLaundryEnd(event: MemoryEvidence): boolean {
  return normalize(event.deviceType).includes('washer') && isInactiveState(event);
}

function isVacuumStart(event: MemoryEvidence): boolean {
  return normalize(event.deviceType).includes('robotvacuum') && normalize(String(event.value)) === 'cleaning';
}

function isVacuumEnd(event: MemoryEvidence): boolean {
  return normalize(event.deviceType).includes('robotvacuum') && ['docked', 'idle', 'charging'].includes(normalize(String(event.value)));
}

function isMediaStart(event: MemoryEvidence): boolean {
  return normalize(event.deviceType).includes('tv') && normalize(event.field) === 'power' && normalize(String(event.value)) === 'on';
}

function isMediaEnd(event: MemoryEvidence): boolean {
  return normalize(event.deviceType).includes('tv') && normalize(event.field) === 'power' && normalize(String(event.value)) === 'off';
}

function isActiveNumericOrState(event: MemoryEvidence): boolean {
  if (typeof event.value === 'number') {
    return event.value > 0;
  }
  const value = normalize(String(event.value));
  return value === 'on' || value === 'open' || value === 'running' || value === 'cleaning' || value === 'active' || value === 'true';
}

function isInactiveState(event: MemoryEvidence): boolean {
  if (typeof event.value === 'number') {
    return event.value === 0;
  }
  const value = normalize(String(event.value));
  return value === 'off' || value === 'closed' || value === 'idle' || value === 'docked' || value === 'false';
}

function isInBedField(field: string): boolean {
  const normalized = normalize(field);
  return normalized === 'inbed' || normalized === 'asleep' || normalized === 'sleeping';
}

function isWeekend(simTime: string): boolean {
  const date = new Date(`${simTime.slice(0, 10)}T00:00:00.000Z`);
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function minutesBetween(start: string, end: string): number {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return Number.POSITIVE_INFINITY;
  }
  return (endMs - startMs) / 60000;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalize(value: string): string {
  return value.replace(/[_\s-]+/g, '').toLowerCase();
}
