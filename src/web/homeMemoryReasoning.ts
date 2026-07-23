import type { DeviceEventValue } from './deviceEventSocket';
import { estimateHouseholdSizeFromMemory } from './homeHouseholdSizeEstimator';
import type { HomeMemory, MemoryEvidence } from './homeMemoryModel';
import type { ProfileHypothesis } from './homeProfiler';

export interface ReasoningMetric {
  label: string;
  value: string;
}

export interface ReasoningStep {
  label: string;
  detail: string;
  metrics?: ReasoningMetric[];
}

export interface EventEvidenceFlow {
  title: string;
  steps: ReasoningStep[];
  relatedHypotheses: ProfileHypothesis[];
}

export interface HypothesisReasoning {
  title: string;
  inputs: ReasoningMetric[];
  rule: string;
  result: string;
  steps: ReasoningStep[];
}

export interface WhiteBoxTraceRow {
  label: string;
  value: string;
  note?: string;
}

export interface WhiteBoxTraceSection {
  title: string;
  description: string;
  rows: WhiteBoxTraceRow[];
}

export interface HypothesisWhiteBoxTrace {
  title: string;
  conclusion: {
    label: string;
    type: ProfileHypothesis['type'];
    confidence: string;
    summary: string;
  };
  sections: WhiteBoxTraceSection[];
}

export function createEventEvidenceFlow(
  memory: HomeMemory,
  hypotheses: ProfileHypothesis[],
  event: MemoryEvidence | null
): EventEvidenceFlow | null {
  if (!event) {
    return null;
  }

  const fieldId = `${event.deviceId}:${event.field}`;
  const room = memory.rooms[event.roomId];
  const device = memory.devices[event.deviceId];
  const field = memory.fields[fieldId];
  const semanticSignals = memory.semanticSignals.filter((signal) => signal.sourceEvidenceIds.includes(event.id));
  const relatedSubjectIds = new Set([
    `room:${event.roomId}`,
    `device:${event.deviceId}`,
    `field:${event.deviceId}:${event.field}`
  ]);
  const relatedHypotheses = hypotheses.filter((hypothesis) => (
    hypothesis.subjectIds.some((subjectId) => relatedSubjectIds.has(subjectId))
  ));

  return {
    title: `${event.deviceId}.${event.field} changed to ${formatValue(event.value)}`,
    relatedHypotheses,
    steps: [
      {
        label: 'Device event',
        detail: `${event.roomId} reported ${event.deviceId}.${event.field} = ${formatValue(event.value)}. ${event.evidenceReason}`,
        metrics: [
          { label: 'Category', value: event.evidenceCategory.replaceAll('_', ' ') },
          { label: 'Strength', value: event.evidenceStrength },
          { label: 'Change', value: event.meaningfulChange ? 'meaningful' : 'telemetry' },
          { label: 'Profile weight', value: formatWeight(event.profileWeight) }
        ]
      },
      {
        label: 'Semantic signals',
        detail: semanticSignals.length > 0
          ? `${semanticSignals.length} semantic signal${plural(semanticSignals.length)} derived from this event: ${formatSignalTypes(semanticSignals.map((signal) => signal.type))}.`
          : 'No semantic signal was derived from this event, so it remains fact memory only.',
        metrics: [
          { label: 'Signals', value: String(semanticSignals.length) },
          { label: 'Types', value: semanticSignals.length > 0 ? formatSignalTypes(semanticSignals.map((signal) => signal.type)) : 'none' }
        ]
      },
      {
        label: 'Fact memory',
        detail: `${event.roomId} / ${event.deviceId} / ${event.field} now stores ${formatValue(field?.currentValue ?? event.value)}.`
      },
      {
        label: 'Evidence aggregate',
        detail: 'The event updates room, device, and field counters used by later profile rules.',
        metrics: [
          { label: 'Room events', value: String(room?.eventCount ?? 0) },
          { label: 'Device events', value: String(device?.eventCount ?? 0) },
          { label: 'Field events', value: String(field?.eventCount ?? 0) }
        ]
      },
      {
        label: 'Hypothesis update',
        detail: relatedHypotheses.length > 0
          ? `${relatedHypotheses.length} profile hypothesis${plural(relatedHypotheses.length)} now reference this event path.`
          : 'No profile hypothesis references this event path yet.'
      }
    ]
  };
}

