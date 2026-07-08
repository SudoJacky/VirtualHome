import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { estimateHomeHouseholdPosterior } from '../src/web/homeHouseholdPosterior';
import { extractHomeProfileClaims } from '../src/web/homeProfileClaims';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';

function homeMemoryDaysEvents(): DeviceValueEvent[] {
  const dataset = JSON.parse(readFileSync('data/home-memory-days.json', 'utf8')) as { events: DeviceValueEvent[] };
  return dataset.events;
}

describe('home memory household posterior', () => {
  it('exposes resident-count posterior distribution and reasoning steps', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), homeMemoryDaysEvents());
    const posterior = estimateHomeHouseholdPosterior(memory);
    const totalProbability = Object.values(posterior.distribution).reduce((total, probability) => total + probability, 0);

    expect(Object.keys(posterior.distribution).sort()).toEqual(['1', '2', '3', '4', '5']);
    expect(totalProbability).toBeGreaterThan(0.99);
    expect(totalProbability).toBeLessThan(1.01);
    expect(posterior.lowerBound).toBeGreaterThanOrEqual(1);
    expect(posterior.winningEstimate).toBeGreaterThanOrEqual(posterior.lowerBound);
    expect(posterior.confidence).toBeGreaterThan(0);
    expect(posterior.confidence).toBeLessThanOrEqual(1);
    expect(posterior.reasoningSteps.length).toBeGreaterThan(0);
    expect(posterior.reasoningSteps.some((step) => step.effect === 'weakens')).toBe(true);
    expect(posterior.reasoningSteps.some((step) => /plausible|not confirmed|uncertain/i.test(step.output))).toBe(true);
  }, 60_000);

  it('adds a probabilistic household-size claim without forcing exact resident count', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), homeMemoryDaysEvents());
    const claims = extractHomeProfileClaims(memory);
    const claim = claims.find((candidate) => candidate.id === 'claim:household:resident-count-posterior');

    expect(claim).toMatchObject({
      type: 'household_size',
      status: expect.not.stringMatching(/^strong$/)
    });
    expect(claim?.supports.some((support) => support.kind === 'feature' || support.kind === 'role_slot')).toBe(true);
    expect(claim?.reasoningSteps.some((step) => /posterior|distribution/i.test(step.rule + step.output))).toBe(true);
    expect(claim?.conclusion).toMatch(/posterior|probabilistic|plausible/i);
    const claimText = [
      claim?.conclusion,
      ...(claim?.reasoningSteps.map((step) => step.output) ?? [])
    ].join(' ');
    expect(claimText).not.toMatch(/3 residents confirmed|three residents confirmed|confirmed exactly 3|三口之家|三口/i);
  }, 60_000);
});
