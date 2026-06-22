import type { RoomId, TwinEvent } from '../shared/types';
import { createBeliefDistribution, type BeliefDistribution } from './beliefState';
import { createAnomalyRisks, createStateForecasts, type AnomalyRisk, type TwinStateForecast } from './forecast';
import { extractObservationEvidence, roomEvidenceScore } from './observationLikelihood';

export type InferredHomeMode = 'morning' | 'breakfast' | 'away' | 'dinner' | 'evening_home' | 'sleeping' | 'alert';

export interface TwinInferenceOptions {
  currentTime: string;
  peopleIds: string[];
  rooms: RoomId[];
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
}

export function inferTwinState(events: TwinEvent[], options: TwinInferenceOptions): TwinInferenceResult {
  const evidence = extractObservationEvidence(events);
  const minuteOfDay = minuteOfDayFromTime(options.currentTime);
  const homeMode = inferHomeMode(minuteOfDay, evidence);
  const people = Object.fromEntries(options.peopleIds.map((personId) => {
    const room = inferPersonRoom(personId, options.rooms, minuteOfDay, evidence);
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
      homeModeByHorizon: createHomeModeForecasts(minuteOfDay, evidence)
    })
  };
}

function createHomeModeForecasts(
  minuteOfDay: number,
  evidence: ReturnType<typeof extractObservationEvidence>
): Partial<Record<15 | 30 | 60, BeliefDistribution<InferredHomeMode>>> {
  return {
    15: inferHomeMode(addMinutesOfDay(minuteOfDay, 15), evidence),
    30: inferHomeMode(addMinutesOfDay(minuteOfDay, 30), evidence),
    60: inferHomeMode(addMinutesOfDay(minuteOfDay, 60), evidence)
  };
}

function inferPersonRoom(
  personId: string,
  rooms: RoomId[],
  minuteOfDay: number,
  evidence: ReturnType<typeof extractObservationEvidence>
): BeliefDistribution<RoomId> {
  const scores = Object.fromEntries(rooms.map((roomId) => [
    roomId,
    roomPrior(personId, roomId, minuteOfDay) + roomEvidenceScore(roomId, evidence)
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
  return createBeliefDistribution(scores);
}

function inferHomeMode(
  minuteOfDay: number,
  evidence: ReturnType<typeof extractObservationEvidence>
): BeliefDistribution<InferredHomeMode> {
  const scores: Record<InferredHomeMode, number> = {
    morning: minuteOfDay >= 6 * 60 && minuteOfDay < 10 * 60 ? 2.5 : 0.5,
    breakfast: minuteOfDay >= 6 * 60 && minuteOfDay < 9 * 60 ? 2.2 : 0.4,
    away: minuteOfDay >= 9 * 60 && minuteOfDay < 16 * 60 ? 2.4 : 0.5,
    dinner: minuteOfDay >= 17 * 60 && minuteOfDay < 20 * 60 ? 3.2 : 0.4,
    evening_home: minuteOfDay >= 18 * 60 && minuteOfDay < 22 * 60 ? 2.1 : 0.5,
    sleeping: minuteOfDay >= 22 * 60 || minuteOfDay < 6 * 60 ? 3.1 : 0.4,
    alert: evidence.waterLeakDetected ? 5.5 : evidence.fridgeDoorOpen || evidence.routerOffline ? 1.2 : 0.2
  };
  if (evidence.fridgeDoorOpen || evidence.motionByRoom.kitchen) {
    scores.dinner += 1.8;
  }
  return createBeliefDistribution(scores);
}

function roomPrior(personId: string, roomId: RoomId, minuteOfDay: number): number {
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
  if (personId === 'adult_2' && roomId === 'study' && minuteOfDay >= 9 * 60 && minuteOfDay < 18 * 60) {
    return 2.4;
  }
  return 1;
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