export function createHypothesisReasoning(memory: HomeMemory, hypothesis: ProfileHypothesis): HypothesisReasoning {
  if (hypothesis.type === 'household_size') {
    return createHouseholdSizeReasoning(memory, hypothesis);
  }

  return {
    title: hypothesis.label,
    inputs: [
      { label: 'Evidence events', value: String(hypothesis.evidence.length) },
      { label: 'Subjects', value: String(hypothesis.subjectIds.length) }
    ],
    rule: ruleForHypothesisType(hypothesis.type),
    result: hypothesis.summary,
    steps: [
      {
        label: 'Collect evidence',
        detail: `${hypothesis.evidence.length} recent event${plural(hypothesis.evidence.length)} are attached to this hypothesis.`
      },
      {
        label: 'Map subjects',
        detail: `${hypothesis.subjectIds.length} graph subject${plural(hypothesis.subjectIds.length)} support this hypothesis.`
      },
      {
        label: 'Compute confidence',
        detail: `The current confidence is ${Math.round(hypothesis.confidence * 100)}%.`
      }
    ]
  };
}

export function createHypothesisWhiteBoxTrace(memory: HomeMemory, hypothesis: ProfileHypothesis): HypothesisWhiteBoxTrace {
  if (hypothesis.type === 'household_size') {
    return createHouseholdSizeWhiteBoxTrace(memory, hypothesis);
  }

  const relatedSignals = semanticSignalsForEvidence(memory, hypothesis.evidence);
  return {
    title: 'Why this conclusion was inferred',
    conclusion: conclusionForHypothesis(hypothesis),
    sections: compactSections([
      observedConclusionSection(hypothesis),
      directEvidenceSection(hypothesis.evidence),
      semanticInterpretationSection(relatedSignals),
      ruleInputsSection(hypothesis, relatedSignals),
      confidenceSection(hypothesis, confidenceRowsForHypothesis(hypothesis, relatedSignals)),
      missingEvidenceSection(hypothesis)
    ])
  };
}

function createHouseholdSizeReasoning(memory: HomeMemory, hypothesis: ProfileHypothesis): HypothesisReasoning {
  const estimate = estimateHouseholdSizeFromMemory(memory);
  const features = estimate.features;

  return {
    title: hypothesis.label,
    inputs: [
      { label: 'Estimate', value: estimate.label },
      { label: 'Lower bound', value: String(estimate.lowerBound) },
      { label: 'Distribution', value: formatDistribution(estimate.distribution) },
      { label: 'Concurrent rooms', value: String(features.concurrentActivity.roomCount) },
      { label: 'Sleep zones', value: String(features.recurringSleepZones.count) },
      { label: 'Shared sleep candidate', value: features.sharedSleepZones.strength === 'none' ? 'none' : `${features.sharedSleepZones.strength} / ${features.sharedSleepZones.count}` },
      { label: 'Routine clusters', value: String(features.routineClusters.count) },
      { label: 'Meaningful rooms', value: String(features.meaningfulRoomCount) },
      { label: 'Weighted evidence', value: formatWeight(features.meaningfulEvidenceWeight) },
      { label: 'Behavior episodes', value: String(features.behaviorEpisodeCount) },
      { label: 'Weak environment ratio', value: `${Math.round(features.environmentContextRatio * 100)}%` }
    ],
    rule: householdSizeRule(estimate),
    result: estimate.summary,
    steps: [
      {
        label: 'Find concurrent lower bound',
        detail: features.concurrentActivity.directOccupantCount
          ? `Direct occupancy evidence observed ${features.concurrentActivity.directOccupantCount} occupant${plural(features.concurrentActivity.directOccupantCount)}, setting a lower bound of ${features.concurrentActivity.lowerBound}.`
          : features.concurrentActivity.roomCount > 0
            ? `${features.concurrentActivity.roomCount} room${plural(features.concurrentActivity.roomCount)} had overlapping occupancy episodes near ${features.concurrentActivity.windowKey}; this is a soft concurrency candidate and does not raise the hard lower bound.`
            : 'No direct occupant count or overlapping occupancy episode was observed, so the lower bound remains 1.'
      },
      {
        label: 'Collect stable resident signals',
        detail: `${features.recurringSleepZones.count} sleep zone${plural(features.recurringSleepZones.count)}, ${features.routineClusters.count} routine cluster${plural(features.routineClusters.count)}, and ${formatSharedSleepCandidate(features.sharedSleepZones)} contribute resident-pattern evidence.`
      },
      {
        label: 'Score resident distribution',
        detail: `The estimator combines lower bound, room spread, sleep zones, shared sleep-zone candidates, routine clusters, and weak-context ratio into ${formatDistribution(estimate.distribution)}.`
      },
      {
        label: 'Attach evidence',
        detail: `${hypothesis.evidence.length} recent event${plural(hypothesis.evidence.length)} are attached as evidence.`
      }
    ]
  };
}

