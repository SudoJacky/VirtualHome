import type { TwinEvent } from '../shared/types';
import {
  collectUnknownSchemaCandidates,
  createDeterministicHomeMemoryLlmEnrichment,
  createHomeMemoryLlmCacheKey,
  decideHomeMemoryLlmInvocation,
  requestUnknownSchemaMapping,
  requestHomeMemoryLlmEnrichment,
  resolveHomeMemoryLlmConfig,
  type HomeMemoryLlmEnrichment,
  type HomeMemoryLlmConfig,
  type HomeMemoryLlmFetch,
  type HomeMemoryLlmPurpose,
  type RequestHomeMemoryLlmEnrichmentResult,
  type HomeMemoryLlmTrigger,
  type UnknownSchemaCandidate
} from '../sim/llm/homeMemoryEnrichment';
import { createHomeMemory, reduceDeviceEvents, type ActivityEpisode, type HomeMemory, type MemoryEpisode, type MemoryEvidence } from '../web/homeMemoryModel';
import { extractHomeProfileClaims, type HomeProfileClaim } from '../web/homeProfileClaims';
import { createHomeProfileHypotheses, createProfileHypothesis, type ClaimEvidence, type ProfileClaimStatus, type ProfileHypothesis, type ProfileHypothesisType, type ReasoningStep } from '../web/homeProfiler';
import { createHomeMemoryGraphModel } from '../web/homeMemoryGraphModel';
import { projectDeviceValueEvents } from './deviceEventStream';

export type MemoryEntityKind = 'room' | 'device' | 'field';

export interface MemorySummary {
  homeId: string | null;
  runId: string | null;
  totalEvents: number;
  profileEventCount: number;
  profileEvidenceWeight: number;
  activeRooms: string[];
  activeDevices: string[];
  activeEpisodes: Array<Pick<MemoryEpisode, 'id' | 'kind' | 'roomId' | 'deviceId' | 'field' | 'status' | 'updatedSimTime'>>;
  activityEpisodes: Array<Pick<ActivityEpisode, 'id' | 'kind' | 'roomIds' | 'deviceIds' | 'updatedSimTime' | 'evidenceIds' | 'summary'>>;
  topPatterns: Array<Pick<ProfileHypothesis, 'id' | 'type' | 'label' | 'summary' | 'confidence' | 'updatedAt' | 'subjectIds'> & { evidenceCount: number }>;
  recentHighlights: MemoryEvidence[];
  updatedAt: string | null;
}

export interface MemoryEntityQuery {
  kind: MemoryEntityKind;
  roomId?: string;
  deviceId?: string;
  field?: string;
  meaningfulOnly?: boolean;
}

export interface MemoryEpisodeQuery {
  kind?: MemoryEpisode['kind'];
  status?: MemoryEpisode['status'];
  roomId?: string;
  deviceId?: string;
  field?: string;
  limit?: number;
}

export interface MemoryEvidenceQuery {
  category?: MemoryEvidence['evidenceCategory'];
  strength?: MemoryEvidence['evidenceStrength'];
  roomId?: string;
  deviceId?: string;
  field?: string;
  meaningfulOnly?: boolean;
  limit?: number;
}

export interface MemoryHypothesisQuery {
  type?: ProfileHypothesisType;
  includeEvidence?: boolean;
  includeLlmEnrichment?: boolean;
  includeReliability?: boolean;
}

export type MemoryProfileConclusionSource = 'claim' | 'hypothesis';
export type MemoryProfileConclusionTopic =
  | 'automation'
  | 'device'
  | 'household'
  | 'pet'
  | 'presence'
  | 'resident'
  | 'room'
  | 'routine'
  | 'uncertainty';

export interface MemoryProfileConclusionQuery {
  id?: string;
  source?: MemoryProfileConclusionSource;
  topic?: MemoryProfileConclusionTopic;
  type?: ProfileHypothesisType;
  status?: ProfileClaimStatus;
  minConfidence?: number;
  maxConfidence?: number;
  includeEvidence?: boolean;
  includeReasoning?: boolean;
  limit?: number;
}

export interface MemoryProfileConclusion {
  id: string;
  source: MemoryProfileConclusionSource;
  topic: MemoryProfileConclusionTopic;
  type: ProfileHypothesisType;
  label: string;
  conclusion: string;
  status: ProfileClaimStatus;
  confidence: number;
  updatedAt: string;
  subjectIds: string[];
  evidenceCount: number;
  supports: ClaimEvidence[];
  contradictions: ClaimEvidence[];
  missingEvidence: string[];
  alternativeExplanations: string[];
  evidence?: MemoryEvidence[];
  reasoningSteps?: ReasoningStep[];
}

export interface MemoryProfileAnswerQuery {
  question: string;
  includeEvidence?: boolean;
  includeReasoning?: boolean;
  limit?: number;
}

export interface MemoryProfileAnswer {
  question: string;
  matchedQuery: MemoryProfileConclusionQuery & {
    matchStrategy: 'deterministic_keyword' | 'fallback';
    matchedTerms: string[];
  };
  answer: string;
  status: ProfileClaimStatus;
  confidence: number;
  sourceConclusionIds: string[];
  evidenceIds: string[];
  missingEvidence: string[];
  alternatives: string[];
  conclusions: MemoryProfileConclusion[];
}

export interface MemoryHypothesisQueryOptions {
  llmConfig?: HomeMemoryLlmConfig;
  fetcher?: HomeMemoryLlmFetch;
  llmCache?: HomeMemoryLlmCacheStore;
  llmUsage?: HomeMemoryLlmUsageTracker;
}

export interface HomeMemoryLlmCacheStore {
  get(cacheKey: string): HomeMemoryLlmEnrichment | undefined;
  set(cacheKey: string, enrichment: HomeMemoryLlmEnrichment): void;
}

export interface HouseholdPortraitQuery {
  includeLlmEnrichment?: boolean;
  summaryPeriod?: HouseholdPortraitSummaryPeriod;
}

export interface NaturalLanguageMemoryQuery {
  question: string;
}

export interface UnknownSchemaMappingQuery {
  includeLlmEnrichment?: boolean;
  minEvidenceCount?: number;
  limit?: number;
}

export interface UnknownSchemaMappingItem {
  candidate: UnknownSchemaCandidate;
  mapping?: HomeMemoryLlmEnrichment;
  mappingSource?: 'cache' | 'llm' | 'deterministic-fallback';
  mappingErrors?: string[];
}

export interface UnknownSchemaMappingResult {
  homeId: string | null;
  runId: string | null;
  items: UnknownSchemaMappingItem[];
}

export interface SemanticCandidateQuery {
  includeLlmEnrichment?: boolean;
  minEvidenceCount?: number;
  limit?: number;
}

export interface SemanticCandidateWindow {
  id: string;
  homeId: string;
  runId: string;
  roomId: string;
  timeBucket: string;
  evidenceIds: string[];
  deviceIds: string[];
  deterministicSignalTypes: string[];
}

export interface SemanticCandidateItem {
  window: SemanticCandidateWindow;
  candidate?: HomeMemoryLlmEnrichment;
  candidateSource?: 'cache' | 'llm' | 'deterministic-fallback';
  candidateErrors?: string[];
}

export interface SemanticCandidateResult {
  homeId: string | null;
  runId: string | null;
  items: SemanticCandidateItem[];
}

export interface MemoryReliabilityReport {
  homeId: string | null;
  runId: string | null;
  updatedAt: string | null;
  factLayer: {
    eventCount: number;
    evidenceCount: number;
    eventCoverage: number;
    sequenceConsistency: number;
    runIsolation: number;
  };
  semanticLayer: {
    semanticSignalCount: number;
    evidenceLinkCorrectness: number;
    orphanSemanticCount: number;
  };
  portraitLayer: {
    hypothesisCount: number;
    evidenceLinkedHypothesisCount: number;
    unsupportedClaimCount: number;
    contradictionRate: number;
  };
  graphLayer: {
    nodeCount: number;
    edgeCount: number;
    edgeEndpointIntegrity: number;
    orphanHypothesisCount: number;
    missingEvidenceReferenceCount: number;
    confidenceMonotonicityViolations: number;
    environmentOnlyCapViolations: number;
  };
}

export interface HomeMemoryLlmBatchPlanQuery {
  includePortraitSummary?: boolean;
  limit?: number;
  summaryPeriod?: HouseholdPortraitSummaryPeriod;
}

export interface HomeMemoryLlmBatchPlanItem {
  purpose: HomeMemoryLlmPurpose;
  trigger: 'batch';
  targetId: string;
  evidenceIds: string[];
  cacheKey: string;
  shouldCall: boolean;
  reason: string;
  maxTokens: number;
  priority: 'low' | 'normal' | 'high';
  cached: boolean;
}

export interface HomeMemoryLlmBatchPlan {
  homeId: string | null;
  runId: string | null;
  realtimeDeviceEventCallsAllowed: false;
  maxBatchSize: number;
  candidateCount: number;
  allowedCount: number;
  skippedCount: number;
  estimatedMaxTokens: number;
  items: HomeMemoryLlmBatchPlanItem[];
}

export interface HomeMemoryLlmBatchExecutionItem {
  purpose: HomeMemoryLlmPurpose;
  targetId: string;
  source: 'cache' | 'llm' | 'deterministic-fallback' | 'skipped';
  cacheKey: string;
  enrichment?: HomeMemoryLlmEnrichment;
  errors: string[];
}

