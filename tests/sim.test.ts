import { describe, expect, it } from 'vitest';
import { createSimulator } from '../src/sim/engine';
import { getCatalog, getHomeDefinition } from '../src/sim/catalog';
import { getScenarioIds } from '../src/sim/scenarios';
import type { AlertCreatedEvent, AutomationTriggeredEvent, DeviceStateChangedEvent, DeviceTelemetryEvent, PersonMovedEvent, RoomId, RuleRecoveredEvent, TwinSnapshot } from '../src/shared/types';

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
    expect(events.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'remote_work_comfort')).toBe(true);
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

    expect(fridgeFactIndex).toBeGreaterThanOrEqual(0);
    expect(fridgeAlertIndex).toBeGreaterThan(fridgeFactIndex);
    expect(fridgeEvents.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'fridge_left_open')).toBe(true);
    expect(networkFactIndex).toBeGreaterThanOrEqual(0);
    expect(networkAlertIndex).toBeGreaterThan(networkFactIndex);
    expect(networkEvents.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'network_offline')).toBe(true);
    expect(snapshot.devices.fridge_01.state.doorOpen).toBe(true);
    expect(snapshot.devices.router_01.state.online).toBe(false);
  });

  it('recovers abnormality rules and lets them trigger again after cooldown', () => {
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    const firstOpen = simulator.injectAbnormality('fridge_left_open');
    const resolved = simulator.resolveAbnormality('fridge_left_open');
    const secondOpenDuringCooldown = simulator.injectAbnormality('fridge_left_open');
    const afterCooldown = simulator.advanceMinutes(5);

    expect(firstOpen.filter((event): event is AutomationTriggeredEvent => event.type === 'AutomationTriggered' && event.ruleId === 'fridge_left_open')).toHaveLength(1);
    expect(resolved.some((event): event is DeviceStateChangedEvent => event.type === 'DeviceStateChanged' && event.deviceId === 'fridge_01' && event.state.doorOpen === false)).toBe(true);
    expect(resolved.some((event): event is RuleRecoveredEvent => event.type === 'RuleRecovered' && event.ruleId === 'fridge_left_open')).toBe(true);
    expect(secondOpenDuringCooldown.some((event) => event.type === 'AutomationTriggered' && event.ruleId === 'fridge_left_open')).toBe(false);
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
