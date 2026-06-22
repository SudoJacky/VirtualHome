import { describe, expect, it } from 'vitest';
import { createDeterministicFallbackProposal, createLlmProposalCacheKey, parseLlmProposalJson, resolveCachedOrFallbackProposal } from '../src/sim/llm/proposals';

describe('LLM proposal boundary', () => {
  it('accepts only bounded household planning proposals with metadata hashes', () => {
    const result = parseLlmProposalJson({
      jsonText: JSON.stringify({
        kind: 'weekly_schedule',
        title: 'Light weekend plan',
        summary: 'A quiet weekend with cleaning and family dinner.',
        items: [
          { id: 'saturday-cleaning', type: 'schedule_hint', text: 'Clean living room Saturday morning.' }
        ],
        requiredResources: [{ resourceId: 'cleaning_supplies', quantity: 1 }]
      }),
      model: 'test-model',
      prompt: 'Create a weekly household schedule',
      availableResources: { cleaning_supplies: 1 }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.join(', '));
    expect(result.proposal.metadata).toMatchObject({
      model: 'test-model',
      schemaVersion: 1
    });
    expect(result.proposal.metadata.promptHash).toMatch(/^[a-f0-9]{16}$/);
    expect(result.proposal.metadata.outputHash).toMatch(/^[a-f0-9]{16}$/);
  });

  it('rejects direct minute actions, device commands, sensor reports, and safety critical controls', () => {
    const result = parseLlmProposalJson({
      jsonText: JSON.stringify({
        kind: 'device_command',
        title: 'Turn off stove now',
        summary: 'Directly control the stove.',
        items: [
          { id: 'turn-off-stove', type: 'device_command', text: 'Set stove powerW to 0.' }
        ],
        safetyTags: ['safety_critical_control']
      }),
      model: 'test-model',
      prompt: 'Control the home',
      availableResources: {}
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected proposal rejection');
    expect(result.errors.join('\n')).toContain('not allowed');
    expect(result.errors.join('\n')).toContain('safety critical');
  });

  it('rejects proposals that fail resource constraints', () => {
    const result = parseLlmProposalJson({
      jsonText: JSON.stringify({
        kind: 'activity_template_draft',
        title: 'Deep cleaning template',
        summary: 'Use a specialty cleaning kit.',
        items: [
          { id: 'deep-clean', type: 'activity_template', text: 'Deep clean bathroom.' }
        ],
        requiredResources: [{ resourceId: 'special_cleaning_kit', quantity: 1 }]
      }),
      model: 'test-model',
      prompt: 'Draft an activity template',
      availableResources: { cleaning_supplies: 1 }
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected proposal rejection');
    expect(result.errors.join('\n')).toContain('missing resource special_cleaning_kit');
  });

  it('creates deterministic fallback proposals when no LLM output is available', () => {
    const first = createDeterministicFallbackProposal({
      purpose: 'weekly_schedule',
      seed: 42,
      prompt: 'Create a weekly household schedule',
      availableResources: { cleaning_supplies: 1 }
    });
    const second = createDeterministicFallbackProposal({
      purpose: 'weekly_schedule',
      seed: 42,
      prompt: 'Create a weekly household schedule',
      availableResources: { cleaning_supplies: 1 }
    });

    expect(first).toEqual(second);
    expect(first.metadata).toMatchObject({
      model: 'deterministic-fallback',
      schemaVersion: 1
    });
    expect(first.kind).toBe('weekly_schedule');
    expect(first.items.length).toBeGreaterThan(0);
  });

  it('uses agent memory context for deterministic memory-summary fallback proposals', () => {
    const proposal = createDeterministicFallbackProposal({
      purpose: 'memory_summary',
      seed: 42,
      prompt: 'Summarize child_1 memory',
      availableResources: {},
      memoryContext: {
        personId: 'child_1',
        summary: 'child_1 memory summary: frequent activities: study_homework x3; recurring social topics: homework_reminder x2.'
      }
    });

    expect(proposal.kind).toBe('memory_summary');
    expect(proposal.items[0]).toMatchObject({
      type: 'memory_note',
      text: expect.stringContaining('study_homework x3')
    });
    expect(proposal.items[0].text).toContain('child_1');
    expect(proposal.items[0].text).toContain('homework_reminder x2');
  });

  it('replays cached LLM proposals before falling back deterministically', () => {
    const cachedProposal = createDeterministicFallbackProposal({
      purpose: 'weekly_schedule',
      seed: 1,
      prompt: 'Create cached weekly schedule',
      availableResources: { cleaning_supplies: 1 }
    });
    const cacheKey = createLlmProposalCacheKey({
      purpose: 'weekly_schedule',
      prompt: 'Create cached weekly schedule',
      availableResources: { cleaning_supplies: 1 }
    });

    const cached = resolveCachedOrFallbackProposal({
      purpose: 'weekly_schedule',
      seed: 42,
      prompt: 'Create cached weekly schedule',
      availableResources: { cleaning_supplies: 1 },
      cache: {
        [cacheKey]: cachedProposal
      }
    });
    const missed = resolveCachedOrFallbackProposal({
      purpose: 'weekly_schedule',
      seed: 42,
      prompt: 'Create uncached weekly schedule',
      availableResources: { cleaning_supplies: 1 },
      cache: {
        [cacheKey]: cachedProposal
      }
    });

    expect(cached).toMatchObject({
      source: 'cache',
      cacheKey,
      proposal: cachedProposal
    });
    expect(missed.source).toBe('deterministic-fallback');
    expect(missed.cacheKey).not.toBe(cacheKey);
    expect(missed.proposal).not.toEqual(cachedProposal);
  });
});
