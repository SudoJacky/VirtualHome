import { getCatalog } from '../sim/catalog';
import { getDeviceCapability, type DeviceRiskLevel } from '../shared/deviceRegistry';
import type { DeviceCapabilityOverride } from '../shared/deviceInstanceCapabilities';
import type { DeviceDefinition } from '../shared/types';
import type { RoomId } from '../shared/types';

export type DeviceMount = 'ceiling' | 'counter' | 'embedded' | 'floor' | 'outdoor' | 'pipe' | 'wall';
export type DeviceInstanceGroup =
  | 'bathroom_water'
  | 'bedroom_comfort'
  | 'dining_lighting'
  | 'entrance_security'
  | 'garden_irrigation'
  | 'kitchen_appliance'
  | 'living_comfort'
  | 'network_infrastructure';
export type DevicePrivacyLevel = 'household' | 'private' | 'public';

export interface DevicePoint {
  deviceId: string;
  roomId: RoomId;
  x: number;
  z: number;
  y?: number;
  rotation?: number;
  mount?: DeviceMount;
  scale?: number;
  visualVariant?: string;
}

export interface DeviceInstanceProfile extends DevicePoint {
  displayName: string;
  shortLabel: string;
  group: DeviceInstanceGroup;
  privacyLevel: DevicePrivacyLevel;
  riskOverride?: DeviceRiskLevel;
  capabilityOverrides?: DeviceCapabilityOverride;
}

export const devicePoints: DevicePoint[] = [
  { deviceId: 'door_lock_01', roomId: 'entrance', x: -6, z: -3.1, y: 0.32, mount: 'wall', rotation: Math.PI / 2 },
  { deviceId: 'entrance_motion_01', roomId: 'entrance', x: -5, z: -3.85, y: 0.45, mount: 'ceiling', scale: 0.85 },
  { deviceId: 'doorbell_camera_01', roomId: 'entrance', x: -5.95, z: -2.45, y: 0.5, mount: 'wall', rotation: Math.PI / 2, visualVariant: 'doorbell_slim' },
  { deviceId: 'package_sensor_01', roomId: 'entrance', x: -4.75, z: -2.6, y: 0.12, mount: 'floor' },
  { deviceId: 'living_light_01', roomId: 'living_room', x: -2, z: -3.25, y: 0.62, mount: 'ceiling' },
  { deviceId: 'tv_01', roomId: 'living_room', x: 0.25, z: -3.9, y: 0.38, mount: 'wall', rotation: Math.PI, scale: 1.2 },
  { deviceId: 'living_motion_01', roomId: 'living_room', x: -3.65, z: -2.5, y: 0.45, mount: 'ceiling', scale: 0.85 },
  { deviceId: 'robot_vacuum_01', roomId: 'living_room', x: -0.25, z: -2.55, y: 0.11, mount: 'floor' },
  { deviceId: 'living_curtain_01', roomId: 'living_room', x: 0.35, z: -3.2, y: 0.55, mount: 'wall', rotation: Math.PI },
  { deviceId: 'kitchen_light_01', roomId: 'kitchen', x: 3, z: -3.3, y: 0.62, mount: 'ceiling' },
  { deviceId: 'kitchen_temp_01', roomId: 'kitchen', x: 1.65, z: -3.95, y: 0.45, mount: 'wall', rotation: Math.PI },
  { deviceId: 'fridge_01', roomId: 'kitchen', x: 4.05, z: -2.65, y: 0.32, mount: 'floor', scale: 1.35 },
  { deviceId: 'stove_01', roomId: 'kitchen', x: 2.3, z: -3.8, y: 0.18, mount: 'counter' },
  { deviceId: 'range_hood_01', roomId: 'kitchen', x: 2.3, z: -3.95, y: 0.65, mount: 'wall', rotation: Math.PI },
  { deviceId: 'pm25_01', roomId: 'kitchen', x: 3.8, z: -3.9, y: 0.45, mount: 'wall', rotation: Math.PI },
  { deviceId: 'smoke_01', roomId: 'kitchen', x: 3.15, z: -2.35, y: 0.6, mount: 'ceiling', scale: 0.85 },
  { deviceId: 'dishwasher_01', roomId: 'kitchen', x: 3.65, z: -3.8, y: 0.2, mount: 'embedded' },
  { deviceId: 'dining_light_01', roomId: 'dining_room', x: -4.4, z: -0.95, y: 0.62, mount: 'ceiling' },
  { deviceId: 'master_sleep_01', roomId: 'master_bedroom', x: -1.05, z: -0.45, y: 0.2, mount: 'embedded' },
  { deviceId: 'master_ac_01', roomId: 'master_bedroom', x: 0.9, z: -0.45, y: 0.56, mount: 'wall', rotation: -Math.PI / 2 },
  { deviceId: 'child_sleep_01', roomId: 'child_bedroom', x: 2.55, z: -0.55, y: 0.2, mount: 'embedded' },
  { deviceId: 'study_co2_01', roomId: 'study', x: 5.1, z: -1.25, y: 0.45, mount: 'wall', rotation: -Math.PI / 2 },
  { deviceId: 'router_01', roomId: 'study', x: 4.25, z: -1.25, y: 0.28, mount: 'counter', scale: 0.95 },
  { deviceId: 'bathroom_water_01', roomId: 'bathroom', x: -5.8, z: 2.2, y: 0.18, mount: 'pipe' },
  { deviceId: 'water_leak_01', roomId: 'bathroom', x: -5.25, z: 2.25, y: 0.1, mount: 'floor' },
  { deviceId: 'water_valve_01', roomId: 'bathroom', x: -4.65, z: 2.25, y: 0.24, mount: 'pipe' },
  { deviceId: 'washer_01', roomId: 'bathroom', x: -4.75, z: 1.1, y: 0.25, mount: 'floor', scale: 1.2 },
  { deviceId: 'garden_soil_01', roomId: 'garden', x: 2.1, z: 3.25, y: 0.14, mount: 'outdoor', scale: 0.85 },
  { deviceId: 'garden_camera_01', roomId: 'garden', x: -3.6, z: 1.1, y: 0.5, mount: 'wall', rotation: Math.PI / 2, visualVariant: 'outdoor_bullet' },
  { deviceId: 'sprinkler_01', roomId: 'garden', x: 1.5, z: 2.6, y: 0.1, mount: 'outdoor' }
];

