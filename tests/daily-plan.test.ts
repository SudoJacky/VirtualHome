import { describe, expect, it } from 'vitest';
import { generateDailyScenario } from '../src/sim/dailyPlan';
import { createExternalContext } from '../src/sim/externalContext';
import type { ScenarioAction } from '../src/sim/scenarios';

describe('calendar-driven daily plan generation', () => {
  it('generates a reproducible weekday routine from date and seed', () => {
    const first = generateDailyScenario({ date: '2026-07-14', seed: 42 });
    const second = generateDailyScenario({ date: '2026-07-14', seed: 42 });

    expect(first).toEqual(second);
    expect(first.id).toBe('daily_2026_07_14');
    expect(first.calendar).toMatchObject({
      date: '2026-07-14',
      dayType: 'weekday',
      season: 'summer',
      month: 7
    });
    expect(first.initialPeople.child_1.location).toBe('child_bedroom');
    expect(first.steps.some((step) => step.actions.some((action) => action.kind === 'movePerson' && action.personId === 'child_1' && action.to === 'away' && action.activity === 'school'))).toBe(true);
    expect(first.steps.some((step) => step.actions.some((action) => action.kind === 'movePerson' && action.personId === 'adult_1' && action.to === 'away' && action.activity === 'commuting'))).toBe(true);
    expect(first.steps.some((step) => step.actions.some((action) => action.kind === 'movePerson' && action.personId === 'adult_2' && action.to === 'study' && action.activity === 'remote_work'))).toBe(true);
  });

  it('generates a weekend routine without school or commute departures', () => {
    const plan = generateDailyScenario({ date: '2026-07-18', seed: 42 });
    const moveActivities = plan.steps.flatMap((step) => step.actions)
      .filter((action) => action.kind === 'movePerson')
      .map((action) => action.activity);

    expect(plan.calendar!.dayType).toBe('weekend');
    expect(moveActivities).not.toContain('school');
    expect(moveActivities).not.toContain('commuting');
    expect(moveActivities).toContain('family_outing');
    expect(moveActivities).toContain('weekend_cleaning');
  });

  it('treats deterministic holidays as non-school non-work daily routines', () => {
    const plan = generateDailyScenario({ date: '2026-10-01', seed: 42 });
    const moveActivities = plan.steps.flatMap((step) => step.actions)
      .filter((action) => action.kind === 'movePerson')
      .map((action) => action.activity);

    expect(plan.calendar).toMatchObject({
      date: '2026-10-01',
      holidayName: 'National Day',
      schoolDay: false,
      workday: false
    });
    expect(moveActivities).not.toContain('school');
    expect(moveActivities).not.toContain('commuting');
    expect(moveActivities).toContain('family_outing');
  });

  it('uses month and season to produce meaningful seasonal device behavior', () => {
    const summer = generateDailyScenario({ date: '2026-07-14', seed: 7 });
    const winter = generateDailyScenario({ date: '2026-01-14', seed: 7 });

    expect(summer.calendar!.season).toBe('summer');
    expect(winter.calendar!.season).toBe('winter');
    expect(summer.steps.some((step) => step.actions.some((action) => action.kind === 'setDevice' && action.deviceId === 'sprinkler_01' && action.state.valveOpen === true))).toBe(true);
    expect(winter.steps.some((step) => step.actions.some((action) => action.kind === 'setDevice' && action.deviceId === 'sprinkler_01' && action.state.valveOpen === true))).toBe(false);
    expect(winter.steps.some((step) => step.actions.some((action) => action.kind === 'setDevice' && action.deviceId === 'living_light_01' && action.reason === 'season:winter:short_daylight'))).toBe(false);
    expect(winter.steps.some((step) => step.actions.some((action) => action.kind === 'setDevice' && action.deviceId === 'kitchen_light_01' && Number(action.state.brightness ?? 0) >= 80))).toBe(true);
  });

  it('models fridge use as paired open and close moments across meals', () => {
    const weekday = generateDailyScenario({ date: '2026-07-14', seed: 42 });
    const weekend = generateDailyScenario({ date: '2026-07-18', seed: 42 });

    expect(fridgeTransitions(weekday)).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'routine:breakfast', doorOpen: true }),
      expect.objectContaining({ reason: 'routine:breakfast_done', doorOpen: false }),
      expect.objectContaining({ reason: 'routine:dinner_prep', doorOpen: true }),
      expect.objectContaining({ reason: 'routine:dinner_prep_done', doorOpen: false })
    ]));
    expect(fridgeTransitions(weekend)).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'routine:brunch', doorOpen: true }),
      expect.objectContaining({ reason: 'routine:brunch_done', doorOpen: false })
    ]));
  });

  it('models bathroom water flow as paired use and shutoff beyond weekday mornings', () => {
    const weekday = generateDailyScenario({ date: '2026-07-14', seed: 42 });
    const weekend = generateDailyScenario({ date: '2026-07-18', seed: 42 });

    expect(waterFlowTransitions(weekday)).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'routine:morning_wash', flowLMin: expect.any(Number) }),
      expect.objectContaining({ reason: 'routine:morning_wash_done', flowLMin: 0 }),
      expect.objectContaining({ reason: 'routine:evening_wash', flowLMin: expect.any(Number) }),
      expect.objectContaining({ reason: 'routine:evening_wash_done', flowLMin: 0 })
    ]));
    expect(waterFlowTransitions(weekend)).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'routine:weekend_wash', flowLMin: expect.any(Number) }),
      expect.objectContaining({ reason: 'routine:weekend_wash_done', flowLMin: 0 })
    ]));
  });

  it('uses unlock then lock sequences for departures and returns', () => {
    const weekday = generateDailyScenario({ date: '2026-07-14', seed: 42 });
    const weekend = generateDailyScenario({ date: '2026-07-18', seed: 42 });

    expect(lockTransitions(weekday)).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'routine:school_departure', locked: false }),
      expect.objectContaining({ reason: 'routine:commute_departure', locked: true }),
      expect.objectContaining({ reason: 'routine:arrival_home_unlock', locked: false }),
      expect.objectContaining({ reason: 'routine:arrival_home_lock', locked: true })
    ]));
    expect(lockTransitions(weekend)).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'routine:family_outing_unlock', locked: false }),
      expect.objectContaining({ reason: 'routine:family_outing_lock', locked: true }),
      expect.objectContaining({ reason: 'routine:family_return_unlock', locked: false }),
      expect.objectContaining({ reason: 'routine:family_return_lock', locked: true })
    ]));
    expect(lockMinute(weekday, 'routine:arrival_home_lock')).toBe(lockMinute(weekday, 'routine:arrival_home_unlock') + 1);
    expect(lockMinute(weekend, 'routine:family_return_lock')).toBe(lockMinute(weekend, 'routine:family_return_unlock') + 1);
  });

  it('adds pet wake and sleep routine anchors to generated days', () => {
    const weekday = generateDailyScenario({ date: '2026-07-14', seed: 42 });
    const weekend = generateDailyScenario({ date: '2026-07-18', seed: 42 });

    expect(petMoves(weekday)).toEqual(expect.arrayContaining([
      expect.objectContaining({ activity: 'pet_patrol' }),
      expect.objectContaining({ activity: 'sleeping' })
    ]));
    expect(petMoves(weekend)).toEqual(expect.arrayContaining([
      expect.objectContaining({ activity: 'pet_patrol' }),
      expect.objectContaining({ activity: 'sleeping' })
    ]));
  });

  it('uses weather context to replace rainy weekend outings with indoor activity', () => {
    const heavyRain = createExternalContext({
      date: '2026-07-18',
      seed: 42,
      overrides: { weatherCondition: 'heavy_rain' }
    });

    const plan = generateDailyScenario({ date: '2026-07-18', seed: 42, externalContext: heavyRain });
    const moveActivities = plan.steps.flatMap((step) => step.actions)
      .filter((action) => action.kind === 'movePerson')
      .map((action) => action.activity);

    expect(moveActivities).not.toContain('family_outing');
    expect(moveActivities).toContain('rainy_day_indoor_play');
    expect(plan.calendar).toMatchObject({
      date: '2026-07-18',
      weatherCondition: 'heavy_rain',
      precipitationMm: 18
    });
  });

  it('pairs summer sprinkler schedules with human garden checks', () => {
    const summer = generateDailyScenario({ date: '2026-07-14', seed: 7 });

    expect(summer.steps.some((step) => step.actions.some((action) => (
      action.kind === 'movePerson' &&
      action.to === 'garden' &&
      ['garden_check', 'gardening', 'plant_care'].includes(action.activity)
    )))).toBe(true);
  });
});

