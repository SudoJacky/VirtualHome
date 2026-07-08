import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { extractHomeBehaviorEpisodes } from '../src/web/homeBehaviorEpisodes';
import { extractHomeInferenceFeatures } from '../src/web/homeInferenceFeatures';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';

function homeMemoryDaysEvents(): DeviceValueEvent[] {
  const dataset = JSON.parse(readFileSync('data/home-memory-days.json', 'utf8')) as { events: DeviceValueEvent[] };
  return dataset.events;
}

describe('home memory inference features', () => {
  it('extracts reusable lower-level features from behavior episodes', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), homeMemoryDaysEvents());
    const episodes = extractHomeBehaviorEpisodes(memory);
    const features = extractHomeInferenceFeatures(memory, episodes);
    const byId = new Map(features.map((feature) => [feature.id, feature]));

    expect(byId.get('feature:door_unlock_lock_pairing')).toMatchObject({
      type: 'sequence_chain',
      strength: 'strong'
    });
    expect(byId.get('feature:stove_range_hood_coupling')).toMatchObject({
      type: 'device_coupling',
      strength: 'strong'
    });
    expect(byId.get('feature:child_bedroom_sleep_around_21')).toMatchObject({
      type: 'recurring_time_window',
      strength: 'strong'
    });
    expect(byId.get('feature:weekday_study_daytime_activity')).toMatchObject({
      type: 'recurring_time_window',
      strength: 'strong'
    });

    for (const feature of features) {
      expect(feature.confidence).toBeGreaterThan(0);
      expect(feature.confidence).toBeLessThanOrEqual(1);
      expect(feature.evidenceIds.length).toBeGreaterThan(0);
      expect(feature.summary.length).toBeGreaterThan(0);
      expect(feature.scope.dateRange.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(feature.scope.dateRange.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  }, 60_000);

  it('keeps feature summaries independent of profile answer labels', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), homeMemoryDaysEvents());
    const features = extractHomeInferenceFeatures(memory, extractHomeBehaviorEpisodes(memory));
    const serialized = JSON.stringify(features);

    expect(serialized).not.toMatch(/student|adult_|child_1|persona|three-person|three residents/i);
    expect(features.find((feature) => feature.id === 'feature:child_bedroom_sleep_around_21')?.summary)
      .toMatch(/child_bedroom.*21/i);
  }, 60_000);
});
