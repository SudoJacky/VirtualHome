import {
  estimateHouseholdSizeFromMemory,
  type HouseholdSizeDistribution,
  type ResidentCount
} from './homeHouseholdSizeEstimator';
import type { ReasoningStep } from './homeProfiler';
import type { HomeMemory } from './homeMemoryModel';

export interface HomeHouseholdPosterior {
  distribution: HouseholdSizeDistribution;
  lowerBound: ResidentCount;
  winningEstimate: ResidentCount;
  confidence: number;
  reasoningSteps: ReasoningStep[];
}

export function estimateHomeHouseholdPosterior(memory: HomeMemory): HomeHouseholdPosterior {
  const estimate = estimateHouseholdSizeFromMemory(memory);
  const plausibleCounts = ([1, 2, 3, 4, 5] as ResidentCount[])
    .filter((count) => count !== estimate.estimate && estimate.distribution[count] >= 0.12);
  const plausibleSummary = plausibleCounts.length > 0
    ? `count ${plausibleCounts.join(', count ')} remain${plausibleCounts.length === 1 ? 's' : ''} plausible`
    : 'nearby counts remain uncertain below the reporting threshold';

  return {
    distribution: estimate.distribution,
    lowerBound: estimate.lowerBound,
    winningEstimate: estimate.estimate,
    confidence: estimate.confidence,
    reasoningSteps: [
      {
        label: 'Posterior scoring',
        rule: 'Resident count is represented as a probability distribution over counts 1 through 5.',
        inputs: estimate.scoring.residents.map((resident) => `${resident.count}:${resident.probability}`),
        output: `The posterior currently favors count ${estimate.estimate} with probability ${formatProbability(estimate.distribution[estimate.estimate])}.`,
        effect: 'supports',
        evidenceIds: []
      },
      {
        label: 'Lower-bound evidence',
        rule: 'Concurrent activity and recurring sleep zones set only a lower bound unless direct count evidence exists.',
        inputs: estimate.evidence,
        output: `The lower bound is ${estimate.lowerBound}; ${estimate.evidence.join('; ') || 'no strong lower-bound evidence was found'}.`,
        effect: 'supports',
        evidenceIds: []
      },
      {
        label: 'Count calibration',
        rule: 'A winning posterior estimate is not an exact resident-count confirmation.',
        inputs: plausibleCounts.map((count) => `count ${count}:${formatProbability(estimate.distribution[count])}`),
        output: `${plausibleSummary}; exact resident count is not confirmed without direct people-count evidence.`,
        effect: 'weakens',
        evidenceIds: []
      }
    ]
  };
}

function formatProbability(value: number): string {
  return `${Math.round(value * 100)}%`;
}
