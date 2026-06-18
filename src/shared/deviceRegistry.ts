import { z } from 'zod';

type DeviceStatePayload = Record<string, string | number | boolean | null | undefined>;
type DeviceStatePatch = Record<string, string | number | boolean | null>;
type DeviceStateSchema = z.ZodObject<z.ZodRawShape>;
export type DeviceMarkerKind = 'sensor' | 'actuator' | 'appliance' | 'security' | 'mobile';
export type DeviceAnimationHint = 'airflow' | 'curtain' | 'glow' | 'none' | 'pulse' | 'rotate' | 'scan' | 'vibrate';

export interface DeviceMetricCapability {
  unit: string;
  normalRange?: [number, number];
}

export interface DeviceCapability {
  displayName: string;
  shortLabel: string;
  icon: string;
  markerKind: DeviceMarkerKind;
  animationHint: DeviceAnimationHint;
  stateSchema: DeviceStateSchema;
  telemetry: Record<string, DeviceMetricCapability>;
  supportedCommands: string[];
  isActive: (state: DeviceStatePayload) => boolean;
  isAbnormal: (state: DeviceStatePayload) => boolean;
  summarizeState: (state: DeviceStatePayload) => string;
}

export interface DeviceCapabilityMetadata {
  displayName: string;
  shortLabel: string;
  icon: string;
  markerKind: DeviceMarkerKind;
  animationHint: DeviceAnimationHint;
  telemetry: Record<string, DeviceMetricCapability>;
  supportedCommands: string[];
}

type DeviceCapabilityBase = Omit<DeviceCapability, 'markerKind' | 'animationHint'>;

