import type { DeviceVisualModel } from '../shared/deviceRegistry';

export type DeviceVisualBodyShape = 'box' | 'cone' | 'cylinder' | 'sphere';

export type DeviceVisualAccent =
  | 'airflow'
  | 'antennas'
  | 'curtain'
  | 'dish_rack'
  | 'door'
  | 'handle'
  | 'indicator'
  | 'lens'
  | 'none'
  | 'pipe'
  | 'probe'
  | 'round_door'
  | 'screen'
  | 'spray_head'
  | 'top_disc';

export interface DeviceVisualProfile {
  bodyShape: DeviceVisualBodyShape;
  bodySize: [number, number, number];
  accent: DeviceVisualAccent;
  wallOriented: boolean;
}

const deviceVisualProfiles: Record<DeviceVisualModel, DeviceVisualProfile> = {
  air_conditioner_wall: {
    bodyShape: 'box',
    bodySize: [0.34, 0.16, 0.11],
    accent: 'airflow',
    wallOriented: true
  },
  bed_sleep_pad: {
    bodyShape: 'box',
    bodySize: [0.34, 0.04, 0.2],
    accent: 'indicator',
    wallOriented: false
  },
  curtain_panel: {
    bodyShape: 'box',
    bodySize: [0.08, 0.42, 0.18],
    accent: 'curtain',
    wallOriented: true
  },
  dishwasher_box: {
    bodyShape: 'box',
    bodySize: [0.27, 0.28, 0.23],
    accent: 'dish_rack',
    wallOriented: false
  },
  door_lock: {
    bodyShape: 'box',
    bodySize: [0.1, 0.2, 0.08],
    accent: 'handle',
    wallOriented: true
  },
  fridge_tower: {
    bodyShape: 'box',
    bodySize: [0.24, 0.58, 0.22],
    accent: 'door',
    wallOriented: false
  },
  generic_box: {
    bodyShape: 'box',
    bodySize: [0.22, 0.2, 0.18],
    accent: 'indicator',
    wallOriented: false
  },
  generic_sphere: {
    bodyShape: 'sphere',
    bodySize: [0.22, 0.22, 0.22],
    accent: 'indicator',
    wallOriented: false
  },
  light_disc: {
    bodyShape: 'cylinder',
    bodySize: [0.2, 0.05, 0.2],
    accent: 'indicator',
    wallOriented: false
  },
  package_pad: {
    bodyShape: 'box',
    bodySize: [0.28, 0.06, 0.22],
    accent: 'indicator',
    wallOriented: false
  },
  range_hood: {
    bodyShape: 'box',
    bodySize: [0.28, 0.18, 0.2],
    accent: 'airflow',
    wallOriented: true
  },
  robot_vacuum: {
    bodyShape: 'cylinder',
    bodySize: [0.18, 0.08, 0.18],
    accent: 'top_disc',
    wallOriented: false
  },
  router_antennas: {
    bodyShape: 'box',
    bodySize: [0.24, 0.08, 0.18],
    accent: 'antennas',
    wallOriented: false
  },
  sensor_puck: {
    bodyShape: 'sphere',
    bodySize: [0.18, 0.18, 0.18],
    accent: 'indicator',
    wallOriented: false
  },
  soil_probe: {
    bodyShape: 'cylinder',
    bodySize: [0.08, 0.22, 0.08],
    accent: 'probe',
    wallOriented: false
  },
  sprinkler_head: {
    bodyShape: 'cylinder',
    bodySize: [0.12, 0.1, 0.12],
    accent: 'spray_head',
    wallOriented: false
  },
  stove_top: {
    bodyShape: 'box',
    bodySize: [0.3, 0.08, 0.24],
    accent: 'top_disc',
    wallOriented: false
  },
  tv_screen: {
    bodyShape: 'box',
    bodySize: [0.48, 0.28, 0.05],
    accent: 'screen',
    wallOriented: true
  },
  wall_camera: {
    bodyShape: 'cone',
    bodySize: [0.16, 0.24, 0.16],
    accent: 'lens',
    wallOriented: true
  },
  washer_drum: {
    bodyShape: 'box',
    bodySize: [0.28, 0.3, 0.24],
    accent: 'round_door',
    wallOriented: false
  },
  water_pipe_sensor: {
    bodyShape: 'cylinder',
    bodySize: [0.1, 0.2, 0.1],
    accent: 'pipe',
    wallOriented: false
  },
  water_valve_handle: {
    bodyShape: 'cylinder',
    bodySize: [0.13, 0.18, 0.13],
    accent: 'handle',
    wallOriented: false
  }
};

const deviceVisualVariantProfiles: Record<string, DeviceVisualProfile> = {
  'wall_camera:doorbell_slim': {
    bodyShape: 'box',
    bodySize: [0.12, 0.22, 0.08],
    accent: 'lens',
    wallOriented: true
  },
  'wall_camera:outdoor_bullet': {
    bodyShape: 'cone',
    bodySize: [0.18, 0.32, 0.18],
    accent: 'lens',
    wallOriented: true
  }
};

export function hasDeviceVisualProfile(model: DeviceVisualModel): boolean {
  return model in deviceVisualProfiles;
}

export function getDeviceVisualProfile(model: DeviceVisualModel, visualVariant?: string | null): DeviceVisualProfile {
  if (visualVariant) {
    const variantProfile = deviceVisualVariantProfiles[`${model}:${visualVariant}`];
    if (variantProfile) {
      return variantProfile;
    }
  }
  return deviceVisualProfiles[model] ?? deviceVisualProfiles.generic_box;
}