function createHouseholdSizeWhiteBoxTrace(memory: HomeMemory, hypothesis: ProfileHypothesis): HypothesisWhiteBoxTrace {
  const estimate = estimateHouseholdSizeFromMemory(memory);
  const features = estimate.features;
  const relatedSignals = semanticSignalsForEvidence(memory, hypothesis.evidence);

  return {
    title: 'Why this conclusion was inferred',
    conclusion: conclusionForHypothesis(hypothesis),
    sections: compactSections([
      observedConclusionSection(hypothesis),
      directEvidenceSection(hypothesis.evidence),
      semanticInterpretationSection(relatedSignals),
      {
        title: 'Aggregate features',
        description: 'Device-observed facts are compressed into resident-count features before scoring candidates.',
        rows: [
          { label: 'Lower bound', value: String(estimate.lowerBound), note: lowerBoundNote(estimate) },
          { label: 'Concurrent rooms', value: String(features.concurrentActivity.roomCount), note: features.concurrentActivity.windowKey ? `${formatList(features.concurrentActivity.rooms)} overlap near ${features.concurrentActivity.windowKey}; direct count ${features.concurrentActivity.directOccupantCount ?? 'unavailable'}` : `No overlapping occupancy episode; direct count ${features.concurrentActivity.directOccupantCount ?? 'unavailable'}.` },
          { label: 'Sleep zones', value: String(features.recurringSleepZones.count), note: formatListOrNone(features.recurringSleepZones.rooms) },
          { label: 'Shared sleep candidate', value: features.sharedSleepZones.strength, note: sharedSleepNote(features.sharedSleepZones) },
          { label: 'Routine clusters', value: String(features.routineClusters.count), note: formatListOrNone(features.routineClusters.clusters.map((cluster) => cluster.replaceAll('_', ' '))) },
          { label: 'Resident slots', value: String(features.residentSlots.count), note: formatListOrNone(features.residentSlots.slots.map((slot) => slot.replaceAll('_', ' '))) },
          { label: 'Meaningful rooms', value: String(features.meaningfulRoomCount), note: `${features.longWindowRoomCount} long-window room${plural(features.longWindowRoomCount)} included.` },
          { label: 'Weighted evidence', value: formatWeight(features.meaningfulEvidenceWeight), note: `${features.behaviorEpisodeCount} behavior episode${plural(features.behaviorEpisodeCount)} also contribute.` },
          { label: 'Environment weak-context ratio', value: formatPercent(features.environmentContextRatio), note: 'High ratios cap resident-count confidence.' }
        ]
      },
      {
        title: 'Candidate scoring',
        description: 'The estimator scores each resident count with the same lower-bound, room-spread, sleep-zone, routine, slot, and weak-context inputs, then normalizes the scores.',
        rows: estimate.scoring.residents.map((resident) => ({
          label: `${resident.count} resident${resident.count === 1 ? '' : 's'}`,
          value: formatPercent(resident.probability),
          note: `raw ${formatWeight(resident.rawScore)}, clamped ${formatWeight(resident.clampedScore)} / total ${formatWeight(estimate.scoring.totalScore)}. ${candidateScoreNote(resident.count, estimate)}`
        }))
      },
      {
        title: 'Score ledger',
        description: 'Every scoring term used by the resident-count estimator. Probability is clampedScore / totalScore after all terms are summed.',
        rows: estimate.scoring.residents.flatMap((resident) => [
          {
            label: `${resident.count} resident${resident.count === 1 ? '' : 's'} total`,
            value: formatWeight(resident.rawScore),
            note: `clamped ${formatWeight(resident.clampedScore)}; probability ${formatPercent(resident.probability)}`
          },
          ...resident.terms.map((term) => ({
            label: `${resident.count}R ${term.label}`,
            value: signedWeight(term.value),
            note: term.formula
          }))
        ])
      },
      confidenceSection(hypothesis, [
        {
          label: 'Estimator confidence',
          value: formatPercent(estimate.confidence),
          note: `min(sampleCap ${formatPercent(estimate.scoring.confidence.sampleCap)}, winningProbability ${formatPercent(estimate.scoring.confidence.winningProbability)} + 28% + lowerBoundBoost ${formatPercent(estimate.scoring.confidence.lowerBoundBoost)} - weakContextPenalty ${formatPercent(estimate.scoring.confidence.weakContextPenalty)}) = ${formatPercent(estimate.scoring.confidence.formulaValue)}`
        },
        { label: 'Confidence sample size', value: formatWeight(estimate.scoring.confidence.sampleSize), note: 'meaningfulEvidenceWeight + behaviorEpisodeCount + extra observed day/week counts' },
        { label: 'Winning count', value: `${estimate.scoring.confidence.winningCount} resident${estimate.scoring.confidence.winningCount === 1 ? '' : 's'}`, note: `highest normalized probability: ${formatPercent(estimate.scoring.confidence.winningProbability)}` },
        { label: 'UI confidence', value: formatPercent(hypothesis.confidence), note: 'The profile layer may cap confidence again when the behavior sample is still small.' },
        { label: 'Final confidence', value: formatPercent(hypothesis.confidence), note: 'The UI should treat this as probabilistic, not ground truth.' }
      ]),
      missingEvidenceSection(hypothesis)
    ])
  };
}

