import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/server/deviceEventStream';
import type { TwinEvent } from '../src/shared/types';
import {
  applyHomeMemoryBenchmarkObservationFaults,
  generateHomeMemoryBenchmark,
  validateHomeMemoryBenchmark
} from '../src/sim/evaluation/homeMemoryBenchmark';
import {
  calculateBinaryCalibration,
  calculateSetMetrics,
  evaluateHomeMemoryBenchmark,
  jaccardSimilarity,
  matchHomeMemoryBenchmarkEpisodes
} from '../src/sim/evaluation/homeMemoryBenchmarkEvaluator';
import { createHomeMemoryBenchmarkGroundTruth } from '../src/sim/evaluation/homeMemoryBenchmarkGroundTruth';
import {
  applyHomeMemoryBenchmarkIntervention,
  createHomeMemoryBenchmarkTemplateCatalog,
  expectedHomeMemoryBenchmarkFeatures,
  targetFeatureForIntervention
} from '../src/sim/evaluation/homeMemoryBenchmarkTemplates';
import { compileHouseholdRun } from '../src/sim/householdTemplate';

describe('Home Memory benchmark', () => {
  it('assigns each Household Template to exactly one split and compiles every template', () => {
    const catalog = createHomeMemoryBenchmarkTemplateCatalog();
    const splitByGroup = new Map<string, string>();

    for (const definition of catalog) {
      expect(splitByGroup.get(definition.householdGroupId) ?? definition.split).toBe(definition.split);
      splitByGroup.set(definition.householdGroupId, definition.split);
      const run = compileHouseholdRun(
        definition.template,
        { date: '2026-07-15', seed: 42 },
        definition.compilerOptions
      );
      expect(run.homeDefinition.building.id).toMatch(/^vh_benchmark_g\d+$/);
    }

    expect(new Set(catalog.map((definition) => definition.split))).toEqual(
      new Set(['train', 'validation', 'blind'])
    );
  });

  it('removes the intervention target from hidden semantic truth', () => {
    const baseline = createHomeMemoryBenchmarkTemplateCatalog()[0];
    const baselineFeatures = expectedHomeMemoryBenchmarkFeatures(baseline);

    for (const intervention of [
      'child_removed',
      'pet_removed',
      'remote_work_removed',
      'automation_removed'
    ] as const) {
      const target = targetFeatureForIntervention(intervention);
      const changed = applyHomeMemoryBenchmarkIntervention(baseline, intervention);
      expect(baselineFeatures).toContain(target);
      expect(expectedHomeMemoryBenchmarkFeatures(changed)).not.toContain(target);
      expect(() => compileHouseholdRun(
        changed.template,
        { date: '2026-07-15', seed: 42 },
        changed.compilerOptions
      )).not.toThrow();
    }
  });

  it('injects deterministic packet loss, latency, noise, and device offline windows', () => {
    const cleanEvents = Array.from({ length: 36 }, (_, index) => benchmarkEvent(index));
    const first = applyHomeMemoryBenchmarkObservationFaults(cleanEvents, {
      qualityProfile: 'harsh',
      seed: 17,
      days: 1
    });
    const second = applyHomeMemoryBenchmarkObservationFaults(cleanEvents, {
      qualityProfile: 'harsh',
      seed: 17,
      days: 1
    });

    expect(first).toEqual(second);
    expect(first.events.length).toBeLessThan(cleanEvents.length);
    expect(first.ledger.packetLoss.droppedSourceEventIds.length).toBeGreaterThan(0);
    expect(first.ledger.latency.delayedSourceEvents.length).toBeGreaterThan(0);
    expect(first.ledger.noise.changedEvents.length).toBeGreaterThan(0);
    expect(first.ledger.deviceOffline.deviceId).not.toBeNull();
    expect(first.ledger.deviceOffline.droppedSourceEventIds.length).toBeGreaterThan(0);
    expect(first.events.some((event, index, events) => (
      index > 0 && event.sequence < events[index - 1].sequence
    ))).toBe(true);
  });

  it('writes observation-only split folders and isolated private truth', () => {
    const outputRoot = join(mkdtempSync(join(tmpdir(), 'vh-home-memory-benchmark-')), 'benchmark');
    const summary = generateHomeMemoryBenchmark({
      outputRoot,
      days: 1,
      minutesPerDay: 1,
      conditionsPerTemplate: 1,
      includeInterventions: false
    });

    expect(summary.sampleCount).toBe(8);
    expect(summary.splitSampleCounts).toMatchObject({
      train: 3,
      validation: 2,
      blind: 3
    });
    expect(summary.validation.truthLeakCount).toBe(0);
    expect(validateHomeMemoryBenchmark(outputRoot)).toEqual(summary.validation);

    const publicManifest = readFileSync(join(outputRoot, 'public', 'manifest.json'), 'utf8');
    const privateManifest = readFileSync(join(outputRoot, 'private', 'manifest.json'), 'utf8');
    expect(publicManifest).not.toContain('templateId');
    expect(publicManifest).not.toContain('intervention');
    expect(privateManifest).toContain('templatePath');
  });

  it('derives episode, pattern, and feature truth from simulator layers', () => {
    const template = createHomeMemoryBenchmarkTemplateCatalog()[0].template;
    const childId = template.residents.find((resident) => (
      resident.profile?.ageBand === 'child'
    ))?.id;
    expect(childId).toBeDefined();
    const truth = createHomeMemoryBenchmarkGroundTruth([
      twinEvent(1, 'DeviceStateChanged', '2026-07-15T08:00:00+08:00', {
        roomId: 'entry',
        deviceId: 'lock',
        deviceType: 'door_lock',
        state: { locked: false }
      }),
      twinEvent(2, 'DeviceStateChanged', '2026-07-15T08:01:00+08:00', {
        roomId: 'entry',
        deviceId: 'lock',
        deviceType: 'door_lock',
        state: { locked: true }
      }),
      twinEvent(3, 'ActivityStarted', '2026-07-15T09:00:00+08:00', {
        activityId: 'core_household:remote_work:test',
        participants: ['adult'],
        roomId: 'work'
      }),
      twinEvent(4, 'ActivityStarted', '2026-07-15T21:00:00+08:00', {
        activityId: 'core_household:sleep:test',
        participants: [childId!],
        roomId: 'child_room'
      }),
      twinEvent(5, 'DeviceStateChanged', '2026-07-15T21:00:00+08:00', {
        roomId: 'child_room',
        deviceId: 'sleep',
        deviceType: 'sleep_sensor',
        state: { inBed: true }
      }),
      twinEvent(6, 'DeviceStateChanged', '2026-07-16T07:00:00+08:00', {
        roomId: 'child_room',
        deviceId: 'sleep',
        deviceType: 'sleep_sensor',
        state: { inBed: false }
      }),
      twinEvent(7, 'DeviceTelemetry', '2026-07-15T00:01:00+08:00', {
        roomId: 'adult_room',
        deviceId: 'adult_sleep',
        deviceType: 'sleep_sensor',
        measurements: { in_bed: true }
      }),
      twinEvent(8, 'DeviceStateChanged', '2026-07-15T06:30:00+08:00', {
        roomId: 'adult_room',
        deviceId: 'adult_sleep',
        deviceType: 'sleep_sensor',
        state: { inBed: false }
      })
    ], template);

    expect(truth.episodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'door_access_episode', durationMinutes: 1 }),
      expect.objectContaining({ kind: 'sleep_episode', durationMinutes: 600 }),
      expect.objectContaining({
        kind: 'sleep_episode',
        durationMinutes: 389,
        boundarySource: 'left_censored'
      }),
      expect.objectContaining({ kind: 'work_study_episode', durationMinutes: 0 })
    ]));
    expect(truth.patterns.map((pattern) => pattern.id)).toEqual(expect.arrayContaining([
      'door-lock-paired',
      'child-sleep-start',
      'study-weekday-daytime-work'
    ]));
    expect(truth.positiveFeatureIds).toEqual(expect.arrayContaining([
      'feature:door_unlock_lock_pairing',
      'feature:early_sleep_zone_around_21',
      'feature:weekday_study_daytime_activity'
    ]));
  });

  it('calculates episode F1, boundary errors, pattern metrics, calibration, and stability', () => {
    const episode = matchHomeMemoryBenchmarkEpisodes([{
      id: 'truth_1',
      kind: 'sleep_episode',
      roomIds: ['bedroom'],
      deviceIds: ['sleep'],
      participantIds: [],
      startedAt: '2026-07-15T21:00:00+08:00',
      endedAt: '2026-07-16T07:00:00+08:00',
      durationMinutes: 600,
      sourceEventIds: ['source_1', 'source_2'],
      boundarySource: 'world_state'
    }], [{
      id: 'predicted_1',
      kind: 'sleep_episode',
      roomIds: ['bedroom'],
      deviceIds: ['sleep'],
      startedAt: '2026-07-15T21:05:00+08:00',
      endedAt: '2026-07-16T06:55:00+08:00',
      durationMinutes: 590,
      features: {},
      evidenceIds: ['event_1', 'event_2']
    }]);
    expect(episode).toMatchObject({
      truePositive: 1,
      falsePositive: 0,
      falseNegative: 0,
      f1: 1,
      startBoundaryErrorMinutes: { mean: 5 },
      endBoundaryErrorMinutes: { mean: 5 }
    });
    const censored = matchHomeMemoryBenchmarkEpisodes([{
      id: 'truth_censored',
      kind: 'sleep_episode',
      roomIds: ['bedroom'],
      deviceIds: ['sleep'],
      participantIds: [],
      startedAt: '2026-07-16T21:00:00+08:00',
      endedAt: '2026-07-16T21:00:00+08:00',
      durationMinutes: 0,
      sourceEventIds: ['source_3'],
      boundarySource: 'right_censored'
    }], [{
      id: 'predicted_censored',
      kind: 'sleep_episode',
      roomIds: ['bedroom'],
      deviceIds: ['sleep'],
      startedAt: '2026-07-16T21:03:00+08:00',
      endedAt: '2026-07-16T23:59:00+08:00',
      durationMinutes: 176,
      features: {},
      evidenceIds: ['event_3']
    }]);
    expect(censored).toMatchObject({
      truePositive: 1,
      startBoundaryErrorMinutes: { count: 1, mean: 3 },
      endBoundaryErrorMinutes: { count: 0, mean: null }
    });
    const leftCensored = matchHomeMemoryBenchmarkEpisodes([{
      id: 'truth_left_censored',
      kind: 'sleep_episode',
      roomIds: ['bedroom'],
      deviceIds: ['sleep'],
      participantIds: [],
      startedAt: '2026-07-16T00:01:00+08:00',
      endedAt: '2026-07-16T06:30:00+08:00',
      durationMinutes: 389,
      sourceEventIds: ['source_4', 'source_5'],
      boundarySource: 'left_censored'
    }], [{
      id: 'predicted_left_censored',
      kind: 'sleep_episode',
      roomIds: ['bedroom'],
      deviceIds: ['sleep'],
      startedAt: '2026-07-16T00:05:00+08:00',
      endedAt: '2026-07-16T06:25:00+08:00',
      durationMinutes: 380,
      features: {},
      evidenceIds: ['event_4']
    }]);
    expect(leftCensored).toMatchObject({
      truePositive: 1,
      startBoundaryErrorMinutes: { count: 0, mean: null },
      endBoundaryErrorMinutes: { count: 1, mean: 5 }
    });
    expect(calculateSetMetrics(['a', 'b'], ['b', 'c'])).toMatchObject({
      precision: 0.5,
      recall: 0.5,
      f1: 0.5
    });
    expect(calculateBinaryCalibration([
      { label: 'positive', probability: 0.8, truth: 1 },
      { label: 'negative', probability: 0.2, truth: 0 }
    ])).toMatchObject({
      brierScore: 0.04,
      ece: 0.2
    });
    expect(jaccardSimilarity(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3, 4);
  });

  it('writes all quantitative results under private evaluation', () => {
    const outputRoot = join(
      mkdtempSync(join(tmpdir(), 'vh-home-memory-benchmark-evaluator-')),
      'benchmark'
    );
    generateHomeMemoryBenchmark({
      outputRoot,
      days: 1,
      minutesPerDay: 1,
      conditionsPerTemplate: 1,
      includeInterventions: false
    });
    const report = evaluateHomeMemoryBenchmark({ benchmarkRoot: outputRoot });

    expect(report.schemaVersion).toBe(2);
    expect(report.samples).toHaveLength(8);
    expect(report.overall.calibration).toHaveProperty('brierScore');
    expect(report.overall.episode).toHaveProperty('f1');
    expect(report.overall.pattern).toHaveProperty('precision');
    expect(report.overall.timeToDetection).toHaveProperty('feature');
    expect(report.overall.adjacentWindowStability).toHaveProperty('mean');
    expect(report.overall.counterfactualSensitivity).toHaveProperty('probabilityDrop');
    expect(existsSync(join(
      outputRoot,
      'private',
      'evaluation',
      'home-memory-metrics.json'
    ))).toBe(true);
    expect(existsSync(join(outputRoot, 'public', 'home-memory-metrics.json'))).toBe(false);
  });

  it('rejects samples longer than two months', () => {
    const outputRoot = join(mkdtempSync(join(tmpdir(), 'vh-home-memory-benchmark-limit-')), 'benchmark');
    expect(() => generateHomeMemoryBenchmark({
      outputRoot,
      days: 61
    })).toThrow(/days must be an integer from 1 to 60/);
  });
});

