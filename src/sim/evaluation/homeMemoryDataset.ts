import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSimulator } from '../engine';
import { advanceInventoryOneDay } from '../world/inventory';
import { projectDeviceValueEvents, type DeviceValueEvent } from '../../server/deviceEventStream';
import type { TwinEvent, TwinSnapshot } from '../../shared/types';
import { parseEvaluationCliArgs, type SimulationEvaluationOptions } from './runEvaluation';

export interface HomeMemoryDeviceEventDataset {
  metadata: {
    schemaVersion: 1;
    source: '/ws/device-events';
    startDate: string;
    days: number;
    seed: number;
    minutesPerDay: number;
    runId: string;
    eventCount: number;
    sequenceRange: {
      from: number;
      to: number;
    };
  };
  events: DeviceValueEvent[];
}

interface ResolvedHomeMemoryDeviceEventDatasetOptions {
  startDate: string;
  days: number;
  seed: number;
  minutesPerDay: number;
}

export function createHomeMemoryDeviceEventDataset(options: SimulationEvaluationOptions): HomeMemoryDeviceEventDataset {
  const resolved = resolveHomeMemoryDatasetOptions(options);
  const runId = `home_memory_dataset_${resolved.startDate.replaceAll('-', '_')}_${resolved.days}d_seed_${resolved.seed}`;
  const events: DeviceValueEvent[] = [];
  let carriedInventory: TwinSnapshot['worldState']['inventory'] | null = null;
  let nextSequence = 1;

  for (let dayOffset = 0; dayOffset < resolved.days; dayOffset += 1) {
    const date = addDays(resolved.startDate, dayOffset);
    const daySeed = resolved.seed + dayOffset;
    const simulator = createSimulator({ seed: daySeed });
    const startEvents = simulator.startDailyScenario({ date, seed: daySeed });
    if (carriedInventory) {
      const startSnapshot = simulator.getSnapshot();
      startSnapshot.worldState.inventory = structuredClone(carriedInventory);
      simulator.restore(startSnapshot, startEvents);
    }

    const dayEvents: TwinEvent[] = [...startEvents];
    let elapsedMinutes = 0;
    while (elapsedMinutes < resolved.minutesPerDay) {
      const step = Math.min(15, resolved.minutesPerDay - elapsedMinutes);
      dayEvents.push(...simulator.advanceMinutes(step));
      elapsedMinutes += step;
    }

    const normalizedDayEvents = dayEvents.map((event) => {
      const sequence = nextSequence;
      nextSequence += 1;
      return {
        ...event,
        id: `${runId}_evt_${sequence.toString().padStart(6, '0')}`,
        runId,
        sequence
      };
    });

    events.push(...projectDeviceValueEvents(normalizedDayEvents).map((event) => ({
      ...event,
      id: `${runId}_value_${event.sequence.toString().padStart(6, '0')}_${event.deviceId}_${event.field}`,
      runId
    })));

    const finalSnapshot = withDayRolloverInventory(simulator.getSnapshot(), dayEvents);
    carriedInventory = structuredClone(finalSnapshot.worldState.inventory);
  }

  const sortedEvents = events.sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  return {
    metadata: {
      schemaVersion: 1,
      source: '/ws/device-events',
      startDate: resolved.startDate,
      days: resolved.days,
      seed: resolved.seed,
      minutesPerDay: resolved.minutesPerDay,
      runId,
      eventCount: sortedEvents.length,
      sequenceRange: {
        from: sortedEvents[0]?.sequence ?? 0,
        to: sortedEvents[sortedEvents.length - 1]?.sequence ?? 0
      }
    },
    events: sortedEvents
  };
}

export function createHomeMemoryDeviceEventDatasetCliReport(args: string[]): string {
  return `${JSON.stringify(createHomeMemoryDeviceEventDataset(parseEvaluationCliArgs(args)), null, 2)}\n`;
}

function resolveHomeMemoryDatasetOptions(options: SimulationEvaluationOptions): ResolvedHomeMemoryDeviceEventDatasetOptions {
  return {
    startDate: options.startDate,
    days: options.days ?? 7,
    seed: options.seed ?? 42,
    minutesPerDay: options.minutesPerDay ?? 24 * 60
  };
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

function addDays(dateText: string, offset: number): string {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function isCliEntry(): boolean {
  return pathToFileURL(resolve(process.argv[1] ?? '')).href === import.meta.url;
}

if (isCliEntry()) {
  process.stdout.write(createHomeMemoryDeviceEventDatasetCliReport(process.argv.slice(2)));
}