function householdSizeRule(estimate: ReturnType<typeof estimateHouseholdSizeFromMemory>): string {
  if (estimate.features.environmentContextRatio >= 0.8) {
    return 'Mostly weak environment context keeps household size confidence capped.';
  }
  if (estimate.features.sharedSleepZones.strength === 'medium') {
    return 'Shared main sleep-zone evidence raises larger-household probability without changing the hard resident lower bound.';
  }
  if (estimate.features.sharedSleepZones.strength === 'strong') {
    return 'Direct shared sleep-zone evidence can raise the resident lower bound before scoring the probability distribution.';
  }
  if (estimate.lowerBound >= 2) {
    return 'Concurrent room activity and sleep-zone signals establish a resident-count lower bound before scoring the probability distribution.';
  }
  return 'Sparse or non-overlapping activity keeps the lower bound at 1 while routine clusters shape the probability distribution.';
}

function ruleForHypothesisType(type: ProfileHypothesis['type']): string {
  if (type === 'daily_rhythm') return 'Group recent device events by written simulation time bucket.';
  if (type === 'room_habit') return 'Find the strongest activity bucket for each active room.';
  if (type === 'device_routine') return 'Look for rooms with multiple active devices and enough events.';
  if (type === 'presence_signal') return 'Use recent device activity across rooms as a weak presence signal.';
  return 'Use available device-only evidence to update this profile hypothesis.';
}

function conclusionForHypothesis(hypothesis: ProfileHypothesis): HypothesisWhiteBoxTrace['conclusion'] {
  return {
    label: hypothesis.label,
    type: hypothesis.type,
    confidence: formatPercent(hypothesis.confidence),
    summary: hypothesis.summary
  };
}

function observedConclusionSection(hypothesis: ProfileHypothesis): WhiteBoxTraceSection {
  return {
    title: 'Observed conclusion',
    description: 'The current profile conclusion selected in the memory graph.',
    rows: [
      { label: 'Conclusion', value: hypothesis.label, note: hypothesis.summary },
      { label: 'Type', value: hypothesis.type.replaceAll('_', ' ') },
      { label: 'Confidence', value: formatPercent(hypothesis.confidence), note: 'Confidence is bounded by evidence volume and the strength of direct observations.' },
      { label: 'Updated', value: formatTime(hypothesis.updatedAt) },
      { label: 'Subjects', value: String(hypothesis.subjectIds.length), note: formatListOrNone(hypothesis.subjectIds.slice(0, 6)) }
    ]
  };
}

