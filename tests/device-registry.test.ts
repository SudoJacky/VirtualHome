import { describe, expect, it } from 'vitest';
import { getCatalog } from '../src/sim/catalog';
import { deviceCapabilities, getDeviceCapability } from '../src/shared/deviceRegistry';

describe('device capability registry', () => {
  it('defines display and state rules for every catalog device type', () => {
    const catalogTypes = [...new Set(getCatalog().devices.map((device) => device.type))].sort();

    expect(Object.keys(deviceCapabilities).sort()).toEqual(catalogTypes);
    for (const type of catalogTypes) {
      const capability = getDeviceCapability(type);
      expect(capability.displayName).not.toBe('');
      expect(capability.shortLabel).not.toBe('');
      expect(capability.icon).not.toBe('');
      expect(capability.markerKind).toMatch(/^(sensor|actuator|appliance|security|mobile)$/);
      expect(capability.animationHint).toMatch(/^(none|pulse|glow|rotate|vibrate|scan|airflow|curtain)$/);
      expect(capability.stateSchema.safeParse({}).success).toBe(true);
      expect(capability.defaultState).toBeDefined();
      expect(capability.stateSchema.safeParse(capability.defaultState).success).toBe(true);
      expect(capability.supportedCommands).toBeDefined();
      expect(capability.telemetry).toBeDefined();
      expect(typeof capability.isActive).toBe('function');
      expect(typeof capability.isAbnormal).toBe('function');
      expect(typeof capability.summarizeState).toBe('function');
    }
  });

  it('centralizes active and abnormal rules used by 2D and 3D views', () => {
    expect(getDeviceCapability('robot_vacuum').isActive({ status: 'cleaning' })).toBe(true);
    expect(getDeviceCapability('robot_vacuum').isAbnormal({ status: 'stuck' })).toBe(true);
    expect(getDeviceCapability('router').isActive({ online: true, latencyMs: 180 })).toBe(true);
    expect(getDeviceCapability('router').isAbnormal({ online: false })).toBe(true);
    expect(getDeviceCapability('water_leak_sensor').summarizeState({ leakDetected: true })).toBe('triggered');
  });

  it('validates state shape per device type instead of accepting arbitrary fields', () => {
    expect(getDeviceCapability('fridge').stateSchema.safeParse({ doorOpen: true, powerW: 120 }).success).toBe(true);
    expect(getDeviceCapability('fridge').stateSchema.safeParse({ online: false, latencyMs: 0 }).success).toBe(false);
    expect(getDeviceCapability('router').stateSchema.safeParse({ online: false, latencyMs: 0 }).success).toBe(true);
    expect(getDeviceCapability('router').stateSchema.safeParse({ doorOpen: true }).success).toBe(false);
  });
});
