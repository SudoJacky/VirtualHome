import { extractHomeBehaviorEpisodes, type HomeBehaviorEpisode, type HomeBehaviorEpisodeKind } from './homeBehaviorEpisodes';
import type { HomeMemory, TimeBucket } from './homeMemoryModel';

export type HomeInferenceFeatureType =
  | 'recurring_time_window'
  | 'sequence_chain'
  | 'co_occurrence'
  | 'weekday_weekend_delta'
  | 'room_transition'
  | 'device_coupling'
  | 'cadence'
  | 'duration_distribution'
  | 'anomaly_against_baseline';

export type HomeInferenceFeatureStrength = 'weak' | 'medium' | 'strong';

export interface HomeFeatureScope {
  dateRange: { from: string; to: string };
  dayTypes?: Array<'weekday' | 'weekend'>;
  timeBuckets?: TimeBucket[];
  rooms?: string[];
  devices?: string[];
  episodeKinds?: HomeBehaviorEpisodeKind[];
}

export interface HomeInferenceFeature {
  id: string;
  type: HomeInferenceFeatureType;
  scope: HomeFeatureScope;
  strength: HomeInferenceFeatureStrength;
  confidence: number;
  evidenceIds: string[];
  summary: string;
}

export function extractHomeInferenceFeatures(
  memory: HomeMemory,
  episodes: HomeBehaviorEpisode[] = extractHomeBehaviorEpisodes(memory)
): HomeInferenceFeature[] {
  return [
    doorPairingFeature(episodes),
    stoveRangeHoodFeature(episodes),
    childBedroomSleepFeature(memory, episodes),
    weekdayStudyFeature(memory, episodes)
  ].filter((feature): feature is HomeInferenceFeature => Boolean(feature));
}

function doorPairingFeature(episodes: HomeBehaviorEpisode[]): HomeInferenceFeature | null {
  const matches = episodes.filter((episode) => episode.kind === 'door_access_episode' && episode.features.hasUnlock === true && episode.features.hasLock === true);
  if (matches.length === 0) {
    return null;
  }

  return featureFromEpisodes({
    id: 'feature:door_unlock_lock_pairing',
    type: 'sequence_chain',
    episodes: matches,
    summary: `Door access episodes show unlock-to-lock pairing across ${observedDayCount(matches)} observed day${plural(observedDayCount(matches))}.`
  });
}

function stoveRangeHoodFeature(episodes: HomeBehaviorEpisode[]): HomeInferenceFeature | null {
  const matches = episodes.filter((episode) => (
    episode.kind === 'cooking_episode' &&
    episode.features.hasStove === true &&
    episode.features.hasRangeHood === true
  ));
  if (matches.length === 0) {
    return null;
  }

  return featureFromEpisodes({
    id: 'feature:stove_range_hood_coupling',
    type: 'device_coupling',
    episodes: matches,
    summary: `Kitchen cooking episodes couple a stove with a range hood across ${observedDayCount(matches)} observed day${plural(observedDayCount(matches))}.`
  });
}

function childBedroomSleepFeature(memory: HomeMemory, episodes: HomeBehaviorEpisode[]): HomeInferenceFeature | null {
  const matches = episodes.filter((episode) => episode.kind === 'sleep_episode' && episode.roomIds.includes('child_bedroom'));
  if (matches.length === 0) {
    return null;
  }
  const medianStart = formatMinuteOfDay(median(matches.map((episode) => minuteOfDay(episode.startedAt))));
  const observedDays = Math.max(observedDayCount(matches), patternDayCount(memory, 'child-sleep-start'));

  return featureFromEpisodes({
    id: 'feature:child_bedroom_sleep_around_21',
    type: 'recurring_time_window',
    episodes: matches,
    supportCount: observedDays,
    summary: `child_bedroom sleep episodes start around ${medianStart} across ${observedDays} observed day${plural(observedDays)}.`
  });
}

