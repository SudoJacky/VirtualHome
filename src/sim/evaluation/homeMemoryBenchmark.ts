import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectDeviceValueEvents, type DeviceValueEvent } from '../../server/deviceEventStream';
import type { TwinEvent, TwinSnapshot } from '../../shared/types';
import { extractHomeBehaviorEpisodes } from '../../web/homeBehaviorEpisodes';
import { extractHomeInferenceFeatures } from '../../web/homeInferenceFeatures';
import { createHomeMemory, reduceDeviceEvents } from '../../web/homeMemoryModel';
import { createHomeProfileHypotheses } from '../../web/homeProfiler';
import { createSimulator } from '../engine';
import type { WeatherCondition } from '../externalContext';
import {
  compileHouseholdRun,
  type HouseholdTemplate
} from '../householdTemplate';
import { SeededRandom } from '../random';
import { advanceInventoryOneDay } from '../world/inventory';
import { createHomeMemoryBenchmarkGroundTruth } from './homeMemoryBenchmarkGroundTruth';
import {
  applyHomeMemoryBenchmarkIntervention,
  createHomeMemoryBenchmarkTemplateCatalog,
  expectedHomeMemoryBenchmarkFeatures,
  targetFeatureForIntervention,
  type HomeMemoryBenchmarkIntervention,
  type HomeMemoryBenchmarkSemanticFeature,
  type HomeMemoryBenchmarkSplit,
  type HomeMemoryBenchmarkTemplateDefinition
} from './homeMemoryBenchmarkTemplates';

export type HomeMemoryBenchmarkQualityProfile = 'clean' | 'mild' | 'harsh';

export interface GenerateHomeMemoryBenchmarkOptions {
  outputRoot: string;
  days?: number;
  minutesPerDay?: number;
  conditionsPerTemplate?: number;
  templateLimit?: number;
  includeInterventions?: boolean;
  onProgress?: (message: string) => void;
}

export interface HomeMemoryBenchmarkGenerationSummary {
  outputRoot: string;
  schemaVersion: 2;
  daysPerSample: number;
  sampleCount: number;
  observationCount: number;
  splitSampleCounts: Record<HomeMemoryBenchmarkSplit, number>;
  householdGroupCounts: Record<HomeMemoryBenchmarkSplit, number>;
  interventionPairCount: number;
  validation: HomeMemoryBenchmarkValidationResult;
}

export interface HomeMemoryBenchmarkValidationResult {
  sampleCount: number;
  observationCount: number;
  householdGroups: Record<HomeMemoryBenchmarkSplit, string[]>;
  interventionCount: number;
  truthLeakCount: number;
}

export interface HomeMemoryBenchmarkFaultOptions {
  qualityProfile: HomeMemoryBenchmarkQualityProfile;
  seed: number;
  days: number;
}

export interface HomeMemoryBenchmarkFaultLedger {
  qualityProfile: HomeMemoryBenchmarkQualityProfile;
  packetLoss: {
    rate: number;
    droppedSourceEventIds: string[];
  };
  latency: {
    probability: number;
    maxSeconds: number;
    delayedSourceEvents: Array<{ sourceEventId: string; delaySeconds: number }>;
  };
  noise: {
    probability: number;
    relativeScale: number;
    changedEvents: Array<{
      eventId: string;
      cleanValue: number;
      observedValue: number;
    }>;
  };
  deviceOffline: {
    deviceId: string | null;
    startedAt: string | null;
    endedAt: string | null;
    droppedSourceEventIds: string[];
  };
}

export interface HomeMemoryBenchmarkFaultResult {
  events: DeviceValueEvent[];
  ledger: HomeMemoryBenchmarkFaultLedger;
}

interface BenchmarkCondition {
  id: string;
  startDate: string;
  seed: number;
  weather: WeatherCondition;
  qualityProfile: HomeMemoryBenchmarkQualityProfile;
}

interface BenchmarkSamplePlan {
  sampleId: string;
  split: HomeMemoryBenchmarkSplit;
  householdGroupId: string;
  definition: HomeMemoryBenchmarkTemplateDefinition;
  condition: BenchmarkCondition;
  intervention: HomeMemoryBenchmarkIntervention;
  pairId: string | null;
}

interface BenchmarkFeatureInventory {
  behaviorEpisodeKinds: string[];
  inferenceFeatureIds: string[];
  profilePatternIds: string[];
  profileHypothesisIds: string[];
  automationRuleIds: string[];
}

interface BenchmarkHourlyTruth {
  simTime: string;
  homeMode: TwinSnapshot['homeState']['mode'];
  people: Record<string, {
    kind: TwinSnapshot['people'][string]['kind'];
    location: TwinSnapshot['people'][string]['location'];
    activity: string;
  }>;
}

interface SimulatedBenchmarkSample {
  cleanEvents: DeviceValueEvent[];
  twinEvents: TwinEvent[];
  hourlyTruth: BenchmarkHourlyTruth[];
  environmentDays: Array<{
    date: string;
    season: string;
    weather: {
      condition: WeatherCondition;
      outdoorTemperatureC: number;
      precipitationMm: number;
    };
    templateDigest: string;
  }>;
}

