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
  roomId: string;
  deviceId: string;
  deviceType: string;
  field: string;
  value: string | number | boolean | null;
}

export interface DeviceReplayPage {
  sequence: number;
  replayComplete: boolean;
  events: DeviceValueEvent[];
}

export interface DeviceReplayPageOptions {
  runId: string;
  afterSequence: number;
  currentSequence: number;
  replayLimit: number;
  getEventsAfter: (runId: string, sequence: number, limit: number) => TwinEvent[];
}

export function buildDeviceReplayPage(options: DeviceReplayPageOptions): DeviceReplayPage {
  const replayLimit = Math.max(1, options.replayLimit);
  const scannedEvents: TwinEvent[] = [];
  let sequence = options.afterSequence;
  let hasMoreRawEvents = false;

  while (scannedEvents.length < replayLimit) {
    const chunkLimit = Math.min(100, replayLimit - scannedEvents.length);
    const rawChunk = options.getEventsAfter(options.runId, sequence, chunkLimit + 1);
    const scannedChunk = rawChunk.slice(0, chunkLimit);

    if (scannedChunk.length === 0) {
      return {
        sequence: options.currentSequence,
        replayComplete: true,
        events: projectDeviceValueEvents(scannedEvents)
      };
    }

    scannedEvents.push(...scannedChunk);
    sequence = scannedChunk[scannedChunk.length - 1].sequence;
    hasMoreRawEvents = rawChunk.length > chunkLimit;

    if (!hasMoreRawEvents) {
      return {
        sequence: options.currentSequence,
        replayComplete: true,
        events: projectDeviceValueEvents(scannedEvents)
      };
    }
  }

  return {
    sequence,
    replayComplete: false,
    events: projectDeviceValueEvents(scannedEvents)
  };
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
    roomId: event.roomId,
    deviceId: event.deviceId,
    deviceType: event.deviceType,
    field,
    value
  };
}
