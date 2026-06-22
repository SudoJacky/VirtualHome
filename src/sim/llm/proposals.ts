import { createHash } from 'node:crypto';
import { z } from 'zod';

export type LlmProposalKind =
  | 'long_term_background'
  | 'weekly_schedule'
  | 'person_goal'
  | 'memory_summary'
  | 'conversation_summary'
  | 'activity_template_draft';

export interface LlmProposalMetadata {
  model: string;
  promptHash: string;
  schemaVersion: 1;
  outputHash: string;
}

export interface LlmProposal {
  kind: LlmProposalKind;
  title: string;
  summary: string;
  items: Array<{
    id: string;
    type: string;
    text: string;
  }>;
  requiredResources: Array<{
    resourceId: string;
    quantity: number;
  }>;
  safetyTags: string[];
  metadata: LlmProposalMetadata;
}

export type LlmProposalParseResult =
  | { ok: true; proposal: LlmProposal }
  | { ok: false; errors: string[] };

export interface ParseLlmProposalInput {
  jsonText: string;
  model: string;
  prompt: string;
  availableResources: Record<string, number>;
}

export interface DeterministicFallbackInput {
  purpose: LlmProposalKind;
  seed: number;
  prompt: string;
  availableResources: Record<string, number>;
  memoryContext?: {
    personId: string;
    summary: string;
  };
}

export interface LlmProposalCacheKeyInput {
  purpose: LlmProposalKind;
  prompt: string;
  availableResources: Record<string, number>;
  memoryContext?: DeterministicFallbackInput['memoryContext'];
}

export interface CachedOrFallbackProposalInput extends DeterministicFallbackInput {
  cache?: Record<string, LlmProposal>;
}

export interface CachedOrFallbackProposalResult {
  source: 'cache' | 'deterministic-fallback';
  cacheKey: string;
  proposal: LlmProposal;
}

const allowedKinds = [
  'long_term_background',
  'weekly_schedule',
  'person_goal',
  'memory_summary',
  'conversation_summary',
  'activity_template_draft'
] as const;

const bannedKinds = new Set(['minute_action', 'device_command', 'sensor_report', 'safety_critical_control']);
const bannedItemTypes = new Set(['minute_action', 'device_command', 'sensor_report', 'device_state', 'telemetry_report', 'safety_critical_control']);

const rawProposalSchema = z.object({
  kind: z.string(),
  title: z.string().min(1),
  summary: z.string().min(1),
  items: z.array(z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    text: z.string().min(1)
  })).default([]),
  requiredResources: z.array(z.object({
    resourceId: z.string().min(1),
    quantity: z.number().positive()
  })).default([]),
  safetyTags: z.array(z.string()).default([])
});

