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
        detail: features.concurrentActivity.roomCount > 0
          ? `${features.concurrentActivity.roomCount} active room${plural(features.concurrentActivity.roomCount)} co-occurred in window ${features.concurrentActivity.windowKey}, setting a lower bound of ${features.concurrentActivity.lowerBound}.`
          : 'No concurrent meaningful activity window was observed, so the lower bound remains 1.'
      },
      {
        label: 'Collect stable resident signals',
        detail: `${features.recurringSleepZones.count} sleep zone${plural(features.recurringSleepZones.count)} and ${features.routineClusters.count} routine cluster${plural(features.routineClusters.count)} contribute resident-pattern evidence.`
      },
      {
        label: 'Score resident distribution',
        detail: `The estimator combines lower bound, room spread, sleep zones, routine clusters, and weak-context ratio into ${formatDistribution(estimate.distribution)}.`
      },
      {
        label: 'Attach evidence',
        detail: `${hypothesis.evidence.length} recent event${plural(hypothesis.evidence.length)} are attached as evidence.`
      }
    ]
  };
}

function householdSizeRule(estimate: ReturnType<typeof estimateHouseholdSizeFromMemory>): string {
  if (estimate.features.environmentContextRatio >= 0.8) {
    return 'Mostly weak environment context keeps household size confidence capped.';
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

function formatValue(value: DeviceEventValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function formatWeight(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function formatDistribution(distribution: ReturnType<typeof estimateHouseholdSizeFromMemory>['distribution']): string {
  return ([1, 2, 3, 4, 5] as const)
    .map((count) => `${count}:${Math.round(distribution[count] * 100)}%`)
    .join('/');
}

function plural(count: number): string {
  return count === 1 ? '' : 's';
}