interface PrivateSampleSummary {
  sampleId: string;
  split: HomeMemoryBenchmarkSplit;
  householdGroupId: string;
  intervention: HomeMemoryBenchmarkIntervention;
  pairId: string | null;
  expectedSemanticFeatures: HomeMemoryBenchmarkSemanticFeature[];
  cleanFeatureInventory: BenchmarkFeatureInventory;
  observedFeatureInventory: BenchmarkFeatureInventory;
}

interface PublicManifest {
  schemaVersion: 2;
  generatedAt: string;
  durationLimitDays: 60;
  samples: Array<{
    sampleId: string;
    split: HomeMemoryBenchmarkSplit;
    householdGroupId: string;
    metadataPath: string;
    observationsPath: string;
  }>;
}

interface PrivateManifest {
  schemaVersion: 2;
  generatedAt: string;
  samples: Array<{
    sampleId: string;
    split: HomeMemoryBenchmarkSplit;
    householdGroupId: string;
    intervention: HomeMemoryBenchmarkIntervention;
    truthPath: string;
    templatePath: string;
  }>;
}

const conditions: BenchmarkCondition[] = [
  {
    id: 'winter_cold',
    startDate: '2026-01-12',
    seed: 101,
    weather: 'cold',
    qualityProfile: 'clean'
  },
  {
    id: 'spring_rain',
    startDate: '2026-04-13',
    seed: 211,
    weather: 'light_rain',
    qualityProfile: 'mild'
  },
  {
    id: 'summer_hot',
    startDate: '2026-07-13',
    seed: 307,
    weather: 'hot',
    qualityProfile: 'harsh'
  },
  {
    id: 'autumn_storm',
    startDate: '2026-10-12',
    seed: 401,
    weather: 'heavy_rain',
    qualityProfile: 'mild'
  }
];

const splitNames: HomeMemoryBenchmarkSplit[] = ['train', 'validation', 'blind'];
const allInterventions: Array<Exclude<HomeMemoryBenchmarkIntervention, 'none'>> = [
  'child_removed',
  'pet_removed',
  'remote_work_removed',
  'automation_removed'
];
const forbiddenPublicKeys = new Set([
  'truth',
  'template',
  'templateId',
  'templateVersion',
  'templateDigest',
  'residents',
  'intervention',
  'expectedSemanticFeatures',
  'faultLedger',
  'seed',
  'hourlyTruth',
  'cleanFeatureInventory',
  'groundTruthEpisodes',
  'groundTruthPatterns',
  'positiveFeatureIds'
]);
const mandatoryAutomationRules = new Set([
  'stove_unattended_safety',
  'close_water_valve_on_leak'
]);

