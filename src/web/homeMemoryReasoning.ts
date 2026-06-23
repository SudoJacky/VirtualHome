import type { DeviceEventValue } from './deviceEventSocket';
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
  const meaningfulRooms = Object.values(memory.rooms).filter((room) => meaningfulWeightOfRoom(room) > 0);
  const activeRoomCount = meaningfulRooms.length;
  const weightedEvidence = meaningfulRooms.reduce((total, room) => total + meaningfulWeightOfRoom(room), 0);
  const totalEvents = memory.totalEvents;
  const sparseEvidence = weightedEvidence <= 3;
  const result = sparseEvidence
    ? 'Uncertain resident count'
    : estimateHouseholdSize(activeRoomCount, weightedEvidence);

  return {
    title: hypothesis.label,
    inputs: [
      { label: 'Meaningful rooms', value: String(activeRoomCount) },
      { label: 'Weighted evidence', value: formatWeight(weightedEvidence) },
      { label: 'Raw events', value: String(totalEvents) }
    ],
    rule: householdSizeRule(activeRoomCount, weightedEvidence),
    result,
    steps: [
      {
        label: 'Collect room activity',
        detail: `${activeRoomCount} room${plural(activeRoomCount)} have meaningful human activity or device usage evidence.`
      },
      {
        label: 'Count observed events',
        detail: `${totalEvents} raw device event${plural(totalEvents)} reduce to ${formatWeight(weightedEvidence)} weighted profile evidence.`
      },
      {
        label: 'Evaluate household size rule',
        detail: householdSizeRule(activeRoomCount, totalEvents)
      },
      {
        label: 'Attach evidence',
        detail: `${hypothesis.evidence.length} recent event${plural(hypothesis.evidence.length)} are attached as evidence.`
      }
    ]
  };
}

function householdSizeRule(activeRoomCount: number, totalEvents: number): string {
  if (activeRoomCount >= 5 && totalEvents >= 20) {
    return 'If active rooms >= 5 and total events >= 20, suggest 2-5 residents.';
  }
  if (totalEvents <= 3) {
    return 'Sparse evidence keeps the resident count uncertain.';
  }
  return 'Otherwise default to a broad 1-3 resident range.';
}

function meaningfulWeightOfRoom(room: HomeMemory['rooms'][string]): number {
  const weakContextWeight = room.profileEvidenceByCategory.environment_context * 0.05;
  return Math.max(0, Number((room.profileEvidenceWeight - weakContextWeight).toFixed(3)));
}

function estimateHouseholdSize(activeRoomCount: number, totalEvents: number): string {
  if (activeRoomCount >= 5 && totalEvents >= 20) {
    return '2-5 residents';
  }
  if (activeRoomCount <= 1 && totalEvents <= 3) {
    return '1 resident';
  }
  return '1-3 residents';
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

function plural(count: number): string {
  return count === 1 ? '' : 's';
}
