import type { HomeMode, RoomId, ScenarioId } from '../shared/types';
import { createExternalContext, type ExternalContext } from './externalContext';
import { SeededRandom } from './random';
import type { ScenarioAction, ScenarioDefinition, ScenarioStep } from './scenarios';

export type DayType = 'weekday' | 'weekend';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface DailyScenarioOptions {
  date: string;
  seed?: number;
  externalContext?: ExternalContext;
}

interface CalendarProfile {
  date: string;
  dayType: DayType;
  season: Season;
  month: number;
  dayOfWeek: number;
  holidayName: string | null;
  schoolDay: boolean;
  workday: boolean;
  weatherCondition: ExternalContext['weather']['condition'];
  outdoorTemperatureC: number;
  precipitationMm: number;
}

export function generateDailyScenario(options: DailyScenarioOptions): ScenarioDefinition {
  const externalContext = options.externalContext ?? createExternalContext({ date: options.date, seed: options.seed ?? seedFromDate(options.date) });
  const calendar = createCalendarProfile(externalContext);
  const random = new SeededRandom(options.seed ?? seedFromDate(options.date));
  const routineKind = calendar.workday && calendar.schoolDay ? 'weekday' : 'non_workday';
  const wakeMinute = routineKind === 'weekday' ? jitter(random, 380, 18) : jitter(random, 455, 28);
  const startMinute = Math.max(0, wakeMinute - 60);
  const steps = routineKind === 'weekday'
    ? createWeekdaySteps(calendar, random, wakeMinute)
    : createWeekendSteps(calendar, random, wakeMinute);

  return {
    id: createDailyScenarioId(calendar.date),
    name: `${capitalize(calendar.season)} ${calendar.dayType} routine`,
    startTime: `${calendar.date}T${formatClock(startMinute)}:00+08:00`,
    speed: 60,
    initialMode: 'sleeping',
    initialPeople: {
      adult_1: { location: 'master_bedroom', activity: 'sleeping' },
      adult_2: { location: 'master_bedroom', activity: 'sleeping' },
      child_1: { location: 'child_bedroom', activity: 'sleeping' },
      pet_1: { location: 'living_room', activity: 'sleeping' }
    },
    calendar,
    steps: normalizeSteps(sortAndMergeSteps([
      ...createSeasonOpeningSteps(calendar),
      ...steps,
      ...createSeasonalCareSteps(calendar, random),
      ...createEveningSteps(calendar, random),
      ...createNightSteps(calendar, random)
    ]), startMinute)
  };
}

function createWeekdaySteps(calendar: CalendarProfile, random: SeededRandom, wakeMinute: number): ScenarioStep[] {
  const breakfastMinute = wakeMinute + jitter(random, 28, 6);
  const schoolDeparture = wakeMinute + jitter(random, 78, 8);
  const commuteDeparture = wakeMinute + jitter(random, 92, 10);
  const remoteWorkStart = wakeMinute + jitter(random, 116, 12);

  return [
    step(wakeMinute, [
      move('adult_1', 'bathroom', 'bathroom'),
      device('master_sleep_01', { inBed: false, heartRateSimulated: 72 }, 'routine:wake_up'),
      mode('morning')
    ]),
    step(wakeMinute + 12, [
      move('adult_2', 'bathroom', 'bathroom'),
      device('bathroom_water_01', { flowLMin: 4.8 }, 'routine:morning_wash')
    ]),
    step(breakfastMinute, [
      move('adult_1', 'kitchen', 'breakfast'),
      move('child_1', 'kitchen', 'breakfast'),
      activity('startActivity', 'weekday_breakfast', ['adult_1', 'child_1'], 'kitchen', 'routine:weekday_breakfast'),
      device('kitchen_light_01', { power: 'on', brightness: calendar.season === 'winter' ? 82 : 68 }, 'routine:breakfast'),
      device('fridge_01', { doorOpen: true, powerW: 135 }, 'routine:breakfast')
    ]),
    step(breakfastMinute + 18, [
      device('fridge_01', { doorOpen: false, powerW: 92 }, 'routine:breakfast_done')
    ]),
    step(schoolDeparture, [
      move('child_1', 'away', 'school'),
      device('door_lock_01', { locked: false }, 'routine:school_departure')
    ]),
    step(commuteDeparture, [
      move('adult_1', 'away', 'commuting'),
      device('door_lock_01', { locked: true }, 'routine:commute_departure'),
      activity('endActivity', 'weekday_breakfast', [], 'kitchen', 'routine:morning_done')
    ]),
    step(remoteWorkStart, [
      move('adult_2', 'study', 'remote_work'),
      device('study_co2_01', { co2: 620 }, 'routine:remote_work'),
      device('kitchen_light_01', { power: 'off', brightness: 0 }, 'routine:morning_done')
    ]),
    step(17 * 60 + jitter(random, 35, 20), [
      mode('evening_home'),
      move('child_1', 'living_room', 'homework'),
      device('child_sleep_01', { inBed: false, heartRateSimulated: 78 }, 'routine:homework')
    ]),
    step(18 * 60 + jitter(random, 8, 20), [
      move('adult_1', 'living_room', 'arrived_home'),
      device('door_lock_01', { locked: true }, 'routine:arrival_home')
    ])
  ];
}

