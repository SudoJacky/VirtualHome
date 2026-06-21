import { createDeviceCommandTimeline, type DeviceCommandTimelineEntry } from '../shared/deviceCommandLifecycle';
import { evaluateDeviceHealthSignals, getDeviceCapability, getDeviceCapabilityMetadata, type DeviceCommandMetadata, type DeviceHealthStatus, type DeviceRiskLevel, type DeviceStateFieldMetadata, type DeviceVisualModel } from '../shared/deviceRegistry';
import { getDeviceCommandMetadataForInstance, getDeviceSupportedCommands } from '../shared/deviceInstanceCapabilities';
import type { DeviceState, DeviceStateChangedEvent, DeviceTelemetryEvent, TwinEvent, TwinSnapshot } from '../shared/types';
import { getDeviceInstanceProfile, type DeviceInstanceGroup, type DeviceMount, type DevicePrivacyLevel } from '../web/deviceInstanceLayout';

type DeviceAccessConnectivity = 'online' | 'offline' | 'unknown';
type CommandStatus = 'requested' | 'sent' | 'acknowledged' | 'failed' | 'timed-out' | 'none';

export interface DeviceAccessRecord {
  deviceId: string;
  roomId: string;
  deviceType: string;
  displayName: string;
  shortLabel: string;
  instanceGroup: DeviceInstanceGroup;
  privacyLevel: DevicePrivacyLevel;
  riskLevel: DeviceRiskLevel;
  visualModel: DeviceVisualModel;
  visualScale: number;
  pose: {
    x: number;
    y: number;
    z: number;
    rotation: number;
    mount: DeviceMount;
    visualVariant: string | null;
  };
  protocol: 'simulated';
  desiredState: DeviceState['state'] | null;
  reportedState: DeviceState['state'];
  stateFields: Record<string, DeviceStateFieldMetadata>;
  supportedCommands: string[];
  commandMetadata: Record<string, DeviceCommandMetadata>;
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
    timeline: DeviceCommandTimelineEntry[];
  } | null;
  healthStatus: DeviceHealthStatus[];
}

export function createDeviceAccessRecords(snapshot: TwinSnapshot, events: TwinEvent[]): DeviceAccessRecord[] {
  const latestStateChange = new Map<string, DeviceStateChangedEvent>();
  const latestSeenAt = new Map<string, string>();
  const capabilityMetadata = getDeviceCapabilityMetadata();

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
      const metadata = capabilityMetadata[device.type];
      const stateChange = latestStateChange.get(device.id);
      const lastSeenAt = latestSeenAt.get(device.id) ?? snapshot.simClock.currentTime;
      const supportedCommands = getDeviceSupportedCommands(device.id, device.type);
      const commandStatus = stateChange ? commandStatusForStateChange(stateChange) : 'none';
      const instanceProfile = getDeviceInstanceProfile(device.id);
      return {
        deviceId: device.id,
        roomId: device.roomId,
        deviceType: device.type,
        displayName: instanceProfile?.displayName ?? capability.displayName,
        shortLabel: instanceProfile?.shortLabel ?? capability.shortLabel,
        instanceGroup: instanceProfile?.group ?? 'living_comfort',
        privacyLevel: instanceProfile?.privacyLevel ?? 'household',
        riskLevel: instanceProfile?.riskOverride ?? capability.riskLevel,
        visualModel: capability.visualModel,
        visualScale: instanceProfile?.scale ?? capability.visualScale,
        pose: {
          x: instanceProfile?.x ?? 0,
          y: instanceProfile?.y ?? defaultDeviceY(instanceProfile?.mount),
          z: instanceProfile?.z ?? 0,
          rotation: instanceProfile?.rotation ?? 0,
          mount: instanceProfile?.mount ?? 'floor',
          visualVariant: instanceProfile?.visualVariant ?? null
        },
        protocol: 'simulated' as const,
        desiredState: stateChange?.reason?.startsWith('abnormality:')
          ? { ...capability.defaultState }
          : stateChange ? stateChange.state : supportedCommands.length > 0 ? { ...device.state } : null,
        reportedState: { ...device.state },
        stateFields: structuredClone(metadata?.stateFields ?? {}),
        supportedCommands: [...supportedCommands],
        commandMetadata: structuredClone(getDeviceCommandMetadataForInstance(device.id, device.type)),
        connectivity: connectivityForDevice(device),
        lastSeenAt,
        dataQuality: {
          source: 'simulator' as const,
          confidence: 1,
          freshness: freshnessFor(lastSeenAt, snapshot.simClock.currentTime)
        },
        lastCommand: stateChange ? {
          commandId: stateChange.id,
          status: commandStatus,
          requestedAt: stateChange.simTime,
          acknowledgedAt: commandStatus === 'acknowledged' ? stateChange.simTime : null,
          reason: stateChange.reason ?? null,
          timeline: createDeviceCommandTimeline({
            terminalStatus: commandStatus === 'failed' ? 'failed' : 'acknowledged',
            at: stateChange.simTime,
            reason: stateChange.reason ?? null
          })
        } : null,
        healthStatus: evaluateDeviceHealthSignals(capability.healthSignals, device.state, lastSeenAt, snapshot.simClock.currentTime)
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

function commandStatusForStateChange(event: DeviceStateChangedEvent): CommandStatus {
  if (event.reason?.startsWith('abnormality:')) {
    return 'failed';
  }
  return 'acknowledged';
}

function freshnessFor(lastSeenAt: string, currentTime: string): 'live' | 'stale' {
  const ageMs = new Date(currentTime).getTime() - new Date(lastSeenAt).getTime();
  return ageMs > 15 * 60 * 1000 ? 'stale' : 'live';
}

function defaultDeviceY(mount: DeviceMount | undefined): number {
  if (mount === 'ceiling') return 0.62;
  if (mount === 'wall') return 0.48;
  if (mount === 'counter') return 0.24;
  if (mount === 'pipe') return 0.18;
  if (mount === 'embedded') return 0.2;
  return 0.12;
}
