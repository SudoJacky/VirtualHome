import type { RoomId, TwinEvent } from '../shared/types';
import type { ExternalContext } from '../sim/externalContext';
import { createBeliefDistribution, type BeliefDistribution } from './beliefState';
import { createAnomalyRisks, createStateForecasts, type AnomalyRisk, type TwinStateForecast } from './forecast';
import { extractObservationEvidence, roomEvidenceScore } from './observationLikelihood';

export type InferredHomeMode = 'morning' | 'breakfast' | 'away' | 'dinner' | 'evening_home' | 'sleeping' | 'alert';

export interface TwinInferenceOptions {
  currentTime: string;
  peopleIds: string[];
  rooms: RoomId[];
  externalContext?: ExternalContext;
}

export interface PersonInferenceBelief {
  personId: string;
  room: BeliefDistribution<RoomId>;
  activity: BeliefDistribution<string>;
}

export interface TwinInferenceResult {
  inputSummary: {
    acceptedEventCount: number;
    rejectedEventTypes: string[];
    droppedObservationEvents: number;
    observationOnly: true;
  };
  people: Record<string, PersonInferenceBelief>;
  homeMode: BeliefDistribution<InferredHomeMode>;
  risks: Record<string, AnomalyRisk>;
  forecasts: TwinStateForecast[];
  explanations: TwinInferenceExplanations;
}

export interface TwinInferenceExplanations {
  homeMode: string[];
  people: Record<string, {
    room: string[];
    activity: string[];
  }>;
  risks: Record<string, string[]>;
}

export function inferTwinState(events: TwinEvent[], options: TwinInferenceOptions): TwinInferenceResult {
  const evidence = extractObservationEvidence(events);
  const minuteOfDay = minuteOfDayFromTime(options.currentTime);
  const homeMode = inferHomeMode(minuteOfDay, evidence, options.externalContext);
  const people = Object.fromEntries(options.peopleIds.map((personId) => {
    const room = inferPersonRoom(personId, options.rooms, minuteOfDay, evidence, options.externalContext);
    return [personId, {
      personId,
      room,
      activity: inferPersonActivity(room.top, minuteOfDay, evidence)
    }];
  }));
  const risks = createAnomalyRisks({
    fridgeDoorOpen: evidence.fridgeDoorOpen,
    routerOffline: evidence.routerOffline,
    stovePowerW: evidence.stovePowerW,
    kitchenMotionConfidence: evidence.motionByRoom.kitchen ?? 0,
    noRecentMotionInSleepingHours: minuteOfDay >= 22 * 60 && Object.keys(evidence.motionByRoom).length === 0,
    morningSleepSensorInBed: minuteOfDay >= 9 * 60 && minuteOfDay < 12 * 60 && evidence.sleepSensorInBed,
    waterLeakDetected: evidence.waterLeakDetected
  });

  return {
    inputSummary: {
      acceptedEventCount: evidence.acceptedEvents.length,
      rejectedEventTypes: evidence.rejectedEventTypes,
      droppedObservationEvents: evidence.droppedObservationEvents,
      observationOnly: true
    },
    people,
    homeMode,
    risks,
    forecasts: createStateForecasts(homeMode, risks, {
      homeModeByHorizon: createHomeModeForecasts(minuteOfDay, evidence, options.externalContext),
      peopleByHorizon: createPeopleForecasts(options.peopleIds, options.rooms, minuteOfDay, evidence, options.externalContext)
    }),
    explanations: createTwinInferenceExplanations(minuteOfDay, evidence, people, risks, options.externalContext)
  };
}

