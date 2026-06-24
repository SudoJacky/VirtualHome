import type { DeviceEventValue } from './deviceEventSocket';
import type { HomeMemory, SemanticSignal } from './homeMemoryModel';
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

export function createSemanticSignalRows(memory: HomeMemory, limit = 8): SemanticSignalRow[] {
  return [...memory.semanticSignals]
    .sort((left, right) => right.simTime.localeCompare(left.simTime) || right.id.localeCompare(left.id))
    .slice(0, limit)
    .map(toSemanticSignalRow);
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

function formatValue(value: DeviceEventValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}