export interface HomeMemoryLlmBatchExecution {
  homeId: string | null;
  runId: string | null;
  plan: HomeMemoryLlmBatchPlan;
  results: HomeMemoryLlmBatchExecutionItem[];
}

export interface HomeMemoryLlmUsageTracker {
  callsThisHour(homeId: string): number;
  callsToday(homeId: string): number;
  recordCall(homeId: string, cacheKey: string): void;
  recordResult?(event: {
    homeId: string;
    cacheKey: string;
    purpose: HomeMemoryLlmPurpose;
    trigger: HomeMemoryLlmTrigger;
    source: 'cache' | 'llm' | 'deterministic-fallback';
    errors: string[];
  }): void;
}

export type HouseholdPortraitSectionId =
  | 'household_composition'
  | 'daily_rhythm'
  | 'room_functions'
  | 'routine_patterns'
  | 'behavior_flows'
  | 'device_contribution'
  | 'current_presence'
  | 'anomalies_and_uncertainty'
  | 'evidence_quality';

export type HouseholdPortraitSummaryPeriod = 'daily' | 'weekly';

export interface HouseholdPortraitSection {
  id: HouseholdPortraitSectionId;
  label: string;
  summary: string;
  confidence: number;
  evidenceIds: string[];
  missingEvidence: string[];
  contradictingEvidenceIds: string[];
  updatedAt: string | null;
  explanationSource: 'rule_template' | 'llm_enrichment' | 'mixed';
  hypothesisIds: string[];
}

export interface HouseholdPortraitEvidenceQuality {
  evidenceCount: number;
  independentDeviceCount: number;
  distinctRoomCount: number;
  observedDayCount: number;
  observedWeekCount: number;
  environmentContextRatio: number;
  unsupportedClaimCount: number;
  missingEvidence: string[];
}

export interface HouseholdPortrait {
  homeId: string | null;
  runId: string | null;
  updatedAt: string | null;
  confidence: number;
  sections: HouseholdPortraitSection[];
  evidenceQuality: HouseholdPortraitEvidenceQuality;
  llmSummary?: HomeMemoryLlmEnrichment;
  llmSummarySource?: 'cache' | 'llm' | 'deterministic-fallback';
  llmSummaryErrors?: string[];
}

export interface MemoryQueryPlanExecution {
  target: 'evidence' | 'hypotheses' | 'summary';
  query: Record<string, unknown>;
  evidenceIds: string[];
  items: unknown[];
}

export interface MemoryQueryPlanResult {
  question: string;
  plan: HomeMemoryLlmEnrichment;
  planSource: 'cache' | 'llm' | 'deterministic-fallback';
  planErrors?: string[];
  execution: MemoryQueryPlanExecution;
}

export function buildHomeMemoryFromEvents(events: TwinEvent[]): HomeMemory {
  return reduceDeviceEvents(createHomeMemory(), projectDeviceValueEvents(events));
}

export function createMemorySummary(memory: HomeMemory): MemorySummary {
  const hypotheses = createHomeProfileHypotheses(memory);
  return {
    homeId: memory.homeId,
    runId: memory.runId,
    totalEvents: memory.totalEvents,
    profileEventCount: memory.profileEventCount,
    profileEvidenceWeight: memory.profileEvidenceWeight,
    activeRooms: Object.values(memory.rooms)
      .sort((left, right) => right.eventCount - left.eventCount || left.roomId.localeCompare(right.roomId))
      .map((room) => room.roomId),
    activeDevices: Object.values(memory.devices)
      .sort((left, right) => right.eventCount - left.eventCount || left.deviceId.localeCompare(right.deviceId))
      .map((device) => device.deviceId),
    activeEpisodes: Object.values(memory.episodes)
      .filter((episode) => episode.status === 'open')
      .sort(compareByUpdatedSimTimeDesc)
      .map((episode) => ({
        id: episode.id,
        kind: episode.kind,
        roomId: episode.roomId,
        deviceId: episode.deviceId,
        field: episode.field,
        status: episode.status,
        updatedSimTime: episode.updatedSimTime
      })),
    activityEpisodes: memory.activityEpisodes
      .slice(0, 10)
      .map((episode) => ({
        id: episode.id,
        kind: episode.kind,
        roomIds: episode.roomIds,
        deviceIds: episode.deviceIds,
        updatedSimTime: episode.updatedSimTime,
        evidenceIds: episode.evidenceIds,
        summary: episode.summary
      })),
    topPatterns: hypotheses
      .sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id))
      .slice(0, 5)
      .map(toHypothesisSummary),
    recentHighlights: memory.recentEvents
      .filter((event) => event.profileWeight > 0)
      .slice(0, 10),
    updatedAt: memory.recentEvents[0]?.simTime ?? null
  };
}

export function queryMemoryEntities(memory: HomeMemory, query: MemoryEntityQuery): { kind: MemoryEntityKind; items: unknown[] } {
  if (query.kind === 'room') {
    return {
      kind: query.kind,
      items: Object.values(memory.rooms)
        .filter((room) => matchesRoomQuery(room.roomId, query))
        .filter((room) => !query.meaningfulOnly || room.profileEventCount > 0)
        .sort((left, right) => right.eventCount - left.eventCount || left.roomId.localeCompare(right.roomId))
    };
  }
  if (query.kind === 'device') {
    return {
      kind: query.kind,
      items: Object.values(memory.devices)
        .filter((device) => matchesRoomQuery(device.roomId, query))
        .filter((device) => !query.deviceId || device.deviceId === query.deviceId)
        .filter((device) => !query.meaningfulOnly || device.profileEventCount > 0)
        .sort((left, right) => right.eventCount - left.eventCount || left.deviceId.localeCompare(right.deviceId))
    };
  }
  return {
    kind: query.kind,
    items: Object.values(memory.fields)
      .filter((field) => matchesRoomQuery(field.roomId, query))
      .filter((field) => !query.deviceId || field.deviceId === query.deviceId)
      .filter((field) => !query.field || field.field === query.field || field.id === query.field)
      .filter((field) => !query.meaningfulOnly || field.profileEventCount > 0)
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt) || left.id.localeCompare(right.id))
  };
}

export function queryMemoryEpisodes(memory: HomeMemory, query: MemoryEpisodeQuery): MemoryEpisode[] {
  return Object.values(memory.episodes)
    .filter((episode) => !query.kind || episode.kind === query.kind)
    .filter((episode) => !query.status || episode.status === query.status)
    .filter((episode) => !query.roomId || episode.roomId === query.roomId)
    .filter((episode) => !query.deviceId || episode.deviceId === query.deviceId)
    .filter((episode) => !query.field || episode.field === query.field || episode.fieldId === query.field)
    .sort(compareByUpdatedSimTimeDesc)
    .slice(0, query.limit ?? 50);
}

export function queryMemoryEvidence(memory: HomeMemory, query: MemoryEvidenceQuery): MemoryEvidence[] {
  return memory.recentEvents
    .filter((event) => !query.category || event.evidenceCategory === query.category)
    .filter((event) => !query.strength || event.evidenceStrength === query.strength)
    .filter((event) => !query.roomId || event.roomId === query.roomId)
    .filter((event) => !query.deviceId || event.deviceId === query.deviceId)
    .filter((event) => !query.field || event.field === query.field || `${event.deviceId}:${event.field}` === query.field)
    .filter((event) => !query.meaningfulOnly || event.profileWeight > 0)
    .sort((left, right) => right.sequence - left.sequence || right.id.localeCompare(left.id))
    .slice(0, query.limit ?? 50);
}

export function queryMemoryProfileConclusions(memory: HomeMemory, query: MemoryProfileConclusionQuery = {}): MemoryProfileConclusion[] {
  const evidenceIndex = indexMemoryEvidence(memory);
  const conclusions = [
    ...extractHomeProfileClaims(memory).map((claim) => profileConclusionFromClaim(claim, evidenceIndex, query)),
    ...createHomeProfileHypotheses(memory).map((hypothesis) => profileConclusionFromHypothesis(hypothesis, query))
  ];

  return conclusions
    .filter((item) => !query.id || item.id === query.id)
    .filter((item) => !query.source || item.source === query.source)
    .filter((item) => !query.topic || item.topic === query.topic)
    .filter((item) => !query.type || item.type === query.type)
    .filter((item) => !query.status || item.status === query.status)
    .filter((item) => query.minConfidence === undefined || item.confidence >= query.minConfidence)
    .filter((item) => query.maxConfidence === undefined || item.confidence <= query.maxConfidence)
    .sort((left, right) => right.confidence - left.confidence || left.topic.localeCompare(right.topic) || left.id.localeCompare(right.id))
    .slice(0, query.limit ?? 100);
}