function createWeekendSteps(calendar: CalendarProfile, random: SeededRandom, wakeMinute: number): ScenarioStep[] {
  const brunchMinute = wakeMinute + jitter(random, 42, 12);
  const cleaningMinute = wakeMinute + jitter(random, 115, 18);
  const outingMinute = 14 * 60 + jitter(random, 20, 45);
  const returnMinute = 17 * 60 + jitter(random, 20, 45);
  const rainyDay = isRainyDay(calendar);

  return [
    step(wakeMinute, [
      mode('morning'),
      move('adult_1', 'living_room', 'slow_morning'),
      move('child_1', 'living_room', 'weekend_play'),
      device('master_sleep_01', { inBed: false, heartRateSimulated: 70 }, 'routine:weekend_wake')
    ]),
    step(brunchMinute, [
      move('adult_2', 'kitchen', 'brunch'),
      activity('startActivity', 'weekend_brunch', ['adult_2', 'child_1'], 'kitchen', 'routine:weekend_brunch'),
      device('kitchen_light_01', { power: 'on', brightness: calendar.season === 'winter' ? 78 : 58 }, 'routine:brunch'),
      device('stove_01', { powerW: 680, level: 4 }, 'routine:brunch')
    ]),
    step(brunchMinute + 35, [
      device('stove_01', { powerW: 0, level: 0 }, 'routine:brunch_done'),
      activity('endActivity', 'weekend_brunch', [], 'kitchen', 'routine:brunch_done')
    ]),
    step(cleaningMinute, [
      move('adult_1', 'living_room', 'weekend_cleaning'),
      move('adult_2', 'study', 'tidying'),
      device('living_light_01', { power: 'on', brightness: 72 }, 'routine:weekend_cleaning')
    ]),
    ...(rainyDay
      ? [
          step(outingMinute, [
            move('adult_1', 'living_room', 'rainy_day_indoor_play'),
            move('adult_2', 'living_room', 'rainy_day_indoor_play'),
            move('child_1', 'living_room', 'rainy_day_indoor_play'),
            device('tv_01', { power: 'on', app: 'family_game', volume: 12 }, 'weather:rainy_day:indoor_activity')
          ])
        ]
      : [
          step(outingMinute, [
            move('adult_1', 'away', 'family_outing'),
            move('adult_2', 'away', 'family_outing'),
            move('child_1', 'away', 'family_outing'),
            device('door_lock_01', { locked: true }, 'routine:family_outing')
          ]),
          step(returnMinute, [
            mode('evening_home'),
            move('adult_1', 'living_room', 'returned_home'),
            move('adult_2', 'living_room', 'returned_home'),
            move('child_1', 'living_room', 'playing')
          ])
        ])
  ];
}

