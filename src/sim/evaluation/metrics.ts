import { validateDeviceStatePatch } from '../../shared/deviceRegistry';
import type { DeviceTelemetryEvent, HomeDefinition, PersonMovedEvent, RoomId, TwinEvent, TwinSnapshot } from '../../shared/types';
import { inferTwinState } from '../../twin/inferenceModel';
import { getActivityTemplate } from '../agents/activityCatalog';
import { summarizeAgentMemory, type AgentMemorySummary } from '../agents/memory';
import { createDailyCommitments, type DailyCommitment } from '../agents/scheduler';
import { createExternalContext, type ExternalContext } from '../externalContext';
import { getPersona } from '../personas/defaultFamily';
import { applyActivityToInventory, resourcesFromInventory, type HouseholdInventory } from '../world/inventory';

export interface EvaluationDayInput {
  date: string;
  events: TwinEvent[];
  initialSnapshot?: TwinSnapshot | null;
  finalSnapshot: TwinSnapshot | null;
  forecastSamples?: ForecastEvaluationSample[];
}

export type ForecastHorizonMinutes = 15 | 30 | 60;

export interface ForecastEvaluationSample {
  currentTime: string;
  eventsUntilNow: TwinEvent[];
  truthByHorizon: Array<{
    horizonMinutes: ForecastHorizonMinutes;
    snapshot: TwinSnapshot;
  }>;
}

export interface EvaluationViolation {
  kind:
    | 'movement_topology'
    | 'device_operation_proximity'
    | 'exclusive_resource_conflict'
    | 'device_state'
    | 'room_membership'
    | 'activity_conflict'
    | 'activity_precondition'
    | 'activity_effect';
  entityId: string;
  message: string;
  simTime?: string;
}

export interface CommitmentCoverageSummary {
  personId: string;
  totalCommitments: number;
  observedCommitments: number;
  missedCommitments: number;
  coverageRatio: number;
  observedActivityIds: string[];
  missedActivityIds: string[];
}

export interface SimulationEvaluationReport {
  days: Array<{
    date: string;
    externalContext: ExternalContext;
    eventCount: number;
    telemetryEventCount: number;
    inventory: TwinSnapshot['worldState']['inventory'];
  }>;
  totalEvents: number;
  logic: {
    totalChecks: number;
    violations: EvaluationViolation[];
    movementTopologyViolations: number;
    deviceStateViolations: number;
  };
  behavior: {
    activityCounts: Record<string, number>;
    dailyActivityCounts: Record<string, Record<string, number>>;
    activityStartMinutes: Record<string, {
      samples: number;
      averageMinute: number;
      earliestMinute: number;
      latestMinute: number;
    }>;
    activityDurationMinutes: Record<string, {
      samples: number;
      averageMinutes: number;
      shortestMinutes: number;
      longestMinutes: number;
    }>;
    weekdayWeekendActivityCounts: {
      weekday: Record<string, number>;
      weekend: Record<string, number>;
    };
    transitionMatrix: Record<string, Record<string, number>>;
    jointActivityRatio: number;
    distinctActivitiesByPerson: Record<string, number>;
    trajectoryDivergenceByPerson: Record<string, number>;
    habitStabilityScore: number;
    shortTermVariationScore: number;
    agentMemorySummaries: Record<string, AgentMemorySummary>;
    commitmentCoverageByPerson: Record<string, CommitmentCoverageSummary>;
  };
  sensor: {
    telemetryEvents: number;
    eventsByDeviceType: Record<string, number>;
    averageIntervalMinutesByDevice: Record<string, number>;
    burstCountByDevice: Record<string, number>;
    longestSilentMinutesByDevice: Record<string, number>;
    deviceCorrelations: Array<{
      leftDeviceId: string;
      rightDeviceId: string;
      sameMinuteCount: number;
    }>;
    stoveLag: {
      pm25LagMinutes: number;
      temperatureLagMinutes: number;
      sampleCount: number;
    };
    co2OccupancyCorrelation: number;
    petMotionFalsePositiveRatio: number;
    delayedEvents: number;
    noisyEvents: number;
    duplicatedEvents: number;
    droppedEvents: number;
    outOfOrderEvents: number;
    qualityRatios: {
      delayed: number;
      noisy: number;
      duplicated: number;
      dropped: number;
      outOfOrder: number;
    };
  };
  inference: {
    samples: number;
    personRoomTop1Accuracy: number;
    acceptedObservationEvents: number;
    rejectedTruthOrControlEvents: number;
    forecastEvaluation: {
      samples: number;
      homeModeAccuracyByHorizon: Record<ForecastHorizonMinutes, number>;
      averageRiskBrierScoreByHorizon: Record<ForecastHorizonMinutes, number>;
    };
    downstreamUtility: {
      trainExamples: number;
      holdoutExamples: number;
      homeModeTop1Accuracy: number;
      averageRiskBrierScore: number;
      featureCoverageRatio: number;
    };
  };
}

export function buildEvaluationReport(input: {
  days: EvaluationDayInput[];
  homeDefinition: HomeDefinition;
}): SimulationEvaluationReport {
  const events = input.days.flatMap((day) => day.events);
  const logic = evaluateLogic(input.days, input.homeDefinition);
  const behavior = evaluateBehavior(input.days, input.homeDefinition);
  const sensor = evaluateSensor(events);
  const inference = evaluateInference(input.days, input.homeDefinition);

  return {
    days: input.days.map((day) => ({
      date: day.date,
      externalContext: createExternalContext({
        date: day.date,
        seed: day.finalSnapshot?.runContext.seed ?? day.initialSnapshot?.runContext.seed ?? 42
      }),
      eventCount: day.events.length,
      telemetryEventCount: day.events.filter((event) => event.type === 'DeviceTelemetry').length,
      inventory: day.finalSnapshot?.worldState.inventory ?? {
        breakfastFoodServings: 0,
        simpleFoodServings: 0,
        preparedMeals: 0,
        dirtyLaundryKg: 0,
        dirtyDishes: 0,
        trashBags: 0,
        medicineDoses: 0,
        packageCount: 0,
        unfinishedChores: 0,
        sleepDebtHours: 0,
        deviceMaintenanceScore: 0,
        healthRiskScore: 0,
        pendingChores: []
      }
    })),
    totalEvents: events.length,
    logic,
    behavior,
    sensor,
    inference
  };
}

