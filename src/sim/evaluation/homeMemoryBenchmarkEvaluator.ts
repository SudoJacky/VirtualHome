import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DeviceValueEvent } from '../../server/deviceEventStream';
import {
  extractHomeBehaviorEpisodes,
  type HomeBehaviorEpisode,
  type HomeBehaviorEpisodeKind
} from '../../web/homeBehaviorEpisodes';
import { extractHomeInferenceFeatures, type HomeInferenceFeature } from '../../web/homeInferenceFeatures';
import { createHomeMemory, reduceDeviceEvents, type HomeMemory } from '../../web/homeMemoryModel';
import {
  homeMemoryBenchmarkFeatureIds,
  homeMemoryBenchmarkPatternIds,
  truthPatternForFeature,
  type HomeMemoryBenchmarkFeatureId,
  type HomeMemoryBenchmarkGroundTruthEpisode,
  type HomeMemoryBenchmarkGroundTruthPattern,
  type HomeMemoryBenchmarkPatternId
} from './homeMemoryBenchmarkGroundTruth';
import type {
  HomeMemoryBenchmarkIntervention,
  HomeMemoryBenchmarkSplit
} from './homeMemoryBenchmarkTemplates';

export interface EvaluateHomeMemoryBenchmarkOptions {
  benchmarkRoot: string;
  outputPath?: string;
}

export interface BinaryPrediction {
  label: string;
  probability: number;
  truth: 0 | 1;
}

export interface BinaryCalibrationMetrics {
  brierScore: number;
  ece: number;
  bins: Array<{
    fromInclusive: number;
    toInclusive: number;
    count: number;
    meanConfidence: number;
    accuracy: number;
    calibrationGap: number;
  }>;
}