function createSeasonOpeningSteps(calendar: CalendarProfile): ScenarioStep[] {
  const climateState = seasonClimate(calendar);
  return [
    step(1, [
      device('kitchen_temp_01', climateState, `season:${calendar.season}:baseline`)
    ])
  ];
}

function createSeasonalCareSteps(calendar: CalendarProfile, random: SeededRandom): ScenarioStep[] {
  if (calendar.season === 'summer') {
    return [
      step(6 * 60 + jitter(random, 18, 12), [
        device('sprinkler_01', { valveOpen: true }, 'season:summer:early_watering')
      ]),
      step(6 * 60 + jitter(random, 38, 12), [
        device('sprinkler_01', { valveOpen: false }, 'season:summer:watering_done')
      ])
    ];
  }
  if (calendar.season === 'spring' || calendar.season === 'autumn') {
    return [];
  }
  return [];
}

function createEveningSteps(calendar: CalendarProfile, random: SeededRandom): ScenarioStep[] {
  const dinnerMinute = 18 * 60 + jitter(random, 58, 28);
  const tvMinute = dinnerMinute + jitter(random, 82, 18);
  return [
    step(dinnerMinute, [
      move('adult_2', 'kitchen', 'cooking_dinner'),
      activity('startActivity', 'daily_dinner', ['adult_2'], 'kitchen', 'routine:dinner'),
      device('stove_01', { powerW: calendar.season === 'summer' ? 620 : 820, level: calendar.season === 'summer' ? 4 : 6 }, 'routine:dinner'),
      device('range_hood_01', { power: 'on', speed: 2 }, 'routine:dinner')
    ]),
    step(dinnerMinute + 45, [
      move('adult_1', 'dining_room', 'dinner'),
      move('adult_2', 'dining_room', 'dinner'),
      move('child_1', 'dining_room', 'dinner'),
      device('stove_01', { powerW: 0, level: 0 }, 'routine:dinner_ready'),
      device('range_hood_01', { power: 'off', speed: 0 }, 'routine:dinner_ready'),
      device('dining_light_01', { power: 'on', brightness: calendar.season === 'winter' ? 76 : 62 }, 'routine:dinner')
    ]),
    step(tvMinute, [
      move('adult_1', 'living_room', 'watching_tv'),
      move('adult_2', 'living_room', 'watching_tv'),
      move('child_1', 'living_room', 'watching_tv'),
      device('tv_01', { power: 'on', app: 'streaming', volume: 16 }, 'routine:family_evening'),
      device('living_light_01', { power: 'on', brightness: 38 }, 'routine:family_evening'),
      activity('endActivity', 'daily_dinner', [], 'kitchen', 'routine:dinner_done')
    ])
  ];
}

function createNightSteps(calendar: CalendarProfile, random: SeededRandom): ScenarioStep[] {
  const childSleep = (calendar.dayType === 'weekday' ? 21 : 22) * 60 + jitter(random, 8, 16);
  const adultSleep = (calendar.dayType === 'weekday' ? 22 : 23) * 60 + jitter(random, 25, 22);
  return [
    step(childSleep, [
      move('child_1', 'child_bedroom', 'sleeping'),
      device('child_sleep_01', { inBed: true, heartRateSimulated: 64 }, 'routine:child_sleep')
    ]),
    step(adultSleep, [
      mode('sleeping'),
      move('adult_1', 'master_bedroom', 'sleeping'),
      move('adult_2', 'master_bedroom', 'sleeping'),
      device('master_sleep_01', { inBed: true, heartRateSimulated: 61 }, 'routine:adult_sleep'),
      device('living_light_01', { power: 'off', brightness: 0 }, 'routine:sleep'),
      device('tv_01', { power: 'off', app: null, volume: 0 }, 'routine:sleep')
    ])
  ];
}

