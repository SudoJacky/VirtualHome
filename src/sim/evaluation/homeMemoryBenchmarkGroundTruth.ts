import type { TwinEvent } from '../../shared/types';
import type { HouseholdTemplate } from '../householdTemplate';
import type { HomeBehaviorEpisodeKind } from '../../web/homeBehaviorEpisodes';

export const homeMemoryBenchmarkPatternIds = [
  'door-lock-paired',
  'stove-range-hood-paired',
  'child-sleep-start',
  'study-weekday-daytime-work',
  'robot-vacuum-after-departure',
  'laundry-running',
  'living-evening-media'
] as const;

export const homeMemoryBenchmarkFeatureIds = [
  'feature:door_unlock_lock_pairing',
  'feature:stove_range_hood_coupling',
  'feature:early_sleep_zone_around_21',
  'feature:weekday_study_daytime_activity'
] as const;

export type HomeMemoryBenchmarkPatternId = typeof homeMemoryBenchmarkPatternIds[number];
export type HomeMemoryBenchmarkFeatureId = typeof homeMemoryBenchmarkFeatureIds[number];

export interface HomeMemoryBenchmarkGroundTruthEpisode {
  id: string;
  kind: HomeBehaviorEpisodeKind;
  roomIds: string[];
  deviceIds: string[];
  participantIds: string[];
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  sourceEventIds: string[];
  boundarySource: 'world_state' | 'truth_activity' | 'left_censored' | 'right_censored';
}

export interface HomeMemoryBenchmarkGroundTruthPattern {
  id: HomeMemoryBenchmarkPatternId;
  occurrenceTimes: string[];
  firstOccurrenceAt: string;
  dates: string[];
  count: number;
}

export interface HomeMemoryBenchmarkGroundTruthAnnotations {
  episodes: HomeMemoryBenchmarkGroundTruthEpisode[];
  patterns: HomeMemoryBenchmarkGroundTruthPattern[];
  positiveFeatureIds: HomeMemoryBenchmarkFeatureId[];
}

interface OpenStateEpisode {
  event: StateEpisodeEvent;
  kind: HomeBehaviorEpisodeKind;
  leftCensored: boolean;
}

type StateEpisodeEvent = Extract<TwinEvent, {
  type: 'DeviceStateChanged' | 'DeviceTelemetry';
}>;

const featurePatternMapping: Record<HomeMemoryBenchmarkFeatureId, HomeMemoryBenchmarkPatternId> = {
  'feature:door_unlock_lock_pairing': 'door-lock-paired',
  'feature:stove_range_hood_coupling': 'stove-range-hood-paired',
  'feature:early_sleep_zone_around_21': 'child-sleep-start',
  'feature:weekday_study_daytime_activity': 'study-weekday-daytime-work'
};

export function createHomeMemoryBenchmarkGroundTruth(
  twinEvents: TwinEvent[],
  template: HouseholdTemplate
): HomeMemoryBenchmarkGroundTruthAnnotations {
  const events = [...twinEvents].sort(compareEvents);
  const stateEpisodes = extractStateEpisodes(events);
  const activityEpisodes = extractActivityPointEpisodes(events, stateEpisodes);
  const episodes = [...stateEpisodes, ...activityEpisodes]
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id));
  const patterns = extractPatterns(events, template, episodes);
  const positivePatternIds = new Set(patterns.map((pattern) => pattern.id));

  return {
    episodes,
    patterns,
    positiveFeatureIds: homeMemoryBenchmarkFeatureIds.filter((featureId) => (
      positivePatternIds.has(featurePatternMapping[featureId])
    ))
  };
}

export function truthPatternForFeature(
  featureId: HomeMemoryBenchmarkFeatureId
): HomeMemoryBenchmarkPatternId {
  return featurePatternMapping[featureId];
}

