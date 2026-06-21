import type { DeviceTelemetryEvent, DeviceStateChangedEvent, TwinEvent, TwinSnapshot } from '../shared/types';
import type { DeviceAccessRecord } from './deviceAccess';

export type PrivacyMode = 'admin' | 'public';

const sensitiveDeviceTypes = new Set([
  'door_lock',
  'doorbell_camera',
  'security_camera',
  'sleep_sensor',
  'water_flow_sensor',
  'water_leak_sensor',
  'water_valve'
]);

export function projectSnapshotForPrivacy(snapshot: TwinSnapshot, privacy: PrivacyMode): TwinSnapshot {
  if (privacy === 'admin') {
    return structuredClone(snapshot);
  }

  const projected = structuredClone(snapshot);
  const hasHumanOccupancy = projected.homeState.occupancyCount > 0;
  projected.homeState.occupancyCount = hasHumanOccupancy ? 1 : 0;
  projected.people = {};
  projected.activities = {};
  projected.alerts = {};
  for (const room of Object.values(projected.rooms)) {
    room.occupancy = false;
    room.humanOccupancy = false;
    room.motionDetected = false;
    room.people = [];
  }
  for (const device of Object.values(projected.devices)) {
    device.lastReason = 'redacted';
    if (isSensitiveDevice(device.type)) {
      device.state = {};
    }
  }
  return projected;
}

export function projectEventsForPrivacy(events: TwinEvent[], privacy: PrivacyMode): TwinEvent[] {
  if (privacy === 'admin') {
    return structuredClone(events);
  }

  return events
    .filter((event) => event.type === 'DeviceTelemetry' || event.type === 'DeviceStateChanged' || event.type === 'ScenarioControl')
    .filter((event) => !isSensitiveDeviceEvent(event))
    .map((event) => {
      if (event.type !== 'DeviceStateChanged') {
        return structuredClone(event);
      }
      const projected: DeviceStateChangedEvent = structuredClone(event);
      delete projected.reason;
      return projected;
    });
}

export function projectTelemetryForPrivacy(events: DeviceTelemetryEvent[], privacy: PrivacyMode): DeviceTelemetryEvent[] {
  if (privacy === 'admin') {
    return structuredClone(events);
  }
  return events
    .filter((event) => !isSensitiveDevice(event.deviceType))
    .map((event) => structuredClone(event));
}

export function projectDeviceAccessRecordsForPrivacy(records: DeviceAccessRecord[], privacy: PrivacyMode): DeviceAccessRecord[] {
  if (privacy === 'admin') {
    return structuredClone(records);
  }
  return records
    .filter((record) => record.privacyLevel !== 'private')
    .filter((record) => record.riskLevel !== 'privacy_sensitive' && record.riskLevel !== 'high')
    .map((record) => structuredClone(record));
}

function isSensitiveDeviceEvent(event: TwinEvent): boolean {
  return (event.type === 'DeviceTelemetry' || event.type === 'DeviceStateChanged') && isSensitiveDevice(event.deviceType);
}

function isSensitiveDevice(deviceType: string): boolean {
  return sensitiveDeviceTypes.has(deviceType);
}
