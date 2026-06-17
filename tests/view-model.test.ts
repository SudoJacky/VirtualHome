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
});
