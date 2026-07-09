import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AgentProfileDatabase } from '../../server/agentProfileStore';
import { DeviceEventDatabase } from '../../server/deviceEventStore';
import type { DeviceValueEvent } from '../../server/deviceEventStream';
import { HomeMemoryDatabase } from '../../server/homeMemoryStore';
import { createHouseholdPortrait } from '../../server/memoryQuery';
import { createHomeMemory, reduceDeviceEvents } from '../../web/homeMemoryModel';
import { createHomeProfileHypotheses } from '../../web/homeProfiler';

export interface HomeMemoryRebuildOptions {
  inputPath: string;
  deviceEventsDatabasePath: string;
  homeMemoryDatabasePath: string;
  agentProfileDatabasePath: string;
}

export interface HomeMemoryRebuildReport {
  inputPath: string;
  deviceEventsDatabasePath: string;
  homeMemoryDatabasePath: string;
  agentProfileDatabasePath: string;
  importedDeviceEventCount: number;
  materializedEvidenceCount: number;
  materializedHypothesisCount: number;
  materializedPortraitSectionCount: number;
  homeId: string;
  runId: string;
  importId: string;
}

interface DeviceEventDataset {
  metadata: {
    schemaVersion?: number;
    runId?: string;
    eventCount?: number;
  };
  events: DeviceValueEvent[];
}

export function rebuildHomeMemoryFromDeviceEvents(options: HomeMemoryRebuildOptions): HomeMemoryRebuildReport {
  console.info('[memory:rebuild] validate_input_start', JSON.stringify({
    operation: 'memory_rebuild',
    inputPath: options.inputPath
  }));
  const inputText = readFileSync(options.inputPath, 'utf8');
  const inputSha256 = createHash('sha256').update(inputText).digest('hex');
  const dataset = parseAndValidateDataset(inputText, options.inputPath);
  console.info('[memory:rebuild] validate_input_complete', JSON.stringify({
    operation: 'memory_rebuild',
    inputPath: options.inputPath,
    runId: dataset.events[0].runId,
    eventCount: dataset.events.length
  }));

  const deviceEventsDb = new DeviceEventDatabase(options.deviceEventsDatabasePath);
  const homeMemoryDb = new HomeMemoryDatabase(options.homeMemoryDatabasePath);
  const agentProfileDb = new AgentProfileDatabase(options.agentProfileDatabasePath);
  try {
    console.info('[memory:rebuild] reset_device_events_start', JSON.stringify({
      operation: 'memory_rebuild',
      dbPath: options.deviceEventsDatabasePath,
      runId: dataset.events[0].runId
    }));
    const importResult = deviceEventsDb.rebuildFromEvents({
      inputPath: options.inputPath,
      inputSha256,
      schemaVersion: dataset.metadata.schemaVersion ?? 1,
      events: dataset.events
    });
    console.info('[memory:rebuild] reset_device_events_complete', JSON.stringify({
      operation: 'memory_rebuild',
      dbPath: options.deviceEventsDatabasePath,
      importId: importResult.importId,
      importedDeviceEventCount: importResult.eventCount
    }));

    const importedEvents = deviceEventsDb.listEvents({
      homeId: importResult.homeId,
      runId: importResult.runId,
      limit: importResult.eventCount
    }).items;
    const memory = reduceDeviceEvents(createHomeMemory(), importedEvents);
    const hypotheses = createHomeProfileHypotheses(memory);
    const portrait = createHouseholdPortrait(memory);

    console.info('[memory:rebuild] reset_home_memory_start', JSON.stringify({
      operation: 'memory_rebuild',
      dbPath: options.homeMemoryDatabasePath,
      runId: importResult.runId
    }));
    homeMemoryDb.clearAll();
    homeMemoryDb.materializeMemory({
      memory,
      hypotheses,
      portrait,
      coveredSequence: importedEvents.at(-1)?.sequence ?? 0,
      reducerVersion: 'home-memory-rebuild-cli',
      schemaVersion: dataset.metadata.schemaVersion ?? 1
    });
    console.info('[memory:rebuild] reset_home_memory_complete', JSON.stringify({
      operation: 'memory_rebuild',
      dbPath: options.homeMemoryDatabasePath,
      runId: importResult.runId,
      materializedEvidenceCount: memory.recentEvents.length,
      materializedHypothesisCount: hypotheses.length,
      materializedPortraitSectionCount: portrait.sections.length
    }));
    console.info('[memory:rebuild] agent_profile_schema_ensured', JSON.stringify({
      operation: 'memory_rebuild',
      dbPath: options.agentProfileDatabasePath,
      runId: importResult.runId
    }));

    return {
      inputPath: options.inputPath,
      deviceEventsDatabasePath: options.deviceEventsDatabasePath,
      homeMemoryDatabasePath: options.homeMemoryDatabasePath,
      agentProfileDatabasePath: options.agentProfileDatabasePath,
      importedDeviceEventCount: importResult.eventCount,
      materializedEvidenceCount: memory.recentEvents.length,
      materializedHypothesisCount: hypotheses.length,
      materializedPortraitSectionCount: portrait.sections.length,
      homeId: importResult.homeId,
      runId: importResult.runId,
      importId: importResult.importId
    };
  } catch (error) {
    throw wrapRebuildError(error, options, dataset.events[0]?.runId);
  } finally {
    agentProfileDb.close();
    homeMemoryDb.close();
    deviceEventsDb.close();
  }
}