export function answerMemoryProfileQuestion(memory: HomeMemory, query: MemoryProfileAnswerQuery): MemoryProfileAnswer {
  const matchedQuery = matchProfileQuestion(query.question);
  const conclusionQuery: MemoryProfileAnswer['matchedQuery'] = {
    ...matchedQuery,
    includeEvidence: query.includeEvidence ?? true,
    includeReasoning: query.includeReasoning ?? true,
    limit: query.limit ?? 5
  };
  const conclusions = rankProfileAnswerConclusions(queryMemoryProfileConclusions(memory, conclusionQuery), conclusionQuery);
  const sourceConclusionIds = conclusions.map((conclusion) => conclusion.id);
  const evidenceIds = unique(conclusions.flatMap((conclusion) => [
    ...conclusion.supports.flatMap((support) => support.evidenceIds),
    ...conclusion.contradictions.flatMap((contradiction) => contradiction.evidenceIds)
  ]));
  const missingEvidence = unique(conclusions.flatMap((conclusion) => conclusion.missingEvidence));
  const alternatives = unique(conclusions.flatMap((conclusion) => conclusion.alternativeExplanations));
  const primary = conclusions[0];

  return {
    question: query.question,
    matchedQuery: conclusionQuery,
    answer: createProfileAnswerText(query.question, conclusionQuery, conclusions, missingEvidence, alternatives),
    status: primary?.status ?? 'rejected',
    confidence: primary?.confidence ?? 0,
    sourceConclusionIds,
    evidenceIds,
    missingEvidence,
    alternatives,
    conclusions
  };
}

export function queryMemoryHypotheses(memory: HomeMemory, query: MemoryHypothesisQuery, options: MemoryHypothesisQueryOptions = {}): unknown[] {
  const llmConfig = options.llmConfig ?? resolveHomeMemoryLlmConfig({});
  return createHomeProfileHypotheses(memory)
    .filter((hypothesis) => !query.type || hypothesis.type === query.type)
    .sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id))
    .map((hypothesis) => ({
      ...toHypothesisSummary(hypothesis),
      ...(query.includeEvidence ? { evidence: hypothesis.evidence.slice(0, 10) } : {}),
      ...(query.includeReliability ? { reliability: createHypothesisReliability(hypothesis) } : {}),
      ...(query.includeLlmEnrichment ? {
        llmEnrichment: createDeterministicHomeMemoryLlmEnrichment({
          purpose: 'hypothesis_explanation',
          hypothesis,
          evidenceIds: hypothesis.evidence.map((evidence) => evidence.id),
          prompt: createHypothesisExplanationPrompt(hypothesis),
          baseUrl: llmConfig.provider.baseUrl
        }),
        llmEnrichmentSource: 'deterministic-fallback'
      } : {})
    }));
}

export async function queryMemoryHypothesesWithEnrichment(
  memory: HomeMemory,
  query: MemoryHypothesisQuery,
  options: MemoryHypothesisQueryOptions = {}
): Promise<unknown[]> {
  const llmConfig = options.llmConfig ?? resolveHomeMemoryLlmConfig({});
  const hypotheses = createHomeProfileHypotheses(memory)
    .filter((hypothesis) => !query.type || hypothesis.type === query.type)
    .sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id));

  const items: unknown[] = [];
  for (const hypothesis of hypotheses) {
    const summary = {
      ...toHypothesisSummary(hypothesis),
      ...(query.includeEvidence ? { evidence: hypothesis.evidence.slice(0, 10) } : {}),
      ...(query.includeReliability ? { reliability: createHypothesisReliability(hypothesis) } : {})
    };

    if (!query.includeLlmEnrichment) {
      items.push(summary);
      continue;
    }

    const evidenceIds = hypothesis.evidence.map((evidence) => evidence.id);
    const cacheKey = createHomeMemoryLlmCacheKey({
      purpose: 'hypothesis_explanation',
      homeId: memory.homeId ?? '',
      runId: memory.runId ?? '',
      hypothesisId: hypothesis.id,
      evidenceIds,
      model: llmConfig.provider.model,
      promptVersion: 1,
      schemaVersion: 1
    });
    const homeId = memory.homeId ?? '';
    const result = await requestHomeMemoryLlmEnrichment({
      config: llmConfig,
      purpose: 'hypothesis_explanation',
      trigger: 'user_request',
      prompt: createHypothesisExplanationPrompt(hypothesis),
      memory,
      hypothesis,
      fetcher: options.fetcher,
      cached: options.llmCache?.get(cacheKey),
      callsThisHour: options.llmUsage?.callsThisHour(homeId),
      callsToday: options.llmUsage?.callsToday(homeId)
    });

    if (result.source === 'llm') {
      options.llmCache?.set(result.cacheKey, result.enrichment);
      options.llmUsage?.recordCall(homeId, result.cacheKey);
    }
    options.llmUsage?.recordResult?.({
      homeId,
      cacheKey: result.cacheKey,
      purpose: 'hypothesis_explanation',
      trigger: 'user_request',
      source: result.source,
      errors: result.errors
    });

    const item: Record<string, unknown> = {
      ...summary,
      llmEnrichment: result.enrichment,
      llmEnrichmentSource: result.source,
      ...(result.errors.length > 0 ? { llmEnrichmentErrors: result.errors } : {})
    };

    if (query.includeReliability) {
      const reviewCacheKey = createHomeMemoryLlmCacheKey({
        purpose: 'reliability_review',
        homeId: memory.homeId ?? '',
        runId: memory.runId ?? '',
        hypothesisId: hypothesis.id,
        evidenceIds,
        model: llmConfig.provider.model,
        promptVersion: 1,
        schemaVersion: 1
      });
      const review = await requestHomeMemoryLlmEnrichment({
        config: llmConfig,
        purpose: 'reliability_review',
        trigger: 'user_request',
        prompt: createHypothesisReliabilityReviewPrompt(hypothesis),
        memory,
        hypothesis,
        fetcher: options.fetcher,
        cached: options.llmCache?.get(reviewCacheKey),
        callsThisHour: options.llmUsage?.callsThisHour(homeId),
        callsToday: options.llmUsage?.callsToday(homeId)
      });

      if (review.source === 'llm') {
        options.llmCache?.set(review.cacheKey, review.enrichment);
        options.llmUsage?.recordCall(homeId, review.cacheKey);
      }
      options.llmUsage?.recordResult?.({
        homeId,
        cacheKey: review.cacheKey,
        purpose: 'reliability_review',
        trigger: 'user_request',
        source: review.source,
        errors: review.errors
      });

      item.llmReliabilityReview = review.enrichment;
      item.llmReliabilityReviewSource = review.source;
      if (review.errors.length > 0) {
        item.llmReliabilityReviewErrors = review.errors;
      }
    }

    items.push(item);
  }
  return items;
}

export function createHouseholdPortrait(memory: HomeMemory): HouseholdPortrait {
  const hypotheses = createHomeProfileHypotheses(memory);
  const evidenceQuality = createHouseholdPortraitEvidenceQuality(memory, hypotheses);
  const sections = HOUSEHOLD_PORTRAIT_SECTIONS.map((definition) => {
    const sectionHypotheses = hypotheses.filter((hypothesis) => definition.types.includes(hypothesis.type));
    return createHouseholdPortraitSection(definition, sectionHypotheses, memory, evidenceQuality);
  });

  return {
    homeId: memory.homeId,
    runId: memory.runId,
    updatedAt: memory.recentEvents[0]?.simTime ?? null,
    confidence: roundConfidence(average(sections.map((section) => section.confidence))),
    sections,
    evidenceQuality
  };
}

export async function createHouseholdPortraitWithEnrichment(
  memory: HomeMemory,
  query: HouseholdPortraitQuery,
  options: MemoryHypothesisQueryOptions = {}
): Promise<HouseholdPortrait> {
  const portrait = createHouseholdPortrait(memory);
  if (!query.includeLlmEnrichment) {
    return portrait;
  }

  const llmConfig = options.llmConfig ?? resolveHomeMemoryLlmConfig({});
  const summaryPeriod = query.summaryPeriod ?? 'daily';
  const hypothesis = createPortraitSummaryHypothesis(memory, portrait, summaryPeriod);
  const evidenceIds = hypothesis.evidence.map((evidence) => evidence.id);
  const cacheKey = createHomeMemoryLlmCacheKey({
    purpose: 'daily_portrait_summary',
    homeId: memory.homeId ?? '',
    runId: memory.runId ?? '',
    hypothesisId: hypothesis.id,
    evidenceIds,
    model: llmConfig.provider.model,
    promptVersion: 1,
    schemaVersion: 1
  });
  const homeId = memory.homeId ?? '';
  const result = await requestHomeMemoryLlmEnrichment({
    config: llmConfig,
    purpose: 'daily_portrait_summary',
    trigger: 'user_request',
    prompt: createPortraitSummaryPrompt(portrait, evidenceIds, summaryPeriod),
    memory,
    hypothesis,
    fetcher: options.fetcher,
    cached: options.llmCache?.get(cacheKey),
    callsThisHour: options.llmUsage?.callsThisHour(homeId),
    callsToday: options.llmUsage?.callsToday(homeId)
  });

  if (result.source === 'llm') {
    options.llmCache?.set(result.cacheKey, result.enrichment);
    options.llmUsage?.recordCall(homeId, result.cacheKey);
  }
  options.llmUsage?.recordResult?.({
    homeId,
    cacheKey: result.cacheKey,
    purpose: 'daily_portrait_summary',
    trigger: 'user_request',
    source: result.source,
    errors: result.errors
  });

  return {
    ...portrait,
    llmSummary: result.enrichment,
    llmSummarySource: result.source,
    ...(result.errors.length > 0 ? { llmSummaryErrors: result.errors } : {})
  };
}