export const deviceCapabilities: Record<string, DeviceCapabilityBase> = {
  door_lock: capability('Door Lock', 'Lock', 'lock', schema({ locked: z.boolean() }), { locked: { unit: 'bool' } }, ['lock', 'unlock'], {
    isActive: (state) => state.locked === false,
    isAbnormal: (state) => state.locked === false,
    summarizeState: (state) => state.locked === false ? 'unlocked' : 'locked'
  }),
  motion_sensor: capability('Motion Sensor', 'Motion', 'activity', schema({ motion: z.boolean(), confidence: z.number() }), { motion: { unit: 'bool' }, confidence: { unit: '%' } }, [], {
    isActive: (state) => state.motion === true,
    summarizeState: (state) => state.motion === true ? 'triggered' : 'idle'
  }),
  doorbell_camera: capability('Doorbell Camera', 'Doorbell', 'camera', schema({ motion: z.boolean(), ringing: z.boolean(), batteryPercent: z.number() }), { motion: { unit: 'bool' }, ringing: { unit: 'bool' }, batteryPercent: { unit: '%' } }, ['ring', 'record'], {
    isActive: (state) => state.motion === true || state.ringing === true,
    summarizeState: (state) => state.ringing === true ? 'ringing' : state.motion === true ? 'motion' : 'idle'
  }),
  package_sensor: capability('Package Sensor', 'Package', 'package', schema({ packagePresent: z.boolean(), weightKg: z.number() }), { packagePresent: { unit: 'bool' }, weightKg: { unit: 'kg' } }, [], {
    isActive: (state) => state.packagePresent === true,
    summarizeState: (state) => state.packagePresent === true ? `${numberValue(state.weightKg, 0)} kg` : 'empty'
  }),
  light: capability('Light', 'Light', 'lightbulb', schema({ power: z.enum(['on', 'off']), brightness: z.number() }), { power: { unit: 'state' }, brightness: { unit: '%' } }, ['turn_on', 'turn_off', 'set_brightness'], {
    isActive: (state) => state.power === 'on',
    summarizeState: (state) => state.power === 'on' ? `on ${numberValue(state.brightness, 0)}%` : 'off'
  }),
  tv: capability('Television', 'TV', 'tv', schema({ power: z.enum(['on', 'off']), app: z.string().nullable(), volume: z.number() }), { power: { unit: 'state' }, volume: { unit: '%' } }, ['turn_on', 'turn_off'], {
    isActive: (state) => state.power === 'on',
    summarizeState: (state) => state.power === 'on' ? `on ${state.app ?? 'input'}` : 'off'
  }),
  robot_vacuum: capability('Robot Vacuum', 'Vacuum', 'bot', schema({ status: z.string(), batteryPercent: z.number(), binFull: z.boolean() }), { status: { unit: 'state' }, batteryPercent: { unit: '%' }, binFull: { unit: 'bool' } }, ['start', 'dock', 'pause'], {
    isActive: (state) => state.status === 'cleaning' || state.status === 'stuck',
    isAbnormal: (state) => state.status === 'stuck',
    summarizeState: (state) => String(state.status ?? 'idle')
  }),
  curtain: capability('Curtain', 'Curtain', 'panel-top-open', schema({ positionPercent: z.number() }), { positionPercent: { unit: '%' } }, ['open', 'close', 'set_position'], {
    isActive: (state) => numberValue(state.positionPercent, 0) > 0,
    summarizeState: (state) => `${numberValue(state.positionPercent, 0)}% open`
  }),
  temperature_humidity_sensor: capability('Climate Sensor', 'Temp', 'thermometer', schema({ temperatureC: z.number(), humidityPercent: z.number() }), {
    temperatureC: { unit: 'C', normalRange: [18, 28] },
    humidityPercent: { unit: '%', normalRange: [35, 65] }
  }, [], {
    summarizeState: (state) => `${numberValue(state.temperatureC, 0)} C`
  }),
  fridge: capability('Fridge', 'Fridge', 'refrigerator', schema({ doorOpen: z.boolean(), compressorOn: z.boolean(), powerW: z.number() }), { doorOpen: { unit: 'bool' }, powerW: { unit: 'W' } }, [], {
    isActive: (state) => state.doorOpen === true || numberValue(state.powerW, 0) > 100,
    isAbnormal: (state) => state.doorOpen === true,
    summarizeState: (state) => state.doorOpen === true ? 'door open' : 'closed'
  }),
  stove: capability('Stove', 'Stove', 'flame', schema({ powerW: z.number(), level: z.number() }), { powerW: { unit: 'W' }, level: { unit: 'level' } }, ['turn_off', 'set_level'], {
    isActive: (state) => numberValue(state.powerW, 0) > 0,
    isAbnormal: (state) => numberValue(state.powerW, 0) > 700,
    summarizeState: (state) => numberValue(state.powerW, 0) > 0 ? `${numberValue(state.powerW, 0)} W` : 'off'
  }),
  range_hood: capability('Range Hood', 'Hood', 'fan', schema({ power: z.enum(['on', 'off']), speed: z.number() }), { power: { unit: 'state' }, speed: { unit: 'level' } }, ['turn_on', 'turn_off', 'set_speed'], {
    isActive: (state) => state.power === 'on' || numberValue(state.speed, 0) > 0,
    summarizeState: (state) => state.power === 'on' ? `speed ${numberValue(state.speed, 0)}` : 'off'
  }),
  air_quality_sensor: capability('Air Quality Sensor', 'Air', 'wind', schema({ pm25: z.number(), co2: z.number() }), {
    pm25: { unit: 'ug/m3', normalRange: [0, 35] },
    co2: { unit: 'ppm', normalRange: [400, 900] }
  }, [], {
    summarizeState: (state) => state.co2 !== undefined ? `${numberValue(state.co2, 0)} ppm` : `${numberValue(state.pm25, 0)} ug/m3`
  }),
  smoke_sensor: capability('Smoke Sensor', 'Smoke', 'siren', schema({ smokeDetected: z.boolean(), density: z.number() }), { smokeDetected: { unit: 'bool' }, density: { unit: 'ppm' } }, [], {
    isActive: (state) => state.smokeDetected === true || numberValue(state.density, 0) > 0,
    isAbnormal: (state) => state.smokeDetected === true,
    summarizeState: (state) => state.smokeDetected === true ? 'smoke' : 'idle'
  }),
  dishwasher: capability('Dishwasher', 'Dish', 'square-stack', schema({ status: z.string(), remainingMin: z.number(), powerW: z.number() }), { status: { unit: 'state' }, remainingMin: { unit: 'min' }, powerW: { unit: 'W' } }, ['start', 'stop'], {
    isActive: (state) => state.status === 'running' || state.status === 'done' || numberValue(state.powerW, 0) > 0,
    summarizeState: (state) => String(state.status ?? 'idle')
  }),
  sleep_sensor: capability('Sleep Sensor', 'Sleep', 'moon', schema({ inBed: z.boolean(), heartRateSimulated: z.number() }), { inBed: { unit: 'bool' }, heartRateSimulated: { unit: 'bpm' } }, [], {
    isActive: (state) => state.inBed === true,
    summarizeState: (state) => state.inBed === true ? 'in bed' : 'clear'
  }),
  air_conditioner: capability('Air Conditioner', 'AC', 'snowflake', schema({ power: z.enum(['on', 'off']), targetC: z.number(), mode: z.string() }), { power: { unit: 'state' }, targetC: { unit: 'C' }, mode: { unit: 'state' } }, ['turn_on', 'turn_off', 'set_target'], {
    isActive: (state) => state.power === 'on',
    summarizeState: (state) => state.power === 'on' ? `${numberValue(state.targetC, 0)} C` : 'off'
  }),
  router: capability('Router', 'Router', 'router', schema({ online: z.boolean(), latencyMs: z.number() }), { online: { unit: 'bool' }, latencyMs: { unit: 'ms' } }, ['restart'], {
    isActive: (state) => state.online !== true || numberValue(state.latencyMs, 0) > 100,
    isAbnormal: (state) => state.online !== true,
    summarizeState: (state) => state.online === true ? 'online' : 'offline'
  }),
  water_flow_sensor: capability('Water Flow Sensor', 'Water', 'droplets', schema({ flowLMin: z.number(), totalL: z.number() }), { flowLMin: { unit: 'L/min', normalRange: [0, 6] }, totalL: { unit: 'L' } }, [], {
    isActive: (state) => numberValue(state.flowLMin, 0) > 0,
    isAbnormal: (state) => numberValue(state.flowLMin, 0) > 6,
    summarizeState: (state) => `${numberValue(state.flowLMin, 0)} L/min`
  }),
  water_leak_sensor: capability('Leak Sensor', 'Leak', 'badge-alert', schema({ leakDetected: z.boolean() }), { leakDetected: { unit: 'bool' } }, [], {
    isActive: (state) => state.leakDetected === true,
    isAbnormal: (state) => state.leakDetected === true,
    summarizeState: (state) => state.leakDetected === true ? 'triggered' : 'idle'
  }),
  water_valve: capability('Water Valve', 'Valve', 'gauge', schema({ valveOpen: z.boolean() }), { valveOpen: { unit: 'bool' } }, ['open', 'close'], {
    isActive: (state) => state.valveOpen === true,
    summarizeState: (state) => state.valveOpen === true ? 'open' : 'closed'
  }),
  washer: capability('Washing Machine', 'Washer', 'washing-machine', schema({ status: z.string(), remainingMin: z.number(), powerW: z.number() }), { status: { unit: 'state' }, remainingMin: { unit: 'min' }, powerW: { unit: 'W' } }, ['start', 'stop'], {
    isActive: (state) => state.status === 'running' || state.status === 'done' || numberValue(state.powerW, 0) > 0,
    summarizeState: (state) => String(state.status ?? 'idle')
  }),
  soil_moisture_sensor: capability('Soil Moisture Sensor', 'Soil', 'sprout', schema({ moisturePercent: z.number() }), { moisturePercent: { unit: '%', normalRange: [30, 65] } }, [], {
    summarizeState: (state) => `${numberValue(state.moisturePercent, 0)}%`
  }),
  security_camera: capability('Security Camera', 'Camera', 'cctv', schema({ motion: z.boolean(), recording: z.boolean() }), { motion: { unit: 'bool' }, recording: { unit: 'bool' } }, ['record'], {
    isActive: (state) => state.motion === true || state.recording === true,
    summarizeState: (state) => state.recording === true ? 'recording' : state.motion === true ? 'motion' : 'idle'
  }),
  sprinkler: capability('Sprinkler', 'Sprinkler', 'waves', schema({ valveOpen: z.boolean() }), { valveOpen: { unit: 'bool' } }, ['open', 'close'], {
    isActive: (state) => state.valveOpen === true,
    summarizeState: (state) => state.valveOpen === true ? 'open' : 'closed'
  })
};

