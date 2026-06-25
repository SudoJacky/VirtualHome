import type { DeviceValueEvent } from './deviceEventSocket';

export type EvidenceCategory = 'human_activity' | 'device_usage' | 'environment_context' | 'system_status';
export type EvidenceStrength = 'strong' | 'medium' | 'weak' | 'ignored';
export type DeviceCapabilityType =
  | 'access_control'
  | 'presence_detection'
  | 'sleep_context'
  | 'water_flow'
  | 'climate_control'
  | 'environment_air_quality'
  | 'environment_humidity'
  | 'environment_temperature'
  | 'system_health'
  | 'power_usage'
  | 'generic_device_state';

export interface DeviceCapability {
  type: DeviceCapabilityType;
  active: boolean;
  reason: string;
}

export interface EvidenceClassification {
  category: EvidenceCategory;
  strength: EvidenceStrength;
  profileWeight: number;
  capability: DeviceCapability;
  reason: string;
}

const ENVIRONMENT_FIELDS = new Set([
  'airquality',
  'airqualityindex',
  'co2',
  'humidity',
  'illuminance',
  'lightlevel',
  'noise',
  'pm25',
  'temperature'
]);

const SYSTEM_FIELDS = new Set([
  'battery',
  'batterylevel',
  'firmware',
  'health',
  'lastseen',
  'online',
  'rssi',
  'signal'
]);

const CONTACT_FIELDS = new Set([
  'contact',
  'dooropen',
  'open',
  'windowopen'
]);

export function classifyDeviceEvidence(event: Pick<DeviceValueEvent, 'deviceType' | 'field' | 'value'>): EvidenceClassification {
  const deviceType = normalize(event.deviceType);
  const field = normalize(event.field);
  const capability = inferDeviceCapability(event);

  if (capability.type === 'system_health') {
    return {
      category: 'system_status',
      strength: 'ignored',
      profileWeight: 0,
      capability,
      reason: `${event.field} is system telemetry, so it is stored as fact memory but ignored for profile inference.`
    };
  }

  if (capability.type === 'access_control' && capability.active && isDoorUnlock(deviceType, field, event.value)) {
    return {
      category: 'human_activity',
      strength: 'strong',
      profileWeight: 1,
      capability,
      reason: 'Door unlock is a direct human activity signal.'
    };
  }

  if (capability.type === 'climate_control' && capability.active) {
    return {
      category: 'device_usage',
      strength: 'medium',
      profileWeight: 0.55,
      capability,
      reason: `${event.field} indicates active climate control.`
    };
  }

  if (capability.type === 'power_usage' && capability.active && isActivePowerState(field, event.value)) {
    return {
      category: 'device_usage',
      strength: 'strong',
      profileWeight: 0.9,
      capability,
      reason: `${event.field} became active, which is strong device usage evidence.`
    };
  }

  if (capability.type === 'presence_detection' && capability.active) {
    return {
      category: 'human_activity',
      strength: 'medium',
      profileWeight: 0.55,
      capability,
      reason: 'Motion detection is a medium-strength presence signal.'
    };
  }

  if (isContactSignal(field, event.value)) {
    return {
      category: 'device_usage',
      strength: 'medium',
      profileWeight: 0.45,
      capability,
      reason: `${event.field} changed to an active contact state, which is medium device usage evidence.`
    };
  }

  if (capability.type === 'power_usage' && capability.active) {
    return {
      category: 'device_usage',
      strength: 'medium',
      profileWeight: 0.5,
      capability,
      reason: `${event.field} is positive, which suggests active device usage.`
    };
  }

  if (isEnvironmentCapability(capability.type) || deviceType.includes('sensor')) {
    return {
      category: 'environment_context',
      strength: 'weak',
      profileWeight: 0.05,
      capability,
      reason: `${event.field} is environment telemetry, so it is weak context rather than strong behavior evidence.`
    };
  }

  return {
    category: 'device_usage',
    strength: 'weak',
    profileWeight: 0.2,
    capability,
    reason: `${event.field} is an observed device state, but it is not a direct human activity signal.`
  };
}

