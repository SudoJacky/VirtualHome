import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getHomeDefinition } from '../catalog';
import { createSimulator } from '../engine';
import { advanceInventoryOneDay } from '../world/inventory';
import { buildEvaluationReport, type ForecastEvaluationSample, type ForecastHorizonMinutes, type SimulationEvaluationReport } from './metrics';
import type { TwinEvent, TwinSnapshot } from '../../shared/types';

export interface SimulationEvaluationOptions {
  startDate: string;
  days?: number;
  seed?: number;
  minutesPerDay?: number;
}

export function parseEvaluationCliArgs(args: string[]): Required<SimulationEvaluationOptions> {
  const options: Required<SimulationEvaluationOptions> = {
    startDate: '2026-07-14',
    days: 7,
    seed: 42,
    minutesPerDay: 24 * 60
  };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid evaluation argument near ${key ?? '<empty>'}`);
    }
    if (key === '--start-date') {
      options.startDate = value;
    } else if (key === '--days') {
      options.days = positiveInteger(value, key);
    } else if (key === '--seed') {
      options.seed = positiveInteger(value, key);
    } else if (key === '--minutes-per-day') {
      options.minutesPerDay = positiveInteger(value, key);
    } else {
      throw new Error(`Unknown evaluation argument ${key}`);
    }
  }
  return options;
}

export function createEvaluationCliReport(options: SimulationEvaluationOptions): string {
  return `${JSON.stringify(runSimulationEvaluation(options), null, 2)}\n`;
}

export function runSimulationEvaluation(options: SimulationEvaluationOptions): SimulationEvaluationReport {
  const days = options.days ?? 7;
  const seed = options.seed ?? 42;
  const minutesPerDay = options.minutesPerDay ?? 24 * 60;
  const dayInputs = [];
  let carriedInventory: TwinSnapshot['worldState']['inventory'] | null = null;

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const date = addDays(options.startDate, dayOffset);
    const simulator = createSimulator({ seed: seed + dayOffset });
    const startEvents = simulator.startDailyScenario({ date, seed: seed + dayOffset });
    if (carriedInventory) {
      const startSnapshot = simulator.getSnapshot();
      startSnapshot.worldState.inventory = structuredClone(carriedInventory);
      simulator.restore(startSnapshot, startEvents);
    }
    const initialSnapshot = structuredClone(simulator.getSnapshot());
    const checkpoints = new Map<number, {
      snapshot: TwinSnapshot;
      eventsUntilNow: TwinEvent[];
    }>();
    checkpoints.set(0, {
      snapshot: structuredClone(initialSnapshot),
      eventsUntilNow: [...startEvents]
    });
    const advanceEvents: TwinEvent[] = [];
    let elapsedMinutes = 0;
    while (elapsedMinutes < minutesPerDay) {
      const step = Math.min(15, minutesPerDay - elapsedMinutes);
      advanceEvents.push(...simulator.advanceMinutes(step));
      elapsedMinutes += step;
      checkpoints.set(elapsedMinutes, {
        snapshot: structuredClone(simulator.getSnapshot()),
        eventsUntilNow: [...startEvents, ...advanceEvents]
      });
    }
    const events = [...startEvents, ...advanceEvents];
    const finalSnapshot = withDayRolloverInventory(simulator.getSnapshot(), events);
    carriedInventory = structuredClone(finalSnapshot.worldState.inventory);
    dayInputs.push({
      date,
      events,
      initialSnapshot,
      forecastSamples: createForecastSamples(checkpoints, minutesPerDay),
      finalSnapshot
    });
  }

  return buildEvaluationReport({
    days: dayInputs,
    homeDefinition: getHomeDefinition()
  });
}

function withDayRolloverInventory(snapshot: TwinSnapshot, events: TwinEvent[]): TwinSnapshot {
  const finalSnapshot = structuredClone(snapshot);
  finalSnapshot.worldState.inventory = advanceInventoryOneDay(finalSnapshot.worldState.inventory, {
    peopleHomeCount: Object.values(finalSnapshot.people).filter((person) => person.kind === 'human' && person.location !== 'away').length,
    mealsCooked: events.filter((event) => event.type === 'ActivityStarted' && ['breakfast', 'weekday_breakfast', 'weekend_brunch', 'family_dinner', 'daily_dinner', 'eat_meal'].includes(event.activityId)).length,
    petPresent: Object.values(finalSnapshot.people).some((person) => person.kind === 'pet' && person.location !== 'away')
  });
  return finalSnapshot;
}

function createForecastSamples(
  checkpoints: Map<number, { snapshot: TwinSnapshot; eventsUntilNow: TwinEvent[] }>,
  minutesPerDay: number
): ForecastEvaluationSample[] {
  const horizons: ForecastHorizonMinutes[] = [15, 30, 60];
  return [...checkpoints.entries()]
    .filter(([elapsed]) => elapsed % 60 === 0 && elapsed + 60 <= minutesPerDay)
    .map(([elapsed, checkpoint]) => ({
      currentTime: checkpoint.snapshot.simClock.currentTime,
      eventsUntilNow: checkpoint.eventsUntilNow,
      truthByHorizon: horizons.flatMap((horizonMinutes) => {
        const future = checkpoints.get(elapsed + horizonMinutes);
        return future ? [{ horizonMinutes, snapshot: future.snapshot }] : [];
      })
    }))
    .filter((sample) => sample.truthByHorizon.length > 0);
}

function addDays(dateText: string, offset: number): string {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function positiveInteger(value: string, key: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
}

function isCliEntry(): boolean {
  return pathToFileURL(resolve(process.argv[1] ?? '')).href === import.meta.url;
}

if (isCliEntry()) {
  process.stdout.write(createEvaluationCliReport(parseEvaluationCliArgs(process.argv.slice(2))));
}
