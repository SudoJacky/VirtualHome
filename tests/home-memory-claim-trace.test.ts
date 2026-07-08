import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';
import { createHomeProfileHypotheses } from '../src/web/homeProfiler';

function homeMemoryDaysEvents(): DeviceValueEvent[] {
  const dataset = JSON.parse(readFileSync('data/home-memory-days.json', 'utf8')) as { events: DeviceValueEvent[] };
  return dataset.events;
}

describe('home memory profile claim traces', () => {
  it('adds auditable trace fields to every home-memory-days profile claim', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), homeMemoryDaysEvents());
    const hypotheses = createHomeProfileHypotheses(memory);

    expect(hypotheses.length).toBeGreaterThan(0);

    for (const hypothesis of hypotheses) {
      expect(['candidate', 'likely', 'strong', 'rejected']).toContain(hypothesis.status);
      expect(hypothesis.scope.dateRange.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(hypothesis.scope.dateRange.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(hypothesis.supports.length).toBeGreaterThan(0);
      expect(Array.isArray(hypothesis.contradictions)).toBe(true);
      expect(Array.isArray(hypothesis.alternativeExplanations)).toBe(true);
      expect(hypothesis.reasoningSteps.length).toBeGreaterThan(0);

      for (const support of hypothesis.supports) {
        expect(['fact', 'episode', 'feature', 'pattern', 'role_slot']).toContain(support.kind);
        expect(support.refId.length).toBeGreaterThan(0);
        expect(support.summary.length).toBeGreaterThan(0);
        expect(support.weight).toBeGreaterThan(0);
        expect(support.evidenceIds.length).toBeGreaterThan(0);
      }

      for (const step of hypothesis.reasoningSteps) {
        expect(step.label.length).toBeGreaterThan(0);
        expect(step.rule.length).toBeGreaterThan(0);
        expect(step.inputs.length).toBeGreaterThan(0);
        expect(step.output.length).toBeGreaterThan(0);
        expect(['supports', 'weakens', 'rules_out']).toContain(step.effect);
      }
    }
  }, 60_000);

  it('keeps high-level household claims probabilistic and explains alternatives', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), homeMemoryDaysEvents());
    const hypotheses = createHomeProfileHypotheses(memory);
    const byId = new Map(hypotheses.map((hypothesis) => [hypothesis.id, hypothesis]));
    const highLevelIds = [
      'household:composition',
      'household:size',
      'resident-slot:child_sleep:child_bedroom',
      'resident-slot:remote_work:study'
    ];

    for (const id of highLevelIds) {
      const hypothesis = byId.get(id);
      expect(hypothesis, id).toBeDefined();
      expect(hypothesis?.status).not.toBe('strong');
      expect(hypothesis?.alternativeExplanations.length).toBeGreaterThan(0);
      expect(hypothesis?.missingEvidence.length).toBeGreaterThan(0);
      expect(hypothesis?.reasoningSteps.some((step) => step.effect === 'weakens')).toBe(true);
    }
  }, 60_000);
});