function evaluateLogic(days: EvaluationDayInput[], homeDefinition: HomeDefinition): SimulationEvaluationReport['logic'] {
  const violations: EvaluationViolation[] = [];
  const deviceRoomById = collectDeviceRooms(homeDefinition);
  let totalChecks = 0;
  for (const day of days) {
    const peopleByRoom = new Map<RoomId, Set<string>>();
    const activeResourceClaims = new Map<string, { eventId: string; activityId: string }>();
    for (const event of day.events) {
      if (event.type === 'PersonMoved') {
        totalChecks += 1;
        if (!isTopologyMoveAllowed(event, homeDefinition)) {
          violations.push({
            kind: 'movement_topology',
            entityId: event.personId,
            message: `${event.personId} moved through a non-adjacent path: ${event.from} -> ${event.to}`,
            simTime: event.simTime
          });
        }
        if (event.from !== 'away') {
          peopleByRoom.get(event.from)?.delete(event.personId);
        }
        if (event.to !== 'away') {
          getSet(peopleByRoom, event.to).add(event.personId);
        }
      }
      if (event.type === 'DeviceStateChanged' && event.reason?.startsWith('operator:device_command:')) {
        totalChecks += 1;
        const roomId = deviceRoomById.get(event.deviceId) ?? event.roomId;
        if ((peopleByRoom.get(roomId)?.size ?? 0) === 0) {
          violations.push({
            kind: 'device_operation_proximity',
            entityId: event.deviceId,
            message: `${event.deviceId} was operated in ${roomId} without a nearby person`,
            simTime: event.simTime
          });
        }
      }
      if (event.type === 'ActivityStarted') {
        for (const resourceId of exclusiveResourcesForActivity(event.activityId)) {
          totalChecks += 1;
          const activeActivity = activeResourceClaims.get(resourceId);
          if (activeActivity) {
            violations.push({
              kind: 'exclusive_resource_conflict',
              entityId: resourceId,
              message: `${resourceId} was claimed by overlapping activity instances ${activeActivity.eventId} and ${event.id} (${activeActivity.activityId} and ${event.activityId})`,
              simTime: event.simTime
            });
          } else {
            activeResourceClaims.set(resourceId, { eventId: event.id, activityId: event.activityId });
          }
        }
      }
      if (event.type === 'ActivityEnded') {
        for (const [resourceId, activity] of [...activeResourceClaims.entries()]) {
          if (activity.activityId === event.activityId) {
            activeResourceClaims.delete(resourceId);
          }
        }
      }
    }

    const inventoryAudit = evaluateActivityInventoryConsistency(day);
    totalChecks += inventoryAudit.totalChecks;
    violations.push(...inventoryAudit.violations);

    const snapshot = day.finalSnapshot;
    if (!snapshot) {
      continue;
    }

    const roomMembership = new Map<string, RoomId>();
    for (const room of Object.values(snapshot.rooms)) {
      for (const personId of room.people) {
        totalChecks += 1;
        if (roomMembership.has(personId)) {
          violations.push({
            kind: 'room_membership',
            entityId: personId,
            message: `${personId} appears in both ${roomMembership.get(personId)} and ${room.id}`,
            simTime: snapshot.simClock.currentTime
          });
        }
        roomMembership.set(personId, room.id);
      }
    }

    for (const device of Object.values(snapshot.devices)) {
      totalChecks += 1;
      try {
        validateDeviceStatePatch(device.type, device.state);
      } catch (error) {
        violations.push({
          kind: 'device_state',
          entityId: device.id,
          message: error instanceof Error ? error.message : String(error),
          simTime: snapshot.simClock.currentTime
        });
      }
    }

    for (const activity of Object.values(snapshot.activities)) {
      if (!isCookingActivity(activity.activityId)) {
        continue;
      }
      for (const participantId of activity.participants) {
        totalChecks += 1;
        const participant = snapshot.people[participantId];
        if (participant?.activity === 'sleeping') {
          violations.push({
            kind: 'activity_conflict',
            entityId: participantId,
            message: `${participantId} is sleeping while participating in ${activity.activityId}`,
            simTime: snapshot.simClock.currentTime
          });
        }
      }
    }
  }

  return {
    totalChecks,
    violations,
    movementTopologyViolations: violations.filter((violation) => violation.kind === 'movement_topology').length,
    deviceStateViolations: violations.filter((violation) => violation.kind === 'device_state').length
  };
}

function evaluateActivityInventoryConsistency(day: EvaluationDayInput): {
  totalChecks: number;
  violations: EvaluationViolation[];
} {
  const violations: EvaluationViolation[] = [];
  const initialInventory = day.initialSnapshot?.worldState.inventory;
  const finalInventory = day.finalSnapshot?.worldState.inventory;
  if (!initialInventory || !finalInventory) {
    return { totalChecks: 0, violations };
  }

  let totalChecks = 0;
  let projected = structuredClone(initialInventory);
  const affectedFields = new Set<keyof HouseholdInventory>();

  for (const event of day.events) {
    if (event.type !== 'ActivityStarted' || event.sourceLayer !== 'truth') {
      continue;
    }
    const template = safeActivityTemplate(event.activityId);
    if (!template) {
      continue;
    }
    const availableResources = resourcesFromInventory(projected);
    for (const resource of template.requiredResources) {
      totalChecks += 1;
      if ((availableResources[resource.resourceId] ?? 0) < resource.quantity) {
        violations.push({
          kind: 'activity_precondition',
          entityId: event.activityId,
          message: `${event.activityId} started with missing resource ${resource.resourceId}`,
          simTime: event.simTime
        });
      }
    }

    const next = applyActivityToInventory(projected, event.activityId);
    for (const field of changedInventoryFields(projected, next)) {
      affectedFields.add(field);
    }
    projected = next;
  }

  for (const field of affectedFields) {
    totalChecks += 1;
    if (!inventoryValuesEqual(projected[field], finalInventory[field])) {
      violations.push({
        kind: 'activity_effect',
        entityId: activityEffectEntity(day.events, field),
        message: `inventory field ${String(field)} expected ${String(projected[field])} after activity effects but found ${String(finalInventory[field])}`,
        simTime: day.finalSnapshot?.simClock.currentTime
      });
    }
  }

  return { totalChecks, violations };
}