export function generateHomeMemoryBenchmark(
  options: GenerateHomeMemoryBenchmarkOptions
): HomeMemoryBenchmarkGenerationSummary {
  const resolvedOptions = resolveOptions(options);
  ensureFreshOutputRoot(resolvedOptions.outputRoot);
  createBenchmarkDirectories(resolvedOptions.outputRoot);
  writeBenchmarkReadme(resolvedOptions.outputRoot);

  const catalog = createHomeMemoryBenchmarkTemplateCatalog()
    .slice(0, resolvedOptions.templateLimit);
  const plans = createSamplePlans(catalog, resolvedOptions);
  const publicManifest: PublicManifest = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    durationLimitDays: 60,
    samples: []
  };
  const privateManifest: PrivateManifest = {
    schemaVersion: 2,
    generatedAt: publicManifest.generatedAt,
    samples: []
  };
  const privateSummaries: PrivateSampleSummary[] = [];
  let observationCount = 0;

  for (const [planIndex, plan] of plans.entries()) {
    resolvedOptions.onProgress?.(
      `[${planIndex + 1}/${plans.length}] ${plan.sampleId} ${plan.split} ${plan.condition.id} ${plan.intervention}`
    );
    const template = withConditionWeather(plan.definition.template, plan.condition.weather);
    const simulated = simulateBenchmarkSample(
      plan,
      template,
      resolvedOptions.days,
      resolvedOptions.minutesPerDay
    );
    const faultResult = applyHomeMemoryBenchmarkObservationFaults(simulated.cleanEvents, {
      qualityProfile: plan.condition.qualityProfile,
      seed: plan.condition.seed + 73,
      days: resolvedOptions.days
    });
    const cleanFeatureInventory = extractFeatureInventory(simulated.cleanEvents, simulated.twinEvents);
    const observedFeatureInventory = extractFeatureInventory(faultResult.events, []);
    const expectedSemanticFeatures = expectedHomeMemoryBenchmarkFeatures(plan.definition);
    const groundTruth = createHomeMemoryBenchmarkGroundTruth(simulated.twinEvents, template);
    const publicSampleDirectory = join(
      resolvedOptions.outputRoot,
      'public',
      plan.split,
      plan.sampleId
    );
    const privateTruthDirectory = join(
      resolvedOptions.outputRoot,
      'private',
      'ground-truth',
      plan.split
    );
    const privateTemplateDirectory = join(
      resolvedOptions.outputRoot,
      'private',
      'templates',
      plan.split,
      plan.householdGroupId
    );
    mkdirSync(publicSampleDirectory, { recursive: true });
    mkdirSync(privateTruthDirectory, { recursive: true });
    mkdirSync(privateTemplateDirectory, { recursive: true });

    const metadataPath = join(publicSampleDirectory, 'metadata.json');
    const observationsPath = join(publicSampleDirectory, 'observations.jsonl');
    const truthPath = join(privateTruthDirectory, `${plan.sampleId}.json`);
    const templatePath = join(
      privateTemplateDirectory,
      `${plan.definition.template.id}__${plan.condition.id}.json`
    );
    const publicMetadata = {
      schemaVersion: 2,
      source: '/ws/device-events',
      sampleId: plan.sampleId,
      split: plan.split,
      householdGroupId: plan.householdGroupId,
      startDate: plan.condition.startDate,
      days: resolvedOptions.days,
      minutesPerDay: resolvedOptions.minutesPerDay,
      qualityProfile: plan.condition.qualityProfile,
      arrivalOrder: 'ts_then_sequence',
      observationCount: faultResult.events.length
    };
    const privateTruth = {
      schemaVersion: 2,
      sampleId: plan.sampleId,
      split: plan.split,
      householdGroupId: plan.householdGroupId,
      templateId: plan.definition.template.id,
      templateVersion: plan.definition.template.version,
      condition: {
        id: plan.condition.id,
        startDate: plan.condition.startDate,
        days: resolvedOptions.days,
        minutesPerDay: resolvedOptions.minutesPerDay,
        seed: plan.condition.seed,
        requestedWeather: plan.condition.weather
      },
      intervention: plan.intervention,
      pairId: plan.pairId,
      expectedSemanticFeatures,
      cleanObservationCount: simulated.cleanEvents.length,
      observedObservationCount: faultResult.events.length,
      environmentDays: simulated.environmentDays,
      hourlyTruth: simulated.hourlyTruth,
      groundTruthEpisodes: groundTruth.episodes,
      groundTruthPatterns: groundTruth.patterns,
      positiveFeatureIds: groundTruth.positiveFeatureIds,
      faultLedger: faultResult.ledger,
      cleanFeatureInventory,
      observedFeatureInventory
    };

    writeJson(metadataPath, publicMetadata);
    writeJsonLines(observationsPath, faultResult.events);
    writeJson(templatePath, template);
    writeJson(truthPath, privateTruth);
    observationCount += faultResult.events.length;

    publicManifest.samples.push({
      sampleId: plan.sampleId,
      split: plan.split,
      householdGroupId: plan.householdGroupId,
      metadataPath: portableRelativePath(join(resolvedOptions.outputRoot, 'public'), metadataPath),
      observationsPath: portableRelativePath(join(resolvedOptions.outputRoot, 'public'), observationsPath)
    });
    privateManifest.samples.push({
      sampleId: plan.sampleId,
      split: plan.split,
      householdGroupId: plan.householdGroupId,
      intervention: plan.intervention,
      truthPath: portableRelativePath(join(resolvedOptions.outputRoot, 'private'), truthPath),
      templatePath: portableRelativePath(join(resolvedOptions.outputRoot, 'private'), templatePath)
    });
    privateSummaries.push({
      sampleId: plan.sampleId,
      split: plan.split,
      householdGroupId: plan.householdGroupId,
      intervention: plan.intervention,
      pairId: plan.pairId,
      expectedSemanticFeatures,
      cleanFeatureInventory,
      observedFeatureInventory
    });
  }

  writeJson(join(resolvedOptions.outputRoot, 'public', 'manifest.json'), publicManifest);
  writeJson(join(resolvedOptions.outputRoot, 'private', 'manifest.json'), privateManifest);
  writeJson(
    join(resolvedOptions.outputRoot, 'private', 'evaluation', 'intervention-report.json'),
    createInterventionReport(privateSummaries)
  );
  const validation = validateHomeMemoryBenchmark(resolvedOptions.outputRoot);
  const splitSampleCounts = countBySplit(publicManifest.samples);
  const householdGroupCounts = Object.fromEntries(splitNames.map((split) => [
    split,
    new Set(publicManifest.samples
      .filter((sample) => sample.split === split)
      .map((sample) => sample.householdGroupId)).size
  ])) as Record<HomeMemoryBenchmarkSplit, number>;

  return {
    outputRoot: resolvedOptions.outputRoot,
    schemaVersion: 2,
    daysPerSample: resolvedOptions.days,
    sampleCount: plans.length,
    observationCount,
    splitSampleCounts,
    householdGroupCounts,
    interventionPairCount: privateSummaries.filter((sample) => sample.intervention !== 'none').length,
    validation
  };
}

