import { describe, expect, it, vi } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';
import * as memoryQuery from '../src/server/memoryQuery';
import { createHouseholdPortrait, createHouseholdPortraitWithEnrichment, createMemorySummary, planMemoryQuery, queryMemoryHypotheses, queryMemoryHypothesesWithEnrichment } from '../src/server/memoryQuery';
import { resolveHomeMemoryLlmConfig } from '../src/sim/llm/homeMemoryEnrichment';

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
    deviceId: 'kitchen_motion_01',
    deviceType: 'motion_sensor',
    field: 'motion',
    value: true,
    ...overrides
  };
}

describe('memory query', () => {
  it('includes derived household activity episodes in memory summary', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'entry_unlock',
        sourceEventId: 'source_entry_unlock',
        sequence: 1,
        ts: '2026-06-22T10:00:00.000Z',
        simTime: '2026-06-22T18:00:00',
        roomId: 'entrance',
        deviceId: 'front_lock_01',
        deviceType: 'door_lock',
        field: 'lock',
        value: 'unlocked'
      }),
      deviceEvent({
        id: 'kitchen_motion',
        sourceEventId: 'source_kitchen_motion',
        sequence: 2,
        ts: '2026-06-22T10:08:00.000Z',
        simTime: '2026-06-22T18:08:00',
        roomId: 'kitchen',
        deviceId: 'kitchen_motion_01',
        deviceType: 'motion_sensor',
        field: 'motion',
        value: true
      })
    ]);

    expect(createMemorySummary(memory).activityEpisodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'return_home',
        roomIds: ['entrance', 'kitchen'],
        evidenceIds: ['entry_unlock', 'kitchen_motion']
      })
    ]));
  });

  it('adds opt-in deterministic LLM enrichment and reliability details to profile hypotheses', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
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
        value: 900
      })
    ]);

    const defaultItems = queryMemoryHypotheses(memory, { type: 'presence_signal' });
    const enrichedItems = queryMemoryHypotheses(
      memory,
      {
        type: 'presence_signal',
        includeLlmEnrichment: true,
        includeReliability: true
      },
      {
        llmConfig: resolveHomeMemoryLlmConfig({})
      }
    );

    expect(defaultItems[0]).not.toHaveProperty('llmEnrichment');
    expect(defaultItems[0]).not.toHaveProperty('reliability');
    expect(enrichedItems[0]).toMatchObject({
      type: 'presence_signal',
      llmEnrichment: {
        purpose: 'hypothesis_explanation',
        type: 'hypothesis_explanation',
        supportingEvidenceIds: expect.arrayContaining(['kitchen_motion']),
        metadata: {
          model: 'deterministic-fallback',
          schemaVersion: 1
        }
      },
      reliability: {
        evidenceCount: expect.any(Number),
        supportingEvidenceCount: expect.any(Number),
        contradictingEvidenceCount: 0,
        unsupportedClaimCount: 0,
        explanationSource: 'rule_template'
      }
    });
  });

  it('uses the configured provider for opt-in async hypothesis enrichment', async () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
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
        id: 'living_tv',
        sourceEventId: 'source_living_tv',
        sequence: 2,
        simTime: '2026-06-22T20:00:00',
        roomId: 'living',
        deviceId: 'tv_01',
        deviceType: 'tv',
        field: 'power',
        value: true
      })
    ]);
    const llmConfig = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_MODEL: 'memory-model'
    });
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const prompt = JSON.parse(body.messages[1].content) as { evidenceIds: string[] };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              purpose: 'hypothesis_explanation',
              claim: 'Provider explanation remains tied to observed evidence.',
              type: 'hypothesis_explanation',
              confidence: 0.5,
              supportingEvidenceIds: [prompt.evidenceIds[0]],
              contradictingEvidenceIds: [],
              missingEvidence: ['More observations would improve confidence.'],
              alternatives: []
            })
          }
        }]
      }), { status: 200 });
    });

    const items = await queryMemoryHypothesesWithEnrichment(
      memory,
      { type: 'presence_signal', includeLlmEnrichment: true },
      { llmConfig, fetcher }
    );

    expect(items[0]).toMatchObject({
      type: 'presence_signal',
      llmEnrichment: {
        claim: 'Provider explanation remains tied to observed evidence.',
        metadata: {
          model: 'memory-model'
        }
      },
      llmEnrichmentSource: 'llm'
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('adds a cached provider-backed reliability review when reliability and LLM enrichment are requested', async () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
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
      })
    ]);
    const llmConfig = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_MODEL: 'memory-model'
    });
    const cache = new Map();
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const prompt = JSON.parse(body.messages[1].content) as { purpose: string; evidenceIds: string[] };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              purpose: prompt.purpose,
              claim: 'The kitchen routine review is plausible but still needs more observed days.',
              type: prompt.purpose === 'reliability_review' ? 'reliability_review' : 'hypothesis_explanation',
              confidence: 0.1,
              supportingEvidenceIds: [prompt.evidenceIds[0]],
              contradictingEvidenceIds: [],
              missingEvidence: ['More observed days would improve reliability.'],
              alternatives: [{
                claim: 'This could be a one-off appliance use rather than a routine.',
                confidence: 0.2,
                evidenceIds: [prompt.evidenceIds[0]]
              }]
            })
          }
        }]
      }), { status: 200 });
    });

    const first = await queryMemoryHypothesesWithEnrichment(
      memory,
      { type: 'routine_window', includeReliability: true, includeLlmEnrichment: true },
      { llmConfig, fetcher, llmCache: cache }
    );
    const second = await queryMemoryHypothesesWithEnrichment(
      memory,
      { type: 'routine_window', includeReliability: true, includeLlmEnrichment: true },
      { llmConfig, fetcher, llmCache: cache }
    );

    expect(first[0]).toMatchObject({
      type: 'routine_window',
      reliability: {
        explanationSource: 'rule_template'
      },
      llmReliabilityReview: {
        purpose: 'reliability_review',
        type: 'reliability_review',
        claim: 'The kitchen routine review is plausible but still needs more observed days.'
      },
      llmReliabilityReviewSource: 'llm'
    });
    expect(second[0]).toMatchObject({
      llmReliabilityReviewSource: 'cache',
      llmReliabilityReview: {
        claim: 'The kitchen routine review is plausible but still needs more observed days.'
      }
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('returns cached unknown schema mapping suggestions without changing memory facts', async () => {
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
    const semanticSignalsBeforeMapping = structuredClone(memory.semanticSignals);
    const llmConfig = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_MODEL: 'memory-model'
    });
    const cache = new Map();
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const prompt = JSON.parse(body.messages[1].content) as { candidate: { evidenceIds: string[] } };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              purpose: 'unknown_schema_mapping',
              claim: 'pet_feeder.mealDispensed is a candidate semantic mapping that still requires manual review.',
              type: 'semantic_candidate',
              confidence: 0.4,
              supportingEvidenceIds: prompt.candidate.evidenceIds,
              contradictingEvidenceIds: [],
              missingEvidence: ['Manual review is required before adding this mapping to deterministic rules.'],
              alternatives: []
            })
          }
        }]
      }), { status: 200 });
    });

    const first = await (memoryQuery as any).queryUnknownSchemaMappings(
      memory,
      { includeLlmEnrichment: true },
      { llmConfig, fetcher, llmCache: cache }
    );
    const second = await (memoryQuery as any).queryUnknownSchemaMappings(
      memory,
      { includeLlmEnrichment: true },
      { llmConfig, fetcher, llmCache: cache }
    );

    expect(first.items[0]).toMatchObject({
      candidate: {
        id: 'schema:pet_feeder:mealDispensed',
        deviceType: 'pet_feeder',
        field: 'mealDispensed',
        evidenceIds: ['stable_unknown_2', 'stable_unknown_1']
      },
      mapping: {
        purpose: 'unknown_schema_mapping',
        type: 'semantic_candidate',
        claim: 'pet_feeder.mealDispensed is a candidate semantic mapping that still requires manual review.'
      },
      mappingSource: 'llm'
    });
    expect(second.items[0]).toMatchObject({
      mappingSource: 'cache',
      mapping: {
        claim: 'pet_feeder.mealDispensed is a candidate semantic mapping that still requires manual review.'
      }
    });
    expect(memory.semanticSignals).toEqual(semanticSignalsBeforeMapping);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns cached semantic candidates for stable evidence windows without changing semantic signals', async () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'garage_device_1',
        sourceEventId: 'source_garage_device_1',
        sequence: 1,
        roomId: 'garage',
        deviceId: 'garage_tool_01',
        deviceType: 'tool_battery',
        field: 'charging',
        value: true
      }),
      deviceEvent({
        id: 'garage_device_2',
        sourceEventId: 'source_garage_device_2',
        sequence: 2,
        simTime: '2026-06-22T08:05:00',
        roomId: 'garage',
        deviceId: 'garage_door_sensor_01',
        deviceType: 'contact_sensor',
        field: 'open',
        value: true
      })
    ]);
    const semanticSignalsBeforeCandidate = structuredClone(memory.semanticSignals);
    const llmConfig = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_MODEL: 'memory-model'
    });
    const cache = new Map();
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const prompt = JSON.parse(body.messages[1].content) as { evidenceIds: string[] };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              purpose: 'semantic_candidate',
              claim: 'The garage evidence window is a candidate maintenance or tool-use context, not a resident identity claim.',
              type: 'semantic_candidate',
              confidence: 0.3,
              supportingEvidenceIds: prompt.evidenceIds,
              contradictingEvidenceIds: [],
              missingEvidence: ['More repeated garage evidence is needed before creating a deterministic semantic rule.'],
              alternatives: []
            })
          }
        }]
      }), { status: 200 });
    });

    const first = await (memoryQuery as any).querySemanticCandidates(
      memory,
      { includeLlmEnrichment: true },
      { llmConfig, fetcher, llmCache: cache }
    );
    const second = await (memoryQuery as any).querySemanticCandidates(
      memory,
      { includeLlmEnrichment: true },
      { llmConfig, fetcher, llmCache: cache }
    );

    expect(first.items[0]).toMatchObject({
      window: {
        roomId: 'garage',
        evidenceIds: ['garage_device_2', 'garage_device_1']
      },
      candidate: {
        purpose: 'semantic_candidate',
        type: 'semantic_candidate',
        claim: 'The garage evidence window is a candidate maintenance or tool-use context, not a resident identity claim.'
      },
      candidateSource: 'llm'
    });
    expect(second.items[0]).toMatchObject({
      candidateSource: 'cache',
      candidate: {
        claim: 'The garage evidence window is a candidate maintenance or tool-use context, not a resident identity claim.'
      }
    });
    expect(memory.semanticSignals).toEqual(semanticSignalsBeforeCandidate);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('creates a reliability report for facts, semantics, portrait, and graph invariants', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'entry_unlock',
        sourceEventId: 'source_entry_unlock',
        sequence: 1,
        ts: '2026-06-22T10:00:00.000Z',
        simTime: '2026-06-22T18:00:00',
        roomId: 'entrance',
        deviceId: 'front_lock_01',
        deviceType: 'door_lock',
        field: 'lock',
        value: 'unlocked'
      }),
      deviceEvent({
        id: 'kitchen_motion',
        sourceEventId: 'source_kitchen_motion',
        sequence: 2,
        ts: '2026-06-22T10:08:00.000Z',
        simTime: '2026-06-22T18:08:00',
        roomId: 'kitchen',
        deviceId: 'kitchen_motion_01',
        deviceType: 'motion_sensor',
        field: 'motion',
        value: true
      })
    ]);

    const report = (memoryQuery as any).createMemoryReliabilityReport(memory);

    expect(report).toMatchObject({
      homeId: 'home_1',
      runId: 'run_a',
      factLayer: {
        eventCount: 2,
        evidenceCount: 2,
        eventCoverage: 1,
        sequenceConsistency: 1,
        runIsolation: 1
      },
      semanticLayer: {
        semanticSignalCount: expect.any(Number),
        evidenceLinkCorrectness: 1,
        orphanSemanticCount: 0
      },
      portraitLayer: {
        hypothesisCount: expect.any(Number),
        evidenceLinkedHypothesisCount: expect.any(Number),
        unsupportedClaimCount: 0
      },
      graphLayer: {
        nodeCount: expect.any(Number),
        edgeCount: expect.any(Number),
        edgeEndpointIntegrity: 1,
        orphanHypothesisCount: 0,
        missingEvidenceReferenceCount: 0,
        environmentOnlyCapViolations: 0
      }
    });
  });

  it('creates an auditable LLM batch plan without making provider calls', () => {
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
      }),
      deviceEvent({
        id: 'garage_device_1',
        sourceEventId: 'source_garage_device_1',
        sequence: 3,
        simTime: '2026-06-22T08:10:00',
        roomId: 'garage',
        deviceId: 'garage_tool_01',
        deviceType: 'tool_battery',
        field: 'charging',
        value: true
      }),
      deviceEvent({
        id: 'garage_device_2',
        sourceEventId: 'source_garage_device_2',
        sequence: 4,
        simTime: '2026-06-22T08:15:00',
        roomId: 'garage',
        deviceId: 'garage_door_sensor_01',
        deviceType: 'contact_sensor',
        field: 'open',
        value: true
      })
    ]);
    const llmConfig = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_MODEL: 'memory-model'
    });
    const fetcher = vi.fn();

    const plan = (memoryQuery as any).createHomeMemoryLlmBatchPlan(
      memory,
      { includePortraitSummary: true },
      {
        llmConfig,
        fetcher,
        llmUsage: {
          callsThisHour: () => 0,
          callsToday: () => 0,
          recordCall: vi.fn()
        }
      }
    );

    expect(plan).toMatchObject({
      homeId: 'home_1',
      runId: 'run_a',
      realtimeDeviceEventCallsAllowed: false,
      maxBatchSize: 8,
      allowedCount: expect.any(Number),
      skippedCount: expect.any(Number)
    });
    expect(plan.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        purpose: 'unknown_schema_mapping',
        trigger: 'batch',
        shouldCall: true,
        targetId: 'schema:pet_feeder:mealDispensed'
      }),
      expect.objectContaining({
        purpose: 'semantic_candidate',
        trigger: 'batch',
        shouldCall: true,
        targetId: expect.stringContaining('semantic-window:garage')
      }),
      expect.objectContaining({
        purpose: 'reliability_review',
        trigger: 'batch',
        shouldCall: true
      })
    ]));
    expect(plan.items.every((item: { trigger: string }) => item.trigger !== 'device_event')).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('executes batch LLM work with item-level validation failures isolated', async () => {
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
      }),
      deviceEvent({
        id: 'garage_device_1',
        sourceEventId: 'source_garage_device_1',
        sequence: 3,
        simTime: '2026-06-22T08:10:00',
        roomId: 'garage',
        deviceId: 'garage_tool_01',
        deviceType: 'tool_battery',
        field: 'charging',
        value: true
      }),
      deviceEvent({
        id: 'garage_device_2',
        sourceEventId: 'source_garage_device_2',
        sequence: 4,
        simTime: '2026-06-22T08:15:00',
        roomId: 'garage',
        deviceId: 'garage_door_sensor_01',
        deviceType: 'contact_sensor',
        field: 'open',
        value: true
      })
    ]);
    const llmConfig = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_MODEL: 'memory-model'
    });
    const cache = new Map();
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const prompt = JSON.parse(body.messages[1].content) as { purpose: string; evidenceIds?: string[]; candidate?: { evidenceIds: string[] } };
      const evidenceIds = prompt.evidenceIds ?? prompt.candidate?.evidenceIds ?? [];
      const claim = prompt.purpose === 'unknown_schema_mapping'
        ? 'This invalid mapping references evidence that does not exist.'
        : 'The garage batch candidate remains evidence-locked.';
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              purpose: prompt.purpose,
              claim,
              type: 'semantic_candidate',
              confidence: 0.3,
              supportingEvidenceIds: prompt.purpose === 'unknown_schema_mapping' ? ['missing_evidence'] : evidenceIds,
              contradictingEvidenceIds: [],
              missingEvidence: [],
              alternatives: []
            })
          }
        }]
      }), { status: 200 });
    });

    const result = await (memoryQuery as any).executeHomeMemoryLlmBatch(
      memory,
      { limit: 2 },
      { llmConfig, fetcher, llmCache: cache }
    );

    expect(result.plan.allowedCount).toBeGreaterThanOrEqual(2);
    expect(result.results).toEqual([
      expect.objectContaining({
        purpose: 'unknown_schema_mapping',
        source: 'deterministic-fallback',
        errors: expect.arrayContaining([expect.stringMatching(/missing_evidence/)])
      }),
      expect.objectContaining({
        purpose: 'semantic_candidate',
        source: 'llm',
        errors: []
      })
    ]);
    expect(cache.size).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('creates an auditable household portrait with required section layers', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'entry_unlock',
        sourceEventId: 'source_entry_unlock',
        sequence: 1,
        simTime: '2026-06-22T18:00:00',
        roomId: 'entrance',
        deviceId: 'front_lock_01',
        deviceType: 'door_lock',
        field: 'lock',
        value: 'unlocked'
      }),
      deviceEvent({
        id: 'kitchen_motion',
        sourceEventId: 'source_kitchen_motion',
        sequence: 2,
        simTime: '2026-06-22T18:08:00',
        roomId: 'kitchen',
        deviceId: 'kitchen_motion_01',
        deviceType: 'motion_sensor',
        field: 'motion',
        value: true
      }),
      deviceEvent({
        id: 'stove_power',
        sourceEventId: 'source_stove_power',
        sequence: 3,
        simTime: '2026-06-22T18:10:00',
        roomId: 'kitchen',
        deviceId: 'stove_01',
        deviceType: 'stove',
        field: 'powerW',
        value: 900
      }),
      deviceEvent({
        id: 'living_tv',
        sourceEventId: 'source_living_tv',
        sequence: 4,
        simTime: '2026-06-22T20:00:00',
        roomId: 'living',
        deviceId: 'tv_01',
        deviceType: 'tv',
        field: 'power',
        value: true
      })
    ]);

    const portrait = createHouseholdPortrait(memory);

    expect(portrait).toMatchObject({
      homeId: 'home_1',
      runId: 'run_a',
      confidence: expect.any(Number),
      evidenceQuality: {
        evidenceCount: expect.any(Number),
        independentDeviceCount: expect.any(Number),
        distinctRoomCount: expect.any(Number),
        observedDayCount: expect.any(Number),
        observedWeekCount: expect.any(Number),
        unsupportedClaimCount: 0
      }
    });
    expect(portrait.sections.map((section) => section.id)).toEqual([
      'household_composition',
      'daily_rhythm',
      'room_functions',
      'routine_patterns',
      'behavior_flows',
      'device_contribution',
      'current_presence',
      'anomalies_and_uncertainty',
      'evidence_quality'
    ]);
    expect(portrait.sections.every((section) => (
      Array.isArray(section.evidenceIds) &&
      Array.isArray(section.missingEvidence) &&
      Array.isArray(section.contradictingEvidenceIds) &&
      Array.isArray(section.hypothesisIds) &&
      typeof section.confidence === 'number' &&
      typeof section.summary === 'string' &&
      section.explanationSource === 'rule_template'
    ))).toBe(true);
    expect(portrait.sections.find((section) => section.id === 'current_presence')).toMatchObject({
      evidenceIds: expect.arrayContaining(['living_tv']),
      hypothesisIds: expect.arrayContaining(['presence:recent-activity'])
    });
  });

  it('adds opt-in provider-backed LLM summary to the household portrait', async () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
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
        id: 'living_tv',
        sourceEventId: 'source_living_tv',
        sequence: 2,
        simTime: '2026-06-22T20:00:00',
        roomId: 'living',
        deviceId: 'tv_01',
        deviceType: 'tv',
        field: 'power',
        value: true
      })
    ]);
    const llmConfig = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_MODEL: 'memory-model'
    });
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const prompt = JSON.parse(body.messages[1].content) as { evidenceIds: string[] };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              purpose: 'daily_portrait_summary',
              claim: 'Provider portrait summary remains evidence-locked.',
              type: 'portrait_summary',
              confidence: 0.1,
              supportingEvidenceIds: [prompt.evidenceIds[0]],
              contradictingEvidenceIds: [],
              missingEvidence: ['More observed days would improve the portrait.'],
              alternatives: []
            })
          }
        }]
      }), { status: 200 });
    });

    const portrait = await createHouseholdPortraitWithEnrichment(
      memory,
      { includeLlmEnrichment: true },
      { llmConfig, fetcher }
    );

    expect(portrait).toMatchObject({
      llmSummary: {
        purpose: 'daily_portrait_summary',
        type: 'portrait_summary',
        claim: 'Provider portrait summary remains evidence-locked.',
        metadata: {
          model: 'memory-model'
        }
      },
      llmSummarySource: 'llm'
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('can request a weekly provider-backed household portrait summary', async () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'kitchen_motion',
        sourceEventId: 'source_kitchen_motion',
        sequence: 1,
        roomId: 'kitchen',
        deviceId: 'kitchen_motion_01',
        deviceType: 'motion_sensor',
        field: 'motion',
        value: true
      })
    ]);
    const llmConfig = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_MODEL: 'memory-model'
    });
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const prompt = JSON.parse(body.messages[1].content) as { summaryPeriod: string; evidenceIds: string[] };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              purpose: 'daily_portrait_summary',
              claim: `${prompt.summaryPeriod} portrait summary remains evidence-locked.`,
              type: 'portrait_summary',
              confidence: 0.1,
              supportingEvidenceIds: [prompt.evidenceIds[0]],
              contradictingEvidenceIds: [],
              missingEvidence: ['More observed weeks would improve the portrait.'],
              alternatives: []
            })
          }
        }]
      }), { status: 200 });
    });

    const portrait = await createHouseholdPortraitWithEnrichment(
      memory,
      { includeLlmEnrichment: true, summaryPeriod: 'weekly' },
      { llmConfig, fetcher }
    );

    expect(portrait.llmSummary?.claim).toBe('weekly portrait summary remains evidence-locked.');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('plans a natural-language memory query with provider-backed evidence constraints', async () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
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
        id: 'living_tv',
        sourceEventId: 'source_living_tv',
        sequence: 2,
        simTime: '2026-06-22T20:00:00',
        roomId: 'living',
        deviceId: 'tv_01',
        deviceType: 'tv',
        field: 'power',
        value: true
      })
    ]);
    const llmConfig = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_MODEL: 'memory-model'
    });
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const prompt = JSON.parse(body.messages[1].content) as { evidenceIds: string[] };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              purpose: 'query_planning',
              claim: 'Query kitchen activity by reading recent kitchen evidence first.',
              type: 'query_plan',
              confidence: 0.4,
              supportingEvidenceIds: [prompt.evidenceIds[0]],
              contradictingEvidenceIds: [],
              missingEvidence: [],
              alternatives: []
            })
          }
        }]
      }), { status: 200 });
    });

    const result = await planMemoryQuery(
      memory,
      { question: 'What happened in the kitchen?' },
      { llmConfig, fetcher }
    );

    expect(result).toMatchObject({
      question: 'What happened in the kitchen?',
      planSource: 'llm',
      plan: {
        purpose: 'query_planning',
        type: 'query_plan',
        claim: 'Query kitchen activity by reading recent kitchen evidence first.'
      },
      execution: {
        target: 'evidence',
        query: {
          roomId: 'kitchen'
        },
        evidenceIds: expect.arrayContaining(['kitchen_motion'])
      }
    });
    expect(result.execution.items).toEqual([
      expect.objectContaining({ id: 'kitchen_motion', roomId: 'kitchen' })
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
