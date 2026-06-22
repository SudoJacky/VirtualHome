import { describe, expect, it } from 'vitest';
import { getHomeDefinition } from '../src/sim/catalog';
import { createSimulator } from '../src/sim/engine';
import { buildEvaluationReport } from '../src/sim/evaluation/metrics';
import { runSimulationEvaluation } from '../src/sim/evaluation/runEvaluation';
import type { ActivityStartedEvent, ConversationOccurredEvent, DeviceStateChangedEvent, DeviceTelemetryEvent, PersonMovedEvent } from '../src/shared/types';

describe('long horizon simulation evaluation', () => {
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
      roomId: 'child_bedroom'
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
      roomId: 'child_bedroom'
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
    expect(report.sensor.qualityRatios).toMatchObject({
      delayed: expect.any(Number),
      noisy: expect.any(Number),
      duplicated: expect.any(Number),
      dropped: expect.any(Number)
    });
    expect(Object.values(report.sensor.qualityRatios).every((ratio) => ratio >= 0 && ratio <= 1)).toBe(true);
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
