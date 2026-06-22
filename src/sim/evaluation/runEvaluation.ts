import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getHomeDefinition } from '../catalog';
import { createSimulator } from '../engine';
import { advanceInventoryOneDay } from '../world/inventory';
import {
  buildEvaluationReport,
  type DownstreamUtilityValidationSample,
  type ForecastEvaluationSample,
  type ForecastHorizonMinutes,
  type SimulationEvaluationReport
} from './metrics';
import { projectEventsForPrivacy } from '../../server/privacy';
import type { DeviceStateChangedEvent, DeviceTelemetryEvent, TwinEvent, TwinSnapshot } from '../../shared/types';

export interface SimulationEvaluationOptions {
  startDate: string;
  days?: number;
  seed?: number;
  minutesPerDay?: number;
  realWorldValidationSamples?: DownstreamUtilityValidationSample[];
}

type ResolvedCliSimulationEvaluationOptions = Required<Omit<SimulationEvaluationOptions, 'realWorldValidationSamples'>>;

export type EvaluationCliMode = 'evaluation' | 'dataset';

export interface EvaluationCliRequest {
  mode: EvaluationCliMode;
  options: ResolvedCliSimulationEvaluationOptions;
}

export interface TrainingDataset {
  metadata: {
    schemaVersion: 1;
    startDate: string;
    days: number;
    seed: number;
    minutesPerDay: number;
  };
  examples: TrainingDatasetExample[];
}

export interface TrainingDatasetExample {
  date: string;
  currentTime: string;
  observations: Array<DeviceTelemetryEvent | DeviceStateChangedEvent>;
  truth: {
    homeMode: TwinSnapshot['homeState']['mode'];
    people: Record<string, {
      location: TwinSnapshot['people'][string]['location'];
      activity: string;
    }>;
    risks: {
      fridgeLeftOpen: boolean;
      networkOffline: boolean;
      waterLeak: boolean;
      seniorNoActivity: boolean;
    };
  };
}

export function parseEvaluationCliArgs(args: string[]): ResolvedCliSimulationEvaluationOptions {
  const options: ResolvedCliSimulationEvaluationOptions = {
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

export function parseEvaluationCliRequest(args: string[]): EvaluationCliRequest {
  let mode: EvaluationCliMode = 'evaluation';
  const optionArgs = args.filter((arg) => {
    if (arg === '--dataset') {
      mode = 'dataset';
      return false;
    }
    return true;
  });
  return {
    mode,
    options: parseEvaluationCliArgs(optionArgs)
  };
}

export function createEvaluationCliOutput(args: string[]): string {
  const request = parseEvaluationCliRequest(args);
  return request.mode === 'dataset'
    ? createTrainingDatasetCliReport(request.options)
    : createEvaluationCliReport(request.options);
}

export function createEvaluationCliReport(options: SimulationEvaluationOptions): string {
  return `${JSON.stringify(runSimulationEvaluation(options), null, 2)}\n`;
}

export function createTrainingDatasetCliReport(options: SimulationEvaluationOptions): string {
  return `${JSON.stringify(createTrainingDataset(options), null, 2)}\n`;
}

export function createTrainingDataset(options: SimulationEvaluationOptions): TrainingDataset {
  const days = options.days ?? 7;
  const seed = options.seed ?? 42;
  const minutesPerDay = options.minutesPerDay ?? 24 * 60;
  const examples: TrainingDatasetExample[] = [];
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
    const advanceEvents: TwinEvent[] = [];
    let elapsedMinutes = 0;
    while (elapsedMinutes < minutesPerDay) {
      const step = Math.min(15, minutesPerDay - elapsedMinutes);
      advanceEvents.push(...simulator.advanceMinutes(step));
      elapsedMinutes += step;
      if (elapsedMinutes % 60 === 0 || elapsedMinutes === minutesPerDay) {
        examples.push(createTrainingDatasetExample(
          date,
          `dataset_${date.replaceAll('-', '_')}_${seed + dayOffset}`,
          simulator.getSnapshot(),
          [...startEvents, ...advanceEvents]
        ));
      }
    }
    const finalSnapshot = withDayRolloverInventory(simulator.getSnapshot(), [...startEvents, ...advanceEvents]);
    carriedInventory = structuredClone(finalSnapshot.worldState.inventory);
  }

  return {
    metadata: {
      schemaVersion: 1,
      startDate: options.startDate,
      days,
      seed,
      minutesPerDay
    },
    examples
  };
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
    homeDefinition: getHomeDefinition(),
    realWorldValidationSamples: options.realWorldValidationSamples
  });
}

function createTrainingDatasetExample(
  date: string,
  runId: string,
  snapshot: TwinSnapshot,
  eventsUntilNow: TwinEvent[]
): TrainingDatasetExample {
  return {
    date,
    currentTime: snapshot.simClock.currentTime,
    observations: normalizeDatasetObservationIds(
      projectEventsForPrivacy(eventsUntilNow, 'ml-observation') as Array<DeviceTelemetryEvent | DeviceStateChangedEvent>,
      runId
    ),
    truth: {
      homeMode: snapshot.homeState.mode,
      people: Object.fromEntries(Object.entries(snapshot.people)
        .filter(([, person]) => person.kind === 'human')
        .map(([personId, person]) => [personId, {
          location: person.location,
          activity: person.activity
        }])),
      risks: {
        fridgeLeftOpen: snapshot.devices.fridge_01?.state.doorOpen === true,
        networkOffline: snapshot.devices.router_01?.state.online === false,
        waterLeak: snapshot.devices.water_leak_01?.state.leakDetected === true,
        seniorNoActivity: snapshot.alerts.senior_no_activity_001?.status === 'active'
      }
    }
  };
}

function normalizeDatasetObservationIds(
  events: Array<DeviceTelemetryEvent | DeviceStateChangedEvent>,
  runId: string
): Array<DeviceTelemetryEvent | DeviceStateChangedEvent> {
  return events.map((event) => ({
    ...event,
    id: `${runId}_evt_${event.sequence.toString().padStart(6, '0')}`,
    runId
  }));
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
  process.stdout.write(createEvaluationCliOutput(process.argv.slice(2)));
}
