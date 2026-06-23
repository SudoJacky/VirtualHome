import type { HomeMemory, MemoryEvidence, RoomMemory, TimeBucket } from './homeMemoryModel';

export type ProfileHypothesisType =
  | 'household_size'
  | 'daily_rhythm'
  | 'room_habit'
  | 'device_routine'
  | 'presence_signal'
  | 'activity_cluster';

export interface ProfileHypothesis {
  id: string;
  type: ProfileHypothesisType;
  label: string;
  summary: string;
  confidence: number;
  updatedAt: string;
  subjectIds: string[];
  evidence: MemoryEvidence[];
}

const TIME_BUCKETS: TimeBucket[] = ['morning', 'daytime', 'evening', 'night'];

export function createHomeProfileHypotheses(memory: HomeMemory): ProfileHypothesis[] {
  if (memory.totalEvents === 0 || memory.recentEvents.length === 0) {
    return [];
  }

  const activeRooms = sortedRooms(memory);

  return [
    ...createDailyRhythms(memory),
    ...activeRooms.map((room) => createRoomHabit(room, memory.totalEvents)),
    ...activeRooms
      .filter((room) => room.devices.length >= 2 && room.eventCount >= 3)
      .map((room) => createDeviceRoutine(room, memory.totalEvents)),
    createPresenceSignal(memory),
    ...(activeRooms.length > 0 ? [createHouseholdSize(memory, activeRooms)] : [])
  ];
}

function createDailyRhythms(memory: HomeMemory): ProfileHypothesis[] {
  return TIME_BUCKETS
    .filter((bucket) => memory.recentEvents.some((event) => event.timeBucket === bucket))
    .map((bucket) => {
      const evidence = memory.recentEvents.filter((event) => event.timeBucket === bucket);
      const rooms = sortedUnique(evidence.map((event) => event.roomId));
      const eventCount = evidence.length;
      const evidenceWeight = weightOf(evidence);

      return hypothesis({
        id: `rhythm:${bucket}`,
        type: 'daily_rhythm',
        label: `${titleCase(bucket)} activity rhythm`,
        summary: `${eventCount} recent ${bucket} event${plural(eventCount)} across ${formatList(rooms)}, weighted ${formatWeight(evidenceWeight)} for profile inference.`,
        confidence: confidenceFromCount(evidenceWeight, memory.profileEvidenceWeight, 0.9, evidenceWeight),
        subjectIds: toRoomSubjectIds(rooms),
        evidence
      });
    });
}

function createRoomHabit(room: RoomMemory, totalEvents: number): ProfileHypothesis {
  const strongestBucket = strongestTimeBucket(room.timeBuckets);
  const devices = sortedUnique(room.devices);

  return hypothesis({
    id: `room:${room.roomId}:habit`,
    type: 'room_habit',
    label: `${titleCase(room.roomId)} habit`,
    summary: `${room.roomId} activity is strongest during ${strongestBucket}, based on ${room.eventCount} event${plural(room.eventCount)} and ${formatWeight(room.profileEvidenceWeight)} weighted profile evidence.`,
    confidence: confidenceFromCount(room.profileEvidenceWeight, totalEvents, 0.85, room.profileEvidenceWeight),
    subjectIds: [`room:${room.roomId}`, ...toDeviceSubjectIds(devices)],
    evidence: room.recentEvents
  });
}

function createDeviceRoutine(room: RoomMemory, totalEvents: number): ProfileHypothesis {
  const devices = sortedUnique(room.devices);
  const strongestBucket = strongestTimeBucket(room.timeBuckets);

  return hypothesis({
    id: `room:${room.roomId}:device-routine`,
    type: 'device_routine',
    label: `${titleCase(room.roomId)} device routine`,
    summary: `${devices.length} devices in ${room.roomId} show multi-device activity, strongest during ${strongestBucket}.`,
    confidence: confidenceFromCount(room.profileEvidenceWeight + devices.length, totalEvents + devices.length, 0.8, room.profileEvidenceWeight),
    subjectIds: [`room:${room.roomId}`, ...toDeviceSubjectIds(devices)],
    evidence: room.recentEvents
  });
}

function createPresenceSignal(memory: HomeMemory): ProfileHypothesis {
  const rooms = sortedUnique(memory.recentEvents.map((event) => event.roomId));
  const activeRoomCount = rooms.length;
  const presenceEvidence = meaningfulEvidence(memory.recentEvents);
  const meaningfulRoomCount = sortedUnique(presenceEvidence.map((event) => event.roomId)).length;
  const meaningfulWeight = weightOf(presenceEvidence);

  return hypothesis({
    id: 'presence:recent-activity',
    type: 'presence_signal',
    label: 'Recent presence signal',
    summary: meaningfulWeight > 0
      ? `Recent meaningful device activity may indicate presence across ${meaningfulRoomCount} active room${plural(meaningfulRoomCount)}.`
      : `Recent activity across ${activeRoomCount} room${plural(activeRoomCount)} is mostly weak environment context; presence remains uncertain.`,
    confidence: confidenceWithSampleSize(
      meaningfulWeight > 0
        ? 0.25 + Math.min(0.45, meaningfulWeight / 8) + Math.min(0.15, meaningfulRoomCount / 20)
        : 0.2,
      meaningfulWeight
    ),
    subjectIds: toRoomSubjectIds(rooms),
    evidence: memory.recentEvents
  });
}

