import type { DeviceValueEvent } from './deviceEventSocket';

export type EvidenceCategory = 'human_activity' | 'device_usage' | 'environment_context' | 'system_status';
export type EvidenceStrength = 'strong' | 'medium' | 'weak' | 'ignored';

export interface EvidenceClassification {
  category: EvidenceCategory;
  strength: EvidenceStrength;
  profileWeight: number;
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

  if (SYSTEM_FIELDS.has(field)) {
    return {
      category: 'system_status',
      strength: 'ignored',
      profileWeight: 0,
      reason: `${event.field} is system telemetry, so it is stored as fact memory but ignored for profile inference.`
    };
  }

  if (isDoorUnlock(deviceType, field, event.value)) {
    return {
      category: 'human_activity',
      strength: 'strong',
      profileWeight: 1,
      reason: 'Door unlock is a direct human activity signal.'
    };
  }

  if (isActivePowerState(field, event.value)) {
    return {
      category: 'device_usage',
      strength: 'strong',
      profileWeight: 0.9,
      reason: `${event.field} became active, which is strong device usage evidence.`
    };
  }

  if (isMotionSignal(deviceType, field, event.value)) {
    return {
      category: 'human_activity',
      strength: 'medium',
      profileWeight: 0.55,
      reason: 'Motion detection is a medium-strength presence signal.'
    };
  }

  if (isContactSignal(field, event.value)) {
    return {
      category: 'device_usage',
      strength: 'medium',
      profileWeight: 0.45,
      reason: `${event.field} changed to an active contact state, which is medium device usage evidence.`
    };
  }

  if (isPowerUsage(field, event.value)) {
    return {
      category: 'device_usage',
      strength: 'medium',
      profileWeight: 0.5,
      reason: `${event.field} is positive, which suggests active device usage.`
    };
  }

  if (ENVIRONMENT_FIELDS.has(field) || deviceType.includes('sensor')) {
    return {
      category: 'environment_context',
      strength: 'weak',
      profileWeight: 0.05,
      reason: `${event.field} is environment telemetry, so it is weak context rather than strong behavior evidence.`
    };
  }

  return {
    category: 'device_usage',
    strength: 'weak',
    profileWeight: 0.2,
    reason: `${event.field} is an observed device state, but it is not a direct human activity signal.`
  };
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

function normalize(value: string): string {
  return value.replace(/[_\s-]+/g, '').toLowerCase();
}