function safeActivityTemplate(activityId: string): ReturnType<typeof getActivityTemplate> | null {
  try {
    return getActivityTemplate(activityId);
  } catch {
    return null;
  }
}

function changedInventoryFields(left: HouseholdInventory, right: HouseholdInventory): Array<keyof HouseholdInventory> {
  return (Object.keys(right) as Array<keyof HouseholdInventory>)
    .filter((field) => !inventoryValuesEqual(left[field], right[field]));
}

function inventoryValuesEqual(left: HouseholdInventory[keyof HouseholdInventory], right: HouseholdInventory[keyof HouseholdInventory]): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
  }
  return left === right;
}

function activityEffectEntity(events: TwinEvent[], field: keyof HouseholdInventory): string {
  const event = events.find((candidate) => candidate.type === 'ActivityStarted' && changedInventoryFieldsForActivity(candidate.activityId).includes(field));
  return event?.type === 'ActivityStarted' ? event.activityId : String(field);
}

function changedInventoryFieldsForActivity(activityId: string): Array<keyof HouseholdInventory> {
  const baseline = {
    breakfastFoodServings: 10,
    simpleFoodServings: 10,
    preparedMeals: 10,
    dirtyLaundryKg: 10,
    dirtyDishes: 10,
    trashBags: 2,
    medicineDoses: 10,
    packageCount: 0,
    unfinishedChores: 5,
    sleepDebtHours: 0,
    deviceMaintenanceScore: 8,
    healthRiskScore: 28,
    pendingChores: []
  };
  return changedInventoryFields(baseline, applyActivityToInventory(baseline, activityId));
}

function evaluateBehavior(days: EvaluationDayInput[], homeDefinition: HomeDefinition): SimulationEvaluationReport['behavior'] {
  const activityCounts: Record<string, number> = {};
  const dailyActivityCounts: Record<string, Record<string, number>> = {};
  const weekdayWeekendActivityCounts = { weekday: {} as Record<string, number>, weekend: {} as Record<string, number> };
  const startMinutesByActivity = new Map<string, number[]>();
  const durationMinutesByActivity = new Map<string, number[]>();
  const transitionMatrix: Record<string, Record<string, number>> = {};
  const distinctActivitiesByPersonSet = new Map<string, Set<string>>();
  const visitedRoomsByPerson = new Map<string, Set<RoomId>>();
  const transitionsByDay: number[] = [];
  let activityStarted = 0;
  let jointActivityStarted = 0;

  for (const day of days) {
    const dailyCounts: Record<string, number> = {};
    const previousActivityByPerson = new Map<string, string>();
    const activeActivities = new Map<string, Array<{ activityId: string; startedAt: string }>>();
    const dayKind = isWeekendDate(day.date) ? 'weekend' : 'weekday';
    let dayTransitions = 0;
    for (const event of day.events) {
      if (event.type === 'PersonMoved') {
        increment(activityCounts, event.activity);
        increment(dailyCounts, event.activity);
        increment(weekdayWeekendActivityCounts[dayKind], event.activity);
        getNumberList(startMinutesByActivity, event.activity).push(minuteOfDayFromTime(event.simTime));
        const previous = previousActivityByPerson.get(event.personId) ?? 'unknown';
        incrementNested(transitionMatrix, previous, event.activity);
        previousActivityByPerson.set(event.personId, event.activity);
        getSet(distinctActivitiesByPersonSet, event.personId).add(event.activity);
        if (event.to !== 'away') {
          getSet(visitedRoomsByPerson, event.personId).add(event.to);
        }
        dayTransitions += 1;
      }
      if (event.type === 'ActivityStarted') {
        activityStarted += 1;
        const active = activeActivities.get(event.activityId) ?? [];
        active.push({ activityId: event.activityId, startedAt: event.simTime });
        activeActivities.set(event.activityId, active);
        if (event.participants.length > 1) {
          jointActivityStarted += 1;
        }
      }
      if (event.type === 'ActivityEnded') {
        const active = activeActivities.get(event.activityId)?.shift();
        if (active) {
          getNumberList(durationMinutesByActivity, event.activityId).push(
            Math.max(0, (Date.parse(event.simTime) - Date.parse(active.startedAt)) / 60000)
          );
          if (activeActivities.get(event.activityId)?.length === 0) {
            activeActivities.delete(event.activityId);
          }
        }
      }
    }
    if (day.finalSnapshot) {
      for (const person of Object.values(day.finalSnapshot.people)) {
        increment(activityCounts, person.activity);
        increment(dailyCounts, person.activity);
        increment(weekdayWeekendActivityCounts[dayKind], person.activity);
        incrementNested(transitionMatrix, previousActivityByPerson.get(person.id) ?? 'unknown', person.activity);
        getSet(distinctActivitiesByPersonSet, person.id).add(person.activity);
      }
    }
    dailyActivityCounts[day.date] = dailyCounts;
    transitionsByDay.push(dayTransitions);
  }

  return {
    activityCounts,
    dailyActivityCounts,
    activityStartMinutes: Object.fromEntries([...startMinutesByActivity.entries()].map(([activity, minutes]) => [
      activity,
      summarizeMinutes([...minutes])
    ])),
    activityDurationMinutes: Object.fromEntries([...durationMinutesByActivity.entries()].map(([activity, minutes]) => [
      activity,
      summarizeDurations([...minutes])
    ])),
    weekdayWeekendActivityCounts,
    transitionMatrix,
    jointActivityRatio: activityStarted > 0 ? jointActivityStarted / activityStarted : 0,
    distinctActivitiesByPerson: Object.fromEntries([...distinctActivitiesByPersonSet.entries()].map(([personId, activities]) => [personId, activities.size])),
    trajectoryDivergenceByPerson: calculateTrajectoryDivergence(visitedRoomsByPerson),
    habitStabilityScore: dailyActivitySimilarity(Object.values(dailyActivityCounts)),
    shortTermVariationScore: transitionVariationScore(transitionsByDay),
    agentMemorySummaries: createAgentMemorySummaries(days, homeDefinition),
    commitmentCoverageByPerson: createCommitmentCoverage(days, homeDefinition)
  };
}