export interface CountMetrics {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface EpisodeMatch {
  truthEpisodeId: string;
  predictedEpisodeId: string;
  kind: HomeBehaviorEpisodeKind;
  overlapScore: number;
  startErrorMinutes: number;
  endErrorMinutes: number;
  startBoundaryCensored: boolean;
  endBoundaryCensored: boolean;
}

export interface EpisodeMetrics extends CountMetrics {
  byKind: Partial<Record<HomeBehaviorEpisodeKind, CountMetrics>>;
  matches: EpisodeMatch[];
  boundaryErrorMinutes: DistributionSummary;
  startBoundaryErrorMinutes: DistributionSummary;
  endBoundaryErrorMinutes: DistributionSummary;
}

export interface DistributionSummary {
  count: number;
  mean: number | null;
  median: number | null;
  p95: number | null;
}

export interface HomeMemoryBenchmarkSampleEvaluation {
  sampleId: string;
  split: HomeMemoryBenchmarkSplit;
  householdGroupId: string;
  intervention: HomeMemoryBenchmarkIntervention;
  evaluatedDays: number;
  episode: EpisodeMetrics;
  pattern: CountMetrics & {
    truthIds: HomeMemoryBenchmarkPatternId[];
    predictedIds: HomeMemoryBenchmarkPatternId[];
  };
  calibration: BinaryCalibrationMetrics & {
    predictions: BinaryPrediction[];
  };
  falsePositives: {
    featureCount: number;
    patternCount: number;
    totalCount: number;
    householdMonths: number;
    perHouseholdMonth: number;
  };
  timeToDetection: {
    checkpointResolutionDays: 1;
    features: DetectionRecord[];
    patterns: DetectionRecord[];
    featureSummary: DetectionSummary;
    patternSummary: DetectionSummary;
  };
  adjacentWindowStability: {
    windowDays: 7;
    windows: Array<{ from: string; to: string; conclusionIds: string[] }>;
    comparisons: Array<{ leftFrom: string; rightFrom: string; jaccard: number }>;
    score: DistributionSummary;
  };
  counterfactualSensitivity: {
    method: 'delete_feature_evidence';
    features: CounterfactualFeatureRecord[];
    probabilityDrop: DistributionSummary;
    disappearanceRate: number;
  };
}

export interface HomeMemoryBenchmarkEvaluationReport {
  schemaVersion: 2;
  generatedAt: string;
  benchmarkRoot: string;
  settings: {
    episodeIouThreshold: 0.5;
    pointBoundaryToleranceMinutes: 15;
    eceBinCount: 10;
    detectionCheckpointDays: 1;
    stabilityWindowDays: 7;
    patternVocabulary: readonly HomeMemoryBenchmarkPatternId[];
    featureVocabulary: readonly HomeMemoryBenchmarkFeatureId[];
  };
  overall: AggregateEvaluation;
  splits: Record<HomeMemoryBenchmarkSplit, AggregateEvaluation>;
  samples: HomeMemoryBenchmarkSampleEvaluation[];
}

interface AggregateEvaluation {
  sampleCount: number;
  episode: Omit<EpisodeMetrics, 'matches'>;
  pattern: CountMetrics;
  calibration: BinaryCalibrationMetrics;
  falsePositivesPerHouseholdMonth: number;
  timeToDetection: {
    feature: DetectionSummary;
    pattern: DetectionSummary;
  };
  adjacentWindowStability: DistributionSummary;
  counterfactualSensitivity: {
    probabilityDrop: DistributionSummary;
    disappearanceRate: number;
  };
}

interface DetectionRecord {
  label: string;
  truthFirstOccurrenceAt: string;
  detectedAt: string | null;
  delayHours: number | null;
  missed: boolean;
  earlyPrediction: boolean;
}

interface DetectionSummary {
  eligibleCount: number;
  detectedCount: number;
  missedCount: number;
  detectionRate: number;
  earlyPredictionCount: number;
  delayHours: DistributionSummary;
}

interface CounterfactualFeatureRecord {
  featureId: HomeMemoryBenchmarkFeatureId;
  removedEvidenceCount: number;
  probabilityBefore: number;
  probabilityAfter: number;
  probabilityDrop: number;
  disappeared: boolean;
}

interface PublicManifest {
  schemaVersion: number;
  samples: Array<{
    sampleId: string;
    split: HomeMemoryBenchmarkSplit;
    householdGroupId: string;
    metadataPath: string;
    observationsPath: string;
  }>;
}

interface PrivateManifest {
  schemaVersion: number;
  samples: Array<{
    sampleId: string;
    split: HomeMemoryBenchmarkSplit;
    householdGroupId: string;
    intervention: HomeMemoryBenchmarkIntervention;
    truthPath: string;
  }>;
}

interface PrivateTruth {
  schemaVersion: number;
  sampleId: string;
  split: HomeMemoryBenchmarkSplit;
  householdGroupId: string;
  intervention: HomeMemoryBenchmarkIntervention;
  condition: {
    days: number;
  };
  groundTruthEpisodes: HomeMemoryBenchmarkGroundTruthEpisode[];
  groundTruthPatterns: HomeMemoryBenchmarkGroundTruthPattern[];
  positiveFeatureIds: HomeMemoryBenchmarkFeatureId[];
}

interface PredictionSnapshot {
  memory: HomeMemory;
  episodes: HomeBehaviorEpisode[];
  features: HomeInferenceFeature[];
  patternIds: HomeMemoryBenchmarkPatternId[];
}

interface DailyPrediction {
  checkpointAt: string;
  featureIds: HomeMemoryBenchmarkFeatureId[];
  patternIds: HomeMemoryBenchmarkPatternId[];
}

const episodeKinds: HomeBehaviorEpisodeKind[] = [
  'door_access_episode',
  'cooking_episode',
  'sleep_episode',
  'work_study_episode',
  'laundry_episode',
  'vacuum_episode',
  'media_episode'
];
const splitNames: HomeMemoryBenchmarkSplit[] = ['train', 'validation', 'blind'];
const episodeIouThreshold = 0.5;
const pointBoundaryToleranceMinutes = 15;
const eceBinCount = 10;
const stabilityWindowDays = 7;

export function evaluateHomeMemoryBenchmark(
  options: EvaluateHomeMemoryBenchmarkOptions
): HomeMemoryBenchmarkEvaluationReport {
  const benchmarkRoot = resolve(options.benchmarkRoot);
  const publicRoot = join(benchmarkRoot, 'public');
  const privateRoot = join(benchmarkRoot, 'private');
  const publicManifest = readJson<PublicManifest>(join(publicRoot, 'manifest.json'));
  const privateManifest = readJson<PrivateManifest>(join(privateRoot, 'manifest.json'));
  if (publicManifest.schemaVersion !== 2 || privateManifest.schemaVersion !== 2) {
    throw new Error('Home Memory benchmark evaluator requires schemaVersion 2 ground truth');
  }
  const privateBySample = new Map(privateManifest.samples.map((sample) => [sample.sampleId, sample]));
  const samples = publicManifest.samples.map((sample) => {
    const privateSample = privateBySample.get(sample.sampleId);
    if (!privateSample) {
      throw new Error(`Missing private manifest entry for ${sample.sampleId}`);
    }
    const events = readJsonLines<DeviceValueEvent>(
      resolveInside(publicRoot, sample.observationsPath)
    );
    const truth = readJson<PrivateTruth>(
      resolveInside(privateRoot, privateSample.truthPath)
    );
    validateTruthPair(sample, privateSample, truth);
    return evaluateSample(events, truth);
  });
  const report: HomeMemoryBenchmarkEvaluationReport = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    benchmarkRoot,
    settings: {
      episodeIouThreshold,
      pointBoundaryToleranceMinutes,
      eceBinCount,
      detectionCheckpointDays: 1,
      stabilityWindowDays,
      patternVocabulary: homeMemoryBenchmarkPatternIds,
      featureVocabulary: homeMemoryBenchmarkFeatureIds
    },
    overall: aggregateEvaluations(samples),
    splits: Object.fromEntries(splitNames.map((split) => [
      split,
      aggregateEvaluations(samples.filter((sample) => sample.split === split))
    ])) as Record<HomeMemoryBenchmarkSplit, AggregateEvaluation>,
    samples
  };
  const outputPath = resolve(options.outputPath ?? join(
    privateRoot,
    'evaluation',
    'home-memory-metrics.json'
  ));
  ensureInside(privateRoot, outputPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

export function matchHomeMemoryBenchmarkEpisodes(
  truthEpisodes: HomeMemoryBenchmarkGroundTruthEpisode[],
  predictedEpisodes: HomeBehaviorEpisode[]
): EpisodeMetrics {
  const candidates = truthEpisodes.flatMap((truth) => predictedEpisodes
    .filter((predicted) => predicted.kind === truth.kind)
    .map((predicted) => ({
      truth,
      predicted,
      score: temporalOverlapScore(truth, predicted)
    }))
    .filter((candidate) => candidate.score >= episodeIouThreshold))
    .sort((left, right) => (
      right.score - left.score ||
      left.truth.startedAt.localeCompare(right.truth.startedAt) ||
      left.predicted.startedAt.localeCompare(right.predicted.startedAt)
    ));
  const usedTruth = new Set<string>();
  const usedPredicted = new Set<string>();
  const matches: EpisodeMatch[] = [];
  for (const candidate of candidates) {
    if (usedTruth.has(candidate.truth.id) || usedPredicted.has(candidate.predicted.id)) {
      continue;
    }
    usedTruth.add(candidate.truth.id);
    usedPredicted.add(candidate.predicted.id);
    matches.push({
      truthEpisodeId: candidate.truth.id,
      predictedEpisodeId: candidate.predicted.id,
      kind: candidate.truth.kind,
      overlapScore: round(candidate.score),
      startErrorMinutes: round(absoluteMinutesBetween(
        candidate.truth.startedAt,
        candidate.predicted.startedAt
      )),
      endErrorMinutes: round(absoluteMinutesBetween(
        candidate.truth.endedAt,
        candidate.predicted.endedAt
      )),
      startBoundaryCensored: candidate.truth.boundarySource === 'left_censored',
      endBoundaryCensored: candidate.truth.boundarySource === 'right_censored'
    });
  }
  const metrics = countMetrics(
    matches.length,
    predictedEpisodes.length - matches.length,
    truthEpisodes.length - matches.length
  );
  return {
    ...metrics,
    byKind: Object.fromEntries(episodeKinds.map((kind) => {
      const truthCount = truthEpisodes.filter((episode) => episode.kind === kind).length;
      const predictedCount = predictedEpisodes.filter((episode) => episode.kind === kind).length;
      const matchedCount = matches.filter((match) => match.kind === kind).length;
      return [kind, countMetrics(
        matchedCount,
        predictedCount - matchedCount,
        truthCount - matchedCount
      )];
    })),
    matches,
    boundaryErrorMinutes: summarizeDistribution(matches.flatMap((match) => (
      [
        ...(match.startBoundaryCensored ? [] : [match.startErrorMinutes]),
        ...(match.endBoundaryCensored ? [] : [match.endErrorMinutes])
      ]
    ))),
    startBoundaryErrorMinutes: summarizeDistribution(
      matches.flatMap((match) => (
        match.startBoundaryCensored ? [] : [match.startErrorMinutes]
      ))
    ),
    endBoundaryErrorMinutes: summarizeDistribution(
      matches.flatMap((match) => (
        match.endBoundaryCensored ? [] : [match.endErrorMinutes]
      ))
    )
  };
}

export function calculateSetMetrics(
  truthValues: Iterable<string>,
  predictedValues: Iterable<string>
): CountMetrics {
  const truth = new Set(truthValues);
  const predicted = new Set(predictedValues);
  const truePositive = [...predicted].filter((value) => truth.has(value)).length;
  return countMetrics(
    truePositive,
    predicted.size - truePositive,
    truth.size - truePositive
  );
}

export function calculateBinaryCalibration(
  predictions: BinaryPrediction[],
  binCount = eceBinCount
): BinaryCalibrationMetrics {
  if (!Number.isInteger(binCount) || binCount < 1) {
    throw new Error(`binCount must be a positive integer; received ${binCount}`);
  }
  if (predictions.length === 0) {
    return { brierScore: 0, ece: 0, bins: [] };
  }
  const binPredictions = Array.from({ length: binCount }, () => [] as BinaryPrediction[]);
  for (const prediction of predictions) {
    if (prediction.probability < 0 || prediction.probability > 1) {
      throw new Error(
        `Prediction probability for ${prediction.label} must be between 0 and 1`
      );
    }
    const index = Math.min(binCount - 1, Math.floor(prediction.probability * binCount));
    binPredictions[index].push(prediction);
  }
  const bins = binPredictions.flatMap((items, index) => {
    if (items.length === 0) {
      return [];
    }
    const meanConfidence = mean(items.map((item) => item.probability));
    const accuracy = mean(items.map((item) => item.truth));
    return [{
      fromInclusive: round(index / binCount),
      toInclusive: round((index + 1) / binCount),
      count: items.length,
      meanConfidence: round(meanConfidence),
      accuracy: round(accuracy),
      calibrationGap: round(Math.abs(meanConfidence - accuracy))
    }];
  });
  return {
    brierScore: round(mean(predictions.map((prediction) => (
      (prediction.probability - prediction.truth) ** 2
    )))),
    ece: round(bins.reduce((total, bin) => (
      total + bin.calibrationGap * bin.count / predictions.length
    ), 0)),
    bins
  };
}

export function jaccardSimilarity(
  leftValues: Iterable<string>,
  rightValues: Iterable<string>
): number {
  const left = new Set(leftValues);
  const right = new Set(rightValues);
  const union = new Set([...left, ...right]);
  if (union.size === 0) {
    return 1;
  }
  const intersectionCount = [...left].filter((value) => right.has(value)).length;
  return round(intersectionCount / union.size);
}

function evaluateSample(
  events: DeviceValueEvent[],
  truth: PrivateTruth
): HomeMemoryBenchmarkSampleEvaluation {
  const prediction = createPrediction(events);
  const truthPatternIds = truth.groundTruthPatterns.map((pattern) => pattern.id);
  const patternMetrics = calculateSetMetrics(truthPatternIds, prediction.patternIds);
  const featurePredictions = createFeaturePredictions(prediction.features, truth.positiveFeatureIds);
  const calibration = calculateBinaryCalibration(featurePredictions);
  const predictedFeatureIds = canonicalFeatureIds(prediction.features);
  const featureFalsePositiveCount = predictedFeatureIds
    .filter((featureId) => !truth.positiveFeatureIds.includes(featureId))
    .length;
  const patternFalsePositiveCount = prediction.patternIds
    .filter((patternId) => !truthPatternIds.includes(patternId))
    .length;
  const householdMonths = truth.condition.days / 30;
  const dailyPredictions = createDailyPredictions(events);
  const timeToDetection = createTimeToDetection(truth, dailyPredictions);
  const stability = createAdjacentWindowStability(events);
  const counterfactual = createCounterfactualSensitivity(events, prediction.features);

  return {
    sampleId: truth.sampleId,
    split: truth.split,
    householdGroupId: truth.householdGroupId,
    intervention: truth.intervention,
    evaluatedDays: truth.condition.days,
    episode: matchHomeMemoryBenchmarkEpisodes(
      truth.groundTruthEpisodes,
      prediction.episodes
    ),
    pattern: {
      ...patternMetrics,
      truthIds: [...truthPatternIds].sort(compareStrings),
      predictedIds: [...prediction.patternIds].sort(compareStrings)
    },
    calibration: {
      ...calibration,
      predictions: featurePredictions
    },
    falsePositives: {
      featureCount: featureFalsePositiveCount,
      patternCount: patternFalsePositiveCount,
      totalCount: featureFalsePositiveCount + patternFalsePositiveCount,
      householdMonths: round(householdMonths),
      perHouseholdMonth: householdMonths > 0
        ? round((featureFalsePositiveCount + patternFalsePositiveCount) / householdMonths)
        : 0
    },
    timeToDetection,
    adjacentWindowStability: stability,
    counterfactualSensitivity: counterfactual
  };
}

function createPrediction(events: DeviceValueEvent[]): PredictionSnapshot {
  const memory = reduceDeviceEvents(createHomeMemory(), events);
  const episodes = extractHomeBehaviorEpisodes(memory);
  return {
    memory,
    episodes,
    features: extractHomeInferenceFeatures(memory, episodes),
    patternIds: canonicalPatternIds(memory)
  };
}

function createFeaturePredictions(
  features: HomeInferenceFeature[],
  positiveFeatureIds: HomeMemoryBenchmarkFeatureId[]
): BinaryPrediction[] {
  return homeMemoryBenchmarkFeatureIds.map((featureId) => ({
    label: featureId,
    probability: featureProbability(features, featureId),
    truth: positiveFeatureIds.includes(featureId) ? 1 : 0
  }));
}

function createDailyPredictions(events: DeviceValueEvent[]): DailyPrediction[] {
  const byDate = groupEventsBySimulationDate(events);
  let memory = createHomeMemory();
  const predictions: DailyPrediction[] = [];
  for (const [date, dateEvents] of byDate) {
    memory = reduceDeviceEvents(memory, dateEvents);
    const episodes = extractHomeBehaviorEpisodes(memory);
    predictions.push({
      checkpointAt: latestTimestamp(
        dateEvents.map((event) => event.ts),
        `${date}T23:59:59.999Z`
      ),
      featureIds: canonicalFeatureIds(extractHomeInferenceFeatures(memory, episodes)),
      patternIds: canonicalPatternIds(memory)
    });
  }
  return predictions;
}

function createTimeToDetection(
  truth: PrivateTruth,
  predictions: DailyPrediction[]
): HomeMemoryBenchmarkSampleEvaluation['timeToDetection'] {
  const featureRecords = truth.positiveFeatureIds.map((featureId) => {
    const patternId = truthPatternForFeature(featureId);
    const pattern = truth.groundTruthPatterns.find((candidate) => candidate.id === patternId);
    if (!pattern) {
      throw new Error(`Positive feature ${featureId} is missing truth pattern ${patternId}`);
    }
    return detectionRecord(
      featureId,
      pattern.firstOccurrenceAt,
      predictions.find((prediction) => prediction.featureIds.includes(featureId))?.checkpointAt
    );
  });
  const patternRecords = truth.groundTruthPatterns.map((pattern) => detectionRecord(
    pattern.id,
    pattern.firstOccurrenceAt,
    predictions.find((prediction) => prediction.patternIds.includes(pattern.id))?.checkpointAt
  ));
  return {
    checkpointResolutionDays: 1,
    features: featureRecords,
    patterns: patternRecords,
    featureSummary: summarizeDetections(featureRecords),
    patternSummary: summarizeDetections(patternRecords)
  };
}

function detectionRecord(
  label: string,
  truthFirstOccurrenceAt: string,
  detectedAt: string | undefined
): DetectionRecord {
  if (!detectedAt) {
    return {
      label,
      truthFirstOccurrenceAt,
      detectedAt: null,
      delayHours: null,
      missed: true,
      earlyPrediction: false
    };
  }
  const rawDelayHours = (Date.parse(detectedAt) - Date.parse(truthFirstOccurrenceAt)) / 3_600_000;
  return {
    label,
    truthFirstOccurrenceAt,
    detectedAt,
    delayHours: round(Math.max(0, rawDelayHours)),
    missed: false,
    earlyPrediction: rawDelayHours < 0
  };
}

function createAdjacentWindowStability(
  events: DeviceValueEvent[]
): HomeMemoryBenchmarkSampleEvaluation['adjacentWindowStability'] {
  const byDate = groupEventsBySimulationDate(events);
  const dates = [...byDate.keys()];
  const windows: HomeMemoryBenchmarkSampleEvaluation['adjacentWindowStability']['windows'] = [];
  for (let index = 0; index < dates.length; index += stabilityWindowDays) {
    const windowDates = dates.slice(index, index + stabilityWindowDays);
    const windowEvents = windowDates.flatMap((date) => byDate.get(date) ?? []);
    const prediction = createPrediction(windowEvents);
    windows.push({
      from: windowDates[0],
      to: windowDates.at(-1) ?? windowDates[0],
      conclusionIds: [
        ...canonicalFeatureIds(prediction.features),
        ...prediction.patternIds.map((patternId) => `pattern:${patternId}`)
      ].sort(compareStrings)
    });
  }
  const comparisons = windows.slice(1).map((right, index) => {
    const left = windows[index];
    return {
      leftFrom: left.from,
      rightFrom: right.from,
      jaccard: jaccardSimilarity(left.conclusionIds, right.conclusionIds)
    };
  });
  return {
    windowDays: 7,
    windows,
    comparisons,
    score: summarizeDistribution(comparisons.map((comparison) => comparison.jaccard))
  };
}

function createCounterfactualSensitivity(
  events: DeviceValueEvent[],
  features: HomeInferenceFeature[]
): HomeMemoryBenchmarkSampleEvaluation['counterfactualSensitivity'] {
  const records = canonicalFeatureIds(features).map((featureId) => {
    const feature = features.find((candidate) => candidate.id === featureId);
    if (!feature) {
      throw new Error(`Missing feature ${featureId}`);
    }
    const evidenceIds = new Set(feature.evidenceIds);
    const counterfactualEvents = events.filter((event) => !evidenceIds.has(event.id));
    const counterfactual = createPrediction(counterfactualEvents);
    const probabilityAfter = featureProbability(counterfactual.features, featureId);
    return {
      featureId,
      removedEvidenceCount: events.length - counterfactualEvents.length,
      probabilityBefore: round(feature.confidence),
      probabilityAfter,
      probabilityDrop: round(feature.confidence - probabilityAfter),
      disappeared: probabilityAfter === 0
    };
  });
  return {
    method: 'delete_feature_evidence',
    features: records,
    probabilityDrop: summarizeDistribution(records.map((record) => record.probabilityDrop)),
    disappearanceRate: records.length > 0
      ? round(records.filter((record) => record.disappeared).length / records.length)
      : 0
  };
}

function aggregateEvaluations(
  samples: HomeMemoryBenchmarkSampleEvaluation[]
): AggregateEvaluation {
  const episodeCounts = sumCounts(samples.map((sample) => sample.episode));
  const episodeMatches = samples.flatMap((sample) => sample.episode.matches);
  const patternCounts = sumCounts(samples.map((sample) => sample.pattern));
  const predictions = samples.flatMap((sample) => sample.calibration.predictions);
  const householdMonths = samples.reduce((total, sample) => (
    total + sample.evaluatedDays / 30
  ), 0);
  const falsePositives = samples.reduce((total, sample) => (
    total + sample.falsePositives.totalCount
  ), 0);
  const counterfactualRecords = samples.flatMap((sample) => (
    sample.counterfactualSensitivity.features
  ));
  return {
    sampleCount: samples.length,
    episode: {
      ...episodeCounts,
      byKind: Object.fromEntries(episodeKinds.map((kind) => [
        kind,
        sumCounts(samples.map((sample) => (
          sample.episode.byKind[kind] ?? countMetrics(0, 0, 0)
        )))
      ])),
      boundaryErrorMinutes: summarizeDistribution(episodeMatches.flatMap((match) => (
        [
          ...(match.startBoundaryCensored ? [] : [match.startErrorMinutes]),
          ...(match.endBoundaryCensored ? [] : [match.endErrorMinutes])
        ]
      ))),
      startBoundaryErrorMinutes: summarizeDistribution(
        episodeMatches.flatMap((match) => (
          match.startBoundaryCensored ? [] : [match.startErrorMinutes]
        ))
      ),
      endBoundaryErrorMinutes: summarizeDistribution(
        episodeMatches.flatMap((match) => (
          match.endBoundaryCensored ? [] : [match.endErrorMinutes]
        ))
      )
    },
    pattern: patternCounts,
    calibration: calculateBinaryCalibration(predictions),
    falsePositivesPerHouseholdMonth: householdMonths > 0
      ? round(falsePositives / householdMonths)
      : 0,
    timeToDetection: {
      feature: summarizeDetections(samples.flatMap((sample) => sample.timeToDetection.features)),
      pattern: summarizeDetections(samples.flatMap((sample) => sample.timeToDetection.patterns))
    },
    adjacentWindowStability: summarizeDistribution(samples.flatMap((sample) => (
      sample.adjacentWindowStability.comparisons.map((comparison) => comparison.jaccard)
    ))),
    counterfactualSensitivity: {
      probabilityDrop: summarizeDistribution(counterfactualRecords.map((record) => (
        record.probabilityDrop
      ))),
      disappearanceRate: counterfactualRecords.length > 0
        ? round(counterfactualRecords.filter((record) => record.disappeared).length / counterfactualRecords.length)
        : 0
    }
  };
}

function temporalOverlapScore(
  truth: HomeMemoryBenchmarkGroundTruthEpisode,
  predicted: HomeBehaviorEpisode
): number {
  const truthStart = Date.parse(truth.startedAt);
  const truthEnd = Date.parse(truth.endedAt);
  const predictedStart = Date.parse(predicted.startedAt);
  const predictedEnd = Date.parse(predicted.endedAt);
  if ([truthStart, truthEnd, predictedStart, predictedEnd].some(Number.isNaN)) {
    return 0;
  }
  if (truth.boundarySource === 'right_censored') {
    const gap = Math.abs(truthStart - predictedStart) / 60000;
    return gap <= pointBoundaryToleranceMinutes
      ? 1 - gap / (pointBoundaryToleranceMinutes * 2)
      : 0;
  }
  if (truthStart === truthEnd || predictedStart === predictedEnd) {
    const gap = Math.abs(truthStart - predictedStart) / 60000;
    return gap <= pointBoundaryToleranceMinutes
      ? 1 - gap / (pointBoundaryToleranceMinutes * 2)
      : 0;
  }
  const intersection = Math.max(
    0,
    Math.min(truthEnd, predictedEnd) - Math.max(truthStart, predictedStart)
  );
  const union = Math.max(truthEnd, predictedEnd) - Math.min(truthStart, predictedStart);
  return union > 0 ? intersection / union : 0;
}

function countMetrics(
  truePositive: number,
  falsePositive: number,
  falseNegative: number
): CountMetrics {
  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);
  return {
    truePositive,
    falsePositive,
    falseNegative,
    precision: round(precision),
    recall: round(recall),
    f1: round(precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0)
  };
}

function sumCounts(values: CountMetrics[]): CountMetrics {
  return countMetrics(
    values.reduce((total, value) => total + value.truePositive, 0),
    values.reduce((total, value) => total + value.falsePositive, 0),
    values.reduce((total, value) => total + value.falseNegative, 0)
  );
}

function summarizeDetections(records: DetectionRecord[]): DetectionSummary {
  const detected = records.filter((record) => !record.missed);
  return {
    eligibleCount: records.length,
    detectedCount: detected.length,
    missedCount: records.length - detected.length,
    detectionRate: records.length > 0 ? round(detected.length / records.length) : 0,
    earlyPredictionCount: detected.filter((record) => record.earlyPrediction).length,
    delayHours: summarizeDistribution(detected.flatMap((record) => (
      record.delayHours === null ? [] : [record.delayHours]
    )))
  };
}

function summarizeDistribution(values: number[]): DistributionSummary {
  if (values.length === 0) {
    return { count: 0, mean: null, median: null, p95: null };
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    mean: round(mean(sorted)),
    median: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95))
  };
}

