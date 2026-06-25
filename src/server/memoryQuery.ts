import type { TwinEvent } from '../shared/types';
import { createHomeMemory, reduceDeviceEvents, type ActivityEpisode, type HomeMemory, type MemoryEpisode, type MemoryEvidence } from '../web/homeMemoryModel';
import { createHomeProfileHypotheses, type ProfileHypothesis, type ProfileHypothesisType } from '../web/homeProfiler';
import { projectDeviceValueEvents } from './deviceEventStream';

export type MemoryEntityKind = 'room' | 'device' | 'field';

export interface MemorySummary {
  homeId: string | null;
  runId: string | null;
  totalEvents: number;
  profileEventCount: number;
  profileEvidenceWeight: number;
  activeRooms: string[];
  activeDevices: string[];
  activeEpisodes: Array<Pick<MemoryEpisode, 'id' | 'kind' | 'roomId' | 'deviceId' | 'field' | 'status' | 'updatedSimTime'>>;
  activityEpisodes: Array<Pick<ActivityEpisode, 'id' | 'kind' | 'roomIds' | 'deviceIds' | 'updatedSimTime' | 'evidenceIds' | 'summary'>>;
  topPatterns: Array<Pick<ProfileHypothesis, 'id' | 'type' | 'label' | 'summary' | 'confidence' | 'updatedAt' | 'subjectIds'> & { evidenceCount: number }>;
  recentHighlights: MemoryEvidence[];
  updatedAt: string | null;
}

export interface MemoryEntityQuery {
  kind: MemoryEntityKind;
  roomId?: string;
  deviceId?: string;
  field?: string;
  meaningfulOnly?: boolean;
}

export interface MemoryEpisodeQuery {
  kind?: MemoryEpisode['kind'];
  status?: MemoryEpisode['status'];
  roomId?: string;
  deviceId?: string;
  field?: string;
  limit?: number;
}

export interface MemoryEvidenceQuery {
  category?: MemoryEvidence['evidenceCategory'];
  strength?: MemoryEvidence['evidenceStrength'];
  roomId?: string;
  deviceId?: string;
  field?: string;
  meaningfulOnly?: boolean;
  limit?: number;
}

export interface MemoryHypothesisQuery {
  type?: ProfileHypothesisType;
  includeEvidence?: boolean;
}

export function buildHomeMemoryFromEvents(events: TwinEvent[]): HomeMemory {
  return reduceDeviceEvents(createHomeMemory(), projectDeviceValueEvents(events));
}

export function createMemorySummary(memory: HomeMemory): MemorySummary {
  const hypotheses = createHomeProfileHypotheses(memory);
  return {
    homeId: memory.homeId,
    runId: memory.runId,
    totalEvents: memory.totalEvents,
    profileEventCount: memory.profileEventCount,
    profileEvidenceWeight: memory.profileEvidenceWeight,
    activeRooms: Object.values(memory.rooms)
      .sort((left, right) => right.eventCount - left.eventCount || left.roomId.localeCompare(right.roomId))
      .map((room) => room.roomId),
    activeDevices: Object.values(memory.devices)
      .sort((left, right) => right.eventCount - left.eventCount || left.deviceId.localeCompare(right.deviceId))
      .map((device) => device.deviceId),
    activeEpisodes: Object.values(memory.episodes)
      .filter((episode) => episode.status === 'open')
      .sort(compareByUpdatedSimTimeDesc)
      .map((episode) => ({
        id: episode.id,
        kind: episode.kind,
        roomId: episode.roomId,
        deviceId: episode.deviceId,
        field: episode.field,
        status: episode.status,
        updatedSimTime: episode.updatedSimTime
      })),
    activityEpisodes: memory.activityEpisodes
      .slice(0, 10)
      .map((episode) => ({
        id: episode.id,
        kind: episode.kind,
        roomIds: episode.roomIds,
        deviceIds: episode.deviceIds,
        updatedSimTime: episode.updatedSimTime,
        evidenceIds: episode.evidenceIds,
        summary: episode.summary
      })),
    topPatterns: hypotheses
      .sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id))
      .slice(0, 5)
      .map(toHypothesisSummary),
    recentHighlights: memory.recentEvents
      .filter((event) => event.profileWeight > 0)
      .slice(0, 10),
    updatedAt: memory.recentEvents[0]?.simTime ?? null
  };
}

