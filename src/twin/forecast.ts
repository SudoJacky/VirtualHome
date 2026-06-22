import type { BeliefDistribution } from './beliefState';
import type { InferredHomeMode } from './inferenceModel';

export interface AnomalyRisk {
  probability: number;
  drivers: string[];
}

export interface TwinStateForecast {
  horizonMinutes: 15 | 30 | 60;
  homeMode: BeliefDistribution<InferredHomeMode>;
  risks: Record<string, number>;
}

export function createAnomalyRisks(input: {
  fridgeDoorOpen: boolean;
  routerOffline: boolean;
  stovePowerW: number;
  kitchenMotionConfidence: number;
  noRecentMotionInSleepingHours: boolean;
  morningSleepSensorInBed: boolean;
  waterLeakDetected: boolean;
}): Record<string, AnomalyRisk> {
  const stoveOn = input.stovePowerW >= 800;
  const stoveUnattended = stoveOn && input.kitchenMotionConfidence < 0.2;
  return {
    fridge_left_open: {
      probability: input.fridgeDoorOpen ? 0.82 : 0.12,
      drivers: input.fridgeDoorOpen ? ['fridge_01.doorOpen'] : ['prior']
    },
    network_impact: {
      probability: input.routerOffline ? 0.84 : 0.1,
      drivers: input.routerOffline ? ['router_01.online=false'] : ['prior']
    },
    stove_unattended: {
      probability: stoveUnattended ? 0.86 : stoveOn ? 0.42 : 0.08,
      drivers: stoveUnattended
        ? ['stove_01.powerW', 'no_kitchen_motion_observation']
        : stoveOn
          ? ['stove_01.powerW', 'kitchen_motion_observation']
          : ['prior']
    },
    senior_no_activity: {
      probability: input.morningSleepSensorInBed ? 0.78 : input.noRecentMotionInSleepingHours ? 0.48 : 0.16,
      drivers: input.morningSleepSensorInBed
        ? ['master_sleep_01.in_bed', 'morning_activity_prior']
        : input.noRecentMotionInSleepingHours
          ? ['sleeping_hour_prior', 'no_motion_observation']
          : ['prior']
    },
    water_leak: {
      probability: input.waterLeakDetected ? 0.92 : 0.05,
      drivers: input.waterLeakDetected ? ['water_leak_01.leak_detected'] : ['prior']
    }
  };
}

export function createStateForecasts(
  homeMode: BeliefDistribution<InferredHomeMode>,
  risks: Record<string, AnomalyRisk>,
  options: {
    homeModeByHorizon?: Partial<Record<15 | 30 | 60, BeliefDistribution<InferredHomeMode>>>;
  } = {}
): TwinStateForecast[] {
  return [15, 30, 60].map((horizonMinutes) => ({
    horizonMinutes: horizonMinutes as 15 | 30 | 60,
    homeMode: options.homeModeByHorizon?.[horizonMinutes as 15 | 30 | 60] ?? homeMode,
    risks: Object.fromEntries(Object.entries(risks).map(([riskId, risk]) => [
      riskId,
      Math.min(0.99, risk.probability + horizonMinutes / 60 * 0.12)
    ]))
  }));
}
