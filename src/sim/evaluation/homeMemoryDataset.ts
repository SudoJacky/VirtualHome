import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSimulator } from '../engine';
import { advanceInventoryOneDay } from '../world/inventory';
import { projectDeviceValueEvents, type DeviceValueEvent } from '../../server/deviceEventStream';
import { AgentProfileDatabase, type AgentProfileClaimType, type AgentProfileStatus } from '../../server/agentProfileStore';
import { HomeMemoryDatabase } from '../../server/homeMemoryStore';
import { createHouseholdPortrait } from '../../server/memoryQuery';
import type { TwinEvent, TwinSnapshot } from '../../shared/types';
import { createHomeMemory, reduceDeviceEvents } from '../../web/homeMemoryModel';
import { createHomeProfileHypotheses, type ProfileHypothesis } from '../../web/homeProfiler';
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
    simulationDays: Array<{
      index: number;
      date: string;
      startTime: string | null;
      endTime: string | null;
      eventCount: number;
      sequenceRange: {
        from: number;
        to: number;
      };
    }>;
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
  const simulationDays: HomeMemoryDeviceEventDataset['metadata']['simulationDays'] = [];
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

    const dayValueEvents = projectDeviceValueEvents(normalizedDayEvents).map((event) => ({
      ...event,
      id: `${runId}_value_${event.sequence.toString().padStart(6, '0')}_${event.deviceId}_${event.field}`,
      runId,
      simulationDayIndex: dayOffset,
      simulationDate: date
    }));
    events.push(...dayValueEvents);
    simulationDays.push({
      index: dayOffset,
      date,
      startTime: normalizedDayEvents[0]?.simTime ?? null,
      endTime: normalizedDayEvents[normalizedDayEvents.length - 1]?.simTime ?? null,
      eventCount: dayValueEvents.length,
      sequenceRange: {
        from: dayValueEvents[0]?.sequence ?? 0,
        to: dayValueEvents[dayValueEvents.length - 1]?.sequence ?? 0
      }
    });

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
      },
      simulationDays
    },
    events: sortedEvents
  };
}

export function createHomeMemoryDeviceEventDatasetCliReport(args: string[]): string {
  const { evaluationArgs } = parseHomeMemoryDatasetCliArgs(args);
  return `${JSON.stringify(createHomeMemoryDeviceEventDataset(parseEvaluationCliArgs(evaluationArgs)), null, 2)}\n`;
}

export function writeHomeMemoryDeviceEventDatasetCliReport(args: string[]): string {
  const { evaluationArgs, outputPath, homeMemoryDatabasePath, agentProfileDatabasePath } = parseHomeMemoryDatasetCliArgs(args);
  const dataset = createHomeMemoryDeviceEventDataset(parseEvaluationCliArgs(evaluationArgs));
  const report = `${JSON.stringify(dataset, null, 2)}\n`;
  const materializationMessages = materializeHomeMemoryDataset(dataset, {
    homeMemoryDatabasePath,
    agentProfileDatabasePath
  });
  if (!outputPath) {
    return materializationMessages.length > 0 ? `${report}${materializationMessages.join('\n')}\n` : report;
  }
  writeFileSync(outputPath, report, 'utf8');
  return [
    `Wrote Home Memory device-event dataset to ${outputPath}`,
    ...materializationMessages
  ].join('\n') + '\n';
}

function parseHomeMemoryDatasetCliArgs(args: string[]): {
  evaluationArgs: string[];
  outputPath?: string;
  homeMemoryDatabasePath?: string;
  agentProfileDatabasePath?: string;
} {
  const evaluationArgs: string[] = [];
  let outputPath: string | undefined;
  let homeMemoryDatabasePath: string | undefined;
  let agentProfileDatabasePath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--output') {
      outputPath = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      outputPath = arg.slice('--output='.length);
      continue;
    }
    if (arg === '--home-memory-db') {
      homeMemoryDatabasePath = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--home-memory-db=')) {
      homeMemoryDatabasePath = arg.slice('--home-memory-db='.length);
      continue;
    }
    if (arg === '--agent-profile-db') {
      agentProfileDatabasePath = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--agent-profile-db=')) {
      agentProfileDatabasePath = arg.slice('--agent-profile-db='.length);
      continue;
    }
    evaluationArgs.push(arg);
  }
  return { evaluationArgs, outputPath, homeMemoryDatabasePath, agentProfileDatabasePath };
}

