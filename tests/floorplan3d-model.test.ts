import { describe, expect, it } from 'vitest';
import { getCatalog } from '../src/sim/catalog';
import { createSimulator } from '../src/sim/engine';
import { createFloorplan3DModel } from '../src/web/floorplan3dModel';
import { devicePoints, roomLayouts } from '../src/web/floorplanLayout';

describe('3D floorplan layout and model', () => {
  it('defines renderable layout metadata for every room and catalog device', () => {
    const catalog = getCatalog();
    const layoutRoomIds = new Set(roomLayouts.map((room) => room.id));
    const pointDeviceIds = new Set(devicePoints.map((point) => point.deviceId));

    expect([...layoutRoomIds].sort()).toEqual(catalog.rooms.map((room) => room.id).sort());
    expect([...pointDeviceIds].sort()).toEqual(catalog.devices.map((device) => device.id).sort());
    expect(roomLayouts.every((room) => room.width > 0 && room.depth > 0)).toBe(true);
    expect(roomLayouts.every((room) => room.materialKind && room.wallHeight > 0 && room.wallThickness > 0)).toBe(true);
  });

  it('maps snapshot people, active devices, and alerts onto stable 3D positions', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('night_water_leak');
    simulator.advanceMinutes(10);

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.rooms.find((room) => room.id === 'bathroom')?.alertSeverity).toBe('critical');
    expect(model.people.map((person) => person.id).sort()).toEqual(['adult_1', 'adult_2', 'child_1', 'pet_1', 'senior_1']);
    expect(model.people.every((person) => Number.isFinite(person.x) && Number.isFinite(person.z))).toBe(true);
    expect(model.devices.some((device) => device.id === 'water_leak_01' && device.active && device.abnormal)).toBe(true);
    expect(model.devices.every((device) => Number.isFinite(device.x) && Number.isFinite(device.z))).toBe(true);
  });

  it('classifies device markers and animation hints for a richer 3D scene', () => {
    const simulator = createSimulator({ seed: 2026 });
    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(360);

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.devices.find((device) => device.id === 'package_sensor_01')).toMatchObject({
      markerKind: 'sensor',
      animationHint: 'pulse'
    });
    const robotVacuum = model.devices.find((device) => device.id === 'robot_vacuum_01');
    expect(robotVacuum?.markerKind).toBe('mobile');
    expect(robotVacuum?.animationHint).toBe(robotVacuum?.statusLabel === 'cleaning' ? 'patrol' : 'pulse');
    expect(model.devices.find((device) => device.id === 'washer_01')).toMatchObject({
      markerKind: 'appliance',
      animationHint: 'vibrate'
    });
    expect(model.devices.find((device) => device.id === 'doorbell_camera_01')).toMatchObject({
      markerKind: 'security',
      animationHint: 'scan'
    });
    expect(model.devices.every((device) => device.statusLabel.length > 0)).toBe(true);
  });

  it('builds automation links for event-driven 3D highlights', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('night_water_leak');
    simulator.advanceMinutes(10);

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.automationLinks[0]).toMatchObject({
      ruleId: 'close_water_valve_on_leak',
      roomId: 'bathroom',
      sourceDeviceId: 'water_leak_01',
      targetDeviceId: 'water_valve_01',
      severity: 'critical'
    });
  });

  it('builds replay scenes that explain sensor, rule, command, and result steps', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('night_water_leak');
    simulator.advanceMinutes(10);

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.eventReplays[0]).toMatchObject({
      ruleId: 'close_water_valve_on_leak',
      roomId: 'bathroom',
      focusDeviceId: 'water_valve_01',
      sourceDeviceId: 'water_leak_01',
      targetDeviceId: 'water_valve_01'
    });
    expect(model.eventReplays[0].steps.map((step) => step.kind)).toEqual([
      'precondition',
      'sensor',
      'automation',
      'command',
      'result'
    ]);
    expect(model.eventReplays[0].steps[1]).toMatchObject({
      deviceId: 'water_leak_01',
      roomId: 'bathroom'
    });
    expect(model.eventReplays[0].steps[3]).toMatchObject({
      deviceId: 'water_valve_01',
      roomId: 'bathroom'
    });
  });

  it('keeps recent person movement paths for smooth animation', () => {
    const simulator = createSimulator({ seed: 314 });
    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(14);

    const model = createFloorplan3DModel(simulator.getSnapshot(), simulator.getEvents());
    const recentPerson = model.people.find((person) => person.recent);

    expect(recentPerson?.movementPath.length).toBeGreaterThanOrEqual(2);
    expect(recentPerson?.movementPath.every((point) => Number.isFinite(point.x) && Number.isFinite(point.z))).toBe(true);
  });
});