function createTwinInferenceExplanations(
  minuteOfDay: number,
  evidence: ReturnType<typeof extractObservationEvidence>,
  people: Record<string, PersonInferenceBelief>,
  risks: Record<string, AnomalyRisk>,
  externalContext: ExternalContext | undefined
): TwinInferenceExplanations {
  return {
    homeMode: explainHomeMode(minuteOfDay, evidence, externalContext),
    people: Object.fromEntries(Object.entries(people).map(([personId, belief]) => [
      personId,
      {
        room: explainRoomBelief(belief.room.top, minuteOfDay, evidence, externalContext),
        activity: explainActivityBelief(belief.activity.top, belief.room.top, minuteOfDay, evidence)
      }
    ])),
    risks: Object.fromEntries(Object.entries(risks).map(([riskId, risk]) => [riskId, [...risk.drivers]]))
  };
}

function explainHomeMode(
  minuteOfDay: number,
  evidence: ReturnType<typeof extractObservationEvidence>,
  externalContext: ExternalContext | undefined
): string[] {
  const reasons: string[] = [];
  if (minuteOfDay >= 17 * 60 && minuteOfDay < 20 * 60) {
    reasons.push('time_prior:evening_meal_window');
  } else if (minuteOfDay >= 22 * 60 || minuteOfDay < 6 * 60) {
    reasons.push('time_prior:sleep_window');
  } else if (minuteOfDay >= 9 * 60 && minuteOfDay < 16 * 60 && isWorkday(externalContext)) {
    reasons.push('time_prior:workday_away_window');
  } else {
    reasons.push('time_prior:daily_routine');
  }
  if (evidence.fridgeDoorOpen || evidence.motionByRoom.kitchen || (evidence.pm25ByRoom.kitchen ?? 0) >= 35) {
    reasons.push('observation:kitchen_activity');
  }
  if (evidence.waterLeakDetected) reasons.push('observation:water_leak_detected');
  if (evidence.routerOffline) reasons.push('observation:router_offline');
  if (isSevereWeather(externalContext)) reasons.push('context:severe_weather');
  return reasons;
}

function explainRoomBelief(
  roomId: RoomId,
  minuteOfDay: number,
  evidence: ReturnType<typeof extractObservationEvidence>,
  externalContext: ExternalContext | undefined
): string[] {
  const reasons: string[] = [];
  if (evidence.motionByRoom[roomId] !== undefined) reasons.push(`observation:${roomId}_motion`);
  if (evidence.activeDeviceRooms[roomId] !== undefined) reasons.push(`observation:${roomId}_device_state`);
  if (evidence.co2ByRoom[roomId] !== undefined) reasons.push(`observation:${roomId}_co2`);
  if (evidence.pm25ByRoom[roomId] !== undefined) reasons.push(`observation:${roomId}_pm25`);
  if (roomId === 'master_bedroom' && evidence.sleepSensorInBed) reasons.push('observation:sleep_sensor_in_bed');
  if (reasons.length === 0) {
    if (minuteOfDay >= 22 * 60 || minuteOfDay < 6 * 60) reasons.push('time_prior:sleep_window');
    else if (isWorkday(externalContext) && minuteOfDay >= 9 * 60 && minuteOfDay < 18 * 60) reasons.push('time_prior:workday_routine');
    else reasons.push('time_prior:daily_routine');
  }
  return reasons;
}

function explainActivityBelief(
  activity: string,
  roomId: RoomId,
  minuteOfDay: number,
  evidence: ReturnType<typeof extractObservationEvidence>
): string[] {
  const reasons: string[] = [];
  if (activity === 'meal_prep_or_kitchen_visit' && roomId === 'kitchen') {
    if (evidence.fridgeDoorOpen) reasons.push('observation:fridge_door_open');
    if (evidence.stovePowerW >= 400) reasons.push('observation:stove_power');
    if ((evidence.pm25ByRoom.kitchen ?? 0) >= 35) reasons.push('observation:kitchen_pm25');
    if (evidence.motionByRoom.kitchen !== undefined) reasons.push('observation:kitchen_motion');
  }
  if (activity === 'remote_work_or_study' && roomId === 'study' && (evidence.co2ByRoom.study ?? 0) >= 900) {
    reasons.push('observation:study_co2');
  }
  if (activity === 'sleeping_or_resting' && roomId === 'master_bedroom' && evidence.sleepSensorInBed) {
    reasons.push('observation:sleep_sensor_in_bed');
  }
  if (reasons.length === 0) {
    reasons.push(minuteOfDay >= 22 * 60 || minuteOfDay < 6 * 60 ? 'time_prior:sleep_window' : 'time_prior:daily_routine');
  }
  return reasons;
}

