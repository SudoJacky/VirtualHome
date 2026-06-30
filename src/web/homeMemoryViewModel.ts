import type { DeviceEventValue } from './deviceEventSocket';
import type { HomeMemory, SemanticSignal } from './homeMemoryModel';
import { createEventEvidenceFlow, createHypothesisWhiteBoxTrace, type HypothesisWhiteBoxTrace } from './homeMemoryReasoning';
import type { ProfileHypothesis } from './homeProfiler';

export interface SemanticSignalRow {
  id: string;
  typeLabel: string;
  location: string;
  source: string;
  value: string;
  strength: string;
  weight: string;
  time: string;
  reason: string;
}

export interface EvidenceExplanationSummary {
  supportingCount: number;
  contradictingCount: number;
  missingCount: number;
  missingItems: string[];
}

export interface MemoryDemoWalkthroughMetric {
  label: string;
  value: string;
}

export interface MemoryDemoWalkthroughStage {
  id: string;
  title: string;
  talkTrack: string;
  evidence: string;
  reference: string;
  metrics: MemoryDemoWalkthroughMetric[];
}

export interface MemoryDemoWalkthrough {
  title: string;
  subject: string;
  summary: string;
  stages: MemoryDemoWalkthroughStage[];
}

export function createSemanticSignalRows(memory: HomeMemory, limit = 8): SemanticSignalRow[] {
  return [...memory.semanticSignals]
    .sort((left, right) => right.simTime.localeCompare(left.simTime) || right.id.localeCompare(left.id))
    .slice(0, limit)
    .map(toSemanticSignalRow);
}

