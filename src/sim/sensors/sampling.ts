import type { SensorProfile } from './deviceProfiles';

export function shouldSampleSensor(
  profile: SensorProfile,
  currentTime: string,
  previousObservation?: Record<string, unknown>
): boolean {
  const lastObservedAt = typeof previousObservation?.lastObservedAt === 'string'
    ? previousObservation.lastObservedAt
    : undefined;
  if (!lastObservedAt) {
    return true;
  }

  const elapsedMs = Date.parse(currentTime) - Date.parse(lastObservedAt);
  const cooldownMs = (profile.cooldownSec ?? profile.samplingIntervalSec) * 1000;
  return elapsedMs >= cooldownMs;
}
