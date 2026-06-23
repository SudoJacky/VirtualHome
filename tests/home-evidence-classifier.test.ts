import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { classifyDeviceEvidence } from '../src/web/homeEvidenceClassifier';

function deviceEvent(overrides: Partial<DeviceValueEvent> = {}): DeviceValueEvent {
  return {
    id: 'device_event_1',
    sourceEventId: 'source_event_1',
    sourceEventType: 'DeviceTelemetry',
    runId: 'run_a',
    sequence: 1,
    ts: '2026-06-22T00:00:00.000Z',
    simTime: '2026-06-22T08:00:00',
    homeId: 'home_1',
    roomId: 'living',
    deviceId: 'device_1',
    deviceType: 'sensor',
    field: 'value',
    value: true,
    ...overrides
  };
}

describe('home evidence classifier', () => {
  it('classifies active device usage as strong profile evidence', () => {
    expect(classifyDeviceEvidence(deviceEvent({
      deviceId: 'tv_01',
      deviceType: 'tv',
      field: 'power',
      value: true
    }))).toMatchObject({
      category: 'device_usage',
      strength: 'strong',
      profileWeight: 0.9
    });
  });

  it('classifies lock unlock as strong human activity evidence', () => {
    expect(classifyDeviceEvidence(deviceEvent({
      deviceId: 'front_lock_01',
      deviceType: 'door_lock',
      field: 'state',
      value: 'unlocked'
    }))).toMatchObject({
      category: 'human_activity',
      strength: 'strong',
      profileWeight: 1
    });
  });

  it('classifies motion detection as medium human activity evidence', () => {
    expect(classifyDeviceEvidence(deviceEvent({
      deviceId: 'bathroom_motion_01',
      deviceType: 'motion_sensor',
      field: 'motion',
      value: true
    }))).toMatchObject({
      category: 'human_activity',
      strength: 'medium',
      profileWeight: 0.55
    });
  });

  it('classifies appliance contact changes as medium device usage evidence', () => {
    expect(classifyDeviceEvidence(deviceEvent({
      deviceId: 'fridge_01',
      deviceType: 'fridge',
      field: 'doorOpen',
      value: true
    }))).toMatchObject({
      category: 'device_usage',
      strength: 'medium',
      profileWeight: 0.45
    });
  });

  it('classifies environment telemetry as weak profile context', () => {
    expect(classifyDeviceEvidence(deviceEvent({
      deviceId: 'living_temperature_01',
      deviceType: 'temperature_sensor',
      field: 'temperature',
      value: 25.2
    }))).toMatchObject({
      category: 'environment_context',
      strength: 'weak',
      profileWeight: 0.05
    });
  });

  it('classifies battery telemetry as ignored system status', () => {
    expect(classifyDeviceEvidence(deviceEvent({
      deviceId: 'living_temperature_01',
      deviceType: 'temperature_sensor',
      field: 'battery',
      value: 88
    }))).toMatchObject({
      category: 'system_status',
      strength: 'ignored',
      profileWeight: 0
    });
  });
});
