import { describe, expect, it } from 'vitest';
import { getCatalog } from '../src/sim/catalog';
import { deviceCapabilities, getDeviceCapability, getDeviceCapabilityMetadata } from '../src/shared/deviceRegistry';

describe('device capability registry', () => {
  it('defines display and state rules for every catalog device type', () => {
    const catalogTypes = [...new Set(getCatalog().devices.map((device) => device.type))].sort();

    expect(Object.keys(deviceCapabilities).sort()).toEqual(catalogTypes);
    for (const type of catalogTypes) {
      const capability = getDeviceCapability(type);
      expect(capability.displayName).not.toBe('');
      expect(capability.shortLabel).not.toBe('');
      expect(capability.icon).not.toBe('');
      expect(capability.markerKind).toMatch(/^(sensor|actuator|appliance|security|lighting|climate|media|mobile|network)$/);
      expect(capability.animationHint).toMatch(/^(none|pulse|glow|rotate|vibrate|scan|airflow|waterflow|open_close|patrol)$/);
      expect(capability.visualModel).toMatch(/^(sensor_puck|wall_camera|door_lock|package_pad|light_disc|tv_screen|robot_vacuum|curtain_panel|fridge_tower|stove_top|range_hood|dishwasher_box|washer_drum|bed_sleep_pad|air_conditioner_wall|router_antennas|water_pipe_sensor|water_valve_handle|soil_probe|sprinkler_head|generic_box|generic_sphere)$/);
      expect(capability.visualScale).toBeGreaterThan(0);
      expect(capability.riskLevel).toMatch(/^(normal|confirmation|required_confirmation|privacy_sensitive|high)$/);
      expect(Object.keys(capability.commandMetadata)).toEqual(capability.supportedCommands);
      for (const command of capability.supportedCommands) {
        const metadata = capability.commandMetadata[command];
        expect(metadata?.label).not.toBe('');
        expect(metadata?.controlType).toMatch(/^(button|toggle|slider|select)$/);
        expect(metadata?.valueType).toMatch(/^(none|boolean|number|string|enum)$/);
        expect(metadata?.failureReasons).toEqual(expect.arrayContaining(['offline', 'unsupported', 'invalid_params', 'device_rejected', 'timeout']));
      }
      expect(capability.healthSignals.length).toBeGreaterThan(0);
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

  it('assigns differentiated visual models to the first device modeling batch', () => {
    expect(getDeviceCapability('tv').visualModel).toBe('tv_screen');
    expect(getDeviceCapability('fridge').visualModel).toBe('fridge_tower');
    expect(getDeviceCapability('washer').visualModel).toBe('washer_drum');
    expect(getDeviceCapability('router').visualModel).toBe('router_antennas');
    expect(getDeviceCapability('doorbell_camera').visualModel).toBe('wall_camera');
    expect(getDeviceCapability('security_camera').visualModel).toBe('wall_camera');
    expect(getDeviceCapability('light').visualModel).toBe('light_disc');
    expect(getDeviceCapability('robot_vacuum').visualModel).toBe('robot_vacuum');
    expect(getDeviceCapability('water_valve').visualModel).toBe('water_valve_handle');
    expect(getDeviceCapability('water_leak_sensor').visualModel).toBe('sensor_puck');
    expect(getDeviceCapability('sprinkler').visualModel).toBe('sprinkler_head');
  });

  it('uses specific visual classifications for category filtering', () => {
    expect(getDeviceCapability('light').markerKind).toBe('lighting');
    expect(getDeviceCapability('tv').markerKind).toBe('media');
    expect(getDeviceCapability('air_conditioner').markerKind).toBe('climate');
    expect(getDeviceCapability('router').markerKind).toBe('network');
  });

  it('uses semantic animation hints for water flow and open-close devices', () => {
    expect(getDeviceCapability('water_flow_sensor').animationHint).toBe('waterflow');
    expect(getDeviceCapability('water_leak_sensor').animationHint).toBe('waterflow');
    expect(getDeviceCapability('sprinkler').animationHint).toBe('waterflow');
    expect(getDeviceCapability('water_valve').animationHint).toBe('open_close');
    expect(getDeviceCapability('curtain').animationHint).toBe('open_close');
    expect(getDeviceCapability('door_lock').animationHint).toBe('open_close');
    expect(getDeviceCapability('fridge').animationHint).toBe('open_close');
  });

  it('uses patrol animation hints for mobile devices that move through rooms', () => {
    expect(getDeviceCapability('robot_vacuum').animationHint).toBe('patrol');
  });

  it('validates state shape per device type instead of accepting arbitrary fields', () => {
    expect(getDeviceCapability('fridge').stateSchema.safeParse({ doorOpen: true, powerW: 120 }).success).toBe(true);
    expect(getDeviceCapability('fridge').stateSchema.safeParse({ online: false, latencyMs: 0 }).success).toBe(false);
    expect(getDeviceCapability('router').stateSchema.safeParse({ online: false, latencyMs: 0 }).success).toBe(true);
    expect(getDeviceCapability('router').stateSchema.safeParse({ doorOpen: true }).success).toBe(false);
  });

  it('defines command metadata for control UI and command adapters', () => {
    expect(getDeviceCapability('light').commandMetadata.set_brightness).toMatchObject({
      label: 'Set brightness',
      controlType: 'slider',
      valueType: 'number',
      field: 'brightness',
      min: 0,
      max: 100,
      highRisk: false,
      requiresConfirmation: false
    });
    expect(getDeviceCapability('air_conditioner').commandMetadata.set_target).toMatchObject({
      label: 'Set target',
      controlType: 'slider',
      valueType: 'number',
      field: 'targetC',
      min: 16,
      max: 30
    });
    expect(getDeviceCapability('water_valve').commandMetadata.open).toMatchObject({
      label: 'Open valve',
      controlType: 'toggle',
      valueType: 'boolean',
      field: 'valveOpen',
      highRisk: true,
      requiresConfirmation: true
    });
    expect(getDeviceCapability('door_lock').commandMetadata.unlock).toMatchObject({
      label: 'Unlock door',
      field: 'locked',
      highRisk: true,
      requiresConfirmation: true
    });
    expect(getDeviceCapability('router').commandMetadata.restart).toMatchObject({
      label: 'Restart router',
      controlType: 'button',
      valueType: 'none',
      field: null,
      highRisk: false,
      requiresConfirmation: true
    });
    expect(getDeviceCapability('tv').commandMetadata.set_volume).toMatchObject({
      label: 'Set volume',
      controlType: 'slider',
      valueType: 'number',
      field: 'volume',
      min: 0,
      max: 100
    });
    expect(getDeviceCapability('tv').commandMetadata.set_input).toMatchObject({
      label: 'Set input',
      controlType: 'select',
      valueType: 'enum',
      field: 'app',
      options: ['Streaming', 'HDMI 1', 'Game', 'Broadcast']
    });
    expect(getDeviceCapability('air_conditioner').commandMetadata.set_mode).toMatchObject({
      label: 'Set mode',
      controlType: 'select',
      valueType: 'enum',
      field: 'mode',
      options: ['auto', 'cool', 'heat', 'fan']
    });
    expect(getDeviceCapability('washer').commandMetadata.set_mode).toMatchObject({
      label: 'Set mode',
      controlType: 'select',
      valueType: 'enum',
      field: 'mode',
      options: ['normal', 'quick', 'heavy', 'delicate']
    });
  });

  it('defines risk levels and health signals for operational views', () => {
    expect(getDeviceCapability('door_lock').riskLevel).toBe('high');
    expect(getDeviceCapability('water_valve').riskLevel).toBe('high');
    expect(getDeviceCapability('doorbell_camera').riskLevel).toBe('privacy_sensitive');
    expect(getDeviceCapability('router').riskLevel).toBe('confirmation');

    expect(getDeviceCapability('router').healthSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'connectivity',
        sourceField: 'online',
        impact: 'automation_reliability'
      }),
      expect.objectContaining({
        kind: 'latency',
        sourceField: 'latencyMs'
      })
    ]));
    expect(getDeviceCapability('doorbell_camera').healthSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'battery',
        sourceField: 'batteryPercent'
      })
    ]));
    expect(getDeviceCapability('temperature_humidity_sensor').healthSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'range',
        sourceField: 'temperatureC',
        normalRange: [18, 28]
      })
    ]));
  });

  it('serializes device state fields for protocol adapters', () => {
    const metadata = getDeviceCapabilityMetadata();

    expect(metadata.router.stateFields).toEqual({
      online: { type: 'boolean', required: false, defaultValue: true, unit: 'bool' },
      latencyMs: { type: 'number', required: false, defaultValue: 18, unit: 'ms' },
      lifecyclePhase: { type: 'string', required: false, defaultValue: 'online', unit: 'state' }
    });
    expect(metadata.light.stateFields.power).toEqual({
      type: 'string',
      required: false,
      defaultValue: 'off',
      unit: 'state',
      enum: ['on', 'off']
    });
    expect(metadata.tv.stateFields.app).toEqual({
      type: 'string',
      required: false,
      defaultValue: null,
      nullable: true
    });
    expect(metadata.temperature_humidity_sensor.stateFields.temperatureC).toEqual({
      type: 'number',
      required: false,
      defaultValue: 25,
      unit: 'C',
      normalRange: [18, 28]
    });
    expect(metadata.tv.visualModel).toBe('tv_screen');
    expect(metadata.router.visualModel).toBe('router_antennas');
    expect(metadata.fridge.visualScale).toBeGreaterThan(1);
    expect(metadata.router.riskLevel).toBe('confirmation');
    expect(metadata.router.commandMetadata.restart).toMatchObject({
      label: 'Restart router',
      requiresConfirmation: true
    });
    expect(metadata.router.healthSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'connectivity', sourceField: 'online' })
    ]));
  });
});