export function createHomeMemoryRebuildCliReport(args: string[]): string {
  const report = rebuildHomeMemoryFromDeviceEvents(parseArgs(args));
  return [
    `Validated input dataset: ${report.inputPath}`,
    `Reset Device Event DB: ${report.deviceEventsDatabasePath}`,
    `Imported device events: ${report.importedDeviceEventCount}`,
    `Reset Home Memory DB: ${report.homeMemoryDatabasePath}`,
    `Materialized Home Memory run: ${report.runId}`,
    `Ensured Agent Profile DB schema: ${report.agentProfileDatabasePath}`
  ].join('\n') + '\n';
}

function parseArgs(args: string[]): HomeMemoryRebuildOptions {
  const defaults = {
    inputPath: path.join('data', 'home-memory-days.json'),
    deviceEventsDatabasePath: path.join('data', 'device-events.db'),
    homeMemoryDatabasePath: path.join('data', 'home-memory.db'),
    agentProfileDatabasePath: path.join('data', 'agent-profile.db')
  };
  const options = { ...defaults };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === '--input') {
      options.inputPath = requiredNext(arg, next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--input=')) {
      options.inputPath = arg.slice('--input='.length);
      continue;
    }
    if (arg === '--device-events-db') {
      options.deviceEventsDatabasePath = requiredNext(arg, next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--device-events-db=')) {
      options.deviceEventsDatabasePath = arg.slice('--device-events-db='.length);
      continue;
    }
    if (arg === '--home-memory-db') {
      options.homeMemoryDatabasePath = requiredNext(arg, next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--home-memory-db=')) {
      options.homeMemoryDatabasePath = arg.slice('--home-memory-db='.length);
      continue;
    }
    if (arg === '--agent-profile-db') {
      options.agentProfileDatabasePath = requiredNext(arg, next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--agent-profile-db=')) {
      options.agentProfileDatabasePath = arg.slice('--agent-profile-db='.length);
      continue;
    }
    throw new Error(`Unknown memory:rebuild argument: ${arg}`);
  }
  return {
    inputPath: resolve(options.inputPath),
    deviceEventsDatabasePath: resolve(options.deviceEventsDatabasePath),
    homeMemoryDatabasePath: resolve(options.homeMemoryDatabasePath),
    agentProfileDatabasePath: resolve(options.agentProfileDatabasePath)
  };
}

function parseAndValidateDataset(inputText: string, inputPath: string): DeviceEventDataset {
  const parsed = JSON.parse(inputText) as Partial<DeviceEventDataset>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid Home Memory dataset at ${inputPath}: expected JSON object`);
  }
  if (!parsed.metadata || typeof parsed.metadata !== 'object') {
    throw new Error(`Invalid Home Memory dataset at ${inputPath}: missing metadata`);
  }
  if (!Array.isArray(parsed.events) || parsed.events.length === 0) {
    throw new Error(`Invalid Home Memory dataset at ${inputPath}: events must be non-empty`);
  }
  const ids = new Set<string>();
  for (const [index, event] of parsed.events.entries()) {
    validateDatasetEvent(event, index, inputPath);
    if (ids.has(event.id)) {
      throw new Error(`Invalid Home Memory dataset at ${inputPath}: duplicate event id ${event.id}`);
    }
    ids.add(event.id);
  }
  if (parsed.metadata.eventCount !== undefined && parsed.metadata.eventCount !== parsed.events.length) {
    throw new Error(`Invalid Home Memory dataset at ${inputPath}: metadata.eventCount does not match events length`);
  }
  return {
    metadata: parsed.metadata,
    events: [...parsed.events].sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
  };
}

function validateDatasetEvent(event: DeviceValueEvent, index: number, inputPath: string): void {
  const required = [
    'id',
    'sourceEventId',
    'sourceEventType',
    'runId',
    'sequence',
    'ts',
    'simTime',
    'homeId',
    'roomId',
    'deviceId',
    'deviceType',
    'field'
  ] as const;
  for (const key of required) {
    if (event[key] === undefined || event[key] === null || event[key] === '') {
      throw new Error(`Invalid Home Memory dataset at ${inputPath}: event ${index} missing ${key}`);
    }
  }
  if (event.sourceEventType !== 'DeviceTelemetry' && event.sourceEventType !== 'DeviceStateChanged') {
    throw new Error(`Invalid Home Memory dataset at ${inputPath}: event ${event.id} has unsupported sourceEventType`);
  }
  if (!Number.isInteger(event.sequence)) {
    throw new Error(`Invalid Home Memory dataset at ${inputPath}: event ${event.id} sequence must be an integer`);
  }
}

function requiredNext(arg: string, next: string | undefined): string {
  if (!next) {
    throw new Error(`Missing value for ${arg}`);
  }
  return next;
}

function wrapRebuildError(error: unknown, options: HomeMemoryRebuildOptions, runId: string | undefined): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error([
    `memory:rebuild failed: ${message}`,
    `input=${options.inputPath}`,
    `deviceEventsDb=${options.deviceEventsDatabasePath}`,
    `homeMemoryDb=${options.homeMemoryDatabasePath}`,
    `agentProfileDb=${options.agentProfileDatabasePath}`,
    `runId=${runId ?? 'unknown'}`
  ].join(' '));
}

function isCliEntry(): boolean {
  return pathToFileURL(resolve(process.argv[1] ?? '')).href === import.meta.url;
}

if (isCliEntry()) {
  process.stdout.write(createHomeMemoryRebuildCliReport(process.argv.slice(2)));
}