function createAgentMemorySummaries(days: EvaluationDayInput[], homeDefinition: HomeDefinition): Record<string, AgentMemorySummary> {
  const events = days.flatMap((day) => day.events);
  const personIds = new Set(homeDefinition.people.map((person) => person.id));
  for (const day of days) {
    if (day.finalSnapshot) {
      for (const personId of Object.keys(day.finalSnapshot.people)) {
        personIds.add(personId);
      }
    }
    for (const event of day.events) {
      if (event.type === 'ActivityStarted' || event.type === 'ActivityEnded') {
        for (const participant of event.participants) {
          personIds.add(participant);
        }
      }
      if (event.type === 'ConversationOccurred') {
        personIds.add(event.speakerId);
        for (const listener of event.listenerIds) {
          personIds.add(listener);
        }
      }
      if (event.type === 'PersonMoved') {
        personIds.add(event.personId);
      }
    }
  }
  return Object.fromEntries([...personIds].sort().map((personId) => [personId, summarizeAgentMemory(personId, events)]));
}

function createCommitmentCoverage(days: EvaluationDayInput[], homeDefinition: HomeDefinition): Record<string, CommitmentCoverageSummary> {
  const summaries = new Map<string, CommitmentCoverageSummary>();
  for (const person of homeDefinition.people) {
    summaries.set(person.id, {
      personId: person.id,
      totalCommitments: 0,
      observedCommitments: 0,
      missedCommitments: 0,
      coverageRatio: 0,
      observedActivityIds: [],
      missedActivityIds: []
    });
  }

  for (const day of days) {
    for (const person of homeDefinition.people) {
      const commitments = commitmentsForPerson(person.id, day);
      const summary = summaries.get(person.id);
      if (!summary || commitments.length === 0) {
        continue;
      }
      for (const commitment of commitments) {
        summary.totalCommitments += 1;
        if (commitmentWasObserved(commitment, day.events)) {
          summary.observedCommitments += 1;
          addUnique(summary.observedActivityIds, commitment.activityId);
        } else {
          summary.missedCommitments += 1;
          addUnique(summary.missedActivityIds, commitment.activityId);
        }
      }
    }
  }

  return Object.fromEntries([...summaries.entries()].map(([personId, summary]) => [
    personId,
    {
      ...summary,
      observedActivityIds: [...summary.observedActivityIds].sort(),
      missedActivityIds: [...summary.missedActivityIds].sort(),
      coverageRatio: summary.totalCommitments > 0 ? roundRatio(summary.observedCommitments / summary.totalCommitments) : 0
    }
  ]));
}

function commitmentsForPerson(personId: string, day: EvaluationDayInput): DailyCommitment[] {
  try {
    return createDailyCommitments({
      persona: getPersona(personId),
      date: day.date,
      seed: day.finalSnapshot?.runContext.seed ?? 42
    });
  } catch {
    return [];
  }
}

function commitmentWasObserved(commitment: DailyCommitment, events: TwinEvent[]): boolean {
  return events.some((event) => {
    if (event.type !== 'ActivityStarted' || event.sourceLayer !== 'truth') {
      return false;
    }
    return event.activityId === commitment.activityId &&
      event.participants.includes(commitment.personId) &&
      isMinuteWithinWindow(minuteOfDayFromTime(event.simTime), commitment.window);
  });
}