function canonicalFeatureIds(features: HomeInferenceFeature[]): HomeMemoryBenchmarkFeatureId[] {
  const allowed = new Set<string>(homeMemoryBenchmarkFeatureIds);
  return features
    .map((feature) => feature.id)
    .filter((featureId): featureId is HomeMemoryBenchmarkFeatureId => allowed.has(featureId))
    .sort(compareStrings);
}

function canonicalPatternIds(memory: HomeMemory): HomeMemoryBenchmarkPatternId[] {
  const allowed = new Set<string>(homeMemoryBenchmarkPatternIds);
  return Object.values(memory.patternCandidates)
    .filter((candidate) => candidate.supportDays > 0)
    .map((candidate) => candidate.id)
    .filter((patternId): patternId is HomeMemoryBenchmarkPatternId => allowed.has(patternId))
    .sort(compareStrings);
}

function featureProbability(
  features: HomeInferenceFeature[],
  featureId: HomeMemoryBenchmarkFeatureId
): number {
  return round(features.find((feature) => feature.id === featureId)?.confidence ?? 0);
}

function groupEventsBySimulationDate(
  events: DeviceValueEvent[]
): Map<string, DeviceValueEvent[]> {
  const grouped = new Map<string, DeviceValueEvent[]>();
  for (const event of events) {
    const date = event.simulationDate ?? event.simTime.slice(0, 10);
    grouped.set(date, [...(grouped.get(date) ?? []), event]);
  }
  return new Map([...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function validateTruthPair(
  publicSample: PublicManifest['samples'][number],
  privateSample: PrivateManifest['samples'][number],
  truth: PrivateTruth
): void {
  if (truth.schemaVersion !== 2) {
    throw new Error(`Sample ${truth.sampleId} has unsupported truth schema ${truth.schemaVersion}`);
  }
  if (
    publicSample.sampleId !== truth.sampleId ||
    privateSample.sampleId !== truth.sampleId ||
    publicSample.split !== truth.split ||
    privateSample.split !== truth.split ||
    publicSample.householdGroupId !== truth.householdGroupId ||
    privateSample.householdGroupId !== truth.householdGroupId
  ) {
    throw new Error(`Public/private truth mismatch for sample ${publicSample.sampleId}`);
  }
  if (
    !Array.isArray(truth.groundTruthEpisodes) ||
    !Array.isArray(truth.groundTruthPatterns) ||
    !Array.isArray(truth.positiveFeatureIds)
  ) {
    throw new Error(`Sample ${truth.sampleId} is missing quantitative ground truth`);
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function readJsonLines<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

function resolveInside(root: string, relativePath: string): string {
  const absolute = resolve(root, relativePath);
  ensureInside(root, absolute);
  return absolute;
}

function ensureInside(root: string, path: string): void {
  const fromRoot = relative(resolve(root), resolve(path));
  if (fromRoot.startsWith(`..${sep}`) || fromRoot === '..' || fromRoot.includes(`${sep}..${sep}`)) {
    throw new Error(`Path escapes private benchmark root: ${path}`);
  }
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 1;
}

function percentile(sortedValues: number[], quantile: number): number {
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * quantile) - 1)
  );
  return sortedValues[index];
}

function mean(values: number[]): number {
  return values.length > 0
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function absoluteMinutesBetween(left: string, right: string): number {
  return Math.abs(Date.parse(left) - Date.parse(right)) / 60000;
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function latestTimestamp(values: string[], fallback: string): string {
  if (values.length === 0) {
    return fallback;
  }
  return values.slice(1).reduce((latest, value) => (
    Date.parse(value) > Date.parse(latest) ? value : latest
  ), values[0]);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function parseCliArgs(args: string[]): EvaluateHomeMemoryBenchmarkOptions {
  const options: EvaluateHomeMemoryBenchmarkOptions = {
    benchmarkRoot: join('data', 'home-memory-benchmark')
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [key, inlineValue] = arg.split('=', 2);
    const value = inlineValue ?? args[index + 1];
    if (!key.startsWith('--') || value === undefined) {
      throw new Error(`Invalid evaluator argument near ${arg}`);
    }
    if (inlineValue === undefined) {
      index += 1;
    }
    if (key === '--root') options.benchmarkRoot = value;
    else if (key === '--output') options.outputPath = value;
    else throw new Error(`Unknown evaluator argument ${key}`);
  }
  return options;
}

function isCliEntry(): boolean {
  return pathToFileURL(resolve(process.argv[1] ?? '')).href === import.meta.url;
}

if (isCliEntry()) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const report = evaluateHomeMemoryBenchmark(options);
    process.stdout.write(`${JSON.stringify({
      reportPath: resolve(
        options.outputPath ??
        join(report.benchmarkRoot, 'private', 'evaluation', 'home-memory-metrics.json')
      ),
      overall: report.overall,
      splits: report.splits
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
