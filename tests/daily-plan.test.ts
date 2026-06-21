import { describe, expect, it } from 'vitest';
import { generateDailyScenario } from '../src/sim/dailyPlan';

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
    expect(winter.steps.some((step) => step.actions.some((action) => action.kind === 'setDevice' && action.deviceId === 'living_light_01' && Number(action.state.brightness ?? 0) >= 70))).toBe(true);
  });
});