function extractStateEpisodes(events: TwinEvent[]): HomeMemoryBenchmarkGroundTruthEpisode[] {
  const episodes: HomeMemoryBenchmarkGroundTruthEpisode[] = [];
  const openByDeviceAndKind = new Map<string, OpenStateEpisode>();
  const explicitlyObservedState = new Set<string>();

  for (const event of events) {
    if (event.type !== 'DeviceStateChanged' && event.type !== 'DeviceTelemetry') {
      continue;
    }
    for (const kind of stateEpisodeKinds(event)) {
      const key = `${event.deviceId}:${kind}`;
      if (event.type === 'DeviceTelemetry' && explicitlyObservedState.has(key)) {
        continue;
      }
      if (event.type === 'DeviceStateChanged') {
        explicitlyObservedState.add(key);
      }
      const state = episodeState(event, kind);
      const open = openByDeviceAndKind.get(key);
      if (state === 'end' && open) {
        episodes.push(createBoundedEpisode(open.event, event, kind, open.leftCensored));
        openByDeviceAndKind.delete(key);
      } else if (state === 'start' && !open) {
        openByDeviceAndKind.set(key, {
          event,
          kind,
          leftCensored: event.type === 'DeviceTelemetry'
        });
      }
    }
  }

  for (const { event, kind } of openByDeviceAndKind.values()) {
    episodes.push({
      id: `truth:${kind}:${event.id}:right-censored`,
      kind,
      roomIds: [event.roomId],
      deviceIds: [event.deviceId],
      participantIds: [],
      startedAt: event.simTime,
      endedAt: event.simTime,
      durationMinutes: 0,
      sourceEventIds: [event.id],
      boundarySource: 'right_censored'
    });
  }

  return episodes;
}

function extractActivityPointEpisodes(
  events: TwinEvent[],
  stateEpisodes: HomeMemoryBenchmarkGroundTruthEpisode[]
): HomeMemoryBenchmarkGroundTruthEpisode[] {
  const episodes: HomeMemoryBenchmarkGroundTruthEpisode[] = [];
  for (const event of events) {
    if (event.type !== 'ActivityStarted') {
      continue;
    }
    const normalizedActivity = normalize(event.activityId);
    const kind = normalizedActivity.includes('remotework')
      ? 'work_study_episode'
      : normalizedActivity.includes('meal')
        ? 'cooking_episode'
        : null;
    if (!kind) {
      continue;
    }
    const hasNearbyBoundedEpisode = stateEpisodes.some((episode) => (
      episode.kind === kind &&
      absoluteMinutesBetween(episode.startedAt, event.simTime) <= 45
    ));
    if (hasNearbyBoundedEpisode) {
      continue;
    }
    episodes.push({
      id: `truth:${kind}:${event.id}`,
      kind,
      roomIds: [event.roomId],
      deviceIds: [],
      participantIds: [...event.participants].sort((left, right) => left.localeCompare(right)),
      startedAt: event.simTime,
      endedAt: event.simTime,
      durationMinutes: 0,
      sourceEventIds: [event.id],
      boundarySource: 'truth_activity'
    });
  }
  return episodes;
}

function createBoundedEpisode(
  start: StateEpisodeEvent,
  end: StateEpisodeEvent,
  kind: HomeBehaviorEpisodeKind,
  leftCensored: boolean
): HomeMemoryBenchmarkGroundTruthEpisode {
  return {
    id: `truth:${kind}:${start.id}`,
    kind,
    roomIds: sortedUnique([start.roomId, end.roomId]),
    deviceIds: sortedUnique([start.deviceId, end.deviceId]),
    participantIds: [],
    startedAt: start.simTime,
    endedAt: end.simTime,
    durationMinutes: round(minutesBetween(start.simTime, end.simTime)),
    sourceEventIds: [start.id, end.id],
    boundarySource: leftCensored ? 'left_censored' : 'world_state'
  };
}

