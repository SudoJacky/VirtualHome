import { deviceCapabilities } from '../shared/deviceRegistry';
import type { DeviceState, HomeMode, RoomState } from '../shared/types';

export interface DeviceBehaviorInput {
  elapsedMinutes: number;
  simTime: string;
  seed: number;
  homeMode: HomeMode;
  devices: readonly DeviceState[];
  rooms: readonly RoomState[];
}

export interface DeviceBehaviorStateEffect {
  kind: 'setDeviceState';
  deviceId: string;
  state: Record<string, string | number | boolean | null>;
  reason: string;
}

export type DeviceBehaviorEffect = DeviceBehaviorStateEffect;

interface DeviceBehaviorModuleBase {
  id: string;
  version: string;
  deviceTypes: readonly string[];
  replaces?: readonly string[];
}

export interface NativeDeviceBehaviorModule extends DeviceBehaviorModuleBase {
  implementation: 'native';
}

export interface EffectDeviceBehaviorModule extends DeviceBehaviorModuleBase {
  implementation: 'effects';
  advance(input: Readonly<DeviceBehaviorInput>): readonly DeviceBehaviorEffect[];
}

export type DeviceBehaviorModule = NativeDeviceBehaviorModule | EffectDeviceBehaviorModule;

export const coreDeviceBehaviorModule: NativeDeviceBehaviorModule = {
  id: 'core_device_physics',
  version: '1.0.0',
  implementation: 'native',
  deviceTypes: Object.freeze(Object.keys(deviceCapabilities).sort())
};
