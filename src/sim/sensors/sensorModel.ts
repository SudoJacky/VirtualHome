import type { DeviceTelemetryEvent, EventLineage, EventSourceLayer, RoomId } from '../../shared/types';
import type { SensorProfile } from './deviceProfiles';
import { deterministicNoise, probabilityHit, sampleDistribution } from './noise';
import { shouldSampleSensor } from './sampling';

export interface SensorObservationInput {
  deviceId: string;
  roomId: RoomId;
  deviceType: string;
  worldState: Record<string, unknown>;
  previousObservation?: Record<string, unknown>;
  currentTime: string;
  randomSeed: number;
}

export interface SensorObservation {
  event: Omit<DeviceTelemetryEvent, 'id' | 'runId' | 'ts' | 'simTime' | 'homeId' | 'scenarioId' | 'sequence'>;
  additionalEvents?: Array<Omit<DeviceTelemetryEvent, 'id' | 'runId' | 'ts' | 'simTime' | 'homeId' | 'scenarioId' | 'sequence'>>;
  observedState: Record<string, number | boolean | string>;
}

export interface BinarySensorOptions {
  worldKey: string;
  measurementName: string;
  inactiveValue?: boolean;
}

export interface NumericSensorOptions {
  worldKey: string;
  measurementName: string;
  inactiveValue?: number;
  noiseAmplitude?: number;
}

export interface EnvironmentSensorReportingOptions {
  thresholds?: Partial<Record<'temperatureC' | 'humidityPercent' | 'pm25' | 'co2' | 'moisturePercent', number>>;
  heartbeatIntervalMinutes?: number;
  heartbeatOffsetMinutes?: number;
}

export function observeMotionSensor(input: SensorObservationInput, profile: SensorProfile): SensorObservation | null {
  if (!shouldSampleSensor(profile, input.currentTime, input.previousObservation)) {
    return null;
  }

  const humanOccupancy = input.worldState.humanOccupancy === true;
  const petOccupancy = input.worldState.petOccupancy === true;
  const worldMotion = input.worldState.motionDetected === true;
  const missedHuman = humanOccupancy && probabilityHit(profile.falseNegativeRate, input.randomSeed, `${input.deviceId}:motion:false-negative:${input.currentTime}`);
  const petFalsePositive = !humanOccupancy && petOccupancy && worldMotion && probabilityHit(profile.falsePositiveRate, input.randomSeed, `${input.deviceId}:motion:pet-false-positive:${input.currentTime}`);
  const randomFalsePositive = !humanOccupancy && !petOccupancy && probabilityHit(profile.falsePositiveRate, input.randomSeed, `${input.deviceId}:motion:false-positive:${input.currentTime}`);
  const motion = humanOccupancy ? !missedHuman : petFalsePositive || randomFalsePositive;
  const confidence = motion
    ? humanOccupancy ? 0.84 : 0.42
    : missedHuman ? 0.15 : 0;
  const noisy = missedHuman || petFalsePositive || randomFalsePositive;
  const measurements = {
    motion,
    confidence
  };

  return createSensorObservation(input, measurements, profile, {
      noisy,
      confidence
    }, measurements);
}

