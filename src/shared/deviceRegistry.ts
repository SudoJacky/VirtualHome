import { z } from 'zod';

type DeviceStatePayload = Record<string, string | number | boolean | null | undefined>;
type DeviceStatePatch = Record<string, string | number | boolean | null>;
type DeviceStateSchema = z.ZodObject<z.ZodRawShape>;
export type DeviceMarkerKind = 'sensor' | 'actuator' | 'appliance' | 'security' | 'lighting' | 'climate' | 'media' | 'mobile' | 'network';
export type DeviceAnimationHint = 'airflow' | 'glow' | 'none' | 'open_close' | 'patrol' | 'pulse' | 'rotate' | 'scan' | 'vibrate' | 'waterflow';
export type DeviceRiskLevel = 'normal' | 'confirmation' | 'required_confirmation' | 'privacy_sensitive' | 'high';
export type DeviceCommandControlType = 'button' | 'toggle' | 'slider' | 'select';
export type DeviceCommandValueType = 'none' | 'boolean' | 'number' | 'string' | 'enum';
export type DeviceCommandLifecycleStatus = 'requested' | 'sent' | 'acknowledged' | 'failed' | 'rolled_back';
export type DeviceCommandFailureReason = 'offline' | 'unsupported' | 'invalid_params' | 'device_rejected' | 'timeout';
export type DeviceHealthSignalKind = 'battery' | 'command_failure' | 'connectivity' | 'drift' | 'latency' | 'range' | 'staleness';
export type DeviceHealthImpact = 'automation_reliability' | 'care' | 'comfort' | 'energy' | 'safety' | 'security' | 'water';
export type DeviceVisualModel =
  | 'air_conditioner_wall'
  | 'bed_sleep_pad'
  | 'curtain_panel'
  | 'dishwasher_box'
  | 'door_lock'
  | 'fridge_tower'
  | 'generic_box'
  | 'generic_sphere'
  | 'light_disc'
  | 'package_pad'
  | 'range_hood'
  | 'robot_vacuum'
  | 'router_antennas'
  | 'sensor_puck'
  | 'soil_probe'
  | 'sprinkler_head'
  | 'stove_top'
  | 'tv_screen'
  | 'wall_camera'
  | 'washer_drum'
  | 'water_pipe_sensor'
  | 'water_valve_handle';

export interface DeviceMetricCapability {
  unit: string;
  normalRange?: [number, number];
}

export type DeviceStateFieldType = 'boolean' | 'number' | 'string' | 'unknown';

export interface DeviceStateFieldMetadata {
  type: DeviceStateFieldType;
  required: boolean;
  defaultValue?: string | number | boolean | null;
  unit?: string;
  normalRange?: [number, number];
  nullable?: boolean;
  enum?: string[];
}

export interface DeviceCommandMetadata {
  label: string;
  controlType: DeviceCommandControlType;
  valueType: DeviceCommandValueType;
  field: string | null;
  min?: number;
  max?: number;
  options?: string[];
  highRisk: boolean;
  requiresConfirmation: boolean;
  lifecycle: DeviceCommandLifecycleStatus[];
  failureReasons: DeviceCommandFailureReason[];
}

export interface DeviceHealthSignal {
  kind: DeviceHealthSignalKind;
  label: string;
  sourceField: string | null;
  normalRange?: [number, number];
  warningBelow?: number;
  alertBelow?: number;
  warningAbove?: number;
  alertAbove?: number;
  staleAfterMinutes?: number;
  recommendation: string;
  impact: DeviceHealthImpact;
}

export interface DeviceHealthStatus {
  kind: DeviceHealthSignalKind;
  label: string;
  sourceField: string | null;
  status: 'normal' | 'watch' | 'alert';
  reportedValue: string | number | boolean | null;
  recommendation: string;
  impact: DeviceHealthImpact;
}

