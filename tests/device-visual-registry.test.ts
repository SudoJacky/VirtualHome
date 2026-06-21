import { describe, expect, it } from 'vitest';
import { getCatalog } from '../src/sim/catalog';
import { getDeviceCapability } from '../src/shared/deviceRegistry';
import { getDeviceVisualProfile, hasDeviceVisualProfile } from '../src/web/deviceVisualRegistry';

describe('device visual registry', () => {
  it('resolves every catalog device visual model to a renderable profile', () => {
    const visualModels = new Set(getCatalog().devices.map((device) => getDeviceCapability(device.type).visualModel));

    for (const visualModel of visualModels) {
      expect(hasDeviceVisualProfile(visualModel)).toBe(true);
      expect(getDeviceVisualProfile(visualModel).bodySize.every((value) => value > 0)).toBe(true);
    }
  });

  it('uses differentiated profiles for the first high-recognition batch', () => {
    expect(getDeviceVisualProfile('tv_screen')).toMatchObject({
      bodyShape: 'box',
      accent: 'screen',
      wallOriented: true
    });
    expect(getDeviceVisualProfile('fridge_tower')).toMatchObject({
      bodyShape: 'box',
      accent: 'door',
      bodySize: [0.24, 0.58, 0.22]
    });
    expect(getDeviceVisualProfile('washer_drum')).toMatchObject({
      bodyShape: 'box',
      accent: 'round_door'
    });
    expect(getDeviceVisualProfile('router_antennas')).toMatchObject({
      bodyShape: 'box',
      accent: 'antennas'
    });
    expect(getDeviceVisualProfile('wall_camera')).toMatchObject({
      bodyShape: 'cone',
      accent: 'lens',
      wallOriented: true
    });
    expect(getDeviceVisualProfile('robot_vacuum')).toMatchObject({
      bodyShape: 'cylinder',
      accent: 'top_disc'
    });
    expect(getDeviceVisualProfile('water_valve_handle')).toMatchObject({
      bodyShape: 'cylinder',
      accent: 'handle'
    });
    expect(getDeviceVisualProfile('sprinkler_head')).toMatchObject({
      bodyShape: 'cylinder',
      accent: 'spray_head'
    });
  });

  it('applies instance visual variants for devices sharing the same visual model', () => {
    expect(getDeviceVisualProfile('wall_camera', 'doorbell_slim')).toMatchObject({
      bodyShape: 'box',
      bodySize: [0.12, 0.22, 0.08],
      accent: 'lens',
      wallOriented: true
    });
    expect(getDeviceVisualProfile('wall_camera', 'outdoor_bullet')).toMatchObject({
      bodyShape: 'cone',
      bodySize: [0.18, 0.32, 0.18],
      accent: 'lens',
      wallOriented: true
    });
    expect(getDeviceVisualProfile('wall_camera', 'unknown_variant')).toEqual(getDeviceVisualProfile('wall_camera'));
  });
});