function createHomeModeForecasts(
  minuteOfDay: number,
  evidence: ReturnType<typeof extractObservationEvidence>,
  externalContext: ExternalContext | undefined
): Partial<Record<15 | 30 | 60, BeliefDistribution<InferredHomeMode>>> {
  return {
    15: inferHomeMode(addMinutesOfDay(minuteOfDay, 15), evidence, externalContext),
    30: inferHomeMode(addMinutesOfDay(minuteOfDay, 30), evidence, externalContext),
    60: inferHomeMode(addMinutesOfDay(minuteOfDay, 60), evidence, externalContext)
  };
}

function createPeopleForecasts(
  peopleIds: string[],
  rooms: RoomId[],
  minuteOfDay: number,
  evidence: ReturnType<typeof extractObservationEvidence>,
  externalContext: ExternalContext | undefined
): Partial<Record<15 | 30 | 60, Record<string, PersonInferenceBelief>>> {
  return {
    15: inferPeopleAtMinute(peopleIds, rooms, addMinutesOfDay(minuteOfDay, 15), evidence, externalContext),
    30: inferPeopleAtMinute(peopleIds, rooms, addMinutesOfDay(minuteOfDay, 30), evidence, externalContext),
    60: inferPeopleAtMinute(peopleIds, rooms, addMinutesOfDay(minuteOfDay, 60), evidence, externalContext)
  };
}

function inferPeopleAtMinute(
  peopleIds: string[],
  rooms: RoomId[],
  minuteOfDay: number,
  evidence: ReturnType<typeof extractObservationEvidence>,
  externalContext: ExternalContext | undefined
): Record<string, PersonInferenceBelief> {
  return Object.fromEntries(peopleIds.map((personId) => {
    const room = inferPersonRoom(personId, rooms, minuteOfDay, evidence, externalContext);
    return [personId, {
      personId,
      room,
      activity: inferPersonActivity(room.top, minuteOfDay, evidence)
    }];
  }));
}

function inferPersonRoom(
  personId: string,
  rooms: RoomId[],
  minuteOfDay: number,
  evidence: ReturnType<typeof extractObservationEvidence>,
  externalContext: ExternalContext | undefined
): BeliefDistribution<RoomId> {
  const scores = Object.fromEntries(rooms.map((roomId) => [
    roomId,
    roomPrior(personId, roomId, minuteOfDay, externalContext) + roomEvidenceScore(roomId, evidence)
  ])) as Record<RoomId, number>;
  return createBeliefDistribution(scores);
}

function inferPersonActivity(
  roomId: RoomId,
  minuteOfDay: number,
  evidence: ReturnType<typeof extractObservationEvidence>
): BeliefDistribution<string> {
  const scores: Record<string, number> = {
    sleeping_or_resting: minuteOfDay >= 22 * 60 || minuteOfDay < 6 * 60 ? 3.2 : 0.3,
    meal_prep_or_kitchen_visit: roomId === 'kitchen' ? 2.6 : 0.6,
    household_leisure: minuteOfDay >= 18 * 60 && minuteOfDay < 22 * 60 ? 2.2 : 0.8,
    remote_work_or_study: roomId === 'study' ? 2.4 : 0.5,
    away_or_unknown: 0.8
  };
  if (roomId === 'kitchen' && evidence.fridgeDoorOpen) {
    scores.meal_prep_or_kitchen_visit += 3.8;
  }
  if (roomId === 'kitchen' && (evidence.stovePowerW >= 400 || (evidence.pm25ByRoom.kitchen ?? 0) >= 35)) {
    scores.meal_prep_or_kitchen_visit += 2.6;
  }
  if (roomId === 'study' && (evidence.co2ByRoom.study ?? 0) >= 900) {
    scores.remote_work_or_study += 3.2;
  }
  if (roomId === 'master_bedroom' && evidence.sleepSensorInBed) {
    scores.sleeping_or_resting += 4.4;
  }
  return createBeliefDistribution(scores);
}

