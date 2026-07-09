import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { z } from 'zod';
import { getHomeDefinition } from '../sim/catalog';
import { createSimulator } from '../sim/engine';
import { getScenarioIds } from '../sim/scenarios';
import {
  applyHomeMemoryLlmConfigPatch,
  createHomeMemoryLlmCacheKey,
  requestHomeMemoryLlmEnrichmentStream,
  resolveHomeMemoryLlmConfig,
  summarizeHomeMemoryLlmConfig,
  type HomeMemoryLlmConfig,
  type HomeMemoryLlmEnrichment,
  type HomeMemoryLlmFetch,
  type HomeMemoryLlmPurpose,
  type HomeMemoryLlmTrigger
} from '../sim/llm/homeMemoryEnrichment';
import { getDeviceCapability, getDeviceCapabilityMetadata } from '../shared/deviceRegistry';
import { getDeviceSupportedCommands } from '../shared/deviceInstanceCapabilities';
import type { HomeDefinition, StaticScenarioId, TwinEvent, TwinSnapshot } from '../shared/types';
import { createHomeProfileHypotheses, type ProfileHypothesis } from '../web/homeProfiler';
import { AgentProfileDatabase, type AgentProfileCreateEntryInput, type AgentProfileSourceInput } from './agentProfileStore';
import { createDeviceAccessRecords } from './deviceAccess';
import { buildDeviceReplayPage, projectDeviceValueEvents } from './deviceEventStream';
import { DeviceEventDatabase, type DeviceEventAggregateGroupBy } from './deviceEventStore';
import { loadHomeDefinitionFromFile } from './homeDefinitionLoader';
import { HomeMemoryDatabase } from './homeMemoryStore';
import {
  buildHomeMemoryFromEvents,
  answerMemoryProfileQuestion,
  createHouseholdPortraitWithEnrichment,
  createMemorySummary,
  queryMemoryEntities,
  queryMemoryEpisodes,
  queryMemoryEvidence,
  queryMemoryProfileConclusions,
  queryMemoryHypothesesWithEnrichment,
  planMemoryQuery,
  queryUnknownSchemaMappings,
  querySemanticCandidates,
  createMemoryReliabilityReport,
  createHomeMemoryLlmBatchPlan,
  executeHomeMemoryLlmBatch,
  createHouseholdPortrait,
  type HomeMemoryLlmCacheStore,
  type HomeMemoryLlmUsageTracker
} from './memoryQuery';
import { buildOpenApiDocument } from './openapi';
import { TwinDatabase } from './persistence';
import { projectDeviceAccessRecordsForPrivacy, projectEventsForPrivacy, projectSnapshotForPrivacy, projectTelemetryForPrivacy, type PrivacyMode } from './privacy';
import { summarizeTelemetry } from './telemetrySummary';

export interface ServerOptions {
  databasePath: string;
  homeMemoryDatabasePath?: string;
  agentProfileDatabasePath?: string;
  deviceEventsDatabasePath?: string;
  autoTick?: boolean;
  tickMs?: number;
  heartbeatMs?: number;
  snapshotIntervalEvents?: number;
  telemetryRetentionEvents?: number;
  homeDefinition?: HomeDefinition;
  homeDefinitionPath?: string;
  homeMemoryLlm?: HomeMemoryLlmConfig;
  homeMemoryLlmFetch?: HomeMemoryLlmFetch;
}

const limitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  runId: z.string().min(1).optional(),
  privacy: z.enum(['admin', 'public', 'ml-observation']).default('admin')
});
const telemetrySummaryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  runId: z.string().min(1).optional()
});
const booleanQuerySchema = z.enum(['true', 'false']).transform((value) => value === 'true').optional();
const memoryRunQuerySchema = z.object({
  runId: z.string().min(1).optional()
});
const memoryPortraitQuerySchema = z.object({
  runId: z.string().min(1).optional(),
  includeLlmEnrichment: booleanQuerySchema,
  summaryPeriod: z.enum(['daily', 'weekly']).optional()
});
const memoryNaturalLanguageQuerySchema = z.object({
  runId: z.string().min(1).optional(),
  question: z.string().trim().min(1).max(500)
});
const memoryProfileAnswerQuerySchema = z.object({
  runId: z.string().min(1).optional(),
  question: z.string().trim().min(1).max(500),
  includeEvidence: booleanQuerySchema,
  includeReasoning: booleanQuerySchema,
  limit: z.coerce.number().int().min(1).max(20).optional()
});
const memorySchemaMappingQuerySchema = z.object({
  runId: z.string().min(1).optional(),
  includeLlmEnrichment: booleanQuerySchema,
  minEvidenceCount: z.coerce.number().int().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});