export function applyHomeMemoryBenchmarkObservationFaults(
  cleanEvents: DeviceValueEvent[],
  options: HomeMemoryBenchmarkFaultOptions
): HomeMemoryBenchmarkFaultResult {
  const settings = faultSettings(options.qualityProfile);
  const random = new SeededRandom(options.seed);
  const groups = groupEventsBySource(cleanEvents);
  const offlineWindow = createOfflineWindow(cleanEvents, groups, options.days, settings.offlineHours, random);
  const packetLossIds: string[] = [];
  const offlineIds: string[] = [];
  const delayedSourceEvents: HomeMemoryBenchmarkFaultLedger['latency']['delayedSourceEvents'] = [];
  const changedEvents: HomeMemoryBenchmarkFaultLedger['noise']['changedEvents'] = [];
  const observed: DeviceValueEvent[] = [];

  for (const group of groups) {
    const sourceEventId = group[0].sourceEventId;
    const groupTime = Date.parse(group[0].simTime);
    const isOffline = Boolean(
      offlineWindow.deviceId &&
      group[0].deviceId === offlineWindow.deviceId &&
      groupTime >= offlineWindow.startedAtMs &&
      groupTime <= offlineWindow.endedAtMs
    );
    if (isOffline) {
      offlineIds.push(sourceEventId);
      continue;
    }
    if (settings.packetLossRate > 0 && random.next() < settings.packetLossRate) {
      packetLossIds.push(sourceEventId);
      continue;
    }

    const delaySeconds = settings.latencyProbability > 0 && random.next() < settings.latencyProbability
      ? Math.max(1, Math.round(random.range(1, settings.maxLatencySeconds)))
      : 0;
    if (delaySeconds > 0) {
      delayedSourceEvents.push({ sourceEventId, delaySeconds });
    }

    for (const event of group) {
      const delayed = delaySeconds > 0
        ? { ...event, ts: shiftIsoTime(event.ts, delaySeconds) }
        : { ...event };
      if (
        typeof delayed.value === 'number' &&
        isNoiseEligibleField(delayed.field) &&
        settings.noiseProbability > 0 &&
        random.next() < settings.noiseProbability
      ) {
        const cleanValue = delayed.value;
        const absoluteScale = Math.max(Math.abs(cleanValue) * settings.noiseRelativeScale, 0.1);
        const noise = random.range(-absoluteScale, absoluteScale);
        const observedValue = roundNumber(cleanValue >= 0 ? Math.max(0, cleanValue + noise) : cleanValue + noise);
        delayed.value = observedValue;
        changedEvents.push({ eventId: event.id, cleanValue, observedValue });
      }
      observed.push(delayed);
    }
  }

  observed.sort((left, right) => (
    Date.parse(left.ts) - Date.parse(right.ts) ||
    left.sequence - right.sequence ||
    left.id.localeCompare(right.id)
  ));
  return {
    events: observed,
    ledger: {
      qualityProfile: options.qualityProfile,
      packetLoss: {
        rate: settings.packetLossRate,
        droppedSourceEventIds: packetLossIds
      },
      latency: {
        probability: settings.latencyProbability,
        maxSeconds: settings.maxLatencySeconds,
        delayedSourceEvents
      },
      noise: {
        probability: settings.noiseProbability,
        relativeScale: settings.noiseRelativeScale,
        changedEvents
      },
      deviceOffline: {
        deviceId: offlineWindow.deviceId,
        startedAt: offlineWindow.deviceId ? new Date(offlineWindow.startedAtMs).toISOString() : null,
        endedAt: offlineWindow.deviceId ? new Date(offlineWindow.endedAtMs).toISOString() : null,
        droppedSourceEventIds: offlineIds
      }
    }
  };
}

export function validateHomeMemoryBenchmark(outputRoot: string): HomeMemoryBenchmarkValidationResult {
  const absoluteRoot = resolve(outputRoot);
  const publicRoot = join(absoluteRoot, 'public');
  const privateRoot = join(absoluteRoot, 'private');
  const publicManifest = readJson<PublicManifest>(join(publicRoot, 'manifest.json'));
  const privateManifest = readJson<PrivateManifest>(join(privateRoot, 'manifest.json'));
  const privateBySample = new Map(privateManifest.samples.map((sample) => [sample.sampleId, sample]));
  const groupSplits = new Map<string, HomeMemoryBenchmarkSplit>();
  const householdGroups = {
    train: [] as string[],
    validation: [] as string[],
    blind: [] as string[]
  };
  let observationCount = 0;
  let truthLeakCount = 0;

  for (const sample of publicManifest.samples) {
    const priorSplit = groupSplits.get(sample.householdGroupId);
    if (priorSplit && priorSplit !== sample.split) {
      throw new Error(
        `Household group ${sample.householdGroupId} crosses splits ${priorSplit} and ${sample.split}`
      );
    }
    groupSplits.set(sample.householdGroupId, sample.split);
    if (!householdGroups[sample.split].includes(sample.householdGroupId)) {
      householdGroups[sample.split].push(sample.householdGroupId);
    }

    const metadataPath = resolveInside(publicRoot, sample.metadataPath);
    const observationsPath = resolveInside(publicRoot, sample.observationsPath);
    const metadata = readJson<Record<string, unknown>>(metadataPath);
    truthLeakCount += countForbiddenPublicKeys(metadata);
    const days = Number(metadata.days);
    if (!Number.isInteger(days) || days < 1 || days > 60) {
      throw new Error(`Sample ${sample.sampleId} has invalid duration ${String(metadata.days)}`);
    }
    const lines = readNonEmptyLines(observationsPath);
    for (const [lineIndex, line] of lines.entries()) {
      const event = JSON.parse(line) as Record<string, unknown>;
      const leakCount = countForbiddenPublicKeys(event);
      truthLeakCount += leakCount;
      if (leakCount > 0) {
        throw new Error(`Truth key leaked into ${sample.sampleId} observation line ${lineIndex + 1}`);
      }
    }
    observationCount += lines.length;
    if (!privateBySample.has(sample.sampleId)) {
      throw new Error(`Sample ${sample.sampleId} is missing private ground truth`);
    }
  }

  if (truthLeakCount > 0) {
    throw new Error(`Detected ${truthLeakCount} hidden-truth key(s) in public data`);
  }
  if (privateManifest.samples.length !== publicManifest.samples.length) {
    throw new Error('Public and private manifests have different sample counts');
  }
  for (const split of splitNames) {
    householdGroups[split].sort((left, right) => left.localeCompare(right));
  }

  return {
    sampleCount: publicManifest.samples.length,
    observationCount,
    householdGroups,
    interventionCount: privateManifest.samples.filter((sample) => sample.intervention !== 'none').length,
    truthLeakCount
  };
}