export async function planMemoryQuery(
  memory: HomeMemory,
  query: NaturalLanguageMemoryQuery,
  options: MemoryHypothesisQueryOptions = {}
): Promise<MemoryQueryPlanResult> {
  const execution = executeDeterministicMemoryQuery(memory, query.question);
  const llmConfig = options.llmConfig ?? resolveHomeMemoryLlmConfig({});
  const hypothesis = createQueryPlanningHypothesis(memory, query.question, execution);
  const evidenceIds = hypothesis.evidence.map((evidence) => evidence.id);
  const cacheKey = createHomeMemoryLlmCacheKey({
    purpose: 'query_planning',
    homeId: memory.homeId ?? '',
    runId: memory.runId ?? '',
    hypothesisId: hypothesis.id,
    evidenceIds,
    model: llmConfig.provider.model,
    promptVersion: 1,
    schemaVersion: 1
  });
  const homeId = memory.homeId ?? '';
  const result = await requestHomeMemoryLlmEnrichment({
    config: llmConfig,
    purpose: 'query_planning',
    trigger: 'user_request',
    prompt: createQueryPlanningPrompt(query.question, execution),
    memory,
    hypothesis,
    fetcher: options.fetcher,
    cached: options.llmCache?.get(cacheKey),
    callsThisHour: options.llmUsage?.callsThisHour(homeId),
    callsToday: options.llmUsage?.callsToday(homeId)
  });

  if (result.source === 'llm') {
    options.llmCache?.set(result.cacheKey, result.enrichment);
    options.llmUsage?.recordCall(homeId, result.cacheKey);
  }
  options.llmUsage?.recordResult?.({
    homeId,
    cacheKey: result.cacheKey,
    purpose: 'query_planning',
    trigger: 'user_request',
    source: result.source,
    errors: result.errors
  });

  return {
    question: query.question,
    plan: result.enrichment,
    planSource: result.source,
    ...(result.errors.length > 0 ? { planErrors: result.errors } : {}),
    execution
  };
}

export async function queryUnknownSchemaMappings(
  memory: HomeMemory,
  query: UnknownSchemaMappingQuery = {},
  options: MemoryHypothesisQueryOptions = {}
): Promise<UnknownSchemaMappingResult> {
  const llmConfig = options.llmConfig ?? resolveHomeMemoryLlmConfig({});
  const candidates = collectUnknownSchemaCandidates(memory, {
    minEvidenceCount: query.minEvidenceCount ?? llmConfig.gates.minEvidenceCountForUnknownSchema
  }).slice(0, query.limit ?? llmConfig.budget.maxBatchSize);

  const items: UnknownSchemaMappingItem[] = [];
  for (const candidate of candidates) {
    const item: UnknownSchemaMappingItem = { candidate };
    if (query.includeLlmEnrichment) {
      const cacheKey = createHomeMemoryLlmCacheKey({
        purpose: 'unknown_schema_mapping',
        homeId: candidate.homeId,
        runId: candidate.runId,
        hypothesisId: candidate.id,
        evidenceIds: candidate.evidenceIds,
        model: llmConfig.provider.model,
        promptVersion: 1,
        schemaVersion: 1
      });
      const result = await requestUnknownSchemaMapping({
        config: llmConfig,
        memory,
        candidate,
        fetcher: options.fetcher,
        cached: options.llmCache?.get(cacheKey),
        callsThisHour: options.llmUsage?.callsThisHour(candidate.homeId),
        callsToday: options.llmUsage?.callsToday(candidate.homeId)
      });

      if (result.source === 'llm') {
        options.llmCache?.set(result.cacheKey, result.enrichment);
        options.llmUsage?.recordCall(candidate.homeId, result.cacheKey);
      }
      options.llmUsage?.recordResult?.({
        homeId: candidate.homeId,
        cacheKey: result.cacheKey,
        purpose: 'unknown_schema_mapping',
        trigger: 'user_request',
        source: result.source,
        errors: result.errors
      });

      item.mapping = result.enrichment;
      item.mappingSource = result.source;
      if (result.errors.length > 0) {
        item.mappingErrors = result.errors;
      }
    }
    items.push(item);
  }

  return {
    homeId: memory.homeId,
    runId: memory.runId,
    items
  };
}

export async function querySemanticCandidates(
  memory: HomeMemory,
  query: SemanticCandidateQuery = {},
  options: MemoryHypothesisQueryOptions = {}
): Promise<SemanticCandidateResult> {
  const llmConfig = options.llmConfig ?? resolveHomeMemoryLlmConfig({});
  const windows = collectSemanticCandidateWindows(memory, {
    minEvidenceCount: query.minEvidenceCount ?? 2,
    limit: query.limit ?? llmConfig.budget.maxBatchSize
  });

  const items: SemanticCandidateItem[] = [];
  for (const window of windows) {
    const item: SemanticCandidateItem = { window };
    if (query.includeLlmEnrichment) {
      const hypothesis = createSemanticCandidateHypothesis(memory, window);
      const cacheKey = createHomeMemoryLlmCacheKey({
        purpose: 'semantic_candidate',
        homeId: window.homeId,
        runId: window.runId,
        hypothesisId: hypothesis.id,
        evidenceIds: window.evidenceIds,
        model: llmConfig.provider.model,
        promptVersion: 1,
        schemaVersion: 1
      });
      const result = await requestHomeMemoryLlmEnrichment({
        config: llmConfig,
        purpose: 'semantic_candidate',
        trigger: 'user_request',
        prompt: createSemanticCandidatePrompt(window),
        memory,
        hypothesis,
        fetcher: options.fetcher,
        cached: options.llmCache?.get(cacheKey),
        callsThisHour: options.llmUsage?.callsThisHour(window.homeId),
        callsToday: options.llmUsage?.callsToday(window.homeId)
      });

      if (result.source === 'llm') {
        options.llmCache?.set(result.cacheKey, result.enrichment);
        options.llmUsage?.recordCall(window.homeId, result.cacheKey);
      }
      options.llmUsage?.recordResult?.({
        homeId: window.homeId,
        cacheKey: result.cacheKey,
        purpose: 'semantic_candidate',
        trigger: 'user_request',
        source: result.source,
        errors: result.errors
      });

      item.candidate = result.enrichment;
      item.candidateSource = result.source;
      if (result.errors.length > 0) {
        item.candidateErrors = result.errors;
      }
    }
    items.push(item);
  }

  return {
    homeId: memory.homeId,
    runId: memory.runId,
    items
  };
}

export function createMemoryReliabilityReport(memory: HomeMemory): MemoryReliabilityReport {
  const hypotheses = createHomeProfileHypotheses(memory);
  const graph = createHomeMemoryGraphModel(memory, hypotheses);
  const evidenceIds = new Set(indexMemoryEvidence(memory).keys());
  const graphNodeIds = new Set(graph.nodes.map((node) => node.id));
  const sequenceConsistency = memory.recentEvents.every((event, index, events) => (
    index === 0 || events[index - 1].sequence >= event.sequence
  ));
  const runIsolation = Boolean(memory.runId) && memory.recentEvents.every((event) => event.runId === memory.runId);
  const coveredEvents = memory.recentEvents.filter((event) => (
    Boolean(memory.fields[`${event.deviceId}:${event.field}`]) &&
    Boolean(memory.devices[event.deviceId]) &&
    Boolean(memory.rooms[event.roomId])
  )).length;
  const semanticEvidenceReferences = memory.semanticSignals.flatMap((signal) => signal.sourceEvidenceIds);
  const orphanSemanticCount = memory.semanticSignals.filter((signal) => (
    signal.sourceEvidenceIds.length === 0 ||
    signal.sourceEvidenceIds.some((evidenceId) => !evidenceIds.has(evidenceId))
  )).length;
  const linkedHypotheses = hypotheses.filter((hypothesis) => (
    hypothesis.evidence.length > 0 &&
    hypothesis.evidence.every((evidence) => evidenceIds.has(evidence.id))
  )).length;
  const missingEvidenceReferenceCount = [
    ...semanticEvidenceReferences,
    ...hypotheses.flatMap((hypothesis) => hypothesis.evidence.map((evidence) => evidence.id)),
    ...hypotheses.flatMap((hypothesis) => hypothesis.contradictingEvidence.map((evidence) => evidence.id))
  ].filter((evidenceId) => !evidenceIds.has(evidenceId)).length;
  const edgeEndpointIntegrity = graph.edges.filter((edge) => graphNodeIds.has(edge.from) && graphNodeIds.has(edge.to)).length;
  const orphanHypothesisCount = hypotheses.filter((hypothesis) => (
    hypothesis.evidence.length === 0 ||
    !graphNodeIds.has(`hypothesis:${hypothesis.id}`)
  )).length;
  const confidenceMonotonicityViolations = graph.edges.filter((edge) => {
    if (edge.kind !== 'supports' || !edge.from.startsWith('hypothesis:')) {
      return false;
    }
    const hypothesis = hypotheses.find((item) => `hypothesis:${item.id}` === edge.from);
    return Boolean(hypothesis && edge.strength > hypothesis.confidence);
  }).length;
  const environmentOnlyCapViolations = hypotheses.filter((hypothesis) => (
    hypothesis.confidence > 0.3 &&
    hypothesis.evidence.length > 0 &&
    hypothesis.evidence.every((evidence) => evidence.evidenceCategory === 'environment_context')
  )).length;

  return {
    homeId: memory.homeId,
    runId: memory.runId,
    updatedAt: memory.recentEvents[0]?.simTime ?? null,
    factLayer: {
      eventCount: memory.totalEvents,
      evidenceCount: memory.recentEvents.length,
      eventCoverage: ratioValue(coveredEvents, memory.recentEvents.length),
      sequenceConsistency: sequenceConsistency ? 1 : 0,
      runIsolation: runIsolation ? 1 : 0
    },
    semanticLayer: {
      semanticSignalCount: memory.semanticSignalCount,
      evidenceLinkCorrectness: ratioValue(semanticEvidenceReferences.length - orphanSemanticCount, semanticEvidenceReferences.length),
      orphanSemanticCount
    },
    portraitLayer: {
      hypothesisCount: hypotheses.length,
      evidenceLinkedHypothesisCount: linkedHypotheses,
      unsupportedClaimCount: 0,
      contradictionRate: ratioValue(hypotheses.filter((hypothesis) => hypothesis.contradictingEvidence.length > 0).length, hypotheses.length)
    },
    graphLayer: {
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      edgeEndpointIntegrity: ratioValue(edgeEndpointIntegrity, graph.edges.length),
      orphanHypothesisCount,
      missingEvidenceReferenceCount,
      confidenceMonotonicityViolations,
      environmentOnlyCapViolations
    }
  };
}