function isMinuteWithinWindow(minuteOfDay: number, window: DailyCommitment['window']): boolean {
  return minuteOfDay >= window.startMinute && minuteOfDay <= window.endMinute;
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function evaluateSensor(events: TwinEvent[]): SimulationEvaluationReport['sensor'] {
  const telemetry = events.filter((event) => event.type === 'DeviceTelemetry');
  const eventsByDeviceType: Record<string, number> = {};
  const timestampsByDevice = new Map<string, number[]>();
  const minuteKeysByDevice = new Map<string, Set<number>>();
  let delayedEvents = 0;
  let noisyEvents = 0;
  let duplicatedEvents = 0;
  let droppedEvents = 0;
  let outOfOrderEvents = 0;
  let motionPositiveEvents = 0;
  let petMotionFalsePositiveEvents = 0;

  for (const event of telemetry) {
    increment(eventsByDeviceType, event.deviceType);
    const timestamps = timestampsByDevice.get(event.deviceId) ?? [];
    const timestamp = Date.parse(event.simTime);
    timestamps.push(timestamp);
    timestampsByDevice.set(event.deviceId, timestamps);
    const minuteKeys = minuteKeysByDevice.get(event.deviceId) ?? new Set<number>();
    minuteKeys.add(Math.floor(timestamp / 60_000));
    minuteKeysByDevice.set(event.deviceId, minuteKeys);
    if ((event.lineage.quality.delayedMs ?? 0) > 0) delayedEvents += 1;
    if (event.lineage.quality.noisy) noisyEvents += 1;
    if (event.lineage.quality.duplicated) duplicatedEvents += 1;
    if (event.lineage.quality.dropped) droppedEvents += 1;
    if (event.lineage.quality.outOfOrder) outOfOrderEvents += 1;
    if (event.deviceType === 'motion_sensor' && event.measurements.motion === true) {
      motionPositiveEvents += 1;
      if (Number(event.measurements.confidence ?? 1) <= 0.5) {
        petMotionFalsePositiveEvents += 1;
      }
    }
  }

  return {
    telemetryEvents: telemetry.length,
    eventsByDeviceType,
    averageIntervalMinutesByDevice: Object.fromEntries([...timestampsByDevice.entries()].map(([deviceId, timestamps]) => [
      deviceId,
      averageIntervalMinutes(timestamps)
    ])),
    burstCountByDevice: Object.fromEntries([...timestampsByDevice.entries()].map(([deviceId, timestamps]) => [
      deviceId,
      countBurstIntervals(timestamps)
    ])),
    longestSilentMinutesByDevice: Object.fromEntries([...timestampsByDevice.entries()].map(([deviceId, timestamps]) => [
      deviceId,
      longestSilentMinutes(timestamps)
    ])),
    deviceCorrelations: createDeviceCorrelations(minuteKeysByDevice),
    stoveLag: createStoveLagMetrics(events),
    co2OccupancyCorrelation: createCo2OccupancyCorrelation(events),
    petMotionFalsePositiveRatio: motionPositiveEvents > 0 ? roundRatio(petMotionFalsePositiveEvents / motionPositiveEvents) : 0,
    delayedEvents,
    noisyEvents,
    duplicatedEvents,
    droppedEvents,
    outOfOrderEvents,
    qualityRatios: {
      delayed: telemetry.length > 0 ? roundRatio(delayedEvents / telemetry.length) : 0,
      noisy: telemetry.length > 0 ? roundRatio(noisyEvents / telemetry.length) : 0,
      duplicated: telemetry.length > 0 ? roundRatio(duplicatedEvents / telemetry.length) : 0,
      dropped: telemetry.length > 0 ? roundRatio(droppedEvents / telemetry.length) : 0,
      outOfOrder: telemetry.length > 0 ? roundRatio(outOfOrderEvents / telemetry.length) : 0
    }
  };
}

function evaluateInference(days: EvaluationDayInput[], homeDefinition: HomeDefinition): SimulationEvaluationReport['inference'] {
  let samples = 0;
  let top1Hits = 0;
  let acceptedObservationEvents = 0;
  let rejectedTruthOrControlEvents = 0;
  const rooms = homeDefinition.floors.flatMap((floor) => floor.rooms.map((room) => room.id));

  for (const day of days) {
    const snapshot = day.finalSnapshot;
    if (!snapshot) {
      continue;
    }
    const peopleIds = Object.values(snapshot.people)
      .filter((person) => person.kind === 'human' && person.location !== 'away')
      .map((person) => person.id);
    const inference = inferTwinState(day.events, {
      currentTime: snapshot.simClock.currentTime,
      peopleIds,
      rooms,
      externalContext: createExternalContext({
        date: day.date,
        seed: snapshot.runContext.seed
      })
    });
    acceptedObservationEvents += inference.inputSummary.acceptedEventCount;
    rejectedTruthOrControlEvents += inference.inputSummary.rejectedEventTypes
      .filter((type) => ['PersonMoved', 'ActivityStarted', 'ActivityEnded', 'ScenarioControl', 'AbnormalityInjected'].includes(type))
      .length;
    for (const personId of peopleIds) {
      samples += 1;
      if (inference.people[personId]?.room.top === snapshot.people[personId]?.location) {
        top1Hits += 1;
      }
    }
  }

  return {
    samples,
    personRoomTop1Accuracy: samples > 0 ? top1Hits / samples : 0,
    acceptedObservationEvents,
    rejectedTruthOrControlEvents,
    forecastEvaluation: evaluateForecastSamples(days, homeDefinition),
    downstreamUtility: evaluateDownstreamUtility(days)
  };
}

function evaluateForecastSamples(
  days: EvaluationDayInput[],
  homeDefinition: HomeDefinition
): SimulationEvaluationReport['inference']['forecastEvaluation'] {
  const horizons: ForecastHorizonMinutes[] = [15, 30, 60];
  const hitsByHorizon: Record<ForecastHorizonMinutes, number> = { 15: 0, 30: 0, 60: 0 };
  const samplesByHorizon: Record<ForecastHorizonMinutes, number> = { 15: 0, 30: 0, 60: 0 };
  const brierTotalByHorizon: Record<ForecastHorizonMinutes, number> = { 15: 0, 30: 0, 60: 0 };
  const rooms = homeDefinition.floors.flatMap((floor) => floor.rooms.map((room) => room.id));

  for (const day of days) {
    for (const sample of day.forecastSamples ?? []) {
      const currentSnapshot = sample.truthByHorizon[0]?.snapshot ?? day.finalSnapshot;
      const peopleIds = currentSnapshot
        ? Object.values(currentSnapshot.people).filter((person) => person.kind === 'human').map((person) => person.id)
        : homeDefinition.people.filter((person) => person.kind === 'human').map((person) => person.id);
      const inference = inferTwinState(sample.eventsUntilNow, {
        currentTime: sample.currentTime,
        peopleIds,
        rooms,
        externalContext: createExternalContext({
          date: day.date,
          seed: currentSnapshot?.runContext.seed ?? day.finalSnapshot?.runContext.seed ?? 42
        })
      });
      for (const truth of sample.truthByHorizon) {
        const forecast = inference.forecasts.find((candidate) => candidate.horizonMinutes === truth.horizonMinutes);
        if (!forecast) {
          continue;
        }
        samplesByHorizon[truth.horizonMinutes] += 1;
        if (forecast.homeMode.top === truth.snapshot.homeState.mode) {
          hitsByHorizon[truth.horizonMinutes] += 1;
        }
        brierTotalByHorizon[truth.horizonMinutes] += riskBrierScore(forecast.risks, truth.snapshot);
      }
    }
  }

  return {
    samples: horizons.reduce((sum, horizon) => sum + samplesByHorizon[horizon], 0),
    homeModeAccuracyByHorizon: Object.fromEntries(horizons.map((horizon) => [
      horizon,
      samplesByHorizon[horizon] > 0 ? roundRatio(hitsByHorizon[horizon] / samplesByHorizon[horizon]) : 0
    ])) as Record<ForecastHorizonMinutes, number>,
    averageRiskBrierScoreByHorizon: Object.fromEntries(horizons.map((horizon) => [
      horizon,
      samplesByHorizon[horizon] > 0 ? roundRatio(brierTotalByHorizon[horizon] / samplesByHorizon[horizon]) : 0
    ])) as Record<ForecastHorizonMinutes, number>
  };
}

interface DownstreamUtilityExample {
  featureKey: string;
  homeMode: string;
  risks: Record<string, boolean>;
}

interface DownstreamUtilityBucket {
  samples: number;
  homeModes: Record<string, number>;
  riskPositiveCounts: Record<string, number>;
}

const downstreamRiskIds = ['fridge_left_open', 'network_impact', 'stove_unattended', 'senior_no_activity', 'water_leak'] as const;

function evaluateDownstreamUtility(days: EvaluationDayInput[]): SimulationEvaluationReport['inference']['downstreamUtility'] {
  const examples = createDownstreamUtilityExamples(days);
  if (examples.length < 2) {
    return {
      trainExamples: examples.length,
      holdoutExamples: 0,
      homeModeTop1Accuracy: 0,
      averageRiskBrierScore: 0,
      featureCoverageRatio: 0
    };
  }

  const splitIndex = Math.max(1, Math.floor(examples.length * 2 / 3));
  const train = examples.slice(0, splitIndex);
  const holdout = examples.slice(splitIndex);
  const model = trainDownstreamUtilityBaseline(train);
  let homeModeHits = 0;
  let coveredFeatures = 0;
  let brierTotal = 0;
  let brierSamples = 0;

  for (const example of holdout) {
    const prediction = predictDownstreamUtility(model, example.featureKey);
    if (prediction.featureCovered) {
      coveredFeatures += 1;
    }
    if (prediction.homeMode === example.homeMode) {
      homeModeHits += 1;
    }
    for (const riskId of downstreamRiskIds) {
      const actual = example.risks[riskId] === true ? 1 : 0;
      const probability = prediction.risks[riskId] ?? 0;
      brierTotal += (probability - actual) ** 2;
      brierSamples += 1;
    }
  }

  return {
    trainExamples: train.length,
    holdoutExamples: holdout.length,
    homeModeTop1Accuracy: holdout.length > 0 ? roundRatio(homeModeHits / holdout.length) : 0,
    averageRiskBrierScore: brierSamples > 0 ? roundRatio(brierTotal / brierSamples) : 0,
    featureCoverageRatio: holdout.length > 0 ? roundRatio(coveredFeatures / holdout.length) : 0
  };
}

function createDownstreamUtilityExamples(days: EvaluationDayInput[]): DownstreamUtilityExample[] {
  return days.flatMap((day) => (day.forecastSamples ?? []).flatMap((sample) => {
    const truth = sample.truthByHorizon.find((candidate) => candidate.horizonMinutes === 60) ?? sample.truthByHorizon[0];
    if (!truth) {
      return [];
    }
    return [{
      featureKey: createObservationFeatureKey(sample.currentTime, sample.eventsUntilNow),
      homeMode: truth.snapshot.homeState.mode,
      risks: riskTruthLabels(truth.snapshot)
    }];
  }));
}

function trainDownstreamUtilityBaseline(examples: DownstreamUtilityExample[]): {
  buckets: Map<string, DownstreamUtilityBucket>;
  prior: DownstreamUtilityBucket;
} {
  const buckets = new Map<string, DownstreamUtilityBucket>();
  const prior = createDownstreamUtilityBucket();
  for (const example of examples) {
    updateDownstreamUtilityBucket(prior, example);
    const bucket = buckets.get(example.featureKey) ?? createDownstreamUtilityBucket();
    updateDownstreamUtilityBucket(bucket, example);
    buckets.set(example.featureKey, bucket);
  }
  return { buckets, prior };
}

function predictDownstreamUtility(
  model: ReturnType<typeof trainDownstreamUtilityBaseline>,
  featureKey: string
): {
  featureCovered: boolean;
  homeMode: string;
  risks: Record<string, number>;
} {
  const bucket = model.buckets.get(featureKey);
  const source = bucket ?? model.prior;
  return {
    featureCovered: bucket !== undefined,
    homeMode: topCount(source.homeModes),
    risks: Object.fromEntries(downstreamRiskIds.map((riskId) => [
      riskId,
      source.samples > 0 ? (source.riskPositiveCounts[riskId] ?? 0) / source.samples : 0
    ]))
  };
}

function createDownstreamUtilityBucket(): DownstreamUtilityBucket {
  return {
    samples: 0,
    homeModes: {},
    riskPositiveCounts: Object.fromEntries(downstreamRiskIds.map((riskId) => [riskId, 0]))
  };
}

function updateDownstreamUtilityBucket(bucket: DownstreamUtilityBucket, example: DownstreamUtilityExample): void {
  bucket.samples += 1;
  increment(bucket.homeModes, example.homeMode);
  for (const riskId of downstreamRiskIds) {
    if (example.risks[riskId]) {
      increment(bucket.riskPositiveCounts, riskId);
    }
  }
}

function createObservationFeatureKey(currentTime: string, events: TwinEvent[]): string {
  const features = new Set<string>([`time:${timeBucket(currentTime)}`]);
  for (const event of events) {
    if (event.type === 'DeviceTelemetry' && event.sourceLayer === 'sensor') {
      features.add(`sensor:${event.deviceType}`);
      features.add(`room:${event.roomId}`);
      if (event.measurements.motion === true) features.add(`motion:${event.roomId}`);
      if (event.measurements.online === false) features.add('router:offline');
      if (event.measurements.leak_detected === true) features.add('leak:detected');
      if (Number(event.measurements.power_w ?? 0) >= 400) features.add('stove:active');
      if (Number(event.measurements.co2 ?? 0) >= 900) features.add(`co2:${event.roomId}`);
      if (Number(event.measurements.pm25 ?? 0) >= 35) features.add(`pm25:${event.roomId}`);
    } else if (event.type === 'DeviceStateChanged' && event.sourceLayer === 'world') {
      features.add(`world:${event.deviceType}`);
      features.add(`room:${event.roomId}`);
      if (event.deviceId === 'fridge_01' && event.state.doorOpen === true) features.add('fridge:open');
      if (event.deviceId === 'router_01' && event.state.online === false) features.add('router:offline');
      if (event.deviceId === 'stove_01' && Number(event.state.powerW ?? 0) >= 400) features.add('stove:active');
    }
  }
  return [...features].sort().join('|');
}

function riskTruthLabels(snapshot: TwinSnapshot): Record<string, boolean> {
  return {
    fridge_left_open: snapshot.devices.fridge_01?.state.doorOpen === true,
    network_impact: snapshot.devices.router_01?.state.online === false,
    stove_unattended: Number(snapshot.devices.stove_01?.state.powerW ?? 0) >= 800 && !snapshot.rooms.kitchen?.humanOccupancy,
    senior_no_activity: snapshot.alerts.senior_no_activity_001?.status === 'active',
    water_leak: snapshot.devices.water_leak_01?.state.leakDetected === true
  };
}

function timeBucket(time: string): string {
  const minute = minuteOfDayFromTime(time);
  if (minute < 6 * 60) return 'night';
  if (minute < 10 * 60) return 'morning';
  if (minute < 17 * 60) return 'day';
  if (minute < 22 * 60) return 'evening';
  return 'night';
}

function topCount(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? 'unknown';
}

function riskBrierScore(risks: Record<string, number>, snapshot: TwinSnapshot): number {
  const truth = {
    fridge_left_open: snapshot.devices.fridge_01?.state.doorOpen === true,
    network_impact: snapshot.devices.router_01?.state.online === false,
    stove_unattended: Number(snapshot.devices.stove_01?.state.powerW ?? 0) >= 800 && !snapshot.rooms.kitchen?.humanOccupancy,
    senior_no_activity: snapshot.alerts.senior_no_activity_001?.status === 'active',
    water_leak: snapshot.devices.water_leak_01?.state.leakDetected === true
  };
  const entries = Object.entries(truth);
  if (entries.length === 0) {
    return 0;
  }
  const total = entries.reduce((sum, [riskId, actual]) => {
    const probability = Math.max(0, Math.min(1, risks[riskId] ?? 0));
    return sum + (probability - (actual ? 1 : 0)) ** 2;
  }, 0);
  return total / entries.length;
}

function isTopologyMoveAllowed(event: PersonMovedEvent, homeDefinition: HomeDefinition): boolean {
  if (event.from === 'away' || event.to === 'away' || event.from === event.to) {
    return true;
  }
  const room = homeDefinition.floors.flatMap((floor) => floor.rooms).find((candidate) => candidate.id === event.from);
  const roomAllowsMove = room?.connectedRooms.includes(event.to) ?? false;
  const reverseRoomAllowsMove = homeDefinition.floors
    .flatMap((floor) => floor.rooms)
    .find((candidate) => candidate.id === event.to)
    ?.connectedRooms.includes(event.from) ?? false;
  const topologyAllowsMove = homeDefinition.topology.connections.some((connection) => (
    connection.from === event.from && connection.to === event.to ||
    connection.from === event.to && connection.to === event.from
  ));
  return roomAllowsMove || reverseRoomAllowsMove || topologyAllowsMove;
}

function collectDeviceRooms(homeDefinition: HomeDefinition): Map<string, RoomId> {
  const rooms = new Map<string, RoomId>();
  for (const floor of homeDefinition.floors) {
    for (const device of floor.fixtures.devices) {
      rooms.set(device.id, device.roomId);
    }
  }
  return rooms;
}

function exclusiveResourcesForActivity(activityId: string): string[] {
  const aliases: Record<string, string[]> = {
    watching_tv: ['tv_01'],
    bathroom: ['bathroom_sink'],
    cooking_dinner: ['kitchen_stove'],
    breakfast: ['kitchen_stove'],
    weekday_breakfast: ['kitchen_stove'],
    weekend_brunch: ['kitchen_stove']
  };
  if (aliases[activityId]) {
    return aliases[activityId];
  }
  try {
    return getActivityTemplate(activityId)
      .requiredResources
      .map((resource) => resource.resourceId)
      .filter(isExclusiveResource);
  } catch {
    return [];
  }
}

function isExclusiveResource(resourceId: string): boolean {
  return resourceId.endsWith('_01') ||
    ['bathroom_sink', 'study_desk', 'kitchen_stove', 'door_access'].includes(resourceId);
}

function isCookingActivity(activityId: string): boolean {
  return ['cooking', 'meal_prep', 'prepare_breakfast', 'cooking_dinner', 'breakfast', 'weekday_breakfast', 'weekend_brunch'].includes(activityId);
}

function increment(record: Record<string, number>, key: string, amount = 1): void {
  record[key] = (record[key] ?? 0) + amount;
}

function incrementNested(record: Record<string, Record<string, number>>, from: string, to: string): void {
  record[from] = record[from] ?? {};
  increment(record[from], to);
}

function getSet<T extends string>(map: Map<string, Set<T>>, key: string): Set<T> {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }
  const created = new Set<T>();
  map.set(key, created);
  return created;
}

