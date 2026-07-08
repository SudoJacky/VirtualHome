import { extractHomeBehaviorEpisodes } from './homeBehaviorEpisodes';
import { extractHomeInferenceFeatures } from './homeInferenceFeatures';
import { extractHomeProfileClaims, type HomeProfileClaim } from './homeProfileClaims';
import { extractHomeRoleSlots, type HomeRoleSlotKind } from './homeRoleSlots';
import type { HomeMemory } from './homeMemoryModel';
import type { ProfileHypothesisType } from './homeProfiler';

export interface HomeProfileEvaluationCase {
  id: string;
  memory: HomeMemory;
  expectedFeatureIds?: string[];
  expectedRoleSlotKinds?: HomeRoleSlotKind[];
  absentFeatureIds?: string[];
  absentRoleSlotKinds?: HomeRoleSlotKind[];
}

export interface HomeProfileEvaluationCaseResult {
  id: string;
  featureIds: string[];
  roleSlotKinds: HomeRoleSlotKind[];
  claimIds: string[];
  claims: Array<Pick<HomeProfileClaim, 'id' | 'type' | 'status' | 'conclusion'>>;
  strongHighLevelClaimIds: string[];
  standardAnswerLikeClaimIds: string[];
  violations: string[];
}

export interface HomeProfileHoldoutEvaluationReport {
  passed: boolean;
  standard: HomeProfileEvaluationCaseResult;
  counterfactuals: HomeProfileEvaluationCaseResult[];
  calibrationWarnings: string[];
}

export function evaluateHomeProfileHoldouts(input: {
  standard: HomeProfileEvaluationCase;
  counterfactuals?: HomeProfileEvaluationCase[];
}): HomeProfileHoldoutEvaluationReport {
  const standard = evaluateHomeProfileCase(input.standard);
  const counterfactuals = (input.counterfactuals ?? []).map(evaluateHomeProfileCase);
  const calibrationWarnings = [
    ...calibrationWarningsForCase(standard),
    ...counterfactuals.flatMap(calibrationWarningsForCase)
  ];
  const passed = (
    standard.violations.length === 0 &&
    counterfactuals.every((result) => result.violations.length === 0) &&
    calibrationWarnings.length === 0
  );

  return {
    passed,
    standard,
    counterfactuals,
    calibrationWarnings
  };
}

function evaluateHomeProfileCase(input: HomeProfileEvaluationCase): HomeProfileEvaluationCaseResult {
  const episodes = extractHomeBehaviorEpisodes(input.memory);
  const features = extractHomeInferenceFeatures(input.memory, episodes);
  const roleSlots = extractHomeRoleSlots(input.memory, features);
  const claims = extractHomeProfileClaims(input.memory);
  const featureIds = features.map((feature) => feature.id).sort((left, right) => left.localeCompare(right));
  const roleSlotKinds = roleSlots.map((slot) => slot.kind).sort((left, right) => left.localeCompare(right));
  const claimSummaries = claims.map((claim) => ({
    id: claim.id,
    type: claim.type,
    status: claim.status,
    conclusion: claim.conclusion
  }));
  const strongHighLevelClaimIds = claims
    .filter((claim) => isHighLevelClaimType(claim.type) && claim.status === 'strong')
    .map((claim) => claim.id);
  const standardAnswerLikeClaimIds = claims
    .filter((claim) => STANDARD_ANSWER_PATTERN.test(serializedClaimText(claim)))
    .map((claim) => claim.id);

  return {
    id: input.id,
    featureIds,
    roleSlotKinds,
    claimIds: claims.map((claim) => claim.id).sort((left, right) => left.localeCompare(right)),
    claims: claimSummaries,
    strongHighLevelClaimIds,
    standardAnswerLikeClaimIds,
    violations: [
      ...missingItems('feature', input.expectedFeatureIds ?? [], featureIds),
      ...missingItems('role slot', input.expectedRoleSlotKinds ?? [], roleSlotKinds),
      ...unexpectedItems('feature', input.absentFeatureIds ?? [], featureIds),
      ...unexpectedItems('role slot', input.absentRoleSlotKinds ?? [], roleSlotKinds)
    ]
  };
}

function calibrationWarningsForCase(result: HomeProfileEvaluationCaseResult): string[] {
  return [
    ...result.strongHighLevelClaimIds.map((id) => `${result.id}: high-level claim ${id} is strong`),
    ...result.standardAnswerLikeClaimIds.map((id) => `${result.id}: claim ${id} contains standard-answer-like wording`)
  ];
}

function missingItems(label: string, expected: string[], actual: string[]): string[] {
  return expected
    .filter((item) => !actual.includes(item))
    .map((item) => `Expected ${label} ${item} was not found.`);
}

function unexpectedItems(label: string, absent: string[], actual: string[]): string[] {
  return absent
    .filter((item) => actual.includes(item))
    .map((item) => `Counterfactual ${label} ${item} was still found.`);
}

function isHighLevelClaimType(type: ProfileHypothesisType): boolean {
  return type === 'household_composition' || type === 'household_size' || type === 'resident_slot';
}

function serializedClaimText(claim: HomeProfileClaim): string {
  return [
    claim.label,
    claim.conclusion,
    ...claim.supports.map((support) => support.summary),
    ...claim.missingEvidence,
    ...claim.alternativeExplanations,
    ...claim.reasoningSteps.flatMap((step) => [step.label, step.rule, step.output])
  ].join(' ');
}

const STANDARD_ANSWER_PATTERN = /\b(student|adult_|child_1|three residents confirmed|3 residents confirmed)\b|三口之家|三口/i;
