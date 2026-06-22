import { describe, expect, it } from 'vitest';
import { getSensorProfile, withSensorProfileOverrides } from '../src/sim/sensors/deviceProfiles';
import {
  observeBinarySensor,
  observeContactSensor,
  observeEnvironmentSensor,
  observeMotionSensor,
  observeNumericSensor,
  type SensorObservationInput
} from '../src/sim/sensors/sensorModel';

describe('sensor model', () => {
  it('samples motion with cooldown and can miss true human occupancy', () => {
    const profile = withSensorProfileOverrides(getSensorProfile('motion_sensor'), {
      falseNegativeRate: 1,
      falsePositiveRate: 0,
      cooldownSec: 120,
      delayMs: { kind: 'constant', value: 0 }
    });
    const input: SensorObservationInput = {
      deviceId: 'living_motion_01',
      roomId: 'living_room',
      deviceType: 'motion_sensor',
      worldState: {
        humanOccupancy: true,
        petOccupancy: false,
        motionDetected: true
      },
      currentTime: '2026-06-17T08:00:00+08:00',
      randomSeed: 7
    };

    const first = observeMotionSensor(input, profile);
    const insideCooldown = observeMotionSensor({
      ...input,
      currentTime: '2026-06-17T08:01:00+08:00',
      previousObservation: first?.observedState
    }, profile);
    const afterCooldown = observeMotionSensor({
      ...input,
      currentTime: '2026-06-17T08:03:00+08:00',
      previousObservation: first?.observedState
    }, profile);

    expect(first).toMatchObject({
      event: {
        measurements: {
          motion: false,
          confidence: 0.15
        },
        lineage: {
          sourceLayer: 'sensor',
          quality: {
            noisy: true,
            confidence: 0.15
          }
        }
      }
    });
    expect(insideCooldown).toBeNull();
    expect(afterCooldown?.event.measurements.motion).toBe(false);
  });

  it('allows pets to create deterministic motion false positives', () => {
    const profile = withSensorProfileOverrides(getSensorProfile('motion_sensor'), {
      falseNegativeRate: 0,
      falsePositiveRate: 1,
      cooldownSec: 0,
      delayMs: { kind: 'constant', value: 750 }
    });
    const observation = observeMotionSensor({
      deviceId: 'living_motion_01',
      roomId: 'living_room',
      deviceType: 'motion_sensor',
      worldState: {
        humanOccupancy: false,
        petOccupancy: true,
        motionDetected: true
      },
      currentTime: '2026-06-17T08:00:00+08:00',
      randomSeed: 11
    }, profile);

    expect(observation).toMatchObject({
      event: {
        deviceId: 'living_motion_01',
        deviceType: 'motion_sensor',
        measurements: {
          motion: true,
          confidence: 0.42
        },
        lineage: {
          eventTime: '2026-06-17T08:00:00+08:00',
          ingestTime: '2026-06-17T08:00:00.750+08:00',
          quality: {
            delayedMs: 750,
            noisy: true,
            confidence: 0.42
          }
        }
      }
    });
  });

  it('smooths environment readings and applies sensor drift before reporting', () => {
    const profile = withSensorProfileOverrides(getSensorProfile('temperature_humidity_sensor'), {
      delayMs: { kind: 'constant', value: 1500 },
      driftPerDay: 0.24,
      smoothingFactor: 0.5,
      falsePositiveRate: 0,
      falseNegativeRate: 0
    });
    const observation = observeEnvironmentSensor({
      deviceId: 'kitchen_temp_01',
      roomId: 'kitchen',
      deviceType: 'temperature_humidity_sensor',
      worldState: {
        temperatureC: 28,
        humidityPercent: 60
      },
      previousObservation: {
        temperatureC: 24,
        humidityPercent: 50,
        lastObservedAt: '2026-06-16T08:00:00+08:00'
      },
      currentTime: '2026-06-17T08:00:00+08:00',
      randomSeed: 13
    }, profile);

    expect(observation?.event.measurements).toMatchObject({
      temperature_c: 26.2,
      humidity_percent: 55
    });
    expect(observation?.event.lineage).toMatchObject({
      eventTime: '2026-06-17T08:00:00+08:00',
      ingestTime: '2026-06-17T08:00:01.500+08:00',
      sourceLayer: 'sensor',
      quality: {
        delayedMs: 1500,
        noisy: true
      }
    });
  });

  it('suppresses environment telemetry when smoothed readings stay below the report threshold', () => {
    const profile = withSensorProfileOverrides(getSensorProfile('air_quality_sensor'), {
      reportOnChangeThreshold: 5,
      smoothingFactor: 0.4,
      driftPerDay: 0,
      dropRate: 0,
      duplicateRate: 0,
      delayMs: { kind: 'constant', value: 0 }
    });

    const observation = observeEnvironmentSensor({
      deviceId: 'study_co2_01',
      roomId: 'study',
      deviceType: 'air_quality_sensor',
      worldState: {
        pm25: 12.4,
        co2: 604
      },
      previousObservation: {
        pm25: 12,
        co2: 603,
        lastObservedAt: '2026-06-17T08:00:00+08:00'
      },
      currentTime: '2026-06-17T08:01:00+08:00',
      randomSeed: 51
    }, profile);

    expect(observation).toBeNull();
  });

  it('marks dropped samples and duplicate reports from profile rates', () => {
    const droppedProfile = withSensorProfileOverrides(getSensorProfile('motion_sensor'), {
      dropRate: 1,
      duplicateRate: 0,
      cooldownSec: 0,
      delayMs: { kind: 'constant', value: 0 }
    });
    const duplicateProfile = withSensorProfileOverrides(getSensorProfile('motion_sensor'), {
      dropRate: 0,
      duplicateRate: 1,
      cooldownSec: 0,
      delayMs: { kind: 'constant', value: 0 }
    });
    const input: SensorObservationInput = {
      deviceId: 'living_motion_01',
      roomId: 'living_room',
      deviceType: 'motion_sensor',
      worldState: {
        humanOccupancy: true,
        petOccupancy: false,
        motionDetected: true
      },
      currentTime: '2026-06-17T08:00:00+08:00',
      randomSeed: 17
    };

    const dropped = observeMotionSensor(input, droppedProfile);
    const duplicated = observeMotionSensor(input, duplicateProfile);

    expect(dropped?.event).toMatchObject({
      measurements: {
        sample_dropped: true
      },
      lineage: {
        quality: {
          dropped: true
        }
      }
    });
    expect(dropped?.observedState).toMatchObject({
      droppedSample: true,
      lastObservedAt: '2026-06-17T08:00:00+08:00'
    });
    expect(duplicated?.additionalEvents).toHaveLength(1);
    expect(duplicated?.additionalEvents?.[0]).toMatchObject({
      measurements: {
        motion: true
      },
      lineage: {
        quality: {
          duplicated: true
        }
      }
    });
  });

  it('reports contact changes with delay and duplicate quality markers', () => {
    const profile = withSensorProfileOverrides(getSensorProfile('contact_sensor'), {
      falsePositiveRate: 0,
      falseNegativeRate: 0,
      dropRate: 0,
      duplicateRate: 1,
      delayMs: { kind: 'constant', value: 450 }
    });

    const observation = observeContactSensor({
      deviceId: 'fridge_01',
      roomId: 'kitchen',
      deviceType: 'fridge',
      worldState: {
        contactOpen: true
      },
      previousObservation: {
        contactOpen: false,
        lastObservedAt: '2026-06-17T08:00:00+08:00'
      },
      currentTime: '2026-06-17T08:01:00+08:00',
      randomSeed: 23
    }, profile);

    expect(observation?.event).toMatchObject({
      deviceId: 'fridge_01',
      deviceType: 'fridge',
      measurements: {
        contact_open: true
      },
      lineage: {
        eventTime: '2026-06-17T08:01:00+08:00',
        ingestTime: '2026-06-17T08:01:00.450+08:00',
        sourceLayer: 'sensor',
        quality: {
          delayedMs: 450
        }
      }
    });
    expect(observation?.additionalEvents).toHaveLength(1);
    expect(observation?.additionalEvents?.[0]).toMatchObject({
      measurements: {
        contact_open: true
      },
      lineage: {
        quality: {
          duplicated: true
        }
      }
    });
  });

  it('can emit an out-of-order stale contact report after a newer contact change', () => {
    const profile = withSensorProfileOverrides(getSensorProfile('contact_sensor'), {
      falsePositiveRate: 0,
      falseNegativeRate: 0,
      dropRate: 0,
      duplicateRate: 0,
      outOfOrderRate: 1,
      delayMs: { kind: 'constant', value: 0 }
    });

    const observation = observeContactSensor({
      deviceId: 'fridge_01',
      roomId: 'kitchen',
      deviceType: 'fridge',
      worldState: {
        contactOpen: true
      },
      previousObservation: {
        contactOpen: false,
        lastObservedAt: '2026-06-17T08:00:00+08:00'
      },
      currentTime: '2026-06-17T08:01:00+08:00',
      randomSeed: 24
    }, profile);

    expect(observation?.event).toMatchObject({
      measurements: {
        contact_open: true
      },
      lineage: {
        eventTime: '2026-06-17T08:01:00+08:00',
        ingestTime: '2026-06-17T08:01:00+08:00'
      }
    });
    expect(observation?.additionalEvents).toHaveLength(1);
    expect(observation?.additionalEvents?.[0]).toMatchObject({
      measurements: {
        contact_open: false
      },
      lineage: {
        eventTime: '2026-06-17T08:00:00+08:00',
        ingestTime: '2026-06-17T08:01:00+08:00',
        quality: {
          outOfOrder: true,
          delayedMs: 60000
        }
      }
    });
  });

  it('does not report unchanged contact state after an initial observation', () => {
    const profile = withSensorProfileOverrides(getSensorProfile('contact_sensor'), {
      falsePositiveRate: 0,
      falseNegativeRate: 0,
      cooldownSec: 0,
      delayMs: { kind: 'constant', value: 0 }
    });

    const unchanged = observeContactSensor({
      deviceId: 'fridge_01',
      roomId: 'kitchen',
      deviceType: 'fridge',
      worldState: {
        contactOpen: false
      },
      previousObservation: {
        contactOpen: false,
        lastObservedAt: '2026-06-17T08:00:00+08:00'
      },
      currentTime: '2026-06-17T08:01:00+08:00',
      randomSeed: 29
    }, profile);

    expect(unchanged).toBeNull();
  });

  it('does not report an initial clean closed contact state', () => {
    const profile = withSensorProfileOverrides(getSensorProfile('contact_sensor'), {
      falsePositiveRate: 0,
      falseNegativeRate: 0,
      delayMs: { kind: 'constant', value: 0 }
    });

    const initialClosed = observeContactSensor({
      deviceId: 'fridge_01',
      roomId: 'kitchen',
      deviceType: 'fridge',
      worldState: {
        contactOpen: false
      },
      currentTime: '2026-06-17T08:01:00+08:00',
      randomSeed: 31
    }, profile);

    expect(initialClosed).toBeNull();
  });

  it('reports binary sensor changes using device-specific measurement names', () => {
    const profile = withSensorProfileOverrides(getSensorProfile('water_leak_sensor'), {
      falsePositiveRate: 0,
      falseNegativeRate: 0,
      dropRate: 0,
      duplicateRate: 0,
      delayMs: { kind: 'constant', value: 220 }
    });

    const observation = observeBinarySensor({
      deviceId: 'water_leak_01',
      roomId: 'bathroom',
      deviceType: 'water_leak_sensor',
      worldState: {
        leakDetected: true
      },
      previousObservation: {
        leakDetected: false,
        lastObservedAt: '2026-06-17T02:00:00+08:00'
      },
      currentTime: '2026-06-17T02:03:00+08:00',
      randomSeed: 37
    }, profile, {
      worldKey: 'leakDetected',
      measurementName: 'leak_detected'
    });

    expect(observation).toMatchObject({
      event: {
        deviceId: 'water_leak_01',
        deviceType: 'water_leak_sensor',
        measurements: {
          leak_detected: true,
          confidence: 0.96
        },
        lineage: {
          sourceLayer: 'sensor',
          eventTime: '2026-06-17T02:03:00+08:00',
          ingestTime: '2026-06-17T02:03:00.220+08:00'
        }
      },
      observedState: {
        leakDetected: true,
        lastObservedAt: '2026-06-17T02:03:00+08:00'
      }
    });
  });

  it('suppresses unchanged inactive binary sensor observations', () => {
    const profile = withSensorProfileOverrides(getSensorProfile('router'), {
      falsePositiveRate: 0,
      falseNegativeRate: 0,
      delayMs: { kind: 'constant', value: 0 }
    });

    const unchanged = observeBinarySensor({
      deviceId: 'router_01',
      roomId: 'study',
      deviceType: 'router',
      worldState: {
        online: true
      },
      previousObservation: {
        online: true,
        lastObservedAt: '2026-06-17T08:00:00+08:00'
      },
      currentTime: '2026-06-17T08:01:00+08:00',
      randomSeed: 41
    }, profile, {
      worldKey: 'online',
      measurementName: 'online',
      inactiveValue: true
    });

    expect(unchanged).toBeNull();
  });

  it('reports numeric sensor changes after smoothing and threshold checks', () => {
    const profile = withSensorProfileOverrides(getSensorProfile('power_meter'), {
      reportOnChangeThreshold: 8,
      smoothingFactor: 0.5,
      driftPerDay: 0,
      dropRate: 0,
      duplicateRate: 0,
      delayMs: { kind: 'constant', value: 300 }
    });

    const smallChange = observeNumericSensor({
      deviceId: 'stove_01',
      roomId: 'kitchen',
      deviceType: 'stove',
      worldState: {
        powerW: 10
      },
      previousObservation: {
        powerW: 0,
        lastObservedAt: '2026-06-17T18:00:00+08:00'
      },
      currentTime: '2026-06-17T18:01:00+08:00',
      randomSeed: 43
    }, profile, {
      worldKey: 'powerW',
      measurementName: 'power_w'
    });
    const largeChange = observeNumericSensor({
      deviceId: 'stove_01',
      roomId: 'kitchen',
      deviceType: 'stove',
      worldState: {
        powerW: 850
      },
      previousObservation: {
        powerW: 0,
        lastObservedAt: '2026-06-17T18:00:00+08:00'
      },
      currentTime: '2026-06-17T18:02:00+08:00',
      randomSeed: 47
    }, profile, {
      worldKey: 'powerW',
      measurementName: 'power_w'
    });

    expect(smallChange).toBeNull();
    expect(largeChange?.event).toMatchObject({
      deviceId: 'stove_01',
      measurements: {
        power_w: 425
      },
      lineage: {
        sourceLayer: 'sensor',
        ingestTime: '2026-06-17T18:02:00.300+08:00'
      }
    });
    expect(largeChange?.observedState).toMatchObject({
      powerW: 425,
      lastObservedAt: '2026-06-17T18:02:00+08:00'
    });
  });
});
