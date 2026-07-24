import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  compileHouseholdRun,
  householdTemplateDate,
  HouseholdTemplateCompileError,
  type HouseholdTemplate
} from '../src/sim/householdTemplate';
import { createSimulator } from '../src/sim/engine';
import type { LifeEventRepertoire } from '../src/sim/lifeEventRepertoire';
import type { DeviceBehaviorModule } from '../src/sim/deviceBehavior';
import { coreAutomationPolicyModule, type AutomationPolicyModule } from '../src/sim/automationPolicy';
import { createServer } from '../src/server/app';
import { loadHouseholdTemplateFromFile } from '../src/server/householdTemplateLoader';

function normalizeRunIdentity<T extends { runId: string }>(value: T): T {
  return JSON.parse(JSON.stringify(value).replaceAll(value.runId, 'run_replay')) as T;
}

function studioTemplate(): HouseholdTemplate {
  return {
    schemaVersion: 'virtualhome.household/v1',
    id: 'night_nurse_studio',
    version: '1.0.0',
    name: 'Night Nurse Studio',
    home: {
      building: { id: 'night_nurse_home', name: 'Night Nurse Home' },
      floors: [{
        id: 'floor_main',
        name: 'Main Floor',
        level: 1,
        rooms: [
          { id: 'foyer_a', name: 'Foyer', type: 'entry', connectedRooms: ['lounge_a'], purposes: ['arrival'] },
          { id: 'lounge_a', name: 'Lounge', type: 'living', connectedRooms: ['foyer_a', 'sleeping_a', 'office_a', 'galley_a'], purposes: ['relaxing', 'dining'] },
          { id: 'sleeping_a', name: 'Sleeping Room', type: 'bedroom', connectedRooms: ['lounge_a'], purposes: ['sleeping'] },
          { id: 'office_a', name: 'Office Nook', type: 'work', connectedRooms: ['lounge_a'], purposes: ['working'] },
          { id: 'galley_a', name: 'Galley', type: 'utility', connectedRooms: ['lounge_a'], purposes: ['food_preparation'] }
        ],
        fixtures: {
          devices: [
            { id: 'lock_front_custom', roomId: 'foyer_a', type: 'door_lock', name: 'Front Lock', metrics: ['locked'] },
            { id: 'cold_box_custom', roomId: 'galley_a', type: 'fridge', name: 'Cold Box', metrics: ['door_open', 'power_w'] },
            { id: 'sleep_pad_custom', roomId: 'sleeping_a', type: 'sleep_sensor', name: 'Sleep Pad', metrics: ['in_bed'] }
          ]
        }
      }],
      topology: {
        connections: [
          { from: 'foyer_a', to: 'lounge_a' },
          { from: 'lounge_a', to: 'sleeping_a' },
          { from: 'lounge_a', to: 'office_a' },
          { from: 'lounge_a', to: 'galley_a' }
        ]
      }
    },
    residents: [{
      id: 'resident_nurse',
      kind: 'human',
      role: 'commuter nurse',
      homeMember: true,
      profile: {
        role: 'commuter',
        ageBand: 'adult',
        chronotype: 'late',
        sleepNeedHours: 7.5,
        mealRegularity: 0.65,
        chorePreference: 0.45,
        riskSensitivity: 0.7,
        sociability: 0.55,
        mobility: 'active',
        primaryRooms: ['sleeping_a', 'lounge_a'],
        deviceFamiliarity: { lock_front_custom: 0.9 },
        careResponsibilities: []
      }
    }],
    environment: {
      timezone: 'Asia/Singapore',
      utcOffset: '+08:00',
      weather: {
        mode: 'fixed',
        condition: 'heavy_rain',
        outdoorTemperatureC: 27,
        precipitationMm: 18
      }
    },
    repertoires: [{ id: 'core_household', version: '1.0.0' }],
    behaviors: [{ id: 'core_device_physics', version: '1.0.0' }],
    automation: { id: 'core_household_automation', version: '1.0.0' },
    habits: [
      {
        id: 'return_after_shift',
        repertoire: 'core_household',
        activity: 'return_home',
        residentIds: ['resident_nurse'],
        recurrence: 'workdays',
        window: { start: '07:20', end: '07:40' },
        roomPurpose: 'arrival'
      },
      {
        id: 'morning_meal',
        repertoire: 'core_household',
        activity: 'meal',
        residentIds: ['resident_nurse'],
        recurrence: 'daily',
        window: { start: '08:00', end: '08:15' },
        roomPurpose: 'dining'
      },
      {
        id: 'day_sleep',
        repertoire: 'core_household',
        activity: 'sleep',
        residentIds: ['resident_nurse'],
        recurrence: 'daily',
        window: { start: '09:00', end: '09:10' },
        roomPurpose: 'sleeping'
      }
    ]
  };
}