function resolveOptions(options: GenerateHomeMemoryBenchmarkOptions): Required<
  Omit<GenerateHomeMemoryBenchmarkOptions, 'onProgress'>
> & Pick<GenerateHomeMemoryBenchmarkOptions, 'onProgress'> {
  const days = options.days ?? 14;
  const minutesPerDay = options.minutesPerDay ?? 24 * 60;
  const conditionsPerTemplate = options.conditionsPerTemplate ?? 2;
  const templateLimit = options.templateLimit ?? createHomeMemoryBenchmarkTemplateCatalog().length;
  if (!Number.isInteger(days) || days < 1 || days > 60) {
    throw new Error(`days must be an integer from 1 to 60; received ${days}`);
  }
  if (!Number.isInteger(minutesPerDay) || minutesPerDay < 1 || minutesPerDay > 24 * 60) {
    throw new Error(`minutesPerDay must be an integer from 1 to 1440; received ${minutesPerDay}`);
  }
  if (
    !Number.isInteger(conditionsPerTemplate) ||
    conditionsPerTemplate < 1 ||
    conditionsPerTemplate > conditions.length
  ) {
    throw new Error(
      `conditionsPerTemplate must be an integer from 1 to ${conditions.length}; received ${conditionsPerTemplate}`
    );
  }
  if (!Number.isInteger(templateLimit) || templateLimit < 1) {
    throw new Error(`templateLimit must be a positive integer; received ${templateLimit}`);
  }
  return {
    outputRoot: resolve(options.outputRoot),
    days,
    minutesPerDay,
    conditionsPerTemplate,
    templateLimit,
    includeInterventions: options.includeInterventions ?? true,
    onProgress: options.onProgress
  };
}

function createSamplePlans(
  catalog: HomeMemoryBenchmarkTemplateDefinition[],
  options: ReturnType<typeof resolveOptions>
): BenchmarkSamplePlan[] {
  const counters: Record<HomeMemoryBenchmarkSplit, number> = {
    train: 0,
    validation: 0,
    blind: 0
  };
  const plans: BenchmarkSamplePlan[] = [];
  const anchors = new Map<HomeMemoryBenchmarkSplit, string>();
  for (const split of splitNames) {
    const anchor = catalog.find((definition) => (
      definition.split === split &&
      allInterventions.every((intervention) => (
        expectedHomeMemoryBenchmarkFeatures(definition).includes(targetFeatureForIntervention(intervention))
      ))
    ));
    if (anchor) {
      anchors.set(split, anchor.householdGroupId);
    }
  }

  const nextSampleId = (split: HomeMemoryBenchmarkSplit) => {
    counters[split] += 1;
    return `${split}_${counters[split].toString().padStart(4, '0')}`;
  };

  for (const [templateIndex, definition] of catalog.entries()) {
    const selectedConditions = Array.from(
      { length: options.conditionsPerTemplate },
      (_, conditionIndex) => conditions[(templateIndex + conditionIndex * 2) % conditions.length]
    );
    for (const [conditionIndex, sourceCondition] of selectedConditions.entries()) {
      const isAnchorPair = anchors.get(definition.split) === definition.householdGroupId && conditionIndex === 0;
      const condition = {
        ...sourceCondition,
        seed: sourceCondition.seed + numericGroupId(definition.householdGroupId) * 1000,
        ...(isAnchorPair ? { qualityProfile: 'clean' as const } : {})
      };
      const pairId = isAnchorPair
        ? `${definition.split}:${definition.householdGroupId}:${condition.id}`
        : null;
      plans.push({
        sampleId: nextSampleId(definition.split),
        split: definition.split,
        householdGroupId: definition.householdGroupId,
        definition,
        condition,
        intervention: 'none',
        pairId
      });
      if (!isAnchorPair || !options.includeInterventions) {
        continue;
      }
      for (const intervention of allInterventions) {
        plans.push({
          sampleId: nextSampleId(definition.split),
          split: definition.split,
          householdGroupId: definition.householdGroupId,
          definition: applyHomeMemoryBenchmarkIntervention(definition, intervention),
          condition,
          intervention,
          pairId
        });
      }
    }
  }
  return plans;
}