export function createHomeMemoryLlmBatchPlan(
  memory: HomeMemory,
  query: HomeMemoryLlmBatchPlanQuery = {},
  options: MemoryHypothesisQueryOptions = {}
): HomeMemoryLlmBatchPlan {
  const llmConfig = options.llmConfig ?? resolveHomeMemoryLlmConfig({});
  const homeId = memory.homeId ?? '';
  const limit = query.limit ?? llmConfig.budget.maxBatchSize;
  const items: HomeMemoryLlmBatchPlanItem[] = [
    ...collectUnknownSchemaCandidates(memory, {
      minEvidenceCount: llmConfig.gates.minEvidenceCountForUnknownSchema
    }).map((candidate) => createBatchPlanItem({
      config: llmConfig,
      purpose: 'unknown_schema_mapping',
      targetId: candidate.id,
      homeId: candidate.homeId,
      runId: candidate.runId,
      evidenceIds: candidate.evidenceIds,
      llmCache: options.llmCache,
      callsThisHour: options.llmUsage?.callsThisHour(candidate.homeId),
      callsToday: options.llmUsage?.callsToday(candidate.homeId)
    })),
    ...collectSemanticCandidateWindows(memory, { minEvidenceCount: 2, limit }).map((window) => createBatchPlanItem({
      config: llmConfig,
      purpose: 'semantic_candidate',
      targetId: window.id,
      homeId: window.homeId,
      runId: window.runId,
      evidenceIds: window.evidenceIds,
      llmCache: options.llmCache,
      callsThisHour: options.llmUsage?.callsThisHour(window.homeId),
      callsToday: options.llmUsage?.callsToday(window.homeId)
    })),
    ...createHomeProfileHypotheses(memory).map((hypothesis) => createBatchPlanItem({
      config: llmConfig,
      purpose: 'reliability_review',
      targetId: hypothesis.id,
      homeId,
      runId: memory.runId ?? '',
      hypothesisId: hypothesis.id,
      evidenceIds: hypothesis.evidence.map((evidence) => evidence.id),
      confidence: hypothesis.confidence,
      llmCache: options.llmCache,
      callsThisHour: options.llmUsage?.callsThisHour(homeId),
      callsToday: options.llmUsage?.callsToday(homeId)
    })),
    ...(query.includePortraitSummary ? [
      createPortraitBatchPlanItem(memory, llmConfig, options, query.summaryPeriod ?? 'daily')
    ] : [])
  ].slice(0, limit);
  const allowedItems = items.filter((item) => item.shouldCall);

  return {
    homeId: memory.homeId,
    runId: memory.runId,
    realtimeDeviceEventCallsAllowed: false,
    maxBatchSize: llmConfig.budget.maxBatchSize,
    candidateCount: items.length,
    allowedCount: allowedItems.length,
    skippedCount: items.length - allowedItems.length,
    estimatedMaxTokens: allowedItems.reduce((total, item) => total + item.maxTokens, 0),
    items
  };
}

export async function executeHomeMemoryLlmBatch(
  memory: HomeMemory,
  query: HomeMemoryLlmBatchPlanQuery = {},
  options: MemoryHypothesisQueryOptions = {}
): Promise<HomeMemoryLlmBatchExecution> {
  const plan = createHomeMemoryLlmBatchPlan(memory, query, options);
  const results: HomeMemoryLlmBatchExecutionItem[] = [];
  const llmConfig = options.llmConfig ?? resolveHomeMemoryLlmConfig({});

  for (const item of plan.items) {
    if (!item.shouldCall) {
      const cached = item.cached ? options.llmCache?.get(item.cacheKey) : undefined;
      results.push({
        purpose: item.purpose,
        targetId: item.targetId,
        source: cached ? 'cache' : 'skipped',
        cacheKey: item.cacheKey,
        ...(cached ? { enrichment: cached } : {}),
        errors: cached ? [] : [item.reason]
      });
      continue;
    }

    const result = await executeHomeMemoryLlmBatchItem(memory, item, llmConfig, options);
    if (result.source === 'llm') {
      options.llmCache?.set(result.cacheKey, result.enrichment);
      options.llmUsage?.recordCall(memory.homeId ?? '', result.cacheKey);
    }
    options.llmUsage?.recordResult?.({
      homeId: memory.homeId ?? '',
      cacheKey: result.cacheKey,
      purpose: item.purpose,
      trigger: 'batch',
      source: result.source,
      errors: result.errors
    });
    results.push({
      purpose: item.purpose,
      targetId: item.targetId,
      source: result.source,
      cacheKey: result.cacheKey,
      enrichment: result.enrichment,
      errors: result.errors
    });
  }

  return {
    homeId: memory.homeId,
    runId: memory.runId,
    plan,
    results
  };
}

async function executeHomeMemoryLlmBatchItem(
  memory: HomeMemory,
  item: HomeMemoryLlmBatchPlanItem,
  llmConfig: HomeMemoryLlmConfig,
  options: MemoryHypothesisQueryOptions
): Promise<RequestHomeMemoryLlmEnrichmentResult> {
  if (item.purpose === 'unknown_schema_mapping') {
    const candidate = collectUnknownSchemaCandidates(memory, {
      minEvidenceCount: llmConfig.gates.minEvidenceCountForUnknownSchema
    }).find((entry) => entry.id === item.targetId);
    if (candidate) {
      return requestUnknownSchemaMapping({
        config: llmConfig,
        memory,
        candidate,
        fetcher: options.fetcher,
        cached: options.llmCache?.get(item.cacheKey),
        callsThisHour: options.llmUsage?.callsThisHour(candidate.homeId),
        callsToday: options.llmUsage?.callsToday(candidate.homeId)
      });
    }
  }

  if (item.purpose === 'semantic_candidate') {
    const window = collectSemanticCandidateWindows(memory, {
      minEvidenceCount: 2,
      limit: llmConfig.budget.maxBatchSize
    }).find((entry) => entry.id === item.targetId);
    if (window) {
      const hypothesis = createSemanticCandidateHypothesis(memory, window);
      return requestHomeMemoryLlmEnrichment({
        config: llmConfig,
        purpose: 'semantic_candidate',
        trigger: 'batch',
        prompt: createSemanticCandidatePrompt(window),
        memory,
        hypothesis,
        fetcher: options.fetcher,
        cached: options.llmCache?.get(item.cacheKey),
        callsThisHour: options.llmUsage?.callsThisHour(window.homeId),
        callsToday: options.llmUsage?.callsToday(window.homeId)
      });
    }
  }

  if (item.purpose === 'reliability_review' || item.purpose === 'hypothesis_explanation') {
    const hypothesis = createHomeProfileHypotheses(memory).find((entry) => entry.id === item.targetId);
    if (hypothesis) {
      return requestHomeMemoryLlmEnrichment({
        config: llmConfig,
        purpose: item.purpose,
        trigger: 'batch',
        prompt: item.purpose === 'reliability_review'
          ? createHypothesisReliabilityReviewPrompt(hypothesis)
          : createHypothesisExplanationPrompt(hypothesis),
        memory,
        hypothesis,
        fetcher: options.fetcher,
        cached: options.llmCache?.get(item.cacheKey),
        callsThisHour: options.llmUsage?.callsThisHour(memory.homeId ?? ''),
        callsToday: options.llmUsage?.callsToday(memory.homeId ?? '')
      });
    }
  }

  if (item.purpose === 'daily_portrait_summary') {
    const portrait = createHouseholdPortrait(memory);
    const summaryPeriod = portraitSummaryPeriodFromTarget(item.targetId);
    const hypothesis = createPortraitSummaryHypothesis(memory, portrait, summaryPeriod);
    return requestHomeMemoryLlmEnrichment({
      config: llmConfig,
      purpose: 'daily_portrait_summary',
      trigger: 'batch',
      prompt: createPortraitSummaryPrompt(portrait, hypothesis.evidence.map((evidence) => evidence.id), summaryPeriod),
      memory,
      hypothesis,
      fetcher: options.fetcher,
      cached: options.llmCache?.get(item.cacheKey),
      callsThisHour: options.llmUsage?.callsThisHour(memory.homeId ?? ''),
      callsToday: options.llmUsage?.callsToday(memory.homeId ?? '')
    });
  }

  const fallbackHypothesis = createQueryPlanningHypothesis(memory, `batch:${item.targetId}`, {
    target: 'summary',
    query: {},
    evidenceIds: item.evidenceIds,
    items: []
  });
  return {
    source: 'deterministic-fallback',
    cacheKey: item.cacheKey,
    enrichment: createDeterministicHomeMemoryLlmEnrichment({
      purpose: item.purpose,
      hypothesis: fallbackHypothesis,
      evidenceIds: item.evidenceIds,
      prompt: `batch:${item.targetId}`,
      baseUrl: llmConfig.provider.baseUrl
    }),
    errors: [`Batch target ${item.targetId} is no longer available.`]
  };
}