function benchmarkEvent(index: number): DeviceValueEvent {
  const hour = 8 + (index % 9);
  const deviceIndex = index % 2;
  return {
    id: `event_${index}`,
    sourceEventId: `source_${index}`,
    sourceEventType: 'DeviceTelemetry',
    runId: 'benchmark_test',
    sequence: index + 1,
    ts: `2026-07-14T${hour.toString().padStart(2, '0')}:00:00+08:00`,
    simTime: `2026-07-14T${hour.toString().padStart(2, '0')}:00:00+08:00`,
    homeId: 'home_1',
    roomId: `room_${deviceIndex}`,
    deviceId: `sensor_${deviceIndex}`,
    deviceType: 'temperature_humidity_sensor',
    field: index % 2 === 0 ? 'temperatureC' : 'humidityPercent',
    value: 20 + index,
    simulationDayIndex: 0,
    simulationDate: '2026-07-14'
  };
}

function twinEvent(
  sequence: number,
  type: TwinEvent['type'],
  simTime: string,
  fields: Record<string, unknown>
): TwinEvent {
  const sourceLayer = type === 'ActivityStarted' ? 'truth' : 'world';
  return {
    id: `twin_${sequence}`,
    runId: 'benchmark_truth_test',
    type,
    ts: simTime,
    simTime,
    homeId: 'home_1',
    scenarioId: 'household_test',
    sequence,
    sourceLayer,
    lineage: {
      eventTime: simTime,
      ingestTime: simTime,
      sourceLayer,
      causeEventIds: [],
      episodeId: `episode_${sequence}`,
      observability: 'observable',
      quality: {},
      schemaVersion: 1,
      behaviorModelVersion: 'test'
    },
    ...fields
  } as unknown as TwinEvent;
}