const memorySemanticCandidateQuerySchema = memorySchemaMappingQuerySchema;
const memoryLlmBatchPlanQuerySchema = z.object({
  runId: z.string().min(1).optional(),
  includePortraitSummary: booleanQuerySchema,
  summaryPeriod: z.enum(['daily', 'weekly']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});
const memoryLlmBatchBodySchema = z.object({
  runId: z.string().min(1).optional(),
  includePortraitSummary: z.boolean().optional(),
  summaryPeriod: z.enum(['daily', 'weekly']).optional(),
  limit: z.number().int().min(1).max(100).optional()
});
const memoryLlmConfigBodySchema = z.object({
  provider: z.object({
    enabled: z.boolean().optional(),
    baseUrl: z.string().trim().max(500).optional(),
    model: z.string().trim().min(1).max(120).optional(),
    apiKey: z.string().max(500).optional(),
    clearApiKey: z.boolean().optional(),
    timeoutMs: z.number().int().min(1000).max(120000).optional(),
    maxRetries: z.number().int().min(0).max(5).optional()
  }).optional(),
  budget: z.object({
    maxCallsPerHomePerHour: z.number().int().min(1).max(1000).optional(),
    maxCallsPerHomePerDay: z.number().int().min(1).max(10000).optional(),
    maxBatchSize: z.number().int().min(1).max(100).optional()
  }).optional(),
  gates: z.object({
    minEvidenceCountForUnknownSchema: z.number().int().min(1).max(100).optional(),
    minConfidenceForReview: z.number().min(0).max(1).optional(),
    maxConfidenceForReview: z.number().min(0).max(1).optional()
  }).optional()
}).refine((value) => {
  const min = value.gates?.minConfidenceForReview;
  const max = value.gates?.maxConfidenceForReview;
  return min === undefined || max === undefined || min <= max;
}, {
  path: ['gates', 'minConfidenceForReview'],
  message: 'minConfidenceForReview must be less than or equal to maxConfidenceForReview'
});
const memoryLlmStreamQuerySchema = z.object({
  runId: z.string().min(1).optional(),
  purpose: z.enum(['hypothesis_explanation', 'reliability_review']).default('hypothesis_explanation'),
  type: z.enum(['household_size', 'household_composition', 'daily_rhythm', 'room_habit', 'device_routine', 'presence_signal', 'activity_cluster', 'routine_window', 'behavior_flow', 'resident_slot', 'room_function', 'device_contribution', 'state_anomaly', 'automation_recommendation']).optional()
});
const homeMemoryMaterializeBodySchema = z.object({
  runId: z.string().min(1).optional()
});
const homeMemoryStoreQuerySchema = z.object({
  homeId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100)
});
const agentProfileSourceBodySchema = z.object({
  sourceType: z.enum(['home_memory_evidence', 'home_memory_hypothesis', 'home_memory_portrait_section', 'device_event_query', 'user_statement', 'agent_reasoning', 'manual_review']),
  sourceId: z.string().min(1),
  homeId: z.string().min(1),
  runId: z.string().min(1).nullable().optional(),
  sequence: z.number().int().nullable().optional(),
  quoteOrObservation: z.string().max(2000).optional(),
  weight: z.number().min(0).max(1).optional()
});
const agentProfileEntryBodySchema = z.object({
  id: z.string().min(1).optional(),
  homeId: z.string().min(1),
  subjectType: z.enum(['household', 'resident_slot', 'room', 'device', 'routine', 'preference', 'risk', 'unknown']),
  subjectId: z.string().min(1),
  entryType: z.enum(['conclusion', 'preference', 'hypothesis', 'note', 'task_memory', 'contradiction', 'question']),
  title: z.string().min(1).max(300),
  summary: z.string().min(1).max(2000),
  content: z.record(z.string(), z.unknown()),
  status: z.enum(['candidate', 'active', 'rejected', 'superseded', 'archived']).optional(),
  confidence: z.number().min(0).max(1),
  stability: z.enum(['volatile', 'working', 'stable']),
  createdBy: z.enum(['agent', 'user', 'system', 'human_reviewer']).default('agent'),
  index: z.object({
    claimType: z.enum(['routine', 'preference', 'risk', 'habit', 'identity', 'constraint', 'capability', 'uncertainty']),
    predicate: z.string().min(1),
    objectType: z.string().nullable().optional(),
    objectId: z.string().nullable().optional(),
    objectValue: z.unknown().optional()
  }).optional(),
  timeWindows: z.array(z.object({
    dayType: z.enum(['weekday', 'weekend', 'daily', 'specific_date', 'unknown']),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    timeStart: z.string().nullable().optional(),
    timeEnd: z.string().nullable().optional(),
    timezone: z.string().min(1),
    recurrence: z.enum(['daily', 'weekly', 'one_off', 'seasonal', 'unknown']),
    validFrom: z.string().nullable().optional(),
    validTo: z.string().nullable().optional()
  })).optional(),
  sources: z.array(agentProfileSourceBodySchema)
});
const agentProfileQueryBodySchema = z.object({
  homeId: z.string().min(1),
  structured: z.object({
    claimTypes: z.array(z.enum(['routine', 'preference', 'risk', 'habit', 'identity', 'constraint', 'capability', 'uncertainty'])).optional(),
    predicates: z.array(z.string().min(1)).optional(),
    subjectType: z.enum(['household', 'resident_slot', 'room', 'device', 'routine', 'preference', 'risk', 'unknown']).optional(),
    subjectId: z.string().min(1).optional(),
    dayType: z.enum(['weekday', 'weekend', 'daily', 'specific_date', 'unknown']).optional(),
    time: z.string().optional(),
    statuses: z.array(z.enum(['candidate', 'active', 'rejected', 'superseded', 'archived'])).optional()
  }).optional(),
  text: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  includeSources: z.boolean().optional()
});
const agentProfileStatusBodySchema = z.object({
  status: z.enum(['candidate', 'active', 'rejected', 'superseded', 'archived']),
  actor: z.enum(['agent', 'user', 'system', 'human_reviewer']).default('agent'),
  reason: z.string().min(1).max(1000)
});
const agentProfilePatchBodySchema = z.object({
  title: z.string().min(1).max(300).optional(),
  summary: z.string().min(1).max(2000).optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  index: z.object({
    claimType: z.enum(['routine', 'preference', 'risk', 'habit', 'identity', 'constraint', 'capability', 'uncertainty']),
    predicate: z.string().min(1),
    objectType: z.string().nullable().optional(),
    objectId: z.string().nullable().optional(),
    objectValue: z.unknown().optional()
  }).nullable().optional(),
  timeWindows: z.array(z.object({
    dayType: z.enum(['weekday', 'weekend', 'daily', 'specific_date', 'unknown']),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    timeStart: z.string().nullable().optional(),
    timeEnd: z.string().nullable().optional(),
    timezone: z.string().min(1),
    recurrence: z.enum(['daily', 'weekly', 'one_off', 'seasonal', 'unknown']),
    validFrom: z.string().nullable().optional(),
    validTo: z.string().nullable().optional()
  })).optional(),
  actor: z.enum(['agent', 'user', 'system', 'human_reviewer']).default('agent'),
  reason: z.string().min(1).max(1000)
});
const agentProfileAddSourceBodySchema = z.object({
  source: agentProfileSourceBodySchema,
  actor: z.enum(['agent', 'user', 'system', 'human_reviewer']).default('agent'),
  reason: z.string().min(1).max(1000)
});
const agentProfileSearchQuerySchema = z.object({
  homeId: z.string().min(1),
  q: z.string().trim().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  includeSources: booleanQuerySchema
});
const deviceEventListQuerySchema = z.object({
  homeId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  fromSequence: z.coerce.number().int().optional(),
  toSequence: z.coerce.number().int().optional(),
  fromSimTime: z.string().min(1).optional(),
  toSimTime: z.string().min(1).optional(),
  roomId: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
  deviceType: z.string().min(1).optional(),
  field: z.string().min(1).optional(),
  sourceEventType: z.enum(['DeviceTelemetry', 'DeviceStateChanged']).optional(),
  q: z.string().trim().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100)
});
const deviceEventSourceQuerySchema = z.object({
  homeId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100)
});
const deviceEventAroundQuerySchema = z.object({
  homeId: z.string().min(1),
  runId: z.string().min(1),
  sequence: z.coerce.number().int(),
  window: z.coerce.number().int().min(1).max(1000).default(25),
  limit: z.coerce.number().int().min(1).max(1000).default(200)
});
const deviceEventAroundSourceQuerySchema = z.object({
  sourceEventId: z.string().min(1),
  homeId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  windowMinutes: z.coerce.number().min(1).max(24 * 60).default(30),
  limit: z.coerce.number().int().min(1).max(1000).default(200)
});
const deviceEventAggregateQuerySchema = deviceEventListQuerySchema.extend({
  groupBy: z.enum(['roomId', 'deviceId', 'deviceType', 'field', 'sourceEventType'])
});
const memoryEntityQuerySchema = z.object({
  runId: z.string().min(1).optional(),
  kind: z.enum(['room', 'device', 'field']),
  roomId: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
  field: z.string().min(1).optional(),
  meaningfulOnly: booleanQuerySchema
});
const memoryEpisodeQuerySchema = z.object({
  runId: z.string().min(1).optional(),
  kind: z.enum(['occupancy', 'contact_activity', 'device_usage', 'appliance_usage']).optional(),
  status: z.enum(['open', 'closed']).optional(),
  roomId: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
  field: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});
const memoryEvidenceQuerySchema = z.object({
  runId: z.string().min(1).optional(),
  category: z.enum(['human_activity', 'device_usage', 'environment_context', 'system_status']).optional(),
  strength: z.enum(['strong', 'medium', 'weak', 'ignored']).optional(),
  roomId: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
  field: z.string().min(1).optional(),
  meaningfulOnly: booleanQuerySchema,
  limit: z.coerce.number().int().min(1).max(200).default(50)
});
const memoryHypothesisQuerySchema = z.object({
  runId: z.string().min(1).optional(),
  type: z.enum(['household_size', 'household_composition', 'daily_rhythm', 'room_habit', 'device_routine', 'presence_signal', 'activity_cluster', 'routine_window', 'behavior_flow', 'resident_slot', 'room_function', 'device_contribution', 'state_anomaly', 'automation_recommendation']).optional(),
  includeEvidence: booleanQuerySchema,
  includeLlmEnrichment: booleanQuerySchema,
  includeReliability: booleanQuerySchema
});
const memoryProfileConclusionQuerySchema = z.object({
  runId: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  source: z.enum(['claim', 'hypothesis']).optional(),
  topic: z.enum(['automation', 'device', 'household', 'pet', 'presence', 'resident', 'room', 'routine', 'uncertainty']).optional(),
  type: z.enum(['household_size', 'household_composition', 'daily_rhythm', 'room_habit', 'device_routine', 'presence_signal', 'activity_cluster', 'routine_window', 'behavior_flow', 'resident_slot', 'room_function', 'device_contribution', 'state_anomaly', 'automation_recommendation']).optional(),
  status: z.enum(['candidate', 'likely', 'strong', 'rejected']).optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  maxConfidence: z.coerce.number().min(0).max(1).optional(),
  includeEvidence: booleanQuerySchema,
  includeReasoning: booleanQuerySchema,
  limit: z.coerce.number().int().min(1).max(200).default(100)
}).refine((value) => (
  value.minConfidence === undefined ||
  value.maxConfidence === undefined ||
  value.minConfidence <= value.maxConfidence
), {
  path: ['minConfidence'],
  message: 'minConfidence must be less than or equal to maxConfidence'
});
const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100)
});
const privacyQuerySchema = z.object({
  privacy: z.enum(['admin', 'public', 'ml-observation']).default('admin')
});
const websocketQuerySchema = z.object({
  privacy: z.enum(['admin', 'public', 'ml-observation']).default('admin'),
  runId: z.string().min(1).optional(),
  afterSequence: z.coerce.number().int().min(0).optional()
});
const idempotencyPayloadSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(128).optional()
});
const advancePayloadSchema = idempotencyPayloadSchema.extend({
  minutes: z.coerce.number().int().min(1).max(1440).default(1)
});
const dailyStartPayloadSchema = idempotencyPayloadSchema.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidCalendarDate, { message: 'Invalid calendar date' }).optional(),
  seed: z.coerce.number().int().min(0).max(0xffffffff).optional()
});
const injectPayloadSchema = idempotencyPayloadSchema.extend({
  kind: z.enum(['door_left_open', 'fridge_left_open', 'network_offline', 'senior_no_activity'])
});
const resolvePayloadSchema = injectPayloadSchema;
const alertStatusPayloadSchema = idempotencyPayloadSchema.extend({
  status: z.enum(['active', 'acknowledged', 'resolved', 'ignored'])
});
const deviceCommandPayloadSchema = idempotencyPayloadSchema.extend({
  command: z.string().trim().min(1).max(80),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional()
});

