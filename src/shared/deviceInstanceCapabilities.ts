import { getDeviceCapability, type DeviceCommandMetadata } from './deviceRegistry';

export interface DeviceCapabilityOverride {
  supportedCommands?: string[];
}

const deviceCapabilityOverrides: Record<string, DeviceCapabilityOverride> = {
  doorbell_camera_01: {
    supportedCommands: ['ring']
  }
};

export function getDeviceCapabilityOverride(deviceId: string): DeviceCapabilityOverride | undefined {
  return deviceCapabilityOverrides[deviceId];
}

export function getDeviceSupportedCommands(deviceId: string, deviceType: string): string[] {
  const capability = getDeviceCapability(deviceType);
  const overriddenCommands = getDeviceCapabilityOverride(deviceId)?.supportedCommands;
  if (!overriddenCommands) {
    return [...capability.supportedCommands];
  }
  return overriddenCommands.filter((command) => capability.supportedCommands.includes(command));
}

export function getDeviceCommandMetadataForInstance(deviceId: string, deviceType: string): Record<string, DeviceCommandMetadata> {
  const capability = getDeviceCapability(deviceType);
  const commands = getDeviceSupportedCommands(deviceId, deviceType);
  return Object.fromEntries(commands.map((command) => [command, capability.commandMetadata[command]]));
}
