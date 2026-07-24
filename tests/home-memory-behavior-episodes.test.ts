import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { extractHomeBehaviorEpisodes } from '../src/web/homeBehaviorEpisodes';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';

function homeMemoryDaysEvents(): DeviceValueEvent[] {
  const dataset = JSON.parse(readFileSync('data/home-memory-days.json', 'utf8')) as { events: DeviceValueEvent[] };
  return dataset.events;
}

describe('home memory behavior episodes', () => {
  it('extracts explicit behavior episodes from home-memory-days without persona truth fields', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), homeMemoryDaysEvents());
    const episodes = extractHomeBehaviorEpisodes(memory);
    const kinds = new Set(episodes.map((episode) => episode.kind));

    expect([...kinds]).toEqual(expect.arrayContaining([
      'door_access_episode',
      'cooking_episode',
      'sleep_episode',
      'work_study_episode',
      'laundry_episode',
      'vacuum_episode',
      'media_episode'
    ]));

    for (const episode of episodes) {
      expect(episode.id).toMatch(/^behavior:/);
      expect(episode.roomIds.length).toBeGreaterThan(0);
      expect(episode.deviceIds.length).toBeGreaterThan(0);
      expect(episode.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(episode.endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(episode.durationMinutes).toBeGreaterThanOrEqual(0);
      expect(Object.keys(episode.features).length).toBeGreaterThan(0);
      expect(episode.evidenceIds.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('keeps behavior episodes grounded in device evidence and not profile conclusions', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), homeMemoryDaysEvents());
    const evidenceIds = new Set(Object.keys(memory.evidenceFacts));
    const episodes = extractHomeBehaviorEpisodes(memory);

    const doorAccess = episodes.find((episode) => episode.kind === 'door_access_episode');
    expect(doorAccess?.features).toMatchObject({
      hasUnlock: true,
      hasLock: true
    });

    const cooking = episodes.find((episode) => episode.kind === 'cooking_episode');
    expect(cooking?.deviceIds).toEqual(expect.arrayContaining(['stove_01', 'range_hood_01']));

    const sleep = episodes.find((episode) => episode.kind === 'sleep_episode');
    expect(sleep?.features).toHaveProperty('sleepRoom');

    for (const episode of episodes) {
      expect(episode.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true);
      expect(JSON.stringify(episode)).not.toMatch(/adult_|child_1|student|persona/i);
    }
  }, 60_000);
});
