import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { extractHomeBehaviorEpisodes } from '../src/web/homeBehaviorEpisodes';
import { extractHomeInferenceFeatures } from '../src/web/homeInferenceFeatures';
import { extractHomeRoleSlots } from '../src/web/homeRoleSlots';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';

function homeMemoryDaysEvents(): DeviceValueEvent[] {
  const dataset = JSON.parse(readFileSync('data/home-memory-days.json', 'utf8')) as { events: DeviceValueEvent[] };
  return dataset.events;
}

describe('home memory role slots', () => {
  it('generates anonymous role slots from lower-level features', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), homeMemoryDaysEvents());
    const episodes = extractHomeBehaviorEpisodes(memory);
    const features = extractHomeInferenceFeatures(memory, episodes);
    const slots = extractHomeRoleSlots(memory, features);
    const byKind = new Map(slots.map((slot) => [slot.kind, slot]));

    expect(byKind.get('child_sleep_slot')).toMatchObject({
      confidence: expect.any(Number),
      supportingFeatureIds: expect.arrayContaining(['feature:early_sleep_zone_around_21'])
    });
    expect(byKind.get('main_sleep_slot')).toMatchObject({
      confidence: expect.any(Number)
    });
    expect(byKind.get('remote_work_slot')).toMatchObject({
      supportingFeatureIds: expect.arrayContaining(['feature:weekday_study_daytime_activity'])
    });
    expect(byKind.get('departure_return_slot')).toMatchObject({
      supportingFeatureIds: expect.arrayContaining(['feature:door_unlock_lock_pairing'])
    });
    expect(byKind.get('dinner_prep_slot')).toMatchObject({
      supportingFeatureIds: expect.arrayContaining(['feature:stove_range_hood_coupling'])
    });
    expect(byKind.get('commuter_adult_like_slot')).toMatchObject({
      supportingFeatureIds: expect.arrayContaining([
        'feature:door_unlock_lock_pairing',
        'pattern:main-sleep-start',
        'pattern:weekday-breakfast-fridge',
        'pattern:robot-vacuum-after-departure'
      ])
    });
    expect(byKind.get('daytime_home_work_slot')).toMatchObject({
      supportingFeatureIds: expect.arrayContaining([
        'feature:weekday_study_daytime_activity',
        'pattern:laundry-running',
        'pattern:dinner-stove'
      ])
    });
    expect(byKind.get('child_activity_slot')).toMatchObject({
      supportingFeatureIds: expect.arrayContaining([
        'feature:early_sleep_zone_around_21',
        'feature:door_unlock_lock_pairing'
      ])
    });
    expect(byKind.get('pet_activity_candidate')).toMatchObject({
      supportingFeatureIds: expect.arrayContaining([
        'pattern:garden-camera-motion',
        'pattern:garden-summer-morning-sprinkler'
      ])
    });

    for (const slot of slots) {
      expect(slot.id).toMatch(/^role-slot:/);
      expect(slot.confidence).toBeGreaterThan(0);
      expect(slot.confidence).toBeLessThanOrEqual(1);
      expect(slot.supportingFeatureIds.length).toBeGreaterThan(0);
      expect(Array.isArray(slot.contradictingFeatureIds)).toBe(true);
      expect(slot.missingEvidence.length).toBeGreaterThan(0);
      expect(slot.alternativeExplanations.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('keeps role slots anonymous while exposing useful resident-role tendencies', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), homeMemoryDaysEvents());
    const slots = extractHomeRoleSlots(memory, extractHomeInferenceFeatures(memory, extractHomeBehaviorEpisodes(memory)));
    const serialized = JSON.stringify(slots);

    expect(serialized).not.toMatch(/adult_[0-9]+|child_1|persona/i);
    expect(serialized).toMatch(/commuter_adult_like_slot/);
    expect(serialized).toMatch(/daytime_home_work_slot/);
    expect(serialized).toMatch(/child_activity_slot/);

    const childSleepSlot = slots.find((slot) => slot.kind === 'child_sleep_slot');
    expect(childSleepSlot?.alternativeExplanations.join(' ')).toMatch(/not identify|does not identify|same resident/i);

    const remoteWorkSlot = slots.find((slot) => slot.kind === 'remote_work_slot');
    expect(remoteWorkSlot?.missingEvidence.join(' ')).toMatch(/identity|person/i);
  }, 60_000);
});