describe('household template compiler', () => {
  it('deterministically compiles arbitrary entity ids into a life plan', () => {
    const template = studioTemplate();
    const first = compileHouseholdRun(template, { date: '2026-07-15', seed: 42 });
    const second = compileHouseholdRun(template, { date: '2026-07-15', seed: 42 });

    expect(first).toEqual(second);
    expect(first.templateDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.homeDefinition.building.id).toBe('night_nurse_home');
    expect(first.environmentSnapshot.weather).toEqual({
      condition: 'heavy_rain',
      outdoorTemperatureC: 27,
      precipitationMm: 18
    });

    const actions = first.lifePlan.steps.flatMap((step) => step.actions);
    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'movePerson', personId: 'resident_nurse', to: 'foyer_a', activity: 'returned_home' }),
      expect.objectContaining({ kind: 'setDevice', deviceId: 'lock_front_custom', state: { locked: false } }),
      expect.objectContaining({ kind: 'setDevice', deviceId: 'cold_box_custom', state: { doorOpen: true } }),
      expect.objectContaining({ kind: 'movePerson', personId: 'resident_nurse', to: 'sleeping_a', activity: 'sleeping' }),
      expect.objectContaining({ kind: 'setDevice', deviceId: 'sleep_pad_custom', state: { inBed: true } })
    ]));
  });

  it('reports all detectable compatibility failures before producing a plan', () => {
    const template = studioTemplate();
    template.habits.push({
      id: 'missing_worker',
      repertoire: 'core_household',
      activity: 'remote_work',
      residentIds: ['missing_resident'],
      recurrence: 'daily',
      window: { start: '10:00', end: '09:00' },
      roomPurpose: 'missing_purpose'
    });

    try {
      compileHouseholdRun(template, { date: '2026-07-15', seed: 42 });
      throw new Error('expected compilation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(HouseholdTemplateCompileError);
      expect((error as HouseholdTemplateCompileError).issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'MISSING_REFERENCE', message: 'missing resident missing_resident' }),
        expect.objectContaining({ code: 'INVALID_WINDOW' }),
        expect.objectContaining({ code: 'UNSATISFIED_AFFORDANCE' })
      ]));
    }
  });

  it('rejects low-level actions instead of executing template code', () => {
    const template = studioTemplate() as HouseholdTemplate & { actions?: unknown[] };
    template.actions = [{ kind: 'setDevice', deviceId: 'lock_front_custom', state: { locked: false } }];

    expect(() => compileHouseholdRun(template, { date: '2026-07-15', seed: 42 }))
      .toThrow(/Unrecognized key: "actions"/);
  });

  it('executes a compiled household run through the existing event pipeline', () => {
    const run = compileHouseholdRun(studioTemplate(), { date: '2026-07-15', seed: 42 });
    const simulator = createSimulator({ seed: 42, homeDefinition: run.homeDefinition });

    const started = simulator.startCompiledHouseholdRun(run);
    const events = simulator.advanceMinutes(10 * 60);

    expect(started).toHaveLength(1);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'PersonMoved', personId: 'resident_nurse', to: 'foyer_a' }),
      expect.objectContaining({ type: 'DeviceStateChanged', deviceId: 'lock_front_custom' }),
      expect.objectContaining({ type: 'DeviceStateChanged', deviceId: 'cold_box_custom' }),
      expect.objectContaining({ type: 'DeviceStateChanged', deviceId: 'sleep_pad_custom' })
    ]));
    expect(events.every((event) => event.lineage && event.sourceLayer)).toBe(true);
  });

  it('grounds generic meal and remote-work habits in template device events', () => {
    const template = studioTemplate();
    template.home.floors[0].fixtures.devices.push(
      { id: 'cooktop_custom', roomId: 'galley_a', type: 'stove', name: 'Cooktop', metrics: ['power_w', 'level'] },
      { id: 'ventilator_custom', roomId: 'galley_a', type: 'range_hood', name: 'Ventilator', metrics: ['power', 'speed'] },
      { id: 'office_light_custom', roomId: 'office_a', type: 'light', name: 'Office Light', metrics: ['power', 'brightness'] },
      { id: 'network_hub_custom', roomId: 'office_a', type: 'router', name: 'Network Hub', metrics: ['online', 'latency_ms'] }
    );
    template.habits.push({
      id: 'remote_shift_admin',
      repertoire: 'core_household',
      activity: 'remote_work',
      residentIds: ['resident_nurse'],
      recurrence: 'daily',
      window: { start: '11:00', end: '11:10' },
      roomId: 'office_a'
    });

    const run = compileHouseholdRun(template, { date: '2026-07-15', seed: 42 });
    const actions = run.lifePlan.steps.flatMap((step) => step.actions);

    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'setDevice',
        deviceId: 'cooktop_custom',
        state: { powerW: 700, level: 4 }
      }),
      expect.objectContaining({
        kind: 'setDevice',
        deviceId: 'ventilator_custom',
        state: { power: 'on', speed: 2 }
      }),
      expect.objectContaining({
        kind: 'setDevice',
        deviceId: 'office_light_custom',
        state: { power: 'on', brightness: 70 }
      }),
      expect.objectContaining({
        kind: 'setDevice',
        deviceId: 'network_hub_custom',
        state: { online: true, latencyMs: 24 }
      })
    ]));
  });

  it('runs abnormalities and device lifecycles against template device IDs', () => {
    const template = studioTemplate();
    template.home.floors[0].fixtures.devices.push(
      { id: 'entry_camera_custom', roomId: 'foyer_a', type: 'doorbell_camera', name: 'Entry Camera', metrics: ['motion'] },
      { id: 'network_hub_custom', roomId: 'office_a', type: 'router', name: 'Network Hub', metrics: ['online', 'latency_ms'] }
    );
    const run = compileHouseholdRun(template, { date: '2026-07-15', seed: 42 });
    const simulator = createSimulator({ seed: 42, homeDefinition: run.homeDefinition });
    simulator.startCompiledHouseholdRun(run);

    const fridgeEvents = simulator.injectAbnormality('fridge_left_open');
    expect(fridgeEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'AbnormalityInjected',
        affectedEntities: ['cold_box_custom']
      }),
      expect.objectContaining({ type: 'DeviceStateChanged', deviceId: 'cold_box_custom' })
    ]));
    const injected = fridgeEvents.find((event) => event.type === 'AbnormalityInjected');
    const fridgeChanged = fridgeEvents.find((event) => event.type === 'DeviceStateChanged' && event.deviceId === 'cold_box_custom');
    const fridgeAlert = fridgeEvents.find((event) => event.type === 'AlertCreated' && event.sourceRuleId === 'fridge_left_open');
    expect(fridgeChanged?.lineage.causeEventIds).toContain(injected?.id);
    expect(fridgeAlert?.lineage.causeEventIds).toContain(fridgeChanged?.id);
    simulator.advanceMinutes(5);
    expect(simulator.getSnapshot().devices.cold_box_custom.state).toMatchObject({
      doorOpen: true,
      lifecyclePhase: 'alert',
      openMinutes: 5
    });
    expect(simulator.commandDevice('cold_box_custom', 'close')).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'RuleRecovered', ruleId: 'fridge_left_open' })
    ]));

    expect(simulator.injectAbnormality('door_left_open')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'AbnormalityInjected',
        affectedEntities: ['lock_front_custom', 'entry_camera_custom']
      })
    ]));
    expect(simulator.resolveAbnormality('door_left_open')).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'DeviceStateChanged', deviceId: 'lock_front_custom', state: { locked: true } }),
      expect.objectContaining({ type: 'DeviceStateChanged', deviceId: 'entry_camera_custom', state: { motion: false, ringing: false } })
    ]));

    expect(simulator.injectAbnormality('network_offline')).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'DeviceStateChanged', deviceId: 'network_hub_custom', state: expect.objectContaining({ online: false }) })
    ]));
    simulator.commandDevice('network_hub_custom', 'restart');
    simulator.advanceMinutes(2);
    expect(simulator.getSnapshot().devices.network_hub_custom.state).toMatchObject({
      online: true,
      lifecyclePhase: 'recovered'
    });
  });

  it('fails clearly when an injected abnormality requires a missing capability', () => {
    const run = compileHouseholdRun(studioTemplate(), { date: '2026-07-15', seed: 42 });
    const simulator = createSimulator({ seed: 42, homeDefinition: run.homeDefinition });
    simulator.startCompiledHouseholdRun(run);

    expect(() => simulator.injectAbnormality('door_left_open'))
      .toThrow(/no doorbell_camera device in room foyer_a/);
  });

  it('restores only with the same template identity and environment snapshot', () => {
    const run = compileHouseholdRun(studioTemplate(), { date: '2026-07-15', seed: 42 });
    const simulator = createSimulator({ seed: 42, homeDefinition: run.homeDefinition });
    simulator.startCompiledHouseholdRun(run);
    simulator.advanceMinutes(8 * 60 + 20);
    const checkpoint = simulator.getSnapshot();
    const history = simulator.getEvents();

    const restored = createSimulator({ seed: 99, homeDefinition: run.homeDefinition });
    restored.restoreCompiledHouseholdRun(run, checkpoint, history);
    const resumedEvents = restored.advanceMinutes(80);

    expect(resumedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'DeviceStateChanged', deviceId: 'sleep_pad_custom', state: { inBed: true } })
    ]));

    const changedTemplate = studioTemplate();
    changedTemplate.version = '2.0.0';
    const changedRun = compileHouseholdRun(changedTemplate, { date: '2026-07-15', seed: 42 });
    expect(() => restored.restoreCompiledHouseholdRun(changedRun, checkpoint, history))
      .toThrow(/templateVersion, templateDigest/);

    const changedBehaviorRun = structuredClone(run);
    changedBehaviorRun.behaviorVersions.core_device_physics = '2.0.0';
    expect(() => restored.restoreCompiledHouseholdRun(changedBehaviorRun, checkpoint, history))
      .toThrow(/behaviorVersions/);
  });

  it('replays deterministically across fresh runs and checkpoint restoration', () => {
    const run = compileHouseholdRun(studioTemplate(), { date: '2026-07-15', seed: 42 });
    const first = createSimulator({ seed: 1, homeDefinition: run.homeDefinition });
    const second = createSimulator({ seed: 999, homeDefinition: run.homeDefinition });
    first.startCompiledHouseholdRun(run);
    second.startCompiledHouseholdRun(run);
    const firstEvents = first.advanceMinutes(10 * 60);
    const secondEvents = second.advanceMinutes(10 * 60);

    expect(secondEvents.map(normalizeRunIdentity)).toEqual(firstEvents.map(normalizeRunIdentity));

    const checkpointSource = createSimulator({ seed: 7, homeDefinition: run.homeDefinition });
    checkpointSource.startCompiledHouseholdRun(run);
    checkpointSource.advanceMinutes(5 * 60);
    const checkpoint = checkpointSource.getSnapshot();
    const history = checkpointSource.getEvents();
    const restored = createSimulator({ seed: 123, homeDefinition: run.homeDefinition });
    restored.restoreCompiledHouseholdRun(run, checkpoint, history);
    const restoredTail = restored.advanceMinutes(5 * 60);
    const uninterruptedTail = firstEvents.filter((event) => event.sequence > checkpoint.simClock.sequence);

    expect(restoredTail.map(normalizeRunIdentity)).toEqual(uninterruptedTail.map(normalizeRunIdentity));
  });

  it('runs the configured household template through the server daily endpoint', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-household-template-'));
    const server = createServer({
      databasePath: path.join(dir, 'twin.db'),
      autoTick: false,
      householdTemplate: studioTemplate()
    });

    try {
      const home = await server.inject({ method: 'GET', url: '/api/home-definition' });
      expect(home.json().building.id).toBe('night_nurse_home');

      const staticScenario = await server.inject({ method: 'POST', url: '/api/scenarios/weekday_normal/start' });
      expect(staticScenario.statusCode).toBe(404);

      const started = await server.inject({
        method: 'POST',
        url: '/api/daily/start',
        payload: { date: '2026-07-15', seed: 42 }
      });
      expect(started.statusCode).toBe(200);
      expect(started.json().snapshot.runContext.householdRun).toMatchObject({
        templateId: 'night_nurse_studio',
        templateVersion: '1.0.0',
        date: '2026-07-15'
      });

      const advanced = await server.inject({
        method: 'POST',
        url: '/api/control/advance',
        payload: { minutes: 600 }
      });
      expect(advanced.statusCode).toBe(200);
      expect(advanced.json().events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'DeviceStateChanged', deviceId: 'cold_box_custom' }),
        expect.objectContaining({ type: 'DeviceStateChanged', deviceId: 'sleep_pad_custom' })
      ]));

      const publicState = (await server.inject({ method: 'GET', url: '/api/state?privacy=public' })).json();
      const publicEvents = (await server.inject({ method: 'GET', url: '/api/events?limit=500&privacy=public' })).json();
      expect(publicState.people).toEqual({});
      expect(publicState.devices.lock_front_custom.state).toEqual({});
      expect(publicState.devices.sleep_pad_custom.state).toEqual({});
      expect(publicEvents.some((event: { type: string }) => event.type === 'PersonMoved')).toBe(false);
    } finally {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the checked-in example templates executable', () => {
    const examples = [
      { file: 'night-nurse-studio.json', date: '2026-07-15' },
      { file: 'default-family-apartment.json', date: '2026-07-15' },
      { file: 'default-family-apartment.json', date: '2026-07-18' }
    ];

    for (const example of examples) {
      const input = loadHouseholdTemplateFromFile(path.join(
        process.cwd(),
        'examples',
        'household-templates',
        example.file
      ));
      expect(compileHouseholdRun(input, { date: example.date, seed: 42 }).lifePlan.steps.length)
        .toBeGreaterThan(0);
    }
  });

  it('runs the default-family example through a weekday routine', () => {
    const input = loadHouseholdTemplateFromFile(path.join(
      process.cwd(),
      'examples',
      'household-templates',
      'default-family-apartment.json'
    ));
    const run = compileHouseholdRun(input, { date: '2026-07-15', seed: 42 });
    const simulator = createSimulator({ seed: 42, homeDefinition: run.homeDefinition });
    simulator.startCompiledHouseholdRun(run);
    const events = simulator.advanceMinutes(9 * 60);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'PersonMoved', personId: 'adult_1', to: 'away' }),
      expect.objectContaining({ type: 'PersonMoved', personId: 'adult_2', to: 'study', activity: 'remote_work' }),
      expect.objectContaining({ type: 'DeviceStateChanged', deviceId: 'fridge_01' }),
      expect.objectContaining({ type: 'DeviceStateChanged', deviceId: 'door_lock_01' })
    ]));
  });

  it('derives the automatic run date in the template timezone', () => {
    const template = studioTemplate();

    expect(householdTemplateDate(template, new Date('2026-07-14T16:30:00Z'))).toBe('2026-07-15');
    template.environment.timezone = 'Not/A_Timezone';
    expect(() => householdTemplateDate(template, new Date('2026-07-14T16:30:00Z')))
      .toThrow(/environment.timezone/);
  });

  it('validates the compile date and timezone offset before planning', () => {
    const template = studioTemplate();
    template.environment.utcOffset = '+09:00';

    expect(() => compileHouseholdRun(template, { date: '2026-07-15', seed: 42 }))
      .toThrow(/Asia\/Singapore uses \+08:00.*not \+09:00/);
    expect(() => compileHouseholdRun(studioTemplate(), { date: '2026-02-30', seed: 42 }))
      .toThrow(/request.date: invalid calendar date/);
  });

  it('keeps the compiled run clock in the template timezone while advancing', () => {
    const template = studioTemplate();
    template.environment.timezone = 'Asia/Tokyo';
    template.environment.utcOffset = '+09:00';
    const run = compileHouseholdRun(template, { date: '2026-07-15', seed: 42 });
    const simulator = createSimulator({ seed: 42, homeDefinition: run.homeDefinition });

    simulator.startCompiledHouseholdRun(run);
    simulator.advanceMinutes(1);

    expect(simulator.getSnapshot().simClock.currentTime).toBe('2026-07-15T00:01:00+09:00');

    const dstTemplate = studioTemplate();
    dstTemplate.environment.timezone = 'America/New_York';
    dstTemplate.environment.utcOffset = '-05:00';
    const dstRun = compileHouseholdRun(dstTemplate, { date: '2026-03-08', seed: 42 });
    const dstSimulator = createSimulator({ seed: 42, homeDefinition: dstRun.homeDefinition });

    dstSimulator.startCompiledHouseholdRun(dstRun);
    dstSimulator.advanceMinutes(2 * 60);

    expect(dstSimulator.getSnapshot().simClock.currentTime).toBe('2026-03-08T03:00:00-04:00');
  });

  it('resolves a soil sensor sprinkler by room and device type instead of a default device id', () => {
    const input = loadHouseholdTemplateFromFile(path.join(
      process.cwd(),
      'examples',
      'household-templates',
      'default-family-apartment.json'
    ));
    const template = JSON.parse(JSON.stringify(input).replaceAll('sprinkler_01', 'garden_irrigation_custom'));
    const run = compileHouseholdRun(template, { date: '2026-07-15', seed: 42 });
    const simulator = createSimulator({ seed: 42, homeDefinition: run.homeDefinition });

    simulator.startCompiledHouseholdRun(run);
    const events = simulator.advanceMinutes(1);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'DeviceTelemetry', deviceId: 'garden_soil_01' })
    ]));
  });

  it('uses resident chronotype, sleep need, and meal regularity when scheduling habits', () => {
    const earlyTemplate = studioTemplate();
    earlyTemplate.habits.push({
      id: 'wake_for_shift',
      repertoire: 'core_household',
      activity: 'wake_up',
      residentIds: ['resident_nurse'],
      recurrence: 'daily',
      window: { start: '05:00', end: '08:00' },
      roomPurpose: 'sleeping'
    });
    earlyTemplate.habits.find((habit) => habit.id === 'day_sleep')!.window = { start: '20:00', end: '23:00' };
    earlyTemplate.habits.find((habit) => habit.id === 'morning_meal')!.window = { start: '08:00', end: '10:00' };
    earlyTemplate.residents[0].profile!.chronotype = 'early';
    earlyTemplate.residents[0].profile!.sleepNeedHours = 6;
    earlyTemplate.residents[0].profile!.mealRegularity = 0;

    const lateTemplate = structuredClone(earlyTemplate);
    lateTemplate.residents[0].profile!.chronotype = 'late';
    lateTemplate.residents[0].profile!.sleepNeedHours = 10;
    lateTemplate.residents[0].profile!.mealRegularity = 1;

    const earlyRun = compileHouseholdRun(earlyTemplate, { date: '2026-07-15', seed: 42 });
    const lateRun = compileHouseholdRun(lateTemplate, { date: '2026-07-15', seed: 42 });
    const minuteForHabit = (run: typeof earlyRun, habitId: string): number => run.lifePlan.steps.find((step) => (
      step.actions.some((action) => action.kind === 'startActivity' && action.reason === `habit:${habitId}`)
    ))!.minute;

    expect(minuteForHabit(earlyRun, 'wake_for_shift')).toBeLessThan(minuteForHabit(lateRun, 'wake_for_shift'));
    expect(minuteForHabit(lateRun, 'day_sleep')).toBeLessThan(minuteForHabit(earlyRun, 'day_sleep'));
    expect(Math.abs(minuteForHabit(lateRun, 'morning_meal') - 9 * 60))
      .toBeLessThan(Math.abs(minuteForHabit(earlyRun, 'morning_meal') - 9 * 60));
  });

  it('adds a new life event through a trusted versioned repertoire module', () => {
    let receivedResidentId: string | undefined;
    let receivedWeather: string | undefined;
    let receivedSeed: number | undefined;
    const wellnessRepertoire: LifeEventRepertoire = {
      id: 'wellness',
      version: '2.1.0',
      activities: {
        meditate: {
          preferredRoomType: 'living',
          compile: ({ habit, minute, room, residents, environment, seed }) => {
            receivedResidentId = residents[0]?.id;
            receivedWeather = environment.weather.condition;
            receivedSeed = seed;
            return [{
              minute,
              actions: [
                ...habit.residentIds.map((personId) => ({
                  kind: 'movePerson' as const,
                  personId,
                  to: room.id,
                  activity: 'meditating'
                })),
                {
                  kind: 'startActivity' as const,
                  activityId: `wellness:meditate:${habit.id}`,
                  participants: habit.residentIds,
                  roomId: room.id,
                  reason: `habit:${habit.id}`
                }
              ]
            }];
          }
        }
      }
    };
    const template = studioTemplate();
    template.repertoires.push({ id: 'wellness', version: '2.1.0' });
    template.habits.push({
      id: 'after_shift_meditation',
      repertoire: 'wellness',
      activity: 'meditate',
      residentIds: ['resident_nurse'],
      recurrence: 'daily',
      window: { start: '08:30', end: '08:30' },
      roomPurpose: 'relaxing'
    });

    expect(() => compileHouseholdRun(template, { date: '2026-07-15', seed: 42 }))
      .toThrow(/wellness@2.1.0 is not installed/);

    const run = compileHouseholdRun(
      template,
      { date: '2026-07-15', seed: 42 },
      { repertoires: [wellnessRepertoire] }
    );
    expect(run.repertoireVersions).toEqual({ core_household: '1.0.0', wellness: '2.1.0' });
    expect(receivedResidentId).toBe('resident_nurse');
    expect(receivedWeather).toBe('heavy_rain');
    expect(receivedSeed).toBeTypeOf('number');
    expect(run.lifePlan.steps.flatMap((step) => step.actions)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'startActivity',
        activityId: 'wellness:meditate:after_shift_meditation',
        roomId: 'lounge_a'
      })
    ]));
  });

  it('rejects an activity that its selected repertoire version does not define', () => {
    const template = studioTemplate();
    template.habits[0].activity = 'teleport';

    expect(() => compileHouseholdRun(template, { date: '2026-07-15', seed: 42 }))
      .toThrow(/does not define activity teleport/);
  });

  it('adds versioned device physics through a trusted behavior module', () => {
    const lightBehavior: DeviceBehaviorModule = {
      id: 'circadian_lighting',
      version: '3.0.0',
      implementation: 'effects',
      deviceTypes: ['light'],
      replaces: ['core_device_physics'],
      advance: ({ elapsedMinutes, devices }) => elapsedMinutes === 1
        ? devices
          .filter((device) => device.type === 'light')
          .map((device) => ({
            kind: 'setDeviceState' as const,
            deviceId: device.id,
            state: { power: 'on', brightness: 35 },
            reason: 'circadian_evening_level'
          }))
        : []
    };
    const template = studioTemplate();
    template.home.floors[0].fixtures.devices.push({
      id: 'lounge_lamp_custom',
      roomId: 'lounge_a',
      type: 'light',
      name: 'Lounge Lamp',
      metrics: ['power', 'brightness']
    });
    template.behaviors.push({ id: 'circadian_lighting', version: '3.0.0' });

    expect(() => compileHouseholdRun(template, { date: '2026-07-15', seed: 42 }))
      .toThrow(/circadian_lighting@3.0.0 is not installed/);

    const run = compileHouseholdRun(
      template,
      { date: '2026-07-15', seed: 42 },
      { behaviors: [lightBehavior] }
    );
    expect(run.behaviorVersions).toEqual({
      core_device_physics: '1.0.0',
      circadian_lighting: '3.0.0'
    });
    const missingRuntimeModule = createSimulator({ seed: 42, homeDefinition: run.homeDefinition });
    expect(() => missingRuntimeModule.startCompiledHouseholdRun(run))
      .toThrow(/requires device behavior module circadian_lighting@3.0.0/);

    const simulator = createSimulator({
      seed: 42,
      homeDefinition: run.homeDefinition,
      behaviors: [lightBehavior]
    });
    simulator.startCompiledHouseholdRun(run);
    const events = simulator.advanceMinutes(1);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'DeviceStateChanged',
        deviceId: 'lounge_lamp_custom',
        state: { power: 'on', brightness: 35 },
        reason: 'behavior:circadian_lighting@3.0.0:circadian_evening_level'
      })
    ]));
    expect(simulator.getSnapshot().devices.lounge_lamp_custom.state).toMatchObject({
      power: 'on',
      brightness: 35
    });
  });

  it('selects a trusted versioned automation policy and records it in the run identity', () => {
    const relaxedStovePolicy: AutomationPolicyModule = {
      ...coreAutomationPolicyModule,
      id: 'late_stove_cutoff',
      version: '2.0.0',
      thresholds: {
        ...coreAutomationPolicyModule.thresholds,
        unattendedStovePowerW: 1300
      }
    };
    const template = studioTemplate();
    template.automation = { id: relaxedStovePolicy.id, version: relaxedStovePolicy.version };
    template.home.floors[0].fixtures.devices.push({
      id: 'galley_stove_custom',
      roomId: 'galley_a',
      type: 'stove',
      name: 'Galley Stove',
      metrics: ['power_w', 'level']
    });

    expect(() => compileHouseholdRun(template, { date: '2026-07-15', seed: 42 }))
      .toThrow(/automation policy late_stove_cutoff@2.0.0 is not installed/);

    const run = compileHouseholdRun(
      template,
      { date: '2026-07-15', seed: 42 },
      { automationPolicies: [relaxedStovePolicy] }
    );
    expect(run.automationPolicyVersion).toEqual({ id: 'late_stove_cutoff', version: '2.0.0' });

    const missingRuntimePolicy = createSimulator({ seed: 42, homeDefinition: run.homeDefinition });
    expect(() => missingRuntimePolicy.startCompiledHouseholdRun(run))
      .toThrow(/requires automation policy late_stove_cutoff@2.0.0/);

    const simulator = createSimulator({
      seed: 42,
      homeDefinition: run.homeDefinition,
      automationPolicies: [relaxedStovePolicy]
    });
    simulator.startCompiledHouseholdRun(run);
    simulator.commandDevice('galley_stove_custom', 'set_level', 1200);
    const events = simulator.advanceMinutes(1);

    expect(simulator.getSnapshot().devices.galley_stove_custom.state.powerW).toBe(1200);
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'AutomationTriggered', ruleId: 'stove_unattended_safety' })
    ]));

    const coreTemplate = structuredClone(template);
    coreTemplate.automation = { id: coreAutomationPolicyModule.id, version: coreAutomationPolicyModule.version };
    const coreRun = compileHouseholdRun(coreTemplate, { date: '2026-07-15', seed: 42 });
    const coreSimulator = createSimulator({ seed: 42, homeDefinition: coreRun.homeDefinition });
    coreSimulator.startCompiledHouseholdRun(coreRun);
    coreSimulator.commandDevice('galley_stove_custom', 'set_level', 1200);
    const coreEvents = coreSimulator.advanceMinutes(1);
    expect(coreSimulator.getSnapshot().devices.galley_stove_custom.state.powerW).toBe(0);
    expect(coreEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'AutomationTriggered', ruleId: 'stove_unattended_safety' })
    ]));

    const incompatibleRun = structuredClone(run);
    incompatibleRun.automationPolicyVersion = { id: coreAutomationPolicyModule.id, version: coreAutomationPolicyModule.version };
    expect(() => simulator.restoreCompiledHouseholdRun(incompatibleRun, simulator.getSnapshot(), simulator.getEvents()))
      .toThrow(/automationPolicyVersion/);
  });

  it('rejects inline automation thresholds and policies that remove mandatory safety rules', () => {
    const inlineThresholds = studioTemplate() as HouseholdTemplate & { automation: Record<string, unknown> };
    inlineThresholds.automation.thresholds = { unattendedStovePowerW: 5000 };
    expect(() => compileHouseholdRun(inlineThresholds, { date: '2026-07-15', seed: 42 }))
      .toThrow(/Unrecognized key: "thresholds"/);

    const unsafePolicy: AutomationPolicyModule = {
      ...coreAutomationPolicyModule,
      id: 'unsafe_policy',
      version: '1.0.0',
      enabledRules: coreAutomationPolicyModule.enabledRules.filter((ruleId) => ruleId !== 'stove_unattended_safety')
    };
    const template = studioTemplate();
    template.automation = { id: unsafePolicy.id, version: unsafePolicy.version };
    expect(() => compileHouseholdRun(
      template,
      { date: '2026-07-15', seed: 42 },
      { automationPolicies: [unsafePolicy] }
    )).toThrow(/mandatory safety rule stove_unattended_safety must remain enabled/);
  });
});
