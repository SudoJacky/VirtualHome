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

  it('frames the simulation as an explainable household story with auditable control records', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('night_water_leak');
    simulator.advanceMinutes(10);

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.householdActivity.title).toBe('Bathroom leak response');
    expect(model.householdActivity.summary).toContain('Bathroom leak detected');
    expect(model.householdActivity.participants).toContain('Commuter adult');

    expect(model.controlRecords[0]).toMatchObject({
      deviceId: 'water_valve_01',
      deviceName: 'Main Water Valve',
      roomName: 'Bathroom',
      ruleName: 'Close water valve on leak',
      trigger: 'Bathroom leak sensor is active while the home is sleeping.'
    });
    expect(model.controlRecords[0].action).toContain('valveOpen=false');
    expect(model.controlRecords[0].previousState).toBe('previous state not observed');
    expect(model.controlRecords[0].nextState).toContain('valveOpen=false');
    expect(model.controlRecords[0].scenarioId).toBe('night_water_leak');
    expect(model.controlRecords[0].people).toContain('Commuter adult');
    expect(model.controlRecords[0].alertSeverity).toBe('high');
    expect(model.controlRecords[0].payload).toMatchObject({
      eventId: model.controlRecords[0].id,
      deviceId: 'water_valve_01',
      ruleName: 'Close water valve on leak'
    });
    expect(model.controlRecords[0].reason).toContain('rule:close_water_valve_on_leak');

    expect(model.automationExplanations[0]).toMatchObject({
      ruleId: 'close_water_valve_on_leak',
      ruleName: 'Close water valve on leak',
      matchedFacts: ['water leak sensor is true'],
      actions: ['close water valve', 'raise high alert']
    });
    expect(model.automationExplanations[0].decisionChain).toEqual([
      { label: 'Human activity', value: 'Sleeping household' },
      { label: 'Sensor observation', value: 'water leak sensor is true' },
      { label: 'Rule matched', value: 'Close water valve on leak' },
      { label: 'Device command', value: 'close water valve, raise high alert' },
      { label: 'Resulting state', value: 'Main Water Valve: valveOpen=false' }
    ]);

    expect(model.alertWorkflows[0]).toMatchObject({
      alertId: 'water_leak_001',
      title: 'Bathroom leak detected while home is sleeping',
      roomName: 'Bathroom',
      status: 'Automation responded'
    });
    expect(model.alertWorkflows[0].steps).toEqual([
      'Alert detected',
      'Automation response started',
      'Device action executed: close water valve',
      'User notification prepared: close water valve',
      'Status: waiting for manual confirmation'
    ]);
  });

  it('adds scenario cards and telemetry meaning for demo mode', () => {
    const simulator = createSimulator({ seed: 7 });
    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(750);

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.scenarioCards.map((scenario) => scenario.id)).toEqual([
      'weekday_normal',
      'away_day',
      'night_water_leak',
      'fridge_left_open',
      'door_left_open',
      'senior_no_activity',
      'network_offline',
      'kitchen_air_quality'
    ]);
    expect(model.scenarioCards[0]).toMatchObject({
      title: 'Normal weekday',
      businessValue: 'Demonstrates a realistic family day producing routine device records.'
    });
    expect(model.controlRecordFilters.rooms).toContain('Kitchen');
    expect(model.controlRecordFilters.rules).toContain('Household activity');
    expect(model.controlRecordFilters.devices).toContain('Induction Stove');
    expect(model.controlRecordFilters.people).toContain('Hybrid work adult');
    expect(model.controlRecordFilters.scenarios).toContain('weekday_normal');
    expect(model.controlRecordFilters.alertSeverities).toEqual([]);
    expect(model.controlRecordFilters.timeRange?.from).toMatch(/T/);
    expect(model.controlRecordFilters.timeRange?.to).toMatch(/T/);

    const pm25 = model.telemetrySeries.find((series) => series.id === 'pm25_01:pm25');
    expect(pm25).toBeDefined();
    expect(pm25?.currentValue).toBeGreaterThan(0);
    expect(pm25?.unit).toBe('ug/m3');
    expect(pm25?.normalRange).toEqual([0, 35]);
    expect(pm25?.thresholdStatus).toMatch(/normal|watch|alert/);
    expect(pm25?.insight).toContain('Kitchen PM2.5');
    expect(pm25?.relatedAutomation).toBe('Cooking ventilation');
  });
});