export function observeContactSensor(input: SensorObservationInput, profile: SensorProfile): SensorObservation | null {
  if (!shouldSampleSensor(profile, input.currentTime, input.previousObservation)) {
    return null;
  }

  const actualOpen = input.worldState.contactOpen === true;
  const missedOpen = actualOpen && probabilityHit(profile.falseNegativeRate, input.randomSeed, `${input.deviceId}:contact:false-negative:${input.currentTime}`);
  const falseOpen = !actualOpen && probabilityHit(profile.falsePositiveRate, input.randomSeed, `${input.deviceId}:contact:false-positive:${input.currentTime}`);
  const contactOpen = actualOpen ? !missedOpen : falseOpen;
  const confidence = contactOpen === actualOpen ? 0.96 : 0.28;
  const noisy = missedOpen || falseOpen;
  if (!noisy && !contactOpen && input.previousObservation?.contactOpen === undefined) {
    return null;
  }
  if (!noisy && input.previousObservation?.contactOpen === contactOpen) {
    return null;
  }
  const measurements = {
    contact_open: contactOpen,
    confidence
  };

  const observation = createSensorObservation(input, measurements, profile, {
    noisy,
    confidence
  }, {
    contactOpen,
    lastObservedAt: input.currentTime
  });
  const staleEvent = createOutOfOrderContactEvent(input, profile, contactOpen);
  if (!staleEvent || observation.event.measurements.sample_dropped === true) {
    return observation;
  }
  return {
    ...observation,
    additionalEvents: [
      ...(observation.additionalEvents ?? []),
      staleEvent
    ]
  };
}

export function observeBinarySensor(input: SensorObservationInput, profile: SensorProfile, options: BinarySensorOptions): SensorObservation | null {
  if (!shouldSampleSensor(profile, input.currentTime, input.previousObservation)) {
    return null;
  }

  const inactiveValue = options.inactiveValue ?? false;
  const actualValue = input.worldState[options.worldKey] === true;
  const active = actualValue !== inactiveValue;
  const missedActive = active && probabilityHit(profile.falseNegativeRate, input.randomSeed, `${input.deviceId}:${options.worldKey}:false-negative:${input.currentTime}`);
  const falseActive = !active && probabilityHit(profile.falsePositiveRate, input.randomSeed, `${input.deviceId}:${options.worldKey}:false-positive:${input.currentTime}`);
  const observedValue = missedActive
    ? inactiveValue
    : falseActive
      ? !inactiveValue
      : actualValue;
  const noisy = missedActive || falseActive;
  const confidence = observedValue === actualValue
    ? active && profile.offlineSensitivity !== undefined ? profile.offlineSensitivity : 0.96
    : 0.28;

  if (!noisy && observedValue === inactiveValue && input.previousObservation?.[options.worldKey] === undefined) {
    return null;
  }
  if (!noisy && input.previousObservation?.[options.worldKey] === observedValue) {
    return null;
  }

  const measurements = {
    [options.measurementName]: observedValue,
    confidence
  };

  return createSensorObservation(input, measurements, profile, {
    noisy,
    confidence
  }, {
    [options.worldKey]: observedValue,
    lastObservedAt: input.currentTime
  });
}

export function observeNumericSensor(input: SensorObservationInput, profile: SensorProfile, options: NumericSensorOptions): SensorObservation | null {
  if (!shouldSampleSensor(profile, input.currentTime, input.previousObservation)) {
    return null;
  }

  const inactiveValue = options.inactiveValue ?? 0;
  const current = numberValue(input.worldState[options.worldKey], inactiveValue);
  const previousRaw = input.previousObservation?.[options.worldKey];
  const previous = numberValue(previousRaw, previousRaw === undefined ? inactiveValue : current);
  const smoothingFactor = profile.smoothingFactor ?? 1;
  const daysSincePrevious = daysBetween(String(input.previousObservation?.lastObservedAt ?? input.currentTime), input.currentTime);
  const observed = roundOne(
    smoothNumber(previous, current, smoothingFactor) +
    (profile.driftPerDay ?? 0) * daysSincePrevious +
    deterministicNoise(input.randomSeed, `${input.deviceId}:${options.worldKey}:${input.currentTime}`, options.noiseAmplitude ?? 0)
  );
  const threshold = profile.reportOnChangeThreshold ?? 0;
  const baseline = previousRaw === undefined ? inactiveValue : previous;

  if (Math.abs(observed - baseline) < threshold) {
    return null;
  }

  return createSensorObservation(input, {
    [options.measurementName]: observed
  }, profile, {
    noisy: Boolean(profile.driftPerDay || options.noiseAmplitude)
  }, {
    [options.worldKey]: observed,
    lastObservedAt: input.currentTime
  });
}

