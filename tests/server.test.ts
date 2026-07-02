import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WebSocket } from '@fastify/websocket';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/server/app';
import { getHomeDefinition } from '../src/sim/catalog';
import { resolveHomeMemoryLlmConfig } from '../src/sim/llm/homeMemoryEnrichment';
import { deviceCapabilities } from '../src/shared/deviceRegistry';

function parseServerSentEvents(body: string): Array<{ event: string; data: Record<string, unknown> }> {
  return body
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1] ?? 'message';
      const data = block.match(/^data: (.+)$/m)?.[1] ?? '{}';
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

describe('server API', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('starts scenarios, advances simulation, and exposes state/events/telemetry', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-api-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const start = await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    expect(start.statusCode).toBe(200);

    const advance = await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 12 }
    });
    expect(advance.statusCode).toBe(200);
    expect(advance.json().events.some((event: { type: string }) => event.type === 'ActivityStarted')).toBe(true);

    const state = await server.inject({ method: 'GET', url: '/api/state' });
    expect(state.json().homeState.mode).toBe('morning');
    expect(state.json().rooms.kitchen.people).toContain('adult_1');

    const events = await server.inject({ method: 'GET', url: '/api/events?limit=20' });
    expect(events.json().some((event: { type: string }) => event.type === 'DeviceTelemetry')).toBe(true);

    const telemetry = await server.inject({ method: 'GET', url: '/api/telemetry?limit=20' });
    expect(telemetry.json().some((event: { type: string }) => event.type === 'DeviceTelemetry')).toBe(true);

    await server.close();
  });

  it('exposes queryable home memory views for external agents', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-memory-api-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const start = await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    expect(start.statusCode).toBe(200);

    const advance = await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 30 }
    });
    expect(advance.statusCode).toBe(200);

    const summary = await server.inject({ method: 'GET', url: '/api/memory/summary' });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({
      homeId: 'default_home',
      runId: expect.any(String),
      totalEvents: expect.any(Number),
      profileEventCount: expect.any(Number)
    });
    expect(summary.json().activeRooms.length).toBeGreaterThan(0);
    expect(summary.json().activeDevices.length).toBeGreaterThan(0);
    expect(summary.json().recentHighlights.length).toBeGreaterThan(0);

    const rooms = await server.inject({ method: 'GET', url: '/api/memory/entities?kind=room' });
    expect(rooms.statusCode).toBe(200);
    expect(rooms.json().kind).toBe('room');
    expect(rooms.json().items.some((room: { roomId: string }) => room.roomId === 'kitchen')).toBe(true);

    const kitchenFields = await server.inject({ method: 'GET', url: '/api/memory/entities?kind=field&roomId=kitchen' });
    expect(kitchenFields.statusCode).toBe(200);
    expect(kitchenFields.json().items.length).toBeGreaterThan(0);
    expect(kitchenFields.json().items.every((field: { roomId: string }) => field.roomId === 'kitchen')).toBe(true);

    const episodes = await server.inject({ method: 'GET', url: '/api/memory/episodes?status=closed&limit=10' });
    expect(episodes.statusCode).toBe(200);
    expect(episodes.json().items.length).toBeLessThanOrEqual(10);
    expect(episodes.json().items.every((episode: { status: string }) => episode.status === 'closed')).toBe(true);

    const evidence = await server.inject({ method: 'GET', url: '/api/memory/evidence?roomId=kitchen&meaningfulOnly=true&limit=5' });
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json().items.length).toBeLessThanOrEqual(5);
    expect(evidence.json().items.every((item: { roomId: string; profileWeight: number }) => (
      item.roomId === 'kitchen' && item.profileWeight > 0
    ))).toBe(true);

    const hypotheses = await server.inject({ method: 'GET', url: '/api/memory/profile/hypotheses?type=presence_signal' });
    expect(hypotheses.statusCode).toBe(200);
    expect(hypotheses.json().items).toHaveLength(1);
    expect(hypotheses.json().items[0]).toMatchObject({
      type: 'presence_signal',
      confidence: expect.any(Number),
      evidenceCount: expect.any(Number)
    });

    const enrichedHypotheses = await server.inject({
      method: 'GET',
      url: '/api/memory/profile/hypotheses?type=presence_signal&includeLlmEnrichment=true&includeReliability=true'
    });
    expect(enrichedHypotheses.statusCode).toBe(200);
    expect(enrichedHypotheses.json().items[0]).toMatchObject({
      type: 'presence_signal',
      llmEnrichment: {
        purpose: 'hypothesis_explanation',
        metadata: {
          model: 'deterministic-fallback'
        }
      },
      reliability: {
        unsupportedClaimCount: 0,
        explanationSource: 'rule_template'
      }
    });

    const schemaMappings = await server.inject({
      method: 'GET',
      url: '/api/memory/schema-mappings?includeLlmEnrichment=true'
    });
    expect(schemaMappings.statusCode).toBe(200);
    expect(schemaMappings.json()).toMatchObject({
      runId: expect.any(String),
      items: expect.any(Array)
    });

    const semanticCandidates = await server.inject({
      method: 'GET',
      url: '/api/memory/semantic-candidates?includeLlmEnrichment=true'
    });
    expect(semanticCandidates.statusCode).toBe(200);
    expect(semanticCandidates.json()).toMatchObject({
      runId: expect.any(String),
      items: expect.any(Array)
    });

    const reliability = await server.inject({ method: 'GET', url: '/api/memory/reliability' });
    expect(reliability.statusCode).toBe(200);
    expect(reliability.json()).toMatchObject({
      runId: expect.any(String),
      factLayer: {
        eventCoverage: expect.any(Number),
        sequenceConsistency: expect.any(Number),
        runIsolation: expect.any(Number)
      },
      semanticLayer: {
        evidenceLinkCorrectness: expect.any(Number)
      },
      portraitLayer: {
        unsupportedClaimCount: 0
      },
      graphLayer: {
        edgeEndpointIntegrity: expect.any(Number),
        missingEvidenceReferenceCount: 0
      }
    });

    const portrait = await server.inject({ method: 'GET', url: '/api/memory/portrait' });
    expect(portrait.statusCode).toBe(200);
    expect(portrait.json()).toMatchObject({
      homeId: 'default_home',
      runId: expect.any(String),
      sections: expect.arrayContaining([
        expect.objectContaining({
          id: 'household_composition',
          explanationSource: 'rule_template',
          evidenceIds: expect.any(Array),
          missingEvidence: expect.any(Array)
        }),
        expect.objectContaining({
          id: 'evidence_quality',
          evidenceIds: expect.any(Array)
        })
      ]),
      evidenceQuality: {
        unsupportedClaimCount: 0
      }
    });

    await server.close();
  });

  it('uses configured LLM provider for opt-in memory hypothesis enrichment', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-memory-llm-api-'));
    dirs.push(dir);
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const prompt = JSON.parse(body.messages[1].content) as { evidenceIds: string[] };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              purpose: 'hypothesis_explanation',
              claim: 'Provider-backed API explanation remains evidence-locked.',
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
    const server = createServer({
      databasePath: path.join(dir, 'twin.db'),
      autoTick: false,
      homeMemoryLlm: resolveHomeMemoryLlmConfig({
        HOME_MEMORY_LLM_ENABLED: 'true',
        HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
        HOME_MEMORY_LLM_MODEL: 'memory-model'
      }),
      homeMemoryLlmFetch: fetcher
    });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 30 }
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/memory/profile/hypotheses?type=presence_signal&includeLlmEnrichment=true'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({
      type: 'presence_signal',
      llmEnrichment: {
        claim: 'Provider-backed API explanation remains evidence-locked.',
        metadata: {
          model: 'memory-model'
        }
      },
      llmEnrichmentSource: 'llm'
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await server.close();
  });

  it('reuses cached memory LLM enrichment for repeated hypothesis requests', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-memory-llm-cache-api-'));
    dirs.push(dir);
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const prompt = JSON.parse(body.messages[1].content) as { evidenceIds: string[] };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              purpose: 'hypothesis_explanation',
              claim: 'Cached API explanation remains evidence-locked.',
              type: 'hypothesis_explanation',
              confidence: 0.1,
              supportingEvidenceIds: [prompt.evidenceIds[0]],
              contradictingEvidenceIds: [],
              missingEvidence: [],
              alternatives: []
            })
          }
        }]
      }), { status: 200 });
    });
    const server = createServer({
      databasePath: path.join(dir, 'twin.db'),
      autoTick: false,
      homeMemoryLlm: resolveHomeMemoryLlmConfig({
        HOME_MEMORY_LLM_ENABLED: 'true',
        HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
        HOME_MEMORY_LLM_MODEL: 'memory-model'
      }),
      homeMemoryLlmFetch: fetcher
    });

    await server.inject({ method: 'POST', url: '/api/scenarios/weekday_normal/start' });
    await server.inject({ method: 'POST', url: '/api/control/advance', payload: { minutes: 30 } });

    const first = await server.inject({
      method: 'GET',
      url: '/api/memory/profile/hypotheses?type=presence_signal&includeLlmEnrichment=true'
    });
    const second = await server.inject({
      method: 'GET',
      url: '/api/memory/profile/hypotheses?type=presence_signal&includeLlmEnrichment=true'
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().items[0]).toMatchObject({
      llmEnrichmentSource: 'llm'
    });
    expect(second.json().items[0]).toMatchObject({
      llmEnrichmentSource: 'cache',
      llmEnrichment: {
        claim: 'Cached API explanation remains evidence-locked.'
      }
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await server.close();
  });

  it('persists cached memory LLM enrichment across server restarts', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-memory-llm-persistent-cache-api-'));
    dirs.push(dir);
    const databasePath = path.join(dir, 'twin.db');
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const prompt = JSON.parse(body.messages[1].content) as { evidenceIds: string[] };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              purpose: 'hypothesis_explanation',
              claim: 'Persistent API explanation remains evidence-locked.',
              type: 'hypothesis_explanation',
              confidence: 0.1,
              supportingEvidenceIds: [prompt.evidenceIds[0]],
              contradictingEvidenceIds: [],
              missingEvidence: [],
              alternatives: []
            })
          }
        }]
      }), { status: 200 });
    });
    const llmConfig = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_MODEL: 'memory-model'
    });

    let firstServer: ReturnType<typeof createServer> | undefined;
    let secondServer: ReturnType<typeof createServer> | undefined;
    try {
      firstServer = createServer({
        databasePath,
        autoTick: false,
        homeMemoryLlm: llmConfig,
        homeMemoryLlmFetch: fetcher
      });
      await firstServer.inject({ method: 'POST', url: '/api/scenarios/weekday_normal/start' });
      await firstServer.inject({ method: 'POST', url: '/api/control/advance', payload: { minutes: 30 } });

      const first = await firstServer.inject({
        method: 'GET',
        url: '/api/memory/profile/hypotheses?type=presence_signal&includeLlmEnrichment=true'
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().items[0]).toMatchObject({
        llmEnrichmentSource: 'llm',
        llmEnrichment: {
          claim: 'Persistent API explanation remains evidence-locked.'
        }
      });
      await firstServer.close();
      firstServer = undefined;

      secondServer = createServer({
        databasePath,
        autoTick: false,
        homeMemoryLlm: llmConfig,
        homeMemoryLlmFetch: fetcher
      });
      const second = await secondServer.inject({
        method: 'GET',
        url: '/api/memory/profile/hypotheses?type=presence_signal&includeLlmEnrichment=true'
      });

      expect(second.statusCode).toBe(200);
      expect(second.json().items[0]).toMatchObject({
        llmEnrichmentSource: 'cache',
        llmEnrichment: {
          claim: 'Persistent API explanation remains evidence-locked.'
        }
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      await secondServer?.close();
      await firstServer?.close();
    }
  });

  it('enforces memory LLM call budgets across API requests', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-memory-llm-budget-api-'));
    dirs.push(dir);
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const prompt = JSON.parse(body.messages[1].content) as { evidenceIds: string[] };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              purpose: 'hypothesis_explanation',
              claim: 'Budgeted API explanation remains evidence-locked.',
              type: 'hypothesis_explanation',
              confidence: 0.1,
              supportingEvidenceIds: [prompt.evidenceIds[0]],
              contradictingEvidenceIds: [],
              missingEvidence: [],
              alternatives: []
            })
          }
        }]
      }), { status: 200 });
    });
    const llmConfig = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_MODEL: 'memory-model'
    });
    const server = createServer({
      databasePath: path.join(dir, 'twin.db'),
      autoTick: false,
      homeMemoryLlm: {
        ...llmConfig,
        budget: {
          ...llmConfig.budget,
          maxCallsPerHomePerHour: 1,
          maxCallsPerHomePerDay: 1
        }
      },
      homeMemoryLlmFetch: fetcher
    });

    await server.inject({ method: 'POST', url: '/api/scenarios/weekday_normal/start' });
    await server.inject({ method: 'POST', url: '/api/control/advance', payload: { minutes: 30 } });

    const first = await server.inject({
      method: 'GET',
      url: '/api/memory/profile/hypotheses?type=presence_signal&includeLlmEnrichment=true'
    });
    const second = await server.inject({
      method: 'GET',
      url: '/api/memory/profile/hypotheses?type=daily_rhythm&includeLlmEnrichment=true'
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().items[0]).toMatchObject({
      llmEnrichmentSource: 'llm'
    });
    expect(second.json().items[0]).toMatchObject({
      llmEnrichmentSource: 'deterministic-fallback',
      llmEnrichmentErrors: expect.arrayContaining([
        expect.stringMatching(/budget exhausted/i)
      ])
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await server.close();
  });

  it('adds cached opt-in LLM summary to the household portrait API', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-memory-portrait-llm-api-'));
    dirs.push(dir);
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const prompt = JSON.parse(body.messages[1].content) as { evidenceIds: string[] };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              purpose: 'daily_portrait_summary',
              claim: 'API portrait summary remains evidence-locked.',
              type: 'portrait_summary',
              confidence: 0.4,
              supportingEvidenceIds: [prompt.evidenceIds[0]],
              contradictingEvidenceIds: [],
              missingEvidence: ['More observed days would improve the portrait.'],
              alternatives: []
            })
          }
        }]
      }), { status: 200 });
    });
    const server = createServer({
      databasePath: path.join(dir, 'twin.db'),
      autoTick: false,
      homeMemoryLlm: resolveHomeMemoryLlmConfig({
        HOME_MEMORY_LLM_ENABLED: 'true',
        HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
        HOME_MEMORY_LLM_MODEL: 'memory-model'
      }),
      homeMemoryLlmFetch: fetcher
    });

    await server.inject({ method: 'POST', url: '/api/scenarios/weekday_normal/start' });
    await server.inject({ method: 'POST', url: '/api/control/advance', payload: { minutes: 30 } });

    const first = await server.inject({
      method: 'GET',
      url: '/api/memory/portrait?includeLlmEnrichment=true'
    });
    const second = await server.inject({
      method: 'GET',
      url: '/api/memory/portrait?includeLlmEnrichment=true'
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      llmSummarySource: 'llm',
      llmSummary: {
        purpose: 'daily_portrait_summary',
        type: 'portrait_summary',
        claim: 'API portrait summary remains evidence-locked.'
      }
    });
    expect(second.json()).toMatchObject({
      llmSummarySource: 'cache',
      llmSummary: {
        claim: 'API portrait summary remains evidence-locked.'
      }
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await server.close();
  });

  it('adds cached provider-backed plans for natural-language memory queries', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-memory-query-plan-api-'));
    dirs.push(dir);
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const prompt = JSON.parse(body.messages[1].content) as { evidenceIds: string[] };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              purpose: 'query_planning',
              claim: 'Use recent evidence before answering the memory question.',
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
    const server = createServer({
      databasePath: path.join(dir, 'twin.db'),
      autoTick: false,
      homeMemoryLlm: resolveHomeMemoryLlmConfig({
        HOME_MEMORY_LLM_ENABLED: 'true',
        HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
        HOME_MEMORY_LLM_MODEL: 'memory-model'
      }),
      homeMemoryLlmFetch: fetcher
    });

    await server.inject({ method: 'POST', url: '/api/scenarios/weekday_normal/start' });
    await server.inject({ method: 'POST', url: '/api/control/advance', payload: { minutes: 30 } });

    const first = await server.inject({
      method: 'GET',
      url: '/api/memory/query-plan?question=presence'
    });
    const second = await server.inject({
      method: 'GET',
      url: '/api/memory/query-plan?question=presence'
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      question: 'presence',
      planSource: 'llm',
      plan: {
        purpose: 'query_planning',
        type: 'query_plan'
      },
      execution: {
        target: 'hypotheses',
        evidenceIds: expect.any(Array)
      }
    });
    expect(second.json()).toMatchObject({
      planSource: 'cache',
      plan: {
        claim: 'Use recent evidence before answering the memory question.'
      }
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await server.close();
  });

  it('reports memory LLM cache, budget, fallback, and token metrics', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-memory-llm-metrics-api-'));
    dirs.push(dir);
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const prompt = JSON.parse(body.messages[1].content) as { purpose: string; evidenceIds: string[] };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              purpose: prompt.purpose,
              claim: 'Metrics test explanation remains evidence-locked.',
              type: prompt.purpose === 'query_planning' ? 'query_plan' : 'hypothesis_explanation',
              confidence: 0.1,
              supportingEvidenceIds: [prompt.evidenceIds[0]],
              contradictingEvidenceIds: [],
              missingEvidence: [],
              alternatives: []
            })
          }
        }]
      }), { status: 200 });
    });
    const llmConfig = resolveHomeMemoryLlmConfig({
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_MODEL: 'memory-model'
    });
    const server = createServer({
      databasePath: path.join(dir, 'twin.db'),
      autoTick: false,
      homeMemoryLlm: {
        ...llmConfig,
        budget: {
          ...llmConfig.budget,
          maxCallsPerHomePerHour: 1,
          maxCallsPerHomePerDay: 1
        }
      },
      homeMemoryLlmFetch: fetcher
    });

    await server.inject({ method: 'POST', url: '/api/scenarios/weekday_normal/start' });
    await server.inject({ method: 'POST', url: '/api/control/advance', payload: { minutes: 30 } });

    await server.inject({
      method: 'GET',
      url: '/api/memory/profile/hypotheses?type=presence_signal&includeLlmEnrichment=true'
    });
    await server.inject({
      method: 'GET',
      url: '/api/memory/profile/hypotheses?type=presence_signal&includeLlmEnrichment=true'
    });
    await server.inject({
      method: 'GET',
      url: '/api/memory/query-plan?question=presence'
    });

    const response = await server.inject({ method: 'GET', url: '/api/memory/llm/metrics' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      enabled: true,
      provider: 'openai-compatible',
      cacheSize: 1,
      unsupportedClaimRate: 0,
      totalRequests: 3,
      sourceCounts: {
        llm: 1,
        cache: 1,
        deterministicFallback: 1
      },
      rates: {
        cacheHitRate: expect.any(Number),
        fallbackRate: expect.any(Number),
        validationRejectionRate: expect.any(Number),
        userTriggeredCallRatio: 1
      },
      callsByPurpose: {
        hypothesis_explanation: 1
      },
      estimatedTokensByPurpose: {
        hypothesis_explanation: 800
      },
      budgets: {
        maxCallsPerHomePerHour: 1,
        maxCallsPerHomePerDay: 1,
        callsThisHour: expect.any(Number),
        callsToday: expect.any(Number)
      }
    });
    expect(response.json().rates.cacheHitRate).toBeCloseTo(1 / 3, 3);
    expect(response.json().rates.fallbackRate).toBeCloseTo(1 / 3, 3);
    expect(fetcher).toHaveBeenCalledTimes(1);

    await server.close();
  });

  it('serves and updates masked runtime memory LLM config', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-memory-llm-config-api-'));
    dirs.push(dir);
    const server = createServer({
      databasePath: path.join(dir, 'twin.db'),
      autoTick: false,
      homeMemoryLlm: resolveHomeMemoryLlmConfig({
        HOME_MEMORY_LLM_ENABLED: 'true',
        HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
        HOME_MEMORY_LLM_API_KEY: 'secret-token',
        HOME_MEMORY_LLM_MODEL: 'memory-model'
      })
    });

    const initial = await server.inject({ method: 'GET', url: '/api/memory/llm/config' });

    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      provider: {
        enabled: true,
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.test/v1',
        model: 'memory-model',
        apiKeyConfigured: true
      }
    });
    expect(JSON.stringify(initial.json())).not.toContain('secret-token');

    const update = await server.inject({
      method: 'PUT',
      url: '/api/memory/llm/config',
      payload: {
        provider: {
          enabled: false,
          baseUrl: 'https://new-llm.example.test/v1',
          model: 'new-memory-model',
          apiKey: '',
          timeoutMs: 23000,
          maxRetries: 2
        },
        budget: {
          maxCallsPerHomePerHour: 3,
          maxCallsPerHomePerDay: 9,
          maxBatchSize: 4
        },
        gates: {
          minEvidenceCountForUnknownSchema: 3,
          minConfidenceForReview: 0.2,
          maxConfidenceForReview: 0.8
        }
      }
    });

    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({
      provider: {
        enabled: false,
        baseUrl: 'https://new-llm.example.test/v1',
        model: 'new-memory-model',
        apiKeyConfigured: true,
        timeoutMs: 23000,
        maxRetries: 2
      },
      budget: {
        maxCallsPerHomePerHour: 3,
        maxCallsPerHomePerDay: 9,
        maxBatchSize: 4
      },
      gates: {
        minEvidenceCountForUnknownSchema: 3,
        minConfidenceForReview: 0.2,
        maxConfidenceForReview: 0.8
      }
    });

    const cleared = await server.inject({
      method: 'PUT',
      url: '/api/memory/llm/config',
      payload: { provider: { clearApiKey: true } }
    });

    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().provider.apiKeyConfigured).toBe(false);

    const invalidConfidenceBand = await server.inject({
      method: 'PUT',
      url: '/api/memory/llm/config',
      payload: {
        gates: {
          minConfidenceForReview: 0.9,
          maxConfidenceForReview: 0.2
        }
      }
    });

    expect(invalidConfidenceBand.statusCode).toBe(400);

    await server.close();
  });

  it('streams memory LLM provider deltas and the validated result', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-memory-llm-stream-api-'));
    dirs.push(dir);
    const providerJson = JSON.stringify({
      purpose: 'hypothesis_explanation',
      claim: 'Streamed provider explanation remains evidence-locked.',
      type: 'hypothesis_explanation',
      confidence: 0.1,
      supportingEvidenceIds: ['placeholder'],
      contradictingEvidenceIds: [],
      missingEvidence: [],
      alternatives: []
    });
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const prompt = JSON.parse(body.messages[1].content) as { evidenceIds: string[] };
      const jsonText = providerJson.replace('placeholder', prompt.evidenceIds[0]);
      return new Response([
        `data: ${JSON.stringify({ choices: [{ delta: { content: jsonText.slice(0, 45) } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: jsonText.slice(45) } }] })}\n\n`,
        'data: [DONE]\n\n'
      ].join(''), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      });
    });
    const server = createServer({
      databasePath: path.join(dir, 'twin.db'),
      autoTick: false,
      homeMemoryLlm: resolveHomeMemoryLlmConfig({
        HOME_MEMORY_LLM_ENABLED: 'true',
        HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
        HOME_MEMORY_LLM_MODEL: 'memory-model'
      }),
      homeMemoryLlmFetch: fetcher
    });

    await server.inject({ method: 'POST', url: '/api/scenarios/weekday_normal/start' });
    await server.inject({ method: 'POST', url: '/api/control/advance', payload: { minutes: 30 } });

    const response = await server.inject({
      method: 'GET',
      url: '/api/memory/llm/stream?purpose=hypothesis_explanation&type=presence_signal'
    });
    const events = parseServerSentEvents(response.body);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(events.map((event) => event.event)).toEqual(expect.arrayContaining(['start', 'decision', 'provider_delta', 'result']));
    expect(events.filter((event) => event.event === 'provider_delta').map((event) => event.data.content).join('')).toContain('Streamed provider explanation');
    expect(events.find((event) => event.event === 'result')?.data).toMatchObject({
      source: 'llm',
      enrichment: {
        claim: 'Streamed provider explanation remains evidence-locked.',
        metadata: {
          model: 'memory-model'
        }
      },
      errors: []
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await server.close();
  });

  it('streams fallback events when the memory LLM provider is disabled', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-memory-llm-stream-fallback-api-'));
    dirs.push(dir);
    const fetcher = vi.fn();
    const server = createServer({
      databasePath: path.join(dir, 'twin.db'),
      autoTick: false,
      homeMemoryLlmFetch: fetcher
    });

    await server.inject({ method: 'POST', url: '/api/scenarios/weekday_normal/start' });
    await server.inject({ method: 'POST', url: '/api/control/advance', payload: { minutes: 30 } });

    const response = await server.inject({
      method: 'GET',
      url: '/api/memory/llm/stream?purpose=hypothesis_explanation&type=presence_signal'
    });
    const events = parseServerSentEvents(response.body);

    expect(response.statusCode).toBe(200);
    expect(events.map((event) => event.event)).toEqual(expect.arrayContaining(['decision', 'fallback', 'result']));
    expect(events.some((event) => event.event === 'provider_delta')).toBe(false);
    expect(events.find((event) => event.event === 'result')?.data).toMatchObject({
      source: 'deterministic-fallback',
      errors: expect.arrayContaining([
        expect.stringMatching(/disabled/i)
      ])
    });
    expect(fetcher).not.toHaveBeenCalled();

    await server.close();
  });

  it('reports planned memory LLM batch work without calling the provider', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-memory-llm-batch-plan-api-'));
    dirs.push(dir);
    const fetcher = vi.fn();
    const server = createServer({
      databasePath: path.join(dir, 'twin.db'),
      autoTick: false,
      homeMemoryLlm: resolveHomeMemoryLlmConfig({
        HOME_MEMORY_LLM_ENABLED: 'true',
        HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
        HOME_MEMORY_LLM_MODEL: 'memory-model'
      }),
      homeMemoryLlmFetch: fetcher
    });

    await server.inject({ method: 'POST', url: '/api/scenarios/weekday_normal/start' });
    await server.inject({ method: 'POST', url: '/api/control/advance', payload: { minutes: 30 } });

    const response = await server.inject({
      method: 'GET',
      url: '/api/memory/llm/batch-plan?includePortraitSummary=true'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      runId: expect.any(String),
      realtimeDeviceEventCallsAllowed: false,
      maxBatchSize: expect.any(Number),
      candidateCount: expect.any(Number),
      allowedCount: expect.any(Number),
      estimatedMaxTokens: expect.any(Number),
      items: expect.any(Array)
    });
    expect(response.json().items.every((item: { trigger: string }) => item.trigger !== 'device_event')).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();

    await server.close();
  });

  it('executes memory LLM batch work through an opt-in endpoint', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-memory-llm-batch-api-'));
    dirs.push(dir);
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const prompt = JSON.parse(body.messages[1].content) as { purpose: string; evidenceIds?: string[]; candidate?: { evidenceIds: string[] } };
      const evidenceIds = prompt.evidenceIds ?? prompt.candidate?.evidenceIds ?? [];
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              purpose: prompt.purpose,
              claim: 'Batch enrichment is evidence-locked.',
              type: prompt.purpose === 'daily_portrait_summary' ? 'portrait_summary' : 'semantic_candidate',
              confidence: 0.1,
              supportingEvidenceIds: evidenceIds,
              contradictingEvidenceIds: [],
              missingEvidence: [],
              alternatives: []
            })
          }
        }]
      }), { status: 200 });
    });
    const server = createServer({
      databasePath: path.join(dir, 'twin.db'),
      autoTick: false,
      homeMemoryLlm: resolveHomeMemoryLlmConfig({
        HOME_MEMORY_LLM_ENABLED: 'true',
        HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
        HOME_MEMORY_LLM_MODEL: 'memory-model'
      }),
      homeMemoryLlmFetch: fetcher
    });

    await server.inject({ method: 'POST', url: '/api/scenarios/weekday_normal/start' });
    await server.inject({ method: 'POST', url: '/api/control/advance', payload: { minutes: 30 } });

    const response = await server.inject({
      method: 'POST',
      url: '/api/memory/llm/batch',
      payload: { includePortraitSummary: true, limit: 1 }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      runId: expect.any(String),
      plan: {
        realtimeDeviceEventCallsAllowed: false,
        items: expect.any(Array)
      },
      results: [
        expect.objectContaining({
          source: 'llm',
          errors: []
        })
      ]
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await server.close();
  });

  it('serves an OpenAPI document for REST and WebSocket clients', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-openapi-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const response = await server.inject({ method: 'GET', url: '/api/openapi.json' });
    const document = response.json();

    expect(response.statusCode).toBe(200);
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.title).toBe('VirtualHome Twin API');
    expect(Object.keys(document.paths)).toEqual(expect.arrayContaining([
      '/api/state',
      '/api/events',
      '/api/telemetry',
      '/api/memory/summary',
      '/api/memory/entities',
      '/api/memory/episodes',
      '/api/memory/evidence',
      '/api/memory/profile/hypotheses',
      '/api/memory/schema-mappings',
      '/api/memory/semantic-candidates',
      '/api/memory/reliability',
      '/api/memory/portrait',
      '/api/memory/query-plan',
      '/api/memory/llm/batch-plan',
      '/api/memory/llm/batch',
      '/api/memory/llm/config',
      '/api/memory/llm/stream',
      '/api/memory/llm/metrics',
      '/api/device-twins',
      '/api/device-capabilities',
      '/api/home-definition',
      '/api/daily/start',
      '/api/control/advance',
      '/api/control/inject',
      '/api/control/resolve',
      '/api/devices/{deviceId}/command',
      '/api/alerts/{alertId}/status',
      '/api/audit/access',
      '/ws',
      '/ws/device-events'
    ]));
    expect(document.paths['/api/control/advance'].post.requestBody.content['application/json'].schema.properties).toHaveProperty('idempotencyKey');
    expect(document.components.schemas).toHaveProperty('ValidationError');
    expect(document.components.schemas).toHaveProperty('NotFoundError');
    expect(document.components.schemas).toHaveProperty('DeviceCapability');
    expect(document.components.schemas).toHaveProperty('EventLineage');
    expect(document.components.schemas).toHaveProperty('DeviceTelemetryEvent');
    expect(document.components.schemas).toHaveProperty('DeviceStateChangedEvent');
    expect(document.components.schemas).toHaveProperty('DeviceValueEvent');
    expect(document.components.schemas).toHaveProperty('DeviceSocketUpdateMessage');
    expect(document.components.schemas).toHaveProperty('EventExplanation');
    expect(document.components.schemas.DeviceCapability.properties).toHaveProperty('markerKind');
    expect(document.components.schemas.DeviceCapability.properties).toHaveProperty('animationHint');
    expect(document.components.schemas.DeviceCapability.properties).toHaveProperty('riskLevel');
    expect(document.components.schemas.DeviceCapability.properties).toHaveProperty('visualModel');
    expect(document.components.schemas.DeviceCapability.properties).toHaveProperty('visualScale');
    expect(document.components.schemas.DeviceCapability.properties).toHaveProperty('commandMetadata');
    expect(document.components.schemas.DeviceCapability.properties).toHaveProperty('healthSignals');
    expect(document.components.schemas.DeviceCapability.properties).toHaveProperty('defaultState');
    expect(document.components.schemas.DeviceCapability.properties).toHaveProperty('stateFields');
    expect(document.components.schemas.DeviceCapability.properties.stateFields.additionalProperties.properties).toHaveProperty('defaultValue');
    expect(document.components.schemas.DeviceCapability.properties.stateFields.additionalProperties.properties).toHaveProperty('unit');
    expect(document.components.schemas.DeviceCapability.properties.stateFields.additionalProperties.properties).toHaveProperty('normalRange');
    expect(document.components.schemas).toHaveProperty('AccessAuditRecord');
    expect(document.components.schemas.DeviceAccessRecord.required).toEqual(expect.arrayContaining(['shortLabel', 'instanceGroup', 'privacyLevel', 'riskLevel', 'visualModel', 'visualScale', 'pose', 'stateFields', 'supportedCommands', 'commandMetadata', 'healthStatus']));
    expect(document.components.schemas.DeviceAccessRecord.properties).toHaveProperty('shortLabel');
    expect(document.components.schemas.DeviceAccessRecord.properties).toHaveProperty('instanceGroup');
    expect(document.components.schemas.DeviceAccessRecord.properties).toHaveProperty('privacyLevel');
    expect(document.components.schemas.DeviceAccessRecord.properties).toHaveProperty('riskLevel');
    expect(document.components.schemas.DeviceAccessRecord.properties).toHaveProperty('visualModel');
    expect(document.components.schemas.DeviceAccessRecord.properties).toHaveProperty('visualScale');
    expect(document.components.schemas.DeviceAccessRecord.properties).toHaveProperty('pose');
    expect(document.components.schemas.DeviceAccessRecord.properties).toHaveProperty('stateFields');
    expect(document.components.schemas.DeviceAccessRecord.properties).toHaveProperty('supportedCommands');
    expect(document.components.schemas.DeviceAccessRecord.properties).toHaveProperty('commandMetadata');
    expect(document.components.schemas.DeviceAccessRecord.properties).toHaveProperty('healthStatus');
    expect(document.components.schemas.DeviceAccessRecord.properties.healthStatus.items.properties.kind.enum)
      .toContain('command_failure');
    expect(document.components.schemas.DeviceAccessRecord.properties.lastCommand.anyOf[0].properties.status.enum).toEqual([
      'requested',
      'sent',
      'acknowledged',
      'failed',
      'timed-out',
      'none'
    ]);
    expect(document.components.schemas.MemoryHypothesis.properties).toHaveProperty('reliability');
    expect(document.components.schemas.MemoryHypothesis.properties).toHaveProperty('llmEnrichment');
    expect(document.components.schemas.MemoryHypothesis.properties).toHaveProperty('llmEnrichmentSource');
    expect(document.components.schemas.MemoryHypothesis.properties).toHaveProperty('llmReliabilityReview');
    expect(document.components.schemas.MemoryHypothesis.properties).toHaveProperty('llmReliabilityReviewSource');
    expect(document.components.schemas).toHaveProperty('UnknownSchemaMappingResult');
    expect(document.components.schemas).toHaveProperty('SemanticCandidateResult');
    expect(document.components.schemas).toHaveProperty('MemoryReliabilityReport');
    expect(document.components.schemas).toHaveProperty('HomeMemoryLlmBatchPlan');
    expect(document.components.schemas).toHaveProperty('AbnormalityInjectedEvent');
    expect(document.components.schemas).toHaveProperty('AlertCreatedEvent');
    expect(document.components.schemas).toHaveProperty('AlertStatusChangedEvent');
    expect(document.components.schemas).toHaveProperty('AutomationTriggeredEvent');
    expect(document.components.schemas).toHaveProperty('RuleRecoveredEvent');
    expect(document.components.schemas).toHaveProperty('ScenarioControlEvent');
    expect(document.components.schemas).toHaveProperty('PersonMovedEvent');
    expect(document.components.schemas).toHaveProperty('ActivityStartedEvent');
    expect(document.components.schemas).toHaveProperty('ActivityEndedEvent');
    expect(document.components.schemas).toHaveProperty('ConversationOccurredEvent');
    expect(document.components.schemas).toHaveProperty('ObjectMovedEvent');
    expect(document.components.schemas).toHaveProperty('ExternalInteractionOccurredEvent');
    expect(document.components.schemas).toHaveProperty('TwinSocketUpdateMessage');
    expect(document.components.schemas).toHaveProperty('TwinSocketHeartbeatMessage');
    expect(document.components.schemas.TwinEvent.anyOf).toContainEqual({ $ref: '#/components/schemas/DeviceTelemetryEvent' });
    expect(document.components.schemas.TwinEvent.anyOf).toContainEqual({ $ref: '#/components/schemas/DeviceStateChangedEvent' });
    expect(document.components.schemas.TwinEvent.anyOf).toContainEqual({ $ref: '#/components/schemas/PersonMovedEvent' });
    expect(document.components.schemas.TwinEvent.anyOf).toContainEqual({ $ref: '#/components/schemas/ActivityStartedEvent' });
    expect(document.components.schemas.TwinEvent.anyOf).toContainEqual({ $ref: '#/components/schemas/ActivityEndedEvent' });
    expect(document.components.schemas.TwinEvent.anyOf).toContainEqual({ $ref: '#/components/schemas/ConversationOccurredEvent' });
    expect(document.components.schemas.TwinEvent.anyOf).toContainEqual({ $ref: '#/components/schemas/AutomationTriggeredEvent' });
    expect(document.components.schemas.TwinEvent.anyOf).toContainEqual({ $ref: '#/components/schemas/RuleRecoveredEvent' });
    expect(document.components.schemas.TwinEvent.anyOf).toContainEqual({ $ref: '#/components/schemas/AlertCreatedEvent' });
    expect(document.components.schemas.TwinEvent.anyOf).toContainEqual({ $ref: '#/components/schemas/ScenarioControlEvent' });
    expect(document.components.schemas.TwinEvent.anyOf).toContainEqual({ $ref: '#/components/schemas/AlertStatusChangedEvent' });
    expect(document.components.schemas.TwinEvent.anyOf).toContainEqual({ $ref: '#/components/schemas/ObjectMovedEvent' });
    expect(document.components.schemas.TwinEvent.anyOf).toContainEqual({ $ref: '#/components/schemas/ExternalInteractionOccurredEvent' });
    expect(document.components.schemas.DeviceTelemetryEvent.required).toEqual(expect.arrayContaining(['type', 'sourceLayer', 'lineage', 'deviceId', 'measurements']));
    expect(document.components.schemas.DeviceTelemetryEvent.properties.sourceLayer.enum).toEqual(['sensor']);
    expect(document.components.schemas.DeviceTelemetryEvent.properties.lineage).toEqual({ $ref: '#/components/schemas/EventLineage' });
    expect(document.components.schemas.DeviceStateChangedEvent.required).toEqual(expect.arrayContaining(['type', 'sourceLayer', 'lineage', 'deviceId', 'state']));
    expect(document.components.schemas.DeviceStateChangedEvent.properties.sourceLayer.enum).toEqual(['world']);
    expect(document.components.schemas.EventLineage.required).toEqual(expect.arrayContaining(['eventTime', 'ingestTime', 'sourceLayer', 'causeEventIds', 'episodeId', 'observability', 'quality', 'schemaVersion', 'behaviorModelVersion']));
    expect(document.components.schemas.EventLineage.properties.quality.properties).toHaveProperty('delayedMs');
    expect(document.components.schemas.EventLineage.properties.quality.properties).toHaveProperty('dropped');
    expect(document.components.schemas.EventLineage.properties.quality.properties).toHaveProperty('duplicated');
    expect(document.components.schemas.EventLineage.properties.quality.properties).toHaveProperty('noisy');
    expect(document.components.schemas.EventExplanation.required).toEqual(expect.arrayContaining(['why', 'actorIds', 'affectedDeviceIds', 'affectedRoomIds', 'expectedOutcome']));
    expect(document.components.schemas.AutomationTriggeredEvent.properties.eventExplanation).toEqual({ $ref: '#/components/schemas/EventExplanation' });
    expect(document.components.schemas.AlertCreatedEvent.properties.eventExplanation).toEqual({ $ref: '#/components/schemas/EventExplanation' });
    expect(document.components.schemas.PersonMovedEvent.required).toEqual(expect.arrayContaining(['type', 'sourceLayer', 'lineage', 'personId', 'from', 'to', 'activity']));
    expect(document.components.schemas.PersonMovedEvent.properties.sourceLayer.enum).toEqual(['truth']);
    expect(document.components.schemas.ActivityStartedEvent.properties.sourceLayer.enum).toEqual(['truth']);
    expect(document.components.schemas.ActivityEndedEvent.properties.sourceLayer.enum).toEqual(['truth']);
    expect(document.components.schemas.ConversationOccurredEvent.required).toEqual(expect.arrayContaining(['conversationId', 'speakerId', 'listenerIds', 'topic', 'intent', 'summary']));
    expect(document.components.schemas.AutomationTriggeredEvent.properties.sourceLayer.enum).toEqual(['inference']);
    expect(document.components.schemas.RuleRecoveredEvent.required).toEqual(expect.arrayContaining(['ruleId', 'recoveredFacts', 'cooldownUntil']));
    expect(document.components.schemas.AlertCreatedEvent.required).toEqual(expect.arrayContaining(['alertId', 'severity', 'roomId', 'message', 'recommendedAction']));
    expect(document.components.schemas.ScenarioControlEvent.properties.sourceLayer.enum).toEqual(['control']);
    expect(document.components.schemas.ScenarioControlEvent.properties.command.enum).toEqual(['start', 'pause', 'resume', 'speed', 'inject']);
    expect(document.components.schemas.ObjectMovedEvent.required).toEqual(expect.arrayContaining(['type', 'objectId', 'from', 'to']));
    expect(document.components.schemas.ObjectMovedEvent.properties.carriedByPersonId).toEqual({ type: 'string' });
    expect(document.components.schemas.ExternalInteractionOccurredEvent.required).toEqual(expect.arrayContaining(['type', 'interactionId', 'actorKind', 'purpose', 'roomId', 'status']));
    expect(document.components.schemas.ExternalInteractionOccurredEvent.properties.actorKind.enum).toEqual(['courier', 'visitor', 'repair']);
    expect(document.components.schemas.AbnormalityInjectedEvent.required).toEqual(expect.arrayContaining(['type', 'kind', 'affectedEntities']));
    expect(document.components.schemas.AbnormalityInjectedEvent.properties.kind.enum).toEqual([
      'door_left_open',
      'fridge_left_open',
      'network_offline',
      'senior_no_activity'
    ]);
    expect(document.components.schemas.TwinEvent.anyOf).toContainEqual({ $ref: '#/components/schemas/AbnormalityInjectedEvent' });
    expect(document.paths['/api/alerts/{alertId}/status'].post.responses['404'].content['application/json'].schema)
      .toEqual({ $ref: '#/components/schemas/NotFoundError' });
    expect(document.paths['/api/alerts/{alertId}/status'].post.requestBody.content['application/json'].schema.properties.status.enum)
      .toContain('resolved');
    expect(document.paths['/api/devices/{deviceId}/command'].post.requestBody.content['application/json'].schema.required)
      .toContain('command');
    expect(document.paths['/api/telemetry'].get.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'privacy' })
    ]));
    expect(document.paths['/api/device-twins'].get.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'privacy' })
    ]));
    expect(document.paths['/ws'].get.responses['101'].description).toContain('TwinSocketUpdateMessage');
    expect(document.paths['/ws'].get.responses['101'].description).toContain('TwinSocketHeartbeatMessage');

    await server.close();
  });

  it('serves the model-driven default home definition', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-home-definition-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const response = await server.inject({ method: 'GET', url: '/api/home-definition' });
    const definition = response.json();

    expect(response.statusCode).toBe(200);
    expect(definition.building.id).toBe('default_home');
    expect(definition.floors[0].rooms.map((room: { id: string }) => room.id)).toContain('kitchen');
    expect(definition.floors[0].fixtures.devices.map((device: { id: string }) => device.id)).toContain('router_01');
    expect(definition.topology.connections.some((connection: { from: string; to: string }) => connection.from === 'living_room' && connection.to === 'study')).toBe(true);

    await server.close();
  });

  it('loads a configured home definition JSON into the API and simulator state', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-custom-home-definition-'));
    dirs.push(dir);
    const homeDefinition = getHomeDefinition();
    homeDefinition.building.id = 'custom_home';
    homeDefinition.building.name = 'Custom Loft';
    homeDefinition.floors[0].rooms = homeDefinition.floors[0].rooms.map((room) => (
      room.id === 'kitchen' ? { ...room, name: 'Chef Kitchen' } : room
    ));
    const homeDefinitionPath = path.join(dir, 'home-definition.json');
    writeFileSync(homeDefinitionPath, JSON.stringify(homeDefinition), 'utf8');
    const server = createServer({
      databasePath: path.join(dir, 'twin.db'),
      autoTick: false,
      homeDefinitionPath
    });

    const definitionResponse = await server.inject({ method: 'GET', url: '/api/home-definition' });
    const stateResponse = await server.inject({ method: 'GET', url: '/api/state' });

    expect(definitionResponse.statusCode).toBe(200);
    expect(definitionResponse.json().building).toMatchObject({
      id: 'custom_home',
      name: 'Custom Loft'
    });
    expect(stateResponse.json().homeId).toBe('custom_home');
    expect(stateResponse.json().rooms.kitchen.name).toBe('Chef Kitchen');

    await server.close();
  });

  it('exposes serializable device capability metadata for clients and adapters', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-device-capabilities-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const response = await server.inject({ method: 'GET', url: '/api/device-capabilities' });
    const capabilities = response.json();

    expect(response.statusCode).toBe(200);
    expect(Object.keys(capabilities).sort()).toEqual(Object.keys(deviceCapabilities).sort());
    expect(capabilities.router).toMatchObject({
      displayName: 'Router',
      shortLabel: 'Router',
      icon: 'router',
      markerKind: 'network',
      animationHint: 'pulse',
      riskLevel: 'confirmation',
      defaultState: { online: true, latencyMs: 18 },
      supportedCommands: ['restart'],
      commandMetadata: {
        restart: expect.objectContaining({
          label: 'Restart router',
          controlType: 'button',
          valueType: 'none',
          requiresConfirmation: true
        })
      },
      healthSignals: expect.arrayContaining([
        expect.objectContaining({ kind: 'connectivity', sourceField: 'online' })
      ]),
      telemetry: {
        online: { unit: 'bool' },
        latencyMs: { unit: 'ms' }
      },
      stateFields: {
        online: { type: 'boolean', required: false, defaultValue: true, unit: 'bool' },
        latencyMs: { type: 'number', required: false, defaultValue: 18, unit: 'ms' }
      }
    });
    expect(capabilities.router).not.toHaveProperty('isActive');
    expect(capabilities.router).not.toHaveProperty('stateSchema');

    await server.close();
  });

  it('projects devices into a bidirectional access model for adapters', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-device-access-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    await server.inject({
      method: 'POST',
      url: '/api/control/inject',
      payload: { kind: 'network_offline' }
    });
    const response = await server.inject({ method: 'GET', url: '/api/device-twins' });
    const records = response.json();
    const router = records.find((record: { deviceId: string }) => record.deviceId === 'router_01');
    const doorbell = records.find((record: { deviceId: string }) => record.deviceId === 'doorbell_camera_01');
    const gardenCamera = records.find((record: { deviceId: string }) => record.deviceId === 'garden_camera_01');

    expect(response.statusCode).toBe(200);
    expect(records.length).toBeGreaterThan(20);
    expect(router).toMatchObject({
      deviceId: 'router_01',
      displayName: 'Home Router',
      shortLabel: 'Router',
      instanceGroup: 'network_infrastructure',
      privacyLevel: 'household',
      riskLevel: 'confirmation',
      visualModel: 'router_antennas',
      visualScale: 0.95,
      pose: {
        x: 4.25,
        y: 0.28,
        z: -1.25,
        rotation: 0,
        mount: 'counter',
        visualVariant: null
      },
      protocol: 'simulated',
      connectivity: 'offline',
      reportedState: { online: false, latencyMs: 0 },
      desiredState: { online: true, latencyMs: 18 },
      stateFields: {
        online: { type: 'boolean', required: false, defaultValue: true, unit: 'bool' },
        latencyMs: { type: 'number', required: false, defaultValue: 18, unit: 'ms' }
      },
      supportedCommands: ['restart'],
      commandMetadata: {
        restart: expect.objectContaining({
          label: 'Restart router',
          requiresConfirmation: true
        })
      },
      healthStatus: expect.arrayContaining([
        expect.objectContaining({
          kind: 'connectivity',
          status: 'alert',
          sourceField: 'online'
        })
      ]),
      dataQuality: { source: 'simulator', confidence: 1 },
      lastCommand: {
        status: 'failed',
        reason: 'abnormality:network_offline',
        timeline: [
          expect.objectContaining({ status: 'requested' }),
          expect.objectContaining({ status: 'sent' }),
          expect.objectContaining({ status: 'failed', reason: 'abnormality:network_offline' })
        ]
      }
    });
    expect(typeof router.lastSeenAt).toBe('string');
    expect(doorbell).toMatchObject({ pose: { visualVariant: 'doorbell_slim' } });
    expect(gardenCamera).toMatchObject({ pose: { visualVariant: 'outdoor_bullet' } });

    await server.close();
  });

  it('applies device instance command overrides to adapter projections and command execution', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-device-instance-commands-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });

    const records = (await server.inject({ method: 'GET', url: '/api/device-twins' })).json();
    const doorbell = records.find((record: { deviceId: string }) => record.deviceId === 'doorbell_camera_01');

    expect(doorbell).toMatchObject({
      deviceId: 'doorbell_camera_01',
      supportedCommands: ['ring'],
      commandMetadata: {
        ring: expect.objectContaining({ label: 'Ring' })
      }
    });
    expect(doorbell.commandMetadata).not.toHaveProperty('record');

    const response = await server.inject({
      method: 'POST',
      url: '/api/devices/doorbell_camera_01/command',
      payload: { command: 'record' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('UNSUPPORTED_DEVICE_COMMAND');

    await server.close();
  });

  it('summarizes recent telemetry by device and metric', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-telemetry-summary-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 3 }
    });
    const response = await server.inject({ method: 'GET', url: '/api/telemetry/summary?limit=200' });
    const summary = response.json();
    const kitchenClimate = summary.devices.find((device: { deviceId: string }) => device.deviceId === 'kitchen_temp_01');

    expect(response.statusCode).toBe(200);
    expect(summary.runId).toBeDefined();
    expect(summary.window.eventLimit).toBe(200);
    expect(kitchenClimate.metrics.temperature_c.count).toBeGreaterThan(0);
    expect(kitchenClimate.metrics.temperature_c.avg).toBeTypeOf('number');
    expect(kitchenClimate.metrics.temperature_c.min).toBeLessThanOrEqual(kitchenClimate.metrics.temperature_c.max);

    await server.close();
  });

  it('accepts WebSocket clients and sends the current twin snapshot', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-ws-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });
    await server.ready();

    const ws = await server.injectWS('/ws');
    expect(ws.readyState).toBe(1);
    ws.close();

    await server.close();
  });

  it('replays missed events when a WebSocket client reconnects with the last sequence', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-ws-replay-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 12 }
    });
    const lastSeen = (await server.inject({ method: 'GET', url: '/api/state' })).json();

    await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 2 }
    });

    const firstMessage = createMessagePromise();
    const ws = await server.injectWS(`/ws?runId=${lastSeen.runId}&afterSequence=${lastSeen.simClock.sequence}`, {}, {
      onInit: firstMessage.attach
    });
    const update = await firstMessage.value;

    expect(update.snapshot.runId).toBe(lastSeen.runId);
    expect(update.events.length).toBeGreaterThan(0);
    expect(update.events.every((event: { runId: string; sequence: number }) => event.runId === lastSeen.runId && event.sequence > lastSeen.simClock.sequence)).toBe(true);

    ws.close();
    await server.close();
  });

  it('sends run_changed instead of mixing old replay events with the current run snapshot', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-ws-run-changed-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    const previousRun = (await server.inject({ method: 'GET', url: '/api/state' })).json() as { runId: string; simClock: { sequence: number } };
    await server.inject({
      method: 'POST',
      url: '/api/scenarios/away_day/start'
    });
    const currentRun = (await server.inject({ method: 'GET', url: '/api/state' })).json() as { runId: string; simClock: { sequence: number } };

    const firstMessage = createTypedMessagePromise('twin.run_changed');
    const ws = await server.injectWS(`/ws?runId=${previousRun.runId}&afterSequence=${previousRun.simClock.sequence}`, {}, {
      onInit: firstMessage.attach
    });
    const update = await firstMessage.value;

    expect(update).toMatchObject({
      type: 'twin.run_changed',
      previousRunId: previousRun.runId,
      runId: currentRun.runId,
      sequence: currentRun.simClock.sequence
    });
    expect(update).not.toHaveProperty('events');

    ws.close();
    await server.close();
  });

  it('marks WebSocket replay as incomplete when missed events exceed the replay window', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-ws-replay-window-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    const lastSeen = (await server.inject({ method: 'GET', url: '/api/state' })).json();
    const advance = await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 120 }
    });
    expect(advance.json().events.length).toBeGreaterThan(500);

    const firstMessage = createTypedMessagePromise('twin.update');
    const ws = await server.injectWS(`/ws?runId=${lastSeen.runId}&afterSequence=${lastSeen.simClock.sequence}`, {}, {
      onInit: firstMessage.attach
    });
    const update = await firstMessage.value;

    expect(update.replayComplete).toBe(false);
    expect((update.events as Array<unknown>)).toHaveLength(500);

    ws.close();
    await server.close();
  });

  it('sends WebSocket heartbeats with the current run cursor', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-ws-heartbeat-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false, heartbeatMs: 10 });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    const state = (await server.inject({ method: 'GET', url: '/api/state' })).json() as { runId: string; simClock: { sequence: number } };

    const heartbeat = createTypedMessagePromise('twin.heartbeat');
    const ws = await server.injectWS('/ws', {}, {
      onInit: heartbeat.attach
    });
    const message = await heartbeat.value;

    expect(message).toMatchObject({
      type: 'twin.heartbeat',
      runId: state.runId,
      sequence: state.simClock.sequence
    });

    ws.close();
    await server.close();
  });

  it('fails closed to public WebSocket projection when privacy query is invalid', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-ws-privacy-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 12 }
    });

    const firstMessage = createMessagePromise();
    const ws = await server.injectWS('/ws?privacy=owner', {}, {
      onInit: firstMessage.attach
    });
    const update = await firstMessage.value as unknown as { snapshot: { people: Record<string, unknown>; activities: Record<string, unknown>; rooms: Record<string, { people: string[] }> } };

    expect(update.snapshot.people).toEqual({});
    expect(update.snapshot.activities).toEqual({});
    expect(JSON.stringify(update.snapshot)).not.toContain('adult_1');
    expect(Object.values(update.snapshot.rooms).every((room) => room.people.length === 0)).toBe(true);

    ws.close();
    await server.close();
  });

  it('broadcasts event-only WebSocket updates between snapshot checkpoints', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-ws-incremental-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false, snapshotIntervalEvents: 1000 });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    const beforeAdvance = (await server.inject({ method: 'GET', url: '/api/state' })).json() as { runId: string; simClock: { sequence: number } };
    const nextUpdate = createNthTypedMessagePromise('twin.update', 2);
    const ws = await server.injectWS(`/ws?runId=${beforeAdvance.runId}&afterSequence=${beforeAdvance.simClock.sequence}`, {}, {
      onInit: nextUpdate.attach
    });

    await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 1 }
    });
    const update = await nextUpdate.value;

    expect(update.snapshot).toBeUndefined();
    expect(update.runId).toBe(beforeAdvance.runId);
    expect(Number(update.sequence)).toBeGreaterThan(beforeAdvance.simClock.sequence);
    expect((update.events as Array<{ sequence: number }>).length).toBeGreaterThan(0);

    ws.close();
    await server.close();
  });

  it('streams only device value changes on the device-events WebSocket', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-device-events-ws-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false, snapshotIntervalEvents: 1000 });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    const beforeAdvance = (await server.inject({ method: 'GET', url: '/api/state' })).json() as { runId: string; simClock: { sequence: number } };
    const nextUpdate = createNthTypedMessagePromise('device.update', 2);
    const ws = await server.injectWS(`/ws/device-events?runId=${beforeAdvance.runId}&afterSequence=${beforeAdvance.simClock.sequence}`, {}, {
      onInit: nextUpdate.attach
    });

    await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 12 }
    });
    const update = await nextUpdate.value as {
      type: string;
      runId: string;
      sequence: number;
      replayComplete: boolean;
      events: Array<Record<string, unknown>>;
    };

    expect(update).toMatchObject({
      type: 'device.update',
      runId: beforeAdvance.runId,
      replayComplete: true
    });
    expect(update.sequence).toBeGreaterThan(beforeAdvance.simClock.sequence);
    expect(update.events.length).toBeGreaterThan(0);
    expect(update.events.every((event) => (
      typeof event.deviceId === 'string' &&
      typeof event.deviceType === 'string' &&
      typeof event.roomId === 'string' &&
      typeof event.field === 'string' &&
      Object.hasOwn(event, 'value') &&
      (event.sourceEventType === 'DeviceTelemetry' || event.sourceEventType === 'DeviceStateChanged')
    ))).toBe(true);
    expect(JSON.stringify(update.events)).not.toContain('eventExplanation');
    expect(JSON.stringify(update.events)).not.toContain('reason');
    expect(JSON.stringify(update.events)).not.toContain('activity');
    expect(JSON.stringify(update.events)).not.toContain('scenarioId');
    expect(JSON.stringify(update.events)).not.toContain('PersonMoved');
    expect(JSON.stringify(update.events)).not.toContain('ScenarioControl');

    ws.close();
    await server.close();
  });

  it('advances device-events replay cursor over raw events with no device values', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-device-events-empty-replay-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false, snapshotIntervalEvents: 1000 });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    for (let index = 0; index < 501; index += 1) {
      await server.inject({
        method: 'POST',
        url: index % 2 === 0 ? '/api/control/pause' : '/api/control/resume'
      });
    }
    const currentState = (await server.inject({ method: 'GET', url: '/api/state' })).json() as { runId: string; simClock: { sequence: number } };
    const nextUpdate = createNthTypedMessagePromise('device.update', 1);
    const ws = await server.injectWS(`/ws/device-events?runId=${currentState.runId}&afterSequence=0`, {}, {
      onInit: nextUpdate.attach
    });
    const update = await nextUpdate.value as {
      type: string;
      runId: string;
      sequence: number;
      replayComplete: boolean;
      events: Array<Record<string, unknown>>;
    };

    expect(update).toMatchObject({
      type: 'device.update',
      runId: currentState.runId,
      replayComplete: false,
      events: []
    });
    expect(update.sequence).toBeGreaterThan(0);
    expect(update.sequence).toBeLessThan(currentState.simClock.sequence);

    ws.close();
    await server.close();
  });

  it('projects public state without exposing private household member details', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-privacy-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 12 }
    });

    const adminState = (await server.inject({ method: 'GET', url: '/api/state' })).json();
    const publicState = (await server.inject({ method: 'GET', url: '/api/state?privacy=public' })).json();

    expect(adminState.people.adult_1.activity).toBe('breakfast');
    expect(adminState.rooms.kitchen.people).toContain('adult_1');
    expect(publicState.homeState.occupancyCount).toBe(1);
    expect(publicState.people).toEqual({});
    expect(publicState.rooms.kitchen.people).toEqual([]);
    expect(publicState.activities).toEqual({});
    expect(JSON.stringify(publicState)).not.toContain('adult_1');
    expect(JSON.stringify(publicState)).not.toContain('breakfast');

    await server.close();
  });

  it('redacts sensitive device events and telemetry from public projections', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-public-device-privacy-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/control/inject',
      payload: { kind: 'door_left_open' }
    });
    await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 3 }
    });

    const publicEvents = (await server.inject({ method: 'GET', url: '/api/events?limit=100&privacy=public' })).json() as Array<{ deviceId?: string; deviceType?: string }>;
    const publicTelemetry = (await server.inject({ method: 'GET', url: '/api/telemetry?limit=100&privacy=public' })).json() as Array<{ deviceId?: string; deviceType?: string }>;

    expect(publicEvents.some((event) => event.deviceId === 'door_lock_01' || event.deviceId === 'doorbell_camera_01')).toBe(false);
    expect(publicTelemetry.some((event) => event.deviceId === 'bathroom_water_01')).toBe(false);

    await server.close();
  });

  it('projects ml-observation streams without truth activities, control injections, or explanations', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-ml-observation-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 12 }
    });
    await server.inject({
      method: 'POST',
      url: '/api/control/inject',
      payload: { kind: 'fridge_left_open' }
    });

    const observationState = (await server.inject({ method: 'GET', url: '/api/state?privacy=ml-observation' })).json();
    const observationEvents = (await server.inject({ method: 'GET', url: '/api/events?limit=100&privacy=ml-observation' })).json() as Array<{
      type: string;
      sourceLayer?: string;
      deviceId?: string;
      deviceType?: string;
      reason?: string;
      eventExplanation?: unknown;
    }>;
    const serialized = JSON.stringify({ observationState, observationEvents });

    expect(observationState.people).toEqual({});
    expect(observationState.activities).toEqual({});
    expect(observationState.alerts).toEqual({});
    expect(observationEvents.length).toBeGreaterThan(0);
    expect(observationEvents.every((event) => (
      event.type === 'DeviceTelemetry' && event.sourceLayer === 'sensor' ||
      event.type === 'DeviceStateChanged' && event.sourceLayer === 'world'
    ))).toBe(true);
    expect(observationEvents.some((event) => (
      event.type === 'DeviceStateChanged' &&
      event.sourceLayer === 'world' &&
      event.deviceId === 'fridge_01'
    ))).toBe(true);
    expect(observationEvents.some((event) => event.deviceId === 'doorbell_camera_01' || event.deviceId === 'garden_camera_01')).toBe(false);
    expect(observationEvents.some((event) => event.deviceType === 'doorbell_camera' || event.deviceType === 'security_camera')).toBe(false);
    expect(observationEvents.every((event) => event.reason === undefined)).toBe(true);
    expect(observationEvents.every((event) => event.eventExplanation === undefined)).toBe(true);
    expect(serialized).not.toContain('adult_1');
    expect(serialized).not.toContain('breakfast');
    expect(serialized).not.toContain('fridge_left_open');
    expect(serialized).not.toContain('AbnormalityInjected');

    await server.close();
  });

  it('filters sensitive device twins from public adapter projections', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-public-device-twins-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });
    try {
      await server.inject({
        method: 'POST',
        url: '/api/scenarios/weekday_normal/start'
      });

      const publicRecords = (await server.inject({ method: 'GET', url: '/api/device-twins?privacy=public' })).json() as Array<{
        deviceId: string;
        privacyLevel: string;
        riskLevel: string;
      }>;

      expect(publicRecords.some((record) => record.deviceId === 'router_01')).toBe(true);
      expect(publicRecords.some((record) => record.deviceId === 'doorbell_camera_01')).toBe(false);
      expect(publicRecords.some((record) => record.deviceId === 'master_sleep_01')).toBe(false);
      expect(publicRecords.some((record) => record.deviceId === 'water_valve_01')).toBe(false);
      expect(publicRecords.every((record) => record.privacyLevel !== 'private' && record.riskLevel !== 'high')).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('records access audit entries for privacy-sensitive read APIs', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-access-audit-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 12 }
    });
    const state = (await server.inject({ method: 'GET', url: '/api/state?privacy=public' })).json();
    await server.inject({ method: 'GET', url: '/api/events?limit=5&privacy=public' });

    const audit = await server.inject({ method: 'GET', url: '/api/audit/access?limit=10' });
    const records = audit.json();

    expect(audit.statusCode).toBe(200);
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'GET',
        endpoint: '/api/state',
        privacy: 'public',
        runId: state.runId,
        sequence: state.simClock.sequence
      }),
      expect.objectContaining({
        method: 'GET',
        endpoint: '/api/events',
        privacy: 'public',
        runId: state.runId
      })
    ]));
    expect(records.every((record: { ts: string }) => typeof record.ts === 'string')).toBe(true);

    await server.close();
  });

  it('pauses and resumes the simulation clock through control endpoints', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-control-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const pause = await server.inject({ method: 'POST', url: '/api/control/pause' });
    expect(pause.statusCode).toBe(200);
    expect(pause.json().snapshot.simClock.paused).toBe(true);

    const resume = await server.inject({ method: 'POST', url: '/api/control/resume' });
    expect(resume.statusCode).toBe(200);
    expect(resume.json().snapshot.simClock.paused).toBe(false);

    await server.close();
  });

  it('returns the first control result when an idempotency key is retried', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-idempotency-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    const first = await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 1, idempotencyKey: 'advance-once' }
    });
    const second = await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 1, idempotencyKey: 'advance-once' }
    });
    const current = (await server.inject({ method: 'GET', url: '/api/state' })).json();

    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(current.simClock.sequence).toBe(first.json().snapshot.simClock.sequence);

    await server.close();
  });

  it('rejects idempotency key reuse with a different control payload', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-idempotency-conflict-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 1, idempotencyKey: 'advance-conflict' }
    });
    const conflict = await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 2, idempotencyKey: 'advance-conflict' }
    });

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    await server.close();
  });

  it('starts a generated daily routine through date and seed controls', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-daily-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const start = await server.inject({
      method: 'POST',
      url: '/api/daily/start',
      payload: { date: '2026-07-18', seed: 42 }
    });

    expect(start.statusCode).toBe(200);
    expect(start.json().snapshot.scenarioId).toBe('daily_2026_07_18');
    expect(start.json().events[0].type).toBe('ScenarioControl');

    const advance = await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 600 }
    });
    const events = advance.json().events as Array<{ type: string; activity?: string }>;
    expect(events.some((event) => event.type === 'PersonMoved' && event.activity === 'weekend_cleaning')).toBe(true);
    expect(events.some((event) => event.type === 'PersonMoved' && event.activity === 'school')).toBe(false);

    await server.close();
  });

  it('rejects invalid API inputs with structured 400 responses', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-validation-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const invalidAdvance = await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 'later' }
    });
    expect(invalidAdvance.statusCode).toBe(400);
    expect(invalidAdvance.json().error).toMatchObject({ code: 'VALIDATION_FAILED' });

    const invalidDaily = await server.inject({
      method: 'POST',
      url: '/api/daily/start',
      payload: { date: '18-07-2026', seed: 'not-a-seed' }
    });
    expect(invalidDaily.statusCode).toBe(400);
    expect(invalidDaily.json().error).toMatchObject({ code: 'VALIDATION_FAILED' });

    const impossibleDaily = await server.inject({
      method: 'POST',
      url: '/api/daily/start',
      payload: { date: '2026-02-31' }
    });
    expect(impossibleDaily.statusCode).toBe(400);
    expect(impossibleDaily.json().error).toMatchObject({ code: 'VALIDATION_FAILED' });

    const invalidEvents = await server.inject({ method: 'GET', url: '/api/events?limit=forever' });
    expect(invalidEvents.statusCode).toBe(400);
    expect(invalidEvents.json().error.issues.length).toBeGreaterThan(0);

    const invalidInjection = await server.inject({
      method: 'POST',
      url: '/api/control/inject',
      payload: { kind: 'bad_sensor' }
    });
    expect(invalidInjection.statusCode).toBe(400);
    expect(invalidInjection.json().error).toMatchObject({ code: 'VALIDATION_FAILED' });

    const invalidResolve = await server.inject({
      method: 'POST',
      url: '/api/control/resolve',
      payload: { kind: 'bad_sensor' }
    });
    expect(invalidResolve.statusCode).toBe(400);
    expect(invalidResolve.json().error).toMatchObject({ code: 'VALIDATION_FAILED' });

    await server.close();
  });

  it('resolves abnormal device facts through the control API', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-resolve-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/control/inject',
      payload: { kind: 'fridge_left_open' }
    });
    const resolve = await server.inject({
      method: 'POST',
      url: '/api/control/resolve',
      payload: { kind: 'fridge_left_open' }
    });

    expect(resolve.statusCode).toBe(200);
    expect(resolve.json().snapshot.devices.fridge_01.state.doorOpen).toBe(false);
    expect(resolve.json().events.some((event: { type: string; ruleId?: string }) => event.type === 'RuleRecovered' && event.ruleId === 'fridge_left_open')).toBe(true);

    await server.close();
  });

  it('changes alert status through an auditable control event', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-alert-status-'));
    dirs.push(dir);
    const databasePath = path.join(dir, 'twin.db');
    const server = createServer({ databasePath, autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/control/inject',
      payload: { kind: 'fridge_left_open' }
    });
    const acknowledge = await server.inject({
      method: 'POST',
      url: '/api/alerts/fridge_left_open_001/status',
      payload: { status: 'acknowledged' }
    });

    expect(acknowledge.statusCode).toBe(200);
    expect(acknowledge.json().snapshot.alerts.fridge_left_open_001.status).toBe('acknowledged');
    expect(acknowledge.json().events).toEqual([
      expect.objectContaining({
        type: 'AlertStatusChanged',
        alertId: 'fridge_left_open_001',
        previousStatus: 'active',
        status: 'acknowledged'
      })
    ]);

    await server.close();

    const restartedServer = createServer({ databasePath, autoTick: false });
    const restored = await restartedServer.inject({ method: 'GET', url: '/api/state' });
    expect(restored.json().alerts.fridge_left_open_001.status).toBe('acknowledged');

    await restartedServer.close();
  });

  it('resolves alert status directly through the alert lifecycle endpoint', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-alert-resolved-status-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/control/inject',
      payload: { kind: 'fridge_left_open' }
    });

    const resolve = await server.inject({
      method: 'POST',
      url: '/api/alerts/fridge_left_open_001/status',
      payload: { status: 'resolved' }
    });

    expect(resolve.statusCode).toBe(200);
    expect(resolve.json().snapshot.alerts.fridge_left_open_001).toMatchObject({
      status: 'resolved',
      resolvedAt: expect.any(String)
    });
    expect(resolve.json().events[0]).toMatchObject({
      type: 'AlertStatusChanged',
      alertId: 'fridge_left_open_001',
      status: 'resolved'
    });

    await server.close();
  });

  it('executes supported simulated device commands through a command endpoint', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-device-command-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const response = await server.inject({
      method: 'POST',
      url: '/api/devices/living_light_01/command',
      payload: { command: 'set_brightness', value: 62 }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().snapshot.devices.living_light_01.state).toMatchObject({
      power: 'on',
      brightness: 62
    });
    expect(response.json().events[0]).toMatchObject({
      type: 'PersonMoved',
      personId: 'adult_1',
      to: 'living_room',
      activity: 'controlling_living_light_01',
      reason: 'operator:approach_device:living_light_01:set_brightness'
    });
    expect(response.json().snapshot.people.adult_1).toMatchObject({
      location: 'master_bedroom',
      activity: 'sleeping'
    });
    expect(response.json().events[1]).toMatchObject({
      type: 'DeviceStateChanged',
      deviceId: 'living_light_01',
      reason: 'operator:device_command:set_brightness'
    });
    expect(response.json().events[2]).toMatchObject({
      type: 'PersonMoved',
      personId: 'adult_1',
      from: 'living_room',
      to: 'master_bedroom',
      activity: 'sleeping',
      reason: 'operator:return_from_device:living_light_01:set_brightness'
    });

    await server.close();
  });

  it('executes enum and numeric commands from capability metadata', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-device-command-metadata-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const tvInput = await server.inject({
      method: 'POST',
      url: '/api/devices/tv_01/command',
      payload: { command: 'set_input', value: 'Game' }
    });
    const tvVolume = await server.inject({
      method: 'POST',
      url: '/api/devices/tv_01/command',
      payload: { command: 'set_volume', value: 42 }
    });
    const acMode = await server.inject({
      method: 'POST',
      url: '/api/devices/master_ac_01/command',
      payload: { command: 'set_mode', value: 'cool' }
    });
    const washerMode = await server.inject({
      method: 'POST',
      url: '/api/devices/washer_01/command',
      payload: { command: 'set_mode', value: 'delicate' }
    });

    expect(tvInput.statusCode).toBe(200);
    expect(tvInput.json().snapshot.devices.tv_01.state).toMatchObject({ power: 'on', app: 'Game' });
    expect(tvVolume.statusCode).toBe(200);
    expect(tvVolume.json().snapshot.devices.tv_01.state).toMatchObject({ power: 'on', volume: 42 });
    expect(acMode.statusCode).toBe(200);
    expect(acMode.json().snapshot.devices.master_ac_01.state).toMatchObject({ power: 'on', mode: 'cool' });
    expect(washerMode.statusCode).toBe(200);
    expect(washerMode.json().snapshot.devices.washer_01.state).toMatchObject({ mode: 'delicate' });

    await server.close();
  });

  it('rejects unsupported simulated device commands', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-device-command-invalid-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const response = await server.inject({
      method: 'POST',
      url: '/api/devices/study_co2_01/command',
      payload: { command: 'turn_on' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toBe('Unsupported device command');

    await server.close();
  });

  it('returns a structured not found error for unknown alert status changes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-alert-status-not-found-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const response = await server.inject({
      method: 'POST',
      url: '/api/alerts/missing_alert/status',
      payload: { status: 'acknowledged' }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Unknown alert'
    });

    await server.close();
  });

  it('restores the latest persisted run after a server restart', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-recovery-'));
    dirs.push(dir);
    const databasePath = path.join(dir, 'twin.db');
    const firstServer = createServer({ databasePath, autoTick: false });

    await firstServer.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    await firstServer.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 12 }
    });
    const beforeRestart = (await firstServer.inject({ method: 'GET', url: '/api/state' })).json();
    await firstServer.close();

    const secondServer = createServer({ databasePath, autoTick: false });
    await secondServer.ready();
    const restored = (await secondServer.inject({ method: 'GET', url: '/api/state' })).json();
    const advance = await secondServer.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 1 }
    });
    const resumedEvents = advance.json().events as Array<{ runId: string; sequence: number }>;

    expect(restored.runId).toBe(beforeRestart.runId);
    expect(restored.simClock.currentTime).toBe(beforeRestart.simClock.currentTime);
    expect(restored.simClock.sequence).toBe(beforeRestart.simClock.sequence);
    expect(resumedEvents.length).toBeGreaterThan(0);
    expect(resumedEvents.every((event) => event.runId === beforeRestart.runId)).toBe(true);
    expect(resumedEvents[0].sequence).toBeGreaterThan(beforeRestart.simClock.sequence);

    await secondServer.close();
  });

  it('does not restore a persisted snapshot whose household no longer matches the current home definition', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-stale-household-'));
    dirs.push(dir);
    const databasePath = path.join(dir, 'twin.db');
    const legacyHomeDefinition = getHomeDefinition();
    legacyHomeDefinition.people.push({
      id: 'senior_1',
      kind: 'human',
      role: 'senior family member',
      homeMember: true
    });
    const firstServer = createServer({ databasePath, autoTick: false, homeDefinition: legacyHomeDefinition });

    await firstServer.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    const beforeRestart = (await firstServer.inject({ method: 'GET', url: '/api/state' })).json();
    expect(Object.keys(beforeRestart.people)).toContain('senior_1');
    await firstServer.close();

    const secondServer = createServer({ databasePath, autoTick: false });
    await secondServer.ready();
    const restored = (await secondServer.inject({ method: 'GET', url: '/api/state' })).json();
    const restoredRooms = restored.rooms as Record<string, { people: string[] }>;

    expect(restored.runId).not.toBe(beforeRestart.runId);
    expect(Object.keys(restored.people)).not.toContain('senior_1');
    expect(Object.values(restoredRooms).flatMap((room) => room.people)).not.toContain('senior_1');

    await secondServer.close();
  });

  it('restores state by replaying events after the latest snapshot checkpoint', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-checkpoint-recovery-'));
    dirs.push(dir);
    const databasePath = path.join(dir, 'twin.db');
    const firstServer = createServer({ databasePath, autoTick: false, snapshotIntervalEvents: 1000 });

    await firstServer.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    await firstServer.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 1 }
    });
    const beforeRestart = (await firstServer.inject({ method: 'GET', url: '/api/state' })).json();
    await firstServer.close();

    const secondServer = createServer({ databasePath, autoTick: false, snapshotIntervalEvents: 1000 });
    await secondServer.ready();
    const restored = (await secondServer.inject({ method: 'GET', url: '/api/state' })).json();

    expect(restored.runId).toBe(beforeRestart.runId);
    expect(restored.simClock.currentTime).toBe(beforeRestart.simClock.currentTime);
    expect(restored.simClock.sequence).toBe(beforeRestart.simClock.sequence);
    expect(restored.devices.kitchen_temp_01.state.temperatureC).toBe(beforeRestart.devices.kitchen_temp_01.state.temperatureC);

    await secondServer.close();
  });
});