const devicePointsById = new Map(devicePoints.map((point) => [point.deviceId, point]));

export const deviceInstanceProfiles: DeviceInstanceProfile[] = getCatalog().devices.map((device) => {
  const point = devicePointsById.get(device.id);
  const capability = getDeviceCapability(device.type);
  return {
    deviceId: device.id,
    roomId: point?.roomId ?? device.roomId,
    x: point?.x ?? 0,
    z: point?.z ?? 0,
    y: point?.y,
    rotation: point?.rotation,
    mount: point?.mount,
    scale: point?.scale,
    visualVariant: point?.visualVariant,
    displayName: device.name,
    shortLabel: capability.shortLabel,
    group: groupForDeviceInstance(device),
    privacyLevel: privacyLevelForDeviceInstance(device),
    riskOverride: riskOverrideForDeviceInstance(device)
  };
});

const deviceInstanceProfilesById = new Map(deviceInstanceProfiles.map((profile) => [profile.deviceId, profile]));

export function getDevicePoint(deviceId: string): DevicePoint | undefined {
  return devicePointsById.get(deviceId);
}

export function getDeviceInstanceProfile(deviceId: string): DeviceInstanceProfile | undefined {
  return deviceInstanceProfilesById.get(deviceId);
}

function groupForDeviceInstance(device: DeviceDefinition): DeviceInstanceGroup {
  if (device.type === 'router') return 'network_infrastructure';
  if (device.roomId === 'entrance') return 'entrance_security';
  if (device.roomId === 'bathroom') return 'bathroom_water';
  if (device.roomId === 'garden') return 'garden_irrigation';
  if (device.roomId === 'kitchen') return 'kitchen_appliance';
  if (device.roomId === 'master_bedroom' || device.roomId === 'child_bedroom') return 'bedroom_comfort';
  if (device.roomId === 'dining_room') return 'dining_lighting';
  return 'living_comfort';
}

function privacyLevelForDeviceInstance(device: DeviceDefinition): DevicePrivacyLevel {
  if (device.type === 'doorbell_camera' || device.type === 'security_camera' || device.type === 'sleep_sensor') {
    return 'private';
  }
  if (device.roomId === 'garden' || device.type === 'package_sensor') {
    return 'public';
  }
  return 'household';
}

function riskOverrideForDeviceInstance(device: DeviceDefinition): DeviceRiskLevel | undefined {
  if (device.id === 'water_valve_01' || device.id === 'door_lock_01') return 'high';
  if (device.type === 'doorbell_camera' || device.type === 'security_camera' || device.type === 'sleep_sensor') return 'privacy_sensitive';
  return undefined;
}
