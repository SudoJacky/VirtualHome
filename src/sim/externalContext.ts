import { SeededRandom } from './random';

export type DayType = 'weekday' | 'weekend';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type WeatherCondition = 'clear' | 'cloudy' | 'light_rain' | 'heavy_rain' | 'hot' | 'cold';

export interface ExternalContext {
  calendar: {
    date: string;
    dayType: DayType;
    season: Season;
    month: number;
    dayOfWeek: number;
    holidayName: string | null;
    schoolDay: boolean;
    workday: boolean;
  };
  weather: {
    condition: WeatherCondition;
    outdoorTemperatureC: number;
    precipitationMm: number;
  };
}

export interface ExternalContextOptions {
  date: string;
  seed?: number;
  overrides?: Partial<{
    weatherCondition: WeatherCondition;
    holidayName: string | null;
    schoolDay: boolean;
    workday: boolean;
  }>;
}

export function createExternalContext(options: ExternalContextOptions): ExternalContext {
  const calendar = createCalendarContext(options.date, options.overrides);
  const weather = createWeatherContext(calendar.season, options.seed ?? seedFromDate(options.date), options.overrides?.weatherCondition);
  return {
    calendar,
    weather
  };
}

function createCalendarContext(
  date: string,
  overrides: ExternalContextOptions['overrides'] = {}
): ExternalContext['calendar'] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error('External context date must use YYYY-MM-DD');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const holidayName = overrides.holidayName !== undefined ? overrides.holidayName : holidayForDate(month, day);
  const dayType: DayType = dayOfWeek === 0 || dayOfWeek === 6 ? 'weekend' : 'weekday';
  const defaultWorkday = dayType === 'weekday' && !holidayName;
  const schoolDay = overrides.schoolDay ?? defaultWorkday;
  const workday = overrides.workday ?? defaultWorkday;
  return {
    date,
    dayType,
    season: seasonForMonth(month),
    month,
    dayOfWeek,
    holidayName,
    schoolDay,
    workday
  };
}

function createWeatherContext(
  season: Season,
  seed: number,
  override?: WeatherCondition
): ExternalContext['weather'] {
  const random = new SeededRandom(seed);
  const condition = override ?? deterministicWeather(season, random.next());
  return {
    condition,
    outdoorTemperatureC: outdoorTemperatureFor(season, condition),
    precipitationMm: precipitationFor(condition)
  };
}

function deterministicWeather(season: Season, sample: number): WeatherCondition {
  if (season === 'summer' && sample > 0.78) return 'hot';
  if (season === 'winter' && sample > 0.72) return 'cold';
  if (sample < 0.12) return 'heavy_rain';
  if (sample < 0.28) return 'light_rain';
  if (sample < 0.55) return 'cloudy';
  return 'clear';
}

function outdoorTemperatureFor(season: Season, condition: WeatherCondition): number {
  const base: Record<Season, number> = {
    spring: 22,
    summer: 31,
    autumn: 20,
    winter: 8
  };
  const offset: Record<WeatherCondition, number> = {
    clear: 1.5,
    cloudy: -0.5,
    light_rain: -2,
    heavy_rain: -3,
    hot: 5,
    cold: -5
  };
  return Math.round((base[season] + offset[condition]) * 10) / 10;
}

function precipitationFor(condition: WeatherCondition): number {
  if (condition === 'heavy_rain') return 18;
  if (condition === 'light_rain') return 4;
  return 0;
}

function holidayForDate(month: number, day: number): string | null {
  if (month === 1 && day === 1) return 'New Year';
  if (month === 5 && day === 1) return 'Labor Day';
  if (month === 10 && day >= 1 && day <= 7) return 'National Day';
  return null;
}

function seasonForMonth(month: number): Season {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

function seedFromDate(date: string): number {
  return [...date].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
}