export function observeEnvironmentSensor(input: SensorObservationInput, profile: SensorProfile, reporting: EnvironmentSensorReportingOptions = {}): SensorObservation | null {
  if (!shouldSampleSensor(profile, input.currentTime, input.previousObservation)) {
    return null;
  }

  const smoothingFactor = profile.smoothingFactor ?? 1;
  const daysSincePrevious = daysBetween(String(input.previousObservation?.lastObservedAt ?? input.currentTime), input.currentTime);
  const drift = (profile.driftPerDay ?? 0) * daysSincePrevious;
  const temperatureC = smoothNumber(
    numberValue(input.previousObservation?.temperatureC, numberValue(input.worldState.temperatureC, 25)),
    numberValue(input.worldState.temperatureC, 25),
    smoothingFactor
  ) + drift;
  const humidityPercent = smoothNumber(
    numberValue(input.previousObservation?.humidityPercent, numberValue(input.worldState.humidityPercent, 50)),
    numberValue(input.worldState.humidityPercent, 50),
    smoothingFactor
  );
  const pm25 = maybeSmoothMetric('pm25', input, smoothingFactor, profile, 0.15);
  const co2 = maybeSmoothMetric('co2', input, smoothingFactor, profile, 3);
  const moisturePercent = maybeSmoothMetric('moisturePercent', input, smoothingFactor, profile, 0);
  const measurements: Record<string, number> = {};
  const observedState: Record<string, number | string> = {
    ...copyReportedEnvironmentState(input.previousObservation),
    lastObservedAt: input.currentTime
  };
  let heartbeat = false;

  if ('temperatureC' in input.worldState) {
    heartbeat = addEnvironmentMeasurement(input, profile, reporting, measurements, observedState, 'temperatureC', 'temperature_c', roundOne(temperatureC), 25) || heartbeat;
  }
  if ('humidityPercent' in input.worldState) {
    heartbeat = addEnvironmentMeasurement(input, profile, reporting, measurements, observedState, 'humidityPercent', 'humidity_percent', roundOne(humidityPercent), 50) || heartbeat;
  }
  if (pm25 !== null) {
    heartbeat = addEnvironmentMeasurement(input, profile, reporting, measurements, observedState, 'pm25', 'pm25', roundOne(pm25), 0) || heartbeat;
  }
  if (co2 !== null) {
    heartbeat = addEnvironmentMeasurement(input, profile, reporting, measurements, observedState, 'co2', 'co2', roundOne(co2), 0) || heartbeat;
  }
  if (moisturePercent !== null) {
    heartbeat = addEnvironmentMeasurement(input, profile, reporting, measurements, observedState, 'moisturePercent', 'moisture_percent', roundOne(moisturePercent), 0) || heartbeat;
  }

  if (Object.keys(measurements).length === 0) {
    return null;
  }

  return createSensorObservation(input, measurements, profile, {
    noisy: Boolean(profile.driftPerDay) || Object.keys(measurements).length > 0,
    ...(heartbeat ? { heartbeat } : {})
  }, observedState);
}