function fridgeTransitions(plan: ReturnType<typeof generateDailyScenario>): Array<{ reason: string; doorOpen: boolean }> {
  return plan.steps.flatMap((step) => step.actions)
    .filter(isSetDeviceAction)
    .filter((action) => action.deviceId === 'fridge_01')
    .map((action) => ({ reason: action.reason, doorOpen: Boolean(action.state.doorOpen) }));
}

function waterFlowTransitions(plan: ReturnType<typeof generateDailyScenario>): Array<{ reason: string; flowLMin: number }> {
  return plan.steps.flatMap((step) => step.actions)
    .filter(isSetDeviceAction)
    .filter((action) => action.deviceId === 'bathroom_water_01')
    .map((action) => ({ reason: action.reason, flowLMin: Number(action.state.flowLMin) }));
}

function lockTransitions(plan: ReturnType<typeof generateDailyScenario>): Array<{ minute: number; reason: string; locked: boolean }> {
  return plan.steps.flatMap((step) => step.actions)
    .filter(isSetDeviceAction)
    .filter((action) => action.deviceId === 'door_lock_01')
    .map((action) => ({ minute: plan.steps.find((step) => step.actions.includes(action))?.minute ?? -1, reason: action.reason, locked: Boolean(action.state.locked) }));
}

function lockMinute(plan: ReturnType<typeof generateDailyScenario>, reason: string): number {
  const transition = lockTransitions(plan).find((item) => item.reason === reason);
  expect(transition).toBeDefined();
  return transition!.minute;
}

function petMoves(plan: ReturnType<typeof generateDailyScenario>): Array<{ activity: string }> {
  return plan.steps.flatMap((step) => step.actions)
    .filter((action): action is Extract<ScenarioAction, { kind: 'movePerson' }> => action.kind === 'movePerson' && action.personId === 'pet_1')
    .map((action) => ({ activity: action.activity }));
}

function isSetDeviceAction(action: ScenarioAction): action is Extract<ScenarioAction, { kind: 'setDevice' }> {
  return action.kind === 'setDevice';
}
