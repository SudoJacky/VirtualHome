import { describe, expect, it } from 'vitest';
import { createSimulator } from '../src/sim/engine';
import { createDashboardModel, mergeTwinEvents } from '../src/web/viewModel';

describe('dashboard view model', () => {
  it('summarizes the twin state for the React demo console', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('night_water_leak');
    simulator.advanceMinutes(10);

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.homeMode).toBe('alert');
    expect(model.occupiedRooms).toContain('Master Bedroom');
    expect(model.alerts[0].severity).toBe('high');
    expect(model.activeDeviceCount).toBeGreaterThan(0);
    expect(model.recentEvents.some((event) => event.label.includes('Bathroom leak'))).toBe(true);
    expect(model.telemetrySeries.length).toBeGreaterThan(0);
    expect(model.telemetrySeries[0].points.length).toBeGreaterThan(1);
    expect(model.floorplanRooms.master_bedroom.people.map((person) => person.id)).toEqual(['adult_1', 'adult_2', 'senior_1']);
    expect(model.floorplanRooms.bathroom.devices.some((device) => device.id === 'water_leak_01' && device.active)).toBe(true);
    expect(model.floorplanRooms.bathroom.devices.some((device) => device.id === 'water_valve_01' && !device.active)).toBe(true);
  });

  it('deduplicates event streams by event id when API and WebSocket overlap', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    const events = simulator.advanceMinutes(12);

    const merged = mergeTwinEvents(events, events);

    expect(merged).toHaveLength(events.length);
  });

  it('marks recently moved people for restrained floorplan animation', () => {
    const simulator = createSimulator({ seed: 314 });
    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(14);

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const activePeople = Object.values(model.floorplanRooms).flatMap((room) => room.people);

    expect(activePeople.some((person) => person.id === 'pet_1' && person.recent)).toBe(true);
  });

  it('surfaces expanded random household devices on the floorplan', () => {
    const simulator = createSimulator({ seed: 2026 });
    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(360);

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());

    const packageSensor = model.floorplanRooms.entrance.devices.find((device) => device.id === 'package_sensor_01');
    const robotVacuum = model.floorplanRooms.living_room.devices.find((device) => device.id === 'robot_vacuum_01');
    const washer = model.floorplanRooms.bathroom.devices.find((device) => device.id === 'washer_01');

    expect(packageSensor?.label).toBe('Package');
    expect(packageSensor?.active).toBe(true);
    expect(robotVacuum?.label).toBe('Vacuum');
    expect(robotVacuum?.active).toBe(true);
    expect(washer?.label).toBe('Washer');
    expect(washer?.active).toBe(true);
  });
});