function createMessagePromise(): {
  value: Promise<{ snapshot: { runId: string }; events: Array<{ runId: string; sequence: number }> }>;
  attach: (ws: WebSocket) => void;
} {
  let resolveMessage: (message: { snapshot: { runId: string }; events: Array<{ runId: string; sequence: number }> }) => void = () => {};
  let rejectMessage: (error: Error) => void = () => {};
  let cleanup = (): void => {};
  const value = new Promise<{ snapshot: { runId: string }; events: Array<{ runId: string; sequence: number }> }>((resolve, reject) => {
    resolveMessage = resolve;
    rejectMessage = reject;
    const timer = setTimeout(() => reject(new Error('Timed out waiting for WebSocket message')), 2000);
    cleanup = () => clearTimeout(timer);
  });

  return {
    value,
    attach: (ws) => {
      ws.once('message', (data: { toString(): string }) => {
        cleanup();
        resolveMessage(JSON.parse(data.toString()) as { snapshot: { runId: string }; events: Array<{ runId: string; sequence: number }> });
      });
      ws.once('error', (error: Error) => {
        cleanup();
        rejectMessage(error);
      });
    }
  };
}

function createTypedMessagePromise(type: string): {
  value: Promise<Record<string, unknown>>;
  attach: (ws: WebSocket) => void;
} {
  let resolveMessage: (message: Record<string, unknown>) => void = () => {};
  let rejectMessage: (error: Error) => void = () => {};
  let cleanup = (): void => {};
  const value = new Promise<Record<string, unknown>>((resolve, reject) => {
    resolveMessage = resolve;
    rejectMessage = reject;
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for WebSocket ${type}`)), 2000);
    cleanup = () => clearTimeout(timer);
  });

  return {
    value,
    attach: (ws) => {
      ws.on('message', (data: { toString(): string }) => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (message.type === type) {
          cleanup();
          resolveMessage(message);
        }
      });
      ws.once('error', (error: Error) => {
        cleanup();
        rejectMessage(error);
      });
    }
  };
}

function createNthTypedMessagePromise(type: string, count: number): {
  value: Promise<Record<string, unknown>>;
  attach: (ws: WebSocket) => void;
} {
  let resolveMessage: (message: Record<string, unknown>) => void = () => {};
  let rejectMessage: (error: Error) => void = () => {};
  let cleanup = (): void => {};
  const value = new Promise<Record<string, unknown>>((resolve, reject) => {
    resolveMessage = resolve;
    rejectMessage = reject;
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for WebSocket ${type}`)), 2000);
    cleanup = () => clearTimeout(timer);
  });

  return {
    value,
    attach: (ws) => {
      let seen = 0;
      ws.on('message', (data: { toString(): string }) => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (message.type !== type) {
          return;
        }
        seen += 1;
        if (seen === count) {
          cleanup();
          resolveMessage(message);
        }
      });
      ws.once('error', (error: Error) => {
        cleanup();
        rejectMessage(error);
      });
    }
  };
}