function directEvidenceSection(evidence: MemoryEvidence[]): WhiteBoxTraceSection {
  return {
    title: 'Direct evidence',
    description: 'Raw device events attached to this conclusion. These are the observed inputs, not simulation-only truth.',
    rows: evidence.map((event) => ({
      label: `${event.deviceId}.${event.field}`,
      value: formatValue(event.value),
      note: `${formatTime(event.simTime)} ${event.roomId}, ${event.evidenceCategory.replaceAll('_', ' ')}, ${event.evidenceStrength}, weight ${formatWeight(event.profileWeight)}. ${event.evidenceReason}`
    }))
  };
}

function semanticInterpretationSection(signals: ReturnType<typeof semanticSignalsForEvidence>): WhiteBoxTraceSection {
  return {
    title: 'Semantic interpretation',
    description: 'Device events are normalized into semantic signals before higher-level profile rules read them.',
    rows: signals.map((signal) => ({
      label: signal.type.replaceAll('_', ' '),
      value: signal.roomId,
      note: `${formatTime(signal.simTime)} from ${signal.deviceId}.${signal.field}, ${signal.strength}, weight ${formatWeight(signal.profileWeight)}. ${signal.reason}`
    }))
  };
}

function ruleInputsSection(hypothesis: ProfileHypothesis, signals: ReturnType<typeof semanticSignalsForEvidence>): WhiteBoxTraceSection {
  const rooms = sortedUnique(hypothesis.evidence.map((event) => event.roomId));
  const devices = sortedUnique(hypothesis.evidence.map((event) => event.deviceId));
  const timeBuckets = sortedUnique(hypothesis.evidence.map((event) => event.timeBucket));
  const signalTypes = sortedUnique(signals.map((signal) => signal.type.replaceAll('_', ' ')));

  return {
    title: 'Rule inputs',
    description: ruleForHypothesisType(hypothesis.type),
    rows: [
      { label: 'Evidence events', value: String(hypothesis.evidence.length), note: `${formatWeight(totalEvidenceWeight(hypothesis.evidence))} total profile weight.` },
      { label: 'Rooms', value: String(rooms.length), note: formatListOrNone(rooms) },
      { label: 'Devices', value: String(devices.length), note: formatListOrNone(devices.slice(0, 8)) },
      { label: 'Time buckets', value: formatListOrNone(timeBuckets) },
      { label: 'Semantic signals', value: String(signals.length), note: formatListOrNone(signalTypes) },
      { label: 'Graph subjects', value: String(hypothesis.subjectIds.length), note: formatListOrNone(hypothesis.subjectIds.slice(0, 6)) }
    ]
  };
}

function confidenceSection(hypothesis: ProfileHypothesis, rows: WhiteBoxTraceRow[]): WhiteBoxTraceSection {
  return {
    title: 'Confidence calculation',
    description: 'Confidence is a bounded probability-style score. It should explain ranking and uncertainty, not identify people directly.',
    rows: rows.length > 0
      ? rows
      : [{ label: 'Final confidence', value: formatPercent(hypothesis.confidence), note: 'No extra calculation trace is available for this conclusion type yet.' }]
  };
}

function confidenceRowsForHypothesis(hypothesis: ProfileHypothesis, signals: ReturnType<typeof semanticSignalsForEvidence>): WhiteBoxTraceRow[] {
  return [
    { label: 'Direct evidence', value: String(hypothesis.evidence.length), note: `${formatWeight(totalEvidenceWeight(hypothesis.evidence))} weighted profile evidence.` },
    { label: 'Semantic signals', value: String(signals.length), note: `${formatWeight(totalSignalWeight(signals))} semantic signal weight.` },
    { label: 'Supporting evidence', value: String(hypothesis.supportingEvidence.length) },
    { label: 'Contradicting evidence', value: String(hypothesis.contradictingEvidence.length) },
    { label: 'Final confidence', value: formatPercent(hypothesis.confidence), note: 'The profile rule combines evidence volume, signal weight, and sample-size caps.' }
  ];
}

function missingEvidenceSection(hypothesis: ProfileHypothesis): WhiteBoxTraceSection {
  return {
    title: 'Missing or weak evidence',
    description: 'Items that would make this conclusion more stable or more precise.',
    rows: hypothesis.missingEvidence.map((item, index) => ({
      label: `Gap ${index + 1}`,
      value: item
    }))
  };
}