type UpdateResponse = {
  snapshot: TwinSnapshot;
  events: TwinEvent[];
};

type HomeMemoryLlmResultEvent = {
  homeId: string;
  cacheKey: string;
  purpose: HomeMemoryLlmPurpose;
  trigger: HomeMemoryLlmTrigger;
  source: 'cache' | 'llm' | 'deterministic-fallback';
  errors: string[];
  at: number;
};

const websocketReplayLimit = 500;

export function createServer(options: ServerOptions): FastifyInstance {
  mkdirSync(path.dirname(options.databasePath), { recursive: true });
  const app = Fastify({ logger: false });
  const homeDefinition = options.homeDefinition ?? (options.homeDefinitionPath
    ? loadHomeDefinitionFromFile(options.homeDefinitionPath)
    : getHomeDefinition());
  let homeMemoryLlm = options.homeMemoryLlm ?? resolveHomeMemoryLlmConfig({});
  const homeMemoryLlmCache = new Map<string, HomeMemoryLlmEnrichment>();
  const homeMemoryLlmCalls: Array<{ homeId: string; cacheKey: string; at: number }> = [];
  const homeMemoryLlmResults: HomeMemoryLlmResultEvent[] = [];
  const homeMemoryLlmUsage: HomeMemoryLlmUsageTracker = {
    callsThisHour(homeId) {
      pruneHomeMemoryLlmCalls();
      const hourAgo = Date.now() - 60 * 60 * 1000;
      return homeMemoryLlmCalls.filter((entry) => entry.homeId === homeId && entry.at >= hourAgo).length;
    },
    callsToday(homeId) {
      pruneHomeMemoryLlmCalls();
      const today = new Date().toISOString().slice(0, 10);
      return homeMemoryLlmCalls.filter((entry) => (
        entry.homeId === homeId &&
        new Date(entry.at).toISOString().slice(0, 10) === today
      )).length;
    },
    recordCall(homeId, cacheKey) {
      homeMemoryLlmCalls.push({ homeId, cacheKey, at: Date.now() });
      pruneHomeMemoryLlmCalls();
    },
    recordResult(event) {
      homeMemoryLlmResults.push({ ...event, at: Date.now() });
      pruneHomeMemoryLlmResults();
    }
  };
  const simulator = createSimulator({ seed: 20260617, homeDefinition });
  const db = new TwinDatabase(options.databasePath, {
    snapshotIntervalEvents: options.snapshotIntervalEvents,
    telemetryRetentionEvents: options.telemetryRetentionEvents
  });
  const deviceEventDb = new DeviceEventDatabase(options.deviceEventsDatabasePath ?? path.join(path.dirname(options.databasePath), 'device-events.db'));
  const homeMemoryDb = new HomeMemoryDatabase(options.homeMemoryDatabasePath ?? path.join(path.dirname(options.databasePath), 'home-memory.db'));
  const agentProfileDb = new AgentProfileDatabase(options.agentProfileDatabasePath ?? path.join(path.dirname(options.databasePath), 'agent-profile.db'));
  const homeMemoryLlmCacheStore: HomeMemoryLlmCacheStore = {
    get(cacheKey) {
      const cached = homeMemoryLlmCache.get(cacheKey);
      if (cached) {
        return cached;
      }

      const persisted = db.getHomeMemoryLlmEnrichment(cacheKey);
      if (!persisted) {
        return undefined;
      }

      homeMemoryLlmCache.set(cacheKey, persisted);
      return persisted;
    },
    set(cacheKey, enrichment) {
      homeMemoryLlmCache.set(cacheKey, enrichment);
      db.recordHomeMemoryLlmEnrichment({
        cacheKey,
        purpose: enrichment.purpose,
        model: enrichment.metadata.model,
        enrichment
      });
    }
  };
  const latestSnapshot = db.getLatestSnapshot();
  const restorableSnapshot = latestSnapshot?.runId && snapshotMatchesHomeDefinition(latestSnapshot, homeDefinition)
    ? latestSnapshot
    : null;
  const restoredFromDatabase = Boolean(restorableSnapshot?.runId);
  if (restorableSnapshot?.runId) {
    simulator.restore(restorableSnapshot, db.getEventsForRun(restorableSnapshot.runId));
  }
  const sockets = new Set<{ privacy: PrivacyMode; send: (payload: string) => void }>();
  const deviceEventSockets = new Set<{ send: (payload: string) => void }>();
  const scenarioIds = getScenarioIds();
  let tickHandle: NodeJS.Timeout | undefined;
  let heartbeatHandle: NodeJS.Timeout | undefined;

  app.register(websocket);

  app.get('/api/openapi.json', async () => buildOpenApiDocument());

  function pruneHomeMemoryLlmCalls(): void {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    while (homeMemoryLlmCalls.length > 0 && homeMemoryLlmCalls[0].at < dayAgo) {
      homeMemoryLlmCalls.shift();
    }
  }

  function pruneHomeMemoryLlmResults(): void {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    while (homeMemoryLlmResults.length > 0 && homeMemoryLlmResults[0].at < dayAgo) {
      homeMemoryLlmResults.shift();
    }
  }

  function createHomeMemoryLlmMetrics(): Record<string, unknown> {
    pruneHomeMemoryLlmCalls();
    pruneHomeMemoryLlmResults();
    const snapshot = simulator.getSnapshot();
    const homeId = snapshot.homeId;
    const countResults = (predicate: (event: HomeMemoryLlmResultEvent) => boolean): number => (
      homeMemoryLlmResults.filter(predicate).length
    );
    const sourceCounts = {
      llm: countResults((event) => event.source === 'llm'),
      cache: countResults((event) => event.source === 'cache'),
      deterministicFallback: countResults((event) => event.source === 'deterministic-fallback')
    };
    const totalRequests = homeMemoryLlmResults.length;
    const callsByPurpose = groupCount(homeMemoryLlmResults.filter((event) => event.source === 'llm'), (event) => event.purpose);
    const requestsByPurpose = groupCount(homeMemoryLlmResults, (event) => event.purpose);
    const estimatedTokensByPurpose = Object.fromEntries(
      Object.entries(callsByPurpose).map(([purpose, count]) => [purpose, count * maxTokensForHomeMemoryPurpose(purpose as HomeMemoryLlmPurpose)])
    );
    const validationRejectionCount = countResults((event) => event.errors.some(isValidationRejectionError));
    const userTriggeredCount = countResults((event) => event.trigger === 'user_request');

    return {
      enabled: homeMemoryLlm.provider.enabled,
      provider: homeMemoryLlm.provider.provider,
      model: homeMemoryLlm.provider.model,
      cacheSize: homeMemoryLlmCache.size,
      unsupportedClaimRate: 0,
      totalRequests,
      sourceCounts,
      rates: {
        cacheHitRate: ratio(sourceCounts.cache, totalRequests),
        fallbackRate: ratio(sourceCounts.deterministicFallback, totalRequests),
        validationRejectionRate: ratio(validationRejectionCount, totalRequests),
        userTriggeredCallRatio: ratio(userTriggeredCount, totalRequests)
      },
      callsByPurpose,
      requestsByPurpose,
      estimatedTokensByPurpose,
      validationRejectionCount,
      budgets: {
        maxCallsPerHomePerHour: homeMemoryLlm.budget.maxCallsPerHomePerHour,
        maxCallsPerHomePerDay: homeMemoryLlm.budget.maxCallsPerHomePerDay,
        callsThisHour: homeMemoryLlmUsage.callsThisHour(homeId),
        callsToday: homeMemoryLlmUsage.callsToday(homeId)
      }
    };
  }

  function recordAndBroadcast(events: TwinEvent[]): TwinSnapshot {
    const snapshot = simulator.getSnapshot();
    const snapshotRecorded = db.recordUpdate(snapshot, events);
    const deviceValueEvents = projectDeviceValueEvents(events);
    for (const socket of sockets) {
      const payload = JSON.stringify({
        type: 'twin.update',
        runId: snapshot.runId,
        sequence: snapshot.simClock.sequence,
        ...(snapshotRecorded ? { snapshot: projectSnapshotForPrivacy(snapshot, socket.privacy) } : {}),
        replayComplete: true,
        events: projectEventsForPrivacy(events, socket.privacy)
      });
      socket.send(payload);
    }
    if (deviceValueEvents.length > 0) {
      const payload = JSON.stringify({
        type: 'device.update',
        runId: snapshot.runId,
        sequence: snapshot.simClock.sequence,
        replayComplete: true,
        events: deviceValueEvents
      });
      for (const socket of deviceEventSockets) {
        socket.send(payload);
      }
    }
    return snapshot;
  }

  function broadcastHeartbeat(): void {
    const snapshot = simulator.getSnapshot();
    const payload = JSON.stringify({
      type: 'twin.heartbeat',
      ts: new Date().toISOString(),
      runId: snapshot.runId,
      sequence: snapshot.simClock.sequence
    });
    for (const socket of sockets) {
      socket.send(payload);
    }
    const devicePayload = JSON.stringify({
      type: 'device.heartbeat',
      ts: new Date().toISOString(),
      runId: snapshot.runId,
      sequence: snapshot.simClock.sequence
    });
    for (const socket of deviceEventSockets) {
      socket.send(devicePayload);
    }
  }

  function recordAccess(
    endpoint: string,
    privacy: PrivacyMode,
    runId: string | null,
    sequence: number | null,
    details?: Record<string, unknown>
  ): void {
    db.recordAccessAudit({
      method: 'GET',
      endpoint,
      privacy,
      runId,
      sequence,
      details
    });
  }

  app.get('/api/scenarios', async () => scenarioIds.map((id) => ({ id })));

  app.get('/api/home-definition', async () => structuredClone(homeDefinition));

  app.get('/api/state', async (request, reply) => {
    const result = privacyQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const snapshot = simulator.getSnapshot();
    recordAccess('/api/state', result.data.privacy, snapshot.runId, snapshot.simClock.sequence);
    return projectSnapshotForPrivacy(snapshot, result.data.privacy);
  });

  app.get('/api/events', async (request, reply) => {
    const result = limitQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const snapshot = simulator.getSnapshot();
    const runId = result.data.runId ?? snapshot.runId;
    recordAccess('/api/events', result.data.privacy, runId, snapshot.simClock.sequence, { limit: result.data.limit });
    return projectEventsForPrivacy(db.getRecentEvents(result.data.limit, runId), result.data.privacy);
  });

  app.get('/api/telemetry', async (request, reply) => {
    const result = limitQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const snapshot = simulator.getSnapshot();
    const runId = result.data.runId ?? snapshot.runId;
    recordAccess('/api/telemetry', result.data.privacy, runId, snapshot.simClock.sequence, { limit: result.data.limit });
    return projectTelemetryForPrivacy(db.getRecentTelemetry(result.data.limit, runId), result.data.privacy);
  });

  app.get('/api/telemetry/summary', async (request, reply) => {
    const result = telemetrySummaryQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const snapshot = simulator.getSnapshot();
    const runId = result.data.runId ?? snapshot.runId;
    recordAccess('/api/telemetry/summary', 'admin', runId, snapshot.simClock.sequence, { limit: result.data.limit });
    return summarizeTelemetry(db.getRecentTelemetry(result.data.limit, runId), result.data.limit, runId);
  });

  app.get('/api/memory/summary', async (request, reply) => {
    const result = memoryRunQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const { memory, runId, snapshot } = getMemoryView(result.data.runId);
    recordAccess('/api/memory/summary', 'ml-observation', runId, snapshot.simClock.sequence);
    return createMemorySummary(memory);
  });

  app.get('/api/memory/entities', async (request, reply) => {
    const result = memoryEntityQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const { memory, runId, snapshot } = getMemoryView(result.data.runId);
    const { runId: _runId, ...query } = result.data;
    recordAccess('/api/memory/entities', 'ml-observation', runId, snapshot.simClock.sequence, query);
    return {
      runId,
      ...queryMemoryEntities(memory, query)
    };
  });

  app.get('/api/memory/episodes', async (request, reply) => {
    const result = memoryEpisodeQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const { memory, runId, snapshot } = getMemoryView(result.data.runId);
    const { runId: _runId, ...query } = result.data;
    recordAccess('/api/memory/episodes', 'ml-observation', runId, snapshot.simClock.sequence, query);
    return {
      runId,
      items: queryMemoryEpisodes(memory, query)
    };
  });

  app.get('/api/memory/evidence', async (request, reply) => {
    const result = memoryEvidenceQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const { memory, runId, snapshot } = getMemoryView(result.data.runId);
    const { runId: _runId, ...query } = result.data;
    recordAccess('/api/memory/evidence', 'ml-observation', runId, snapshot.simClock.sequence, query);
    return {
      runId,
      items: queryMemoryEvidence(memory, query)
    };
  });

  app.get('/api/memory/profile/hypotheses', async (request, reply) => {
    const result = memoryHypothesisQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const { memory, runId, snapshot } = getMemoryView(result.data.runId);
    const { runId: _runId, ...query } = result.data;
    recordAccess('/api/memory/profile/hypotheses', 'ml-observation', runId, snapshot.simClock.sequence, query);
    return {
      runId,
      items: await queryMemoryHypothesesWithEnrichment(memory, query, {
        llmConfig: homeMemoryLlm,
        fetcher: options.homeMemoryLlmFetch,
        llmCache: homeMemoryLlmCacheStore,
        llmUsage: homeMemoryLlmUsage
      })
    };
  });

  app.get('/api/memory/profile/conclusions', async (request, reply) => {
    const result = memoryProfileConclusionQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const { memory, runId, snapshot } = getMemoryView(result.data.runId);
    const { runId: _runId, ...query } = result.data;
    recordAccess('/api/memory/profile/conclusions', 'ml-observation', runId, snapshot.simClock.sequence, query);
    return {
      runId,
      items: queryMemoryProfileConclusions(memory, query)
    };
  });

  app.get('/api/memory/profile/answer', async (request, reply) => {
    const result = memoryProfileAnswerQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const { memory, runId, snapshot } = getMemoryView(result.data.runId);
    const { runId: _runId, ...query } = result.data;
    recordAccess('/api/memory/profile/answer', 'ml-observation', runId, snapshot.simClock.sequence, query);
    return {
      runId,
      ...answerMemoryProfileQuestion(memory, query)
    };
  });

  app.get('/api/memory/portrait', async (request, reply) => {
    const result = memoryPortraitQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const { memory, runId, snapshot } = getMemoryView(result.data.runId);
    const { runId: _runId, ...query } = result.data;
    recordAccess('/api/memory/portrait', 'ml-observation', runId, snapshot.simClock.sequence, query);
    return createHouseholdPortraitWithEnrichment(memory, query, {
      llmConfig: homeMemoryLlm,
      fetcher: options.homeMemoryLlmFetch,
      llmCache: homeMemoryLlmCacheStore,
      llmUsage: homeMemoryLlmUsage
    });
  });

  app.get('/api/memory/query-plan', async (request, reply) => {
    const result = memoryNaturalLanguageQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const { memory, runId, snapshot } = getMemoryView(result.data.runId);
    const { runId: _runId, ...query } = result.data;
    recordAccess('/api/memory/query-plan', 'ml-observation', runId, snapshot.simClock.sequence, query);
    return planMemoryQuery(memory, query, {
      llmConfig: homeMemoryLlm,
      fetcher: options.homeMemoryLlmFetch,
      llmCache: homeMemoryLlmCacheStore,
      llmUsage: homeMemoryLlmUsage
    });
  });

  app.get('/api/memory/schema-mappings', async (request, reply) => {
    const result = memorySchemaMappingQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const { memory, runId, snapshot } = getMemoryView(result.data.runId);
    const { runId: _runId, ...query } = result.data;
    recordAccess('/api/memory/schema-mappings', 'ml-observation', runId, snapshot.simClock.sequence, query);
    return queryUnknownSchemaMappings(memory, query, {
      llmConfig: homeMemoryLlm,
      fetcher: options.homeMemoryLlmFetch,
      llmCache: homeMemoryLlmCacheStore,
      llmUsage: homeMemoryLlmUsage
    });
  });

  app.get('/api/memory/semantic-candidates', async (request, reply) => {
    const result = memorySemanticCandidateQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const { memory, runId, snapshot } = getMemoryView(result.data.runId);
    const { runId: _runId, ...query } = result.data;
    recordAccess('/api/memory/semantic-candidates', 'ml-observation', runId, snapshot.simClock.sequence, query);
    return querySemanticCandidates(memory, query, {
      llmConfig: homeMemoryLlm,
      fetcher: options.homeMemoryLlmFetch,
      llmCache: homeMemoryLlmCacheStore,
      llmUsage: homeMemoryLlmUsage
    });
  });

  app.get('/api/memory/reliability', async (request, reply) => {
    const result = memoryRunQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const { memory, runId, snapshot } = getMemoryView(result.data.runId);
    recordAccess('/api/memory/reliability', 'ml-observation', runId, snapshot.simClock.sequence);
    return createMemoryReliabilityReport(memory);
  });

  app.get('/api/memory/llm/batch-plan', async (request, reply) => {
    const result = memoryLlmBatchPlanQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const { memory, runId, snapshot } = getMemoryView(result.data.runId);
    const { runId: _runId, ...query } = result.data;
    recordAccess('/api/memory/llm/batch-plan', 'ml-observation', runId, snapshot.simClock.sequence, query);
    return createHomeMemoryLlmBatchPlan(memory, query, {
      llmConfig: homeMemoryLlm,
      fetcher: options.homeMemoryLlmFetch,
      llmCache: homeMemoryLlmCacheStore,
      llmUsage: homeMemoryLlmUsage
    });
  });

  app.post('/api/memory/llm/batch', async (request, reply) => {
    const result = memoryLlmBatchBodySchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const { memory, runId, snapshot } = getMemoryView(result.data.runId);
    const { runId: _runId, ...query } = result.data;
    recordAccess('/api/memory/llm/batch', 'ml-observation', runId, snapshot.simClock.sequence, query);
    return executeHomeMemoryLlmBatch(memory, query, {
      llmConfig: homeMemoryLlm,
      fetcher: options.homeMemoryLlmFetch,
      llmCache: homeMemoryLlmCacheStore,
      llmUsage: homeMemoryLlmUsage
    });
  });

  app.post('/api/home-memory/materializations', async (request, reply) => {
    const result = homeMemoryMaterializeBodySchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    try {
      const record = materializeHomeMemory(result.data.runId);
      return record;
    } catch (error) {
      return sendOperationError(reply, 'HOME_MEMORY_MATERIALIZE_FAILED', error);
    }
  });

  app.get('/api/home-memory/materializations', async (request, reply) => {
    const result = homeMemoryStoreQuerySchema.pick({ homeId: true }).safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return { items: homeMemoryDb.listRuns(result.data.homeId) };
  });

  app.get('/api/home-memory/evidence', async (request, reply) => {
    const result = homeMemoryStoreQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const { runId, snapshot } = getMemoryView(result.data.runId);
    const homeId = result.data.homeId ?? snapshot.homeId;
    return {
      runId,
      ...homeMemoryDb.listEvidence({ homeId, runId, limit: result.data.limit })
    };
  });

  app.get('/api/home-memory/profile/hypotheses', async (request, reply) => {
    const result = homeMemoryStoreQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const { runId, snapshot } = getMemoryView(result.data.runId);
    const homeId = result.data.homeId ?? snapshot.homeId;
    return {
      runId,
      ...homeMemoryDb.listProfileHypotheses({ homeId, runId, limit: result.data.limit })
    };
  });

  app.delete('/api/home-memory/materializations/:runId', async (request) => {
    const params = request.params as { runId: string };
    const snapshot = simulator.getSnapshot();
    return { deleted: homeMemoryDb.clearRun(snapshot.homeId, params.runId) };
  });

  app.get('/api/device-events', async (request, reply) => {
    const result = deviceEventListQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return deviceEventDb.listEvents(result.data);
  });

  app.get('/api/device-events/around', async (request, reply) => {
    const result = deviceEventAroundQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const window = result.data.window;
    return deviceEventDb.listEvents({
      homeId: result.data.homeId,
      runId: result.data.runId,
      fromSequence: result.data.sequence - window,
      toSequence: result.data.sequence + window,
      limit: result.data.limit
    });
  });

  app.get('/api/device-events/around-source', async (request, reply) => {
    const result = deviceEventAroundSourceQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return deviceEventDb.getEventsAroundSource(result.data);
  });

  app.get('/api/device-events/aggregate', async (request, reply) => {
    const result = deviceEventAggregateQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return deviceEventDb.aggregateEvents({
      ...result.data,
      groupBy: result.data.groupBy as DeviceEventAggregateGroupBy
    });
  });

  app.get('/api/device-events/source/:sourceEventId', async (request, reply) => {
    const params = request.params as { sourceEventId: string };
    const result = deviceEventSourceQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return deviceEventDb.getEventsBySourceEventId(params.sourceEventId, result.data);
  });

  app.get('/api/device-events/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const event = deviceEventDb.getEvent(params.id);
    if (!event) {
      return reply.status(404).send({ error: 'Device event not found' });
    }
    return event;
  });

  app.get('/api/device-event-queries/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const query = deviceEventDb.getQuery(params.id);
    if (!query) {
      return reply.status(404).send({ error: 'Device event query not found' });
    }
    return query;
  });

  app.post('/api/agent-profile/entries', async (request, reply) => {
    const result = agentProfileEntryBodySchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const body = result.data as AgentProfileCreateEntryInput;
    const invalidSource = findInvalidProfileSource(body.sources);
    if (invalidSource) {
      console.warn('[agent-profile] create_rejected_missing_source', JSON.stringify(invalidSource));
      return reply.status(400).send({
        error: {
          code: 'MISSING_HOME_MEMORY_SOURCE',
          message: 'Referenced Home Memory source does not exist',
          source: invalidSource
        }
      });
    }
    try {
      return agentProfileDb.createEntry(body);
    } catch (error) {
      return sendOperationError(reply, 'AGENT_PROFILE_CREATE_FAILED', error);
    }
  });

  app.get('/api/agent-profile/entries/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const entry = agentProfileDb.getEntry(params.id, { includeSources: true });
    if (!entry) {
      return sendNotFound(reply, 'Unknown agent profile entry');
    }
    return entry;
  });

  app.patch('/api/agent-profile/entries/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const result = agentProfilePatchBodySchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    try {
      return agentProfileDb.updateEntry(params.id, result.data);
    } catch (error) {
      return sendOperationError(reply, 'AGENT_PROFILE_UPDATE_FAILED', error);
    }
  });

  app.get('/api/agent-profile/entries', async (request, reply) => {
    const result = z.object({
      homeId: z.string().min(1).optional(),
      status: z.enum(['candidate', 'active', 'rejected', 'superseded', 'archived']).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100)
    }).safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return agentProfileDb.listEntries(result.data);
  });

  app.post('/api/agent-profile/query', async (request, reply) => {
    const result = agentProfileQueryBodySchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return agentProfileDb.queryEntries(result.data);
  });

  app.get('/api/agent-profile/search', async (request, reply) => {
    const result = agentProfileSearchQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return agentProfileDb.queryEntries({
      homeId: result.data.homeId,
      text: result.data.q,
      limit: result.data.limit,
      includeSources: result.data.includeSources
    });
  });

  app.post('/api/agent-profile/entries/:id/sources', async (request, reply) => {
    const params = request.params as { id: string };
    const result = agentProfileAddSourceBodySchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const invalidSource = findInvalidProfileSource([result.data.source as AgentProfileSourceInput]);
    if (invalidSource) {
      console.warn('[agent-profile] source_add_rejected_missing_source', JSON.stringify(invalidSource));
      return reply.status(400).send({
        error: {
          code: 'MISSING_HOME_MEMORY_SOURCE',
          message: 'Referenced Home Memory source does not exist',
          source: invalidSource
        }
      });
    }
    try {
      return agentProfileDb.addSource(params.id, result.data.source as AgentProfileSourceInput, {
        actor: result.data.actor,
        reason: result.data.reason
      });
    } catch (error) {
      return sendOperationError(reply, 'AGENT_PROFILE_SOURCE_ADD_FAILED', error);
    }
  });

  app.post('/api/agent-profile/entries/:id/status', async (request, reply) => {
    const params = request.params as { id: string };
    const result = agentProfileStatusBodySchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    try {
      return agentProfileDb.updateEntryStatus(params.id, result.data);
    } catch (error) {
      return sendOperationError(reply, 'AGENT_PROFILE_STATUS_FAILED', error);
    }
  });

  app.delete('/api/agent-profile/entries/:id', async (request) => {
    const params = request.params as { id: string };
    return { deleted: agentProfileDb.deleteEntry(params.id) };
  });

  app.get('/api/memory/llm/config', async () => {
    logHomeMemoryLlm('debug', 'config_get', {
      enabled: homeMemoryLlm.provider.enabled,
      host: providerHost(homeMemoryLlm.provider.baseUrl),
      model: homeMemoryLlm.provider.model,
      apiKeyConfigured: Boolean(homeMemoryLlm.provider.apiKey)
    });
    return summarizeHomeMemoryLlmConfig(homeMemoryLlm);
  });

  app.put('/api/memory/llm/config', async (request, reply) => {
    const result = memoryLlmConfigBodySchema.safeParse(request.body ?? {});
    if (!result.success) {
      logHomeMemoryLlm('warn', 'config_update_rejected', { issues: result.error.issues.map((issue) => issue.message) });
      return sendValidationError(reply, result.error);
    }
    homeMemoryLlm = applyHomeMemoryLlmConfigPatch(homeMemoryLlm, result.data);
    logHomeMemoryLlm('info', 'config_update', {
      enabled: homeMemoryLlm.provider.enabled,
      host: providerHost(homeMemoryLlm.provider.baseUrl),
      model: homeMemoryLlm.provider.model,
      timeoutMs: homeMemoryLlm.provider.timeoutMs,
      maxRetries: homeMemoryLlm.provider.maxRetries,
      apiKeyConfigured: Boolean(homeMemoryLlm.provider.apiKey),
      maxCallsPerHomePerHour: homeMemoryLlm.budget.maxCallsPerHomePerHour,
      maxCallsPerHomePerDay: homeMemoryLlm.budget.maxCallsPerHomePerDay,
      maxBatchSize: homeMemoryLlm.budget.maxBatchSize
    });
    return summarizeHomeMemoryLlmConfig(homeMemoryLlm);
  });

  app.get('/api/memory/llm/stream', async (request, reply) => {
    const result = memoryLlmStreamQuerySchema.safeParse(request.query);
    if (!result.success) {
      logHomeMemoryLlm('warn', 'stream_request_rejected', { issues: result.error.issues.map((issue) => issue.message) });
      return sendValidationError(reply, result.error);
    }

    const stream = new PassThrough();
    reply.header('content-type', 'text/event-stream; charset=utf-8');
    reply.header('cache-control', 'no-cache');
    reply.header('connection', 'keep-alive');

    void streamMemoryLlmResult(stream, result.data);
    return reply.send(stream);
  });

  app.get('/api/memory/llm/metrics', async () => createHomeMemoryLlmMetrics());

  async function streamMemoryLlmResult(
    stream: PassThrough,
    query: z.infer<typeof memoryLlmStreamQuerySchema>
  ): Promise<void> {
    try {
      const { memory, runId, snapshot } = getMemoryView(query.runId);
      recordAccess('/api/memory/llm/stream', 'ml-observation', runId, snapshot.simClock.sequence, {
        purpose: query.purpose,
        type: query.type
      });
      const hypothesis = createHomeProfileHypotheses(memory)
        .filter((candidate) => !query.type || candidate.type === query.type)
        .sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id))[0];

      if (!hypothesis) {
        logHomeMemoryLlm('warn', 'stream_no_hypothesis', { purpose: query.purpose, type: query.type ?? 'any' });
        writeSse(stream, 'error', { message: 'No matching hypothesis is available for LLM streaming.' });
        return;
      }

      const homeId = memory.homeId ?? '';
      const evidenceIds = hypothesis.evidence.map((evidence) => evidence.id);
      const cacheKey = createHomeMemoryLlmCacheKey({
        purpose: query.purpose,
        homeId,
        runId: memory.runId ?? '',
        hypothesisId: hypothesis.id,
        evidenceIds,
        model: homeMemoryLlm.provider.model,
        promptVersion: 1,
        schemaVersion: 1
      });
      writeSse(stream, 'start', {
        purpose: query.purpose,
        hypothesisId: hypothesis.id,
        model: homeMemoryLlm.provider.model,
        evidenceCount: evidenceIds.length
      });
      logHomeMemoryLlm('debug', 'stream_start', {
        purpose: query.purpose,
        hypothesisId: hypothesis.id,
        evidenceCount: evidenceIds.length,
        enabled: homeMemoryLlm.provider.enabled,
        host: providerHost(homeMemoryLlm.provider.baseUrl),
        model: homeMemoryLlm.provider.model,
        budgetHour: `${homeMemoryLlmUsage.callsThisHour(homeId)}/${homeMemoryLlm.budget.maxCallsPerHomePerHour}`,
        budgetDay: `${homeMemoryLlmUsage.callsToday(homeId)}/${homeMemoryLlm.budget.maxCallsPerHomePerDay}`
      });

      const llmResult = await requestHomeMemoryLlmEnrichmentStream({
        config: homeMemoryLlm,
        purpose: query.purpose,
        trigger: 'user_request',
        prompt: createStreamingHypothesisPrompt(query.purpose, hypothesis),
        memory,
        hypothesis,
        fetcher: options.homeMemoryLlmFetch,
        cached: homeMemoryLlmCacheStore.get(cacheKey),
        callsThisHour: homeMemoryLlmUsage.callsThisHour(homeId),
        callsToday: homeMemoryLlmUsage.callsToday(homeId),
        onEvent: (event) => {
          logHomeMemoryLlm(event.event === 'fallback' ? 'info' : 'debug', event.event, event.data);
          writeSse(stream, event.event, event.data);
        }
      });

      if (llmResult.source === 'llm') {
        homeMemoryLlmCacheStore.set(llmResult.cacheKey, llmResult.enrichment);
        homeMemoryLlmUsage.recordCall(homeId, llmResult.cacheKey);
      }
      homeMemoryLlmUsage.recordResult?.({
        homeId,
        cacheKey: llmResult.cacheKey,
        purpose: query.purpose,
        trigger: 'user_request',
        source: llmResult.source,
        errors: llmResult.errors
      });

      writeSse(stream, 'result', {
        source: llmResult.source,
        cacheKey: llmResult.cacheKey,
        enrichment: llmResult.enrichment,
        errors: llmResult.errors
      });
      logHomeMemoryLlm('info', 'result', {
        purpose: query.purpose,
        source: llmResult.source,
        errorCount: llmResult.errors.length,
        claimLength: llmResult.enrichment.claim.length
      });
    } catch (error) {
      logHomeMemoryLlm('warn', 'stream_error', { error: errorMessage(error) });
      writeSse(stream, 'error', { message: error instanceof Error ? error.message : String(error) });
    } finally {
      stream.end();
    }
  }

  app.get('/api/device-twins', async (request, reply) => {
    const result = privacyQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const snapshot = simulator.getSnapshot();
    recordAccess('/api/device-twins', result.data.privacy, snapshot.runId, snapshot.simClock.sequence);
    return projectDeviceAccessRecordsForPrivacy(
      createDeviceAccessRecords(snapshot, db.getRecentEvents(500, snapshot.runId)),
      result.data.privacy
    );
  });

  app.get('/api/device-capabilities', async () => getDeviceCapabilityMetadata());

  app.get('/api/audit/access', async (request, reply) => {
    const result = auditQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return db.getRecentAccessAudit(result.data.limit);
  });

  function getMemoryView(queryRunId?: string): { memory: ReturnType<typeof buildHomeMemoryFromEvents>; runId: string; snapshot: TwinSnapshot } {
    const snapshot = simulator.getSnapshot();
    const runId = queryRunId ?? snapshot.runId;
    return {
      memory: buildHomeMemoryFromEvents(db.getEventsForRun(runId)),
      runId,
      snapshot
    };
  }

  function materializeHomeMemory(queryRunId?: string): ReturnType<HomeMemoryDatabase['materializeMemory']> {
    const { memory, runId, snapshot } = getMemoryView(queryRunId);
    const hypotheses = createHomeProfileHypotheses(memory);
    return homeMemoryDb.materializeMemory({
      memory,
      hypotheses,
      portrait: createHouseholdPortrait(memory),
      coveredSequence: runId === snapshot.runId ? snapshot.simClock.sequence : maxEventSequence(db.getEventsForRun(runId)),
      reducerVersion: 'server-memory-query',
      schemaVersion: 1
    });
  }

  function findInvalidProfileSource(sources: AgentProfileSourceInput[]): AgentProfileSourceInput | null {
    for (const source of sources) {
      if (source.sourceType === 'device_event_query') {
        if (!deviceEventDb.hasQuery(source.sourceId, source.homeId, source.runId)) {
          console.warn('[agent-profile] source_validation_failed', JSON.stringify({
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            homeId: source.homeId,
            runId: source.runId ?? null
          }));
          return source;
        }
        continue;
      }
      if (!source.sourceType.startsWith('home_memory_')) {
        continue;
      }
      if (!homeMemoryDb.hasSource(source.sourceType, source.sourceId, source.homeId, source.runId)) {
        console.warn('[agent-profile] source_validation_failed', JSON.stringify({
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          homeId: source.homeId,
          runId: source.runId ?? null
        }));
        return source;
      }
    }
    return null;
  }

  app.post('/api/scenarios/:id/start', async (request, reply) => {
    const params = request.params as { id: StaticScenarioId };
    const result = idempotencyPayloadSchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    if (!scenarioIds.includes(params.id)) {
      return reply.status(404).send({ error: 'Unknown scenario' });
    }
    return runIdempotentCommand(reply, result.data.idempotencyKey, `POST /api/scenarios/${params.id}/start`, stripIdempotencyKey(result.data), () => {
      const events = simulator.startScenario(params.id);
      const snapshot = recordAndBroadcast(events);
      return { snapshot, events };
    });
  });

  app.post('/api/daily/start', async (request, reply) => {
    const result = dailyStartPayloadSchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return runIdempotentCommand(reply, result.data.idempotencyKey, 'POST /api/daily/start', stripIdempotencyKey(result.data), () => {
      const date = result.data.date ?? todayInShanghai();
      const events = simulator.startDailyScenario({ date, seed: result.data.seed });
      const snapshot = recordAndBroadcast(events);
      return { snapshot, events };
    });
  });

  app.post('/api/control/advance', async (request, reply) => {
    const result = advancePayloadSchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return runIdempotentCommand(reply, result.data.idempotencyKey, 'POST /api/control/advance', stripIdempotencyKey(result.data), () => {
      const events = simulator.advanceMinutes(result.data.minutes);
      const snapshot = recordAndBroadcast(events);
      return { snapshot, events };
    });
  });

  app.post('/api/control/pause', async (request, reply) => {
    const result = idempotencyPayloadSchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return runIdempotentCommand(reply, result.data.idempotencyKey, 'POST /api/control/pause', stripIdempotencyKey(result.data), () => {
      const events = simulator.setPaused(true);
      const snapshot = recordAndBroadcast(events);
      return { snapshot, events };
    });
  });

  app.post('/api/control/resume', async (request, reply) => {
    const result = idempotencyPayloadSchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return runIdempotentCommand(reply, result.data.idempotencyKey, 'POST /api/control/resume', stripIdempotencyKey(result.data), () => {
      const events = simulator.setPaused(false);
      const snapshot = recordAndBroadcast(events);
      return { snapshot, events };
    });
  });

  app.post('/api/control/inject', async (request, reply) => {
    const result = injectPayloadSchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return runIdempotentCommand(reply, result.data.idempotencyKey, 'POST /api/control/inject', stripIdempotencyKey(result.data), () => {
      const events = simulator.injectAbnormality(result.data.kind);
      const snapshot = recordAndBroadcast(events);
      return { snapshot, events };
    });
  });

  app.post('/api/control/resolve', async (request, reply) => {
    const result = resolvePayloadSchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return runIdempotentCommand(reply, result.data.idempotencyKey, 'POST /api/control/resolve', stripIdempotencyKey(result.data), () => {
      const events = simulator.resolveAbnormality(result.data.kind);
      const snapshot = recordAndBroadcast(events);
      return { snapshot, events };
    });
  });

  app.post('/api/devices/:deviceId/command', async (request, reply) => {
    const params = request.params as { deviceId: string };
    const result = deviceCommandPayloadSchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const device = simulator.getSnapshot().devices[params.deviceId];
    if (!device) {
      return sendNotFound(reply, 'Unknown device');
    }
    if (!getDeviceSupportedCommands(params.deviceId, device.type).includes(result.data.command)) {
      return reply.status(400).send({
        error: {
          code: 'UNSUPPORTED_DEVICE_COMMAND',
          message: 'Unsupported device command'
        }
      });
    }
    return runIdempotentCommand(reply, result.data.idempotencyKey, `POST /api/devices/${params.deviceId}/command`, stripIdempotencyKey(result.data), () => {
      const events = simulator.commandDevice(params.deviceId, result.data.command, result.data.value ?? null);
      if (!events) throw new Error('Device command failed after validation');
      const snapshot = recordAndBroadcast(events);
      return { snapshot, events };
    });
  });

  app.post('/api/alerts/:alertId/status', async (request, reply) => {
    const params = request.params as { alertId: string };
    const result = alertStatusPayloadSchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    if (!simulator.getSnapshot().alerts[params.alertId]) {
      return sendNotFound(reply, 'Unknown alert');
    }
    return runIdempotentCommand(reply, result.data.idempotencyKey, `POST /api/alerts/${params.alertId}/status`, stripIdempotencyKey(result.data), () => {
      const events = simulator.setAlertStatus(params.alertId, result.data.status);
      const snapshot = recordAndBroadcast(events ?? []);
      return { snapshot, events: events ?? [] };
    });
  });

  app.register(async (fastify) => {
    fastify.get('/ws', { websocket: true }, (socket, request) => {
      const result = websocketQuerySchema.safeParse(request.query);
      const privacy = result.success ? result.data.privacy : 'public';
      const client = { privacy, send: (payload: string) => socket.send(payload) };
      sockets.add(client);
      const snapshot = simulator.getSnapshot();
      recordAccess('/ws', privacy, snapshot.runId, snapshot.simClock.sequence, result.success
        ? { afterSequence: result.data.afterSequence ?? null }
        : { validation: 'failed' });
      if (result.success && result.data.runId && result.data.runId !== snapshot.runId) {
        socket.send(JSON.stringify({
          type: 'twin.run_changed',
          previousRunId: result.data.runId,
          runId: snapshot.runId,
          sequence: snapshot.simClock.sequence,
          snapshot: projectSnapshotForPrivacy(snapshot, privacy)
        }));
        socket.on('close', () => sockets.delete(client));
        return;
      }
      const replayCandidates = result.success && result.data.runId && result.data.afterSequence !== undefined
        ? db.getEventsAfter(result.data.runId, result.data.afterSequence, websocketReplayLimit + 1)
        : [];
      const replayComplete = replayCandidates.length <= websocketReplayLimit;
      const replayEvents = replayCandidates.slice(0, websocketReplayLimit);
      socket.send(JSON.stringify({
        type: 'twin.update',
        runId: snapshot.runId,
        sequence: snapshot.simClock.sequence,
        snapshot: projectSnapshotForPrivacy(snapshot, privacy),
        replayComplete,
        events: projectEventsForPrivacy(replayEvents, privacy)
      }));
      socket.on('close', () => sockets.delete(client));
    });

    fastify.get('/ws/device-events', { websocket: true }, (socket, request) => {
      const result = websocketQuerySchema.safeParse(request.query);
      const client = { send: (payload: string) => socket.send(payload) };
      deviceEventSockets.add(client);
      const snapshot = simulator.getSnapshot();
      recordAccess('/ws/device-events', 'ml-observation', snapshot.runId, snapshot.simClock.sequence, result.success
        ? { afterSequence: result.data.afterSequence ?? null }
        : { validation: 'failed' });
      if (result.success && result.data.runId && result.data.runId !== snapshot.runId) {
        socket.send(JSON.stringify({
          type: 'device.run_changed',
          previousRunId: result.data.runId,
          runId: snapshot.runId,
          sequence: snapshot.simClock.sequence
        }));
        socket.on('close', () => deviceEventSockets.delete(client));
        return;
      }
      const replayPage = result.success && result.data.runId && result.data.afterSequence !== undefined
        ? buildDeviceReplayPage({
          runId: result.data.runId,
          afterSequence: result.data.afterSequence,
          currentSequence: snapshot.simClock.sequence,
          replayLimit: websocketReplayLimit,
          getEventsAfter: (runId, sequence, limit) => db.getEventsAfter(runId, sequence, limit)
        })
        : { sequence: snapshot.simClock.sequence, replayComplete: true, events: [] };
      socket.send(JSON.stringify({
        type: 'device.update',
        runId: snapshot.runId,
        sequence: replayPage.sequence,
        replayComplete: replayPage.replayComplete,
        events: replayPage.events
      }));
      socket.on('close', () => deviceEventSockets.delete(client));
    });
  });

  app.addHook('onReady', async () => {
    if (!restoredFromDatabase) {
      recordAndBroadcast(simulator.startDailyScenario({ date: todayInShanghai(), seed: 20260617 }));
    }
    if (options.autoTick !== false) {
      tickHandle = setInterval(() => {
        const events = simulator.advanceMinutes(1);
        if (events.length > 0) {
          recordAndBroadcast(events);
        }
      }, options.tickMs ?? 1000);
    }
    const heartbeatMs = options.heartbeatMs ?? 15000;
    if (heartbeatMs > 0) {
      heartbeatHandle = setInterval(() => broadcastHeartbeat(), heartbeatMs);
    }
  });

  app.addHook('onClose', async () => {
    if (tickHandle) {
      clearInterval(tickHandle);
    }
    if (heartbeatHandle) {
      clearInterval(heartbeatHandle);
    }
    deviceEventSockets.clear();
    db.close();
    deviceEventDb.close();
    homeMemoryDb.close();
    agentProfileDb.close();
  });

  return app;

  function runIdempotentCommand(
    reply: FastifyReply,
    idempotencyKey: string | undefined,
    scope: string,
    payload: unknown,
    action: () => UpdateResponse
  ): UpdateResponse | FastifyReply {
    if (!idempotencyKey) {
      return action();
    }
    const requestHash = hashRequest(scope, payload);
    const cached = db.getIdempotencyRecord<UpdateResponse>(idempotencyKey);
    if (cached) {
      if (cached.requestHash !== requestHash) {
        return sendIdempotencyConflict(reply);
      }
      return cached.response;
    }
    const response = action();
    db.recordIdempotencyResponse(idempotencyKey, requestHash, response);
    return response;
  }
}

function todayInShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function snapshotMatchesHomeDefinition(snapshot: TwinSnapshot, homeDefinition: HomeDefinition): boolean {
  if (snapshot.homeId !== homeDefinition.building.id) {
    return false;
  }

  const definitionRoomIds = homeDefinition.floors.flatMap((floor) => floor.rooms.map((room) => room.id));
  const definitionDeviceIds = homeDefinition.floors.flatMap((floor) => floor.fixtures.devices.map((device) => device.id));
  const definitionPersonIds = homeDefinition.people.map((person) => person.id);

  return sameStringSet(Object.keys(snapshot.rooms), definitionRoomIds) &&
    sameStringSet(Object.keys(snapshot.devices), definitionDeviceIds) &&
    sameStringSet(Object.keys(snapshot.people), definitionPersonIds);
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function isValidCalendarDate(date: string): boolean {
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

function sendValidationError(reply: FastifyReply, error: z.ZodError): FastifyReply {
  return reply.status(400).send({
    error: {
      code: 'VALIDATION_FAILED',
      message: 'Invalid request input',
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    }
  });
}

function sendIdempotencyConflict(reply: FastifyReply): FastifyReply {
  return reply.status(409).send({
    error: {
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'Idempotency key was already used with a different request'
    }
  });
}

function sendNotFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.status(404).send({
    error: {
      code: 'NOT_FOUND',
      message
    }
  });
}

function sendOperationError(reply: FastifyReply, code: string, error: unknown): FastifyReply {
  return reply.status(400).send({
    error: {
      code,
      message: error instanceof Error ? error.message : String(error)
    }
  });
}

function stripIdempotencyKey<T extends { idempotencyKey?: string }>(payload: T): Omit<T, 'idempotencyKey'> {
  const { idempotencyKey: _idempotencyKey, ...rest } = payload;
  return rest;
}

function groupCount(events: HomeMemoryLlmResultEvent[], keyOf: (event: HomeMemoryLlmResultEvent) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    const key = keyOf(event);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : 0;
}

function isValidationRejectionError(error: string): boolean {
  return /evidence|schema|json|confidence|claim|cached enrichment/i.test(error) && !/budget|disabled|baseUrl/i.test(error);
}

function maxTokensForHomeMemoryPurpose(purpose: HomeMemoryLlmPurpose): number {
  const tokens: Record<HomeMemoryLlmPurpose, number> = {
    unknown_schema_mapping: 600,
    semantic_candidate: 700,
    hypothesis_explanation: 800,
    reliability_review: 900,
    query_planning: 900,
    daily_portrait_summary: 1200
  };
  return tokens[purpose];
}

function writeSse(stream: PassThrough, event: string, data: Record<string, unknown>): void {
  stream.write(`event: ${event}\n`);
  stream.write(`data: ${JSON.stringify(data)}\n\n`);
}

function logHomeMemoryLlm(level: 'debug' | 'info' | 'warn', event: string, data: Record<string, unknown>): void {
  const configuredLevel = (process.env.HOME_MEMORY_LLM_LOG_LEVEL ?? 'debug').toLowerCase();
  if (configuredLevel === 'silent') {
    return;
  }
  if (level === 'debug' && configuredLevel !== 'debug') {
    return;
  }
  const payload = JSON.stringify(data);
  if (level === 'warn') {
    console.warn(`[home-memory-llm] ${event} ${payload}`);
    return;
  }
  console.info(`[home-memory-llm] ${event} ${payload}`);
}

function providerHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl ? 'invalid-url' : 'missing-base-url';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createStreamingHypothesisPrompt(purpose: HomeMemoryLlmPurpose, hypothesis: ProfileHypothesis): string {
  if (purpose === 'reliability_review') {
    return JSON.stringify({
      purpose,
      hypothesisId: hypothesis.id,
      type: hypothesis.type,
      confidence: hypothesis.confidence,
      summary: hypothesis.summary,
      evidenceIds: hypothesis.evidence.map((evidence) => evidence.id),
      supportingEvidenceIds: hypothesis.supportingEvidence.map((evidence) => evidence.id),
      contradictingEvidenceIds: hypothesis.contradictingEvidence.map((evidence) => evidence.id),
      missingEvidence: hypothesis.missingEvidence
    });
  }

  return JSON.stringify({
    purpose,
    hypothesisId: hypothesis.id,
    type: hypothesis.type,
    confidence: hypothesis.confidence,
    evidenceIds: hypothesis.evidence.map((evidence) => evidence.id)
  });
}

function hashRequest(scope: string, payload: unknown): string {
  return createHash('sha256')
    .update(stableJson({ scope, payload }))
    .digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function maxEventSequence(events: TwinEvent[]): number {
  return events.reduce((max, event) => Math.max(max, event.sequence), 0);
}
