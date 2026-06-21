import type { DeviceStateChangedEvent, DeviceTelemetryEvent, RoomId, TwinEvent } from '../shared/types';

export type AllowedObservationEvent = DeviceTelemetryEvent | DeviceStateChangedEvent;

export interface ObservationEvidence {
  acceptedEvents: AllowedObservationEvent[];
  rejectedEventTypes: string[];
  motionByRoom: Partial<Record<RoomId, number>>;
  activeDeviceRooms: Partial<Record<RoomId, number>>;
  droppedObservationEvents: number;
  observationQuality: number;
  fridgeDoorOpen: boolean;
  routerOffline: boolean;
  stovePowerW: number;
}

export function extractObservationEvidence(events: TwinEvent[]): ObservationEvidence {
  const acceptedEvents: AllowedObservationEvent[] = [];
  const rejectedEventTypes = new Set<string>();
  const motionByRoom: Partial<Record<RoomId, number>> = {};
  const activeDeviceRooms: Partial<Record<RoomId, number>> = {};
  let droppedObservationEvents = 0;
  let fridgeDoorOpen = false;
  let routerOffline = false;
  let stovePowerW = 0;

  for (const event of events) {
    if (event.type === 'DeviceTelemetry' && event.sourceLayer === 'sensor') {
      acceptedEvents.push(event);
      if (event.lineage.quality.dropped || event.measurements.sample_dropped === true) {
        droppedObservationEvents += 1;
        continue;
      }
      if (event.measurements.motion === true) {
        motionByRoom[event.roomId] = Math.max(motionByRoom[event.roomId] ?? 0, Number(event.measurements.confidence ?? 0.65));
      }
      continue;
    }
    if (event.type === 'DeviceStateChanged' && event.sourceLayer === 'world') {
      acceptedEvents.push(event);
      activeDeviceRooms[event.roomId] = Math.max(activeDeviceRooms[event.roomId] ?? 0, 0.55);
      if (event.deviceId === 'fridge_01' && event.state.doorOpen === true) {
        fridgeDoorOpen = true;
      }
      if (event.deviceId === 'router_01' && event.state.online === false) {
        routerOffline = true;
      }
      if (event.deviceId === 'stove_01') {
        stovePowerW = Math.max(stovePowerW, Number(event.state.powerW ?? 0));
      }
      continue;
    }
    rejectedEventTypes.add(event.type);
  }

  return {
    acceptedEvents,
    rejectedEventTypes: [...rejectedEventTypes].sort(),
    motionByRoom,
    activeDeviceRooms,
    droppedObservationEvents,
    observationQuality: acceptedEvents.length > 0
      ? Math.max(0.45, 1 - droppedObservationEvents / acceptedEvents.length * 0.55)
      : 1,
    fridgeDoorOpen,
    routerOffline,
    stovePowerW
  };
}

export function roomEvidenceScore(roomId: RoomId, evidence: ObservationEvidence): number {
  return ((evidence.motionByRoom[roomId] ?? 0) * 6 + (evidence.activeDeviceRooms[roomId] ?? 0) * 2) * evidence.observationQuality;
}
