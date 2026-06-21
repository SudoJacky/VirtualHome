import { describe, expect, it } from 'vitest';
import { getCatalog } from '../src/sim/catalog';
import { deviceInstanceProfiles, devicePoints, getDeviceInstanceProfile, getDevicePoint } from '../src/web/deviceInstanceLayout';

describe('device instance layout', () => {
  it('keeps every catalog device in the standalone instance layout', () => {
    const catalogDeviceIds = getCatalog().devices.map((device) => device.id).sort();
    const layoutDeviceIds = devicePoints.map((point) => point.deviceId).sort();
    const profileDeviceIds = deviceInstanceProfiles.map((profile) => profile.deviceId).sort();

    expect(layoutDeviceIds).toEqual(catalogDeviceIds);
    expect(profileDeviceIds).toEqual(catalogDeviceIds);
  });

  it('models installation details for key device families', () => {
    expect(getDevicePoint('doorbell_camera_01')).toMatchObject({
      roomId: 'entrance',
      mount: 'wall',
      rotation: Math.PI / 2,
      visualVariant: 'doorbell_slim'
    });
    expect(getDevicePoint('garden_camera_01')).toMatchObject({
      roomId: 'garden',
      mount: 'wall',
      visualVariant: 'outdoor_bullet'
    });
    expect(getDevicePoint('living_light_01')).toMatchObject({
      mount: 'ceiling',
      y: 0.62
    });
    expect(getDevicePoint('robot_vacuum_01')).toMatchObject({
      mount: 'floor',
      y: 0.11
    });
    expect(getDevicePoint('water_valve_01')).toMatchObject({
      roomId: 'bathroom',
      mount: 'pipe'
    });
    expect(getDevicePoint('sprinkler_01')).toMatchObject({
      roomId: 'garden',
      mount: 'outdoor'
    });
  });

  it('describes device instances with household names, groups, privacy, and risk overrides', () => {
    expect(deviceInstanceProfiles.every((profile) => profile.displayName.length > 0)).toBe(true);
    expect(deviceInstanceProfiles.every((profile) => profile.shortLabel.length > 0)).toBe(true);
    expect(deviceInstanceProfiles.every((profile) => profile.group)).toBe(true);
    expect(deviceInstanceProfiles.every((profile) => profile.privacyLevel)).toBe(true);

    expect(getDeviceInstanceProfile('doorbell_camera_01')).toMatchObject({
      displayName: 'Doorbell Camera',
      shortLabel: 'Doorbell',
      group: 'entrance_security',
      privacyLevel: 'private'
    });
    expect(getDeviceInstanceProfile('router_01')).toMatchObject({
      displayName: 'Home Router',
      group: 'network_infrastructure',
      privacyLevel: 'household'
    });
    expect(getDeviceInstanceProfile('water_valve_01')).toMatchObject({
      group: 'bathroom_water',
      riskOverride: 'high'
    });
    expect(getDeviceInstanceProfile('master_sleep_01')).toMatchObject({
      group: 'bedroom_comfort',
      privacyLevel: 'private'
    });
  });
});