const HOUSEHOLD_PORTRAIT_SECTIONS: Array<{
  id: HouseholdPortraitSectionId;
  label: string;
  types: ProfileHypothesisType[];
  emptySummary: string;
}> = [
  {
    id: 'household_composition',
    label: 'Household composition',
    types: ['household_composition', 'household_size', 'resident_slot'],
    emptySummary: 'Household composition is not yet supported by enough profile evidence.'
  },
  {
    id: 'daily_rhythm',
    label: 'Daily rhythm',
    types: ['daily_rhythm'],
    emptySummary: 'Daily rhythm is not yet supported by enough profile evidence.'
  },
  {
    id: 'room_functions',
    label: 'Room functions',
    types: ['room_function', 'room_habit'],
    emptySummary: 'Room functions are not yet supported by enough profile evidence.'
  },
  {
    id: 'routine_patterns',
    label: 'Routine patterns',
    types: ['automation_recommendation', 'routine_window', 'activity_cluster', 'device_routine'],
    emptySummary: 'Routine patterns are not yet supported by enough profile evidence.'
  },
  {
    id: 'behavior_flows',
    label: 'Behavior flows',
    types: ['behavior_flow'],
    emptySummary: 'Behavior flows are not yet supported by enough profile evidence.'
  },
  {
    id: 'device_contribution',
    label: 'Device contribution',
    types: ['device_contribution'],
    emptySummary: 'Device contribution is not yet supported by enough profile evidence.'
  },
  {
    id: 'current_presence',
    label: 'Current presence',
    types: ['presence_signal'],
    emptySummary: 'Current presence is not yet supported by enough profile evidence.'
  },
  {
    id: 'anomalies_and_uncertainty',
    label: 'Anomalies and uncertainty',
    types: ['state_anomaly'],
    emptySummary: 'No state anomalies are currently supported by enough profile evidence.'
  },
  {
    id: 'evidence_quality',
    label: 'Evidence quality',
    types: [],
    emptySummary: 'Evidence quality summarizes the observed coverage behind this portrait.'
  }
];

function createHouseholdPortraitSection(
  definition: typeof HOUSEHOLD_PORTRAIT_SECTIONS[number],
  hypotheses: ProfileHypothesis[],
  memory: HomeMemory,
  evidenceQuality: HouseholdPortraitEvidenceQuality
): HouseholdPortraitSection {
  if (definition.id === 'evidence_quality') {
    return {
      id: definition.id,
      label: definition.label,
      summary: `${evidenceQuality.evidenceCount} evidence item${plural(evidenceQuality.evidenceCount)} from ${evidenceQuality.independentDeviceCount} device${plural(evidenceQuality.independentDeviceCount)} across ${evidenceQuality.distinctRoomCount} room${plural(evidenceQuality.distinctRoomCount)}.`,
      confidence: evidenceQuality.evidenceCount > 0 ? roundConfidence(Math.min(0.95, 0.25 + evidenceQuality.evidenceCount / 20)) : 0,
      evidenceIds: unique(memory.recentEvents.map((event) => event.id)),
      missingEvidence: evidenceQuality.missingEvidence,
      contradictingEvidenceIds: [],
      updatedAt: memory.recentEvents[0]?.simTime ?? null,
      explanationSource: 'rule_template',
      hypothesisIds: []
    };
  }

  return {
    id: definition.id,
    label: definition.label,
    summary: createSectionSummary(definition.emptySummary, hypotheses),
    confidence: roundConfidence(average(hypotheses.map((hypothesis) => hypothesis.confidence))),
    evidenceIds: unique(hypotheses.flatMap((hypothesis) => hypothesis.evidence.map((evidence) => evidence.id))),
    missingEvidence: unique(hypotheses.flatMap((hypothesis) => hypothesis.missingEvidence)),
    contradictingEvidenceIds: unique(hypotheses.flatMap((hypothesis) => hypothesis.contradictingEvidence.map((evidence) => evidence.id))),
    updatedAt: newestTimestamp(hypotheses.map((hypothesis) => hypothesis.updatedAt)),
    explanationSource: 'rule_template',
    hypothesisIds: hypotheses.map((hypothesis) => hypothesis.id)
  };
}

function createHouseholdPortraitEvidenceQuality(memory: HomeMemory, hypotheses: ProfileHypothesis[]): HouseholdPortraitEvidenceQuality {
  const evidence = memory.recentEvents;
  const missingEvidence = unique(hypotheses.flatMap((hypothesis) => hypothesis.missingEvidence));
  const environmentContextCount = evidence.filter((event) => event.evidenceCategory === 'environment_context').length;
  return {
    evidenceCount: evidence.length,
    independentDeviceCount: unique(evidence.map((event) => event.deviceId)).length,
    distinctRoomCount: unique(evidence.map((event) => event.roomId)).length,
    observedDayCount: memory.dailySummaryCount,
    observedWeekCount: memory.weeklySummaryCount,
    environmentContextRatio: evidence.length > 0 ? roundConfidence(environmentContextCount / evidence.length) : 0,
    unsupportedClaimCount: 0,
    missingEvidence
  };
}

function createPortraitSummaryHypothesis(
  memory: HomeMemory,
  portrait: HouseholdPortrait,
  summaryPeriod: HouseholdPortraitSummaryPeriod = 'daily'
): ProfileHypothesis {
  const evidenceIndex = indexMemoryEvidence(memory);
  const evidence = unique(portrait.sections.flatMap((section) => section.evidenceIds))
    .map((evidenceId) => evidenceIndex.get(evidenceId))
    .filter((entry): entry is MemoryEvidence => Boolean(entry));
  return createProfileHypothesis({
    id: `portrait:${summaryPeriod}-summary`,
    type: 'daily_rhythm',
    label: `${summaryPeriod} household portrait summary`,
    summary: `${summaryPeriod} household portrait with ${portrait.sections.length} sections and ${portrait.evidenceQuality.evidenceCount} evidence items.`,
    confidence: portrait.confidence,
    updatedAt: portrait.updatedAt ?? memory.recentEvents[0]?.simTime ?? '',
    subjectIds: ['portrait:household'],
    evidence,
    supportingEvidence: evidence,
    contradictingEvidence: [],
    missingEvidence: [...portrait.evidenceQuality.missingEvidence]
  });
}

function createPortraitSummaryPrompt(
  portrait: HouseholdPortrait,
  evidenceIds: string[],
  summaryPeriod: HouseholdPortraitSummaryPeriod = 'daily'
): string {
  return JSON.stringify({
    purpose: 'daily_portrait_summary',
    portraitId: `portrait:${summaryPeriod}-summary`,
    summaryPeriod,
    homeId: portrait.homeId,
    runId: portrait.runId,
    confidence: portrait.confidence,
    evidenceIds,
    evidenceQuality: portrait.evidenceQuality,
    sections: portrait.sections.map((section) => ({
      id: section.id,
      confidence: section.confidence,
      evidenceIds: section.evidenceIds,
      missingEvidence: section.missingEvidence,
      summary: section.summary
    }))
  });
}

function executeDeterministicMemoryQuery(memory: HomeMemory, question: string): MemoryQueryPlanExecution {
  const normalized = question.toLowerCase();
  const roomId = Object.keys(memory.rooms)
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .find((candidate) => normalized.includes(candidate.toLowerCase().replace(/_/g, ' ')) || normalized.includes(candidate.toLowerCase()));

  if (normalized.includes('presence') || normalized.includes('有人') || normalized.includes('在家')) {
    const hypotheses = createHomeProfileHypotheses(memory).filter((hypothesis) => hypothesis.type === 'presence_signal');
    return {
      target: 'hypotheses',
      query: { type: 'presence_signal' },
      evidenceIds: unique(hypotheses.flatMap((hypothesis) => hypothesis.evidence.map((evidence) => evidence.id))),
      items: hypotheses.map(toHypothesisSummary)
    };
  }

  if (roomId) {
    const items = queryMemoryEvidence(memory, {
      roomId,
      meaningfulOnly: true,
      limit: 20
    });
    return {
      target: 'evidence',
      query: { roomId, meaningfulOnly: true, limit: 20 },
      evidenceIds: items.map((item) => item.id),
      items
    };
  }

  const items = queryMemoryEvidence(memory, {
    meaningfulOnly: true,
    limit: 20
  });
  return {
    target: 'evidence',
    query: { meaningfulOnly: true, limit: 20 },
    evidenceIds: items.map((item) => item.id),
    items
  };
}

