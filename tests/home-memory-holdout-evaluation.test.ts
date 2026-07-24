import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { evaluateHomeProfileHoldouts } from '../src/web/homeProfileEvaluation';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';

function homeMemoryDaysEvents(): DeviceValueEvent[] {
  const dataset = JSON.parse(readFileSync('data/home-memory-days.json', 'utf8')) as { events: DeviceValueEvent[] };
  return dataset.events.filter((event) => event.simTime.slice(0, 10) >= '2026-07-28');
}

function memoryFromEvents(events: DeviceValueEvent[]) {
  return reduceDeviceEvents(createHomeMemory(), events);
}

describe('home memory holdout and counterfactual evaluation', () => {
  it('keeps standard role signals while detecting removed-evidence counterfactuals', () => {
    const events = homeMemoryDaysEvents();
    const report = evaluateHomeProfileHoldouts({
      standard: {
        id: 'home-memory-days',
        memory: memoryFromEvents(events),
        expectedFeatureIds: [
          'feature:door_unlock_lock_pairing',
          'feature:stove_range_hood_coupling',
          'feature:early_sleep_zone_around_21',
          'feature:weekday_study_daytime_activity'
        ],
        expectedRoleSlotKinds: [
          'child_sleep_slot',
          'remote_work_slot',
          'dinner_prep_slot',
          'departure_return_slot'
        ]
      },
      counterfactuals: [
        {
          id: 'without-child-sleep',
          memory: memoryFromEvents(events.filter((event) => event.deviceId !== 'child_sleep_01' && event.roomId !== 'child_bedroom')),
          absentFeatureIds: ['feature:early_sleep_zone_around_21'],
          absentRoleSlotKinds: ['child_sleep_slot']
        },
        {
          id: 'without-range-hood',
          memory: memoryFromEvents(events.filter((event) => event.deviceId !== 'range_hood_01')),
          absentFeatureIds: ['feature:stove_range_hood_coupling'],
          absentRoleSlotKinds: ['dinner_prep_slot']
        }
      ]
    });

    expect(report.passed).toBe(true);
    expect(report.standard.violations).toEqual([]);
    expect(report.standard.featureIds).toEqual(expect.arrayContaining([
      'feature:door_unlock_lock_pairing',
      'feature:stove_range_hood_coupling',
      'feature:early_sleep_zone_around_21',
      'feature:weekday_study_daytime_activity'
    ]));
    expect(report.standard.roleSlotKinds).toEqual(expect.arrayContaining([
      'child_sleep_slot',
      'remote_work_slot',
      'dinner_prep_slot',
      'departure_return_slot'
    ]));

    const noChildSleep = report.counterfactuals.find((entry) => entry.id === 'without-child-sleep');
    expect(noChildSleep?.violations).toEqual([]);
    expect(noChildSleep?.featureIds).not.toContain('feature:early_sleep_zone_around_21');
    expect(noChildSleep?.roleSlotKinds).not.toContain('child_sleep_slot');
    expect(JSON.stringify(noChildSleep?.claims)).not.toMatch(/child sleep slot/i);

    const noRangeHood = report.counterfactuals.find((entry) => entry.id === 'without-range-hood');
    expect(noRangeHood?.violations).toEqual([]);
    expect(noRangeHood?.featureIds).not.toContain('feature:stove_range_hood_coupling');
    expect(noRangeHood?.roleSlotKinds).not.toContain('dinner_prep_slot');
  }, 60_000);

  it('reports calibration warnings for overconfident or standard-answer-like claims', () => {
    const events = homeMemoryDaysEvents();
    const report = evaluateHomeProfileHoldouts({
      standard: {
        id: 'home-memory-days',
        memory: memoryFromEvents(events)
      },
      counterfactuals: [
        {
          id: 'environment-only',
          memory: memoryFromEvents(events.filter((event) => (
            event.deviceType.includes('temperature') ||
            event.deviceType.includes('air_quality') ||
            event.deviceType.includes('soil')
          )))
        }
      ]
    });

    expect(report.calibrationWarnings).toEqual([]);
    expect(report.counterfactuals.find((entry) => entry.id === 'environment-only')?.strongHighLevelClaimIds).toEqual([]);
    expect(JSON.stringify(report)).not.toMatch(/student|adult_[0-9]+|child_1|three residents confirmed|三口之家|三口/i);
  }, 60_000);
});