const deviceVisuals: Record<string, { markerKind: DeviceMarkerKind; animationHint: DeviceAnimationHint }> = {
  door_lock: { markerKind: 'security', animationHint: 'none' },
  motion_sensor: { markerKind: 'sensor', animationHint: 'pulse' },
  doorbell_camera: { markerKind: 'security', animationHint: 'scan' },
  package_sensor: { markerKind: 'sensor', animationHint: 'pulse' },
  light: { markerKind: 'actuator', animationHint: 'glow' },
  tv: { markerKind: 'appliance', animationHint: 'glow' },
  robot_vacuum: { markerKind: 'mobile', animationHint: 'rotate' },
  curtain: { markerKind: 'actuator', animationHint: 'curtain' },
  temperature_humidity_sensor: { markerKind: 'sensor', animationHint: 'pulse' },
  fridge: { markerKind: 'appliance', animationHint: 'none' },
  stove: { markerKind: 'appliance', animationHint: 'glow' },
  range_hood: { markerKind: 'actuator', animationHint: 'airflow' },
  air_quality_sensor: { markerKind: 'sensor', animationHint: 'pulse' },
  smoke_sensor: { markerKind: 'sensor', animationHint: 'pulse' },
  dishwasher: { markerKind: 'appliance', animationHint: 'vibrate' },
  sleep_sensor: { markerKind: 'sensor', animationHint: 'pulse' },
  air_conditioner: { markerKind: 'actuator', animationHint: 'airflow' },
  router: { markerKind: 'appliance', animationHint: 'pulse' },
  water_flow_sensor: { markerKind: 'sensor', animationHint: 'pulse' },
  water_leak_sensor: { markerKind: 'sensor', animationHint: 'pulse' },
  water_valve: { markerKind: 'actuator', animationHint: 'rotate' },
  washer: { markerKind: 'appliance', animationHint: 'vibrate' },
  soil_moisture_sensor: { markerKind: 'sensor', animationHint: 'pulse' },
  security_camera: { markerKind: 'security', animationHint: 'scan' },
  sprinkler: { markerKind: 'actuator', animationHint: 'airflow' }
};