function createCalendarProfile(externalContext: ExternalContext): CalendarProfile {
  const { calendar } = externalContext;
  return {
    date: calendar.date,
    dayType: calendar.dayType,
    season: calendar.season,
    month: calendar.month,
    dayOfWeek: calendar.dayOfWeek,
    holidayName: calendar.holidayName,
    schoolDay: calendar.schoolDay,
    workday: calendar.workday,
    weatherCondition: externalContext.weather.condition,
    outdoorTemperatureC: externalContext.weather.outdoorTemperatureC,
    precipitationMm: externalContext.weather.precipitationMm
  };
}

function isRainyDay(calendar: CalendarProfile): boolean {
  return calendar.weatherCondition === 'heavy_rain' || calendar.precipitationMm >= 10;
}

function seasonClimate(calendar: CalendarProfile): Record<string, number> {
  const outdoorTemperatureC = calendar.outdoorTemperatureC;
  if (calendar.season === 'summer') {
    return {
      temperatureC: clampNumber(outdoorTemperatureC - 4.5, 27.5, 31.5),
      humidityPercent: calendar.weatherCondition.includes('rain') ? 76 : 72
    };
  }
  if (calendar.season === 'winter') {
    return {
      temperatureC: clampNumber(outdoorTemperatureC + 11, 18.5, 20.5),
      humidityPercent: 42
    };
  }
  if (calendar.season === 'spring') {
    return {
      temperatureC: clampNumber(outdoorTemperatureC + 1, 22, 24.5),
      humidityPercent: calendar.weatherCondition.includes('rain') ? 64 : 58
    };
  }
  return {
    temperatureC: clampNumber(outdoorTemperatureC + 1.2, 20.5, 23.5),
    humidityPercent: calendar.weatherCondition.includes('rain') ? 58 : 49
  };
}

function seedFromDate(date: string): number {
  return [...date].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
}

function createDailyScenarioId(date: string): ScenarioId {
  return `daily_${date.replaceAll('-', '_')}`;
}

function jitter(random: SeededRandom, base: number, spread: number): number {
  return Math.round(base + random.range(-spread, spread));
}

function step(minute: number, actions: ScenarioAction[]): ScenarioStep {
  return { minute: clampMinute(minute), actions };
}

function move(personId: string, to: RoomId | 'away', activity: string): ScenarioAction {
  return { kind: 'movePerson', personId, to, activity };
}

function device(deviceId: string, state: Record<string, string | number | boolean | null>, reason: string): ScenarioAction {
  return { kind: 'setDevice', deviceId, state, reason };
}

function mode(nextMode: HomeMode): ScenarioAction {
  return { kind: 'setHomeMode', mode: nextMode };
}

function activity(
  kind: 'startActivity' | 'endActivity',
  activityId: string,
  participants: string[],
  roomId: RoomId,
  reason: string
): ScenarioAction {
  if (kind === 'startActivity') {
    return { kind, activityId, participants, roomId, reason };
  }
  return { kind, activityId, reason };
}

function sortAndMergeSteps(steps: ScenarioStep[]): ScenarioStep[] {
  const byMinute = new Map<number, ScenarioAction[]>();
  for (const item of steps) {
    byMinute.set(item.minute, [...(byMinute.get(item.minute) ?? []), ...item.actions]);
  }
  return [...byMinute.entries()]
    .sort(([left], [right]) => left - right)
    .map(([minute, actions]) => ({ minute, actions }));
}

function normalizeSteps(steps: ScenarioStep[], startMinute: number): ScenarioStep[] {
  return sortAndMergeSteps(steps.map((item) => ({
    minute: Math.max(1, item.minute - startMinute),
    actions: item.actions
  })));
}

function clampMinute(minute: number): number {
  return Math.max(1, Math.min(1439, minute));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)) * 10) / 10;
}

function formatClock(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}
