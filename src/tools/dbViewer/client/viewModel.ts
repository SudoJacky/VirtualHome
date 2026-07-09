import type {
  DbViewerAgentProfileEntrySummary,
  DbViewerDeviceEvent,
  DbViewerHomeMemoryItem,
  DbViewerSourceResolution
} from '../types';

export interface AgentProfileTableRow {
  id: string;
  title: string;
  subject: string;
  entryType: string;
  status: string;
  confidence: string;
  stability: string;
  updatedAt: string;
}

export interface HomeMemoryTableRow {
  id: string;
  primary: string;
  secondary: string;
  metric: string;
  count: string;
}

export interface DeviceEventTableRow {
  id: string;
  sourceEventId: string;
  simTime: string;
  room: string;
  device: string;
  field: string;
  value: string;
}

export type HomeMemorySection = 'evidence' | 'hypotheses' | 'portrait';

export function createAgentProfileRows(entries: DbViewerAgentProfileEntrySummary[]): AgentProfileTableRow[] {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    subject: `${entry.subjectType}:${entry.subjectId}`,
    entryType: entry.entryType,
    status: entry.status,
    confidence: formatNumber(entry.confidence),
    stability: entry.stability,
    updatedAt: formatDateTime(entry.updatedAt)
  }));
}

export function createHomeMemoryRows(section: HomeMemorySection, items: DbViewerHomeMemoryItem[]): HomeMemoryTableRow[] {
  return items.map((item) => {
    if (section === 'evidence') {
      return {
        id: item.id,
        primary: String(item.deviceId ?? item.id),
        secondary: `${String(item.roomId ?? '')} ${String(item.field ?? '')}`.trim(),
        metric: formatNumber(Number(item.profileWeight ?? 0)),
        count: String(item.sequence ?? '')
      };
    }
    if (section === 'hypotheses') {
      return {
        id: item.id,
        primary: String(item.type ?? item.id),
        secondary: String(item.summary ?? ''),
        metric: formatNumber(Number(item.confidence ?? 0)),
        count: String(Array.isArray(item.evidenceIds) ? item.evidenceIds.length : 0)
      };
    }
    return {
      id: item.id,
      primary: String(item.sectionId ?? item.id),
      secondary: String(item.summary ?? ''),
      metric: formatNumber(Number(item.confidence ?? 0)),
      count: String(Array.isArray(item.evidenceIds) ? item.evidenceIds.length : 0)
    };
  });
}

export function createDeviceEventRows(items: DbViewerDeviceEvent[]): DeviceEventTableRow[] {
  return items.map((item) => ({
    id: item.id,
    sourceEventId: item.sourceEventId,
    simTime: item.simTime,
    room: item.roomId,
    device: item.deviceId,
    field: item.field,
    value: typeof item.value === 'string' ? item.value : JSON.stringify(item.value)
  }));
}

export function describeSourceResolution(resolution: DbViewerSourceResolution): string {
  if (resolution.status === 'found') {
    return `Found ${resolution.sourceType} ${resolution.item.id}`;
  }
  return `Missing ${resolution.sourceType} ${resolution.sourceId} in ${resolution.homeId}/${resolution.runId ?? 'any run'}`;
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '';
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString().slice(0, 16).replace('T', ' ');
}
