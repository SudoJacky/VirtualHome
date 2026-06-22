export interface DeviceEventCursor {
  runId: string;
  sequence: number;
}

export type DeviceEventValue = string | number | boolean | null;
export type DeviceSourceEventType = 'DeviceTelemetry' | 'DeviceStateChanged';

export interface DeviceValueEvent {
  id: string;
  sourceEventId: string;
  sourceEventType: DeviceSourceEventType;
  runId: string;
  sequence: number;
  ts: string;
  simTime: string;
  homeId: string;
  roomId: string;
  deviceId: string;
  deviceType: string;
  field: string;
  value: DeviceEventValue;
}

export interface DeviceUpdateMessage {
  type: 'device.update';
  runId: string;
  sequence: number;
  replayComplete: boolean;
  events: DeviceValueEvent[];
}

export interface DeviceHeartbeatMessage {
  type: 'device.heartbeat';
  ts: string;
  runId: string;
  sequence: number;
}

export interface DeviceRunChangedMessage {
  type: 'device.run_changed';
  previousRunId: string;
  runId: string;
  sequence: number;
}

export type DeviceEventSocketMessage = DeviceUpdateMessage | DeviceHeartbeatMessage | DeviceRunChangedMessage;

export function buildDeviceEventSocketUrl(location: Pick<Location, 'protocol' | 'host'>, cursor?: DeviceEventCursor | null): string {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = new URL(`${protocol}://${location.host}/ws/device-events`);
  if (cursor) {
    url.searchParams.set('runId', cursor.runId);
    url.searchParams.set('afterSequence', String(cursor.sequence));
  }
  return url.toString();
}

export function parseDeviceEventSocketMessage(data: string): DeviceEventSocketMessage {
  return JSON.parse(data) as DeviceEventSocketMessage;
}

export function cursorFromDeviceEvent(event: DeviceValueEvent): DeviceEventCursor {
  return { runId: event.runId, sequence: event.sequence };
}

export function cursorFromDeviceRunChanged(update: DeviceRunChangedMessage): DeviceEventCursor {
  return { runId: update.runId, sequence: 0 };
}

export function cursorFromProcessedDeviceUpdate(update: DeviceUpdateMessage, previousCursor: DeviceEventCursor | null): DeviceEventCursor | null {
  if (update.replayComplete) {
    return { runId: update.runId, sequence: update.sequence };
  }

  const lastProcessedEvent = update.events.reduce<DeviceValueEvent | null>((latest, event) => {
    if (!latest || event.sequence > latest.sequence) {
      return event;
    }
    return latest;
  }, null);

  return lastProcessedEvent ? cursorFromDeviceEvent(lastProcessedEvent) : previousCursor;
}

export function nextDeviceEventReconnectDelayMs(attempt: number): number {
  return Math.min(30000, 1000 * (2 ** Math.max(0, attempt)));
}