function weekdayStudyFeature(memory: HomeMemory, episodes: HomeBehaviorEpisode[]): HomeInferenceFeature | null {
  const matches = episodes.filter((episode) => episode.kind === 'work_study_episode' && !isWeekend(episode.startedAt));
  if (matches.length === 0) {
    return null;
  }
  const medianStart = formatMinuteOfDay(median(matches.map((episode) => minuteOfDay(episode.startedAt))));
  const observedDays = Math.max(observedDayCount(matches), patternDayCount(memory, 'study-weekday-daytime-work'));

  return featureFromEpisodes({
    id: 'feature:weekday_study_daytime_activity',
    type: 'recurring_time_window',
    episodes: matches,
    supportCount: observedDays,
    summary: `Study-room weekday activity appears around ${medianStart} across ${observedDays} observed weekday${plural(observedDays)}.`
  });
}

function featureFromEpisodes(input: {
  id: string;
  type: HomeInferenceFeatureType;
  episodes: HomeBehaviorEpisode[];
  supportCount?: number;
  summary: string;
}): HomeInferenceFeature {
  const evidenceIds = sortedUnique(input.episodes.flatMap((episode) => episode.evidenceIds));
  const count = input.supportCount ?? input.episodes.length;

  return {
    id: input.id,
    type: input.type,
    scope: scopeForEpisodes(input.episodes),
    strength: strengthForCount(count),
    confidence: confidenceForCount(count),
    evidenceIds,
    summary: input.summary
  };
}

function scopeForEpisodes(episodes: HomeBehaviorEpisode[]): HomeFeatureScope {
  const dates = sortedUnique(episodes.map((episode) => episode.startedAt.slice(0, 10)));
  const dayTypes = sortedUnique(episodes.map((episode) => isWeekend(episode.startedAt) ? 'weekend' : 'weekday')) as Array<'weekday' | 'weekend'>;
  const timeBuckets = sortedUnique(episodes.map((episode) => timeBucketForMinute(minuteOfDay(episode.startedAt)))) as TimeBucket[];
  const rooms = sortedUnique(episodes.flatMap((episode) => episode.roomIds));
  const devices = sortedUnique(episodes.flatMap((episode) => episode.deviceIds));
  const episodeKinds = sortedUnique(episodes.map((episode) => episode.kind)) as HomeBehaviorEpisodeKind[];

  return {
    dateRange: {
      from: dates[0] ?? 'unknown',
      to: dates[dates.length - 1] ?? 'unknown'
    },
    ...(dayTypes.length > 0 ? { dayTypes } : {}),
    ...(timeBuckets.length > 0 ? { timeBuckets } : {}),
    ...(rooms.length > 0 ? { rooms } : {}),
    ...(devices.length > 0 ? { devices } : {}),
    ...(episodeKinds.length > 0 ? { episodeKinds } : {})
  };
}

function observedDayCount(episodes: HomeBehaviorEpisode[]): number {
  return sortedUnique(episodes.map((episode) => episode.startedAt.slice(0, 10))).length;
}

function patternDayCount(memory: HomeMemory, patternId: string): number {
  return memory.profilePatterns[patternId]?.dates.length ?? 0;
}

function strengthForCount(count: number): HomeInferenceFeatureStrength {
  if (count >= 5) {
    return 'strong';
  }
  if (count >= 3) {
    return 'medium';
  }
  return 'weak';
}

function confidenceForCount(count: number): number {
  return Math.min(0.95, Number((0.35 + Math.min(0.6, count / 12)).toFixed(3)));
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function minuteOfDay(simTime: string): number {
  const match = /T(\d{2}):(\d{2})/.exec(simTime);
  if (!match) {
    return 0;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatMinuteOfDay(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function timeBucketForMinute(minute: number): TimeBucket {
  if (minute >= 5 * 60 && minute < 12 * 60) {
    return 'morning';
  }
  if (minute >= 12 * 60 && minute < 17 * 60) {
    return 'daytime';
  }
  if (minute >= 17 * 60 && minute < 21 * 60) {
    return 'evening';
  }
  return 'night';
}

function isWeekend(simTime: string): boolean {
  const date = new Date(`${simTime.slice(0, 10)}T00:00:00.000Z`);
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function plural(count: number): string {
  return count === 1 ? '' : 's';
}