function simulateBenchmarkSample(
  plan: BenchmarkSamplePlan,
  template: HouseholdTemplate,
  days: number,
  minutesPerDay: number
): SimulatedBenchmarkSample {
  const cleanEvents: DeviceValueEvent[] = [];
  const twinEvents: TwinEvent[] = [];
  const hourlyTruth: BenchmarkHourlyTruth[] = [];
  const environmentDays: SimulatedBenchmarkSample['environmentDays'] = [];
  let carriedInventory: TwinSnapshot['worldState']['inventory'] | null = null;
  let nextSequence = 1;

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const date = addDays(plan.condition.startDate, dayOffset);
    const daySeed = plan.condition.seed + dayOffset;
    const compiledRun = compileHouseholdRun(
      template,
      { date, seed: daySeed },
      plan.definition.compilerOptions
    );
    const simulator = createSimulator({
      seed: daySeed,
      homeDefinition: compiledRun.homeDefinition,
      behaviors: plan.definition.compilerOptions.behaviors,
      automationPolicies: plan.definition.compilerOptions.automationPolicies
    });
    const startEvents = simulator.startCompiledHouseholdRun(compiledRun);
    if (carriedInventory) {
      const startSnapshot = simulator.getSnapshot();
      startSnapshot.worldState.inventory = structuredClone(carriedInventory);
      simulator.restoreCompiledHouseholdRun(compiledRun, startSnapshot, startEvents);
    }
    const dayEvents: TwinEvent[] = [...startEvents];
    let elapsedMinutes = 0;
    while (elapsedMinutes < minutesPerDay) {
      const step = Math.min(15, minutesPerDay - elapsedMinutes);
      dayEvents.push(...simulator.advanceMinutes(step));
      elapsedMinutes += step;
      if (elapsedMinutes % 60 === 0 || elapsedMinutes === minutesPerDay) {
        hourlyTruth.push(createHourlyTruth(simulator.getSnapshot()));
      }
    }

    const normalizedDayEvents = dayEvents.map((event) => {
      const sequence = nextSequence;
      nextSequence += 1;
      return {
        ...event,
        id: `${plan.sampleId}_evt_${sequence.toString().padStart(8, '0')}`,
        runId: plan.sampleId,
        sequence
      };
    }) as TwinEvent[];
    twinEvents.push(...normalizedDayEvents);
    cleanEvents.push(...projectDeviceValueEvents(normalizedDayEvents).map((event) => ({
      ...event,
      id: `${plan.sampleId}_value_${event.sequence.toString().padStart(8, '0')}_${event.deviceId}_${event.field}`,
      runId: plan.sampleId,
      simulationDayIndex: dayOffset,
      simulationDate: date
    })));
    environmentDays.push({
      date,
      season: compiledRun.environmentSnapshot.calendar.season,
      weather: {
        condition: compiledRun.environmentSnapshot.weather.condition,
        outdoorTemperatureC: compiledRun.environmentSnapshot.weather.outdoorTemperatureC,
        precipitationMm: compiledRun.environmentSnapshot.weather.precipitationMm
      },
      templateDigest: compiledRun.templateDigest
    });
    carriedInventory = structuredClone(advanceInventoryOneDay(simulator.getSnapshot().worldState.inventory, {
      peopleHomeCount: Object.values(simulator.getSnapshot().people)
        .filter((person) => person.kind === 'human' && person.location !== 'away').length,
      mealsCooked: dayEvents.filter((event) => (
        event.type === 'ActivityStarted' && event.activityId.includes(':meal:')
      )).length,
      petPresent: Object.values(simulator.getSnapshot().people)
        .some((person) => person.kind === 'pet' && person.location !== 'away')
    }));
  }

  cleanEvents.sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  return { cleanEvents, twinEvents, hourlyTruth, environmentDays };
}

function createHourlyTruth(snapshot: TwinSnapshot): BenchmarkHourlyTruth {
  return {
    simTime: snapshot.simClock.currentTime,
    homeMode: snapshot.homeState.mode,
    people: Object.fromEntries(Object.entries(snapshot.people).map(([personId, person]) => [
      personId,
      {
        kind: person.kind,
        location: person.location,
        activity: person.activity
      }
    ]))
  };
}

function extractFeatureInventory(
  events: DeviceValueEvent[],
  twinEvents: TwinEvent[]
): BenchmarkFeatureInventory {
  const memory = reduceDeviceEvents(createHomeMemory(), events);
  return {
    behaviorEpisodeKinds: sortedUnique(
      extractHomeBehaviorEpisodes(memory).map((episode) => episode.kind)
    ),
    inferenceFeatureIds: sortedUnique(
      extractHomeInferenceFeatures(memory).map((feature) => feature.id)
    ),
    profilePatternIds: Object.keys(memory.profilePatterns).sort((left, right) => left.localeCompare(right)),
    profileHypothesisIds: sortedUnique(
      createHomeProfileHypotheses(memory).map((hypothesis) => hypothesis.id)
    ),
    automationRuleIds: sortedUnique(twinEvents.flatMap((event) => (
      event.type === 'AutomationTriggered' ? [event.ruleId] : []
    )))
  };
}

