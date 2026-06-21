export interface BeliefDistribution<T extends string = string> {
  probabilities: Record<T, number>;
  top: T;
  confidence: number;
  entropy: number;
}

export function createBeliefDistribution<T extends string>(scores: Record<T, number>): BeliefDistribution<T> {
  const normalized = normalizeScores(scores);
  const ranked = Object.entries(normalized)
    .sort((left, right) => Number(right[1]) - Number(left[1])) as Array<[T, number]>;
  const [top, confidence] = ranked[0] ?? [Object.keys(scores)[0] as T, 0];
  return {
    probabilities: normalized,
    top,
    confidence,
    entropy: distributionEntropy(Object.values(normalized))
  };
}

export function normalizeScores<T extends string>(scores: Record<T, number>): Record<T, number> {
  const entries = Object.entries(scores) as Array<[T, number]>;
  const total = entries.reduce((sum, [, value]) => sum + Math.max(0, value), 0);
  if (total <= 0) {
    const fallback = entries.length > 0 ? 1 / entries.length : 0;
    return Object.fromEntries(entries.map(([key]) => [key, fallback])) as Record<T, number>;
  }
  return Object.fromEntries(entries.map(([key, value]) => [key, Math.max(0, value) / total])) as Record<T, number>;
}

function distributionEntropy(values: number[]): number {
  return values.reduce((sum, value) => {
    if (value <= 0) {
      return sum;
    }
    return sum - value * Math.log2(value);
  }, 0);
}