function inferDeviceCapability(event: Pick<DeviceValueEvent, 'deviceType' | 'field' | 'value'>): DeviceCapability {
  const deviceType = normalize(event.deviceType);
  const field = normalize(event.field);

  if (SYSTEM_FIELDS.has(field)) {
    return capability('system_health', false, `${event.field} reports device health or connectivity.`);
  }
  if (deviceType.includes('lock') || field === 'lock') {
    return capability('access_control', isActiveValue(event.value), `${event.field} controls or observes access.`);
  }
  if (isPresenceField(deviceType, field)) {
    return capability('presence_detection', isActiveValue(event.value), `${event.field} observes room presence or occupant count.`);
  }
  if (deviceType.includes('sleep') || field === 'inbed' || field === 'asleep' || field === 'sleeping') {
    return capability('sleep_context', isActiveValue(event.value), `${event.field} observes sleep or bed context.`);
  }
  if (deviceType.includes('water') || field.includes('flow') || field.includes('valve')) {
    return capability('water_flow', isActiveValue(event.value), `${event.field} observes water flow or valve state.`);
  }
  if (isClimateControl(deviceType, field, event.value)) {
    return capability('climate_control', isActiveValue(event.value), `${event.field} controls room climate.`);
  }
  if (field === 'temperature') {
    return capability('environment_temperature', true, `${event.field} reports ambient temperature.`);
  }
  if (field === 'humidity') {
    return capability('environment_humidity', true, `${event.field} reports ambient humidity.`);
  }
  if (field === 'airquality' || field === 'airqualityindex' || field === 'co2' || field === 'pm25' || field === 'noise' || field === 'illuminance' || field === 'lightlevel') {
    return capability('environment_air_quality', true, `${event.field} reports ambient context.`);
  }
  if (field === 'power' || field === 'state' || field === 'powerw' || field === 'wattage' || field === 'current') {
    return capability('power_usage', isActiveValue(event.value), `${event.field} observes power or device state.`);
  }
  return capability('generic_device_state', isActiveValue(event.value), `${event.field} is a generic observed device state.`);
}

function capability(type: DeviceCapabilityType, active: boolean, reason: string): DeviceCapability {
  return { type, active, reason };
}

function isEnvironmentCapability(type: DeviceCapabilityType): boolean {
  return type === 'environment_air_quality' || type === 'environment_humidity' || type === 'environment_temperature';
}

function isDoorUnlock(deviceType: string, field: string, value: DeviceValueEvent['value']): boolean {
  return (
    (deviceType.includes('lock') || field === 'lock' || field === 'state')
    && typeof value === 'string'
    && normalize(value) === 'unlocked'
  );
}

function isActivePowerState(field: string, value: DeviceValueEvent['value']): boolean {
  return (
    (field === 'power' || field === 'state')
    && (value === true || normalize(String(value)) === 'on')
  );
}

function isMotionSignal(deviceType: string, field: string, value: DeviceValueEvent['value']): boolean {
  return (
    (deviceType.includes('motion') || field === 'motion' || field === 'occupancy' || field === 'occupied')
    && value === true
  );
}

function isContactSignal(field: string, value: DeviceValueEvent['value']): boolean {
  return CONTACT_FIELDS.has(field) && (value === true || normalize(String(value)) === 'open');
}

function isPowerUsage(field: string, value: DeviceValueEvent['value']): boolean {
  return (field === 'powerw' || field === 'wattage' || field === 'current') && typeof value === 'number' && value > 0;
}

function isPresenceField(deviceType: string, field: string): boolean {
  return (
    deviceType.includes('motion') ||
    deviceType.includes('presence') ||
    field === 'motion' ||
    field === 'occupancy' ||
    field === 'occupied' ||
    field === 'presence' ||
    field.includes('peoplecount') ||
    field.includes('personcount') ||
    field.includes('occupancycount')
  );
}

function isClimateControl(deviceType: string, field: string, value: DeviceValueEvent['value']): boolean {
  if (
    deviceType.includes('airconditioner') ||
    deviceType.includes('thermostat') ||
    deviceType.includes('hvac') ||
    deviceType.includes('heater') ||
    deviceType.includes('cooler')
  ) {
    return true;
  }
  return field === 'mode' && (normalize(String(value)).includes('cool') || normalize(String(value)).includes('heat'));
}

function isActiveValue(value: DeviceValueEvent['value']): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value > 0;
  }
  const normalized = normalize(String(value));
  return normalized === 'on' || normalized === 'open' || normalized === 'unlocked' || normalized === 'active' || normalized === 'running' || normalized === 'true' || normalized === 'cooling' || normalized === 'heating' || normalized === 'heat' || normalized === 'cool';
}

function normalize(value: string): string {
  return value.replace(/[_\s-]+/g, '').toLowerCase();
}
