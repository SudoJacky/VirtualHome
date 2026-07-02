import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';
import { createHomeProfileHypotheses } from '../src/web/homeProfiler';
import {
  createEvidenceExplanationSummary,
  createHomeMemoryLlmTrace,
  createSemanticSignalRows
} from '../src/web/homeMemoryViewModel';

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

describe('home memory view model', () => {
  it('creates display rows for recent semantic signals', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'front_door_unlock',
        sequence: 1,
        simTime: '2026-06-22T18:00:00',
        roomId: 'entrance',
        deviceId: 'front_lock_01',
        deviceType: 'door_lock',
        field: 'lock',
        value: 'unlocked'
      }),
      deviceEvent({
        id: 'living_tv',
        sequence: 2,
        simTime: '2026-06-22T20:00:00',
        roomId: 'living',
        deviceId: 'tv_01',
        deviceType: 'tv',
        field: 'power',
        value: true
      })
    ]);

    expect(createSemanticSignalRows(memory, 3)).toEqual([
      expect.objectContaining({
        id: 'signal:living_tv:media_signal',
        typeLabel: 'media signal',
        location: 'living',
        source: 'tv_01.power',
        value: 'true',
        strength: 'strong',
        weight: '0.9'
      }),
      expect.objectContaining({
        id: 'signal:front_door_unlock:presence_signal',
        typeLabel: 'presence signal',
        location: 'entrance',
        source: 'front_lock_01.lock'
      }),
      expect.objectContaining({
        id: 'signal:front_door_unlock:access_signal',
        typeLabel: 'access signal',
        location: 'entrance',
        source: 'front_lock_01.lock'
      })
    ]);
  });

  it('summarizes supporting, contradicting, and missing evidence for a hypothesis', () => {
    const memory = reduceDeviceEvents(createHomeMemory(), [
      deviceEvent({
        id: 'stove_event',
        sequence: 1,
        simTime: '2026-06-22T18:10:00',
        roomId: 'kitchen',
        deviceId: 'stove_01',
        deviceType: 'stove',
        field: 'powerW',
        value: 1500
      }),
      deviceEvent({
        id: 'kitchen_motion',
        sequence: 2,
        simTime: '2026-06-22T18:12:00',
        roomId: 'kitchen',
        deviceId: 'kitchen_motion_01',
        deviceType: 'motion_sensor',
        field: 'motion',
        value: true
      })
    ]);
    const hypothesis = createHomeProfileHypotheses(memory).find((candidate) => candidate.id === 'activity:meal:kitchen');

    expect(hypothesis).toBeDefined();
    expect(createEvidenceExplanationSummary(hypothesis!)).toEqual({
      supportingCount: 2,
      contradictingCount: 0,
      missingCount: expect.any(Number),
      missingItems: expect.arrayContaining([
        'Repeated semantic signals across more days would make this behavior pattern more stable.'
      ])
    });
  });

  it('creates display rows for Home Memory LLM participation', () => {
    const trace = createHomeMemoryLlmTrace({
      hypothesis: {
        id: 'presence:recent-activity',
        label: 'Recent presence signal',
        llmEnrichmentSource: 'llm',
        llmEnrichment: {
          claim: 'Kitchen and living room evidence support recent activity.',
          missingEvidence: ['More days would improve confidence.'],
          contradictingEvidenceIds: [],
          alternatives: [{ claim: 'Could be automation', confidence: 0.2, evidenceIds: ['living_tv'] }]
        },
        llmReliabilityReviewSource: 'cache',
        llmReliabilityReview: {
          claim: 'Cached review says evidence is plausible but limited.',
          missingEvidence: ['No repeated day pattern yet.'],
          contradictingEvidenceIds: ['garage_device']
        }
      },
      portrait: {
        llmSummarySource: 'deterministic-fallback',
        llmSummary: {
          claim: 'Rule-based portrait summary.',
          missingEvidence: ['More weekly evidence is needed.'],
          contradictingEvidenceIds: []
        }
      },
      batchPlan: {
        items: [
          {
            purpose: 'semantic_candidate',
            targetId: 'semantic-window:kitchen:evening',
            shouldCall: true,
            reason: 'Eligible for batch enrichment.',
            cached: false
          },
          {
            purpose: 'reliability_review',
            targetId: 'presence:recent-activity',
            shouldCall: false,
            reason: 'Hypothesis confidence is outside review band.',
            cached: false
          }
        ]
      },
      metrics: {
        enabled: true,
        cacheSize: 1,
        rates: {
          cacheHitRate: 0.25,
          fallbackRate: 0.5,
          validationRejectionRate: 0.125,
          userTriggeredCallRatio: 0.75
        },
        budgets: {
          callsThisHour: 2,
          maxCallsPerHomePerHour: 10,
          callsToday: 4,
          maxCallsPerHomePerDay: 50
        }
      }
    });

    expect(trace).toMatchObject({
      enabled: true,
      metrics: [
        { label: 'Cache hit', value: '25%' },
        { label: 'Fallback', value: '50%' },
        { label: 'Validation rejected', value: '13%' },
        { label: 'Budget', value: '2/10 hour, 4/50 day' }
      ],
      rows: [
        {
          label: 'Hypothesis explanation',
          source: 'llm',
          claim: 'Kitchen and living room evidence support recent activity.',
          missingEvidence: ['More days would improve confidence.']
        },
        {
          label: 'Reliability review',
          source: 'cache',
          claim: 'Cached review says evidence is plausible but limited.',
          contradictingEvidenceIds: ['garage_device']
        },
        {
          label: 'Portrait summary',
          source: 'deterministic-fallback',
          claim: 'Rule-based portrait summary.'
        }
      ],
      batchItems: [
        {
          purpose: 'semantic_candidate',
          source: 'planned',
          reason: 'Eligible for batch enrichment.'
        },
        {
          purpose: 'reliability_review',
          source: 'skipped',
          reason: 'Hypothesis confidence is outside review band.'
        }
      ]
    });
  });
});
