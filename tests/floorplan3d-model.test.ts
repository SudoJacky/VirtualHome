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
});