function addEnvironmentMeasurement(
  input: SensorObservationInput,
  profile: SensorProfile,
  reporting: EnvironmentSensorReportingOptions,
  measurements: Record<string, number>,
  observedState: Record<string, number | string>,
  stateKey: keyof NonNullable<EnvironmentSensorReportingOptions['thresholds']>,
  measurementName: string,
  observedValue: number,
  fallback: number
): boolean {
  const threshold = reporting.thresholds?.[stateKey] ?? profile.reportOnChangeThreshold ?? 0;
  const previousRaw = input.previousObservation?.[stateKey];
  const previous = numberValue(previousRaw, fallback);
  const reportedAtKey = `${stateKey}ReportedAt`;
  const lastReportedAt = typeof input.previousObservation?.[reportedAtKey] === 'string'
    ? input.previousObservation[reportedAtKey]
    : typeof input.previousObservation?.lastObservedAt === 'string'
      ? input.previousObservation.lastObservedAt
      : undefined;
  const firstReport = previousRaw === undefined || !lastReportedAt;
  const changed = !firstReport && Math.abs(observedValue - previous) >= threshold;
  const heartbeat = !firstReport && !changed && isEnvironmentHeartbeatDue(input.currentTime, lastReportedAt, reporting);

  if (!firstReport && !changed && !heartbeat) {
    return false;
  }
  measurements[measurementName] = observedValue;
  observedState[stateKey] = observedValue;
  observedState[reportedAtKey] = input.currentTime;
  return heartbeat;
}

function copyReportedEnvironmentState(previousObservation?: Record<string, unknown>): Record<string, number | string> {
  const copy: Record<string, number | string> = {};
  if (!previousObservation) {
    return copy;
  }
  for (const [key, value] of Object.entries(previousObservation)) {
    if (typeof value === 'number' || typeof value === 'string') {
      copy[key] = value;
    }
  }
  return copy;
}

