import type { DeviceStateChangedEvent, DeviceTelemetryEvent, TwinEvent } from '../shared/types';

export interface DeviceValueEvent {
  id: string;
  sourceEventId: string;
  sourceEventType: 'DeviceTelemetry' | 'DeviceStateChanged';
  runId: string;
  sequence: number;
  ts: string;
  simTime: string;
  homeId: string;
  scenarioId: string;
  roomId: string;
  deviceId: string;
  deviceType: string;
  field: string;
  value: string | number | boolean | null;
}

export function projectDeviceValueEvents(events: TwinEvent[]): DeviceValueEvent[] {
  return events.flatMap((event) => {
    if (event.type === 'DeviceTelemetry') {
      return flattenDeviceTelemetry(event);
    }
    if (event.type === 'DeviceStateChanged') {
      return flattenDeviceStateChange(event);
    }
    return [];
  });
}

function flattenDeviceTelemetry(event: DeviceTelemetryEvent): DeviceValueEvent[] {
  return Object.entries(event.measurements)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([field, value]) => deviceValueEvent(event, 'DeviceTelemetry', field, value));
}

function flattenDeviceStateChange(event: DeviceStateChangedEvent): DeviceValueEvent[] {
  return Object.entries(event.state)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([field, value]) => deviceValueEvent(event, 'DeviceStateChanged', field, value));
}

function deviceValueEvent(
  event: DeviceTelemetryEvent | DeviceStateChangedEvent,
  sourceEventType: DeviceValueEvent['sourceEventType'],
  field: string,
  value: DeviceValueEvent['value']
): DeviceValueEvent {
  return {
    id: `${event.id}:${field}`,
    sourceEventId: event.id,
    sourceEventType,
    runId: event.runId,
    sequence: event.sequence,
    ts: event.ts,
    simTime: event.simTime,
    homeId: event.homeId,
    scenarioId: event.scenarioId,
    roomId: event.roomId,
    deviceId: event.deviceId,
    deviceType: event.deviceType,
    field,
    value
  };
}