function getNumberList(map: Map<string, number[]>, key: string): number[] {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }
  const created: number[] = [];
  map.set(key, created);
  return created;
}

function summarizeMinutes(minutes: number[]): {
  samples: number;
  averageMinute: number;
  earliestMinute: number;
  latestMinute: number;
} {
  const ordered = [...minutes].sort((left, right) => left - right);
  const sum = ordered.reduce((total, value) => total + value, 0);
  return {
    samples: ordered.length,
    averageMinute: ordered.length > 0 ? Math.round(sum / ordered.length) : 0,
    earliestMinute: ordered[0] ?? 0,
    latestMinute: ordered[ordered.length - 1] ?? 0
  };
}

function summarizeDurations(minutes: number[]): {
  samples: number;
  averageMinutes: number;
  shortestMinutes: number;
  longestMinutes: number;
} {
  const ordered = [...minutes].sort((left, right) => left - right);
  const sum = ordered.reduce((total, value) => total + value, 0);
  return {
    samples: ordered.length,
    averageMinutes: ordered.length > 0 ? Math.round(sum / ordered.length * 100) / 100 : 0,
    shortestMinutes: ordered[0] ?? 0,
    longestMinutes: ordered[ordered.length - 1] ?? 0
  };
}

function calculateTrajectoryDivergence(visitedRoomsByPerson: Map<string, Set<RoomId>>): Record<string, number> {
  const entries = [...visitedRoomsByPerson.entries()];
  const scores: Record<string, number> = {};
  for (const [personId, rooms] of entries) {
    const comparisons = entries
      .filter(([otherPersonId]) => otherPersonId !== personId)
      .map(([, otherRooms]) => 1 - jaccardSimilarity(rooms, otherRooms));
    scores[personId] = comparisons.length > 0 ? roundRatio(comparisons.reduce((sum, value) => sum + value, 0) / comparisons.length) : 0;
  }
  return scores;
}