function stateEpisodeKinds(
  event: StateEpisodeEvent
): HomeBehaviorEpisodeKind[] {
  const deviceType = normalize(event.deviceType);
  if (deviceType.includes('doorlock')) return ['door_access_episode'];
  if (deviceType.includes('sleepsensor')) return ['sleep_episode'];
  if (deviceType.includes('stove')) return ['cooking_episode'];
  if (deviceType.includes('washer')) return ['laundry_episode'];
  if (deviceType.includes('robotvacuum')) return ['vacuum_episode'];
  if (deviceType === 'tv' || deviceType.includes('television')) return ['media_episode'];
  return [];
}

function episodeState(
  event: StateEpisodeEvent,
  kind: HomeBehaviorEpisodeKind
): 'start' | 'end' | null {
  const state = event.type === 'DeviceStateChanged' ? event.state : event.measurements;
  if (kind === 'door_access_episode') {
    const locked = stateValue(state, 'locked', 'lock');
    if (locked === false || normalize(String(locked)) === 'unlocked') return 'start';
    if (locked === true || normalize(String(locked)) === 'locked') return 'end';
  }
  if (kind === 'sleep_episode') {
    const inBed = stateValue(state, 'inbed', 'asleep', 'sleeping');
    if (inBed === true) return 'start';
    if (inBed === false) return 'end';
  }
  if (kind === 'cooking_episode') {
    return activeState(state, ['powerw', 'level', 'power']);
  }
  if (kind === 'laundry_episode') {
    return activeState(state, ['status', 'power', 'powerw'], ['running']);
  }
  if (kind === 'vacuum_episode') {
    return activeState(state, ['status'], ['cleaning']);
  }
  if (kind === 'media_episode') {
    return activeState(state, ['power'], ['on']);
  }
  return null;
}

function activeState(
  state: Record<string, string | number | boolean | null>,
  fields: string[],
  activeStrings: string[] = ['on', 'active', 'running']
): 'start' | 'end' | null {
  for (const [key, value] of Object.entries(state)) {
    if (!fields.includes(normalize(key))) {
      continue;
    }
    if (typeof value === 'number') return value > 0 ? 'start' : 'end';
    if (typeof value === 'boolean') return value ? 'start' : 'end';
    const normalized = normalize(String(value));
    if (activeStrings.includes(normalized)) return 'start';
    if (['off', 'idle', 'docked', 'charging', 'done', 'false'].includes(normalized)) return 'end';
  }
  return null;
}