export function createMemoryDemoWalkthrough(
  memory: HomeMemory,
  hypotheses: ProfileHypothesis[],
  selectedHypothesis: ProfileHypothesis | null
): MemoryDemoWalkthrough {
  const hypothesis = selectedHypothesis ?? hypotheses.find((candidate) => candidate.type === 'household_size') ?? hypotheses[0] ?? null;
  const eventFlow = createEventEvidenceFlow(memory, hypotheses, memory.recentEvents[0] ?? null);
  const trace = hypothesis ? createHypothesisWhiteBoxTrace(memory, hypothesis) : null;
  const eventStep = eventFlow?.steps.find((step) => step.label === 'Device event');
  const semanticStep = eventFlow?.steps.find((step) => step.label === 'Semantic signals');
  const factStep = eventFlow?.steps.find((step) => step.label === 'Fact memory');
  const aggregateStep = eventFlow?.steps.find((step) => step.label === 'Evidence aggregate');
  const scoreLedger = trace ? whiteBoxSection(trace, 'Score ledger') : null;

  return {
    title: 'Presenter walkthrough',
    subject: hypothesis?.label ?? 'Waiting for profile hypothesis',
    summary: 'Follow these stages during a demo: observed device event, evidence classification, fact memory, semantic meaning, episode compression, profile conclusion, and transparent calculation.',
    stages: [
      {
        id: 'device-event-stream',
        title: '1. Device event stream',
        talkTrack: 'Start by saying memory only consumes /ws/device-events: device field value changes with room, device, field, value, run, sequence, and simulation time.',
        evidence: eventFlow?.title ?? 'No device event has arrived yet.',
        reference: 'Input boundary',
        metrics: [
          { label: 'Events', value: String(memory.totalEvents) },
          { label: 'Run', value: memory.runId ?? 'none' },
          { label: 'Latest sequence', value: memory.recentEvents[0] ? String(memory.recentEvents[0].sequence) : 'none' }
        ]
      },
      {
        id: 'evidence-classification',
        title: '2. Evidence classification',
        talkTrack: 'Then explain that each device value is classified into behavior strength and profile weight. Human activity and active device usage count more than weak environment context.',
        evidence: eventStep?.detail ?? 'Waiting for an event classification.',
        reference: 'classifyDeviceEvidence',
        metrics: eventStep?.metrics ?? []
      },
      {
        id: 'fact-memory',
        title: '3. Fact memory',
        talkTrack: 'Next show that the event is stored as fact memory at field, device, room, and home levels before any high-level conclusion is made.',
        evidence: factStep?.detail ?? 'No fact memory row has been updated yet.',
        reference: 'Field / Device / Room / Home memory',
        metrics: aggregateStep?.metrics ?? [
          { label: 'Rooms', value: String(Object.keys(memory.rooms).length) },
          { label: 'Devices', value: String(Object.keys(memory.devices).length) },
          { label: 'Fields', value: String(Object.keys(memory.fields).length) }
        ]
      },
      {
        id: 'semantic-interpretation',
        title: '4. Semantic interpretation',
        talkTrack: 'After facts are stored, meaningful events are translated into semantic signals such as presence, access, sleep, cooking, media, climate, or environment.',
        evidence: semanticStep?.detail ?? 'No semantic signal was derived from the latest event.',
        reference: 'Semantic signals',
        metrics: [
          { label: 'Semantic signals', value: String(memory.semanticSignalCount) },
          { label: 'Recent semantic types', value: recentSignalTypes(memory) }
        ]
      },
      {
        id: 'episodes-and-summaries',
        title: '5. Episodes and summaries',
        talkTrack: 'Then explain that high-frequency device events are compressed into behavior episodes, while daily and weekly summaries preserve longer-window activity.',
        evidence: 'Episodes reduce repeated sensor noise; daily and weekly summaries keep long-window rooms, devices, fields, time buckets, and meaningful activity.',
        reference: 'Episodes and daily/weekly summaries',
        metrics: [
          { label: 'Episodes', value: String(memory.episodeCount) },
          { label: 'Activity episodes', value: String(memory.activityEpisodeCount) },
          { label: 'Days', value: String(memory.dailySummaryCount) },
          { label: 'Weeks', value: String(memory.weeklySummaryCount) }
        ]
      },
      {
        id: 'profile-hypothesis',
        title: '6. Profile hypothesis',
        talkTrack: hypothesis
          ? `Now present the selected conclusion, "${hypothesis.label}", as a probabilistic profile hypothesis rather than ground truth.`
          : 'Once enough evidence arrives, memory creates probabilistic profile hypotheses.',
        evidence: hypothesis?.summary ?? 'No profile hypothesis has been inferred yet.',
        reference: 'Profile hypotheses',
        metrics: hypothesis
          ? [
              { label: 'Type', value: hypothesis.type.replaceAll('_', ' ') },
              { label: 'Confidence', value: `${Math.round(hypothesis.confidence * 100)}%` },
              { label: 'Evidence rows', value: String(hypothesis.evidence.length) }
            ]
          : []
      },
      {
        id: 'white-box-calculation',
        title: '7. White-box calculation',
        talkTrack: 'Finish by opening the white-box sections: direct evidence, semantic interpretation, aggregate features, candidate scoring, score ledger, confidence, and missing evidence.',
        evidence: trace ? trace.sections.map((section) => section.title).join(' -> ') : 'No white-box trace is available yet.',
        reference: 'White-box trace and complete ledger',
        metrics: trace
          ? [
              { label: 'Trace sections', value: String(trace.sections.length) },
              { label: 'Score ledger rows', value: String(scoreLedger?.rows.length ?? 0) }
            ]
          : []
      }
    ]
  };
}

export function createEvidenceExplanationSummary(hypothesis: ProfileHypothesis): EvidenceExplanationSummary {
  return {
    supportingCount: hypothesis.supportingEvidence.length,
    contradictingCount: hypothesis.contradictingEvidence.length,
    missingCount: hypothesis.missingEvidence.length,
    missingItems: hypothesis.missingEvidence
  };
}

function toSemanticSignalRow(signal: SemanticSignal): SemanticSignalRow {
  return {
    id: signal.id,
    typeLabel: signal.type.replaceAll('_', ' '),
    location: signal.roomId,
    source: `${signal.deviceId}.${signal.field}`,
    value: formatValue(signal.value),
    strength: signal.strength,
    weight: Number(signal.profileWeight.toFixed(2)).toString(),
    time: signal.simTime,
    reason: signal.reason
  };
}

function whiteBoxSection(trace: HypothesisWhiteBoxTrace, title: string): HypothesisWhiteBoxTrace['sections'][number] | null {
  return trace.sections.find((section) => section.title === title) ?? null;
}

function recentSignalTypes(memory: HomeMemory): string {
  const types = [...new Set(memory.semanticSignals.slice(0, 8).map((signal) => signal.type.replaceAll('_', ' ')))];
  return types.length > 0 ? types.join(', ') : 'none';
}

function formatValue(value: DeviceEventValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}
