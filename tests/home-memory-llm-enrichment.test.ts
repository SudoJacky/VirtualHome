import { describe, expect, it, vi } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';
import { createHomeProfileHypotheses } from '../src/web/homeProfiler';
import {
  collectUnknownSchemaCandidates,
  createDeterministicHomeMemoryLlmEnrichment,
  createHomeMemoryLlmCacheKey,
  decideHomeMemoryLlmInvocation,
  parseHomeMemoryLlmEnrichmentJson,
  requestUnknownSchemaMapping,
  requestHomeMemoryLlmEnrichment,
  resolveHomeMemoryLlmConfig
} from '../src/sim/llm/homeMemoryEnrichment';

function deviceEvent(overrides: Partial<DeviceValueEvent> = {}): DeviceValueEvent {
  return {
    id: 'device_event_1',
    sourceEventId: 'source_event_1',
    sourceEventType: 'DeviceTelemetry',
    runId: 'run_a',
    sequence: 1,
    ts: '2026-06-22T00:00:00.000Z',
    simTime: '2026-06-22T08:00:00',
    homeId: 'home_1',
    roomId: 'kitchen',
    deviceId: 'fridge_01',
    deviceType: 'fridge',
    field: 'doorOpen',
    value: false,
    ...overrides
  };
}

function profiledMemory() {
  return reduceDeviceEvents(createHomeMemory(), [
    deviceEvent({
      id: 'kitchen_motion',
      sourceEventId: 'source_kitchen_motion',
      sequence: 1,
      roomId: 'kitchen',
      deviceId: 'kitchen_motion_01',
      deviceType: 'motion_sensor',
      field: 'motion',
      value: true
    }),
    deviceEvent({
      id: 'stove_power',
      sourceEventId: 'source_stove_power',
      sequence: 2,
      simTime: '2026-06-22T08:05:00',
      roomId: 'kitchen',
      deviceId: 'stove_01',
      deviceType: 'stove',
      field: 'powerW',
      value: 1200
    }),
    deviceEvent({
      id: 'living_tv',
      sourceEventId: 'source_living_tv',
      sequence: 3,
      simTime: '2026-06-22T20:00:00',
      roomId: 'living',
      deviceId: 'tv_01',
      deviceType: 'tv',
      field: 'power',
      value: true
    })
  ]);
}