function extractPatterns(
  events: TwinEvent[],
  template: HouseholdTemplate,
  episodes: HomeMemoryBenchmarkGroundTruthEpisode[]
): HomeMemoryBenchmarkGroundTruthPattern[] {
  const occurrences = new Map<HomeMemoryBenchmarkPatternId, string[]>();
  const add = (id: HomeMemoryBenchmarkPatternId, simTime: string) => {
    occurrences.set(id, [...(occurrences.get(id) ?? []), simTime]);
  };
  const childIds = new Set(template.residents
    .filter((resident) => resident.profile?.ageBand === 'child')
    .map((resident) => resident.id));
  const livingRoomIds = new Set(template.home.floors.flatMap((floor) => floor.rooms)
    .filter((room) => room.type === 'living')
    .map((room) => room.id));

  for (const episode of episodes.filter((candidate) => candidate.kind === 'door_access_episode')) {
    add('door-lock-paired', episode.startedAt);
  }

  const activeStoveEvents = events.filter((event) => (
    event.type === 'DeviceStateChanged' &&
    normalize(event.deviceType).includes('stove') &&
    episodeState(event, 'cooking_episode') === 'start'
  ));
  const activeHoodEvents = events.filter((event) => (
    event.type === 'DeviceStateChanged' &&
    normalize(event.deviceType).includes('rangehood') &&
    activeState(event.state, ['power', 'speed']) === 'start'
  ));
  for (const stove of activeStoveEvents) {
    const hood = activeHoodEvents.find((candidate) => (
      candidate.simTime.slice(0, 10) === stove.simTime.slice(0, 10) &&
      absoluteMinutesBetween(candidate.simTime, stove.simTime) <= 5
    ));
    if (hood) add('stove-range-hood-paired', laterTime(stove.simTime, hood.simTime));
  }

  for (const event of events) {
    if (event.type === 'ActivityStarted') {
      const activity = normalize(event.activityId);
      if (
        activity.includes('sleep') &&
        event.participants.some((participant) => childIds.has(participant)) &&
        minuteOfDay(event.simTime) >= 20 * 60 + 30 &&
        minuteOfDay(event.simTime) <= 22 * 60
      ) {
        add('child-sleep-start', event.simTime);
      }
      if (
        activity.includes('remotework') &&
        !isWeekend(event.simTime) &&
        minuteOfDay(event.simTime) >= 8 * 60 &&
        minuteOfDay(event.simTime) <= 17 * 60
      ) {
        add('study-weekday-daytime-work', event.simTime);
      }
    }
    if (event.type !== 'DeviceStateChanged') {
      continue;
    }
    const deviceType = normalize(event.deviceType);
    if (deviceType.includes('washer') && episodeState(event, 'laundry_episode') === 'start') {
      add('laundry-running', event.simTime);
    }
    if (
      (deviceType === 'tv' || deviceType.includes('television')) &&
      livingRoomIds.has(event.roomId) &&
      episodeState(event, 'media_episode') === 'start' &&
      (minuteOfDay(event.simTime) >= 17 * 60 || isWeekend(event.simTime))
    ) {
      add('living-evening-media', event.simTime);
    }
    if (
      deviceType.includes('robotvacuum') &&
      episodeState(event, 'vacuum_episode') === 'start' &&
      hasRecentDeparture(events, event)
    ) {
      add('robot-vacuum-after-departure', event.simTime);
    }
  }

  return homeMemoryBenchmarkPatternIds.flatMap((id) => {
    const times = sortedUnique(occurrences.get(id) ?? []);
    if (times.length === 0) {
      return [];
    }
    return [{
      id,
      occurrenceTimes: times,
      firstOccurrenceAt: times[0],
      dates: sortedUnique(times.map((time) => time.slice(0, 10))),
      count: times.length
    }];
  });
}

function hasRecentDeparture(
  events: TwinEvent[],
  vacuumEvent: Extract<TwinEvent, { type: 'DeviceStateChanged' }>
): boolean {
  return events.some((event) => {
    const gap = minutesBetween(event.simTime, vacuumEvent.simTime);
    if (gap < 0 || gap > 45) {
      return false;
    }
    if (event.type === 'PersonMoved') {
      return event.to === 'away';
    }
    return event.type === 'DeviceStateChanged' &&
      normalize(event.deviceType).includes('doorlock') &&
      episodeState(event, 'door_access_episode') === 'end' &&
      normalize(event.reason ?? '').includes('departure');
  });
}

function stateValue(
  state: Record<string, string | number | boolean | null>,
  ...normalizedKeys: string[]
): string | number | boolean | null | undefined {
  return Object.entries(state)
    .find(([key]) => normalizedKeys.includes(normalize(key)))
    ?.[1];
}

function compareEvents(left: TwinEvent, right: TwinEvent): number {
  return left.simTime.localeCompare(right.simTime) ||
    left.sequence - right.sequence ||
    left.id.localeCompare(right.id);
}

function minuteOfDay(simTime: string): number {
  const match = /T(\d{2}):(\d{2})/.exec(simTime);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function isWeekend(simTime: string): boolean {
  const date = new Date(`${simTime.slice(0, 10)}T00:00:00.000Z`);
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function laterTime(left: string, right: string): string {
  return left >= right ? left : right;
}

function minutesBetween(start: string, end: string): number {
  return (Date.parse(end) - Date.parse(start)) / 60000;
}

function absoluteMinutesBetween(left: string, right: string): number {
  return Math.abs(minutesBetween(left, right));
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function normalize(value: string): string {
  return value.replace(/[_\s-]+/g, '').toLowerCase();
}
