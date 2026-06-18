import type { TwinEvent, TwinSnapshot } from '../shared/types';

export interface TwinSocketCursor {
  runId: string;
  sequence: number;
}

export interface TwinSocketUpdateMessage {
  type: 'twin.update';
  runId: string;
  sequence: number;
  snapshot?: TwinSnapshot;
  events: TwinEvent[];
}

export interface TwinSocketHeartbeatMessage {
  type: 'twin.heartbeat';
  ts: string;
  runId: string;
  sequence: number;
}

export type TwinSocketMessage = TwinSocketUpdateMessage | TwinSocketHeartbeatMessage;

export function buildTwinSocketUrl(location: Pick<Location, 'protocol' | 'host'>, cursor?: TwinSocketCursor | null): string {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = new URL(`${protocol}://${location.host}/ws`);
  if (cursor) {
    url.searchParams.set('runId', cursor.runId);
    url.searchParams.set('afterSequence', String(cursor.sequence));
  }
  return url.toString();
}

export function parseTwinSocketMessage(data: string): TwinSocketMessage {
  return JSON.parse(data) as TwinSocketMessage;
}

export function cursorFromSnapshot(snapshot: TwinSnapshot): TwinSocketCursor {
  return {
    runId: snapshot.runId,
    sequence: snapshot.simClock.sequence
  };
}

export function cursorFromUpdate(update: TwinSocketUpdateMessage): TwinSocketCursor {
  return update.snapshot ? cursorFromSnapshot(update.snapshot) : {
    runId: update.runId,
    sequence: update.sequence
  };
}

export function nextReconnectDelayMs(attempt: number): number {
  return Math.min(30000, 1000 * (2 ** Math.max(0, attempt)));
}
