import type { RoomId } from '../../shared/types';
import { createExternalContext, type ExternalContext } from '../externalContext';
import type { PersonaProfile } from './persona';

export interface DailyCommitment {
  personId: string;
  activityId: string;
  roomId: RoomId;
  window: {
    startMinute: number;
    endMinute: number;
  };
  priority: number;
  source: 'role' | 'care' | 'household' | 'habit';
}

export interface DailyCommitmentInput {
  persona: PersonaProfile;
  date: string;
  seed: number;
  externalContext?: ExternalContext;
}

export function createDailyCommitments(input: DailyCommitmentInput): DailyCommitment[] {
  const jitter = deterministicJitter(`${input.persona.personId}:${input.date}:${input.seed}`);
  const externalContext = input.externalContext ?? createExternalContext({ date: input.date, seed: input.seed });
  const commitments: DailyCommitment[] = [];
  if (input.persona.role === 'remote_worker' && externalContext.calendar.workday) {
    commitments.push(commitment(input.persona, 'remote_work_session', 'study', 9 * 60 + jitter, 17 * 60, 86, 'role'));
  }
  if (input.persona.role === 'student' && externalContext.calendar.schoolDay) {
    commitments.push(commitment(input.persona, 'study_homework', 'living_room', 16 * 60 + 20 + jitter, 18 * 60 + 20, 84, 'role'));
  }
  if (input.persona.role === 'senior') {
    commitments.push(commitment(input.persona, 'take_medicine', 'master_bedroom', 8 * 60 + 10 + jitter, 10 * 60, 82, 'care'));
    if (!isOutdoorCareSuppressed(externalContext)) {
      commitments.push(commitment(input.persona, 'gardening', 'garden', 9 * 60 + 20 + jitter, 11 * 60, 62, 'habit'));
    }
  }
  if (input.persona.role === 'commuter' && externalContext.calendar.workday) {
    commitments.push(commitment(input.persona, 'commute_out', 'entrance', 7 * 60 + 45 + jitter, 9 * 60, 78, 'role'));
    commitments.push(commitment(input.persona, 'arrive_home', 'entrance', 17 * 60 + 20 + jitter, 19 * 60, 74, 'role'));
  }
  if (input.persona.role !== 'pet') {
    commitments.push(commitment(input.persona, 'eat_meal', 'dining_room', 18 * 60 + 30 + jitter, 20 * 60, 58, 'household'));
  }
  return commitments.sort((left, right) => left.window.startMinute - right.window.startMinute || right.priority - left.priority);
}

function isOutdoorCareSuppressed(context: ExternalContext): boolean {
  return context.weather.condition === 'heavy_rain' || context.weather.precipitationMm >= 10;
}

export function commitmentPressureAtMinute(
  commitments: DailyCommitment[],
  minuteOfDay: number,
  activityId?: string
): number {
  const relevant = activityId ? commitments.filter((commitment) => commitment.activityId === activityId) : commitments;
  return Math.max(0, ...relevant.map((commitment) => pressureForCommitment(commitment, minuteOfDay)));
}

function commitment(
  persona: PersonaProfile,
  activityId: string,
  roomId: RoomId,
  startMinute: number,
  endMinute: number,
  priority: number,
  source: DailyCommitment['source']
): DailyCommitment {
  return {
    personId: persona.personId,
    activityId,
    roomId,
    window: {
      startMinute: clampMinute(startMinute),
      endMinute: clampMinute(Math.max(startMinute + 15, endMinute))
    },
    priority,
    source
  };
}

function pressureForCommitment(commitment: DailyCommitment, minuteOfDay: number): number {
  if (minuteOfDay < commitment.window.startMinute - 30 || minuteOfDay > commitment.window.endMinute) {
    return 0;
  }
  if (minuteOfDay >= commitment.window.startMinute) {
    return commitment.priority;
  }
  const proximity = 1 - (commitment.window.startMinute - minuteOfDay) / 30;
  return Math.round(commitment.priority * Math.max(0, proximity) * 10) / 10;
}

function deterministicJitter(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.round(((hash >>> 0) / 0xffffffff) * 20 - 10);
}

function clampMinute(value: number): number {
  return Math.max(0, Math.min(24 * 60 - 1, Math.round(value)));
}
