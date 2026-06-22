export type DistributionSpec =
  | { kind: 'constant'; value: number }
  | { kind: 'uniform'; min: number; max: number };

export interface SensorProfile {
  deviceType: string;
  samplingIntervalSec: number;
  reportOnChangeThreshold?: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  delayMs: DistributionSpec;
  duplicateRate: number;
  outOfOrderRate?: number;
  dropRate: number;
  driftPerDay?: number;
  offlineSensitivity?: number;
  cooldownSec?: number;
  smoothingFactor?: number;
}

const sensorProfiles: Record<string, SensorProfile> = {
  motion_sensor: {
    deviceType: 'motion_sensor',
    samplingIntervalSec: 30,
    reportOnChangeThreshold: 1,
    falsePositiveRate: 0.08,
    falseNegativeRate: 0.04,
    delayMs: { kind: 'uniform', min: 80, max: 900 },
    duplicateRate: 0.01,
    dropRate: 0.01,
    cooldownSec: 90
  },
  doorbell_camera: {
    deviceType: 'doorbell_camera',
    samplingIntervalSec: 300,
    reportOnChangeThreshold: 1,
    falsePositiveRate: 0.06,
    falseNegativeRate: 0.08,
    delayMs: { kind: 'uniform', min: 180, max: 1400 },
    duplicateRate: 0.008,
    dropRate: 0.008,
    cooldownSec: 300
  },
  security_camera: {
    deviceType: 'security_camera',
    samplingIntervalSec: 300,
    reportOnChangeThreshold: 1,
    falsePositiveRate: 0.12,
    falseNegativeRate: 0.07,
    delayMs: { kind: 'uniform', min: 220, max: 1800 },
    duplicateRate: 0.008,
    dropRate: 0.01,
    cooldownSec: 300
  },
  contact_sensor: {
    deviceType: 'contact_sensor',
    samplingIntervalSec: 5,
    reportOnChangeThreshold: 1,
    falsePositiveRate: 0.01,
    falseNegativeRate: 0.01,
    delayMs: { kind: 'uniform', min: 40, max: 550 },
    duplicateRate: 0.03,
    outOfOrderRate: 0.01,
    dropRate: 0.005,
    cooldownSec: 0
  },
  power_meter: {
    deviceType: 'power_meter',
    samplingIntervalSec: 60,
    reportOnChangeThreshold: 8,
    falsePositiveRate: 0,
    falseNegativeRate: 0,
    delayMs: { kind: 'uniform', min: 250, max: 1600 },
    duplicateRate: 0.005,
    dropRate: 0.005,
    driftPerDay: 0.1,
    smoothingFactor: 0.45
  },
  temperature_humidity_sensor: {
    deviceType: 'temperature_humidity_sensor',
    samplingIntervalSec: 60,
    reportOnChangeThreshold: 0.2,
    falsePositiveRate: 0,
    falseNegativeRate: 0,
    delayMs: { kind: 'uniform', min: 300, max: 2500 },
    duplicateRate: 0.005,
    dropRate: 0.005,
    driftPerDay: 0.04,
    smoothingFactor: 0.35
  },
  air_quality_sensor: {
    deviceType: 'air_quality_sensor',
    samplingIntervalSec: 60,
    reportOnChangeThreshold: 5,
    falsePositiveRate: 0,
    falseNegativeRate: 0,
    delayMs: { kind: 'uniform', min: 500, max: 3500 },
    duplicateRate: 0.005,
    dropRate: 0.01,
    driftPerDay: 1.5,
    smoothingFactor: 0.4
  },
  water_leak_sensor: {
    deviceType: 'water_leak_sensor',
    samplingIntervalSec: 10,
    reportOnChangeThreshold: 1,
    falsePositiveRate: 0.002,
    falseNegativeRate: 0.004,
    delayMs: { kind: 'uniform', min: 60, max: 800 },
    duplicateRate: 0.01,
    dropRate: 0.002,
    cooldownSec: 0
  },
  sleep_sensor: {
    deviceType: 'sleep_sensor',
    samplingIntervalSec: 60,
    reportOnChangeThreshold: 1,
    falsePositiveRate: 0.015,
    falseNegativeRate: 0.025,
    delayMs: { kind: 'uniform', min: 250, max: 1800 },
    duplicateRate: 0.005,
    dropRate: 0.01,
    smoothingFactor: 0.2
  },
  router: {
    deviceType: 'router',
    samplingIntervalSec: 30,
    reportOnChangeThreshold: 15,
    falsePositiveRate: 0.005,
    falseNegativeRate: 0.005,
    delayMs: { kind: 'uniform', min: 120, max: 1000 },
    duplicateRate: 0.005,
    dropRate: 0.005,
    offlineSensitivity: 0.96,
    smoothingFactor: 0.25
  }
};

export function getSensorProfile(deviceType: string): SensorProfile {
  return structuredClone(sensorProfiles[deviceType] ?? {
    deviceType,
    samplingIntervalSec: 60,
    falsePositiveRate: 0,
    falseNegativeRate: 0,
    delayMs: { kind: 'constant', value: 0 },
    duplicateRate: 0,
    dropRate: 0
  });
}

export function withSensorProfileOverrides(profile: SensorProfile, overrides: Partial<SensorProfile>): SensorProfile {
  return {
    ...structuredClone(profile),
    ...structuredClone(overrides)
  };
}
