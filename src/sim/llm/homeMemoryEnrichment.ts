import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { HomeMemory, MemoryEvidence } from '../../web/homeMemoryModel';
import type { ProfileHypothesis } from '../../web/homeProfiler';

export type HomeMemoryLlmPurpose =
  | 'unknown_schema_mapping'
  | 'semantic_candidate'
  | 'hypothesis_explanation'
  | 'reliability_review'
  | 'query_planning'
  | 'daily_portrait_summary';

export type HomeMemoryLlmTrigger = 'device_event' | 'window' | 'user_request' | 'batch';

export type HomeMemoryLlmEnrichmentType =
  | 'semantic_candidate'
  | 'hypothesis_explanation'
  | 'reliability_review'
  | 'query_plan'
  | 'portrait_summary';

export interface LlmProviderConfig {
  enabled: boolean;
  provider: 'openai-compatible';
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface HomeMemoryLlmConfig {
  provider: LlmProviderConfig;
  budget: {
    maxCallsPerHomePerHour: number;
    maxCallsPerHomePerDay: number;
    maxBatchSize: number;
  };
  gates: {
    minEvidenceCountForUnknownSchema: number;
    minConfidenceForReview: number;
    maxConfidenceForReview: number;
  };
}

export interface HomeMemoryLlmConfigSummary {
  provider: Omit<LlmProviderConfig, 'apiKey'> & {
    apiKeyConfigured: boolean;
  };
  budget: HomeMemoryLlmConfig['budget'];
  gates: HomeMemoryLlmConfig['gates'];
}

export interface HomeMemoryLlmConfigPatch {
  provider?: Partial<Omit<LlmProviderConfig, 'provider' | 'apiKey'>> & {
    apiKey?: string;
    clearApiKey?: boolean;
  };
  budget?: Partial<HomeMemoryLlmConfig['budget']>;
  gates?: Partial<HomeMemoryLlmConfig['gates']>;
}

export interface HomeMemoryLlmInvocationDecision {
  shouldCall: boolean;
  purpose: HomeMemoryLlmPurpose;
  reason: string;
  cacheKey: string;
  maxTokens: number;
  priority: 'low' | 'normal' | 'high';
}

export interface DecideHomeMemoryLlmInvocationInput {
  config: HomeMemoryLlmConfig;
  purpose: HomeMemoryLlmPurpose;
  homeId: string;
  runId: string;
  trigger: HomeMemoryLlmTrigger;
  evidenceIds: string[];
  hypothesisId?: string;
  confidence?: number;
  cached?: boolean;
  callsThisHour?: number;
  callsToday?: number;
}

export interface HomeMemoryLlmCacheKeyInput {
  purpose: HomeMemoryLlmPurpose;
  homeId: string;
  runId: string;
  evidenceIds: string[];
  hypothesisId?: string;
  model: string;
  promptVersion: number;
  schemaVersion: number;
}

export interface HomeMemoryLlmEnrichment {
  id: string;
  purpose: HomeMemoryLlmPurpose;
  claim: string;
  type: HomeMemoryLlmEnrichmentType;
  confidence: number;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  missingEvidence: string[];
  alternatives: Array<{
    claim: string;
    confidence: number;
    evidenceIds: string[];
  }>;
  metadata: {
    model: string;
    baseUrlHash: string;
    promptVersion: 1;
    schemaVersion: 1;
    inputHash: string;
    outputHash: string;
    createdAt: string;
  };
}

export type HomeMemoryLlmEnrichmentParseResult =
  | { ok: true; enrichment: HomeMemoryLlmEnrichment }
  | { ok: false; errors: string[] };

export interface ParseHomeMemoryLlmEnrichmentInput {
  jsonText: string;
  model: string;
  baseUrl: string;
  prompt: string;
  memory: HomeMemory;
}

export interface DeterministicHomeMemoryLlmEnrichmentInput {
  purpose: HomeMemoryLlmPurpose;
  hypothesis: ProfileHypothesis;
  evidenceIds: string[];
  prompt: string;
  baseUrl: string;
}

export type HomeMemoryLlmFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface RequestHomeMemoryLlmEnrichmentInput {
  config: HomeMemoryLlmConfig;
  purpose: HomeMemoryLlmPurpose;
  trigger: HomeMemoryLlmTrigger;
  prompt: string;
  memory: HomeMemory;
  hypothesis: ProfileHypothesis;
  fetcher?: HomeMemoryLlmFetch;
  cached?: HomeMemoryLlmEnrichment;
  callsThisHour?: number;
  callsToday?: number;
}

export interface RequestHomeMemoryLlmEnrichmentResult {
  source: 'cache' | 'llm' | 'deterministic-fallback';
  cacheKey: string;
  enrichment: HomeMemoryLlmEnrichment;
  errors: string[];
}

export interface HomeMemoryLlmStreamEvent {
  event: 'decision' | 'cache' | 'provider_delta' | 'fallback';
  data: Record<string, unknown>;
}

export interface RequestHomeMemoryLlmStreamingInput extends RequestHomeMemoryLlmEnrichmentInput {
  onEvent?: (event: HomeMemoryLlmStreamEvent) => void;
}

export interface UnknownSchemaCandidate {
  id: string;
  homeId: string;
  runId: string;
  deviceType: string;
  field: string;
  deviceIds: string[];
  roomIds: string[];
  evidenceIds: string[];
  observedValues: Array<string | number | boolean | null>;
}

export interface UnknownSchemaCandidateOptions {
  minEvidenceCount?: number;
}

export interface RequestUnknownSchemaMappingInput {
  config: HomeMemoryLlmConfig;
  memory: HomeMemory;
  candidate: UnknownSchemaCandidate;
  fetcher?: HomeMemoryLlmFetch;
  cached?: HomeMemoryLlmEnrichment;
  callsThisHour?: number;
  callsToday?: number;
}

const DEFAULT_CONFIG: HomeMemoryLlmConfig = {
  provider: {
    enabled: false,
    provider: 'openai-compatible',
    baseUrl: '',
    model: 'home-memory-llm',
    timeoutMs: 15000,
    maxRetries: 1
  },
  budget: {
    maxCallsPerHomePerHour: 10,
    maxCallsPerHomePerDay: 50,
    maxBatchSize: 8
  },
  gates: {
    minEvidenceCountForUnknownSchema: 2,
    minConfidenceForReview: 0.3,
    maxConfidenceForReview: 0.75
  }
};

const purposeSchema = z.enum([
  'unknown_schema_mapping',
  'semantic_candidate',
  'hypothesis_explanation',
  'reliability_review',
  'query_planning',
  'daily_portrait_summary'
]);

const enrichmentTypeSchema = z.enum([
  'semantic_candidate',
  'hypothesis_explanation',
  'reliability_review',
  'query_plan',
  'portrait_summary'
]);

const rawEnrichmentSchema = z.object({
  purpose: purposeSchema,
  claim: z.string().min(1),
  type: enrichmentTypeSchema,
  confidence: z.number().min(0).max(1),
  supportingEvidenceIds: z.array(z.string().min(1)),
  contradictingEvidenceIds: z.array(z.string().min(1)).default([]),
  missingEvidence: z.array(z.string().min(1)).default([]),
  alternatives: z.array(z.object({
    claim: z.string().min(1),
    confidence: z.number().min(0).max(1),
    evidenceIds: z.array(z.string().min(1))
  })).default([])
});

export function resolveHomeMemoryLlmConfig(env: Record<string, string | undefined> = process.env): HomeMemoryLlmConfig {
  const baseUrl = env.HOME_MEMORY_LLM_BASE_URL?.trim() ?? '';
  const model = env.HOME_MEMORY_LLM_MODEL?.trim() || DEFAULT_CONFIG.provider.model;
  const enabled = env.HOME_MEMORY_LLM_ENABLED === 'true' && baseUrl.length > 0;

  return {
    provider: {
      enabled,
      provider: 'openai-compatible',
      baseUrl,
      apiKey: env.HOME_MEMORY_LLM_API_KEY,
      model,
      timeoutMs: parsePositiveInteger(env.HOME_MEMORY_LLM_TIMEOUT_MS) ?? DEFAULT_CONFIG.provider.timeoutMs,
      maxRetries: parseNonNegativeInteger(env.HOME_MEMORY_LLM_MAX_RETRIES) ?? DEFAULT_CONFIG.provider.maxRetries
    },
    budget: {
      maxCallsPerHomePerHour: parsePositiveInteger(env.HOME_MEMORY_LLM_MAX_CALLS_PER_HOME_PER_HOUR) ?? DEFAULT_CONFIG.budget.maxCallsPerHomePerHour,
      maxCallsPerHomePerDay: parsePositiveInteger(env.HOME_MEMORY_LLM_MAX_CALLS_PER_HOME_PER_DAY) ?? DEFAULT_CONFIG.budget.maxCallsPerHomePerDay,
      maxBatchSize: parsePositiveInteger(env.HOME_MEMORY_LLM_MAX_BATCH_SIZE) ?? DEFAULT_CONFIG.budget.maxBatchSize
    },
    gates: {
      minEvidenceCountForUnknownSchema: parsePositiveInteger(env.HOME_MEMORY_LLM_MIN_EVIDENCE_COUNT_FOR_UNKNOWN_SCHEMA) ?? DEFAULT_CONFIG.gates.minEvidenceCountForUnknownSchema,
      minConfidenceForReview: parseRatio(env.HOME_MEMORY_LLM_MIN_CONFIDENCE_FOR_REVIEW) ?? DEFAULT_CONFIG.gates.minConfidenceForReview,
      maxConfidenceForReview: parseRatio(env.HOME_MEMORY_LLM_MAX_CONFIDENCE_FOR_REVIEW) ?? DEFAULT_CONFIG.gates.maxConfidenceForReview
    }
  };
}

export function summarizeHomeMemoryLlmConfig(config: HomeMemoryLlmConfig): HomeMemoryLlmConfigSummary {
  return {
    provider: {
      enabled: config.provider.enabled,
      provider: config.provider.provider,
      baseUrl: config.provider.baseUrl,
      model: config.provider.model,
      timeoutMs: config.provider.timeoutMs,
      maxRetries: config.provider.maxRetries,
      apiKeyConfigured: Boolean(config.provider.apiKey)
    },
    budget: { ...config.budget },
    gates: { ...config.gates }
  };
}

export function applyHomeMemoryLlmConfigPatch(
  current: HomeMemoryLlmConfig,
  patch: HomeMemoryLlmConfigPatch
): HomeMemoryLlmConfig {
  const providerPatch = patch.provider ?? {};
  const apiKey = providerPatch.clearApiKey
    ? undefined
    : providerPatch.apiKey && providerPatch.apiKey.trim().length > 0
      ? providerPatch.apiKey.trim()
      : current.provider.apiKey;

  return {
    provider: {
      enabled: providerPatch.enabled ?? current.provider.enabled,
      provider: 'openai-compatible',
      baseUrl: providerPatch.baseUrl?.trim() ?? current.provider.baseUrl,
      model: providerPatch.model?.trim() || current.provider.model,
      apiKey,
      timeoutMs: providerPatch.timeoutMs ?? current.provider.timeoutMs,
      maxRetries: providerPatch.maxRetries ?? current.provider.maxRetries
    },
    budget: {
      maxCallsPerHomePerHour: patch.budget?.maxCallsPerHomePerHour ?? current.budget.maxCallsPerHomePerHour,
      maxCallsPerHomePerDay: patch.budget?.maxCallsPerHomePerDay ?? current.budget.maxCallsPerHomePerDay,
      maxBatchSize: patch.budget?.maxBatchSize ?? current.budget.maxBatchSize
    },
    gates: {
      minEvidenceCountForUnknownSchema: patch.gates?.minEvidenceCountForUnknownSchema ?? current.gates.minEvidenceCountForUnknownSchema,
      minConfidenceForReview: patch.gates?.minConfidenceForReview ?? current.gates.minConfidenceForReview,
      maxConfidenceForReview: patch.gates?.maxConfidenceForReview ?? current.gates.maxConfidenceForReview
    }
  };
}

export function decideHomeMemoryLlmInvocation(input: DecideHomeMemoryLlmInvocationInput): HomeMemoryLlmInvocationDecision {
  const baseDecision = baseInvocationDecision(input);

  if (!input.config.provider.enabled || input.config.provider.baseUrl.length === 0) {
    return { ...baseDecision, reason: 'LLM provider is disabled or missing baseUrl.' };
  }
  if (input.trigger === 'device_event') {
    return { ...baseDecision, reason: 'Single device event triggers do not call LLM.' };
  }
  if (input.evidenceIds.length === 0) {
    return { ...baseDecision, reason: 'LLM enrichment requires evidence IDs.' };
  }
  if (input.cached) {
    return { ...baseDecision, reason: 'Cache hit; no LLM call needed.' };
  }
  if ((input.callsThisHour ?? 0) >= input.config.budget.maxCallsPerHomePerHour) {
    return { ...baseDecision, reason: 'Hourly budget exhausted.' };
  }
  if ((input.callsToday ?? 0) >= input.config.budget.maxCallsPerHomePerDay) {
    return { ...baseDecision, reason: 'Daily budget exhausted.' };
  }
  if (input.purpose === 'unknown_schema_mapping' && input.evidenceIds.length < input.config.gates.minEvidenceCountForUnknownSchema) {
    return { ...baseDecision, reason: 'Unknown schema evidence has not reached the minimum stable window.' };
  }
  if (input.purpose === 'reliability_review') {
    const confidence = input.confidence ?? 0;
    if (confidence < input.config.gates.minConfidenceForReview || confidence > input.config.gates.maxConfidenceForReview) {
      return { ...baseDecision, reason: 'Hypothesis confidence is outside review band.' };
    }
  }

  return {
    ...baseDecision,
    shouldCall: true,
    reason: 'LLM call allowed by gatekeeper.'
  };
}

export function createHomeMemoryLlmCacheKey(input: HomeMemoryLlmCacheKeyInput): string {
  return shortHash(stableStringify({
    purpose: input.purpose,
    homeId: input.homeId,
    runId: input.runId,
    hypothesisId: input.hypothesisId ?? null,
    evidenceIds: [...input.evidenceIds].sort((left, right) => left.localeCompare(right)),
    model: input.model,
    promptVersion: input.promptVersion,
    schemaVersion: input.schemaVersion
  }));
}

export function collectUnknownSchemaCandidates(
  memory: HomeMemory,
  options: UnknownSchemaCandidateOptions = {}
): UnknownSchemaCandidate[] {
  const minEvidenceCount = options.minEvidenceCount ?? DEFAULT_CONFIG.gates.minEvidenceCountForUnknownSchema;
  const groups = new Map<string, MemoryEvidence[]>();
  for (const evidence of memory.recentEvents) {
    if (evidence.capability.type !== 'generic_device_state') {
      continue;
    }
    const key = `${evidence.deviceType}:${evidence.field}`;
    groups.set(key, [...(groups.get(key) ?? []), evidence]);
  }

  return [...groups.entries()]
    .map(([key, evidence]) => {
      const [deviceType, field] = key.split(':');
      return {
        id: `schema:${deviceType}:${field}`,
        homeId: memory.homeId ?? evidence[0]?.homeId ?? '',
        runId: memory.runId ?? evidence[0]?.runId ?? '',
        deviceType,
        field,
        deviceIds: sortedUnique(evidence.map((entry) => entry.deviceId)),
        roomIds: sortedUnique(evidence.map((entry) => entry.roomId)),
        evidenceIds: evidence.map((entry) => entry.id),
        observedValues: [...new Set(evidence.map((entry) => entry.value))]
      };
    })
    .filter((candidate) => candidate.evidenceIds.length >= minEvidenceCount)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function parseHomeMemoryLlmEnrichmentJson(input: ParseHomeMemoryLlmEnrichmentInput): HomeMemoryLlmEnrichmentParseResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(input.jsonText);
  } catch (error) {
    return { ok: false, errors: [`invalid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }

  const parsed = rawEnrichmentSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) };
  }

  const errors = validateEnrichmentBoundary(parsed.data, input.memory);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const output = parsed.data;
  const enrichmentPayload = {
    purpose: output.purpose,
    claim: output.claim,
    type: output.type,
    confidence: output.confidence,
    supportingEvidenceIds: output.supportingEvidenceIds,
    contradictingEvidenceIds: output.contradictingEvidenceIds,
    missingEvidence: output.missingEvidence,
    alternatives: output.alternatives
  };

  return {
    ok: true,
    enrichment: {
      id: `home-memory-llm:${output.purpose}:${shortHash(stableStringify(enrichmentPayload))}`,
      ...enrichmentPayload,
      metadata: {
        model: input.model,
        baseUrlHash: shortHash(input.baseUrl),
        promptVersion: 1,
        schemaVersion: 1,
        inputHash: shortHash(input.prompt),
        outputHash: shortHash(stableStringify(enrichmentPayload)),
        createdAt: new Date(0).toISOString()
      }
    }
  };
}

export async function requestHomeMemoryLlmEnrichment(input: RequestHomeMemoryLlmEnrichmentInput): Promise<RequestHomeMemoryLlmEnrichmentResult> {
  const evidenceIds = input.hypothesis.evidence.map((evidence) => evidence.id);
  const cacheKey = createHomeMemoryLlmCacheKey({
    purpose: input.purpose,
    homeId: input.memory.homeId ?? '',
    runId: input.memory.runId ?? '',
    hypothesisId: input.hypothesis.id,
    evidenceIds,
    model: input.config.provider.model,
    promptVersion: 1,
    schemaVersion: 1
  });

  const cachedErrors = input.cached
    ? validateCachedEnrichment({
      cached: input.cached,
      memory: input.memory,
      expectedPurpose: input.purpose,
      maxConfidence: input.hypothesis.confidence
    })
    : [];
  if (input.cached && cachedErrors.length === 0) {
    return {
      source: 'cache',
      cacheKey,
      enrichment: structuredClone(input.cached),
      errors: []
    };
  }

  const fallback = () => createDeterministicHomeMemoryLlmEnrichment({
    purpose: input.purpose,
    hypothesis: input.hypothesis,
    evidenceIds,
    prompt: input.prompt,
    baseUrl: input.config.provider.baseUrl
  });

  const decision = decideHomeMemoryLlmInvocation({
    config: input.config,
    purpose: input.purpose,
    homeId: input.memory.homeId ?? '',
    runId: input.memory.runId ?? '',
    trigger: input.trigger,
    hypothesisId: input.hypothesis.id,
    confidence: input.hypothesis.confidence,
    evidenceIds,
    callsThisHour: input.callsThisHour,
    callsToday: input.callsToday
  });

  if (!decision.shouldCall) {
    return {
      source: 'deterministic-fallback',
      cacheKey,
      enrichment: fallback(),
      errors: [...cachedErrors, decision.reason]
    };
  }

  const errors: string[] = [...cachedErrors];
  const fetcher = input.fetcher ?? fetch;
  for (let attempt = 0; attempt <= input.config.provider.maxRetries; attempt += 1) {
    try {
      const jsonText = await requestOpenAiCompatibleJson({
        config: input.config,
        prompt: input.prompt,
        fetcher
      });
      const parsed = parseHomeMemoryLlmEnrichmentJson({
        jsonText,
        model: input.config.provider.model,
        baseUrl: input.config.provider.baseUrl,
        prompt: input.prompt,
        memory: input.memory
      });
      if (parsed.ok) {
        if (parsed.enrichment.confidence > input.hypothesis.confidence) {
          errors.push('LLM enrichment confidence cannot exceed baseline confidence.');
          logHomeMemoryLlm('warn', 'validator_rejected', { reason: 'confidence exceeds baseline', purpose: input.purpose });
          break;
        }
        logHomeMemoryLlm('debug', 'validator_passed', { purpose: input.purpose, supportingEvidenceCount: parsed.enrichment.supportingEvidenceIds.length });
        return {
          source: 'llm',
          cacheKey,
          enrichment: parsed.enrichment,
          errors: []
        };
      }
      logHomeMemoryLlm('warn', 'validator_rejected', { purpose: input.purpose, errors: parsed.errors });
      errors.push(...parsed.errors);
      break;
    } catch (error) {
      logHomeMemoryLlm('warn', 'provider_request_error', { purpose: input.purpose, error: errorMessage(error) });
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    source: 'deterministic-fallback',
    cacheKey,
    enrichment: fallback(),
    errors
  };
}

export async function requestHomeMemoryLlmEnrichmentStream(input: RequestHomeMemoryLlmStreamingInput): Promise<RequestHomeMemoryLlmEnrichmentResult> {
  const evidenceIds = input.hypothesis.evidence.map((evidence) => evidence.id);
  const cacheKey = createHomeMemoryLlmCacheKey({
    purpose: input.purpose,
    homeId: input.memory.homeId ?? '',
    runId: input.memory.runId ?? '',
    hypothesisId: input.hypothesis.id,
    evidenceIds,
    model: input.config.provider.model,
    promptVersion: 1,
    schemaVersion: 1
  });

  const cachedErrors = input.cached
    ? validateCachedEnrichment({
      cached: input.cached,
      memory: input.memory,
      expectedPurpose: input.purpose,
      maxConfidence: input.hypothesis.confidence
    })
    : [];
  if (input.cached && cachedErrors.length === 0) {
    input.onEvent?.({ event: 'cache', data: { cacheKey, reason: 'Cache hit; no provider stream needed.' } });
    return {
      source: 'cache',
      cacheKey,
      enrichment: structuredClone(input.cached),
      errors: []
    };
  }

  const fallback = () => createDeterministicHomeMemoryLlmEnrichment({
    purpose: input.purpose,
    hypothesis: input.hypothesis,
    evidenceIds,
    prompt: input.prompt,
    baseUrl: input.config.provider.baseUrl
  });

  const decision = decideHomeMemoryLlmInvocation({
    config: input.config,
    purpose: input.purpose,
    homeId: input.memory.homeId ?? '',
    runId: input.memory.runId ?? '',
    trigger: input.trigger,
    hypothesisId: input.hypothesis.id,
    confidence: input.hypothesis.confidence,
    evidenceIds,
    callsThisHour: input.callsThisHour,
    callsToday: input.callsToday
  });
  input.onEvent?.({
    event: 'decision',
    data: {
      shouldCall: decision.shouldCall,
      reason: decision.reason,
      cacheKey: decision.cacheKey,
      purpose: decision.purpose
    }
  });

  if (!decision.shouldCall) {
    const errors = [...cachedErrors, decision.reason];
    logHomeMemoryLlm('debug', 'fallback', { purpose: input.purpose, reason: decision.reason, source: 'deterministic-fallback' });
    input.onEvent?.({ event: 'fallback', data: { reason: decision.reason, errors } });
    return {
      source: 'deterministic-fallback',
      cacheKey,
      enrichment: fallback(),
      errors
    };
  }

  const errors: string[] = [...cachedErrors];
  const fetcher = input.fetcher ?? fetch;
  for (let attempt = 0; attempt <= input.config.provider.maxRetries; attempt += 1) {
    try {
      const jsonText = await requestOpenAiCompatibleJsonStream({
        config: input.config,
        prompt: input.prompt,
        fetcher,
        onDelta: (content) => input.onEvent?.({ event: 'provider_delta', data: { content } })
      });
      const parsed = parseHomeMemoryLlmEnrichmentJson({
        jsonText,
        model: input.config.provider.model,
        baseUrl: input.config.provider.baseUrl,
        prompt: input.prompt,
        memory: input.memory
      });
      if (parsed.ok) {
        if (parsed.enrichment.confidence > input.hypothesis.confidence) {
          errors.push('LLM enrichment confidence cannot exceed baseline confidence.');
          logHomeMemoryLlm('warn', 'validator_rejected', { reason: 'confidence exceeds baseline', purpose: input.purpose });
          break;
        }
        logHomeMemoryLlm('debug', 'validator_passed', { purpose: input.purpose, supportingEvidenceCount: parsed.enrichment.supportingEvidenceIds.length });
        return {
          source: 'llm',
          cacheKey,
          enrichment: parsed.enrichment,
          errors: []
        };
      }
      logHomeMemoryLlm('warn', 'validator_rejected', { purpose: input.purpose, errors: parsed.errors });
      errors.push(...parsed.errors);
      break;
    } catch (error) {
      logHomeMemoryLlm('warn', 'provider_request_error', { purpose: input.purpose, error: errorMessage(error) });
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  logHomeMemoryLlm('debug', 'fallback', { purpose: input.purpose, reason: 'Provider stream failed validation or request handling.', source: 'deterministic-fallback' });
  input.onEvent?.({ event: 'fallback', data: { reason: 'Provider stream failed validation or request handling.', errors } });
  return {
    source: 'deterministic-fallback',
    cacheKey,
    enrichment: fallback(),
    errors
  };
}

export async function requestUnknownSchemaMapping(input: RequestUnknownSchemaMappingInput): Promise<RequestHomeMemoryLlmEnrichmentResult> {
  const cacheKey = createHomeMemoryLlmCacheKey({
    purpose: 'unknown_schema_mapping',
    homeId: input.candidate.homeId,
    runId: input.candidate.runId,
    hypothesisId: input.candidate.id,
    evidenceIds: input.candidate.evidenceIds,
    model: input.config.provider.model,
    promptVersion: 1,
    schemaVersion: 1
  });

  const cachedErrors = input.cached
    ? validateCachedEnrichment({
      cached: input.cached,
      memory: input.memory,
      expectedPurpose: 'unknown_schema_mapping'
    })
    : [];
  if (input.cached && cachedErrors.length === 0) {
    return {
      source: 'cache',
      cacheKey,
      enrichment: structuredClone(input.cached),
      errors: []
    };
  }

  const fallback = (): HomeMemoryLlmEnrichment => {
    const payload = {
      purpose: 'unknown_schema_mapping' as const,
      claim: `${input.candidate.deviceType}.${input.candidate.field} needs manual review before becoming a deterministic mapping.`,
      type: 'semantic_candidate' as const,
      confidence: 0.1,
      supportingEvidenceIds: [...input.candidate.evidenceIds],
      contradictingEvidenceIds: [],
      missingEvidence: ['Manual review is required before adding this mapping to deterministic rules.'],
      alternatives: []
    };
    return {
      id: `home-memory-llm:unknown_schema_mapping:${input.candidate.id}:fallback`,
      ...payload,
      metadata: {
        model: 'deterministic-fallback',
        baseUrlHash: shortHash(input.config.provider.baseUrl),
        promptVersion: 1,
        schemaVersion: 1,
        inputHash: shortHash(createUnknownSchemaPrompt(input.candidate)),
        outputHash: shortHash(stableStringify(payload)),
        createdAt: new Date(0).toISOString()
      }
    };
  };

  const decision = decideHomeMemoryLlmInvocation({
    config: input.config,
    purpose: 'unknown_schema_mapping',
    homeId: input.candidate.homeId,
    runId: input.candidate.runId,
    trigger: 'window',
    hypothesisId: input.candidate.id,
    evidenceIds: input.candidate.evidenceIds,
    callsThisHour: input.callsThisHour,
    callsToday: input.callsToday
  });

  if (!decision.shouldCall) {
    return {
      source: 'deterministic-fallback',
      cacheKey,
      enrichment: fallback(),
      errors: [...cachedErrors, decision.reason]
    };
  }

  const prompt = createUnknownSchemaPrompt(input.candidate);
  const errors: string[] = [...cachedErrors];
  const fetcher = input.fetcher ?? fetch;
  for (let attempt = 0; attempt <= input.config.provider.maxRetries; attempt += 1) {
    try {
      const jsonText = await requestOpenAiCompatibleJson({
        config: input.config,
        prompt,
        fetcher
      });
      const parsed = parseHomeMemoryLlmEnrichmentJson({
        jsonText,
        model: input.config.provider.model,
        baseUrl: input.config.provider.baseUrl,
        prompt,
        memory: input.memory
      });
      if (parsed.ok) {
        return {
          source: 'llm',
          cacheKey,
          enrichment: parsed.enrichment,
          errors: []
        };
      }
      errors.push(...parsed.errors);
      break;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    source: 'deterministic-fallback',
    cacheKey,
    enrichment: fallback(),
    errors
  };
}

export function createDeterministicHomeMemoryLlmEnrichment(input: DeterministicHomeMemoryLlmEnrichmentInput): HomeMemoryLlmEnrichment {
  const payload = {
    purpose: input.purpose,
    claim: `${input.hypothesis.label}: ${input.hypothesis.summary}`,
    type: fallbackType(input.purpose),
    confidence: input.hypothesis.confidence,
    supportingEvidenceIds: [...input.evidenceIds],
    contradictingEvidenceIds: input.hypothesis.contradictingEvidence.map((evidence) => evidence.id),
    missingEvidence: [...input.hypothesis.missingEvidence],
    alternatives: []
  };

  return {
    id: `home-memory-llm:${input.purpose}:${input.hypothesis.id}:fallback`,
    ...payload,
    metadata: {
      model: 'deterministic-fallback',
      baseUrlHash: shortHash(input.baseUrl),
      promptVersion: 1,
      schemaVersion: 1,
      inputHash: shortHash(input.prompt),
      outputHash: shortHash(stableStringify(payload)),
      createdAt: new Date(0).toISOString()
    }
  };
}

async function requestOpenAiCompatibleJson(input: {
  config: HomeMemoryLlmConfig;
  prompt: string;
  fetcher: HomeMemoryLlmFetch;
}): Promise<string> {
  const url = `${input.config.provider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  logHomeMemoryLlm('debug', 'provider_request_start', {
    mode: 'json',
    host: providerHost(input.config.provider.baseUrl),
    model: input.config.provider.model,
    timeoutMs: input.config.provider.timeoutMs,
    maxRetries: input.config.provider.maxRetries,
    apiKeyConfigured: Boolean(input.config.provider.apiKey)
  });
  const response = await input.fetcher(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(input.config.provider.apiKey ? { authorization: `Bearer ${input.config.provider.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: input.config.provider.model,
      stream: false,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are an evidence-locked Home Memory reviewer. Return only JSON matching the requested schema. Do not add claims without evidence IDs.'
        },
        {
          role: 'user',
          content: input.prompt
        }
      ]
    })
  });
  logHomeMemoryLlm('debug', 'provider_response', {
    mode: 'json',
    status: response.status,
    contentType: response.headers.get('content-type') ?? 'unknown'
  });

  if (!response.ok) {
    throw new Error(`LLM provider request failed with status ${response.status}`);
  }

  const payload = await response.json() as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('LLM provider response did not include message content');
  }
  return content;
}

async function requestOpenAiCompatibleJsonStream(input: {
  config: HomeMemoryLlmConfig;
  prompt: string;
  fetcher: HomeMemoryLlmFetch;
  onDelta: (content: string) => void;
}): Promise<string> {
  const url = `${input.config.provider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  logHomeMemoryLlm('debug', 'provider_request_start', {
    mode: 'stream',
    host: providerHost(input.config.provider.baseUrl),
    model: input.config.provider.model,
    timeoutMs: input.config.provider.timeoutMs,
    maxRetries: input.config.provider.maxRetries,
    apiKeyConfigured: Boolean(input.config.provider.apiKey)
  });
  const response = await input.fetcher(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(input.config.provider.apiKey ? { authorization: `Bearer ${input.config.provider.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: input.config.provider.model,
      stream: true,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are an evidence-locked Home Memory reviewer. Return only JSON matching the requested schema. Do not add claims without evidence IDs.'
        },
        {
          role: 'user',
          content: input.prompt
        }
      ]
    })
  });
  logHomeMemoryLlm('debug', 'provider_response', {
    mode: 'stream',
    status: response.status,
    contentType: response.headers.get('content-type') ?? 'unknown'
  });

  if (!response.ok) {
    throw new Error(`LLM provider request failed with status ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    const payload = await response.json() as {
      choices?: Array<{
        message?: { content?: unknown };
      }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('LLM provider response did not include message content');
    }
    logHomeMemoryLlm('debug', 'provider_delta', { mode: 'json-fallback', chunkLength: content.length, totalLength: content.length });
    input.onDelta(content);
    return content;
  }

  const complete = await readOpenAiCompatibleSseContent(response, input.onDelta);
  if (complete.trim().length === 0) {
    throw new Error('LLM provider stream did not include content deltas');
  }
  return complete;
}

async function readOpenAiCompatibleSseContent(
  response: Response,
  onDelta: (content: string) => void
): Promise<string> {
  let complete = '';
  let doneSeen = false;

  function consumeBuffer(text: string, flush = false): string {
    const blocks = text.split(/\n\n+/);
    const completeBlocks = flush ? blocks : blocks.slice(0, -1);
    for (const block of completeBlocks) {
      for (const data of parseSseDataBlock(block)) {
        if (data === '[DONE]') {
          doneSeen = true;
          continue;
        }
        if (doneSeen) {
          continue;
        }
        const parsed = JSON.parse(data) as {
          choices?: Array<{
            delta?: { content?: unknown };
            message?: { content?: unknown };
          }>;
        };
        const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          complete += delta;
          onDelta(delta);
          logHomeMemoryLlm('debug', 'provider_delta', { mode: 'stream', chunkLength: delta.length, totalLength: complete.length });
        }
      }
    }
    return flush ? '' : blocks[blocks.length - 1] ?? '';
  }

  if (!response.body) {
    consumeBuffer(await response.text(), true);
    return complete;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    buffer = consumeBuffer(buffer);
    if (doneSeen) {
      break;
    }
  }
  buffer += decoder.decode();
  consumeBuffer(buffer, true);
  return complete;
}

function parseSseDataBlock(block: string): string[] {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart())
    .join('\n');
  return data.length > 0 ? [data] : [];
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

function baseInvocationDecision(input: DecideHomeMemoryLlmInvocationInput): HomeMemoryLlmInvocationDecision {
  return {
    shouldCall: false,
    purpose: input.purpose,
    reason: '',
    cacheKey: createHomeMemoryLlmCacheKey({
      purpose: input.purpose,
      homeId: input.homeId,
      runId: input.runId,
      hypothesisId: input.hypothesisId,
      evidenceIds: input.evidenceIds,
      model: input.config.provider.model,
      promptVersion: 1,
      schemaVersion: 1
    }),
    maxTokens: maxTokensForPurpose(input.purpose),
    priority: priorityForPurpose(input.purpose)
  };
}

function validateEnrichmentBoundary(
  enrichment: z.infer<typeof rawEnrichmentSchema>,
  memory: HomeMemory
): string[] {
  const errors: string[] = [];
  const evidenceIndex = indexEvidence(memory);
  const referencedIds = [
    ...enrichment.supportingEvidenceIds,
    ...enrichment.contradictingEvidenceIds,
    ...enrichment.alternatives.flatMap((alternative) => alternative.evidenceIds)
  ];

  if (enrichment.supportingEvidenceIds.length === 0) {
    errors.push('supportingEvidenceIds must include at least one evidence ID');
  }
  if (/\b(definitely|confirmed|ground truth|certainly)\b/i.test(enrichment.claim)) {
    errors.push('LLM claim must not present probabilistic memory as confirmed fact');
  }
  if (!memory.homeId || !memory.runId) {
    errors.push('memory must have a home/run before LLM enrichment can be accepted');
  }

  for (const evidenceId of referencedIds) {
    const evidence = evidenceIndex.get(evidenceId);
    if (!evidence) {
      errors.push(`evidence ${evidenceId} does not exist in memory`);
      continue;
    }
    if (evidence.homeId !== memory.homeId || evidence.runId !== memory.runId) {
      errors.push(`evidence ${evidenceId} must belong to the same home/run as memory`);
    }
  }

  return [...new Set(errors)];
}

function validateCachedEnrichment(input: {
  cached: HomeMemoryLlmEnrichment;
  memory: HomeMemory;
  expectedPurpose: HomeMemoryLlmPurpose;
  maxConfidence?: number;
}): string[] {
  const parsed = rawEnrichmentSchema.safeParse(input.cached);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => `cached enrichment rejected: ${issue.path.join('.')}: ${issue.message}`);
  }

  const errors = validateEnrichmentBoundary(parsed.data, input.memory);
  if (input.cached.purpose !== input.expectedPurpose) {
    errors.push(`purpose ${input.cached.purpose} does not match expected ${input.expectedPurpose}`);
  }
  if (input.maxConfidence !== undefined && input.cached.confidence > input.maxConfidence) {
    errors.push('confidence cannot exceed baseline confidence');
  }

  return [...new Set(errors)].map((error) => `cached enrichment rejected: ${error}`);
}

function indexEvidence(memory: HomeMemory): Map<string, MemoryEvidence> {
  const evidence = [
    ...memory.recentEvents,
    ...Object.values(memory.rooms).flatMap((room) => room.recentEvents),
    ...Object.values(memory.devices).flatMap((device) => device.recentEvents),
    ...Object.values(memory.fields).flatMap((field) => field.recentEvents)
  ];
  return new Map(evidence.map((entry) => [entry.id, entry]));
}

function maxTokensForPurpose(purpose: HomeMemoryLlmPurpose): number {
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

function priorityForPurpose(purpose: HomeMemoryLlmPurpose): HomeMemoryLlmInvocationDecision['priority'] {
  if (purpose === 'query_planning' || purpose === 'hypothesis_explanation') return 'high';
  if (purpose === 'daily_portrait_summary' || purpose === 'unknown_schema_mapping') return 'low';
  return 'normal';
}

function createUnknownSchemaPrompt(candidate: UnknownSchemaCandidate): string {
  return JSON.stringify({
    purpose: 'unknown_schema_mapping',
    instruction: 'Return candidate semantic mapping only. Do not update deterministic rules. Mention manual review in missingEvidence.',
    candidate
  });
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function fallbackType(purpose: HomeMemoryLlmPurpose): HomeMemoryLlmEnrichmentType {
  if (purpose === 'query_planning') return 'query_plan';
  if (purpose === 'daily_portrait_summary') return 'portrait_summary';
  if (purpose === 'reliability_review') return 'reliability_review';
  if (purpose === 'semantic_candidate' || purpose === 'unknown_schema_mapping') return 'semantic_candidate';
  return 'hypothesis_explanation';
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseRatio(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : undefined;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`;
}