function isEnvironmentHeartbeatDue(
  currentTime: string,
  lastReportedAt: string,
  reporting: EnvironmentSensorReportingOptions
): boolean {
  const interval = reporting.heartbeatIntervalMinutes;
  if (!interval || interval <= 0) {
    return false;
  }
  const elapsedMs = Date.parse(currentTime) - Date.parse(lastReportedAt);
  if (elapsedMs < interval * 60 * 1000) {
    return false;
  }
  const offset = positiveModulo(reporting.heartbeatOffsetMinutes ?? 0, interval);
  const currentMinute = Math.floor(Date.parse(currentTime) / 60000);
  return positiveModulo(currentMinute, interval) === offset;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function createSensorObservation(
  input: SensorObservationInput,
  measurements: Record<string, number | boolean>,
  profile: SensorProfile,
  quality: EventLineage['quality'],
  observedState: Record<string, number | boolean | string>
): SensorObservation {
  const dropped = probabilityHit(profile.dropRate, input.randomSeed, `${input.deviceId}:drop:${input.currentTime}`);
  if (dropped) {
    return {
      event: createSensorTelemetry(input, { sample_dropped: true }, profile, {
        dropped: true
      }),
      observedState: {
        ...(input.previousObservation ?? {}),
        droppedSample: true,
        lastObservedAt: input.currentTime
      }
    };
  }

  const event = createSensorTelemetry(input, measurements, profile, quality);
  const duplicated = probabilityHit(profile.duplicateRate, input.randomSeed, `${input.deviceId}:duplicate:${input.currentTime}`);
  return {
    event,
    ...(duplicated ? {
      additionalEvents: [
        createSensorTelemetry(input, measurements, profile, {
          ...quality,
          duplicated: true
        })
      ]
    } : {}),
    observedState: {
      ...observedState,
      droppedSample: false,
      lastObservedAt: input.currentTime
    }
  };
}

export function createSensorTelemetry(
  input: SensorObservationInput,
  measurements: Record<string, number | boolean>,
  profile: SensorProfile,
  quality: EventLineage['quality'] = {}
): SensorObservation['event'] {
  const delayedMs = Math.round(sampleDistribution(profile.delayMs, input.randomSeed, `${input.deviceId}:delay:${input.currentTime}`));
  const ingestTime = addMilliseconds(input.currentTime, delayedMs);
  const sourceLayer: EventSourceLayer = 'sensor';
  return {
    type: 'DeviceTelemetry',
    roomId: input.roomId,
    deviceId: input.deviceId,
    deviceType: input.deviceType,
    measurements,
    sourceLayer,
    lineage: {
      eventTime: input.currentTime,
      ingestTime,
      sourceLayer,
      causeEventIds: [],
      episodeId: `sensor:${input.deviceId}`,
      observability: 'ml_observation',
      quality: {
        ...(delayedMs > 0 ? { delayedMs } : {}),
        ...quality
      },
      schemaVersion: 1,
      behaviorModelVersion: 'engine-v1'
    }
  };
}

function createOutOfOrderContactEvent(
  input: SensorObservationInput,
  profile: SensorProfile,
  contactOpen: boolean
): SensorObservation['event'] | null {
  if (
    typeof input.previousObservation?.contactOpen !== 'boolean' ||
    typeof input.previousObservation.lastObservedAt !== 'string' ||
    input.previousObservation.contactOpen === contactOpen ||
    !probabilityHit(profile.outOfOrderRate ?? 0, input.randomSeed, `${input.deviceId}:contact:out-of-order:${input.currentTime}`)
  ) {
    return null;
  }

  const staleEventTime = input.previousObservation.lastObservedAt;
  const delayedMs = Math.max(0, Date.parse(input.currentTime) - Date.parse(staleEventTime));
  return {
    type: 'DeviceTelemetry',
    roomId: input.roomId,
    deviceId: input.deviceId,
    deviceType: input.deviceType,
    measurements: {
      contact_open: input.previousObservation.contactOpen,
      confidence: 0.72
    },
    sourceLayer: 'sensor',
    lineage: {
      eventTime: staleEventTime,
      ingestTime: input.currentTime,
      sourceLayer: 'sensor',
      causeEventIds: [],
      episodeId: `sensor:${input.deviceId}`,
      observability: 'ml_observation',
      quality: {
        delayedMs,
        outOfOrder: true,
        confidence: 0.72
      },
      schemaVersion: 1,
      behaviorModelVersion: 'engine-v1'
    }
  };
}

function maybeSmoothMetric(
  metric: string,
  input: SensorObservationInput,
  smoothingFactor: number,
  profile: SensorProfile,
  noiseAmplitude: number
): number | null {
  if (!(metric in input.worldState)) {
    return null;
  }
  const current = numberValue(input.worldState[metric], 0);
  const previous = numberValue(input.previousObservation?.[metric], current);
  return smoothNumber(previous, current, smoothingFactor)
    + deterministicNoise(input.randomSeed, `${input.deviceId}:${metric}:${input.currentTime}`, noiseAmplitude)
    + (profile.driftPerDay ?? 0) * daysBetween(String(input.previousObservation?.lastObservedAt ?? input.currentTime), input.currentTime);
}

function smoothNumber(previous: number, current: number, factor: number): number {
  return previous + (current - previous) * factor;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function daysBetween(from: string, to: string): number {
  return Math.max(0, Date.parse(to) - Date.parse(from)) / 86_400_000;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function addMilliseconds(time: string, delayMs: number): string {
  const offsetMatch = time.match(/([+-]\d{2}:\d{2})$/);
  const offset = offsetMatch?.[1] ?? '+00:00';
  const date = new Date(Date.parse(time) + delayMs);
  const offsetMinutes = offsetToMinutes(offset);
  const local = new Date(date.getTime() + offsetMinutes * 60_000);
  const year = local.getUTCFullYear();
  const month = pad(local.getUTCMonth() + 1);
  const day = pad(local.getUTCDate());
  const hours = pad(local.getUTCHours());
  const minutes = pad(local.getUTCMinutes());
  const seconds = pad(local.getUTCSeconds());
  const milliseconds = local.getUTCMilliseconds();
  const fraction = milliseconds > 0 ? `.${String(milliseconds).padStart(3, '0')}` : '';
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${fraction}${offset}`;
}

function offsetToMinutes(offset: string): number {
  const sign = offset.startsWith('-') ? -1 : 1;
  const [hours, minutes] = offset.slice(1).split(':').map(Number);
  return sign * (hours * 60 + minutes);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
