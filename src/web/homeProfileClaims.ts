import { extractHomeBehaviorEpisodes } from './homeBehaviorEpisodes';
import { estimateHomeHouseholdPosterior, type HomeHouseholdPosterior } from './homeHouseholdPosterior';
import { extractHomeInferenceFeatures, type HomeInferenceFeature } from './homeInferenceFeatures';
import { extractHomeRoleSlots, type HomeRoleSlot } from './homeRoleSlots';
import type {
  ClaimEvidence,
  ClaimScope,
  ProfileClaimStatus,
  ProfileHypothesisType,
  ReasoningStep
} from './homeProfiler';
import type { HomeMemory, TimeBucket } from './homeMemoryModel';

export interface HomeProfileClaim {
  id: string;
  type: ProfileHypothesisType;
  label: string;
  conclusion: string;
  status: ProfileClaimStatus;
  confidence: number;
  scope: ClaimScope;
  supports: ClaimEvidence[];
  contradictions: ClaimEvidence[];
  missingEvidence: string[];
  alternativeExplanations: string[];
  reasoningSteps: ReasoningStep[];
}

export function extractHomeProfileClaims(memory: HomeMemory): HomeProfileClaim[] {
  const episodes = extractHomeBehaviorEpisodes(memory);
  const features = extractHomeInferenceFeatures(memory, episodes);
  const roleSlots = extractHomeRoleSlots(memory, features);
  const posterior = estimateHomeHouseholdPosterior(memory);

  return [
    anonymousRoleSignalsClaim(memory, features, roleSlots),
    stableRoutineEvidenceClaim(features),
    residentCountPosteriorClaim(memory, features, roleSlots, posterior)
  ].filter((claim): claim is HomeProfileClaim => Boolean(claim));
}

function anonymousRoleSignalsClaim(
  memory: HomeMemory,
  features: HomeInferenceFeature[],
  roleSlots: HomeRoleSlot[]
): HomeProfileClaim | null {
  if (roleSlots.length === 0) {
    return null;
  }
  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  const supports = [
    ...roleSlots.map((slot) => roleSlotEvidence(slot, featureById, memory)),
    ...features
      .filter((feature) => roleSlots.some((slot) => slot.supportingFeatureIds.includes(feature.id)))
      .map(featureEvidence)
  ];
  const hasCommuter = roleSlots.some((slot) => slot.kind === 'commuter_adult_like_slot');
  const hasDaytimeHome = roleSlots.some((slot) => slot.kind === 'daytime_home_work_slot');
  const hasChildActivity = roleSlots.some((slot) => slot.kind === 'child_activity_slot' || slot.kind === 'child_sleep_slot');
  const hasPetCandidate = roleSlots.some((slot) => slot.kind === 'pet_activity_candidate');
  const compositionSummary = hasCommuter && hasDaytimeHome && hasChildActivity
    ? `The role-slot pattern is compatible with three resident-like human slots: a commuter-like adult slot, a daytime-home work/study slot, and a child activity/sleep slot${hasPetCandidate ? ', plus a pet activity candidate' : ''}. Exact identities and resident count remain unconfirmed.`
    : 'The evidence supports multiple anonymous household role signals, but exact identities and resident count are not confirmed.';
  const missingEvidence = [
    'No direct identity evidence is available for any anonymous role slot.',
    'No direct resident-count evidence is available; exact household composition remains unconfirmed.'
  ];
  const alternativeExplanations = [
    'Multiple role slots may be compatible with fewer residents than the number of observed routines.',
    'Shared devices and rooms may be used by different anonymous household configurations.'
  ];
  const confidence = Math.min(0.84, average(roleSlots.map((slot) => slot.confidence)) + Math.min(0.12, roleSlots.length / 50));

  return claim({
    id: 'claim:household:anonymous-role-signals',
    type: 'household_composition',
    label: 'Anonymous household role signals',
    conclusion: compositionSummary,
    status: roleSlots.length >= 3 ? 'likely' : 'candidate',
    confidence,
    supports,
    missingEvidence,
    alternativeExplanations,
    reasoningSteps: [
      reasoningStep({
        label: 'Role-slot combination',
        rule: 'Profile claims combine anonymous role slots only after role slots cite lower-level features.',
        inputs: roleSlots.map((slot) => slot.id),
        output: `${roleSlots.length} anonymous role slot${plural(roleSlots.length)} support a probabilistic household composition claim.`,
        effect: 'supports',
        evidenceIds: supports.flatMap((support) => support.evidenceIds)
      }),
      reasoningStep({
        label: 'Composition calibration',
        rule: 'Exact identity and resident-count claims require direct or multi-independent evidence.',
        inputs: [...missingEvidence, ...alternativeExplanations],
        output: 'Identity and count gaps prevent the claim from becoming an exact household composition.',
        effect: 'weakens',
        evidenceIds: []
      })
    ]
  });
}

function stableRoutineEvidenceClaim(features: HomeInferenceFeature[]): HomeProfileClaim | null {
  if (features.length === 0) {
    return null;
  }
  const supports = features.map(featureEvidence);
  const missingEvidence = ['More holdout households and counterfactual variants are needed before treating these routines as universal.'];
  const alternativeExplanations = ['Some repeated routines may reflect automation, shared device use, or household-specific habits.'];

  return claim({
    id: 'claim:household:stable-routine-evidence',
    type: 'routine_window',
    label: 'Stable routine evidence',
    conclusion: 'Repeated lower-level features describe stable household routines without assigning identities.',
    status: features.length >= 3 ? 'likely' : 'candidate',
    confidence: Math.min(0.9, average(features.map((feature) => feature.confidence))),
    supports,
    missingEvidence,
    alternativeExplanations,
    reasoningSteps: [
      reasoningStep({
        label: 'Feature aggregation',
        rule: 'Routine claims must cite reusable features instead of final-answer labels.',
        inputs: features.map((feature) => feature.id),
        output: `${features.length} reusable feature${plural(features.length)} support the routine claim.`,
        effect: 'supports',
        evidenceIds: supports.flatMap((support) => support.evidenceIds)
      }),
      reasoningStep({
        label: 'Feature boundary check',
        rule: 'Features describe observed patterns and do not identify residents.',
        inputs: alternativeExplanations,
        output: 'The claim stays at the routine-evidence layer.',
        effect: 'weakens',
        evidenceIds: []
      })
    ]
  });
}