function jaccardSimilarity<T>(left: Set<T>, right: Set<T>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) {
    return 1;
  }
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }
  return intersection / union.size;
}

function minuteOfDayFromTime(time: string): number {
  const match = time.match(/T(\d{2}):(\d{2}):/);
  if (!match) {
    return 0;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function isWeekendDate(dateText: string): boolean {
  const day = new Date(`${dateText}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

function dailyActivitySimilarity(dailyCounts: Array<Record<string, number>>): number {
  if (dailyCounts.length < 2) {
    return 1;
  }
  let total = 0;
  let comparisons = 0;
  for (let index = 1; index < dailyCounts.length; index += 1) {
    total += cosineSimilarity(dailyCounts[index - 1], dailyCounts[index]);
    comparisons += 1;
  }
  return roundRatio(comparisons > 0 ? total / comparisons : 1);
}

function cosineSimilarity(left: Record<string, number>, right: Record<string, number>): number {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (const key of keys) {
    const leftValue = left[key] ?? 0;
    const rightValue = right[key] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function transitionVariationScore(transitionsByDay: number[]): number {
  if (transitionsByDay.length < 2) {
    return 0;
  }
  const average = transitionsByDay.reduce((sum, value) => sum + value, 0) / transitionsByDay.length;
  if (average === 0) {
    return 0;
  }
  const variance = transitionsByDay.reduce((sum, value) => sum + (value - average) ** 2, 0) / transitionsByDay.length;
  return roundRatio(Math.min(1, Math.sqrt(variance) / average));
}

function roundRatio(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function averageIntervalMinutes(timestamps: number[]): number {
  const ordered = [...timestamps].sort((left, right) => left - right);
  if (ordered.length < 2) {
    return 0;
  }
  let total = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    total += ordered[index] - ordered[index - 1];
  }
  return Math.round(total / (ordered.length - 1) / 60000 * 100) / 100;
}

function countBurstIntervals(timestamps: number[]): number {
  const ordered = [...timestamps].sort((left, right) => left - right);
  let bursts = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    if ((ordered[index] - ordered[index - 1]) / 60000 <= 2) {
      bursts += 1;
    }
  }
  return bursts;
}

function longestSilentMinutes(timestamps: number[]): number {
  const ordered = [...timestamps].sort((left, right) => left - right);
  if (ordered.length < 2) {
    return 0;
  }
  let longest = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    longest = Math.max(longest, (ordered[index] - ordered[index - 1]) / 60000);
  }
  return Math.round(longest * 100) / 100;
}

function createDeviceCorrelations(minuteKeysByDevice: Map<string, Set<number>>): SimulationEvaluationReport['sensor']['deviceCorrelations'] {
  const entries = [...minuteKeysByDevice.entries()];
  const correlations: SimulationEvaluationReport['sensor']['deviceCorrelations'] = [];
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const [leftDeviceId, leftMinutes] = entries[leftIndex];
      const [rightDeviceId, rightMinutes] = entries[rightIndex];
      const sameMinuteCount = [...leftMinutes].filter((minute) => rightMinutes.has(minute)).length;
      if (sameMinuteCount > 0) {
        correlations.push({ leftDeviceId, rightDeviceId, sameMinuteCount });
      }
    }
  }
  return correlations
    .sort((left, right) => right.sameMinuteCount - left.sameMinuteCount || left.leftDeviceId.localeCompare(right.leftDeviceId))
    .slice(0, 20);
}

function createStoveLagMetrics(events: TwinEvent[]): SimulationEvaluationReport['sensor']['stoveLag'] {
  const stoveTimes = events
    .filter((event) => event.type === 'DeviceStateChanged' && event.deviceId === 'stove_01' && Number(event.state.powerW ?? 0) > 0)
    .map((event) => Date.parse(event.simTime));
  const kitchenTelemetry = events
    .filter((event): event is DeviceTelemetryEvent => event.type === 'DeviceTelemetry' && event.roomId === 'kitchen')
    .sort((left, right) => Date.parse(left.simTime) - Date.parse(right.simTime));
  const pm25Lags: number[] = [];
  const temperatureLags: number[] = [];

  for (const stoveTime of stoveTimes) {
    const pm25 = kitchenTelemetry.find((event) => Date.parse(event.simTime) >= stoveTime && typeof event.measurements.pm25 === 'number');
    const temperature = kitchenTelemetry.find((event) => Date.parse(event.simTime) >= stoveTime && typeof event.measurements.temperature_c === 'number');
    if (pm25) pm25Lags.push((Date.parse(pm25.simTime) - stoveTime) / 60000);
    if (temperature) temperatureLags.push((Date.parse(temperature.simTime) - stoveTime) / 60000);
  }

  return {
    pm25LagMinutes: averageNumber(pm25Lags),
    temperatureLagMinutes: averageNumber(temperatureLags),
    sampleCount: stoveTimes.length
  };
}

function createCo2OccupancyCorrelation(events: TwinEvent[]): number {
  const peopleByRoom = new Map<RoomId, Set<string>>();
  const samples: Array<{ occupancy: number; co2: number }> = [];
  const sorted = [...events].sort((left, right) => Date.parse(left.simTime) - Date.parse(right.simTime) || left.sequence - right.sequence);
  for (const event of sorted) {
    if (event.type === 'PersonMoved' && event.personId !== 'pet_1') {
      for (const people of peopleByRoom.values()) {
        people.delete(event.personId);
      }
      if (event.to !== 'away') {
        const people = peopleByRoom.get(event.to) ?? new Set<string>();
        people.add(event.personId);
        peopleByRoom.set(event.to, people);
      }
    }
    if (event.type === 'DeviceTelemetry' && typeof event.measurements.co2 === 'number') {
      samples.push({
        occupancy: peopleByRoom.get(event.roomId)?.size ?? 0,
        co2: event.measurements.co2
      });
    }
  }
  return pearsonCorrelation(samples.map((sample) => sample.occupancy), samples.map((sample) => sample.co2));
}

function averageNumber(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100;
}

function pearsonCorrelation(left: number[], right: number[]): number {
  if (left.length < 2 || left.length !== right.length) {
    return 0;
  }
  const leftAverage = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightAverage = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftAverage;
    const rightDelta = right[index] - rightAverage;
    numerator += leftDelta * rightDelta;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
  }
  if (leftVariance === 0 || rightVariance === 0) {
    return 0;
  }
  return Math.round(numerator / Math.sqrt(leftVariance * rightVariance) * 1000) / 1000;
}