export interface DeviceCapability {
  displayName: string;
  shortLabel: string;
  icon: string;
  markerKind: DeviceMarkerKind;
  animationHint: DeviceAnimationHint;
  visualModel: DeviceVisualModel;
  visualScale: number;
  riskLevel: DeviceRiskLevel;
  defaultState: DeviceStatePatch;
  stateSchema: DeviceStateSchema;
  telemetry: Record<string, DeviceMetricCapability>;
  supportedCommands: string[];
  commandMetadata: Record<string, DeviceCommandMetadata>;
  healthSignals: DeviceHealthSignal[];
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
  visualModel: DeviceVisualModel;
  visualScale: number;
  riskLevel: DeviceRiskLevel;
  defaultState: DeviceStatePatch;
  stateFields: Record<string, DeviceStateFieldMetadata>;
  telemetry: Record<string, DeviceMetricCapability>;
  supportedCommands: string[];
  commandMetadata: Record<string, DeviceCommandMetadata>;
  healthSignals: DeviceHealthSignal[];
}

type DeviceCapabilityBase = Omit<DeviceCapability, 'markerKind' | 'animationHint' | 'visualModel' | 'visualScale' | 'riskLevel' | 'defaultState' | 'commandMetadata' | 'healthSignals'>;

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
  tv: capability('Television', 'TV', 'tv', schema({ power: z.enum(['on', 'off']), app: z.string().nullable(), volume: z.number(), lifecyclePhase: z.string() }), { power: { unit: 'state' }, volume: { unit: '%' }, lifecyclePhase: { unit: 'state' } }, ['turn_on', 'turn_off', 'set_volume', 'set_input', 'pause'], {
    isActive: (state) => state.power === 'on',
    summarizeState: (state) => state.lifecyclePhase ? String(state.lifecyclePhase) : state.power === 'on' ? `on ${state.app ?? 'input'}` : 'off'
  }),
  robot_vacuum: capability('Robot Vacuum', 'Vacuum', 'bot', schema({ status: z.string(), batteryPercent: z.number(), binFull: z.boolean(), cycleMinutes: z.number() }), { status: { unit: 'state' }, batteryPercent: { unit: '%' }, binFull: { unit: 'bool' }, cycleMinutes: { unit: 'min' } }, ['start', 'dock', 'pause', 'assist'], {
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
  fridge: capability('Fridge', 'Fridge', 'refrigerator', schema({ doorOpen: z.boolean(), compressorOn: z.boolean(), powerW: z.number(), lifecyclePhase: z.string(), openMinutes: z.number() }), { doorOpen: { unit: 'bool' }, powerW: { unit: 'W' }, lifecyclePhase: { unit: 'state' }, openMinutes: { unit: 'min' } }, ['close'], {
    isActive: (state) => state.doorOpen === true || numberValue(state.powerW, 0) > 100,
    isAbnormal: (state) => state.doorOpen === true,
    summarizeState: (state) => state.lifecyclePhase ? String(state.lifecyclePhase) : state.doorOpen === true ? 'door open' : 'closed'
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
    isActive: (state) => state.status === 'running' || state.status === 'waiting_unload' || state.status === 'done' || numberValue(state.powerW, 0) > 0,
    summarizeState: (state) => String(state.status ?? 'idle')
  }),
  sleep_sensor: capability('Sleep Sensor', 'Sleep', 'moon', schema({ inBed: z.boolean(), heartRateSimulated: z.number() }), { inBed: { unit: 'bool' }, heartRateSimulated: { unit: 'bpm' } }, [], {
    isActive: (state) => state.inBed === true,
    summarizeState: (state) => state.inBed === true ? 'in bed' : 'clear'
  }),
  air_conditioner: capability('Air Conditioner', 'AC', 'snowflake', schema({ power: z.enum(['on', 'off']), targetC: z.number(), mode: z.string() }), { power: { unit: 'state' }, targetC: { unit: 'C' }, mode: { unit: 'state' } }, ['turn_on', 'turn_off', 'set_target', 'set_mode'], {
    isActive: (state) => state.power === 'on',
    summarizeState: (state) => state.power === 'on' ? `${numberValue(state.targetC, 0)} C` : 'off'
  }),
  router: capability('Router', 'Router', 'router', schema({ online: z.boolean(), latencyMs: z.number(), lifecyclePhase: z.string() }), { online: { unit: 'bool' }, latencyMs: { unit: 'ms' }, lifecyclePhase: { unit: 'state' } }, ['restart'], {
    isActive: (state) => state.online !== true || numberValue(state.latencyMs, 0) > 100,
    isAbnormal: (state) => state.online !== true,
    summarizeState: (state) => state.lifecyclePhase ? String(state.lifecyclePhase) : state.online === true ? 'online' : 'offline'
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
  washer: capability('Washing Machine', 'Washer', 'washing-machine', schema({ status: z.string(), remainingMin: z.number(), powerW: z.number(), mode: z.string() }), { status: { unit: 'state' }, remainingMin: { unit: 'min' }, powerW: { unit: 'W' }, mode: { unit: 'state' } }, ['start', 'stop', 'set_mode'], {
    isActive: (state) => state.status === 'running' || state.status === 'waiting_unload' || state.status === 'done' || numberValue(state.powerW, 0) > 0,
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

const deviceVisuals: Record<string, { markerKind: DeviceMarkerKind; animationHint: DeviceAnimationHint; visualModel: DeviceVisualModel; visualScale: number }> = {
  door_lock: { markerKind: 'security', animationHint: 'open_close', visualModel: 'door_lock', visualScale: 1 },
  motion_sensor: { markerKind: 'sensor', animationHint: 'pulse', visualModel: 'sensor_puck', visualScale: 0.88 },
  doorbell_camera: { markerKind: 'security', animationHint: 'scan', visualModel: 'wall_camera', visualScale: 1 },
  package_sensor: { markerKind: 'sensor', animationHint: 'pulse', visualModel: 'package_pad', visualScale: 1 },
  light: { markerKind: 'lighting', animationHint: 'glow', visualModel: 'light_disc', visualScale: 1 },
  tv: { markerKind: 'media', animationHint: 'glow', visualModel: 'tv_screen', visualScale: 1.12 },
  robot_vacuum: { markerKind: 'mobile', animationHint: 'patrol', visualModel: 'robot_vacuum', visualScale: 1 },
  curtain: { markerKind: 'actuator', animationHint: 'open_close', visualModel: 'curtain_panel', visualScale: 1 },
  temperature_humidity_sensor: { markerKind: 'sensor', animationHint: 'pulse', visualModel: 'sensor_puck', visualScale: 0.82 },
  fridge: { markerKind: 'appliance', animationHint: 'open_close', visualModel: 'fridge_tower', visualScale: 1.35 },
  stove: { markerKind: 'appliance', animationHint: 'glow', visualModel: 'stove_top', visualScale: 1 },
  range_hood: { markerKind: 'actuator', animationHint: 'airflow', visualModel: 'range_hood', visualScale: 1 },
  air_quality_sensor: { markerKind: 'sensor', animationHint: 'pulse', visualModel: 'sensor_puck', visualScale: 0.9 },
  smoke_sensor: { markerKind: 'sensor', animationHint: 'pulse', visualModel: 'sensor_puck', visualScale: 0.86 },
  dishwasher: { markerKind: 'appliance', animationHint: 'vibrate', visualModel: 'dishwasher_box', visualScale: 1 },
  sleep_sensor: { markerKind: 'sensor', animationHint: 'pulse', visualModel: 'bed_sleep_pad', visualScale: 1 },
  air_conditioner: { markerKind: 'climate', animationHint: 'airflow', visualModel: 'air_conditioner_wall', visualScale: 1.08 },
  router: { markerKind: 'network', animationHint: 'pulse', visualModel: 'router_antennas', visualScale: 0.95 },
  water_flow_sensor: { markerKind: 'sensor', animationHint: 'waterflow', visualModel: 'water_pipe_sensor', visualScale: 0.9 },
  water_leak_sensor: { markerKind: 'sensor', animationHint: 'waterflow', visualModel: 'sensor_puck', visualScale: 0.85 },
  water_valve: { markerKind: 'actuator', animationHint: 'open_close', visualModel: 'water_valve_handle', visualScale: 1 },
  washer: { markerKind: 'appliance', animationHint: 'vibrate', visualModel: 'washer_drum', visualScale: 1.2 },
  soil_moisture_sensor: { markerKind: 'sensor', animationHint: 'pulse', visualModel: 'soil_probe', visualScale: 0.85 },
  security_camera: { markerKind: 'security', animationHint: 'scan', visualModel: 'wall_camera', visualScale: 1.05 },
  sprinkler: { markerKind: 'actuator', animationHint: 'waterflow', visualModel: 'sprinkler_head', visualScale: 1 }
};

const commandLifecycle: DeviceCommandLifecycleStatus[] = ['requested', 'sent', 'acknowledged', 'failed', 'rolled_back'];
const commandFailureReasons: DeviceCommandFailureReason[] = ['offline', 'unsupported', 'invalid_params', 'device_rejected', 'timeout'];

const defaultDeviceStates: Record<string, DeviceStatePatch> = {
  door_lock: { locked: true },
  motion_sensor: { motion: false, confidence: 0 },
  doorbell_camera: { motion: false, ringing: false, batteryPercent: 96 },
  package_sensor: { packagePresent: false, weightKg: 0 },
  light: { power: 'off', brightness: 0 },
  tv: { power: 'off', app: null, volume: 0, lifecyclePhase: 'off' },
  robot_vacuum: { status: 'docked', batteryPercent: 100, binFull: false, cycleMinutes: 0 },
  curtain: { positionPercent: 35 },
  temperature_humidity_sensor: { temperatureC: 25, humidityPercent: 55 },
  fridge: { doorOpen: false, compressorOn: true, powerW: 90, lifecyclePhase: 'closed', openMinutes: 0 },
  stove: { powerW: 0, level: 0 },
  range_hood: { power: 'off', speed: 0 },
  air_quality_sensor: { pm25: 8, co2: 520 },
  smoke_sensor: { smokeDetected: false, density: 0 },
  dishwasher: { status: 'idle', remainingMin: 0, powerW: 0 },
  sleep_sensor: { inBed: true, heartRateSimulated: 62 },
  air_conditioner: { power: 'off', targetC: 26, mode: 'auto' },
  router: { online: true, latencyMs: 18, lifecyclePhase: 'online' },
  water_flow_sensor: { flowLMin: 0, totalL: 0 },
  water_leak_sensor: { leakDetected: false },
  water_valve: { valveOpen: true },
  washer: { status: 'idle', remainingMin: 0, powerW: 0, mode: 'normal' },
  soil_moisture_sensor: { moisturePercent: 38 },
  security_camera: { motion: false, recording: false },
  sprinkler: { valveOpen: false }
};

export function getDeviceCapability(type: string): DeviceCapability {
  const base = deviceCapabilities[type] ?? capability(type, type, 'circle-help', schema({}), {}, [], {});
  const visual = deviceVisuals[type] ?? { markerKind: 'appliance' as const, animationHint: 'none' as const, visualModel: 'generic_box' as const, visualScale: 1 };
  const defaultState = structuredClone(defaultDeviceStates[type] ?? {});
  return {
    ...base,
    ...visual,
    riskLevel: riskLevelForDeviceType(type),
    defaultState,
    commandMetadata: createCommandMetadata(type, base.supportedCommands),
    healthSignals: createHealthSignals(type, base.telemetry)
  };
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
        visualModel: capability.visualModel,
        visualScale: capability.visualScale,
        riskLevel: capability.riskLevel,
        defaultState: structuredClone(capability.defaultState),
        stateFields: serializeStateFields(capability.stateSchema, capability.defaultState, capability.telemetry),
        telemetry: structuredClone(capability.telemetry),
        supportedCommands: [...capability.supportedCommands],
        commandMetadata: structuredClone(capability.commandMetadata),
        healthSignals: structuredClone(capability.healthSignals)
      }
    ];
  }));
}

export function validateDeviceStatePatch(type: string, patch: DeviceStatePayload): DeviceStatePatch {
  return getDeviceCapability(type).stateSchema.parse(patch) as DeviceStatePatch;
}

export function evaluateDeviceHealthSignals(
  signals: DeviceHealthSignal[],
  state: DeviceStatePayload,
  lastSeenAt: string,
  currentTime: string
): DeviceHealthStatus[] {
  return signals.map((signal) => {
    const reportedValue = signal.sourceField ? state[signal.sourceField] ?? null : null;
    return {
      kind: signal.kind,
      label: signal.label,
      sourceField: signal.sourceField,
      status: healthSignalStatus(signal, reportedValue, lastSeenAt, currentTime),
      reportedValue,
      recommendation: signal.recommendation,
      impact: signal.impact
    };
  });
}

function healthSignalStatus(
  signal: DeviceHealthSignal,
  reportedValue: string | number | boolean | null,
  lastSeenAt: string,
  currentTime: string
): DeviceHealthStatus['status'] {
  if (signal.kind === 'connectivity' && reportedValue === false) return 'alert';
  if (signal.kind === 'staleness') {
    const staleAfterMinutes = signal.staleAfterMinutes ?? 60;
    const ageMs = new Date(currentTime).getTime() - new Date(lastSeenAt).getTime();
    return ageMs > staleAfterMinutes * 60 * 1000 ? 'watch' : 'normal';
  }
  if (typeof reportedValue !== 'number') {
    return 'normal';
  }
  if (signal.alertBelow !== undefined && reportedValue <= signal.alertBelow) return 'alert';
  if (signal.alertAbove !== undefined && reportedValue >= signal.alertAbove) return 'alert';
  if (signal.warningBelow !== undefined && reportedValue <= signal.warningBelow) return 'watch';
  if (signal.warningAbove !== undefined && reportedValue >= signal.warningAbove) return 'watch';
  if (signal.normalRange && (reportedValue < signal.normalRange[0] || reportedValue > signal.normalRange[1])) return 'watch';
  return 'normal';
}

function riskLevelForDeviceType(type: string): DeviceRiskLevel {
  if (type === 'door_lock' || type === 'water_valve' || type === 'stove') return 'high';
  if (type === 'doorbell_camera' || type === 'security_camera' || type === 'sleep_sensor') return 'privacy_sensitive';
  if (type === 'router' || type === 'smoke_sensor') return 'confirmation';
  return 'normal';
}

function createCommandMetadata(type: string, commands: string[]): Record<string, DeviceCommandMetadata> {
  return Object.fromEntries(commands.map((command) => [command, commandMetadata(type, command)]));
}

function commandMetadata(type: string, command: string): DeviceCommandMetadata {
  const field = commandField(command, type);
  const options = field ? commandOptions(type, field) : [];
  const controlType = commandControlType(command, options);
  const highRisk = isHighRiskCommand(type, command);
  const metadata: DeviceCommandMetadata = {
    label: commandLabel(type, command),
    controlType,
    valueType: commandValueType(command, field, options),
    field,
    highRisk,
    requiresConfirmation: highRisk || type === 'router' && command === 'restart',
    lifecycle: [...commandLifecycle],
    failureReasons: [...commandFailureReasons]
  };
  if (controlType === 'slider') {
    metadata.min = commandMin(field);
    metadata.max = commandMax(field);
  }
  if (options.length > 0) {
    metadata.options = options;
  }
  return metadata;
}

function commandField(command: string, deviceType: string): string | null {
  if (command === 'set_brightness') return 'brightness';
  if (command === 'set_position') return 'positionPercent';
  if (command === 'set_target') return 'targetC';
  if (command === 'set_volume') return 'volume';
  if (command === 'set_input') return 'app';
  if (command === 'set_mode') return 'mode';
  if (command === 'set_level') return 'level';
  if (command === 'set_speed') return 'speed';
  if (command === 'turn_on' || command === 'turn_off') return 'power';
  if (command === 'open' || command === 'close') {
    if (deviceType === 'curtain') return 'positionPercent';
    if (deviceType === 'fridge') return 'doorOpen';
    return 'valveOpen';
  }
  if (command === 'lock' || command === 'unlock') return 'locked';
  return null;
}

function commandControlType(command: string, options: string[]): DeviceCommandControlType {
  if (command.startsWith('set_')) return options.length > 0 ? 'select' : 'slider';
  if (['turn_on', 'turn_off', 'open', 'close', 'lock', 'unlock'].includes(command)) return 'toggle';
  return 'button';
}

function commandValueType(command: string, field: string | null, options: string[]): DeviceCommandValueType {
  if (!field) return 'none';
  if (options.length > 0) return 'enum';
  if (command.startsWith('set_')) return 'number';
  if (['turn_on', 'turn_off', 'open', 'close', 'lock', 'unlock'].includes(command)) return 'boolean';
  return 'string';
}

function commandLabel(deviceType: string, command: string): string {
  if (deviceType === 'router' && command === 'restart') return 'Restart router';
  if (deviceType === 'water_valve' && command === 'open') return 'Open valve';
  if (deviceType === 'water_valve' && command === 'close') return 'Close valve';
  if (deviceType === 'fridge' && command === 'close') return 'Close fridge';
  if (deviceType === 'sprinkler' && command === 'open') return 'Open sprinkler';
  if (deviceType === 'sprinkler' && command === 'close') return 'Close sprinkler';
  if (deviceType === 'door_lock' && command === 'unlock') return 'Unlock door';
  if (deviceType === 'door_lock' && command === 'lock') return 'Lock door';
  return sentenceCase(command.replaceAll('_', ' '));
}

function isHighRiskCommand(deviceType: string, command: string): boolean {
  return deviceType === 'door_lock' && command === 'unlock' ||
    deviceType === 'water_valve' && command === 'open' ||
    deviceType === 'stove' && command !== 'turn_off';
}

function commandOptions(deviceType: string, field: string): string[] {
  if (field === 'mode' && deviceType === 'air_conditioner') return ['auto', 'cool', 'heat', 'fan'];
  if (field === 'mode' && deviceType === 'washer') return ['normal', 'quick', 'heavy', 'delicate'];
  if (field === 'app' && deviceType === 'tv') return ['Streaming', 'HDMI 1', 'Game', 'Broadcast'];
  return [];
}

function commandMin(field: string | null): number {
  if (field === 'targetC') return 16;
  return 0;
}

function commandMax(field: string | null): number {
  if (field === 'targetC') return 30;
  if (field === 'level' || field === 'speed') return 5;
  if (field === 'volume') return 100;
  return 100;
}

function createHealthSignals(type: string, telemetry: Record<string, DeviceMetricCapability>): DeviceHealthSignal[] {
  const signals = Object.entries(telemetry).flatMap(([sourceField, metric]) => healthSignalsForMetric(type, sourceField, metric));
  if (signals.length > 0) {
    return signals;
  }
  return [{
    kind: 'staleness',
    label: 'Telemetry freshness',
    sourceField: null,
    staleAfterMinutes: 60,
    recommendation: 'Review the device if it stops reporting during an active scenario.',
    impact: healthImpactForDeviceType(type)
  }];
}

function healthSignalsForMetric(type: string, sourceField: string, metric: DeviceMetricCapability): DeviceHealthSignal[] {
  if (sourceField === 'online') {
    return [{
      kind: 'connectivity',
      label: 'Connectivity',
      sourceField,
      recommendation: 'Check connectivity or restart the device before relying on related automation.',
      impact: 'automation_reliability'
    }];
  }
  if (sourceField === 'latencyMs') {
    return [{
      kind: 'latency',
      label: 'Network latency',
      sourceField,
      normalRange: [0, 100],
      warningAbove: 100,
      alertAbove: 250,
      recommendation: 'Restart the router or inspect local network load.',
      impact: 'automation_reliability'
    }];
  }
  if (sourceField === 'batteryPercent') {
    return [{
      kind: 'battery',
      label: 'Battery level',
      sourceField,
      warningBelow: 25,
      alertBelow: 10,
      recommendation: 'Replace or recharge the battery to preserve coverage.',
      impact: healthImpactForDeviceType(type)
    }];
  }
  if (metric.normalRange) {
    return [{
      kind: 'range',
      label: `${sentenceCase(sourceField.replaceAll('_', ' '))} range`,
      sourceField,
      normalRange: [...metric.normalRange],
      warningBelow: metric.normalRange[0],
      warningAbove: metric.normalRange[1],
      recommendation: recommendationForMetric(sourceField),
      impact: healthImpactForDeviceType(type)
    }];
  }
  return [{
    kind: 'staleness',
    label: `${sentenceCase(sourceField.replaceAll('_', ' '))} freshness`,
    sourceField,
    staleAfterMinutes: 60,
    recommendation: 'Review the device if this signal stops updating.',
    impact: healthImpactForDeviceType(type)
  }];
}

function healthImpactForDeviceType(type: string): DeviceHealthImpact {
  if (type === 'door_lock' || type === 'doorbell_camera' || type === 'security_camera' || type === 'smoke_sensor') return 'security';
  if (type === 'water_flow_sensor' || type === 'water_leak_sensor' || type === 'water_valve' || type === 'sprinkler') return 'water';
  if (type === 'sleep_sensor') return 'care';
  if (type === 'air_conditioner' || type === 'temperature_humidity_sensor' || type === 'air_quality_sensor') return 'comfort';
  if (type === 'router') return 'automation_reliability';
  if (type === 'stove' || type === 'fridge' || type === 'washer' || type === 'dishwasher') return 'energy';
  return 'safety';
}

function recommendationForMetric(sourceField: string): string {
  if (sourceField.toLowerCase().includes('temperature')) return 'Adjust climate target or inspect airflow if the reading stays outside range.';
  if (sourceField.toLowerCase().includes('humidity')) return 'Check ventilation and moisture sources.';
  if (sourceField === 'pm25' || sourceField === 'co2') return 'Ventilate the room and check related automation.';
  if (sourceField.toLowerCase().includes('flow')) return 'Inspect water usage and close the valve if flow is unexpected.';
  if (sourceField.toLowerCase().includes('moisture')) return 'Inspect irrigation if soil moisture remains outside range.';
  return 'Review the related device reading.';
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

function serializeStateFields(
  stateSchema: DeviceStateSchema,
  defaultState: DeviceStatePatch,
  telemetry: Record<string, DeviceMetricCapability>
): Record<string, DeviceStateFieldMetadata> {
  return Object.fromEntries(Object.entries(stateSchema.shape).map(([name, fieldSchema]) => [
    name,
    describeStateField(fieldSchema, defaultState[name], telemetry[name])
  ]));
}

function describeStateField(
  fieldSchema: unknown,
  defaultValue: DeviceStatePatch[string] | undefined,
  metric: DeviceMetricCapability | undefined
): DeviceStateFieldMetadata {
  let current = fieldSchema;
  let required = true;
  let nullable = false;

  while (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
    if (current instanceof z.ZodOptional) {
      required = false;
    }
    if (current instanceof z.ZodNullable) {
      nullable = true;
    }
    current = current.unwrap();
  }

  const metadata: DeviceStateFieldMetadata = {
    type: stateFieldType(current),
    required
  };
  if (defaultValue !== undefined) {
    metadata.defaultValue = defaultValue;
  }
  if (metric) {
    metadata.unit = metric.unit;
    if (metric.normalRange) {
      metadata.normalRange = [...metric.normalRange];
    }
  }
  if (nullable) {
    metadata.nullable = true;
  }
  if (current instanceof z.ZodEnum) {
    metadata.enum = current.options.filter((value): value is string => typeof value === 'string');
  }
  return metadata;
}

function stateFieldType(fieldSchema: unknown): DeviceStateFieldType {
  if (fieldSchema instanceof z.ZodBoolean) return 'boolean';
  if (fieldSchema instanceof z.ZodNumber) return 'number';
  if (fieldSchema instanceof z.ZodString || fieldSchema instanceof z.ZodEnum) return 'string';
  return 'unknown';
}

function numberValue(value: DeviceStatePayload[string], fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function defaultSummary(displayName: string, state: DeviceStatePayload): string {
  return Object.keys(state).length > 0 ? 'idle' : displayName;
}

function sentenceCase(value: string): string {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1).toLowerCase()}`;
}
