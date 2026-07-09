export type DbViewerStatus = 'ok' | 'unhealthy';
export type DbViewerSourceType =
  | 'home_memory_evidence'
  | 'home_memory_hypothesis'
  | 'home_memory_portrait_section'
  | 'device_event_query'
  | 'user_statement'
  | 'agent_reasoning'
  | 'manual_review';

export interface DbViewerHealth {
  status: DbViewerStatus;
  homeMemoryDatabasePath: string;
  agentProfileDatabasePath: string;
  deviceEventsDatabasePath: string | null;
  deviceEventsAvailable: boolean;
  missingTables: string[];
}

export interface DbViewerAgentProfileEntrySummary {
  id: string;
  homeId: string;
  subjectType: string;
  subjectId: string;
  entryType: string;
  title: string;
  summary: string;
  status: string;
  confidence: number;
  stability: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  matchChannels?: Array<'fts'>;
}

export interface DbViewerAgentProfileSource {
  id: string;
  entryId: string;
  sourceType: DbViewerSourceType;
  sourceId: string;
  homeId: string;
  runId: string | null;
  sequence: number | null;
  quoteOrObservation: string | null;
  weight: number;
  createdAt: string;
}

export interface DbViewerAgentProfileEvent {
  id: string;
  entryId: string;
  eventType: string;
  actor: string;
  before: unknown;
  after: unknown;
  reason: string;
  createdAt: string;
}

export interface DbViewerClaimIndex {
  claimType: string;
  predicate: string;
  objectType: string | null;
  objectId: string | null;
  objectValue: unknown;
  status: string;
  confidence: number;
  stability: string;
  updatedAt: string;
}

export interface DbViewerTimeWindow {
  id: string;
  entryId: string;
  dayType: string;
  daysOfWeek: number[] | null;
  timeStart: string | null;
  timeEnd: string | null;
  timezone: string;
  recurrence: string;
  validFrom: string | null;
  validTo: string | null;
}

export interface DbViewerAgentProfileEntryDetail extends DbViewerAgentProfileEntrySummary {
  content: Record<string, unknown>;
  sources: DbViewerAgentProfileSource[];
  events: DbViewerAgentProfileEvent[];
  claimIndex: DbViewerClaimIndex | null;
  timeWindows: DbViewerTimeWindow[];
}

export interface DbViewerRun {
  homeId: string;
  runId: string;
  coveredSequence: number;
  reducerVersion: string;
  schemaVersion: number;
  materializedAt: string;
}

export interface DbViewerHomeMemoryItem {
  id: string;
  homeId: string;
  runId: string;
  payload: unknown;
  [key: string]: unknown;
}

export interface DbViewerDeviceEvent {
  id: string;
  importId: string;
  sourceEventId: string;
  sourceEventType: string;
  runId: string;
  sequence: number;
  ts: string;
  simTime: string;
  homeId: string;
  roomId: string;
  deviceId: string;
  deviceType: string;
  field: string;
  value: unknown;
  payload: unknown;
}

export interface DbViewerDeviceEventQueryAudit {
  id: string;
  homeId: string;
  runId: string | null;
  query: Record<string, unknown>;
  resultCount: number;
  summary: string | null;
  createdBy: string;
  createdAt: string;
}

export type DbViewerSourceResolution =
  | {
    status: 'found';
    sourceType: DbViewerSourceType;
    item: DbViewerHomeMemoryItem | DbViewerDeviceEventQueryAudit;
  }
  | {
    status: 'missing';
    sourceType: DbViewerSourceType;
    sourceId: string;
    homeId: string;
    runId: string | null;
  };

export interface DbViewerListResponse<T> {
  items: T[];
}