function inferHomeMode(
  minuteOfDay: number,
  evidence: ReturnType<typeof extractObservationEvidence>,
  externalContext: ExternalContext | undefined
): BeliefDistribution<InferredHomeMode> {
  const workday = isWorkday(externalContext);
  const severeWeather = isSevereWeather(externalContext);
  const scores: Record<InferredHomeMode, number> = {
    morning: minuteOfDay >= 6 * 60 && minuteOfDay < 10 * 60 ? 2.5 : 0.5,
    breakfast: minuteOfDay >= 6 * 60 && minuteOfDay < 9 * 60 ? 2.2 : 0.4,
    away: minuteOfDay >= 9 * 60 && minuteOfDay < 16 * 60 ? workday ? severeWeather ? 1.6 : 2.4 : 0.6 : 0.5,
    dinner: minuteOfDay >= 17 * 60 && minuteOfDay < 20 * 60 ? 3.2 : 0.4,
    evening_home: minuteOfDay >= 18 * 60 && minuteOfDay < 22 * 60 ? 2.1 : workday ? severeWeather ? 0.9 : 0.5 : 1.3,
    sleeping: minuteOfDay >= 22 * 60 || minuteOfDay < 6 * 60 ? 3.1 : 0.4,
    alert: evidence.waterLeakDetected ? 5.5 : evidence.fridgeDoorOpen || evidence.routerOffline ? 1.2 : 0.2
  };
  if (evidence.fridgeDoorOpen || evidence.motionByRoom.kitchen) {
    scores.dinner += 1.8;
  }
  return createBeliefDistribution(scores);
}

function roomPrior(personId: string, roomId: RoomId, minuteOfDay: number, externalContext: ExternalContext | undefined): number {
  const workday = isWorkday(externalContext);
  const severeWeather = isSevereWeather(externalContext);
  if (minuteOfDay >= 22 * 60 || minuteOfDay < 6 * 60) {
    if (personId === 'child_1' && roomId === 'child_bedroom') return 3;
    if (personId !== 'child_1' && roomId === 'master_bedroom') return 3;
  }
  if (minuteOfDay >= 17 * 60 && minuteOfDay < 20 * 60 && roomId === 'kitchen') {
    return 2.2;
  }
  if (minuteOfDay >= 18 * 60 && minuteOfDay < 22 * 60 && roomId === 'living_room') {
    return 1.8;
  }
  if (personId === 'adult_2' && roomId === 'study' && minuteOfDay >= 9 * 60 && minuteOfDay < 18 * 60 && workday) {
    return 2.4;
  }
  if (severeWeather && minuteOfDay >= 9 * 60 && minuteOfDay < 18 * 60 && roomId === 'living_room') {
    return workday ? 1.5 : 2;
  }
  if (!workday && minuteOfDay >= 9 * 60 && minuteOfDay < 18 * 60 && roomId === 'living_room') return 1.8;
  return 1;
}

function isWorkday(externalContext: ExternalContext | undefined): boolean {
  return externalContext?.calendar.workday ?? true;
}

function isSevereWeather(externalContext: ExternalContext | undefined): boolean {
  const condition = externalContext?.weather.condition;
  return condition === 'heavy_rain' || condition === 'hot' || condition === 'cold';
}

function minuteOfDayFromTime(time: string): number {
  const match = time.match(/T(\d{2}):(\d{2}):/);
  if (!match) {
    return 12 * 60;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function addMinutesOfDay(minuteOfDay: number, minutes: number): number {
  return (minuteOfDay + minutes) % (24 * 60);
}