function createHouseholdSize(memory: HomeMemory, activeRooms: RoomMemory[]): ProfileHypothesis {
  const rooms = activeRooms.map((room) => room.roomId);
  const meaningfulRooms = activeRooms.filter((room) => meaningfulWeightOfRoom(room) > 0);
  const activeRoomCount = meaningfulRooms.length;
  const meaningfulWeight = meaningfulRooms.reduce((total, room) => total + meaningfulWeightOfRoom(room), 0);
  const estimate = estimateHouseholdSize(activeRoomCount, meaningfulWeight);
  const sparseEvidence = meaningfulWeight <= 3;
  const mostlyWeakContext = activeRoomCount === 0;

  return hypothesis({
    id: 'household:size',
    type: 'household_size',
    label: 'Probable household size',
    summary: mostlyWeakContext
      ? `Observed activity is mostly weak environment context across ${rooms.length} room${plural(rooms.length)}; resident count remains uncertain.`
      : sparseEvidence
        ? `Meaningful activity across ${activeRoomCount} active room${plural(activeRoomCount)} with ${formatWeight(meaningfulWeight)} weighted evidence is sparse; resident count remains uncertain.`
        : `Meaningful activity across ${activeRoomCount} active room${plural(activeRoomCount)} with ${formatWeight(meaningfulWeight)} weighted evidence suggests likely ${estimate}; this is probabilistic, not a confirmed resident count.`,
    confidence: confidenceWithSampleSize(
      mostlyWeakContext
        ? 0.25
        : 0.3 + Math.min(0.3, activeRoomCount / 10) + Math.min(0.25, meaningfulWeight / 20),
      meaningfulWeight
    ),
    subjectIds: toRoomSubjectIds(rooms),
    evidence: memory.recentEvents
  });
}

function hypothesis(input: Omit<ProfileHypothesis, 'updatedAt'>): ProfileHypothesis {
  return {
    ...input,
    confidence: clamp(input.confidence),
    updatedAt: input.evidence[0].simTime
  };
}

function sortedRooms(memory: HomeMemory): RoomMemory[] {
  return Object.values(memory.rooms)
    .filter((room) => room.eventCount > 0 && room.recentEvents.length > 0)
    .sort((left, right) => left.roomId.localeCompare(right.roomId));
}

function strongestTimeBucket(buckets: Record<TimeBucket, number>): TimeBucket {
  return TIME_BUCKETS.reduce((strongest, bucket) => {
    if (buckets[bucket] > buckets[strongest]) {
      return bucket;
    }
    return strongest;
  }, TIME_BUCKETS[0]);
}

function estimateHouseholdSize(activeRoomCount: number, totalEvents: number): string {
  if (activeRoomCount >= 5 && totalEvents >= 20) {
    return '2-5 residents';
  }
  if (activeRoomCount <= 1 && totalEvents <= 3) {
    return '1 resident';
  }
  return '1-3 residents';
}

function meaningfulEvidence(events: HomeMemory['recentEvents']): HomeMemory['recentEvents'] {
  return events.filter((event) => event.evidenceCategory === 'human_activity' || event.evidenceCategory === 'device_usage');
}

function meaningfulWeightOfRoom(room: RoomMemory): number {
  const weakContextWeight = room.profileEvidenceByCategory.environment_context * 0.05;
  return Math.max(0, Number((room.profileEvidenceWeight - weakContextWeight).toFixed(3)));
}

function weightOf(events: HomeMemory['recentEvents']): number {
  return Number(events.reduce((total, event) => total + event.profileWeight, 0).toFixed(3));
}

function confidenceFromCount(count: number, total: number, max: number, sampleSize = count): number {
  if (count <= 0 || total <= 0) {
    return 0.1;
  }
  return confidenceWithSampleSize(0.2 + Math.min(max - 0.2, count / total), sampleSize);
}

function confidenceWithSampleSize(value: number, sampleSize: number): number {
  return clamp(Math.min(value, sampleSizeConfidenceCap(sampleSize)));
}

function sampleSizeConfidenceCap(sampleSize: number): number {
  if (sampleSize <= 1) {
    return 0.45;
  }
  if (sampleSize <= 2) {
    return 0.55;
  }
  if (sampleSize <= 3) {
    return 0.65;
  }
  if (sampleSize <= 5) {
    return 0.8;
  }
  return 1;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0.01, Number(value.toFixed(3))));
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function toRoomSubjectIds(roomIds: string[]): string[] {
  return roomIds.map((roomId) => `room:${roomId}`);
}

function toDeviceSubjectIds(deviceIds: string[]): string[] {
  return deviceIds.map((deviceId) => `device:${deviceId}`);
}

function formatList(values: string[]): string {
  if (values.length === 0) {
    return 'no rooms';
  }
  return values.join(', ');
}

function formatWeight(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function plural(count: number): string {
  return count === 1 ? '' : 's';
}

function titleCase(value: string): string {
  return value.replace(/(^|_)([a-z])/g, (_, separator: string, letter: string) => {
    return `${separator === '_' ? ' ' : ''}${letter.toUpperCase()}`;
  });
}