function materializeHomeMemoryDataset(
  dataset: HomeMemoryDeviceEventDataset,
  options: { homeMemoryDatabasePath?: string; agentProfileDatabasePath?: string }
): string[] {
  if (!options.homeMemoryDatabasePath && !options.agentProfileDatabasePath) {
    return [];
  }
  const memory = reduceDeviceEvents(createHomeMemory(), dataset.events);
  const hypotheses = createHomeProfileHypotheses(memory);
  const portrait = createHouseholdPortrait(memory);
  const messages: string[] = [];

  if (options.homeMemoryDatabasePath) {
    const homeMemoryDb = new HomeMemoryDatabase(options.homeMemoryDatabasePath);
    try {
      homeMemoryDb.materializeMemory({
        memory,
        hypotheses,
        portrait,
        coveredSequence: dataset.metadata.sequenceRange.to,
        reducerVersion: 'home-memory-dataset-cli',
        schemaVersion: dataset.metadata.schemaVersion
      });
    } finally {
      homeMemoryDb.close();
    }
    messages.push(`Materialized Home Memory to ${options.homeMemoryDatabasePath}`);
  }

  if (options.agentProfileDatabasePath) {
    const agentProfileDb = new AgentProfileDatabase(options.agentProfileDatabasePath);
    try {
      for (const hypothesis of uniqueHypotheses(hypotheses).slice(0, 20)) {
        agentProfileDb.createEntry({
          id: `entry_${dataset.metadata.runId}_${stableId(hypothesis.id)}`,
          homeId: memory.homeId ?? hypothesis.evidence[0]?.homeId ?? 'unknown_home',
          subjectType: 'household',
          subjectId: 'household',
          entryType: 'conclusion',
          title: hypothesis.label,
          summary: hypothesis.summary,
          content: {
            claim: hypothesis.summary,
            hypothesisId: hypothesis.id,
            hypothesisType: hypothesis.type,
            missingEvidence: hypothesis.missingEvidence,
            alternatives: hypothesis.alternativeExplanations
          },
          index: {
            claimType: claimTypeForHypothesis(hypothesis),
            predicate: predicateForHypothesis(hypothesis)
          },
          sources: [{
            sourceType: 'home_memory_hypothesis',
            sourceId: hypothesis.id,
            homeId: memory.homeId ?? hypothesis.evidence[0]?.homeId ?? 'unknown_home',
            runId: memory.runId ?? dataset.metadata.runId,
            quoteOrObservation: hypothesis.summary,
            weight: Math.min(1, Math.max(0, hypothesis.confidence))
          }],
          status: agentStatusForHypothesis(hypothesis),
          confidence: hypothesis.confidence,
          stability: hypothesis.confidence >= 0.8 ? 'working' : 'volatile',
          createdBy: 'system'
        });
      }
    } finally {
      agentProfileDb.close();
    }
    messages.push(`Wrote Agent Profile conclusions to ${options.agentProfileDatabasePath}`);
  }

  return messages;
}

function claimTypeForHypothesis(hypothesis: ProfileHypothesis): AgentProfileClaimType {
  if (hypothesis.type.includes('routine') || hypothesis.type === 'daily_rhythm' || hypothesis.type === 'activity_cluster') {
    return 'habit';
  }
  if (hypothesis.type === 'automation_recommendation') {
    return 'risk';
  }
  if (hypothesis.type === 'state_anomaly') {
    return 'uncertainty';
  }
  return 'identity';
}

function predicateForHypothesis(hypothesis: ProfileHypothesis): string {
  return hypothesis.type.replace(/[^a-z0-9_]+/gi, '_').toLowerCase();
}

function agentStatusForHypothesis(hypothesis: ProfileHypothesis): AgentProfileStatus {
  if (hypothesis.status === 'rejected') {
    return 'rejected';
  }
  return hypothesis.status === 'strong' || hypothesis.status === 'likely' ? 'active' : 'candidate';
}

function stableId(value: string): string {
  return value.replace(/[^a-z0-9_]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'hypothesis';
}

function uniqueHypotheses(hypotheses: ProfileHypothesis[]): ProfileHypothesis[] {
  return [...new Map(hypotheses.map((hypothesis) => [hypothesis.id, hypothesis])).values()];
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
  process.stdout.write(writeHomeMemoryDeviceEventDatasetCliReport(process.argv.slice(2)));
}