export function queryMemoryEntities(memory: HomeMemory, query: MemoryEntityQuery): { kind: MemoryEntityKind; items: unknown[] } {
  if (query.kind === 'room') {
    return {
      kind: query.kind,
      items: Object.values(memory.rooms)
        .filter((room) => matchesRoomQuery(room.roomId, query))
        .filter((room) => !query.meaningfulOnly || room.profileEventCount > 0)
        .sort((left, right) => right.eventCount - left.eventCount || left.roomId.localeCompare(right.roomId))
    };
  }
  if (query.kind === 'device') {
    return {
      kind: query.kind,
      items: Object.values(memory.devices)
        .filter((device) => matchesRoomQuery(device.roomId, query))
        .filter((device) => !query.deviceId || device.deviceId === query.deviceId)
        .filter((device) => !query.meaningfulOnly || device.profileEventCount > 0)
        .sort((left, right) => right.eventCount - left.eventCount || left.deviceId.localeCompare(right.deviceId))
    };
  }
  return {
    kind: query.kind,
    items: Object.values(memory.fields)
      .filter((field) => matchesRoomQuery(field.roomId, query))
      .filter((field) => !query.deviceId || field.deviceId === query.deviceId)
      .filter((field) => !query.field || field.field === query.field || field.id === query.field)
      .filter((field) => !query.meaningfulOnly || field.profileEventCount > 0)
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt) || left.id.localeCompare(right.id))
  };
}

export function queryMemoryEpisodes(memory: HomeMemory, query: MemoryEpisodeQuery): MemoryEpisode[] {
  return Object.values(memory.episodes)
    .filter((episode) => !query.kind || episode.kind === query.kind)
    .filter((episode) => !query.status || episode.status === query.status)
    .filter((episode) => !query.roomId || episode.roomId === query.roomId)
    .filter((episode) => !query.deviceId || episode.deviceId === query.deviceId)
    .filter((episode) => !query.field || episode.field === query.field || episode.fieldId === query.field)
    .sort(compareByUpdatedSimTimeDesc)
    .slice(0, query.limit ?? 50);
}

export function queryMemoryEvidence(memory: HomeMemory, query: MemoryEvidenceQuery): MemoryEvidence[] {
  return memory.recentEvents
    .filter((event) => !query.category || event.evidenceCategory === query.category)
    .filter((event) => !query.strength || event.evidenceStrength === query.strength)
    .filter((event) => !query.roomId || event.roomId === query.roomId)
    .filter((event) => !query.deviceId || event.deviceId === query.deviceId)
    .filter((event) => !query.field || event.field === query.field || `${event.deviceId}:${event.field}` === query.field)
    .filter((event) => !query.meaningfulOnly || event.profileWeight > 0)
    .sort((left, right) => right.sequence - left.sequence || right.id.localeCompare(left.id))
    .slice(0, query.limit ?? 50);
}

export function queryMemoryHypotheses(memory: HomeMemory, query: MemoryHypothesisQuery): unknown[] {
  return createHomeProfileHypotheses(memory)
    .filter((hypothesis) => !query.type || hypothesis.type === query.type)
    .sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id))
    .map((hypothesis) => ({
      ...toHypothesisSummary(hypothesis),
      ...(query.includeEvidence ? { evidence: hypothesis.evidence.slice(0, 10) } : {})
    }));
}

function matchesRoomQuery(roomId: string, query: Pick<MemoryEntityQuery, 'roomId'>): boolean {
  return !query.roomId || roomId === query.roomId;
}

function toHypothesisSummary(hypothesis: ProfileHypothesis): Pick<ProfileHypothesis, 'id' | 'type' | 'label' | 'summary' | 'confidence' | 'updatedAt' | 'subjectIds'> & { evidenceCount: number } {
  return {
    id: hypothesis.id,
    type: hypothesis.type,
    label: hypothesis.label,
    summary: hypothesis.summary,
    confidence: hypothesis.confidence,
    updatedAt: hypothesis.updatedAt,
    subjectIds: hypothesis.subjectIds,
    evidenceCount: hypothesis.evidence.length
  };
}

function compareByUpdatedSimTimeDesc(left: MemoryEpisode, right: MemoryEpisode): number {
  return right.updatedSimTime.localeCompare(left.updatedSimTime) || left.id.localeCompare(right.id);
}
