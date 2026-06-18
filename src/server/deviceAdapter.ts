import type { DeviceAccessRecord } from './deviceAccess';

export interface DeviceAdapterStateReport {
  deviceId: string;
  deviceType: string;
  protocol: DeviceAccessRecord['protocol'];
  reportedState: DeviceAccessRecord['reportedState'];
  connectivity: DeviceAccessRecord['connectivity'];
  lastSeenAt: string;
  dataQuality: DeviceAccessRecord['dataQuality'];
}

export interface DeviceAdapterCommand {
  commandId: string;
  deviceId: string;
  command: string;
  desiredState: DeviceAccessRecord['desiredState'];
  status: 'requested';
  requestedAt: string;
}

export function createAdapterStateReport(record: DeviceAccessRecord): DeviceAdapterStateReport {
  return {
    deviceId: record.deviceId,
    deviceType: record.deviceType,
    protocol: record.protocol,
    reportedState: { ...record.reportedState },
    connectivity: record.connectivity,
    lastSeenAt: record.lastSeenAt,
    dataQuality: { ...record.dataQuality }
  };
}

export function createAdapterCommand(record: DeviceAccessRecord, command: string, requestedAt: string): DeviceAdapterCommand {
  if (!record.supportedCommands.includes(command)) {
    throw new Error(`Unsupported command ${command} for ${record.deviceId}`);
  }
  return {
    commandId: `${record.deviceId}:${command}:${requestedAt}`,
    deviceId: record.deviceId,
    command,
    desiredState: record.desiredState ? { ...record.desiredState } : null,
    status: 'requested',
    requestedAt
  };
}
