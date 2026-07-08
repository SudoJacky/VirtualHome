import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { extractHomeProfileClaims } from '../src/web/homeProfileClaims';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';

function homeMemoryDaysEvents(): DeviceValueEvent[] {
  const dataset = JSON.parse(readFileSync('data/home-memory-days.json', 'utf8')) as { events: DeviceValueEvent[] };
  return dataset.events;
}

describe('home memory profile claim engine', () => {
  it('generates traced profile claims by combining features and role slots', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), homeMemoryDaysEvents());
    const claims = extractHomeProfileClaims(memory);
    const byId = new Map(claims.map((claim) => [claim.id, claim]));

    const householdRoles = byId.get('claim:household:anonymous-role-signals');
    expect(householdRoles).toMatchObject({
      type: 'household_composition',
      status: 'likely'
    });
    expect(householdRoles?.supports.some((support) => support.kind === 'role_slot' && support.refId === 'role-slot:child_sleep_slot')).toBe(true);
    expect(householdRoles?.supports.some((support) => support.kind === 'role_slot' && support.refId === 'role-slot:remote_work_slot')).toBe(true);
    expect(householdRoles?.supports.some((support) => support.kind === 'role_slot' && support.refId === 'role-slot:commuter_adult_like_slot')).toBe(true);
    expect(householdRoles?.supports.some((support) => support.kind === 'role_slot' && support.refId === 'role-slot:daytime_home_work_slot')).toBe(true);
    expect(householdRoles?.supports.some((support) => support.kind === 'role_slot' && support.refId === 'role-slot:pet_activity_candidate')).toBe(true);
    expect(householdRoles?.supports.some((support) => support.kind === 'feature')).toBe(true);
    expect(householdRoles?.conclusion).toMatch(/commuter/i);
    expect(householdRoles?.conclusion).toMatch(/daytime-home work\/study/i);
    expect(householdRoles?.conclusion).toMatch(/child activity\/sleep/i);
    expect(householdRoles?.conclusion).toMatch(/pet activity candidate/i);
    expect(householdRoles?.missingEvidence.length).toBeGreaterThan(0);
    expect(householdRoles?.alternativeExplanations.length).toBeGreaterThan(0);
    expect(householdRoles?.reasoningSteps.some((step) => step.effect === 'weakens')).toBe(true);

    const routineEvidence = byId.get('claim:household:stable-routine-evidence');
    expect(routineEvidence).toMatchObject({
      type: 'routine_window',
      status: 'likely'
    });
    expect(routineEvidence?.supports.map((support) => support.refId)).toEqual(expect.arrayContaining([
      'feature:door_unlock_lock_pairing',
      'feature:stove_range_hood_coupling',
      'feature:child_bedroom_sleep_around_21',
      'feature:weekday_study_daytime_activity'
    ]));

    for (const claim of claims) {
      expect(claim.conclusion.length).toBeGreaterThan(0);
      expect(claim.scope.dateRange.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(claim.scope.dateRange.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(claim.supports.length).toBeGreaterThan(0);
      expect(Array.isArray(claim.contradictions)).toBe(true);
      expect(claim.reasoningSteps.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('keeps high-level household claims probabilistic and avoids standard-answer wording', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), homeMemoryDaysEvents());
    const claims = extractHomeProfileClaims(memory);
    const householdClaims = claims.filter((claim) => claim.type === 'household_composition' || claim.type === 'household_size');

    expect(householdClaims.length).toBeGreaterThan(0);
    expect(householdClaims.every((claim) => claim.status !== 'strong')).toBe(true);
    expect(JSON.stringify(householdClaims)).not.toMatch(/adult_[0-9]+|child_1|三口/i);
    expect(JSON.stringify(householdClaims)).toMatch(/three resident-like human slot/i);
    expect(JSON.stringify(householdClaims)).toMatch(/pet activity candidate/i);
    expect(householdClaims.some((claim) => /exact|identity|count|direct evidence/i.test([
      claim.conclusion,
      ...claim.missingEvidence,
      ...claim.alternativeExplanations,
      ...claim.reasoningSteps.map((step) => step.output)
    ].join(' ')))).toBe(true);
  }, 60_000);
});