describe('home memory LLM enrichment boundary', () => {
  it('resolves disabled config unless an OpenAI-compatible baseUrl is configured', () => {
    expect(resolveHomeMemoryLlmConfig({})).toMatchObject({
      provider: {
        enabled: false,
        provider: 'openai-compatible',
        baseUrl: ''
      }
    });

    const config = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_API_KEY: 'secret',
      HOME_MEMORY_LLM_MODEL: 'memory-model',
      HOME_MEMORY_LLM_TIMEOUT_MS: '25000',
      HOME_MEMORY_LLM_MAX_RETRIES: '2',
      HOME_MEMORY_LLM_MAX_CALLS_PER_HOME_PER_HOUR: '3',
      HOME_MEMORY_LLM_MAX_CALLS_PER_HOME_PER_DAY: '7'
    });

    expect(config.provider).toMatchObject({
      enabled: true,
      provider: 'openai-compatible',
      baseUrl: 'https://llm.example.test/v1',
      apiKey: 'secret',
      model: 'memory-model',
      timeoutMs: 25000,
      maxRetries: 2
    });
    expect(config.budget).toMatchObject({
      maxCallsPerHomePerHour: 3,
      maxCallsPerHomePerDay: 7
    });
  });

  it('does not call LLM for a single device event even when provider is enabled', () => {
    const config = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_MODEL: 'memory-model'
    });
    const decision = decideHomeMemoryLlmInvocation({
      config,
      purpose: 'semantic_candidate',
      homeId: 'home_1',
      runId: 'run_a',
      trigger: 'device_event',
      evidenceIds: ['device_event_1']
    });

    expect(decision).toMatchObject({
      shouldCall: false,
      purpose: 'semantic_candidate'
    });
    expect(decision.reason).toMatch(/single device event/i);
  });

  it('allows reliability review for mid-confidence evidence windows and returns a stable cache key', () => {
    const config = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_MODEL: 'memory-model'
    });
    const input = {
      config,
      purpose: 'reliability_review' as const,
      homeId: 'home_1',
      runId: 'run_a',
      trigger: 'window' as const,
      hypothesisId: 'household:size',
      confidence: 0.56,
      evidenceIds: ['kitchen_motion', 'stove_power']
    };

    const first = decideHomeMemoryLlmInvocation(input);
    const second = decideHomeMemoryLlmInvocation(input);

    expect(first).toMatchObject({
      shouldCall: true,
      purpose: 'reliability_review',
      priority: 'normal',
      maxTokens: 900
    });
    expect(first.cacheKey).toBe(second.cacheKey);
    expect(first.cacheKey).toMatch(/^[a-f0-9]{16}$/);
  });

  it('blocks calls when confidence is outside the review band, cache is present, or budget is exhausted', () => {
    const config = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_MODEL: 'memory-model',
      HOME_MEMORY_LLM_MAX_CALLS_PER_HOME_PER_HOUR: '1',
      HOME_MEMORY_LLM_MAX_CALLS_PER_HOME_PER_DAY: '2'
    });
    const baseInput = {
      config,
      purpose: 'reliability_review' as const,
      homeId: 'home_1',
      runId: 'run_a',
      trigger: 'window' as const,
      hypothesisId: 'household:size',
      evidenceIds: ['kitchen_motion', 'stove_power']
    };

    expect(decideHomeMemoryLlmInvocation({ ...baseInput, confidence: 0.1 }).reason).toMatch(/outside review band/i);
    expect(decideHomeMemoryLlmInvocation({ ...baseInput, confidence: 0.56, cached: true }).reason).toMatch(/cache hit/i);
    expect(decideHomeMemoryLlmInvocation({
      ...baseInput,
      confidence: 0.56,
      callsThisHour: 1
    }).reason).toMatch(/hourly budget/i);
    expect(decideHomeMemoryLlmInvocation({
      ...baseInput,
      confidence: 0.56,
      callsToday: 2
    }).reason).toMatch(/daily budget/i);
  });

  it('validates LLM enrichment against existing same-run evidence', () => {
    const memory = profiledMemory();
    const result = parseHomeMemoryLlmEnrichmentJson({
      jsonText: JSON.stringify({
        purpose: 'reliability_review',
        claim: 'Kitchen activity has enough evidence for a meal routine review, but it remains probabilistic.',
        type: 'reliability_review',
        confidence: 0.61,
        supportingEvidenceIds: ['kitchen_motion', 'stove_power'],
        contradictingEvidenceIds: [],
        missingEvidence: ['More observed days would improve reliability.'],
        alternatives: [{
          claim: 'The kitchen activity may be automation rather than a resident routine.',
          confidence: 0.25,
          evidenceIds: ['stove_power']
        }]
      }),
      model: 'memory-model',
      baseUrl: 'https://llm.example.test/v1',
      prompt: 'Review household memory evidence.',
      memory
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.join(', '));
    expect(result.enrichment.metadata).toMatchObject({
      model: 'memory-model',
      schemaVersion: 1,
      promptVersion: 1
    });
    expect(result.enrichment.metadata.baseUrlHash).toMatch(/^[a-f0-9]{16}$/);
    expect(result.enrichment.metadata.inputHash).toMatch(/^[a-f0-9]{16}$/);
    expect(result.enrichment.metadata.outputHash).toMatch(/^[a-f0-9]{16}$/);
  });

  it('rejects unsupported claims and cross-run evidence references', () => {
    const memory = profiledMemory();
    const unsupported = parseHomeMemoryLlmEnrichmentJson({
      jsonText: JSON.stringify({
        purpose: 'hypothesis_explanation',
        claim: 'The home definitely has three residents.',
        type: 'hypothesis_explanation',
        confidence: 0.9,
        supportingEvidenceIds: [],
        contradictingEvidenceIds: [],
        missingEvidence: [],
        alternatives: []
      }),
      model: 'memory-model',
      baseUrl: 'https://llm.example.test/v1',
      prompt: 'Explain memory.',
      memory
    });
    const crossRun = parseHomeMemoryLlmEnrichmentJson({
      jsonText: JSON.stringify({
        purpose: 'hypothesis_explanation',
        claim: 'Kitchen motion supports a presence explanation.',
        type: 'hypothesis_explanation',
        confidence: 0.5,
        supportingEvidenceIds: ['other_run_event'],
        contradictingEvidenceIds: [],
        missingEvidence: [],
        alternatives: []
      }),
      model: 'memory-model',
      baseUrl: 'https://llm.example.test/v1',
      prompt: 'Explain memory.',
      memory: {
        ...memory,
        recentEvents: [
          ...memory.recentEvents,
          {
            ...memory.recentEvents[0],
            id: 'other_run_event',
            runId: 'run_b'
          }
        ]
      }
    });

    expect(unsupported.ok).toBe(false);
    if (unsupported.ok) throw new Error('Expected unsupported claim rejection');
    expect(unsupported.errors.join('\n')).toMatch(/supportingEvidenceIds/i);

    expect(crossRun.ok).toBe(false);
    if (crossRun.ok) throw new Error('Expected cross-run rejection');
    expect(crossRun.errors.join('\n')).toMatch(/same home\/run/i);
  });

  it('creates deterministic fallback enrichment without network access', () => {
    const memory = profiledMemory();
    const hypothesis = createHomeProfileHypotheses(memory).find((candidate) => candidate.id === 'presence:recent-activity');
    if (!hypothesis) throw new Error('Missing expected hypothesis');
    const cacheKey = createHomeMemoryLlmCacheKey({
      purpose: 'hypothesis_explanation',
      homeId: 'home_1',
      runId: 'run_a',
      hypothesisId: hypothesis.id,
      evidenceIds: hypothesis.evidence.map((evidence) => evidence.id),
      model: 'deterministic-fallback',
      promptVersion: 1,
      schemaVersion: 1
    });
    const fallback = createDeterministicHomeMemoryLlmEnrichment({
      purpose: 'hypothesis_explanation',
      hypothesis,
      evidenceIds: hypothesis.evidence.map((evidence) => evidence.id),
      prompt: 'Explain presence.',
      baseUrl: ''
    });

    expect(cacheKey).toMatch(/^[a-f0-9]{16}$/);
    expect(fallback).toMatchObject({
      purpose: 'hypothesis_explanation',
      type: 'hypothesis_explanation',
      supportingEvidenceIds: hypothesis.evidence.map((evidence) => evidence.id),
      metadata: {
        model: 'deterministic-fallback',
        schemaVersion: 1
      }
    });
    expect(fallback.claim).toContain(hypothesis.summary);
  });

  it('requests OpenAI-compatible chat completions from the configured baseUrl and validates the response', async () => {
    const memory = profiledMemory();
    const hypothesis = createHomeProfileHypotheses(memory).find((candidate) => candidate.id === 'presence:recent-activity');
    if (!hypothesis) throw new Error('Missing expected hypothesis');
    const config = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_API_KEY: 'secret-key',
      HOME_MEMORY_LLM_MODEL: 'memory-model'
    });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            purpose: 'hypothesis_explanation',
            claim: 'Recent kitchen and living-room evidence supports a probabilistic presence explanation.',
            type: 'hypothesis_explanation',
            confidence: 0.5,
            supportingEvidenceIds: hypothesis.evidence.map((evidence) => evidence.id).slice(0, 1),
            contradictingEvidenceIds: [],
            missingEvidence: ['More days would improve confidence.'],
            alternatives: []
          })
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await requestHomeMemoryLlmEnrichment({
      config,
      purpose: 'hypothesis_explanation',
      trigger: 'user_request',
      prompt: 'Explain the presence hypothesis.',
      memory,
      hypothesis,
      fetcher
    });

    expect(result.source).toBe('llm');
    expect(result.enrichment.metadata.model).toBe('memory-model');
    expect(result.enrichment.metadata.baseUrlHash).toMatch(/^[a-f0-9]{16}$/);
    expect(fetcher).toHaveBeenCalledWith('https://llm.example.test/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: 'Bearer secret-key',
        'content-type': 'application/json'
      })
    }));
    const [, requestInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));
    expect(body).toMatchObject({
      model: 'memory-model',
      response_format: { type: 'json_object' }
    });
    expect(body.messages[0].content).toMatch(/evidence-locked/i);
  });

  it('falls back deterministically when the provider is disabled, fails, or returns invalid evidence', async () => {
    const memory = profiledMemory();
    const hypothesis = createHomeProfileHypotheses(memory).find((candidate) => candidate.id === 'presence:recent-activity');
    if (!hypothesis) throw new Error('Missing expected hypothesis');
    const disabled = await requestHomeMemoryLlmEnrichment({
      config: resolveHomeMemoryLlmConfig({}),
      purpose: 'hypothesis_explanation',
      trigger: 'user_request',
      prompt: 'Explain the presence hypothesis.',
      memory,
      hypothesis,
      fetcher: vi.fn()
    });
    const invalid = await requestHomeMemoryLlmEnrichment({
      config: resolveHomeMemoryLlmConfig({
        HOME_MEMORY_LLM_ENABLED: 'true',
        HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
        HOME_MEMORY_LLM_MODEL: 'memory-model'
      }),
      purpose: 'hypothesis_explanation',
      trigger: 'user_request',
      prompt: 'Explain the presence hypothesis.',
      memory,
      hypothesis,
      fetcher: vi.fn(async () => new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              purpose: 'hypothesis_explanation',
              claim: 'This unsupported explanation should be rejected.',
              type: 'hypothesis_explanation',
              confidence: 0.5,
              supportingEvidenceIds: [],
              contradictingEvidenceIds: [],
              missingEvidence: [],
              alternatives: []
            })
          }
        }]
      }), { status: 200 }))
    });

    expect(disabled).toMatchObject({
      source: 'deterministic-fallback',
      enrichment: {
        metadata: {
          model: 'deterministic-fallback'
        }
      }
    });
    expect(invalid.source).toBe('deterministic-fallback');
    expect(invalid.errors.join('\n')).toMatch(/supportingEvidenceIds/i);
  });

  it('does not replay cached enrichments that fail evidence validation', async () => {
    const memory = profiledMemory();
    const hypothesis = createHomeProfileHypotheses(memory).find((candidate) => candidate.id === 'presence:recent-activity');
    if (!hypothesis) throw new Error('Missing expected hypothesis');
    const cached = createDeterministicHomeMemoryLlmEnrichment({
      purpose: 'hypothesis_explanation',
      hypothesis,
      evidenceIds: hypothesis.evidence.map((evidence) => evidence.id),
      prompt: 'Explain the presence hypothesis.',
      baseUrl: ''
    });
    cached.supportingEvidenceIds = ['missing_evidence'];
    const fetcher = vi.fn();

    const result = await requestHomeMemoryLlmEnrichment({
      config: resolveHomeMemoryLlmConfig({}),
      purpose: 'hypothesis_explanation',
      trigger: 'user_request',
      prompt: 'Explain the presence hypothesis.',
      memory,
      hypothesis,
      cached,
      fetcher
    });

    expect(result.source).toBe('deterministic-fallback');
    expect(result.errors.join('\n')).toMatch(/cached enrichment/i);
    expect(result.errors.join('\n')).toMatch(/missing_evidence/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects provider enrichments that increase baseline hypothesis confidence', async () => {
    const memory = profiledMemory();
    const hypothesis = createHomeProfileHypotheses(memory).find((candidate) => candidate.id === 'presence:recent-activity');
    if (!hypothesis) throw new Error('Missing expected hypothesis');
    const config = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_MODEL: 'memory-model'
    });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            purpose: 'hypothesis_explanation',
            claim: 'This explanation tries to overstate the baseline confidence.',
            type: 'hypothesis_explanation',
            confidence: Math.min(1, hypothesis.confidence + 0.2),
            supportingEvidenceIds: hypothesis.evidence.map((evidence) => evidence.id).slice(0, 1),
            contradictingEvidenceIds: [],
            missingEvidence: [],
            alternatives: []
          })
        }
      }]
    }), { status: 200 }));

    const result = await requestHomeMemoryLlmEnrichment({
      config,
      purpose: 'hypothesis_explanation',
      trigger: 'user_request',
      prompt: 'Explain the presence hypothesis.',
      memory,
      hypothesis,
      fetcher
    });

    expect(result.source).toBe('deterministic-fallback');
    expect(result.errors.join('\n')).toMatch(/baseline confidence/i);
    expect(result.enrichment.confidence).toBe(hypothesis.confidence);
  });

  it('retries provider requests up to the configured maxRetries before falling back', async () => {
    const memory = profiledMemory();
    const hypothesis = createHomeProfileHypotheses(memory).find((candidate) => candidate.id === 'presence:recent-activity');
    if (!hypothesis) throw new Error('Missing expected hypothesis');
    const config = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_MODEL: 'memory-model',
      HOME_MEMORY_LLM_MAX_RETRIES: '2'
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('temporary failure', { status: 503 }))
      .mockResolvedValueOnce(new Response('temporary failure', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              purpose: 'hypothesis_explanation',
              claim: 'Retry success still returns an evidence-locked explanation.',
              type: 'hypothesis_explanation',
              confidence: 0.5,
              supportingEvidenceIds: hypothesis.evidence.map((evidence) => evidence.id).slice(0, 1),
              contradictingEvidenceIds: [],
              missingEvidence: [],
              alternatives: []
            })
          }
        }]
      }), { status: 200 }));

    const result = await requestHomeMemoryLlmEnrichment({
      config,
      purpose: 'hypothesis_explanation',
      trigger: 'user_request',
      prompt: 'Explain the presence hypothesis.',
      memory,
      hypothesis,
      fetcher
    });

    expect(result.source).toBe('llm');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('collects only stable unknown schema candidates from generic evidence', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'known_motion',
        sourceEventId: 'source_known_motion',
        sequence: 1,
        deviceType: 'motion_sensor',
        field: 'motion',
        value: true
      }),
      deviceEvent({
        id: 'single_unknown',
        sourceEventId: 'source_single_unknown',
        sequence: 2,
        deviceId: 'mystery_01',
        deviceType: 'fermentation_station',
        field: 'brewPhase',
        value: 'active'
      }),
      deviceEvent({
        id: 'stable_unknown_1',
        sourceEventId: 'source_stable_unknown_1',
        sequence: 3,
        roomId: 'utility',
        deviceId: 'pet_feeder_01',
        deviceType: 'pet_feeder',
        field: 'mealDispensed',
        value: true
      }),
      deviceEvent({
        id: 'stable_unknown_2',
        sourceEventId: 'source_stable_unknown_2',
        sequence: 4,
        simTime: '2026-06-22T08:05:00',
        roomId: 'utility',
        deviceId: 'pet_feeder_01',
        deviceType: 'pet_feeder',
        field: 'mealDispensed',
        value: false
      })
    ]);

    expect(collectUnknownSchemaCandidates(memory, { minEvidenceCount: 2 })).toEqual([
      expect.objectContaining({
        id: 'schema:pet_feeder:mealDispensed',
        deviceType: 'pet_feeder',
        field: 'mealDispensed',
        evidenceIds: ['stable_unknown_2', 'stable_unknown_1']
      })
    ]);
  });

  it('requests unknown schema mapping as candidate-only enrichment without changing reducer facts', async () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'stable_unknown_1',
        sourceEventId: 'source_stable_unknown_1',
        sequence: 1,
        roomId: 'utility',
        deviceId: 'pet_feeder_01',
        deviceType: 'pet_feeder',
        field: 'mealDispensed',
        value: true
      }),
      deviceEvent({
        id: 'stable_unknown_2',
        sourceEventId: 'source_stable_unknown_2',
        sequence: 2,
        simTime: '2026-06-22T08:05:00',
        roomId: 'utility',
        deviceId: 'pet_feeder_01',
        deviceType: 'pet_feeder',
        field: 'mealDispensed',
        value: false
      })
    ]);
    const candidate = collectUnknownSchemaCandidates(memory, { minEvidenceCount: 2 })[0];
    const semanticSignalsBeforeMapping = structuredClone(memory.semanticSignals);
    const config = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_MODEL: 'memory-model'
    });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            purpose: 'unknown_schema_mapping',
            claim: 'pet_feeder.mealDispensed is a candidate automation or maintenance semantic, not direct human presence.',
            type: 'semantic_candidate',
            confidence: 0.64,
            supportingEvidenceIds: candidate.evidenceIds,
            contradictingEvidenceIds: [],
            missingEvidence: ['Manual review is required before adding this mapping to deterministic rules.'],
            alternatives: [{
              claim: 'This could be scheduled automation rather than resident behavior.',
              confidence: 0.5,
              evidenceIds: candidate.evidenceIds
            }]
          })
        }
      }]
    }), { status: 200 }));

    const result = await requestUnknownSchemaMapping({
      config,
      memory,
      candidate,
      fetcher
    });

    expect(result.source).toBe('llm');
    expect(result.enrichment).toMatchObject({
      purpose: 'unknown_schema_mapping',
      type: 'semantic_candidate',
      supportingEvidenceIds: candidate.evidenceIds,
      missingEvidence: expect.arrayContaining([
        'Manual review is required before adding this mapping to deterministic rules.'
      ])
    });
    expect(memory.semanticSignals).toEqual(semanticSignalsBeforeMapping);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
