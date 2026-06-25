import { describe, expect, it } from 'vitest';
import { createSimulator } from '../src/sim/engine';
import { getDeviceCapability } from '../src/shared/deviceRegistry';
import type { PersonState, RoomId, TwinSnapshot } from '../src/shared/types';
import { createDashboardModel, mergeTwinEvents } from '../src/web/viewModel';

function addSeniorToSnapshot(snapshot: TwinSnapshot, location: RoomId | 'away', activity: string): PersonState {
  const senior: PersonState = {
    id: 'senior_1',
    kind: 'human',
    location,
    activity,
    behavior: {
      routinePhase: activity === 'sleeping' ? 'sleep' : 'wellness_watch',
      intent: 'steady_routine',
      attentionTarget: location,
      energy: 44
    },
    confidence: 1,
    privacyMode: false
  };
  snapshot.people.senior_1 = senior;
  return senior;
}

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
    expect(model.floorplanRooms.master_bedroom.people.map((person) => person.id)).toEqual(['adult_1', 'adult_2']);
    expect(model.floorplanRooms.bathroom.devices.some((device) => device.id === 'water_leak_01' && device.active)).toBe(true);
    expect(model.floorplanRooms.bathroom.devices.some((device) => device.id === 'water_valve_01' && !device.active)).toBe(true);
  });

  it('does not surface senior-only UI state for the default household', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(30);

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const serialized = JSON.stringify(model);

    expect(Object.keys(simulator.getSnapshot().people)).not.toContain('senior_1');
    expect(serialized).not.toContain('senior_1');
    expect(serialized).not.toContain('senior_no_activity');
    expect(serialized).not.toContain('Senior family member');
    expect(serialized).not.toContain('Senior resident');
    expect(serialized).not.toContain('Senior inactivity');
  });

  it('hides stale senior-only events when the active household has no senior resident', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.injectAbnormality('senior_no_activity');

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const serialized = JSON.stringify(model);

    expect(Object.keys(simulator.getSnapshot().people)).not.toContain('senior_1');
    expect(serialized).not.toContain('senior_1');
    expect(serialized).not.toContain('senior_no_activity');
    expect(serialized).not.toContain('Senior family member');
    expect(serialized).not.toContain('Senior resident');
    expect(serialized).not.toContain('Senior inactivity');
  });

  it('deduplicates event streams by event id when API and WebSocket overlap', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    const events = simulator.advanceMinutes(12);

    const merged = mergeTwinEvents(events, events);

    expect(merged).toHaveLength(Math.min(events.length, 100));
    expect(new Set(merged.map((event) => event.id)).size).toBe(merged.length);
  });

  it('keeps the frontend event stream isolated to the active run', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    const firstRunEvents = simulator.advanceMinutes(12);
    const firstRunId = simulator.getSnapshot().runId;

    const secondStart = simulator.startScenario('away_day');
    const secondRunId = simulator.getSnapshot().runId;
    const merged = mergeTwinEvents(firstRunEvents, secondStart);

    expect(firstRunId).not.toBe(secondRunId);
    expect(merged).toEqual(secondStart);
    expect(merged.every((event) => event.runId === secondRunId)).toBe(true);
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

  it('labels injected abnormalities as source events in the frontend timeline', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.injectAbnormality('network_offline');

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const sourceEvent = model.recentEvents.find((event) => event.type === 'AbnormalityInjected');

    expect(sourceEvent).toMatchObject({
      label: 'Network outage injected; affected: Home Router'
    });
    expect(model.recentEvents.some((event) => event.label.includes('Home network is offline'))).toBe(true);
  });

  it('keeps resolved alerts out of active alert counts while preserving workflow history', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.injectAbnormality('fridge_left_open');
    simulator.resolveAbnormality('fridge_left_open');

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const workflow = model.alertWorkflows.find((item) => item.alertId === 'fridge_left_open_001');

    expect(model.alerts.map((alert) => alert.id)).not.toContain('fridge_left_open_001');
    expect(workflow).toMatchObject({
      lifecycleStatus: 'resolved',
      status: 'Resolved'
    });
    expect(workflow?.steps.at(-1)).toBe('Status: resolved');
  });

  it('treats legacy alerts without lifecycle status as active', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.injectAbnormality('fridge_left_open');
    const snapshot = simulator.getSnapshot();
    delete (snapshot.alerts.fridge_left_open_001 as { status?: string }).status;

    const model = createDashboardModel(snapshot, simulator.getEvents());
    const workflow = model.alertWorkflows.find((item) => item.alertId === 'fridge_left_open_001');

    expect(model.alerts.map((alert) => alert.id)).toContain('fridge_left_open_001');
    expect(workflow).toMatchObject({
      lifecycleStatus: 'active',
      status: 'Needs attention'
    });
  });

  it('labels alert status changes as readable audit timeline events', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.injectAbnormality('fridge_left_open');
    simulator.setAlertStatus('fridge_left_open_001', 'acknowledged');

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const statusEvent = model.recentEvents.find((event) => event.type === 'AlertStatusChanged');

    expect(statusEvent).toMatchObject({
      label: 'Fridge door has remained open status changed from active to acknowledged'
    });
  });

  it('explains pet-driven garden safety automation with readable facts', () => {
    const simulator = createSimulator({ seed: 1 });
    simulator.startScenario('weekday_normal');
    const snapshot = simulator.getSnapshot();
    snapshot.devices.sprinkler_01.state = { ...snapshot.devices.sprinkler_01.state, valveOpen: true };
    snapshot.devices.sprinkler_01.lastReason = 'test:sprinkler_on';
    simulator.restore(snapshot, simulator.getEvents());
    simulator.advanceMinutes(258);

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const explanation = model.automationExplanations.find((item) => item.ruleId === 'pet_garden_sprinkler_pause');

    expect(explanation).toMatchObject({
      ruleName: 'Pet garden sprinkler pause',
      matchedFacts: ['pet is in the garden sprinkler zone'],
      actions: ['pause garden sprinkler']
    });
    expect(explanation?.decisionChain[0]).toEqual({ label: 'Human activity', value: 'Pet garden activity' });
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
    expect(model.controlRecordFilters.alertSeverities).toContain('warning');
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

  it('selects a demo spotlight that can drive 3D story playback', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('night_water_leak');
    simulator.advanceMinutes(10);

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.demoSpotlight).toMatchObject({
      scenarioId: 'night_water_leak',
      kind: 'alert',
      roomId: 'bathroom',
      roomName: 'Bathroom',
      pauseMs: 2000
    });
    expect(model.demoSpotlight?.headline).toBe('Bathroom leak detected while home is sleeping');
    expect(model.demoSpotlight?.summary).toContain('close_water_valve');
  });

  it('builds a home briefing around unresolved priorities instead of raw dashboard counts', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.injectAbnormality('fridge_left_open');
    simulator.setAlertStatus('fridge_left_open_001', 'acknowledged');

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.alertStatusSummary).toMatchObject({
      new: 0,
      acknowledged: 1,
      unresolved: 1,
      resolved: 0,
      ignored: 0
    });
    expect(model.homeBriefing.status).toBe('Needs attention');
    expect(model.homeBriefing.primaryItem?.kind).toBe('alert');
    expect(model.homeBriefing.primaryItem?.headline).toBe('Fridge door has remained open');
    expect(model.homeBriefing.nextAction).toContain('Confirm');
    expect(model.alerts.map((alert) => alert.id)).toContain('fridge_left_open_001');
  });

  it('creates prediction and counterfactual cards for active household alerts', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.injectAbnormality('fridge_left_open');
    simulator.injectAbnormality('network_offline');

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.predictionCards).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'prediction:fridge_left_open_001',
        horizon: '15 min',
        title: 'Fridge door left open forecast',
        ifIgnored: expect.stringContaining('power draw'),
        ifHandledNow: expect.stringContaining('adult_1'),
        impact: 'energy',
        relatedDeviceId: 'fridge_01'
      }),
      expect.objectContaining({
        id: 'prediction:network_offline_001',
        horizon: '15 min',
        title: 'Network outage forecast',
        ifIgnored: expect.stringContaining('remote work'),
        ifHandledNow: expect.stringContaining('adult_2'),
        impact: 'automation_reliability',
        relatedDeviceId: 'router_01'
      })
    ]));
  });

  it('surfaces observation-only twin inference beside simulator truth', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(90);
    simulator.setPaused(true);
    simulator.setPaused(false);

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.twinInference.inputSummary.observationOnly).toBe(true);
    expect(model.twinInference.inputSummary.acceptedEventCount).toBeGreaterThan(0);
    expect(model.twinInference.inputSummary.rejectedEventTypes).toEqual(expect.arrayContaining(['PersonMoved', 'ActivityStarted', 'ScenarioControl']));
    expect(model.twinInference.homeMode).toMatchObject({
      truth: model.homeMode,
      inferred: expect.any(String),
      confidence: expect.any(Number)
    });
    expect(model.twinInference.people.length).toBeGreaterThan(0);
    expect(model.twinInference.people[0]).toMatchObject({
      personId: expect.any(String),
      truthRoom: expect.any(String),
      inferredRoom: expect.any(String),
      roomConfidence: expect.any(Number),
      inferredActivity: expect.any(String),
      activityConfidence: expect.any(Number)
    });
    expect(model.twinInference.forecasts.map((forecast) => forecast.horizonMinutes)).toEqual([15, 30, 60]);
    expect(model.twinInference.risks.length).toBeGreaterThan(0);
  });

  it('passes calendar context into dashboard twin inference', () => {
    const workdaySimulator = createSimulator({ seed: 42 });
    workdaySimulator.startDailyScenario({ date: '2026-07-14', seed: 42 });
    const workdaySnapshot = workdaySimulator.getSnapshot();
    workdaySnapshot.simClock.currentTime = '2026-07-14T10:30:00+08:00';

    const holidaySimulator = createSimulator({ seed: 42 });
    holidaySimulator.startDailyScenario({ date: '2026-10-01', seed: 42 });
    const holidaySnapshot = holidaySimulator.getSnapshot();
    holidaySnapshot.simClock.currentTime = '2026-10-01T10:30:00+08:00';

    const workday = createDashboardModel(workdaySnapshot, []);
    const holiday = createDashboardModel(holidaySnapshot, []);

    expect(workday.twinInference.homeMode.probabilities.away)
      .toBeGreaterThan(holiday.twinInference.homeMode.probabilities.away);
    expect(holiday.twinInference.homeMode.probabilities.evening_home)
      .toBeGreaterThan(workday.twinInference.homeMode.probabilities.evening_home);
  });

  it('exposes simulation calendar context for the dashboard header', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startDailyScenario({ date: '2026-07-14', seed: 42 });
    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.simCalendar).toMatchObject({
      date: '2026-07-14',
      dayOfWeekLabel: 'Tue',
      dayTypeLabel: 'Weekday',
      seasonLabel: 'Summer',
      schoolDayLabel: 'School day',
      fullLabel: '2026-07-14 Tue 05:11 · Summer · Weekday · School day'
    });
  });

  it('adds numeric telemetry forecast points to prediction cards', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.injectAbnormality('fridge_left_open');
    simulator.injectAbnormality('network_offline');

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const fridge = model.predictionCards.find((card) => card.id === 'prediction:fridge_left_open_001');
    const network = model.predictionCards.find((card) => card.id === 'prediction:network_offline_001');

    expect(fridge?.forecastPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metric: 'fridge_power_w',
        unit: 'W',
        ignored: [148, 164, 176, 188],
        handledNow: [148, 112, 94, 90]
      }),
      expect.objectContaining({
        metric: 'kitchen_temperature_c',
        unit: 'C',
        ignored: [25, 25.3, 25.8, 26.2],
        handledNow: [25, 25, 24.9, 24.9]
      })
    ]));
    expect(network?.forecastPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metric: 'router_latency_ms',
        unit: 'ms',
        ignored: [0, 0, 0, 0],
        handledNow: [0, 80, 32, 18]
      })
    ]));
  });

  it('backwrites prediction points into future telemetry forecast series', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.injectAbnormality('fridge_left_open');

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.forecastTelemetrySeries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'forecast:fridge_left_open_001:fridge_power_w',
        alertId: 'fridge_left_open_001',
        metric: 'fridge_power_w',
        unit: 'W',
        horizonMinutes: [0, 5, 10, 15],
        ignored: [148, 164, 176, 188],
        handledNow: [148, 112, 94, 90]
      }),
      expect.objectContaining({
        id: 'forecast:fridge_left_open_001:kitchen_temperature_c',
        alertId: 'fridge_left_open_001',
        metric: 'kitchen_temperature_c',
        unit: 'C',
        horizonMinutes: [0, 5, 10, 15],
        ignored: [25, 25.3, 25.8, 26.2],
        handledNow: [25, 25, 24.9, 24.9]
      })
    ]));
  });

  it('adds confidence intervals to forecast points and future telemetry series', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.injectAbnormality('fridge_left_open');

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const fridge = model.predictionCards.find((card) => card.id === 'prediction:fridge_left_open_001');
    const powerPoint = fridge?.forecastPoints.find((point) => point.metric === 'fridge_power_w');
    const powerSeries = model.forecastTelemetrySeries.find((series) => series.metric === 'fridge_power_w');

    expect(powerPoint?.confidenceInterval).toMatchObject({
      levelPercent: 80,
      spreadPercent: 10,
      ignoredLow: [133.2, 147.6, 158.4, 169.2],
      ignoredHigh: [162.8, 180.4, 193.6, 206.8],
      handledNowLow: [133.2, 100.8, 84.6, 81],
      handledNowHigh: [162.8, 123.2, 103.4, 99]
    });
    expect(powerSeries?.confidenceInterval).toEqual(powerPoint?.confidenceInterval);
  });

  it('uses current fridge thermal drivers for a more physical forecast curve', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.injectAbnormality('fridge_left_open');
    simulator.advanceMinutes(12);

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const fridge = model.predictionCards.find((card) => card.id === 'prediction:fridge_left_open_001');
    const powerPoint = fridge?.forecastPoints.find((point) => point.metric === 'fridge_power_w');
    const temperaturePoint = fridge?.forecastPoints.find((point) => point.metric === 'kitchen_temperature_c');

    expect(powerPoint?.ignored).toEqual([176, 188, 198, 206]);
    expect(powerPoint?.handledNow).toEqual([176, 134, 102, 90]);
    expect(temperaturePoint?.ignored).toEqual([30.4, 30.9, 31.4, 31.8]);
    expect(temperaturePoint?.handledNow).toEqual([30.4, 29.9, 29.2, 28.6]);
    expect(fridge?.forecastModel).toMatchObject({
      kind: 'fridge_thermal_load',
      season: 'summer',
      roomVolumeM3: 42,
      currentPowerW: 176,
      openMinutes: 12,
      currentTemperatureC: 30.4
    });
  });

  it('builds chart-ready forecast data for full prediction visualizations', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.injectAbnormality('fridge_left_open');

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const fridge = model.predictionCards.find((card) => card.id === 'prediction:fridge_left_open_001');

    expect(fridge?.chart).toMatchObject({
      title: 'Fridge door left open forecast',
      horizonMinutes: [0, 5, 10, 15],
      yAxisLabel: 'W / C',
      series: expect.arrayContaining([
        expect.objectContaining({
          metric: 'fridge_power_w',
          label: 'fridge power w',
          unit: 'W',
          ignored: [148, 164, 176, 188],
          handledNow: [148, 112, 94, 90]
        }),
        expect.objectContaining({
          metric: 'kitchen_temperature_c',
          label: 'kitchen temperature c',
          unit: 'C'
        })
      ])
    });
    expect(model.forecastCharts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'chart:fridge_left_open_001' })
    ]));
  });

  it('models network outage impact on video calls and notification delay', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.injectAbnormality('network_offline');

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const network = model.predictionCards.find((card) => card.id === 'prediction:network_offline_001');

    expect(network?.forecastPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metric: 'video_call_quality_score',
        unit: '%',
        ignored: [35, 25, 18, 12],
        handledNow: [35, 62, 84, 92]
      }),
      expect.objectContaining({
        metric: 'notification_delay_s',
        unit: 's',
        ignored: [90, 120, 150, 180],
        handledNow: [90, 35, 12, 5]
      }),
      expect.objectContaining({
        metric: 'automation_ack_delay_s',
        unit: 's',
        ignored: [45, 75, 110, 150],
        handledNow: [45, 18, 8, 4]
      })
    ]));
    expect(network?.forecastModel).toMatchObject({
      kind: 'router_reconnect_model',
      currentPowerW: null
    });
    expect(network?.chart.series.map((series) => series.metric)).toEqual([
      'router_latency_ms',
      'video_call_quality_score',
      'notification_delay_s',
      'automation_ack_delay_s'
    ]);
  });

  it('models senior care risk from sleep sensor state and morning time window', () => {
    const simulator = createSimulator({ seed: 42 });
    const snapshot = simulator.getSnapshot();
    addSeniorToSnapshot(snapshot, 'master_bedroom', 'morning_rest');
    simulator.restore(snapshot, simulator.getEvents());
    simulator.injectAbnormality('senior_no_activity');

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const senior = model.predictionCards.find((card) => card.id === 'prediction:senior_no_activity_001');

    expect(senior?.forecastPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metric: 'care_uncertainty_score',
        unit: '%',
        ignored: [45, 58, 72, 84],
        handledNow: [45, 22, 8, 4]
      }),
      expect.objectContaining({
        metric: 'check_in_urgency_score',
        unit: '%',
        ignored: [52, 66, 78, 88],
        handledNow: [52, 28, 12, 6]
      })
    ]));
    expect(senior?.forecastModel).toMatchObject({
      kind: 'senior_care_risk_model',
      currentTemperatureC: null,
      openMinutes: null
    });
    expect(senior?.chart.series.map((series) => series.metric)).toEqual([
      'care_uncertainty_score',
      'check_in_urgency_score'
    ]);
  });

  it('adds dynamic recovery estimates to prediction cards from current device state', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.injectAbnormality('fridge_left_open');
    simulator.advanceMinutes(12);
    simulator.injectAbnormality('network_offline');

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const fridge = model.predictionCards.find((card) => card.id === 'prediction:fridge_left_open_001');
    const network = model.predictionCards.find((card) => card.id === 'prediction:network_offline_001');

    expect(fridge?.recoveryEstimate).toMatchObject({
      operatorId: 'adult_1',
      action: 'close fridge_01',
      estimatedRecoveryMinutes: 5,
      impactReductionPercent: 56,
      confidence: 'medium'
    });
    expect(fridge?.recoveryEstimate.basis).toContain('open for 12 min');
    expect(network?.recoveryEstimate).toMatchObject({
      operatorId: 'adult_2',
      action: 'restart router_01',
      estimatedRecoveryMinutes: 4,
      impactReductionPercent: 97,
      confidence: 'high',
      basis: expect.stringContaining('offline')
    });
  });

  it('prioritizes unresolved high severity alerts over newer automation spotlights', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('night_water_leak');
    simulator.advanceMinutes(10);
    simulator.advanceMinutes(740);

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.demoSpotlight).toMatchObject({
      kind: 'alert',
      headline: 'Bathroom leak detected while home is sleeping',
      roomId: 'bathroom'
    });
  });

  it('adds actionable alert operations with replay and resolution affordances', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.injectAbnormality('network_offline');

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const workflow = model.alertWorkflows.find((item) => item.alertId === 'network_offline_001');

    expect(workflow?.actions.map((action) => action.kind)).toEqual([
      'acknowledge',
      'remind',
      'ignore',
      'evidence',
      'replay',
      'resolve'
    ]);
    expect(workflow?.recommendedAction).toBe('restart router');
    expect(workflow?.evidence.some((item) => item.includes('Home Router'))).toBe(true);
  });

  it('creates registry-driven device control cards with command controls and lifecycle state', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.injectAbnormality('network_offline');

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const router = model.deviceControlCards.find((card) => card.deviceId === 'router_01');
    const light = model.deviceControlCards.find((card) => card.deviceId === 'living_light_01');
    const doorbell = model.deviceControlCards.find((card) => card.deviceId === 'doorbell_camera_01');

    expect(router).toMatchObject({
      deviceId: 'router_01',
      displayName: 'Home Router',
      connectivity: 'offline',
      disabledReason: 'Device is offline',
      commandStatus: 'failed',
      commandTimeline: [
        expect.objectContaining({ status: 'requested' }),
        expect.objectContaining({ status: 'sent' }),
        expect.objectContaining({ status: 'failed', reason: 'abnormality:network_offline' })
      ]
    });
    expect(router?.controls[0]).toMatchObject({
      command: 'restart',
      label: 'Restart router',
      controlType: 'button',
      disabled: true,
      requiresConfirmation: true,
      failureReasons: ['offline', 'unsupported', 'invalid_params', 'device_rejected', 'timeout']
    });
    expect(light?.controls.map((control) => control.command)).toEqual(['turn_on', 'turn_off', 'set_brightness']);
    expect(light?.controls.find((control) => control.command === 'set_brightness')).toMatchObject({
      controlType: 'slider',
      field: 'brightness',
      min: 0,
      max: 100,
      requiresConfirmation: false
    });
    expect(doorbell?.controls.map((control) => control.command)).toEqual(['ring']);
    expect(model.deviceControlCards.find((card) => card.deviceId === 'water_valve_01')?.controls.find((control) => control.command === 'open')).toMatchObject({
      highRisk: true,
      requiresConfirmation: true,
      field: 'valveOpen'
    });
  });

  it('surfaces person behavior intent cards from the snapshot behavior model', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(605);

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.behaviorCards.map((card) => card.personId)).toEqual(['adult_2', 'child_1', 'adult_1', 'pet_1']);
    expect(model.behaviorCards[0]).toMatchObject({
      personId: 'adult_2',
      label: 'Hybrid work adult',
      roomName: 'Study',
      activity: 'remote work',
      routinePhase: 'workday',
      intent: 'focused remote work',
      attentionTarget: 'Home Router',
      energy: 70
    });
    expect(model.behaviorCards.find((card) => card.personId === 'child_1')).toMatchObject({
      routinePhase: 'after school',
      intent: 'finish homework',
      attentionTarget: 'Living Room'
    });
  });

  it('surfaces device lifecycle cards for appliances waiting on a person', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.commandDevice('dishwasher_01', 'start');
    simulator.advanceMinutes(45);

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());

    expect(model.deviceLifecycleCards[0]).toMatchObject({
      deviceId: 'dishwasher_01',
      displayName: 'Dishwasher',
      roomName: 'Kitchen',
      status: 'waiting unload',
      headline: 'Dishwasher needs unloading',
      nextAction: 'empty dishwasher',
      relatedAlertId: 'dishwasher_cycle_done'
    });
    expect(model.deviceLifecycleCards[0].priority).toBeGreaterThan(50);
  });

  it('summarizes causal events and behavior audit coverage for explainable simulation review', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(605);

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const homeworkCausalEvent = model.causalEvents.find((event) => event.ruleId === 'child_homework_focus');
    const childAudit = model.behaviorAudit.people.find((person) => person.personId === 'child_1');

    expect(homeworkCausalEvent).toMatchObject({
      ruleId: 'child_homework_focus',
      why: 'child_1 is in after_school with intent finish_homework.',
      actors: ['Student'],
      affectedDevices: expect.arrayContaining(['Child Sleep Sensor', 'Living Room Light', 'Living Room TV']),
      affectedRooms: ['Living Room', 'Child Bedroom'],
      relatedIntent: 'finish homework',
      expectedOutcome: 'Reduce entertainment distraction while the student finishes homework.',
      actions: ['mark child out of bed', 'turn off tv for homework', 'dim living light for homework']
    });
    expect(childAudit).toMatchObject({
      personId: 'child_1',
      intent: 'finish homework',
      routinePhase: 'after school',
      nextPlan: 'Continue finish homework near Living Room',
      memorySummary: expect.stringContaining('child_1 memory summary'),
      nextCommitment: expect.objectContaining({
        activity: 'study homework',
        roomName: 'Living Room',
        pressure: expect.any(Number),
        source: 'role'
      }),
      triggeredRules: ['Child homework focus'],
      affectsDevices: expect.arrayContaining(['Child Sleep Sensor', 'Living Room Light', 'Living Room TV'])
    });
    expect(childAudit?.nextCommitment?.pressure ?? 0).toBeGreaterThan(0);
    expect(model.behaviorAudit.recentCausalEvents[0]).toMatchObject({ ruleId: expect.any(String) });
    expect(model.behaviorAudit.consistencyWarnings).not.toContain('All household members are still sleeping after the morning routine window.');
  });

  it('keeps behavior audit commitment pressure independent of host timezone', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const simulator = createSimulator({ seed: 42 });
      simulator.startScenario('weekday_normal');
      simulator.advanceMinutes(605);

      const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
      const childAudit = model.behaviorAudit.people.find((person) => person.personId === 'child_1');

      expect(childAudit?.nextCommitment).toMatchObject({
        activity: 'study homework',
        roomName: 'Living Room',
        source: 'role'
      });
      expect(childAudit?.nextCommitment?.pressure ?? 0).toBeGreaterThan(0);
    } finally {
      process.env.TZ = originalTimezone;
    }
  });

  it('adds recent device event evidence to device control cards', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.injectAbnormality('network_offline');

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const router = model.deviceControlCards.find((card) => card.deviceId === 'router_01');

    expect(router?.lastEventAt).toMatch(/T/);
    expect(router?.recentEvents[0]).toMatchObject({
      type: 'DeviceStateChanged',
      label: 'online=false, latencyMs=0, lifecyclePhase=offline',
      reason: 'abnormality:network_offline'
    });
    expect(router?.recentEvents[0].sequence).toBeGreaterThan(0);
  });

  it('promotes telemetry into prioritized insight cards', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(780);

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const airInsight = model.insightCards.find((insight) => insight.title.includes('air quality'));

    expect(model.insightCards.length).toBeGreaterThan(0);
    expect(airInsight).toMatchObject({
      title: expect.stringContaining('air quality'),
      recommendedAction: expect.any(String),
      expectedEffect: expect.any(String)
    });
    expect(model.insightCards[0].priority).toBeGreaterThanOrEqual(model.insightCards.at(-1)?.priority ?? 0);
  });

  it('creates device health cards from registry health signals with 3D focus targets', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.injectAbnormality('network_offline');

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const routerHealth = model.deviceHealthCards.find((card) => card.deviceId === 'router_01');

    expect(routerHealth).toMatchObject({
      deviceId: 'router_01',
      displayName: 'Home Router',
      roomName: 'Study',
      signal: 'Connectivity',
      status: 'alert',
      sourceField: 'online',
      reportedValue: false,
      impact: 'automation_reliability',
      focusDeviceId: 'router_01',
      recommendedAction: 'Check connectivity or restart the device before relying on related automation.'
    });
    expect(routerHealth?.priority).toBeGreaterThan(80);
    expect(model.deviceHealthCards[0].priority).toBeGreaterThanOrEqual(model.deviceHealthCards.at(-1)?.priority ?? 0);
    expect(model.insightCards.some((insight) => insight.id === 'device-health:router_01:connectivity:online')).toBe(true);
  });

  it('keeps device health card ids unique when multiple signals share a kind', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    const snapshot = simulator.getSnapshot();
    snapshot.devices.kitchen_temp_01.state.temperatureC = 35;
    snapshot.devices.kitchen_temp_01.state.humidityPercent = 20;

    const model = createDashboardModel(snapshot, simulator.getEvents());
    const kitchenHealthCards = model.deviceHealthCards.filter((card) => card.deviceId === 'kitchen_temp_01');
    const ids = kitchenHealthCards.map((card) => card.id);

    expect(kitchenHealthCards.map((card) => card.sourceField).sort()).toEqual(['humidityPercent', 'temperatureC']);
    expect(new Set(ids)).toHaveLength(ids.length);
  });

  it('classifies health cards into maintenance actions for replacement and recovery guidance', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.injectAbnormality('network_offline');
    const snapshot = simulator.getSnapshot();
    snapshot.devices.doorbell_camera_01.state.batteryPercent = 8;

    const model = createDashboardModel(snapshot, simulator.getEvents());
    const routerHealth = model.deviceHealthCards.find((card) => card.deviceId === 'router_01' && card.kind === 'connectivity');
    const doorbellHealth = model.deviceHealthCards.find((card) => card.deviceId === 'doorbell_camera_01' && card.kind === 'battery');

    expect(routerHealth).toMatchObject({
      maintenanceAction: 'restart',
      maintenanceLabel: 'Restart or reconnect'
    });
    expect(doorbellHealth).toMatchObject({
      maintenanceAction: 'replace_or_recharge',
      maintenanceLabel: 'Replace or recharge'
    });
  });

  it('detects flat telemetry drift when a sensor reading stops changing', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(750);

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const soilDrift = model.deviceHealthCards.find((card) => card.deviceId === 'garden_soil_01' && card.kind === 'drift');

    expect(soilDrift).toMatchObject({
      displayName: 'Garden Soil',
      signal: 'Reading drift',
      sourceField: 'moisture_percent',
      maintenanceAction: 'calibrate',
      maintenanceLabel: 'Calibrate reading',
      recommendedAction: 'Calibrate the sensor or inspect whether the reading is stuck.'
    });
  });

  it('creates device health cards when recent command failures repeat', () => {
    const simulator = createSimulator({ seed: 42 });
    simulator.startScenario('weekday_normal');
    simulator.injectAbnormality('network_offline');

    const events = simulator.getEvents();
    const failedRouterEvent = events.find((event) => (
      event.type === 'DeviceStateChanged' &&
      event.deviceId === 'router_01' &&
      event.reason === 'abnormality:network_offline'
    ));
    expect(failedRouterEvent).toBeDefined();

    const repeatedFailures = [1, 2].map((offset) => ({
      ...failedRouterEvent!,
      id: `${failedRouterEvent!.id}:retry:${offset}`,
      sequence: failedRouterEvent!.sequence + offset,
      reason: `abnormality:network_offline:retry_${offset}`
    }));

    const model = createDashboardModel(simulator.getSnapshot(), [...events, ...repeatedFailures]);
    const commandFailure = model.deviceHealthCards.find((card) => card.deviceId === 'router_01' && card.kind === 'command_failure');

    expect(commandFailure).toMatchObject({
      displayName: 'Home Router',
      signal: 'Command failure rate',
      status: 'alert',
      sourceField: 'commandStatus',
      reportedValue: '3 failed commands',
      impact: 'automation_reliability',
      maintenanceAction: 'inspect',
      maintenanceLabel: 'Inspect command path',
      recommendedAction: 'Inspect command routing and device availability before relying on automations.'
    });
    expect(model.insightCards.some((insight) => insight.id === 'device-health:router_01:command_failure')).toBe(true);
  });

  it('surfaces expanded random household devices on the floorplan', () => {
    const simulator = createSimulator({ seed: 2026 });
    simulator.startScenario('weekday_normal');
    const snapshot = simulator.getSnapshot();
    snapshot.worldState.inventory.dirtyLaundryKg = 5.2;
    simulator.restore(snapshot, simulator.getEvents());
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

  it('uses registry short labels for 2D floorplan device labels', () => {
    const simulator = createSimulator({ seed: 2026 });
    simulator.startScenario('weekday_normal');

    const model = createDashboardModel(simulator.getSnapshot(), simulator.getEvents());
    const studyAirSensor = model.floorplanRooms.study.devices.find((device) => device.id === 'study_co2_01');

    expect(studyAirSensor?.label).toBe(getDeviceCapability('air_quality_sensor').shortLabel);
  });
});
