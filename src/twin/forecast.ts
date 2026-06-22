import type { BeliefDistribution } from './beliefState';
import type { InferredHomeMode, PersonInferenceBelief } from './inferenceModel';

export interface AnomalyRisk {
  probability: number;
  drivers: string[];
}

export interface TwinStateForecast {
  horizonMinutes: 15 | 30 | 60;
  homeMode: BeliefDistribution<InferredHomeMode>;
  people: Record<string, PersonInferenceBelief>;
  risks: Record<string, number>;
}

export function createAnomalyRisks(input: {
  fridgeDoorOpen: boolean;
  fridgeDoorConfidence?: number;
  routerOffline: boolean;
  routerOfflineConfidence?: number;
  stovePowerW: number;
  stovePowerConfidence?: number;
  kitchenMotionConfidence: number;
  noRecentMotionInSleepingHours: boolean;
  morningSleepSensorInBed: boolean;
  sleepSensorConfidence?: number;
  waterLeakDetected: boolean;
  waterLeakConfidence?: number;
}): Record<string, AnomalyRisk> {
  const stoveOn = input.stovePowerW >= 800;
  const stoveUnattended = stoveOn && input.kitchenMotionConfidence < 0.2;
  const routerOfflineConfidence = clamp01(input.routerOfflineConfidence ?? 1);
  const stovePowerConfidence = clamp01(input.stovePowerConfidence ?? 1);
  const sleepSensorConfidence = clamp01(input.sleepSensorConfidence ?? 1);
  const waterLeakConfidence = clamp01(input.waterLeakConfidence ?? 1);
  const fridgeDoorConfidence = clamp01(input.fridgeDoorConfidence ?? 1);
  return {
    fridge_left_open: {
      probability: input.fridgeDoorOpen ? weightedProbability(0.46, 0.82, fridgeDoorConfidence) : 0.12,
      drivers: input.fridgeDoorOpen ? ['fridge_01.doorOpen'] : ['prior']
    },
    network_impact: {
      probability: input.routerOffline ? weightedProbability(0.45, 0.84, routerOfflineConfidence) : 0.1,
      drivers: input.routerOffline ? ['router_01.online=false'] : ['prior']
    },
    stove_unattended: {
      probability: stoveUnattended
        ? weightedProbability(0.5, 0.86, stovePowerConfidence)
        : stoveOn
          ? weightedProbability(0.28, 0.42, stovePowerConfidence)
          : 0.08,
      drivers: stoveUnattended
        ? ['stove_01.powerW', 'no_kitchen_motion_observation']
        : stoveOn
          ? ['stove_01.powerW', 'kitchen_motion_observation']
          : ['prior']
    },
    senior_no_activity: {
      probability: input.morningSleepSensorInBed
        ? weightedProbability(0.4, 0.78, sleepSensorConfidence)
        : input.noRecentMotionInSleepingHours ? 0.48 : 0.16,
      drivers: input.morningSleepSensorInBed
        ? ['master_sleep_01.in_bed', 'morning_activity_prior']
        : input.noRecentMotionInSleepingHours
          ? ['sleeping_hour_prior', 'no_motion_observation']
          : ['prior']
    },
    water_leak: {
      probability: input.waterLeakDetected ? weightedProbability(0.55, 0.92, waterLeakConfidence) : 0.05,
      drivers: input.waterLeakDetected ? ['water_leak_01.leak_detected'] : ['prior']
    }
  };
}

function weightedProbability(floor: number, ceiling: number, confidence: number): number {
  return floor + (ceiling - floor) * clamp01(confidence);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function createStateForecasts(
  homeMode: BeliefDistribution<InferredHomeMode>,
  risks: Record<string, AnomalyRisk>,
  options: {
    homeModeByHorizon?: Partial<Record<15 | 30 | 60, BeliefDistribution<InferredHomeMode>>>;
    peopleByHorizon?: Partial<Record<15 | 30 | 60, Record<string, PersonInferenceBelief>>>;
  } = {}
): TwinStateForecast[] {
  return [15, 30, 60].map((horizonMinutes) => ({
    horizonMinutes: horizonMinutes as 15 | 30 | 60,
    homeMode: options.homeModeByHorizon?.[horizonMinutes as 15 | 30 | 60] ?? homeMode,
    people: options.peopleByHorizon?.[horizonMinutes as 15 | 30 | 60] ?? {},
    risks: Object.fromEntries(Object.entries(risks).map(([riskId, risk]) => [
      riskId,
      Math.min(0.99, risk.probability + horizonMinutes / 60 * 0.12)
    ]))
  }));
}
