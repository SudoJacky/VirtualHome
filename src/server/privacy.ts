import type { DeviceStateChangedEvent, TwinEvent, TwinSnapshot } from '../shared/types';

export type PrivacyMode = 'admin' | 'public';

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
  }
  return projected;
}

export function projectEventsForPrivacy(events: TwinEvent[], privacy: PrivacyMode): TwinEvent[] {
  if (privacy === 'admin') {
    return structuredClone(events);
  }

  return events
    .filter((event) => event.type === 'DeviceTelemetry' || event.type === 'DeviceStateChanged' || event.type === 'ScenarioControl')
    .map((event) => {
      if (event.type !== 'DeviceStateChanged') {
        return structuredClone(event);
      }
      const projected: DeviceStateChangedEvent = structuredClone(event);
      delete projected.reason;
      return projected;
    });
}
