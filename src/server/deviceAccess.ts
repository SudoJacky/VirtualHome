import { getDeviceCapability } from '../shared/deviceRegistry';
import type { DeviceState, DeviceStateChangedEvent, DeviceTelemetryEvent, TwinEvent, TwinSnapshot } from '../shared/types';

type DeviceAccessConnectivity = 'online' | 'offline' | 'unknown';
type CommandStatus = 'acknowledged' | 'none';

export interface DeviceAccessRecord {
  deviceId: string;
  roomId: string;
  deviceType: string;
  displayName: string;
  protocol: 'simulated';
  desiredState: DeviceState['state'] | null;
  reportedState: DeviceState['state'];
  connectivity: DeviceAccessConnectivity;
  lastSeenAt: string;
  dataQuality: {
    source: 'simulator';
    confidence: number;
    freshness: 'live' | 'stale';
  };
  lastCommand: {
    commandId: string;
    status: CommandStatus;
    requestedAt: string;
    acknowledgedAt: string | null;
    reason: string | null;
  } | null;
}

export function createDeviceAccessRecords(snapshot: TwinSnapshot, events: TwinEvent[]): DeviceAccessRecord[] {
  const latestStateChange = new Map<string, DeviceStateChangedEvent>();
  const latestSeenAt = new Map<string, string>();

  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.type === 'DeviceStateChanged') {
      latestStateChange.set(event.deviceId, event);
      latestSeenAt.set(event.deviceId, event.simTime);
    } else if (event.type === 'DeviceTelemetry') {
      latestSeenAt.set(event.deviceId, event.simTime);
    }
  }

  return Object.values(snapshot.devices)
    .map((device) => {
      const capability = getDeviceCapability(device.type);
      const stateChange = latestStateChange.get(device.id);
      const lastSeenAt = latestSeenAt.get(device.id) ?? snapshot.simClock.currentTime;
      const supportedCommands = capability.supportedCommands;
      return {
        deviceId: device.id,
        roomId: device.roomId,
        deviceType: device.type,
        displayName: capability.displayName,
        protocol: 'simulated' as const,
        desiredState: stateChange ? stateChange.state : supportedCommands.length > 0 ? { ...device.state } : null,
        reportedState: { ...device.state },
        connectivity: connectivityForDevice(device),
        lastSeenAt,
        dataQuality: {
          source: 'simulator' as const,
          confidence: 1,
          freshness: freshnessFor(lastSeenAt, snapshot.simClock.currentTime)
        },
        lastCommand: stateChange ? {
          commandId: stateChange.id,
          status: 'acknowledged' as const,
          requestedAt: stateChange.simTime,
          acknowledgedAt: stateChange.simTime,
          reason: stateChange.reason ?? null
        } : null
      };
    })
    .sort((left, right) => left.deviceId.localeCompare(right.deviceId));
}

function connectivityForDevice(device: DeviceState): DeviceAccessConnectivity {
  if (typeof device.state.online === 'boolean') {
    return device.state.online ? 'online' : 'offline';
  }
  return 'online';
}

function freshnessFor(lastSeenAt: string, currentTime: string): 'live' | 'stale' {
  const ageMs = new Date(currentTime).getTime() - new Date(lastSeenAt).getTime();
  return ageMs > 15 * 60 * 1000 ? 'stale' : 'live';
}
