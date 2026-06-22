import type { DeviceStateChangedEvent, DeviceTelemetryEvent, RoomId, TwinEvent } from '../shared/types';

export type AllowedObservationEvent = DeviceTelemetryEvent | DeviceStateChangedEvent;

export interface ObservationEvidence {
  acceptedEvents: AllowedObservationEvent[];
  rejectedEventTypes: string[];
  motionByRoom: Partial<Record<RoomId, number>>;
  activeDeviceRooms: Partial<Record<RoomId, number>>;
  co2ByRoom: Partial<Record<RoomId, number>>;
  pm25ByRoom: Partial<Record<RoomId, number>>;
  droppedObservationEvents: number;
  observationQuality: number;
  fridgeDoorOpen: boolean;
  routerOffline: boolean;
  stovePowerW: number;
  sleepSensorInBed: boolean;
  waterLeakDetected: boolean;
}

export function extractObservationEvidence(events: TwinEvent[]): ObservationEvidence {
  const acceptedEvents: AllowedObservationEvent[] = [];
  const rejectedEventTypes = new Set<string>();
  const motionByRoom: Partial<Record<RoomId, number>> = {};
  const activeDeviceRooms: Partial<Record<RoomId, number>> = {};
  const co2ByRoom: Partial<Record<RoomId, number>> = {};
  const pm25ByRoom: Partial<Record<RoomId, number>> = {};
  let droppedObservationEvents = 0;
  let fridgeDoorOpen = false;
  let routerOffline = false;
  let stovePowerW = 0;
  let sleepSensorInBed = false;
  let waterLeakDetected = false;

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
      if (typeof event.measurements.co2 === 'number') {
        co2ByRoom[event.roomId] = Math.max(co2ByRoom[event.roomId] ?? 0, Number(event.measurements.co2));
      }
      if (typeof event.measurements.pm25 === 'number') {
        pm25ByRoom[event.roomId] = Math.max(pm25ByRoom[event.roomId] ?? 0, Number(event.measurements.pm25));
      }
      if (event.measurements.online === false) {
        routerOffline = true;
      }
      if (typeof event.measurements.power_w === 'number') {
        stovePowerW = Math.max(stovePowerW, Number(event.measurements.power_w));
      }
      if (event.measurements.in_bed === true && event.deviceId === 'master_sleep_01') {
        sleepSensorInBed = true;
      }
      if (event.measurements.leak_detected === true) {
        waterLeakDetected = true;
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
    co2ByRoom,
    pm25ByRoom,
    droppedObservationEvents,
    observationQuality: acceptedEvents.length > 0
      ? Math.max(0.45, 1 - droppedObservationEvents / acceptedEvents.length * 0.55)
      : 1,
    fridgeDoorOpen,
    routerOffline,
    stovePowerW,
    sleepSensorInBed,
    waterLeakDetected
  };
}

export function roomEvidenceScore(roomId: RoomId, evidence: ObservationEvidence): number {
  return (
    (evidence.motionByRoom[roomId] ?? 0) * 6 +
    (evidence.activeDeviceRooms[roomId] ?? 0) * 2 +
    co2OccupancyScore(evidence.co2ByRoom[roomId]) +
    pm25ActivityScore(evidence.pm25ByRoom[roomId])
  ) * evidence.observationQuality;
}

function co2OccupancyScore(co2?: number): number {
  if (co2 === undefined) return 0;
  if (co2 >= 1100) return 3.2;
  if (co2 >= 900) return 2.2;
  if (co2 >= 750) return 1.2;
  return 0;
}

function pm25ActivityScore(pm25?: number): number {
  if (pm25 === undefined) return 0;
  if (pm25 >= 55) return 2.4;
  if (pm25 >= 35) return 1.4;
  return 0;
}
