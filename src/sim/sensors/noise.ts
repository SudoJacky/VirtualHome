import type { DistributionSpec } from './deviceProfiles';

export function sampleDistribution(spec: DistributionSpec, seed: number, salt: string): number {
  if (spec.kind === 'constant') {
    return spec.value;
  }
  return spec.min + (spec.max - spec.min) * deterministicUnit(seed, salt);
}

export function probabilityHit(rate: number, seed: number, salt: string): boolean {
  if (rate <= 0) {
    return false;
  }
  if (rate >= 1) {
    return true;
  }
  return deterministicUnit(seed, salt) < rate;
}

export function deterministicNoise(seed: number, salt: string, amplitude: number): number {
  return (deterministicUnit(seed, salt) * 2 - 1) * amplitude;
}

function deterministicUnit(seed: number, salt: string): number {
  let hash = (seed >>> 0) ^ 0x811c9dc5;
  for (let index = 0; index < salt.length; index += 1) {
    hash ^= salt.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash / 0x100000000;
}
