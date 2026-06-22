import type { DeviceStateChangedEvent, DeviceTelemetryEvent, RoomId, TwinEvent } from '../shared/types';

export type AllowedObservationEvent = DeviceTelemetryEvent | DeviceStateChangedEvent;

const sensitiveWorldStateDeviceTypes = new Set([
  'door_lock',
  'doorbell_camera',
  'security_camera',
  'sleep_sensor',
  'water_flow_sensor',
  'water_leak_sensor',
  'water_valve'
]);

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
  routerOfflineConfidence: number;
  stovePowerW: number;
  stovePowerConfidence: number;
  sleepSensorInBed: boolean;
  sleepSensorConfidence: number;
  waterLeakDetected: boolean;
  waterLeakConfidence: number;
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
  let routerOfflineConfidence = 0;
  let stovePowerW = 0;
  let stovePowerConfidence = 0;
  let sleepSensorInBed = false;
  let sleepSensorConfidence = 0;
  let waterLeakDetected = false;
  let waterLeakConfidence = 0;

  for (const event of events) {
    if (event.type === 'DeviceTelemetry' && event.sourceLayer === 'sensor') {
      acceptedEvents.push(event);
      if (event.lineage.quality.dropped || event.measurements.sample_dropped === true) {
        droppedObservationEvents += 1;
        continue;
      }
      if (event.measurements.motion === true) {
        motionByRoom[event.roomId] = Math.max(
          motionByRoom[event.roomId] ?? 0,
          measurementConfidence(event, 0.65) * observationQualityWeight(event)
        );
      }
      if (typeof event.measurements.co2 === 'number') {
        co2ByRoom[event.roomId] = Math.max(co2ByRoom[event.roomId] ?? 0, Number(event.measurements.co2));
      }
      if (typeof event.measurements.pm25 === 'number') {
        pm25ByRoom[event.roomId] = Math.max(pm25ByRoom[event.roomId] ?? 0, Number(event.measurements.pm25));
      }
      if (event.measurements.online === false) {
        routerOffline = true;
        routerOfflineConfidence = Math.max(
          routerOfflineConfidence,
          measurementConfidence(event, 0.8) * observationQualityWeight(event)
        );
      }
      if (typeof event.measurements.power_w === 'number') {
        stovePowerW = Math.max(stovePowerW, Number(event.measurements.power_w));
        stovePowerConfidence = Math.max(
          stovePowerConfidence,
          measurementConfidence(event, 0.8) * observationQualityWeight(event)
        );
      }
      if (event.measurements.in_bed === true && event.deviceId === 'master_sleep_01') {
        sleepSensorInBed = true;
        sleepSensorConfidence = Math.max(
          sleepSensorConfidence,
          measurementConfidence(event, 0.8) * observationQualityWeight(event)
        );
      }
      if (event.measurements.leak_detected === true) {
        waterLeakDetected = true;
        waterLeakConfidence = Math.max(
          waterLeakConfidence,
          measurementConfidence(event, 0.8) * observationQualityWeight(event)
        );
      }
      continue;
    }
    if (event.type === 'DeviceStateChanged' && event.sourceLayer === 'world' && !sensitiveWorldStateDeviceTypes.has(event.deviceType)) {
      acceptedEvents.push(event);
      activeDeviceRooms[event.roomId] = Math.max(activeDeviceRooms[event.roomId] ?? 0, 0.55);
      if (event.deviceId === 'fridge_01' && event.state.doorOpen === true) {
        fridgeDoorOpen = true;
      }
      if (event.deviceId === 'router_01' && event.state.online === false) {
        routerOffline = true;
        routerOfflineConfidence = Math.max(routerOfflineConfidence, 1);
      }
      if (event.deviceId === 'stove_01') {
        stovePowerW = Math.max(stovePowerW, Number(event.state.powerW ?? 0));
        stovePowerConfidence = Math.max(stovePowerConfidence, 1);
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
    routerOfflineConfidence,
    stovePowerW,
    stovePowerConfidence,
    sleepSensorInBed,
    sleepSensorConfidence,
    waterLeakDetected,
    waterLeakConfidence
  };
}

export function roomEvidenceScore(roomId: RoomId, evidence: ObservationEvidence): number {
  return (
    (evidence.motionByRoom[roomId] ?? 0) * 6 +
    (evidence.activeDeviceRooms[roomId] ?? 0) * 2 +
    (roomId === 'master_bedroom' && evidence.sleepSensorInBed ? 4.4 : 0) +
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

function measurementConfidence(event: DeviceTelemetryEvent, fallback: number): number {
  const confidence = typeof event.measurements.confidence === 'number' ? event.measurements.confidence : fallback;
  return clamp01(Number(confidence));
}

function observationQualityWeight(event: DeviceTelemetryEvent): number {
  const quality = event.lineage.quality;
  let weight = typeof quality.confidence === 'number' ? clamp01(quality.confidence) : 1;
  if (quality.noisy) weight *= 0.7;
  if (quality.duplicated) weight *= 0.8;
  if (quality.outOfOrder) weight *= 0.65;
  if (typeof quality.delayedMs === 'number' && quality.delayedMs > 60_000) {
    weight *= Math.max(0.45, 1 - (quality.delayedMs - 60_000) / (15 * 60_000) * 0.55);
  }
  return Math.max(0.15, Math.min(1, weight));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