function createQueryPlanningHypothesis(memory: HomeMemory, question: string, execution: MemoryQueryPlanExecution): ProfileHypothesis {
  const evidenceIndex = indexMemoryEvidence(memory);
  const evidence = execution.evidenceIds
    .map((evidenceId) => evidenceIndex.get(evidenceId))
    .filter((entry): entry is MemoryEvidence => Boolean(entry));
  return createProfileHypothesis({
    id: `query-plan:${normalizeQueryId(question)}`,
    type: 'daily_rhythm',
    label: 'Memory query plan',
    summary: `Plan a memory query for "${question}" using ${execution.target}.`,
    confidence: 0.75,
    updatedAt: memory.recentEvents[0]?.simTime ?? '',
    subjectIds: [`memory-query:${execution.target}`],
    evidence,
    supportingEvidence: evidence,
    contradictingEvidence: [],
    missingEvidence: evidence.length > 0 ? [] : ['No matching memory evidence was found for this question.']
  });
}

function createQueryPlanningPrompt(question: string, execution: MemoryQueryPlanExecution): string {
  return JSON.stringify({
    purpose: 'query_planning',
    question,
    evidenceIds: execution.evidenceIds,
    allowedTargets: ['evidence', 'hypotheses', 'summary'],
    deterministicExecution: {
      target: execution.target,
      query: execution.query,
      evidenceIds: execution.evidenceIds
    }
  });
}

function normalizeQueryId(question: string): string {
  return question.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'query';
}

function indexMemoryEvidence(memory: HomeMemory): Map<string, MemoryEvidence> {
  const evidence = [
    ...memory.recentEvents,
    ...Object.values(memory.rooms).flatMap((room) => room.recentEvents),
    ...Object.values(memory.devices).flatMap((device) => device.recentEvents),
    ...Object.values(memory.fields).flatMap((field) => field.recentEvents)
  ];
  return new Map(evidence.map((entry) => [entry.id, entry]));
}

function createSectionSummary(emptySummary: string, hypotheses: ProfileHypothesis[]): string {
  if (hypotheses.length === 0) {
    return emptySummary;
  }
  return hypotheses
    .slice()
    .sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id))
    .slice(0, 2)
    .map((hypothesis) => hypothesis.summary)
    .join(' ');
}

function matchesRoomQuery(roomId: string, query: Pick<MemoryEntityQuery, 'roomId'>): boolean {
  return !query.roomId || roomId === query.roomId;
}

function toHypothesisSummary(hypothesis: ProfileHypothesis): Pick<ProfileHypothesis, 'id' | 'type' | 'label' | 'summary' | 'confidence' | 'updatedAt' | 'subjectIds'> & { evidenceCount: number } {
  return {
    id: hypothesis.id,
    type: hypothesis.type,
    label: hypothesis.label,
    summary: hypothesis.summary,
    confidence: hypothesis.confidence,
    updatedAt: hypothesis.updatedAt,
    subjectIds: hypothesis.subjectIds,
    evidenceCount: hypothesis.evidence.length
  };
}

function profileConclusionFromClaim(
  claim: HomeProfileClaim,
  evidenceIndex: Map<string, MemoryEvidence>,
  query: Pick<MemoryProfileConclusionQuery, 'includeEvidence' | 'includeReasoning'>
): MemoryProfileConclusion {
  const evidenceIds = unique([
    ...claim.supports.flatMap((support) => support.evidenceIds),
    ...claim.contradictions.flatMap((contradiction) => contradiction.evidenceIds)
  ]);
  const evidence = evidenceIds
    .map((evidenceId) => evidenceIndex.get(evidenceId))
    .filter((entry): entry is MemoryEvidence => Boolean(entry));

  return {
    id: claim.id,
    source: 'claim',
    topic: topicForProfileConclusion(claim.id, claim.type, claim.conclusion),
    type: claim.type,
    label: claim.label,
    conclusion: claim.conclusion,
    status: claim.status,
    confidence: claim.confidence,
    updatedAt: claim.scope.dateRange.to,
    subjectIds: [],
    evidenceCount: evidenceIds.length,
    supports: claim.supports,
    contradictions: claim.contradictions,
    missingEvidence: [...claim.missingEvidence],
    alternativeExplanations: [...claim.alternativeExplanations],
    ...(query.includeEvidence ? { evidence } : {}),
    ...(query.includeReasoning ? { reasoningSteps: [...claim.reasoningSteps] } : {})
  };
}

function profileConclusionFromHypothesis(
  hypothesis: ProfileHypothesis,
  query: Pick<MemoryProfileConclusionQuery, 'includeEvidence' | 'includeReasoning'>
): MemoryProfileConclusion {
  return {
    id: hypothesis.id,
    source: 'hypothesis',
    topic: topicForProfileConclusion(hypothesis.id, hypothesis.type, hypothesis.summary),
    type: hypothesis.type,
    label: hypothesis.label,
    conclusion: hypothesis.summary,
    status: hypothesis.status,
    confidence: hypothesis.confidence,
    updatedAt: hypothesis.updatedAt,
    subjectIds: [...hypothesis.subjectIds],
    evidenceCount: hypothesis.evidence.length,
    supports: hypothesis.supports,
    contradictions: hypothesis.contradictions,
    missingEvidence: [...hypothesis.missingEvidence],
    alternativeExplanations: [...hypothesis.alternativeExplanations],
    ...(query.includeEvidence ? { evidence: hypothesis.evidence.slice(0, 20) } : {}),
    ...(query.includeReasoning ? { reasoningSteps: [...hypothesis.reasoningSteps] } : {})
  };
}

function topicForProfileConclusion(id: string, type: ProfileHypothesisType, text: string): MemoryProfileConclusionTopic {
  const searchable = `${id} ${type} ${text}`.toLowerCase();
  if (type === 'automation_recommendation') {
    return 'automation';
  }
  if (type === 'household_size' || type === 'household_composition' || id.includes(':household:') || id.startsWith('household:')) {
    return 'household';
  }
  if (type === 'resident_slot') {
    return 'resident';
  }
  if (type === 'presence_signal') {
    return 'presence';
  }
  if (type === 'room_function' || type === 'room_habit') {
    return 'room';
  }
  if (type === 'device_contribution') {
    return 'device';
  }
  if (type === 'state_anomaly') {
    return 'uncertainty';
  }
  if (searchable.includes('pet')) {
    return 'pet';
  }
  return 'routine';
}

function matchProfileQuestion(question: string): MemoryProfileAnswer['matchedQuery'] {
  const normalized = question.toLowerCase();
  const rules: Array<{
    topic: MemoryProfileConclusionTopic;
    type?: ProfileHypothesisType;
    terms: string[];
  }> = [
    {
      topic: 'pet',
      terms: ['宠物', '狗', '猫', 'pet', 'dog', 'cat']
    },
    {
      topic: 'automation',
      type: 'automation_recommendation',
      terms: ['自动化', '推荐', '场景', 'automation', '厨房安全', '油烟', '炉灶', 'stove', 'range hood']
    },
    {
      topic: 'household',
      terms: ['几个人', '多少人', '家庭组成', '居民数量', '住户', '家庭成员', 'resident', 'household composition', 'household size']
    },
    {
      topic: 'presence',
      type: 'presence_signal',
      terms: ['有人', '在家', 'presence', 'occupied', 'occupancy']
    },
    {
      topic: 'room',
      terms: ['房间', '空间', 'room']
    },
    {
      topic: 'device',
      terms: ['设备', 'device']
    }
  ];

  for (const rule of rules) {
    const matchedTerms = rule.terms.filter((term) => normalized.includes(term.toLowerCase()));
    if (matchedTerms.length > 0) {
      return {
        topic: rule.topic,
        ...(rule.type ? { type: rule.type } : {}),
        includeEvidence: true,
        includeReasoning: true,
        matchStrategy: 'deterministic_keyword',
        matchedTerms
      };
    }
  }

  return {
    topic: 'household',
    includeEvidence: true,
    includeReasoning: true,
    matchStrategy: 'fallback',
    matchedTerms: []
  };
}

function createProfileAnswerText(
  question: string,
  matchedQuery: MemoryProfileAnswer['matchedQuery'],
  conclusions: MemoryProfileConclusion[],
  missingEvidence: string[],
  alternatives: string[]
): string {
  if (conclusions.length === 0) {
    return `没有找到足够的 Home Memory 结论来回答“${question}”。当前匹配到 ${matchedQuery.topic} 主题，但缺少可支持的画像结论。`;
  }

  const conclusionText = conclusions
    .slice(0, 3)
    .map((conclusion) => conclusion.conclusion)
    .join(' ');
  const primary = conclusions[0];
  const uncertaintyText = missingEvidence.length > 0
    ? ` 缺失证据：${missingEvidence.slice(0, 2).join('；')}。`
    : '';
  const alternativeText = alternatives.length > 0
    ? ` 其他可能解释：${alternatives.slice(0, 2).join('；')}。`
    : '';

  if (primary.status === 'candidate') {
    return `有弱候选，但不能确认。${conclusionText}${uncertaintyText}${alternativeText}`;
  }
  if (primary.status === 'rejected') {
    return `当前结论不支持这个判断。${conclusionText}${uncertaintyText}${alternativeText}`;
  }
  return `根据当前 Home Memory，可以给出 ${primary.status} 级别的回答：${conclusionText}${uncertaintyText}${alternativeText}`;
}