function createInterventionReport(samples: PrivateSampleSummary[]): {
  schemaVersion: 2;
  comparisons: Array<Record<string, unknown>>;
} {
  const comparisons = samples
    .filter((sample) => sample.intervention !== 'none' && sample.pairId)
    .map((interventionSample) => {
      const baseline = samples.find((sample) => (
        sample.pairId === interventionSample.pairId && sample.intervention === 'none'
      ));
      if (!baseline) {
        throw new Error(`Missing baseline for intervention pair ${interventionSample.pairId}`);
      }
      const intervention = interventionSample.intervention as Exclude<HomeMemoryBenchmarkIntervention, 'none'>;
      const targetFeature = targetFeatureForIntervention(intervention);
      const baselineSignals = signalsForSemanticFeature(targetFeature, baseline.cleanFeatureInventory);
      const interventionSignals = signalsForSemanticFeature(targetFeature, interventionSample.cleanFeatureInventory);
      return {
        pairId: interventionSample.pairId,
        split: interventionSample.split,
        householdGroupId: interventionSample.householdGroupId,
        baselineSampleId: baseline.sampleId,
        interventionSampleId: interventionSample.sampleId,
        intervention,
        targetFeature,
        truthFeaturePresentInBaseline: baseline.expectedSemanticFeatures.includes(targetFeature),
        truthFeatureAbsentAfterIntervention: !interventionSample.expectedSemanticFeatures.includes(targetFeature),
        cleanExtractorSignalsInBaseline: baselineSignals,
        cleanExtractorSignalsAfterIntervention: interventionSignals,
        cleanExtractorFeatureDisappeared: baselineSignals.length > 0 && interventionSignals.length === 0
      };
    });
  return { schemaVersion: 2, comparisons };
}

function signalsForSemanticFeature(
  feature: HomeMemoryBenchmarkSemanticFeature,
  inventory: BenchmarkFeatureInventory
): string[] {
  const all = [
    ...inventory.behaviorEpisodeKinds.map((id) => `episode:${id}`),
    ...inventory.inferenceFeatureIds.map((id) => `feature:${id}`),
    ...inventory.profilePatternIds.map((id) => `pattern:${id}`),
    ...inventory.profileHypothesisIds.map((id) => `hypothesis:${id}`)
  ];
  if (feature === 'resident.child') {
    return all.filter((id) => id.toLowerCase().includes('child'));
  }
  if (feature === 'resident.pet') {
    return all.filter((id) => id.toLowerCase().includes('pet'));
  }
  if (feature === 'routine.remote_work') {
    return all.filter((id) => {
      const normalized = id.toLowerCase();
      return normalized.includes('remote_work') || normalized.includes('work_study') || normalized.includes('weekday_study');
    });
  }
  return inventory.automationRuleIds
    .filter((ruleId) => !mandatoryAutomationRules.has(ruleId))
    .map((ruleId) => `automation:${ruleId}`);
}

function withConditionWeather(
  source: HouseholdTemplate,
  weather: WeatherCondition
): HouseholdTemplate {
  const template = structuredClone(source);
  template.environment.weather = { mode: 'generated', condition: weather };
  return template;
}

function groupEventsBySource(events: DeviceValueEvent[]): DeviceValueEvent[][] {
  const groups = new Map<string, DeviceValueEvent[]>();
  for (const event of [...events].sort((left, right) => (
    left.sequence - right.sequence || left.id.localeCompare(right.id)
  ))) {
    groups.set(event.sourceEventId, [...(groups.get(event.sourceEventId) ?? []), event]);
  }
  return [...groups.values()];
}

function createOfflineWindow(
  events: DeviceValueEvent[],
  groups: DeviceValueEvent[][],
  days: number,
  offlineHours: number,
  random: SeededRandom
): {
  deviceId: string | null;
  startedAtMs: number;
  endedAtMs: number;
} {
  if (offlineHours <= 0 || events.length === 0) {
    return { deviceId: null, startedAtMs: 0, endedAtMs: 0 };
  }
  const counts = new Map<string, number>();
  for (const group of groups) {
    counts.set(group[0].deviceId, (counts.get(group[0].deviceId) ?? 0) + 1);
  }
  const candidates = [...counts.entries()]
    .filter(([, count]) => count >= 4)
    .map(([deviceId]) => deviceId)
    .sort((left, right) => left.localeCompare(right));
  if (candidates.length === 0) {
    return { deviceId: null, startedAtMs: 0, endedAtMs: 0 };
  }
  const deviceId = candidates[Math.floor(random.next() * candidates.length)];
  const startDate = events[0].simulationDate ?? events[0].simTime.slice(0, 10);
  const dayOffset = Math.min(days - 1, Math.floor(random.next() * Math.max(1, days)));
  const hour = 8 + Math.floor(random.next() * 8);
  const startedAtMs = Date.parse(`${addDays(startDate, dayOffset)}T${hour.toString().padStart(2, '0')}:00:00+08:00`);
  return {
    deviceId,
    startedAtMs,
    endedAtMs: startedAtMs + offlineHours * 60 * 60 * 1000
  };
}

function faultSettings(qualityProfile: HomeMemoryBenchmarkQualityProfile): {
  packetLossRate: number;
  latencyProbability: number;
  maxLatencySeconds: number;
  noiseProbability: number;
  noiseRelativeScale: number;
  offlineHours: number;
} {
  if (qualityProfile === 'clean') {
    return {
      packetLossRate: 0,
      latencyProbability: 0,
      maxLatencySeconds: 0,
      noiseProbability: 0,
      noiseRelativeScale: 0,
      offlineHours: 0
    };
  }
  if (qualityProfile === 'mild') {
    return {
      packetLossRate: 0.02,
      latencyProbability: 0.15,
      maxLatencySeconds: 90,
      noiseProbability: 0.08,
      noiseRelativeScale: 0.03,
      offlineHours: 3
    };
  }
  return {
    packetLossRate: 0.08,
    latencyProbability: 0.35,
    maxLatencySeconds: 300,
    noiseProbability: 0.2,
    noiseRelativeScale: 0.08,
    offlineHours: 8
  };
}

