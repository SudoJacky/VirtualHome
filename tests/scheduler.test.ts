import { describe, expect, it } from 'vitest';
import { createDailyCommitments, commitmentPressureAtMinute } from '../src/sim/agents/scheduler';
import { createExternalContext } from '../src/sim/externalContext';
import { getPersona } from '../src/sim/personas/defaultFamily';

describe('agent scheduler', () => {
  it('creates deterministic role-specific commitments from persona and date', () => {
    const remoteWorker = createDailyCommitments({
      persona: getPersona('adult_2'),
      date: '2026-07-14',
      seed: 42
    });
    const child = createDailyCommitments({
      persona: getPersona('child_1'),
      date: '2026-07-14',
      seed: 42
    });

    expect(remoteWorker.map((commitment) => commitment.activityId)).toEqual(expect.arrayContaining([
      'remote_work_session',
      'eat_meal'
    ]));
    expect(child).toEqual(expect.arrayContaining([
      expect.objectContaining({
        activityId: 'study_homework',
        priority: expect.any(Number),
        window: {
          startMinute: expect.any(Number),
          endMinute: expect.any(Number)
        }
      })
    ]));
    expect(createDailyCommitments({ persona: getPersona('adult_2'), date: '2026-07-14', seed: 42 })).toEqual(remoteWorker);
  });

  it('reports pressure when a commitment window is active or nearly due', () => {
    const commitments = createDailyCommitments({
      persona: getPersona('child_1'),
      date: '2026-07-14',
      seed: 7
    });

    const homework = commitments.find((commitment) => commitment.activityId === 'study_homework');
    expect(homework).toBeDefined();
    expect(commitmentPressureAtMinute(commitments, homework!.window.startMinute + 5, 'study_homework')).toBeGreaterThan(50);
    expect(commitmentPressureAtMinute(commitments, 8 * 60, 'study_homework')).toBe(0);
  });

  it('uses deterministic external context to suppress weather and holiday commitments', () => {
    const rainy = createExternalContext({ date: '2026-07-14', seed: 1, overrides: { weatherCondition: 'heavy_rain' } });
    const holiday = createExternalContext({ date: '2026-10-01', seed: 1, overrides: { holidayName: 'National Day', schoolDay: false } });

    const rainySenior = createDailyCommitments({
      persona: getPersona('senior_1'),
      date: rainy.calendar.date,
      seed: 1,
      externalContext: rainy
    });
    const holidayStudent = createDailyCommitments({
      persona: getPersona('child_1'),
      date: holiday.calendar.date,
      seed: 1,
      externalContext: holiday
    });

    expect(rainySenior.map((commitment) => commitment.activityId)).not.toContain('gardening');
    expect(holidayStudent.map((commitment) => commitment.activityId)).not.toContain('study_homework');
    expect(createExternalContext({ date: '2026-07-14', seed: 1 })).toEqual(createExternalContext({ date: '2026-07-14', seed: 1 }));
  });
});
