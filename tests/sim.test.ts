import { describe, expect, it } from 'vitest';
import { alertEscalationPolicies, createSimulator } from '../src/sim/engine';
import { getCatalog, getHomeDefinition } from '../src/sim/catalog';
import { getScenarioIds } from '../src/sim/scenarios';
import { getDeviceCapability } from '../src/shared/deviceRegistry';
import type { AbnormalityInjectedEvent, AlertCreatedEvent, AutomationTriggeredEvent, DeviceStateChangedEvent, DeviceTelemetryEvent, PersonMovedEvent, RoomId, RuleRecoveredEvent, TwinSnapshot } from '../src/shared/types';

describe('virtual home simulator MVP', () => {
  it('defines the MVP home shape from MVP.md', () => {
    const catalog = getCatalog();
    const homeDefinition = getHomeDefinition();

    expect(homeDefinition.building.id).toBe('default_home');
    expect(homeDefinition.floors[0].rooms).toHaveLength(9);
    expect(homeDefinition.floors[0].fixtures.devices).toHaveLength(catalog.devices.length);
    expect(catalog.rooms).toHaveLength(9);
    expect(catalog.people.filter((person) => person.kind === 'human')).toHaveLength(4);
    expect(catalog.people.filter((person) => person.kind === 'pet')).toHaveLength(1);
    expect(catalog.devices.length).toBeGreaterThan(20);
    expect(catalog.devices.map((device) => device.id)).toEqual(expect.arrayContaining([
      'doorbell_camera_01',
      'package_sensor_01',
      'robot_vacuum_01',
      'dishwasher_01',
      'router_01',
      'washer_01'
    ]));
    expect(getScenarioIds()).toEqual(['weekday_normal', 'away_day', 'night_water_leak']);
  });

  it('initializes device state from the device capability registry', () => {
    const simulator = createSimulator({ seed: 42 });
    const snapshot = simulator.getSnapshot();

    for (const device of Object.values(snapshot.devices)) {
      expect(device.state).toEqual(getDeviceCapability(device.type).defaultState);
    }
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

  it('adds an adult dinner readiness explanation across dining and kitchen devices', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(765);
    const snapshot = simulator.getSnapshot();
    const events = simulator.getEvents();
    const dinnerReadiness = events.find((event): event is AutomationTriggeredEvent => (
      event.type === 'AutomationTriggered' &&
      event.ruleId === 'family_dinner_readiness'
    ));

    expect(snapshot.people.adult_1.activity).toBe('dinner');
    expect(snapshot.devices.dining_light_01.state).toMatchObject({ power: 'on', brightness: 65 });
    expect(snapshot.devices.stove_01.state).toMatchObject({ powerW: 0, level: 0 });
    expect(snapshot.devices.fridge_01.state.doorOpen).toBe(false);
    expect(dinnerReadiness).toMatchObject({
      actions: ['confirm_fridge_closed', 'confirm_stove_safe', 'set_dining_light_for_family_dinner'],
      eventExplanation: {
        why: 'adult_1 is in evening meal with intent family dinner.',
        actorIds: ['adult_1'],
        affectedDeviceIds: ['fridge_01', 'stove_01', 'dining_light_01'],
        affectedRoomIds: ['kitchen', 'dining_room'],
        relatedIntent: 'family_time',
        expectedOutcome: 'Keep dinner comfortable while confirming kitchen appliance risk is low.'
      }
    });
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

  it('treats pet movement as low-risk motion without human occupancy', () => {
    const simulator = createSimulator({ seed: 314 });

    simulator.startScenario('away_day');
    simulator.advanceMinutes(20);
    const snapshot = simulator.getSnapshot();
    const events = simulator.getEvents();
    const petRoomId = snapshot.people.pet_1.location as RoomId;

    expect(snapshot.homeState.occupancyCount).toBe(0);
    expect(snapshot.rooms[petRoomId].people).toContain('pet_1');
    expect(snapshot.rooms[petRoomId].humanOccupancy).toBe(false);
    expect(snapshot.rooms[petRoomId].motionDetected).toBe(true);
    expect(events.some((event) => event.type === 'DeviceStateChanged' && event.reason?.includes('pet_motion'))).toBe(true);
  });

  it('pauses garden watering when the pet enters the sprinkler zone', () => {
    const simulator = createSimulator({ seed: 1 });

    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(258);
    const snapshot = simulator.getSnapshot();
    const events = simulator.getEvents();

    expect(events.some((event): event is PersonMovedEvent => (
      event.type === 'PersonMoved' &&
      event.personId === 'pet_1' &&
      event.to === 'garden' &&
      event.simTime === '2026-06-17T10:18:00+08:00'
    ))).toBe(true);
    expect(snapshot.devices.sprinkler_01.state.valveOpen).toBe(false);
    expect(events.some((event): event is DeviceStateChangedEvent => (
      event.type === 'DeviceStateChanged' &&
      event.deviceId === 'sprinkler_01' &&
      event.state.valveOpen === false &&
      event.reason === 'habit:pet_1:garden:sprinkler_pause'
    ))).toBe(true);
    expect(events.some((event): event is AutomationTriggeredEvent => (
      event.type === 'AutomationTriggered' &&
      event.ruleId === 'pet_garden_sprinkler_pause'
    ))).toBe(true);
  });

  it('applies remote-work habits to study comfort and network state', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(90);
    const snapshot = simulator.getSnapshot();
    const events = simulator.getEvents();

    expect(snapshot.people.adult_2.activity).toBe('remote_work');
    expect(snapshot.devices.router_01.state.latencyMs).toBeGreaterThan(18);
    expect(snapshot.devices.study_co2_01.state.co2).toBeGreaterThan(650);
    expect(snapshot.rooms.study.lightsOn).toBe(true);
    const remoteWork = events.find((event): event is AutomationTriggeredEvent => event.type === 'AutomationTriggered' && event.ruleId === 'remote_work_comfort');
    expect(remoteWork).toBeDefined();
    expect(remoteWork?.actions).toEqual(expect.arrayContaining([
      'prioritize_router_for_video_calls',
      'enable_focus_notification_policy'
    ]));
    expect(remoteWork?.eventExplanation).toMatchObject({
      affectedDeviceIds: expect.arrayContaining(['study_co2_01', 'router_01']),
      relatedIntent: 'focused_remote_work'
    });
  });

  it('applies a commuter arrival scene when adult 1 gets home', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(605);
    const snapshot = simulator.getSnapshot();
    const events = simulator.getEvents();

    expect(snapshot.people.adult_1.activity).toBe('arrived_home');
    expect(events.some((event): event is DeviceStateChangedEvent => (
      event.type === 'DeviceStateChanged' &&
      event.deviceId === 'living_light_01' &&
      event.state.brightness === 58 &&
      event.reason === 'habit:adult_1:arrived_home:arrival_scene'
    ))).toBe(true);
    expect(snapshot.devices.living_light_01.state).toMatchObject({ power: 'on', brightness: 32 });
    expect(snapshot.devices.living_curtain_01.state.positionPercent).toBe(35);
    expect(events.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'commuter_arrival_scene')).toBe(true);
  });

  it('tracks distinct behavior context for each person from their routine state', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(605);
    const snapshot = simulator.getSnapshot();

    expect(snapshot.people.adult_1.behavior).toMatchObject({
      routinePhase: 'evening_return',
      intent: 'decompress_after_commute',
      attentionTarget: 'living_room',
      energy: 55
    });
    expect(snapshot.people.adult_2.behavior).toMatchObject({
      routinePhase: 'workday',
      intent: 'focused_remote_work',
      attentionTarget: 'router_01',
      energy: 70
    });
    expect(snapshot.people.child_1.behavior).toMatchObject({
      routinePhase: 'after_school',
      intent: 'finish_homework',
      attentionTarget: 'child_bedroom',
      energy: 62
    });
  });

  it('applies a child homework focus scene without waiting for manual device control', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(605);
    const snapshot = simulator.getSnapshot();
    const events = simulator.getEvents();

    expect(snapshot.people.child_1.activity).toBe('homework');
    expect(snapshot.devices.child_sleep_01.state.inBed).toBe(false);
    expect(snapshot.devices.tv_01.state).toMatchObject({ power: 'off', volume: 0 });
    expect(snapshot.devices.living_light_01.state).toMatchObject({ power: 'on', brightness: 32 });
    expect(events.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'child_homework_focus')).toBe(true);
  });

  it('attaches structured causal explanations to behavior-driven automation events', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(605);
    const events = simulator.getEvents();
    const homeworkFocus = events.find((event) => event.type === 'AutomationTriggered' && event.ruleId === 'child_homework_focus');

    expect(homeworkFocus).toMatchObject({
      eventExplanation: {
        why: 'child_1 is in after_school with intent finish_homework.',
        actorIds: ['child_1'],
        affectedDeviceIds: ['child_sleep_01', 'tv_01', 'living_light_01'],
        affectedRoomIds: ['child_bedroom', 'living_room'],
        relatedIntent: 'finish_homework',
        expectedOutcome: 'Reduce entertainment distraction while the student finishes homework.'
      }
    });
  });

  it('applies a senior garden care routine while preserving pet sprinkler safety', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startDailyScenario({ date: '2026-10-14', seed: 42 });
    simulator.advanceMinutes(680);
    const snapshot = simulator.getSnapshot();
    const events = simulator.getEvents();

    expect(['gardening', 'plant_care']).toContain(snapshot.people.senior_1.activity);
    expect(events.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'senior_garden_care')).toBe(true);
    expect(events.some((event): event is DeviceStateChangedEvent => (
      event.type === 'DeviceStateChanged' &&
      event.deviceId === 'sprinkler_01' &&
      event.state.valveOpen === true &&
      event.reason === 'habit:senior_1:gardening:garden_care'
    ))).toBe(true);
    expect(events.some((event): event is DeviceStateChangedEvent => (
      event.type === 'DeviceStateChanged' &&
      event.deviceId === 'garden_soil_01' &&
      typeof event.state.moisturePercent === 'number' &&
      event.reason === 'habit:senior_1:gardening:soil_check'
    ))).toBe(true);
    expect(events.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'pet_garden_sprinkler_pause')).toBe(true);
    expect(snapshot.devices.sprinkler_01.state.valveOpen).toBe(false);
  });

  it('moves appliances through running and waiting-to-unload lifecycle states', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    simulator.commandDevice('dishwasher_01', 'start');
    expect(simulator.getSnapshot().devices.dishwasher_01.state).toMatchObject({
      status: 'running',
      remainingMin: 45,
      powerW: 620
    });

    simulator.advanceMinutes(45);
    const snapshot = simulator.getSnapshot();
    const events = simulator.getEvents();

    expect(snapshot.devices.dishwasher_01.state).toMatchObject({
      status: 'waiting_unload',
      remainingMin: 0,
      powerW: 2
    });
    expect(snapshot.alerts.dishwasher_cycle_done).toMatchObject({
      message: 'Dishwasher is waiting to be unloaded',
      recommendedAction: 'empty_dishwasher'
    });
    expect(events.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'dishwasher_waiting_unload')).toBe(true);
  });

  it('raises a senior wellness signal when morning activity does not start', () => {
    const simulator = createSimulator({ seed: 9 });

    simulator.startScenario('night_water_leak');
    simulator.advanceMinutes(180);
    const snapshot = simulator.getSnapshot();
    const events = simulator.getEvents();

    expect(snapshot.alerts.senior_inactive_001).toMatchObject({
      severity: 'info',
      roomId: 'master_bedroom',
      recommendedAction: 'check_in_with_senior'
    });
    expect(events.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'senior_wellness_check')).toBe(true);
  });

  it('adds a senior morning support rule before inactivity becomes an alert', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(35);
    const snapshot = simulator.getSnapshot();
    const events = simulator.getEvents();
    const support = events.find((event): event is AutomationTriggeredEvent => (
      event.type === 'AutomationTriggered' &&
      event.ruleId === 'senior_morning_support'
    ));

    expect(snapshot.people.senior_1.activity).toBe('morning_rest');
    expect(snapshot.devices.master_ac_01.state).toMatchObject({ power: 'on', targetC: 25, mode: 'auto' });
    expect(snapshot.devices.master_sleep_01.state).toMatchObject({ inBed: true, heartRateSimulated: 62 });
    expect(support).toMatchObject({
      actions: ['set_bedroom_comfort_for_senior', 'watch_sleep_activity_sensor', 'prepare_family_check_in'],
      eventExplanation: {
        why: 'senior_1 is still in morning rest, so the twin prepares a gentle support path before raising an alert.',
        actorIds: ['senior_1'],
        affectedDeviceIds: ['master_ac_01', 'master_sleep_01'],
        affectedRoomIds: ['master_bedroom'],
        relatedIntent: 'steady_routine',
        expectedOutcome: 'Keep the bedroom comfortable while making a family check-in easy if activity stays low.'
      }
    });
  });

  it('adds seeded random household events beyond scheduled scenario steps', () => {
    const simulator = createSimulator({ seed: 2026 });

    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(360);
    const snapshot = simulator.getSnapshot();
    const events = simulator.getEvents();
    const randomRuleIds = events
      .filter((event): event is AutomationTriggeredEvent => event.type === 'AutomationTriggered')
      .map((event) => event.ruleId);

    expect(randomRuleIds).toEqual(expect.arrayContaining([
      expect.stringMatching(/^(package_delivery|robot_cleaning|dishwasher_cycle|washer_cycle|network_jitter)$/)
    ]));
    expect(Object.keys(snapshot.devices)).toEqual(expect.arrayContaining([
      'doorbell_camera_01',
      'package_sensor_01',
      'robot_vacuum_01',
      'dishwasher_01',
      'router_01',
      'washer_01'
    ]));
  });

  it('keeps random household events deterministic for the same seed', () => {
    const first = createSimulator({ seed: 2027 });
    const second = createSimulator({ seed: 2027 });

    first.startScenario('weekday_normal');
    second.startScenario('weekday_normal');

    first.advanceMinutes(360);
    second.advanceMinutes(360);

    const randomEvents = (simulator: ReturnType<typeof createSimulator>) => simulator.getEvents()
      .filter((event): event is AutomationTriggeredEvent => event.type === 'AutomationTriggered' && ['package_delivery', 'robot_cleaning', 'dishwasher_cycle', 'washer_cycle', 'network_jitter'].includes(event.ruleId))
      .map((event) => ({ ruleId: event.ruleId, simTime: event.simTime, actions: event.actions }));

    expect(randomEvents(first)).toEqual(randomEvents(second));
    expect(first.getSnapshot().devices).toEqual(second.getSnapshot().devices);
  });

  it('continues deterministically after restoring from a checkpoint with replayed events', () => {
    const uninterrupted = createSimulator({ seed: 2028 });
    uninterrupted.startScenario('weekday_normal');
    const uninterruptedEvents = uninterrupted.advanceMinutes(120);
    const uninterruptedSnapshot = uninterrupted.getSnapshot();

    const checkpointed = createSimulator({ seed: 2028 });
    checkpointed.startScenario('weekday_normal');
    checkpointed.advanceMinutes(60);
    const checkpointSnapshot = checkpointed.getSnapshot();
    const checkpointEvents = checkpointed.getEvents();

    const restored = createSimulator({ seed: 2028 });
    restored.restore(checkpointSnapshot, checkpointEvents);
    const restoredFutureEvents = restored.advanceMinutes(60);
    const restoredSnapshot = restored.getSnapshot();

    expect(stripRunIdentity(restoredFutureEvents)).toEqual(stripRunIdentity(uninterruptedEvents.slice(checkpointEvents.length)));
    expect(stripRunIdentity(restoredSnapshot)).toEqual(stripRunIdentity(uninterruptedSnapshot));
    expect(restoredSnapshot.runContext.rngState).toBe(uninterruptedSnapshot.runContext.rngState);
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

  it('keeps room occupants and whole-home occupancy count consistent across scenarios', () => {
    const simulator = createSimulator({ seed: 4242 });
    const checkpoints = [
      { scenario: 'weekday_normal' as const, minutes: [0, 1, 12, 90, 720] },
      { scenario: 'away_day' as const, minutes: [0, 20, 120] },
      { scenario: 'night_water_leak' as const, minutes: [0, 1, 10, 180] }
    ];

    for (const checkpoint of checkpoints) {
      simulator.startScenario(checkpoint.scenario);
      for (const minutes of checkpoint.minutes) {
        if (minutes > 0) {
          simulator.advanceMinutes(minutes);
        }
        expectSnapshotOccupancyConsistent(simulator.getSnapshot());
      }
    }
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

  it('injects abnormalities as device facts before rules create alerts', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    const fridgeEvents = simulator.injectAbnormality('fridge_left_open');
    const networkEvents = simulator.injectAbnormality('network_offline');
    const snapshot = simulator.getSnapshot();

    const fridgeFactIndex = fridgeEvents.findIndex((event): event is DeviceStateChangedEvent => (
      event.type === 'DeviceStateChanged' &&
      event.deviceId === 'fridge_01' &&
      event.state.doorOpen === true &&
      event.reason === 'abnormality:fridge_left_open'
    ));
    const fridgeAlertIndex = fridgeEvents.findIndex((event): event is AlertCreatedEvent => (
      event.type === 'AlertCreated' &&
      event.alertId === 'fridge_left_open_001' &&
      event.reason === 'rule:fridge_left_open'
    ));
    const networkFactIndex = networkEvents.findIndex((event): event is DeviceStateChangedEvent => (
      event.type === 'DeviceStateChanged' &&
      event.deviceId === 'router_01' &&
      event.state.online === false &&
      event.reason === 'abnormality:network_offline'
    ));
    const networkAlertIndex = networkEvents.findIndex((event): event is AlertCreatedEvent => (
      event.type === 'AlertCreated' &&
      event.alertId === 'network_offline_001' &&
      event.reason === 'rule:network_offline'
    ));
    const networkSourceIndex = networkEvents.findIndex((event): event is AbnormalityInjectedEvent => (
      event.type === 'AbnormalityInjected' &&
      event.kind === 'network_offline' &&
      event.affectedEntities.includes('router_01') &&
      event.reason === 'abnormality:network_offline'
    ));

    expect(fridgeFactIndex).toBeGreaterThanOrEqual(0);
    expect(fridgeAlertIndex).toBeGreaterThan(fridgeFactIndex);
    expect(fridgeEvents.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'fridge_left_open')).toBe(true);
    expect(networkSourceIndex).toBe(0);
    expect(networkFactIndex).toBeGreaterThanOrEqual(0);
    expect(networkFactIndex).toBeGreaterThan(networkSourceIndex);
    expect(networkAlertIndex).toBeGreaterThan(networkFactIndex);
    expect(networkEvents.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'network_offline')).toBe(true);
    expect(snapshot.devices.fridge_01.state.doorOpen).toBe(true);
    expect(snapshot.devices.router_01.state.online).toBe(false);
  });

  it('recovers abnormality rules and lets them trigger again after cooldown', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    const firstOpen = simulator.injectAbnormality('fridge_left_open');
    expect(simulator.getSnapshot().alerts.fridge_left_open_001.status).toBe('active');
    const resolved = simulator.resolveAbnormality('fridge_left_open');
    expect(simulator.getSnapshot().alerts.fridge_left_open_001).toMatchObject({
      status: 'resolved',
      resolvedAt: '2026-06-17T06:20:00+08:00'
    });
    const secondOpenDuringCooldown = simulator.injectAbnormality('fridge_left_open');
    const afterCooldown = simulator.advanceMinutes(5);

    expect(firstOpen.filter((event): event is AutomationTriggeredEvent => event.type === 'AutomationTriggered' && event.ruleId === 'fridge_left_open')).toHaveLength(1);
    expect(resolved.some((event): event is DeviceStateChangedEvent => event.type === 'DeviceStateChanged' && event.deviceId === 'fridge_01' && event.state.doorOpen === false)).toBe(true);
    expect(resolved.some((event): event is RuleRecoveredEvent => event.type === 'RuleRecovered' && event.ruleId === 'fridge_left_open')).toBe(true);
    expect(secondOpenDuringCooldown.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'fridge_left_open')).toBe(false);
    expect(afterCooldown.filter((event): event is AutomationTriggeredEvent => event.type === 'AutomationTriggered' && event.ruleId === 'fridge_left_open')).toHaveLength(1);
    expect(simulator.getSnapshot().alerts.fridge_left_open_001.status).toBe('active');
  });

  it('closes the fridge as a person-operated recovery storyline', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(45);
    simulator.injectAbnormality('fridge_left_open');
    const closeEvents = simulator.commandDevice('fridge_01', 'close') ?? [];
    const snapshot = simulator.getSnapshot();

    expect(closeEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'PersonMoved',
        to: 'kitchen',
        activity: 'controlling_fridge_01',
        reason: 'operator:approach_device:fridge_01:close'
      }),
      expect.objectContaining({
        type: 'DeviceStateChanged',
        deviceId: 'fridge_01',
        state: expect.objectContaining({ doorOpen: false, powerW: 90 }),
        reason: 'operator:device_command:close'
      }),
      expect.objectContaining({
        type: 'RuleRecovered',
        ruleId: 'fridge_left_open'
      })
    ]));
    expect(snapshot.alerts.fridge_left_open_001.status).toBe('resolved');
  });

  it('walks through connected rooms before operating a device in another room', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(605);
    simulator.injectAbnormality('fridge_left_open');
    const closeEvents = simulator.commandDevice('fridge_01', 'close') ?? [];

    const personMoves = closeEvents.filter((event): event is PersonMovedEvent => event.type === 'PersonMoved');
    expect(personMoves.map((event) => [event.from, event.to, event.activity, event.travelMinutes])).toEqual([
      ['living_room', 'dining_room', 'walking_to_fridge_01', 1],
      ['dining_room', 'kitchen', 'controlling_fridge_01', 1],
      ['kitchen', 'dining_room', 'returning_to_living_room', 1],
      ['dining_room', 'living_room', 'arrived_home', 1]
    ]);
    expect(simulator.getSnapshot().people.adult_1.behavior).toMatchObject({
      routinePhase: 'evening_return',
      intent: 'decompress_after_commute',
      attentionTarget: 'living_room'
    });
  });

  it('assigns increasing simulated times to each movement segment during device operation', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(605);
    simulator.injectAbnormality('fridge_left_open');
    const closeEvents = simulator.commandDevice('fridge_01', 'close') ?? [];

    const movementTimes = closeEvents
      .filter((event): event is PersonMovedEvent => event.type === 'PersonMoved' && event.personId === 'adult_1')
      .map((event) => event.simTime.slice(11, 16));

    expect(movementTimes).toEqual(['16:26', '16:27', '16:28', '16:29']);
    expect(simulator.getSnapshot().simClock.currentTime).toContain('16:29:00');
  });

  it('moves fridge door alerts through still-open and recovered lifecycle phases', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.injectAbnormality('fridge_left_open');
    expect(simulator.getSnapshot().devices.fridge_01.state).toMatchObject({
      lifecyclePhase: 'opened'
    });

    simulator.advanceMinutes(2);
    expect(simulator.getSnapshot().devices.fridge_01.state).toMatchObject({
      lifecyclePhase: 'still_open',
      doorOpen: true
    });

    simulator.commandDevice('fridge_01', 'close');
    expect(simulator.getSnapshot().devices.fridge_01.state).toMatchObject({
      lifecyclePhase: 'recovered',
      doorOpen: false,
      powerW: 90
    });
  });

  it('escalates a long-open fridge into alert phase with energy and kitchen temperature impact', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.injectAbnormality('fridge_left_open');
    const events = simulator.advanceMinutes(5);
    const snapshot = simulator.getSnapshot();

    expect(snapshot.devices.fridge_01.state).toMatchObject({
      doorOpen: true,
      lifecyclePhase: 'alert',
      openMinutes: 5
    });
    expect(Number(snapshot.devices.fridge_01.state.powerW)).toBeGreaterThan(156);
    expect(snapshot.devices.kitchen_temp_01.state.temperatureC).toBeGreaterThan(25);
    expect(snapshot.alerts.fridge_left_open_001).toMatchObject({
      severity: 'high',
      status: 'active'
    });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'AutomationTriggered',
        ruleId: 'fridge_left_open_escalated',
        eventExplanation: expect.objectContaining({
          affectedDeviceIds: ['fridge_01', 'kitchen_temp_01'],
          affectedRoomIds: ['kitchen'],
          relatedIntent: 'close_fridge'
        })
      })
    ]));
  });

  it('uses configurable alert escalation policies for fridge high severity thresholds', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.injectAbnormality('fridge_left_open');
    simulator.advanceMinutes(alertEscalationPolicies.fridge_left_open.highSeverityAfterOpenMinutes);
    const snapshot = simulator.getSnapshot();

    expect(alertEscalationPolicies.fridge_left_open).toMatchObject({
      deviceId: 'fridge_01',
      lifecyclePhase: 'alert',
      highSeverityAfterOpenMinutes: 5
    });
    expect(snapshot.alerts.fridge_left_open_001.severity).toBe('high');
    expect(snapshot.devices.fridge_01.state.lifecyclePhase).toBe(alertEscalationPolicies.fridge_left_open.lifecyclePhase);
  });

  it('registers alert policies for core abnormality rules instead of hardcoding severities', () => {
    expect(alertEscalationPolicies).toMatchObject({
      door_left_open: {
        alertId: 'door_left_open_001',
        initialSeverity: 'warning',
        recommendedAction: 'check_front_door'
      },
      fridge_left_open: {
        alertId: 'fridge_left_open_001',
        initialSeverity: 'warning',
        recommendedAction: 'close_fridge_door'
      },
      network_offline: {
        alertId: 'network_offline_001',
        initialSeverity: 'warning',
        recommendedAction: 'restart_router'
      },
      senior_no_activity: {
        alertId: 'senior_no_activity_001',
        initialSeverity: 'info',
        recommendedAction: 'check_in_with_senior'
      }
    });
  });

  it('restarts the router as a person-operated recovery storyline', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    simulator.advanceMinutes(605);
    simulator.injectAbnormality('network_offline');
    const restartEvents = simulator.commandDevice('router_01', 'restart') ?? [];
    const snapshot = simulator.getSnapshot();

    expect(restartEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'PersonMoved',
        personId: 'adult_2',
        to: 'study',
        activity: 'controlling_router_01',
        reason: 'operator:approach_device:router_01:restart'
      }),
      expect.objectContaining({
        type: 'DeviceStateChanged',
        deviceId: 'router_01',
        state: expect.objectContaining({ online: false, latencyMs: 0, lifecyclePhase: 'restarting' }),
        reason: 'operator:device_command:restart'
      })
    ]));
    expect(restartEvents.some((event) => event.type === 'RuleRecovered' && event.ruleId === 'network_offline')).toBe(false);
    expect(snapshot.alerts.network_offline_001.status).toBe('active');
    expect(snapshot.people.adult_2.behavior).toMatchObject({
      intent: 'focused_remote_work',
      attentionTarget: 'router_01'
    });
  });

  it('moves router outages through restarting, reconnecting, and recovered phases over time', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.injectAbnormality('network_offline');
    expect(simulator.getSnapshot().devices.router_01.state).toMatchObject({
      lifecyclePhase: 'offline',
      online: false
    });

    const restartEvents = simulator.commandDevice('router_01', 'restart') ?? [];
    expect(restartEvents.filter((event): event is DeviceStateChangedEvent => event.type === 'DeviceStateChanged' && event.deviceId === 'router_01').map((event) => event.state.lifecyclePhase)).toEqual([
      'restarting'
    ]);

    const reconnectingEvents = simulator.advanceMinutes(1);
    expect(reconnectingEvents.filter((event): event is DeviceStateChangedEvent => event.type === 'DeviceStateChanged' && event.deviceId === 'router_01').map((event) => event.state.lifecyclePhase)).toEqual([
      'reconnecting'
    ]);
    expect(simulator.getSnapshot().alerts.network_offline_001.status).toBe('active');

    const recoveredEvents = simulator.advanceMinutes(1);
    expect(recoveredEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'DeviceStateChanged',
        deviceId: 'router_01',
        state: expect.objectContaining({ lifecyclePhase: 'recovered', online: true, latencyMs: 18 })
      }),
      expect.objectContaining({
        type: 'RuleRecovered',
        ruleId: 'network_offline'
      })
    ]));
    expect(simulator.getSnapshot().devices.router_01.state).toMatchObject({
      lifecyclePhase: 'recovered',
      online: true,
      latencyMs: 18
    });
  });

  it('records degraded router prewarning before a network outage goes offline', () => {
    const simulator = createSimulator({ seed: 42 });

    const events = simulator.injectAbnormality('network_offline');

    expect(events.filter((event): event is DeviceStateChangedEvent => event.type === 'DeviceStateChanged' && event.deviceId === 'router_01').map((event) => event.state.lifecyclePhase)).toEqual([
      'degraded',
      'offline'
    ]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'AutomationTriggered',
        ruleId: 'network_degraded',
        eventExplanation: expect.objectContaining({
          affectedDeviceIds: ['router_01'],
          affectedRoomIds: ['study'],
          relatedIntent: 'focused_remote_work'
        })
      })
    ]));
    expect(simulator.getSnapshot().devices.router_01.state).toMatchObject({
      lifecyclePhase: 'offline',
      online: false
    });
  });

  it('moves television through on, watching, paused, and off lifecycle phases', () => {
    const simulator = createSimulator({ seed: 42 });

    const turnOn = simulator.commandDevice('tv_01', 'turn_on') ?? [];
    expect(turnOn).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'DeviceStateChanged',
        deviceId: 'tv_01',
        state: expect.objectContaining({ power: 'on', lifecyclePhase: 'on' })
      })
    ]));

    simulator.commandDevice('tv_01', 'set_input', 'Streaming');
    expect(simulator.getSnapshot().devices.tv_01.state).toMatchObject({
      power: 'on',
      app: 'Streaming',
      lifecyclePhase: 'watching'
    });

    simulator.commandDevice('tv_01', 'pause');
    expect(simulator.getSnapshot().devices.tv_01.state).toMatchObject({
      power: 'on',
      lifecyclePhase: 'paused',
      volume: 0
    });

    simulator.commandDevice('tv_01', 'turn_off');
    expect(simulator.getSnapshot().devices.tv_01.state).toMatchObject({
      power: 'off',
      app: null,
      lifecyclePhase: 'off'
    });
  });

  it('moves robot vacuum through cleaning, stuck, assisted, resumed, and docked phases', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.commandDevice('robot_vacuum_01', 'start');
    expect(simulator.getSnapshot().devices.robot_vacuum_01.state).toMatchObject({
      status: 'cleaning',
      cycleMinutes: 0
    });

    const stuckEvents = simulator.advanceMinutes(3);
    expect(simulator.getSnapshot().devices.robot_vacuum_01.state).toMatchObject({
      status: 'stuck',
      cycleMinutes: 3
    });
    expect(stuckEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'AlertCreated',
        alertId: 'robot_vacuum_stuck_001'
      })
    ]));

    simulator.commandDevice('robot_vacuum_01', 'assist');
    expect(simulator.getSnapshot().devices.robot_vacuum_01.state.status).toBe('assisted');

    simulator.advanceMinutes(1);
    expect(simulator.getSnapshot().devices.robot_vacuum_01.state.status).toBe('cleaning');

    simulator.advanceMinutes(3);
    expect(simulator.getSnapshot().devices.robot_vacuum_01.state).toMatchObject({
      status: 'docked',
      cycleMinutes: 0
    });
    expect(simulator.getSnapshot().alerts.robot_vacuum_stuck_001.status).toBe('resolved');
  });

  it('resolves senior no activity alerts by source rule and lets them trigger again after cooldown', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    const firstNoActivity = simulator.injectAbnormality('senior_no_activity');
    expect(simulator.getSnapshot().alerts.senior_no_activity_001).toMatchObject({
      status: 'active',
      sourceRuleId: 'senior_no_activity',
      sourceEntityIds: ['senior_1', 'master_sleep_01']
    });

    const resolved = simulator.resolveAbnormality('senior_no_activity');
    expect(simulator.getSnapshot().alerts.senior_no_activity_001).toMatchObject({
      status: 'resolved',
      resolvedAt: '2026-06-17T06:20:00+08:00'
    });

    const secondNoActivityDuringCooldown = simulator.injectAbnormality('senior_no_activity');
    simulator.resolveAbnormality('senior_no_activity');
    simulator.advanceMinutes(5);
    const afterCooldown = simulator.injectAbnormality('senior_no_activity');

    expect(firstNoActivity.filter((event): event is AutomationTriggeredEvent => event.type === 'AutomationTriggered' && event.ruleId === 'senior_no_activity')).toHaveLength(1);
    expect(resolved.some((event): event is RuleRecoveredEvent => event.type === 'RuleRecovered' && event.ruleId === 'senior_no_activity')).toBe(true);
    expect(secondNoActivityDuringCooldown.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'senior_no_activity')).toBe(false);
    expect(afterCooldown.filter((event): event is AutomationTriggeredEvent => event.type === 'AutomationTriggered' && event.ruleId === 'senior_no_activity')).toHaveLength(1);
    expect(simulator.getSnapshot().alerts.senior_no_activity_001.status).toBe('active');
  });

  it('resolves senior no activity through a family check-in visit', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    simulator.injectAbnormality('senior_no_activity');
    const resolved = simulator.resolveAbnormality('senior_no_activity');
    const snapshot = simulator.getSnapshot();

    const checkerMoves = resolved.filter((event): event is PersonMovedEvent => (
      event.type === 'PersonMoved' &&
      event.personId !== 'senior_1' &&
      event.reason === 'operator:senior_check_in:senior_no_activity'
    ));

    expect(checkerMoves.map((event) => [event.from, event.to, event.activity])).toEqual([
      ['master_bedroom', 'master_bedroom', 'checking_senior_1']
    ]);
    expect(snapshot.people.adult_1.behavior).toMatchObject({
      routinePhase: 'care_response',
      intent: 'check_on_senior',
      attentionTarget: 'senior_1'
    });
    expect(snapshot.people.senior_1.behavior).toMatchObject({
      routinePhase: 'wellness_recovery',
      intent: 'respond_to_check_in'
    });
    expect(resolved).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'AutomationTriggered',
        ruleId: 'senior_check_in_completed',
        eventExplanation: expect.objectContaining({
          actorIds: ['adult_1', 'senior_1'],
          affectedDeviceIds: ['master_sleep_01'],
          affectedRoomIds: ['master_bedroom'],
          relatedIntent: 'check_on_senior'
        })
      }),
      expect.objectContaining({
        type: 'RuleRecovered',
        ruleId: 'senior_no_activity'
      })
    ]));
    expect(snapshot.alerts.senior_no_activity_001.status).toBe('resolved');
  });

  it('restores abnormality rule cooldown before allowing the same rule to trigger again', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    simulator.injectAbnormality('fridge_left_open');
    simulator.resolveAbnormality('fridge_left_open');
    const checkpoint = simulator.getSnapshot();
    const events = simulator.getEvents();

    const restored = createSimulator({ seed: 42 });
    restored.restore(checkpoint, events);
    const duringCooldown = restored.injectAbnormality('fridge_left_open');
    const afterCooldown = restored.advanceMinutes(5);

    expect(duringCooldown.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'fridge_left_open')).toBe(false);
    expect(afterCooldown.filter((event): event is AutomationTriggeredEvent => event.type === 'AutomationTriggered' && event.ruleId === 'fridge_left_open')).toHaveLength(1);
  });

  it('rejects invalid device state fields before they enter the snapshot', () => {
    const simulator = createSimulator({ seed: 42 });
    const runtime = simulator as unknown as {
      state: {
        activeScenario: {
          steps: Array<{
            minute: number;
            actions: Array<{ kind: 'setDevice'; deviceId: string; state: Record<string, boolean>; reason: string }>;
          }>;
        };
      };
    };

    simulator.startScenario('weekday_normal');
    const originalSteps = runtime.state.activeScenario.steps;
    runtime.state.activeScenario.steps = [{
        minute: 1,
        actions: [{
          kind: 'setDevice',
          deviceId: 'fridge_01',
          state: { online: false },
          reason: 'test:invalid_fridge_state'
        }]
      }];

    try {
      expect(() => simulator.advanceMinutes(1)).toThrow(/fridge_01/);
      expect(simulator.getSnapshot().devices.fridge_01.state).not.toHaveProperty('online');
    } finally {
      runtime.state.activeScenario.steps = originalSteps;
    }
  });

  it('replays deterministically with the same scenario and random seed', () => {
    const first = createSimulator({ seed: 1234 });
    const second = createSimulator({ seed: 1234 });

    first.startScenario('weekday_normal');
    second.startScenario('weekday_normal');

    expect(stripRunFields(first.advanceMinutes(30))).toEqual(stripRunFields(second.advanceMinutes(30)));
    expect(stripRunFields(first.getSnapshot())).toEqual(stripRunFields(second.getSnapshot()));
  });

  it('keeps device state change event payloads immutable after later telemetry drift', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    const events = simulator.advanceMinutes(90);
    const studyComfortEvent = events.find((event): event is DeviceStateChangedEvent => (
      event.type === 'DeviceStateChanged' &&
      event.deviceId === 'study_co2_01' &&
      event.reason === 'habit:adult_2:remote_work:comfort'
    ));

    expect(studyComfortEvent).toBeDefined();
    expect(studyComfortEvent?.state.co2).toBe(680);
    expect(simulator.getSnapshot().devices.study_co2_01.state.co2).not.toBe(studyComfortEvent?.state.co2);
  });

  it('creates a unique run id and globally unique event ids for each scenario run', () => {
    const simulator = createSimulator({ seed: 1234 });

    const firstStart = simulator.startScenario('weekday_normal');
    const firstSnapshot = simulator.getSnapshot();
    const secondStart = simulator.startScenario('weekday_normal');
    const secondSnapshot = simulator.getSnapshot();

    expect(firstSnapshot.runId).toMatch(/^run_/);
    expect(secondSnapshot.runId).toMatch(/^run_/);
    expect(firstSnapshot.runId).not.toBe(secondSnapshot.runId);
    expect(firstStart[0].sequence).toBe(1);
    expect(secondStart[0].sequence).toBe(1);
    expect(firstStart[0].runId).toBe(firstSnapshot.runId);
    expect(secondStart[0].runId).toBe(secondSnapshot.runId);
    expect(firstStart[0].id).not.toBe(secondStart[0].id);
  });

  it('reinitializes runtime randomness for a daily run seed even after other scenarios execute', () => {
    const simulator = createSimulator({ seed: 777 });

    simulator.startDailyScenario({ date: '2026-07-14', seed: 42 });
    const firstEvents = stripRunFields(simulator.advanceMinutes(360));
    const firstSnapshot = stripRunFields(simulator.getSnapshot());

    simulator.startScenario('away_day');
    simulator.advanceMinutes(40);

    simulator.startDailyScenario({ date: '2026-07-14', seed: 42 });
    const secondEvents = stripRunFields(simulator.advanceMinutes(360));
    const secondSnapshot = stripRunFields(simulator.getSnapshot());

    expect(secondEvents).toEqual(firstEvents);
    expect(secondSnapshot).toEqual(firstSnapshot);
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

function stripRunFields<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, fieldValue) => (
    key === 'id' || key === 'runId' || key === 'startedAt' || key === 'rngState'
      ? undefined
      : fieldValue
  ))) as T;
}

function stripRunIdentity<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, fieldValue) => (
    key === 'id' || key === 'runId' || key === 'startedAt'
      ? undefined
      : fieldValue
  ))) as T;
}

function expectSnapshotOccupancyConsistent(snapshot: TwinSnapshot): void {
  const roomPeople = Object.values(snapshot.rooms).flatMap((room) => room.people);
  const peopleAtHome = Object.values(snapshot.people).filter((person) => person.location !== 'away');
  const humansAtHome = peopleAtHome.filter((person) => person.kind === 'human');

  expect(roomPeople.sort()).toEqual(peopleAtHome.map((person) => person.id).sort());
  expect(new Set(roomPeople).size).toBe(roomPeople.length);
  for (const room of Object.values(snapshot.rooms)) {
    const hasHuman = room.people.some((personId) => snapshot.people[personId]?.kind === 'human');
    expect(room.humanOccupancy).toBe(hasHuman);
    expect(room.occupancy).toBe(hasHuman);
  }
  expect(Object.values(snapshot.rooms)
    .flatMap((room) => room.people)
    .filter((personId) => snapshot.people[personId]?.kind === 'human')).toHaveLength(humansAtHome.length);
  expect(snapshot.homeState.occupancyCount).toBe(humansAtHome.length);
}
