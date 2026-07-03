import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getHomeDefinition } from '../src/sim/catalog';
import { createSimulator } from '../src/sim/engine';
import { buildEvaluationReport, compareDownstreamUtilityGaps } from '../src/sim/evaluation/metrics';
import { createEvaluationCliOutput, createEvaluationCliReport, createTrainingDataset, parseEvaluationCliArgs, runSimulationEvaluation } from '../src/sim/evaluation/runEvaluation';
import { createHomeMemoryDeviceEventDataset, createHomeMemoryDeviceEventDatasetCliReport, writeHomeMemoryDeviceEventDatasetCliReport } from '../src/sim/evaluation/homeMemoryDataset';
import type { ActivityStartedEvent, ConversationOccurredEvent, DeviceStateChangedEvent, DeviceTelemetryEvent, PersonMovedEvent } from '../src/shared/types';

describe('long horizon simulation evaluation', () => {
  it('generates a reproducible observation-only training dataset with separate truth labels', () => {
    const first = createTrainingDataset({
      startDate: '2026-07-14',
      days: 1,
      seed: 42,
      minutesPerDay: 120
    });
    const second = createTrainingDataset({
      startDate: '2026-07-14',
      days: 1,
      seed: 42,
      minutesPerDay: 120
    });

    expect(first).toEqual(second);
    expect(first.metadata).toMatchObject({
      schemaVersion: 1,
      startDate: '2026-07-14',
      days: 1,
      seed: 42,
      minutesPerDay: 120
    });
    expect(first.examples.length).toBeGreaterThan(0);
    const example = first.examples[0];

    expect(example.observations.length).toBeGreaterThan(0);
    expect(example.observations.every((event) => (
      event.type === 'DeviceTelemetry' && event.sourceLayer === 'sensor' ||
      event.type === 'DeviceStateChanged' && event.sourceLayer === 'world'
    ))).toBe(true);
    expect(JSON.stringify(example.observations)).not.toContain('eventExplanation');
    expect(example.observations.some((event) => event.type === 'DeviceStateChanged')).toBe(true);
    expect(example.observations
      .filter((event) => event.type === 'DeviceStateChanged')
      .every((event) => event.lineage.observability === 'ml_observation' && event.lineage.causeEventIds.length === 0)).toBe(true);
    expect(example.truth.homeMode).toEqual(expect.any(String));
    expect(example.truth.people.adult_1).toMatchObject({
      location: expect.any(String),
      activity: expect.any(String)
    });
    expect(example.truth.risks).toMatchObject({
      fridgeLeftOpen: expect.any(Boolean),
      networkOffline: expect.any(Boolean),
      waterLeak: expect.any(Boolean),
      seniorNoActivity: expect.any(Boolean)
    });
  });

  it('formats a JSON evaluation report from CLI arguments', () => {
    const options = parseEvaluationCliArgs([
      '--start-date', '2026-07-14',
      '--days', '1',
      '--seed', '42',
      '--minutes-per-day', '60'
    ]);

    expect(options).toEqual({
      startDate: '2026-07-14',
      days: 1,
      seed: 42,
      minutesPerDay: 60
    });

    const output = createEvaluationCliReport(options);
    const report = JSON.parse(output);

    expect(report.days).toHaveLength(1);
    expect(report.totalEvents).toBeGreaterThan(0);
    expect(report.logic.totalChecks).toBeGreaterThan(0);
    expect(report.sensor.telemetryEvents).toBeGreaterThan(0);
    expect(report.inference.forecastEvaluation.samples).toBeGreaterThanOrEqual(0);
  });

  it('formats a JSON training dataset from CLI arguments', () => {
    const output = createEvaluationCliOutput([
      '--dataset',
      '--start-date', '2026-07-14',
      '--days', '1',
      '--seed', '42',
      '--minutes-per-day', '60'
    ]);
    const dataset = JSON.parse(output);

    expect(dataset.metadata).toMatchObject({
      schemaVersion: 1,
      startDate: '2026-07-14',
      days: 1,
      seed: 42,
      minutesPerDay: 60
    });
    expect(dataset.examples.length).toBeGreaterThan(0);
    expect(dataset.examples[0].observations.length).toBeGreaterThan(0);
    expect(dataset.examples[0].truth.homeMode).toEqual(expect.any(String));
  });

  it('generates a reproducible Home Memory dataset with /ws/device-events shaped events', () => {
    const first = createHomeMemoryDeviceEventDataset({
      startDate: '2026-07-14',
      days: 1,
      seed: 42,
      minutesPerDay: 120
    });
    const second = createHomeMemoryDeviceEventDataset({
      startDate: '2026-07-14',
      days: 1,
      seed: 42,
      minutesPerDay: 120
    });

    expect(first).toEqual(second);
    expect(first.metadata).toMatchObject({
      schemaVersion: 1,
      source: '/ws/device-events',
      startDate: '2026-07-14',
      days: 1,
      seed: 42,
      minutesPerDay: 120,
      runId: 'home_memory_dataset_2026_07_14_1d_seed_42'
    });
    expect(first.events.length).toBeGreaterThan(0);
    expect(first.metadata.eventCount).toBe(first.events.length);
    expect(first.metadata.sequenceRange.from).toBeLessThanOrEqual(first.metadata.sequenceRange.to);
    expect(first.events[0]).toMatchObject({
      sourceEventType: expect.stringMatching(/DeviceTelemetry|DeviceStateChanged/),
      runId: first.metadata.runId,
      sequence: expect.any(Number),
      simulationDayIndex: 0,
      simulationDate: '2026-07-14',
      homeId: expect.any(String),
      roomId: expect.any(String),
      deviceId: expect.any(String),
      deviceType: expect.any(String),
      field: expect.any(String)
    });
    expect(first.events.every((event) => event.runId === first.metadata.runId)).toBe(true);
    expect(first.events.every((event) => event.simulationDayIndex === 0 && event.simulationDate === '2026-07-14')).toBe(true);
    expect(first.events.every((event) => Object.prototype.hasOwnProperty.call(event, 'value'))).toBe(true);
    expect(first.metadata.simulationDays).toEqual([expect.objectContaining({
      index: 0,
      date: '2026-07-14',
      eventCount: first.events.length
    })]);
  });

  it('formats a JSON Home Memory device-event dataset from CLI arguments', () => {
    const output = createHomeMemoryDeviceEventDatasetCliReport([
      '--start-date', '2026-07-14',
      '--days', '1',
      '--seed', '42',
      '--minutes-per-day', '60'
    ]);
    const dataset = JSON.parse(output);

    expect(dataset.metadata).toMatchObject({
      schemaVersion: 1,
      source: '/ws/device-events',
      startDate: '2026-07-14',
      days: 1,
      seed: 42,
      minutesPerDay: 60
    });
    expect(dataset.events.length).toBeGreaterThan(0);
  });

  it('writes clean UTF-8 Home Memory dataset JSON directly to an output file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'virtualhome-memory-dataset-'));

    try {
      const outputPath = join(dir, 'home-memory.json');
      const cliOutput = writeHomeMemoryDeviceEventDatasetCliReport([
        '--start-date', '2026-07-14',
        '--days', '1',
        '--seed', '42',
        '--minutes-per-day', '60',
        '--output', outputPath
      ]);
      const text = readFileSync(outputPath, 'utf8');
      const dataset = JSON.parse(text);

      expect(cliOutput).toContain(outputPath);
      expect(text.trimStart().startsWith('{')).toBe(true);
      expect(text).not.toContain('> virtualhome-twin-demo');
      expect(dataset.metadata).toMatchObject({
        schemaVersion: 1,
        source: '/ws/device-events',
        startDate: '2026-07-14',
        days: 1,
        seed: 42,
        minutesPerDay: 60
      });
      expect(dataset.events.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not generate closed-fridge contact-open false positives in a two-day Home Memory dataset', () => {
    const dataset = createHomeMemoryDeviceEventDataset({
      startDate: '2026-07-01',
      days: 2,
      seed: 42,
      minutesPerDay: 24 * 60
    });
    let fridgeOpen = false;
    let contactOpenEvents = 0;
    let closedContactOpenEvents = 0;

    for (const event of dataset.events.filter((item) => item.deviceId === 'fridge_01')) {
      if (event.field === 'doorOpen') {
        fridgeOpen = event.value === true;
      }
      if (event.field === 'contact_open' && event.value === true) {
        contactOpenEvents += 1;
        if (!fridgeOpen) {
          closedContactOpenEvents += 1;
        }
      }
    }

    expect(contactOpenEvents).toBeGreaterThan(0);
    expect(closedContactOpenEvents).toBe(0);
  });

  it('keeps controller state out of telemetry and reduces environment heartbeat volume', () => {
    const dataset = createHomeMemoryDeviceEventDataset({
      startDate: '2026-07-01',
      days: 2,
      seed: 42,
      minutesPerDay: 24 * 60
    });
    const acTelemetry = dataset.events.filter((event) => (
      event.deviceType === 'air_conditioner' &&
      event.sourceEventType === 'DeviceTelemetry' &&
      ['power_on', 'target_c', 'mode'].includes(event.field)
    ));
    const acStateChanges = dataset.events.filter((event) => (
      event.deviceType === 'air_conditioner' &&
      event.sourceEventType === 'DeviceStateChanged' &&
      ['power', 'targetC', 'mode'].includes(event.field)
    ));
    const environmentTelemetry = dataset.events.filter((event) => (
      event.sourceEventType === 'DeviceTelemetry' &&
      ['temperature_humidity_sensor', 'air_quality_sensor', 'soil_moisture_sensor'].includes(event.deviceType)
    ));
    const reportsByMinute = new Map<string, Set<string>>();
    for (const event of environmentTelemetry) {
      const devices = reportsByMinute.get(event.simTime) ?? new Set<string>();
      devices.add(event.deviceId);
      reportsByMinute.set(event.simTime, devices);
    }
    const crowdedMinutes = [...reportsByMinute.values()].filter((devices) => devices.size > 2);

    expect(acTelemetry).toHaveLength(0);
    expect(acStateChanges.length).toBeGreaterThan(0);
    expect(environmentTelemetry.length).toBeGreaterThan(500);
    expect(environmentTelemetry.length).toBeLessThan(2500);
    expect(crowdedMinutes.length).toBeLessThan(12);
  });

  it('generates deterministic multi-day quality metrics for a fixed seed', () => {
    const first = runSimulationEvaluation({
      startDate: '2026-07-14',
      days: 2,
      seed: 42,
      minutesPerDay: 240
    });
    const second = runSimulationEvaluation({
      startDate: '2026-07-14',
      days: 2,
      seed: 42,
      minutesPerDay: 240
    });

    expect(first).toEqual(second);
    expect(first.days).toHaveLength(2);
    expect(first.days[0].externalContext).toMatchObject({
      calendar: {
        date: '2026-07-14',
        season: 'summer',
        schoolDay: true,
        workday: true
      },
      weather: {
        condition: expect.any(String),
        outdoorTemperatureC: expect.any(Number)
      }
    });
    expect(first.totalEvents).toBeGreaterThan(0);
    expect(first.logic.totalChecks).toBeGreaterThan(0);
    expect(Object.values(first.behavior.activityCounts).reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
    expect(Object.keys(first.behavior.transitionMatrix).length).toBeGreaterThan(0);
    expect(first.sensor.telemetryEvents).toBeGreaterThan(0);
    expect(first.sensor.eventsByDeviceType.motion_sensor).toBeGreaterThan(0);
    expect(first.inference.samples).toBeGreaterThan(0);
    expect(first.inference.personRoomTop1Accuracy).toBeGreaterThanOrEqual(0);
    expect(first.inference.personRoomTop1Accuracy).toBeLessThanOrEqual(1);
    expect(first.inference.forecastEvaluation.samples).toBeGreaterThan(0);
    expect(first.inference.forecastEvaluation.homeModeAccuracyByHorizon[15]).toBeGreaterThanOrEqual(0);
    expect(first.inference.forecastEvaluation.homeModeAccuracyByHorizon[15]).toBeLessThanOrEqual(1);
    expect(first.inference.forecastEvaluation.homeModeAccuracyByHorizon[60]).toBeGreaterThanOrEqual(0);
    expect(first.inference.forecastEvaluation.averageRiskBrierScoreByHorizon[30]).toBeGreaterThanOrEqual(0);
    expect(first.inference.forecastEvaluation.averageRiskBrierScoreByHorizon[30]).toBeLessThanOrEqual(1);
  });

  it('passes real household validation samples through the long-horizon evaluation entrypoint', () => {
    const report = runSimulationEvaluation({
      startDate: '2026-07-14',
      days: 1,
      seed: 42,
      minutesPerDay: 180,
      realWorldValidationSamples: [{
        currentTime: '2026-07-14T20:30:00+08:00',
        eventsUntilNow: [],
        truth: {
          homeMode: 'evening_home',
          risks: {
            fridge_left_open: false,
            network_impact: false,
            stove_unattended: false,
            senior_no_activity: false,
            water_leak: false
          }
        }
      }]
    });

    expect(report.inference.downstreamUtility.realWorldValidation.samples).toBe(1);
    expect(report.inference.downstreamUtility.syntheticToRealGap).toMatchObject({
      homeModeAccuracyGap: expect.any(Number),
      riskBrierScoreGap: expect.any(Number)
    });
  });

  it('reports behavior timing, weekday-weekend differences, and habit stability metrics', () => {
    const report = runSimulationEvaluation({
      startDate: '2026-07-14',
      days: 7,
      seed: 42,
      minutesPerDay: 360
    });

    expect(Object.keys(report.behavior.activityStartMinutes).length).toBeGreaterThan(0);
    expect(Object.values(report.behavior.activityStartMinutes)[0]).toMatchObject({
      samples: expect.any(Number),
      averageMinute: expect.any(Number),
      earliestMinute: expect.any(Number),
      latestMinute: expect.any(Number)
    });
    expect(Object.keys(report.behavior.activityDurationMinutes).length).toBeGreaterThan(0);
    expect(Object.values(report.behavior.activityDurationMinutes)[0]).toMatchObject({
      samples: expect.any(Number),
      averageMinutes: expect.any(Number),
      shortestMinutes: expect.any(Number),
      longestMinutes: expect.any(Number)
    });
    expect(Object.values(report.behavior.weekdayWeekendActivityCounts.weekday).reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
    expect(Object.values(report.behavior.weekdayWeekendActivityCounts.weekend).reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
    expect(Object.keys(report.behavior.trajectoryDivergenceByPerson).length).toBeGreaterThan(1);
    expect(Object.values(report.behavior.trajectoryDivergenceByPerson).every((score) => score >= 0 && score <= 1)).toBe(true);
    expect(report.behavior.habitStabilityScore).toBeGreaterThanOrEqual(0);
    expect(report.behavior.habitStabilityScore).toBeLessThanOrEqual(1);
    expect(report.behavior.shortTermVariationScore).toBeGreaterThanOrEqual(0);
    expect(report.behavior.shortTermVariationScore).toBeLessThanOrEqual(1);
  });

  it('measures overlapping same-activity durations as separate activity instances', () => {
    const baseActivity: ActivityStartedEvent = {
      id: 'watch_tv_start_1',
      runId: 'run_duration',
      type: 'ActivityStarted',
      ts: '2026-06-17T19:00:00+08:00',
      simTime: '2026-06-17T19:00:00+08:00',
      homeId: 'default_home',
      scenarioId: 'weekday_normal',
      sequence: 1,
      sourceLayer: 'truth',
      lineage: {
        eventTime: '2026-06-17T19:00:00+08:00',
        ingestTime: '2026-06-17T19:00:00+08:00',
        sourceLayer: 'truth',
        causeEventIds: [],
        episodeId: 'test',
        observability: 'private',
        quality: {},
        schemaVersion: 1,
        behaviorModelVersion: 'test'
      },
      activityId: 'watch_tv',
      participants: ['adult_1'],
      roomId: 'living_room'
    };
    const events = [
      baseActivity,
      {
        ...baseActivity,
        id: 'watch_tv_start_2',
        sequence: 2,
        ts: '2026-06-17T19:02:00+08:00',
        simTime: '2026-06-17T19:02:00+08:00',
        participants: ['child_1']
      },
      {
        ...baseActivity,
        id: 'watch_tv_end_1',
        type: 'ActivityEnded' as const,
        sequence: 3,
        ts: '2026-06-17T19:10:00+08:00',
        simTime: '2026-06-17T19:10:00+08:00'
      },
      {
        ...baseActivity,
        id: 'watch_tv_end_2',
        type: 'ActivityEnded' as const,
        sequence: 4,
        ts: '2026-06-17T19:12:00+08:00',
        simTime: '2026-06-17T19:12:00+08:00',
        participants: ['child_1']
      }
    ];

    const report = buildEvaluationReport({
      days: [{ date: '2026-06-17', events, finalSnapshot: null }],
      homeDefinition: getHomeDefinition()
    });

    expect(report.behavior.activityDurationMinutes.watch_tv).toMatchObject({
      samples: 2,
      averageMinutes: 10,
      shortestMinutes: 10,
      longestMinutes: 10
    });
  });

  it('reports truth-only agent memory summaries in behavior evaluation', () => {
    const activityBase: ActivityStartedEvent = {
      id: 'activity_1',
      runId: 'run_memory',
      type: 'ActivityStarted',
      ts: '2026-06-17T19:00:00+08:00',
      simTime: '2026-06-17T19:00:00+08:00',
      homeId: 'default_home',
      scenarioId: 'weekday_normal',
      sequence: 1,
      sourceLayer: 'truth',
      lineage: {
        eventTime: '2026-06-17T19:00:00+08:00',
        ingestTime: '2026-06-17T19:00:00+08:00',
        sourceLayer: 'truth',
        causeEventIds: [],
        episodeId: 'test',
        observability: 'private',
        quality: {},
        schemaVersion: 1,
        behaviorModelVersion: 'test'
      },
      activityId: 'study_homework',
      participants: ['child_1'],
      roomId: 'living_room'
    };
    const conversation: ConversationOccurredEvent = {
      ...activityBase,
      id: 'conversation_1',
      type: 'ConversationOccurred',
      sequence: 3,
      conversationId: 'conversation_1',
      speakerId: 'adult_1',
      listenerIds: ['child_1'],
      topic: 'homework_reminder',
      intent: 'support_child_routine',
      roomId: 'living_room',
      summary: 'Adult reminded child about homework.'
    };
    const sensorLikeActivity: ActivityStartedEvent = {
      ...activityBase,
      id: 'activity_sensor',
      sequence: 4,
      sourceLayer: 'sensor',
      lineage: {
        ...activityBase.lineage,
        sourceLayer: 'sensor',
        observability: 'ml_observation'
      },
      activityId: 'false_sensor_activity'
    };

    const report = buildEvaluationReport({
      days: [{
        date: '2026-06-17',
        events: [
          activityBase,
          { ...activityBase, id: 'activity_2', sequence: 2 },
          conversation,
          sensorLikeActivity
        ],
        finalSnapshot: null
      }],
      homeDefinition: getHomeDefinition()
    });

    expect(report.behavior.agentMemorySummaries.child_1).toMatchObject({
      personId: 'child_1',
      topActivities: [expect.objectContaining({ activityId: 'study_homework', count: 2 })],
      socialTopics: [expect.objectContaining({ topic: 'homework_reminder', count: 1 })]
    });
    expect(report.behavior.agentMemorySummaries.child_1.summary).toContain('study_homework x2');
    expect(report.behavior.agentMemorySummaries.child_1.summary).not.toContain('false_sensor_activity');
  });

  it('reports scheduled commitment coverage from observed truth activities', () => {
    const homeworkStarted: ActivityStartedEvent = {
      id: 'homework_started',
      runId: 'run_schedule',
      type: 'ActivityStarted',
      ts: '2026-07-14T17:00:00+08:00',
      simTime: '2026-07-14T17:00:00+08:00',
      homeId: 'default_home',
      scenarioId: 'weekday_normal',
      sequence: 1,
      sourceLayer: 'truth',
      lineage: {
        eventTime: '2026-07-14T17:00:00+08:00',
        ingestTime: '2026-07-14T17:00:00+08:00',
        sourceLayer: 'truth',
        causeEventIds: [],
        episodeId: 'test',
        observability: 'private',
        quality: {},
        schemaVersion: 1,
        behaviorModelVersion: 'test'
      },
      activityId: 'study_homework',
      participants: ['child_1'],
      roomId: 'living_room'
    };
    const sensorHomeworkStarted: ActivityStartedEvent = {
      ...homeworkStarted,
      id: 'sensor_homework_started',
      sequence: 2,
      sourceLayer: 'sensor',
      lineage: {
        ...homeworkStarted.lineage,
        sourceLayer: 'sensor',
        observability: 'ml_observation'
      }
    };

    const report = buildEvaluationReport({
      days: [{ date: '2026-07-14', events: [homeworkStarted, sensorHomeworkStarted], finalSnapshot: null }],
      homeDefinition: getHomeDefinition()
    });

    expect(report.behavior.commitmentCoverageByPerson.child_1).toMatchObject({
      personId: 'child_1',
      observedActivityIds: expect.arrayContaining(['study_homework']),
      missedActivityIds: expect.arrayContaining(['eat_meal'])
    });
    expect(report.behavior.commitmentCoverageByPerson.child_1.observedCommitments).toBe(1);
    expect(report.behavior.commitmentCoverageByPerson.child_1.totalCommitments).toBeGreaterThan(1);
  });

  it('carries household inventory across evaluation days instead of resetting it', () => {
    const report = runSimulationEvaluation({
      startDate: '2026-07-14',
      days: 3,
      seed: 42,
      minutesPerDay: 60
    });

    expect(report.days[0].inventory.dirtyLaundryKg).toBeGreaterThan(1.2);
    expect(report.days[1].inventory.dirtyLaundryKg).toBeGreaterThan(report.days[0].inventory.dirtyLaundryKg);
    expect(report.days[2].inventory.sleepDebtHours).toBeGreaterThan(report.days[1].inventory.sleepDebtHours);
    expect(report.days[2].inventory.pendingChores).toEqual(expect.arrayContaining(['laundry']));
  });

  it('reports sensor burst silence correlation lag and false-positive metrics', () => {
    const report = runSimulationEvaluation({
      startDate: '2026-07-14',
      days: 3,
      seed: 42,
      minutesPerDay: 720
    });

    expect(Object.keys(report.sensor.burstCountByDevice).length).toBeGreaterThan(0);
    expect(Object.keys(report.sensor.longestSilentMinutesByDevice).length).toBeGreaterThan(0);
    expect(Object.values(report.sensor.longestSilentMinutesByDevice).every((minutes) => minutes >= 0)).toBe(true);
    expect(report.sensor.deviceCorrelations.length).toBeGreaterThan(0);
    expect(report.sensor.deviceCorrelations[0]).toMatchObject({
      leftDeviceId: expect.any(String),
      rightDeviceId: expect.any(String),
      sameMinuteCount: expect.any(Number)
    });
    expect(report.sensor.stoveLag).toMatchObject({
      pm25LagMinutes: expect.any(Number),
      temperatureLagMinutes: expect.any(Number),
      sampleCount: expect.any(Number)
    });
    expect(report.sensor.co2OccupancyCorrelation).toBeGreaterThanOrEqual(-1);
    expect(report.sensor.co2OccupancyCorrelation).toBeLessThanOrEqual(1);
    expect(report.sensor.petMotionFalsePositiveRatio).toBeGreaterThanOrEqual(0);
    expect(report.sensor.petMotionFalsePositiveRatio).toBeLessThanOrEqual(1);
    expect(report.sensor.droppedEvents).toBeGreaterThanOrEqual(0);
    expect(report.sensor.outOfOrderEvents).toBeGreaterThanOrEqual(0);
    expect(report.sensor.qualityRatios).toMatchObject({
      delayed: expect.any(Number),
      noisy: expect.any(Number),
      duplicated: expect.any(Number),
      dropped: expect.any(Number),
      outOfOrder: expect.any(Number)
    });
    expect(Object.values(report.sensor.qualityRatios).every((ratio) => ratio >= 0 && ratio <= 1)).toBe(true);
  });

  it('reports out-of-order telemetry in sensor quality metrics', () => {
    const staleContact: DeviceTelemetryEvent = {
      id: 'stale_contact',
      runId: 'run_sensor_quality',
      type: 'DeviceTelemetry',
      ts: '2026-06-17T08:01:00+08:00',
      simTime: '2026-06-17T08:01:00+08:00',
      homeId: 'default_home',
      scenarioId: 'weekday_normal',
      sequence: 1,
      sourceLayer: 'sensor',
      lineage: {
        eventTime: '2026-06-17T08:00:00+08:00',
        ingestTime: '2026-06-17T08:01:00+08:00',
        sourceLayer: 'sensor',
        causeEventIds: [],
        episodeId: 'sensor:fridge_01',
        observability: 'ml_observation',
        quality: {
          delayedMs: 60000,
          outOfOrder: true,
          confidence: 0.72
        },
        schemaVersion: 1,
        behaviorModelVersion: 'test'
      },
      roomId: 'kitchen',
      deviceId: 'fridge_01',
      deviceType: 'fridge',
      measurements: {
        contact_open: false,
        confidence: 0.72
      }
    };

    const report = buildEvaluationReport({
      days: [{ date: '2026-06-17', events: [staleContact], finalSnapshot: null }],
      homeDefinition: getHomeDefinition()
    });

    expect(report.sensor.outOfOrderEvents).toBe(1);
    expect(report.sensor.qualityRatios.outOfOrder).toBe(1);
  });

  it('reports downstream utility metrics from a synthetic observation-trained baseline', () => {
    const report = runSimulationEvaluation({
      startDate: '2026-07-14',
      days: 3,
      seed: 42,
      minutesPerDay: 240
    });

    expect(report.inference.downstreamUtility).toMatchObject({
      trainExamples: expect.any(Number),
      holdoutExamples: expect.any(Number),
      homeModeTop1Accuracy: expect.any(Number),
      averageRiskBrierScore: expect.any(Number),
      featureCoverageRatio: expect.any(Number)
    });
    expect(report.inference.downstreamUtility.trainExamples).toBeGreaterThan(0);
    expect(report.inference.downstreamUtility.holdoutExamples).toBeGreaterThan(0);
    expect(report.inference.downstreamUtility.homeModeTop1Accuracy).toBeGreaterThanOrEqual(0);
    expect(report.inference.downstreamUtility.homeModeTop1Accuracy).toBeLessThanOrEqual(1);
    expect(report.inference.downstreamUtility.averageRiskBrierScore).toBeGreaterThanOrEqual(0);
    expect(report.inference.downstreamUtility.averageRiskBrierScore).toBeLessThanOrEqual(1);
    expect(report.inference.downstreamUtility.featureCoverageRatio).toBeGreaterThanOrEqual(0);
    expect(report.inference.downstreamUtility.featureCoverageRatio).toBeLessThanOrEqual(1);
  });

  it('reports synthetic-to-real downstream validation gap when real observation samples are provided', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    const snapshot = simulator.getSnapshot();
    const eveningSnapshot = structuredClone(snapshot);
    eveningSnapshot.homeState.mode = 'evening_home';
    const morningSnapshot = structuredClone(snapshot);
    morningSnapshot.homeState.mode = 'morning';
    const leakTelemetry: DeviceTelemetryEvent = {
      id: 'real_leak_observation',
      runId: 'run_real_validation',
      type: 'DeviceTelemetry',
      ts: snapshot.simClock.currentTime,
      simTime: snapshot.simClock.currentTime,
      homeId: snapshot.homeId,
      scenarioId: snapshot.scenarioId,
      sequence: 1,
      sourceLayer: 'sensor',
      lineage: {
        eventTime: snapshot.simClock.currentTime,
        ingestTime: snapshot.simClock.currentTime,
        sourceLayer: 'sensor',
        causeEventIds: [],
        episodeId: 'sensor:water_leak_01',
        observability: 'ml_observation',
        quality: { confidence: 0.96 },
        schemaVersion: 1,
        behaviorModelVersion: 'test'
      },
      roomId: 'bathroom',
      deviceId: 'water_leak_01',
      deviceType: 'water_leak_sensor',
      measurements: {
        leak_detected: true,
        confidence: 0.96
      }
    };

    const report = buildEvaluationReport({
      days: [{
        date: '2026-06-17',
        events: [],
        finalSnapshot: snapshot,
        forecastSamples: [
          {
            currentTime: '2026-06-17T08:00:00+08:00',
            eventsUntilNow: [],
            truthByHorizon: [{ horizonMinutes: 60, snapshot: morningSnapshot }]
          },
          {
            currentTime: '2026-06-17T19:00:00+08:00',
            eventsUntilNow: [],
            truthByHorizon: [{ horizonMinutes: 60, snapshot: eveningSnapshot }]
          },
          {
            currentTime: '2026-06-17T19:00:00+08:00',
            eventsUntilNow: [],
            truthByHorizon: [{ horizonMinutes: 60, snapshot: eveningSnapshot }]
          }
        ]
      }],
      homeDefinition: getHomeDefinition(),
      realWorldValidationSamples: [{
        currentTime: '2026-06-17T02:15:00+08:00',
        eventsUntilNow: [leakTelemetry],
        truth: {
          homeMode: 'alert',
          risks: {
            fridge_left_open: false,
            network_impact: false,
            stove_unattended: false,
            senior_no_activity: false,
            water_leak: true
          }
        }
      }]
    });

    expect(report.inference.downstreamUtility.realWorldValidation).toMatchObject({
      samples: 1,
      homeModeTop1Accuracy: expect.any(Number),
      averageRiskBrierScore: expect.any(Number),
      featureCoverageRatio: expect.any(Number)
    });
    expect(report.inference.downstreamUtility.syntheticToRealGap).toMatchObject({
      homeModeAccuracyGap: expect.any(Number),
      riskBrierScoreGap: expect.any(Number)
    });
  });

  it('does not treat inactive water-flow observations as coverage for active-flow validation samples', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    const snapshot = simulator.getSnapshot();
    const morningSnapshot = structuredClone(snapshot);
    morningSnapshot.homeState.mode = 'morning';
    const eveningSnapshot = structuredClone(snapshot);
    eveningSnapshot.homeState.mode = 'evening_home';
    const waterFlowTelemetry = (flowLMin: number): DeviceTelemetryEvent => ({
      id: `water_flow_${flowLMin}`,
      runId: snapshot.runId,
      type: 'DeviceTelemetry',
      ts: snapshot.simClock.currentTime,
      simTime: snapshot.simClock.currentTime,
      homeId: snapshot.homeId,
      scenarioId: snapshot.scenarioId,
      sequence: 1,
      sourceLayer: 'sensor',
      lineage: {
        eventTime: snapshot.simClock.currentTime,
        ingestTime: snapshot.simClock.currentTime,
        sourceLayer: 'sensor',
        causeEventIds: [],
        episodeId: 'sensor:bathroom_water_01',
        observability: 'ml_observation',
        quality: { confidence: 0.9 },
        schemaVersion: 1,
        behaviorModelVersion: 'test'
      },
      roomId: 'bathroom',
      deviceId: 'bathroom_water_01',
      deviceType: 'water_flow_sensor',
      measurements: {
        flow_l_min: flowLMin,
        confidence: 0.9
      }
    });

    const report = buildEvaluationReport({
      days: [{
        date: '2026-06-17',
        events: [waterFlowTelemetry(0)],
        finalSnapshot: snapshot,
        forecastSamples: [
          {
            currentTime: '2026-06-17T07:20:00+08:00',
            eventsUntilNow: [waterFlowTelemetry(0)],
            truthByHorizon: [{ horizonMinutes: 60, snapshot: morningSnapshot }]
          },
          {
            currentTime: '2026-06-17T19:00:00+08:00',
            eventsUntilNow: [],
            truthByHorizon: [{ horizonMinutes: 60, snapshot: eveningSnapshot }]
          }
        ]
      }],
      homeDefinition: getHomeDefinition(),
      realWorldValidationSamples: [{
        currentTime: '2026-06-17T07:20:00+08:00',
        eventsUntilNow: [waterFlowTelemetry(4.8)],
        truth: {
          homeMode: 'morning',
          risks: {
            fridge_left_open: false,
            network_impact: false,
            stove_unattended: false,
            senior_no_activity: false,
            water_leak: false
          }
        }
      }]
    });

    expect(report.inference.downstreamUtility.realWorldValidation.featureCoverageRatio).toBe(0);
  });

  it('compares synthetic-to-real downstream gaps before and after simulation parameter tuning', () => {
    const comparison = compareDownstreamUtilityGaps(
      {
        syntheticToRealGap: {
          homeModeAccuracyGap: 0.42,
          riskBrierScoreGap: 0.18
        }
      },
      {
        syntheticToRealGap: {
          homeModeAccuracyGap: 0.25,
          riskBrierScoreGap: 0.09
        }
      }
    );

    expect(comparison).toEqual({
      baseline: {
        homeModeAccuracyGap: 0.42,
        riskBrierScoreGap: 0.18
      },
      candidate: {
        homeModeAccuracyGap: 0.25,
        riskBrierScoreGap: 0.09
      },
      deltas: {
        homeModeAccuracyGap: -0.17,
        riskBrierScoreGap: -0.09
      },
      improved: {
        homeModeAccuracyGap: true,
        riskBrierScoreGap: true,
        overall: true
      }
    });
  });

  it('scores water leak forecasts in risk calibration metrics', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('night_water_leak');
    simulator.advanceMinutes(3);
    const leakTruth = simulator.getSnapshot();
    const leakTelemetry: DeviceTelemetryEvent = {
      id: 'leak_observation',
      runId: leakTruth.runId,
      type: 'DeviceTelemetry',
      ts: leakTruth.simClock.currentTime,
      simTime: leakTruth.simClock.currentTime,
      homeId: leakTruth.homeId,
      scenarioId: leakTruth.scenarioId,
      sequence: leakTruth.simClock.sequence + 1,
      sourceLayer: 'sensor',
      lineage: {
        eventTime: leakTruth.simClock.currentTime,
        ingestTime: leakTruth.simClock.currentTime,
        sourceLayer: 'sensor',
        causeEventIds: [],
        episodeId: 'sensor:water_leak_01',
        observability: 'ml_observation',
        quality: { confidence: 0.96 },
        schemaVersion: 1,
        behaviorModelVersion: 'test'
      },
      roomId: 'bathroom',
      deviceId: 'water_leak_01',
      deviceType: 'water_leak_sensor',
      measurements: {
        leak_detected: true,
        confidence: 0.96
      }
    };
    const withoutObservation = buildEvaluationReport({
      days: [{
        date: '2026-06-17',
        events: [],
        finalSnapshot: leakTruth,
        forecastSamples: [{
          currentTime: leakTruth.simClock.currentTime,
          eventsUntilNow: [],
          truthByHorizon: [{ horizonMinutes: 15, snapshot: leakTruth }]
        }]
      }],
      homeDefinition: getHomeDefinition()
    });
    const withObservation = buildEvaluationReport({
      days: [{
        date: '2026-06-17',
        events: [leakTelemetry],
        finalSnapshot: leakTruth,
        forecastSamples: [{
          currentTime: leakTruth.simClock.currentTime,
          eventsUntilNow: [leakTelemetry],
          truthByHorizon: [{ horizonMinutes: 15, snapshot: leakTruth }]
        }]
      }],
      homeDefinition: getHomeDefinition()
    });

    expect(withObservation.inference.forecastEvaluation.averageRiskBrierScoreByHorizon[15])
      .toBeLessThan(withoutObservation.inference.forecastEvaluation.averageRiskBrierScoreByHorizon[15]);
  });

  it('uses holiday calendar context when scoring home mode forecasts', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startDailyScenario({ date: '2026-10-01', seed: 42 });
    const snapshot = simulator.getSnapshot();
    snapshot.simClock.currentTime = '2026-10-01T10:30:00+08:00';
    snapshot.homeState.mode = 'evening_home';

    const report = buildEvaluationReport({
      days: [{
        date: '2026-10-01',
        events: [],
        finalSnapshot: snapshot,
        forecastSamples: [{
          currentTime: snapshot.simClock.currentTime,
          eventsUntilNow: [],
          truthByHorizon: [{ horizonMinutes: 15, snapshot }]
        }]
      }],
      homeDefinition: getHomeDefinition()
    });

    expect(report.inference.forecastEvaluation.homeModeAccuracyByHorizon[15]).toBe(1);
  });

  it('reports topology violations instead of hiding impossible movement', () => {
    const impossibleMove: PersonMovedEvent = {
      id: 'bad_move',
      runId: 'run_bad',
      type: 'PersonMoved',
      ts: '2026-06-17T09:00:00+08:00',
      simTime: '2026-06-17T09:00:00+08:00',
      homeId: 'default_home',
      scenarioId: 'weekday_normal',
      sequence: 1,
      sourceLayer: 'truth',
      lineage: {
        eventTime: '2026-06-17T09:00:00+08:00',
        ingestTime: '2026-06-17T09:00:00+08:00',
        sourceLayer: 'truth',
        causeEventIds: [],
        episodeId: 'test',
        observability: 'private',
        quality: {},
        schemaVersion: 1,
        behaviorModelVersion: 'test'
      },
      personId: 'adult_1',
      from: 'kitchen',
      to: 'study',
      activity: 'remote_work'
    };

    const report = buildEvaluationReport({
      days: [{ date: '2026-06-17', events: [impossibleMove], finalSnapshot: null }],
      homeDefinition: getHomeDefinition()
    });

    expect(report.logic.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'movement_topology',
        entityId: 'adult_1',
        message: expect.stringContaining('kitchen -> study')
      })
    ]));
  });

  it('keeps generated person and pet movement on adjacent room paths', () => {
    const report = runSimulationEvaluation({
      startDate: '2026-07-14',
      days: 1,
      seed: 42,
      minutesPerDay: 240
    });

    expect(report.logic.violations.filter((violation) => violation.kind === 'movement_topology')).toEqual([]);
  });

  it('reports operator device commands without a nearby person', () => {
    const commandWithoutOperator: DeviceStateChangedEvent = {
      id: 'bad_command',
      runId: 'run_bad',
      type: 'DeviceStateChanged',
      ts: '2026-06-17T09:00:00+08:00',
      simTime: '2026-06-17T09:00:00+08:00',
      homeId: 'default_home',
      scenarioId: 'weekday_normal',
      sequence: 1,
      sourceLayer: 'world',
      lineage: {
        eventTime: '2026-06-17T09:00:00+08:00',
        ingestTime: '2026-06-17T09:00:00+08:00',
        sourceLayer: 'world',
        causeEventIds: [],
        episodeId: 'test',
        observability: 'admin',
        quality: {},
        schemaVersion: 1,
        behaviorModelVersion: 'test'
      },
      roomId: 'kitchen',
      deviceId: 'fridge_01',
      deviceType: 'fridge',
      state: { doorOpen: false },
      reason: 'operator:device_command:close'
    };

    const report = buildEvaluationReport({
      days: [{ date: '2026-06-17', events: [commandWithoutOperator], finalSnapshot: null }],
      homeDefinition: getHomeDefinition()
    });

    expect(report.logic.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'device_operation_proximity',
        entityId: 'fridge_01',
        message: expect.stringContaining('without a nearby person')
      })
    ]));
  });

  it('reports exclusive resource conflicts between overlapping activities', () => {
    const firstActivity: ActivityStartedEvent = {
      id: 'activity_1',
      runId: 'run_bad',
      type: 'ActivityStarted',
      ts: '2026-06-17T19:00:00+08:00',
      simTime: '2026-06-17T19:00:00+08:00',
      homeId: 'default_home',
      scenarioId: 'weekday_normal',
      sequence: 1,
      sourceLayer: 'truth',
      lineage: {
        eventTime: '2026-06-17T19:00:00+08:00',
        ingestTime: '2026-06-17T19:00:00+08:00',
        sourceLayer: 'truth',
        causeEventIds: [],
        episodeId: 'test',
        observability: 'private',
        quality: {},
        schemaVersion: 1,
        behaviorModelVersion: 'test'
      },
      activityId: 'watch_tv',
      participants: ['adult_1'],
      roomId: 'living_room'
    };
    const secondActivity: ActivityStartedEvent = {
      ...firstActivity,
      id: 'activity_2',
      sequence: 2,
      activityId: 'watching_tv',
      participants: ['child_1']
    };

    const report = buildEvaluationReport({
      days: [{ date: '2026-06-17', events: [firstActivity, secondActivity], finalSnapshot: null }],
      homeDefinition: getHomeDefinition()
    });

    expect(report.logic.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'exclusive_resource_conflict',
        entityId: 'tv_01',
        message: expect.stringContaining('watch_tv and watching_tv')
      })
    ]));
  });

  it('reports exclusive resource conflicts between separate overlapping instances of the same activity', () => {
    const firstActivity: ActivityStartedEvent = {
      id: 'activity_1',
      runId: 'run_bad',
      type: 'ActivityStarted',
      ts: '2026-06-17T19:00:00+08:00',
      simTime: '2026-06-17T19:00:00+08:00',
      homeId: 'default_home',
      scenarioId: 'weekday_normal',
      sequence: 1,
      sourceLayer: 'truth',
      lineage: {
        eventTime: '2026-06-17T19:00:00+08:00',
        ingestTime: '2026-06-17T19:00:00+08:00',
        sourceLayer: 'truth',
        causeEventIds: [],
        episodeId: 'test',
        observability: 'private',
        quality: {},
        schemaVersion: 1,
        behaviorModelVersion: 'test'
      },
      activityId: 'watch_tv',
      participants: ['adult_1'],
      roomId: 'living_room'
    };
    const secondActivity: ActivityStartedEvent = {
      ...firstActivity,
      id: 'activity_2',
      sequence: 2,
      participants: ['child_1']
    };

    const report = buildEvaluationReport({
      days: [{ date: '2026-06-17', events: [firstActivity, secondActivity], finalSnapshot: null }],
      homeDefinition: getHomeDefinition()
    });

    expect(report.logic.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'exclusive_resource_conflict',
        entityId: 'tv_01',
        message: expect.stringContaining('activity_1 and activity_2')
      })
    ]));
  });

  it('keeps conflicting exclusive resource claims active until each activity instance ends', () => {
    const firstActivity: ActivityStartedEvent = {
      id: 'activity_1',
      runId: 'run_bad',
      type: 'ActivityStarted',
      ts: '2026-06-17T19:00:00+08:00',
      simTime: '2026-06-17T19:00:00+08:00',
      homeId: 'default_home',
      scenarioId: 'weekday_normal',
      sequence: 1,
      sourceLayer: 'truth',
      lineage: {
        eventTime: '2026-06-17T19:00:00+08:00',
        ingestTime: '2026-06-17T19:00:00+08:00',
        sourceLayer: 'truth',
        causeEventIds: [],
        episodeId: 'test',
        observability: 'private',
        quality: {},
        schemaVersion: 1,
        behaviorModelVersion: 'test'
      },
      activityId: 'watch_tv',
      participants: ['adult_1'],
      roomId: 'living_room'
    };
    const secondActivity: ActivityStartedEvent = {
      ...firstActivity,
      id: 'activity_2',
      sequence: 2,
      participants: ['child_1']
    };
    const firstEnded = {
      ...firstActivity,
      id: 'activity_1_end',
      type: 'ActivityEnded' as const,
      sequence: 3
    };
    const thirdActivity: ActivityStartedEvent = {
      ...firstActivity,
      id: 'activity_3',
      sequence: 4,
      participants: ['senior_1']
    };

    const report = buildEvaluationReport({
      days: [{
        date: '2026-06-17',
        events: [firstActivity, secondActivity, firstEnded, thirdActivity],
        finalSnapshot: null
      }],
      homeDefinition: getHomeDefinition()
    });

    expect(report.logic.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'exclusive_resource_conflict',
        entityId: 'tv_01',
        message: expect.stringContaining('activity_2 and activity_3')
      })
    ]));
  });

  it('reports a person sleeping while assigned to a cooking activity', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    const snapshot = simulator.getSnapshot();
    snapshot.people.adult_1.activity = 'sleeping';
    snapshot.people.adult_1.location = 'master_bedroom';
    snapshot.activities.cooking_dinner = {
      activityId: 'cooking_dinner',
      participants: ['adult_1'],
      roomId: 'kitchen',
      startedAt: snapshot.simClock.currentTime
    };

    const report = buildEvaluationReport({
      days: [{ date: '2026-06-17', events: [], finalSnapshot: snapshot }],
      homeDefinition: getHomeDefinition()
    });

    expect(report.logic.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'activity_conflict',
        entityId: 'adult_1',
        message: expect.stringContaining('sleeping while participating in cooking_dinner')
      })
    ]));
  });

  it('reports activity resource precondition failures and inventory effect mismatches', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    const initialSnapshot = simulator.getSnapshot();
    initialSnapshot.worldState.inventory.breakfastFoodServings = 0;
    initialSnapshot.worldState.inventory.dirtyDishes = 2;
    const finalSnapshot = structuredClone(initialSnapshot);
    finalSnapshot.worldState.inventory.dirtyDishes = 2;

    const breakfastStarted: ActivityStartedEvent = {
      id: 'breakfast_started',
      runId: 'run_bad_inventory',
      type: 'ActivityStarted',
      ts: '2026-06-17T07:30:00+08:00',
      simTime: '2026-06-17T07:30:00+08:00',
      homeId: 'default_home',
      scenarioId: 'weekday_normal',
      sequence: 1,
      sourceLayer: 'truth',
      lineage: {
        eventTime: '2026-06-17T07:30:00+08:00',
        ingestTime: '2026-06-17T07:30:00+08:00',
        sourceLayer: 'truth',
        causeEventIds: [],
        episodeId: 'test',
        observability: 'private',
        quality: {},
        schemaVersion: 1,
        behaviorModelVersion: 'test'
      },
      activityId: 'prepare_breakfast',
      participants: ['adult_1'],
      roomId: 'kitchen'
    };

    const report = buildEvaluationReport({
      days: [{
        date: '2026-06-17',
        events: [breakfastStarted],
        initialSnapshot,
        finalSnapshot
      }],
      homeDefinition: getHomeDefinition()
    });

    expect(report.logic.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'activity_precondition',
        entityId: 'prepare_breakfast',
        message: expect.stringContaining('missing resource breakfast_food')
      }),
      expect.objectContaining({
        kind: 'activity_effect',
        entityId: 'prepare_breakfast',
        message: expect.stringContaining('dirtyDishes')
      })
    ]));
  });
});
