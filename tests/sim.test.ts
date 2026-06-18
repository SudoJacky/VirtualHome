import { describe, expect, it } from 'vitest';
import { createSimulator } from '../src/sim/engine';
import { getCatalog } from '../src/sim/catalog';
import { getScenarioIds } from '../src/sim/scenarios';
import type { DeviceTelemetryEvent, PersonMovedEvent } from '../src/shared/types';

describe('virtual home simulator MVP', () => {
  it('defines the MVP home shape from MVP.md', () => {
    const catalog = getCatalog();

    expect(catalog.rooms).toHaveLength(9);
    expect(catalog.people.filter((person) => person.kind === 'human')).toHaveLength(4);
    expect(catalog.people.filter((person) => person.kind === 'pet')).toHaveLength(1);
    expect(catalog.devices.length).toBeGreaterThanOrEqual(15);
    expect(catalog.devices.length).toBeLessThanOrEqual(20);
    expect(getScenarioIds()).toEqual(['weekday_normal', 'away_day', 'night_water_leak']);
  });

  it('runs a weekday scenario where people activity drives device and telemetry events', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    const events = simulator.advanceMinutes(12);
    const snapshot = simulator.getSnapshot();

    expect(snapshot.homeState.mode).toBe('morning');
    expect(snapshot.people.adult_1.activity).toBe('breakfast');
    expect(snapshot.rooms.kitchen.people).toContain('adult_1');
    expect(snapshot.devices.kitchen_light_01.state.power).toBe('on');
    expect(events.some((event) => event.type === 'ActivityStarted' && event.activityId === 'breakfast')).toBe(true);
    expect(events.some((event) => event.type === 'DeviceTelemetry' && event.deviceId === 'kitchen_temp_01')).toBe(true);
  });

  it('enters away mode when the last person leaves home', () => {
    const simulator = createSimulator({ seed: 7 });

    simulator.startScenario('away_day');
    simulator.advanceMinutes(20);
    const snapshot = simulator.getSnapshot();
    const events = simulator.getEvents();

    expect(snapshot.homeState.occupancyCount).toBe(0);
    expect(snapshot.homeState.mode).toBe('away');
    expect(snapshot.devices.door_lock_01.state.locked).toBe(true);
    expect(snapshot.devices.living_light_01.state.power).toBe('off');
    expect(events.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'away_mode')).toBe(true);
    expect(events.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'stove_unattended_safety')).toBe(true);
    expect(snapshot.devices.stove_01.state.powerW).toBe(0);
  });

  it('turns on cooking ventilation when stove power and kitchen occupancy indicate cooking', () => {
    const simulator = createSimulator({ seed: 55 });

    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(725);
    const snapshot = simulator.getSnapshot();
    const events = simulator.getEvents();

    expect(snapshot.people.adult_2.activity).toBe('cooking_dinner');
    expect(snapshot.devices.range_hood_01.state.power).toBe('on');
    expect(snapshot.devices.range_hood_01.state.speed).toBe(2);
    expect(events.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'cooking_ventilation')).toBe(true);
  });

  it('keeps the home alive with ambient pet movement and motion sensing', () => {
    const simulator = createSimulator({ seed: 314 });

    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(90);
    const snapshot = simulator.getSnapshot();
    const events = simulator.getEvents();
    const petMoves = events.filter((event): event is PersonMovedEvent => event.type === 'PersonMoved' && event.personId === 'pet_1');

    expect(petMoves.length).toBeGreaterThanOrEqual(6);
    expect(new Set(petMoves.map((event) => event.to)).size).toBeGreaterThan(1);
    expect(snapshot.people.pet_1.location).not.toBe('away');
    expect(events.some((event) => event.type === 'DeviceStateChanged' && event.deviceType === 'motion_sensor')).toBe(true);
  });

  it('continues the weekday scenario into evening routines and sleep', () => {
    const simulator = createSimulator({ seed: 91 });

    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(1020);
    const snapshot = simulator.getSnapshot();
    const events = simulator.getEvents();

    expect(snapshot.homeState.mode).toBe('sleeping');
    expect(snapshot.people.adult_1.activity).toBe('sleeping');
    expect(snapshot.people.child_1.activity).toBe('sleeping');
    expect(snapshot.devices.tv_01.state.power).toBe('off');
    expect(events.some((event) => event.type === 'ActivityStarted' && event.activityId === 'watching_tv')).toBe(true);
    expect(events.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'sleep_mode')).toBe(true);
  });

  it('persists telemetry drift back into room and device state', () => {
    const simulator = createSimulator({ seed: 222 });

    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(30);
    const snapshot = simulator.getSnapshot();
    const values = simulator.getEvents()
      .filter((event): event is DeviceTelemetryEvent => event.type === 'DeviceTelemetry' && event.deviceId === 'kitchen_temp_01')
      .map((event) => event.measurements.temperature_c);

    expect(new Set(values).size).toBeGreaterThan(1);
    expect(snapshot.devices.kitchen_temp_01.state.temperatureC).toBe(snapshot.rooms.kitchen.temperatureC);
  });

  it('applies sleep mode when the home is sleeping', () => {
    const simulator = createSimulator({ seed: 88 });

    simulator.startScenario('night_water_leak');
    simulator.advanceMinutes(1);
    const snapshot = simulator.getSnapshot();
    const events = simulator.getEvents();

    expect(snapshot.homeState.mode).toBe('sleeping');
    expect(snapshot.devices.living_light_01.state.power).toBe('off');
    expect(events.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'sleep_mode')).toBe(true);
  });

  it('creates a high severity alert and closes the water valve during a night leak', () => {
    const simulator = createSimulator({ seed: 99 });

    simulator.startScenario('night_water_leak');
    simulator.advanceMinutes(10);
    const snapshot = simulator.getSnapshot();
    const events = simulator.getEvents();

    expect(snapshot.homeState.mode).toBe('alert');
    expect(snapshot.devices.water_valve_01.state.valveOpen).toBe(false);
    expect(snapshot.alerts.water_leak_001.severity).toBe('high');
    expect(events.some((event) => event.type === 'AlertCreated' && event.alertId === 'water_leak_001')).toBe(true);
    expect(events.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'close_water_valve_on_leak')).toBe(true);
  });

  it('replays deterministically with the same scenario and random seed', () => {
    const first = createSimulator({ seed: 1234 });
    const second = createSimulator({ seed: 1234 });

    first.startScenario('weekday_normal');
    second.startScenario('weekday_normal');

    expect(first.advanceMinutes(30)).toEqual(second.advanceMinutes(30));
    expect(first.getSnapshot()).toEqual(second.getSnapshot());
  });

  it('starts a calendar-generated daily scenario from date and seed', () => {
    const simulator = createSimulator({ seed: 777 });

    simulator.startDailyScenario({ date: '2026-07-14', seed: 42 });
    simulator.advanceMinutes(180);
    const snapshot = simulator.getSnapshot();
    const events = simulator.getEvents();

    expect(snapshot.scenarioId).toBe('daily_2026_07_14');
    expect(snapshot.simClock.currentTime.startsWith('2026-07-14')).toBe(true);
    expect(events.some((event) => event.type === 'PersonMoved' && event.personId === 'child_1' && event.to === 'away' && event.activity === 'school')).toBe(true);
    expect(events.some((event) => event.type === 'DeviceStateChanged' && event.deviceId === 'sprinkler_01' && event.state.valveOpen === true)).toBe(true);
  });
});