function residentCountPosteriorClaim(
  memory: HomeMemory,
  features: HomeInferenceFeature[],
  roleSlots: HomeRoleSlot[],
  posterior: HomeHouseholdPosterior
): HomeProfileClaim | null {
  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  const roleSupports = roleSlots.map((slot) => roleSlotEvidence(slot, featureById, memory));
  const featureSupports = features.map(featureEvidence);
  const supports = [...roleSupports, ...featureSupports];
  if (supports.length === 0) {
    return null;
  }
  const plausibleCounts = ([1, 2, 3, 4, 5] as const)
    .filter((count) => count !== posterior.winningEstimate && posterior.distribution[count] >= 0.12);
  const plausibleText = plausibleCounts.length > 0
    ? `count ${plausibleCounts.join(', count ')} remains plausible`
    : 'neighboring counts remain plausible at lower probability';
  const missingEvidence = [
    'No direct people-count evidence is available.',
    'Role slots are anonymous and may merge across routines.'
  ];
  const alternativeExplanations = [
    'Different resident counts can explain the same role-slot graph.',
    'Shared routines may be produced by fewer residents than the number of observed slots.'
  ];

  return claim({
    id: 'claim:household:resident-count-posterior',
    type: 'household_size',
    label: 'Resident-count posterior',
    conclusion: `The resident-count posterior favors count ${posterior.winningEstimate}; ${plausibleText}. The exact resident count is not confirmed.`,
    status: posterior.confidence >= 0.65 ? 'likely' : 'candidate',
    confidence: Math.min(0.84, posterior.confidence),
    supports,
    missingEvidence,
    alternativeExplanations,
    reasoningSteps: [
      ...posterior.reasoningSteps,
      reasoningStep({
        label: 'Posterior claim calibration',
        rule: 'The household-size claim reports posterior distribution, not a confirmed exact count.',
        inputs: [
          `winning:${posterior.winningEstimate}`,
          `lowerBound:${posterior.lowerBound}`,
          ...plausibleCounts.map((count) => `plausible:${count}`)
        ],
        output: 'The claim can report the favored count and plausible alternatives while keeping exact count unconfirmed.',
        effect: 'weakens',
        evidenceIds: []
      })
    ]
  });
}

function claim(input: Omit<HomeProfileClaim, 'scope' | 'contradictions'> & { contradictions?: ClaimEvidence[] }): HomeProfileClaim {
  return {
    ...input,
    confidence: clamp(input.confidence),
    scope: scopeForSupports(input.supports),
    contradictions: input.contradictions ?? []
  };
}

function featureEvidence(feature: HomeInferenceFeature): ClaimEvidence {
  return {
    id: `claim-evidence:${feature.id}`,
    kind: 'feature',
    refId: feature.id,
    summary: feature.summary,
    weight: feature.confidence,
    evidenceIds: [...feature.evidenceIds]
  };
}

function roleSlotEvidence(
  slot: HomeRoleSlot,
  featureById: Map<string, HomeInferenceFeature>,
  memory: HomeMemory
): ClaimEvidence {
  const evidenceIds = sortedUnique(slot.supportingFeatureIds.flatMap((supportId) => {
    const feature = featureById.get(supportId);
    if (feature) {
      return feature.evidenceIds;
    }
    if (supportId.startsWith('pattern:')) {
      return memory.profilePatterns[supportId.replace(/^pattern:/, '')]?.evidence.map((event) => event.id) ?? [];
    }
    return [];
  }));

  return {
    id: `claim-evidence:${slot.id}`,
    kind: 'role_slot',
    refId: slot.id,
    summary: `${slot.kind.replace(/_/g, ' ')} is supported by ${slot.supportingFeatureIds.join(', ')}.`,
    weight: slot.confidence,
    evidenceIds
  };
}

function scopeForSupports(supports: ClaimEvidence[]): ClaimScope {
  const evidenceDates = sortedUnique(supports.flatMap((support) => support.evidenceIds.map(extractDateFromEvidenceId)).filter(Boolean));
  return {
    dateRange: {
      from: evidenceDates[0] ?? 'unknown',
      to: evidenceDates[evidenceDates.length - 1] ?? 'unknown'
    },
    timeBuckets: uniqueTimeBucketsFromEvidenceIds(supports.flatMap((support) => support.evidenceIds))
  };
}

function uniqueTimeBucketsFromEvidenceIds(evidenceIds: string[]): TimeBucket[] {
  const buckets = sortedUnique(evidenceIds.map((id) => {
    const match = /_value_\d+_/.exec(id);
    return match ? 'daytime' : 'daytime';
  })) as TimeBucket[];
  return buckets.length > 0 ? buckets : ['daytime'];
}

function extractDateFromEvidenceId(evidenceId: string): string {
  const match = /_(\d{4}_\d{2}_\d{2})_/.exec(evidenceId);
  return match ? match[1].replace(/_/g, '-') : '';
}

function reasoningStep(input: ReasoningStep): ReasoningStep {
  return input;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0.1;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0.01, Number(value.toFixed(3))));
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function plural(count: number): string {
  return count === 1 ? '' : 's';
}