export function parseLlmProposalJson(input: ParseLlmProposalInput): LlmProposalParseResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(input.jsonText);
  } catch (error) {
    return { ok: false, errors: [`invalid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }

  const parsed = rawProposalSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) };
  }

  const proposal = parsed.data;
  const errors = validateProposalBoundary(proposal, input.availableResources);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    proposal: {
      kind: proposal.kind as LlmProposalKind,
      title: proposal.title,
      summary: proposal.summary,
      items: proposal.items.map((item) => ({ ...item })),
      requiredResources: proposal.requiredResources.map((resource) => ({ ...resource })),
      safetyTags: [...proposal.safetyTags],
      metadata: {
        model: input.model,
        promptHash: shortHash(input.prompt),
        schemaVersion: 1,
        outputHash: shortHash(stableStringify(proposal))
      }
    }
  };
}

export function createDeterministicFallbackProposal(input: DeterministicFallbackInput): LlmProposal {
  const resources = Object.entries(input.availableResources)
    .filter(([, quantity]) => quantity > 0)
    .map(([resourceId]) => resourceId)
    .sort();
  const fallbackItemId = `${input.purpose}:${shortHash(`${input.seed}:${input.prompt}:${resources.join(',')}`)}`;
  const proposal = {
    kind: input.purpose,
    title: fallbackTitle(input.purpose),
    summary: 'Deterministic fallback proposal generated without network or LLM access.',
    items: [
      {
        id: fallbackItemId,
        type: fallbackItemType(input.purpose),
        text: fallbackText(input.purpose, resources, input.memoryContext)
      }
    ],
    requiredResources: resources.slice(0, 1).map((resourceId) => ({ resourceId, quantity: 1 })),
    safetyTags: []
  };

  return {
    ...proposal,
    metadata: {
      model: 'deterministic-fallback',
      promptHash: shortHash(input.prompt),
      schemaVersion: 1,
      outputHash: shortHash(stableStringify(proposal))
    }
  };
}

export function createLlmProposalCacheKey(input: LlmProposalCacheKeyInput): string {
  return shortHash(stableStringify({
    purpose: input.purpose,
    prompt: input.prompt,
    availableResources: input.availableResources,
    memoryContext: input.memoryContext ?? null,
    schemaVersion: 1
  }));
}

export function resolveCachedOrFallbackProposal(input: CachedOrFallbackProposalInput): CachedOrFallbackProposalResult {
  const cacheKey = createLlmProposalCacheKey(input);
  const cached = input.cache?.[cacheKey];
  if (cached && validateCachedProposalBoundary(cached, input)) {
    return {
      source: 'cache',
      cacheKey,
      proposal: structuredClone(cached)
    };
  }
  return {
    source: 'deterministic-fallback',
    cacheKey,
    proposal: createDeterministicFallbackProposal(input)
  };
}

function validateCachedProposalBoundary(
  proposal: LlmProposal,
  input: CachedOrFallbackProposalInput
): boolean {
  const parsed = rawProposalSchema.safeParse(proposal);
  if (!parsed.success) return false;
  if (validateProposalBoundary(parsed.data, input.availableResources).length > 0) return false;
  return validateProposalMetadata(proposal, input.prompt);
}

function validateProposalMetadata(proposal: LlmProposal, prompt: string): boolean {
  return proposal.metadata.schemaVersion === 1 &&
    proposal.metadata.model.length > 0 &&
    proposal.metadata.promptHash === shortHash(prompt) &&
    proposal.metadata.outputHash === shortHash(stableStringify({
      kind: proposal.kind,
      title: proposal.title,
      summary: proposal.summary,
      items: proposal.items,
      requiredResources: proposal.requiredResources,
      safetyTags: proposal.safetyTags
    }));
}

function validateProposalBoundary(
  proposal: z.infer<typeof rawProposalSchema>,
  availableResources: Record<string, number>
): string[] {
  const errors: string[] = [];
  if (!allowedKinds.includes(proposal.kind as LlmProposalKind) || bannedKinds.has(proposal.kind)) {
    errors.push(`proposal kind ${proposal.kind} is not allowed for LLM generation`);
  }
  for (const item of proposal.items) {
    if (bannedItemTypes.has(item.type)) {
      errors.push(`item ${item.id} type ${item.type} is not allowed for LLM generation`);
    }
  }
  if (proposal.safetyTags.some((tag) => tag === 'safety_critical_control')) {
    errors.push('safety critical controls must be handled by deterministic rules, not LLM output');
  }
  for (const resource of proposal.requiredResources) {
    if ((availableResources[resource.resourceId] ?? 0) < resource.quantity) {
      errors.push(`missing resource ${resource.resourceId}`);
    }
  }
  return errors;
}

function fallbackTitle(kind: LlmProposalKind): string {
  const titles: Record<LlmProposalKind, string> = {
    long_term_background: 'Deterministic household background',
    weekly_schedule: 'Deterministic weekly schedule',
    person_goal: 'Deterministic person goal',
    memory_summary: 'Deterministic memory summary',
    conversation_summary: 'Deterministic conversation summary',
    activity_template_draft: 'Deterministic activity template draft'
  };
  return titles[kind];
}

function fallbackItemType(kind: LlmProposalKind): string {
  if (kind === 'weekly_schedule') return 'schedule_hint';
  if (kind === 'activity_template_draft') return 'activity_template';
  if (kind === 'conversation_summary') return 'conversation_note';
  if (kind === 'memory_summary') return 'memory_note';
  return 'planning_note';
}

function fallbackText(
  kind: LlmProposalKind,
  resources: string[],
  memoryContext?: DeterministicFallbackInput['memoryContext']
): string {
  if (kind === 'weekly_schedule') {
    return `Keep a stable household routine using ${resources[0] ?? 'available household resources'}.`;
  }
  if (kind === 'activity_template_draft') {
    return `Draft an activity template that respects ${resources[0] ?? 'resource availability'}.`;
  }
  if (kind === 'memory_summary' && memoryContext) {
    return `${memoryContext.personId}: ${memoryContext.summary}`;
  }
  return 'Create a deterministic planning note that can be replayed with the same seed.';
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