function isNoiseEligibleField(field: string): boolean {
  const normalized = field.replace(/[_\s-]+/g, '').toLowerCase();
  return ![
    'confidence',
    'remainingmin',
    'openminutes',
    'cycleminutes',
    'batterypercent',
    'positionpercent',
    'level'
  ].includes(normalized);
}

function shiftIsoTime(value: string, delaySeconds: number): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Cannot apply latency to invalid timestamp ${value}`);
  }
  return new Date(parsed + delaySeconds * 1000).toISOString();
}

function ensureFreshOutputRoot(outputRoot: string): void {
  if (!existsSync(outputRoot)) {
    return;
  }
  if (!statSync(outputRoot).isDirectory()) {
    throw new Error(`Benchmark output path is not a directory: ${outputRoot}`);
  }
  if (readdirSync(outputRoot).length > 0) {
    throw new Error(`Benchmark output directory must be empty: ${outputRoot}`);
  }
}

function createBenchmarkDirectories(outputRoot: string): void {
  for (const split of splitNames) {
    mkdirSync(join(outputRoot, 'public', split), { recursive: true });
    mkdirSync(join(outputRoot, 'private', 'ground-truth', split), { recursive: true });
    mkdirSync(join(outputRoot, 'private', 'templates', split), { recursive: true });
  }
  mkdirSync(join(outputRoot, 'private', 'evaluation'), { recursive: true });
}

function writeBenchmarkReadme(outputRoot: string): void {
  writeFileSync(join(outputRoot, 'README.md'), [
    '# Home Memory benchmark',
    '',
    '`public/` contains observation-only data. Its loader must never receive `private/`.',
    '',
    '`private/` contains Household Templates, hidden truth, corruption ledgers, and intervention evaluation.',
    '',
    'Household groups are assigned to exactly one of train, validation, or blind. Samples are never randomly split.',
    '',
    'Every sample is capped at 60 simulated days.',
    '',
    'Private ground truth includes simulator-derived episode boundaries, canonical patterns, and feature labels for quantitative evaluation.',
    '',
    'Run `npm run memory:benchmark:evaluate -- --root <dataset>` to write the private metrics report.',
    ''
  ].join('\n'), 'utf8');
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonLines(path: string, values: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, values.map((value) => JSON.stringify(value)).join('\n') + (values.length > 0 ? '\n' : ''), 'utf8');
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function readNonEmptyLines(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

function resolveInside(root: string, relativePath: string): string {
  const absolute = resolve(root, relativePath);
  const fromRoot = relative(root, absolute);
  if (fromRoot.startsWith(`..${sep}`) || fromRoot === '..' || fromRoot.includes(`${sep}..${sep}`)) {
    throw new Error(`Path escapes benchmark root: ${relativePath}`);
  }
  return absolute;
}

function portableRelativePath(root: string, target: string): string {
  return relative(root, target).split(sep).join('/');
}

function countForbiddenPublicKeys(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + countForbiddenPublicKeys(item), 0);
  }
  if (!value || typeof value !== 'object') {
    return 0;
  }
  return Object.entries(value).reduce((count, [key, item]) => (
    count + (forbiddenPublicKeys.has(key) ? 1 : 0) + countForbiddenPublicKeys(item)
  ), 0);
}

function countBySplit(
  samples: PublicManifest['samples']
): Record<HomeMemoryBenchmarkSplit, number> {
  return Object.fromEntries(splitNames.map((split) => [
    split,
    samples.filter((sample) => sample.split === split).length
  ])) as Record<HomeMemoryBenchmarkSplit, number>;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function roundNumber(value: number): number {
  return Number(value.toFixed(3));
}

function numericGroupId(groupId: string): number {
  const value = Number(groupId.replace(/\D+/g, ''));
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid household group id ${groupId}`);
  }
  return value;
}

function addDays(dateText: string, offset: number): string {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function parseCliArgs(args: string[]): GenerateHomeMemoryBenchmarkOptions {
  const options: GenerateHomeMemoryBenchmarkOptions = {
    outputRoot: join('data', 'home-memory-benchmark')
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--no-interventions') {
      options.includeInterventions = false;
      continue;
    }
    const [inlineKey, inlineValue] = arg.split('=', 2);
    const key = inlineKey;
    const value = inlineValue ?? args[index + 1];
    if (!key.startsWith('--') || value === undefined) {
      throw new Error(`Invalid benchmark argument near ${arg}`);
    }
    if (inlineValue === undefined) {
      index += 1;
    }
    if (key === '--output') options.outputRoot = value;
    else if (key === '--days') options.days = positiveInteger(value, key);
    else if (key === '--minutes-per-day') options.minutesPerDay = positiveInteger(value, key);
    else if (key === '--conditions-per-template') options.conditionsPerTemplate = positiveInteger(value, key);
    else if (key === '--template-limit') options.templateLimit = positiveInteger(value, key);
    else throw new Error(`Unknown benchmark argument ${key}`);
  }
  return options;
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
  try {
    const summary = generateHomeMemoryBenchmark({
      ...parseCliArgs(process.argv.slice(2)),
      onProgress: (message) => process.stderr.write(`${message}\n`)
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