function rankProfileAnswerConclusions(
  conclusions: MemoryProfileConclusion[],
  query: Pick<MemoryProfileConclusionQuery, 'topic'>
): MemoryProfileConclusion[] {
  return conclusions.slice().sort((left, right) => (
    answerTypePriority(left, query) - answerTypePriority(right, query) ||
    right.confidence - left.confidence ||
    left.id.localeCompare(right.id)
  ));
}

function answerTypePriority(conclusion: MemoryProfileConclusion, query: Pick<MemoryProfileConclusionQuery, 'topic'>): number {
  if (query.topic === 'household') {
    if (conclusion.type === 'household_composition') {
      return 0;
    }
    if (conclusion.type === 'household_size') {
      return 1;
    }
  }
  if (query.topic === 'automation' && conclusion.type === 'automation_recommendation') {
    return 0;
  }
  if (query.topic === 'pet' && conclusion.id.includes('pet')) {
    return 0;
  }
  return 10;
}

function createHypothesisReliability(hypothesis: ProfileHypothesis): {
  evidenceCount: number;
  supportingEvidenceCount: number;
  contradictingEvidenceCount: number;
  missingEvidence: string[];
  unsupportedClaimCount: number;
  explanationSource: 'rule_template' | 'llm_enrichment' | 'mixed';
} {
  return {
    evidenceCount: hypothesis.evidence.length,
    supportingEvidenceCount: hypothesis.supportingEvidence.length,
    contradictingEvidenceCount: hypothesis.contradictingEvidence.length,
    missingEvidence: [...hypothesis.missingEvidence],
    unsupportedClaimCount: 0,
    explanationSource: 'rule_template'
  };
}

function createHypothesisExplanationPrompt(hypothesis: ProfileHypothesis): string {
  return JSON.stringify({
    purpose: 'hypothesis_explanation',
    hypothesisId: hypothesis.id,
    type: hypothesis.type,
    confidence: hypothesis.confidence,
    evidenceIds: hypothesis.evidence.map((evidence) => evidence.id)
  });
}

function createHypothesisReliabilityReviewPrompt(hypothesis: ProfileHypothesis): string {
  return JSON.stringify({
    purpose: 'reliability_review',
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

function collectSemanticCandidateWindows(
  memory: HomeMemory,
  options: { minEvidenceCount: number; limit: number }
): SemanticCandidateWindow[] {
  const signalTypesByEvidenceId = new Map<string, string[]>();
  for (const signal of memory.semanticSignals) {
    for (const evidenceId of signal.sourceEvidenceIds) {
      signalTypesByEvidenceId.set(evidenceId, unique([...(signalTypesByEvidenceId.get(evidenceId) ?? []), signal.type]));
    }
  }

  const groups = new Map<string, MemoryEvidence[]>();
  for (const evidence of memory.recentEvents) {
    if (evidence.profileWeight <= 0 || evidence.evidenceCategory === 'system_status' || evidence.evidenceCategory === 'environment_context') {
      continue;
    }
    const key = `${evidence.roomId}\u0000${evidence.timeBucket}`;
    groups.set(key, [...(groups.get(key) ?? []), evidence]);
  }

  return [...groups.values()]
    .filter((evidence) => evidence.length >= options.minEvidenceCount)
    .map((evidence) => {
      const sortedEvidence = evidence
        .slice()
        .sort((left, right) => right.sequence - left.sequence || right.id.localeCompare(left.id));
      const evidenceIds = sortedEvidence.map((entry) => entry.id);
      const roomId = sortedEvidence[0]?.roomId ?? '';
      const timeBucket = sortedEvidence[0]?.timeBucket ?? 'daytime';
      return {
        id: `semantic-window:${roomId}:${timeBucket}:${evidenceIds.join(':')}`,
        homeId: memory.homeId ?? sortedEvidence[0]?.homeId ?? '',
        runId: memory.runId ?? sortedEvidence[0]?.runId ?? '',
        roomId,
        timeBucket,
        evidenceIds,
        deviceIds: unique(sortedEvidence.map((entry) => entry.deviceId)),
        deterministicSignalTypes: unique(evidenceIds.flatMap((evidenceId) => signalTypesByEvidenceId.get(evidenceId) ?? []))
      };
    })
    .sort((left, right) => right.evidenceIds.length - left.evidenceIds.length || left.id.localeCompare(right.id))
    .slice(0, options.limit);
}

function createSemanticCandidateHypothesis(memory: HomeMemory, window: SemanticCandidateWindow): ProfileHypothesis {
  const evidenceIndex = indexMemoryEvidence(memory);
  const evidence = window.evidenceIds
    .map((evidenceId) => evidenceIndex.get(evidenceId))
    .filter((entry): entry is MemoryEvidence => Boolean(entry));
  return createProfileHypothesis({
    id: window.id,
    type: 'activity_cluster',
    label: `${window.roomId} semantic candidate`,
    summary: `${window.roomId} has ${evidence.length} related evidence items during ${window.timeBucket}; this is a candidate semantic interpretation only.`,
    confidence: roundConfidence(Math.min(0.6, 0.25 + evidence.length / 10)),
    updatedAt: newestTimestamp(evidence.map((entry) => entry.simTime)) ?? '',
    subjectIds: [`room:${window.roomId}`, ...window.deviceIds.map((deviceId) => `device:${deviceId}`)],
    evidence,
    supportingEvidence: evidence,
    contradictingEvidence: [],
    missingEvidence: ['More repeated evidence is needed before adding a deterministic semantic rule.']
  });
}

function createSemanticCandidatePrompt(window: SemanticCandidateWindow): string {
  return JSON.stringify({
    purpose: 'semantic_candidate',
    instruction: 'Return a candidate semantic interpretation only. Do not create facts, residents, controls, or deterministic rules.',
    windowId: window.id,
    roomId: window.roomId,
    timeBucket: window.timeBucket,
    evidenceIds: window.evidenceIds,
    deviceIds: window.deviceIds,
    deterministicSignalTypes: window.deterministicSignalTypes
  });
}

function createBatchPlanItem(input: {
  config: HomeMemoryLlmConfig;
  purpose: HomeMemoryLlmPurpose;
  targetId: string;
  homeId: string;
  runId: string;
  evidenceIds: string[];
  hypothesisId?: string;
  confidence?: number;
  llmCache?: HomeMemoryLlmCacheStore;
  callsThisHour?: number;
  callsToday?: number;
}): HomeMemoryLlmBatchPlanItem {
  const cacheKey = createHomeMemoryLlmCacheKey({
    purpose: input.purpose,
    homeId: input.homeId,
    runId: input.runId,
    hypothesisId: input.hypothesisId ?? input.targetId,
    evidenceIds: input.evidenceIds,
    model: input.config.provider.model,
    promptVersion: 1,
    schemaVersion: 1
  });
  const cached = Boolean(input.llmCache?.get(cacheKey));
  const decision = decideHomeMemoryLlmInvocation({
    config: input.config,
    purpose: input.purpose,
    homeId: input.homeId,
    runId: input.runId,
    trigger: 'batch',
    hypothesisId: input.hypothesisId ?? input.targetId,
    confidence: input.confidence,
    evidenceIds: input.evidenceIds,
    cached,
    callsThisHour: input.callsThisHour,
    callsToday: input.callsToday
  });

  return {
    purpose: input.purpose,
    trigger: 'batch',
    targetId: input.targetId,
    evidenceIds: [...input.evidenceIds],
    cacheKey: decision.cacheKey,
    shouldCall: decision.shouldCall,
    reason: decision.reason,
    maxTokens: decision.maxTokens,
    priority: decision.priority,
    cached
  };
}

function createPortraitBatchPlanItem(
  memory: HomeMemory,
  config: HomeMemoryLlmConfig,
  options: MemoryHypothesisQueryOptions,
  summaryPeriod: HouseholdPortraitSummaryPeriod
): HomeMemoryLlmBatchPlanItem {
  const portrait = createHouseholdPortrait(memory);
  const hypothesis = createPortraitSummaryHypothesis(memory, portrait, summaryPeriod);
  return createBatchPlanItem({
    config,
    purpose: 'daily_portrait_summary',
    targetId: hypothesis.id,
    homeId: memory.homeId ?? '',
    runId: memory.runId ?? '',
    hypothesisId: hypothesis.id,
    evidenceIds: hypothesis.evidence.map((evidence) => evidence.id),
    confidence: hypothesis.confidence,
    llmCache: options.llmCache,
    callsThisHour: options.llmUsage?.callsThisHour(memory.homeId ?? ''),
    callsToday: options.llmUsage?.callsToday(memory.homeId ?? '')
  });
}

function portraitSummaryPeriodFromTarget(targetId: string): HouseholdPortraitSummaryPeriod {
  return targetId.includes(':weekly-summary') ? 'weekly' : 'daily';
}

function newestTimestamp(values: string[]): string | null {
  return values.length > 0 ? values.slice().sort((left, right) => right.localeCompare(left))[0] : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function ratioValue(numerator: number, denominator: number): number {
  return denominator > 0 ? roundConfidence(numerator / denominator) : 1;
}

function roundConfidence(value: number): number {
  return Number(value.toFixed(3));
}

function plural(count: number): string {
  return count === 1 ? '' : 's';
}

function compareByUpdatedSimTimeDesc(left: MemoryEpisode, right: MemoryEpisode): number {
  return right.updatedSimTime.localeCompare(left.updatedSimTime) || left.id.localeCompare(right.id);
}