function semanticSignalsForEvidence(memory: HomeMemory, evidence: MemoryEvidence[]): HomeMemory['semanticSignals'] {
  const evidenceIds = new Set(evidence.map((event) => event.id));
  return memory.semanticSignals
    .filter((signal) => signal.sourceEvidenceIds.some((evidenceId) => evidenceIds.has(evidenceId)))
    .sort((left, right) => right.simTime.localeCompare(left.simTime) || left.id.localeCompare(right.id));
}

function compactSections(sections: WhiteBoxTraceSection[]): WhiteBoxTraceSection[] {
  return sections.filter((section) => section.rows.length > 0 || section.title === 'Semantic interpretation');
}

function lowerBoundNote(estimate: ReturnType<typeof estimateHouseholdSizeFromMemory>): string {
  const features = estimate.features;
  const parts = [
    `direct occupancy lower bound ${features.concurrentActivity.lowerBound}`,
    `${features.recurringSleepZones.count} sleep zone${plural(features.recurringSleepZones.count)}`
  ];
  if (features.sharedSleepZones.strength === 'strong') {
    parts.push('strong shared sleep-zone evidence can raise the bound');
  }
  return parts.join('; ');
}

function sharedSleepNote(candidate: ReturnType<typeof estimateHouseholdSizeFromMemory>['features']['sharedSleepZones']): string {
  if (candidate.strength === 'none') return 'No main sleep-zone sharing signal is available.';
  return `${formatList(candidate.rooms)}. ${candidate.reasons.join('; ')}`;
}

function candidateScoreNote(count: 1 | 2 | 3 | 4 | 5, estimate: ReturnType<typeof estimateHouseholdSizeFromMemory>): string {
  const features = estimate.features;
  const notes: string[] = [];
  if (count < estimate.lowerBound) {
    notes.push('below lower bound penalty');
  }
  if (count === estimate.lowerBound) {
    notes.push('matches lower bound');
  }
  if (features.routineClusters.count >= 4 && count >= 2) {
    notes.push('routine cluster support');
  }
  if (features.residentSlots.count >= 3 && count >= 2) {
    notes.push('resident slot support');
  }
  if (features.sharedSleepZones.strength !== 'none' && count === features.recurringSleepZones.count + features.sharedSleepZones.count) {
    notes.push(`${features.sharedSleepZones.strength} shared sleep-zone support`);
  }
  if (features.environmentContextRatio >= 0.8 && count > 1) {
    notes.push('weak environment context penalty');
  }
  return notes.length > 0 ? notes.join('; ') : 'baseline plus distance from aggregate feature estimates';
}

function formatValue(value: DeviceEventValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function formatWeight(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function signedWeight(value: number): string {
  const rounded = formatWeight(value);
  return value > 0 ? `+${rounded}` : rounded;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDistribution(distribution: ReturnType<typeof estimateHouseholdSizeFromMemory>['distribution']): string {
  return ([1, 2, 3, 4, 5] as const)
    .map((count) => `${count}:${Math.round(distribution[count] * 100)}%`)
    .join('/');
}

function formatSharedSleepCandidate(candidate: ReturnType<typeof estimateHouseholdSizeFromMemory>['features']['sharedSleepZones']): string {
  if (candidate.strength === 'none') return 'no shared main sleep-zone candidate';
  return `${candidate.strength} shared main sleep-zone candidate${plural(candidate.count)}`;
}

function formatSignalTypes(types: string[]): string {
  return [...new Set(types.map((type) => type.replaceAll('_', ' ')))]
    .sort((left, right) => left.localeCompare(right))
    .join(', ');
}

function formatTime(value: string): string {
  return value.includes('T') ? value.slice(11, 16) : value;
}

function formatList(values: string[]): string {
  return values.join(', ');
}

function formatListOrNone(values: string[]): string {
  return values.length > 0 ? formatList(values) : 'none';
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function totalEvidenceWeight(evidence: MemoryEvidence[]): number {
  return Number(evidence.reduce((total, event) => total + event.profileWeight, 0).toFixed(3));
}

function totalSignalWeight(signals: ReturnType<typeof semanticSignalsForEvidence>): number {
  return Number(signals.reduce((total, signal) => total + signal.profileWeight, 0).toFixed(3));
}

function plural(count: number): string {
  return count === 1 ? '' : 's';
}