export function getDeviceCapability(type: string): DeviceCapability {
  const base = deviceCapabilities[type] ?? capability(type, type, 'circle-help', schema({}), {}, [], {});
  const visual = deviceVisuals[type] ?? { markerKind: 'appliance' as const, animationHint: 'none' as const };
  return { ...base, ...visual };
}

export function getDeviceShortLabel(type: string): string {
  return getDeviceCapability(type).shortLabel;
}

export function isDeviceTypeActive(type: string, state: DeviceStatePayload): boolean {
  return getDeviceCapability(type).isActive(state);
}

export function isDeviceTypeAbnormal(type: string, state: DeviceStatePayload): boolean {
  return getDeviceCapability(type).isAbnormal(state);
}

export function summarizeDeviceState(type: string, state: DeviceStatePayload): string {
  return getDeviceCapability(type).summarizeState(state);
}

export function getDeviceCapabilityMetadata(): Record<string, DeviceCapabilityMetadata> {
  return Object.fromEntries(Object.keys(deviceCapabilities).map((type) => {
    const capability = getDeviceCapability(type);
    return [
      type,
      {
        displayName: capability.displayName,
        shortLabel: capability.shortLabel,
        icon: capability.icon,
        markerKind: capability.markerKind,
        animationHint: capability.animationHint,
        telemetry: structuredClone(capability.telemetry),
        supportedCommands: [...capability.supportedCommands]
      }
    ];
  }));
}

export function validateDeviceStatePatch(type: string, patch: DeviceStatePayload): DeviceStatePatch {
  return getDeviceCapability(type).stateSchema.parse(patch) as DeviceStatePatch;
}

function capability(
  displayName: string,
  shortLabel: string,
  icon: string,
  stateSchema: DeviceStateSchema,
  telemetry: Record<string, DeviceMetricCapability>,
  supportedCommands: string[],
  overrides: Partial<Pick<DeviceCapability, 'isActive' | 'isAbnormal' | 'summarizeState'>>
): DeviceCapabilityBase {
  return {
    displayName,
    shortLabel,
    icon,
    stateSchema,
    telemetry,
    supportedCommands,
    isActive: overrides.isActive ?? (() => false),
    isAbnormal: overrides.isAbnormal ?? (() => false),
    summarizeState: overrides.summarizeState ?? ((state) => defaultSummary(displayName, state))
  };
}

function schema(shape: z.ZodRawShape): DeviceStateSchema {
  return z.object(shape).partial().strict();
}

function numberValue(value: DeviceStatePayload[string], fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function defaultSummary(displayName: string, state: DeviceStatePayload): string {
  return Object.keys(state).length > 0 ? 'idle' : displayName;
}
