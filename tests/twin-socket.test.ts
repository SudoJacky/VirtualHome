import { describe, expect, it } from 'vitest';
import { buildTwinSocketUrl, cursorFromUpdate, nextReconnectDelayMs, parseTwinSocketMessage } from '../src/web/twinSocket';

describe('twin WebSocket client helpers', () => {
  it('builds reconnect URLs with the last run cursor', () => {
    const location = { protocol: 'http:', host: 'localhost:5173' } as Location;

    expect(buildTwinSocketUrl(location)).toBe('ws://localhost:5173/ws');
    expect(buildTwinSocketUrl(location, { runId: 'run_abc', sequence: 42 })).toBe('ws://localhost:5173/ws?runId=run_abc&afterSequence=42');
  });

  it('uses secure WebSockets for HTTPS pages', () => {
    const location = { protocol: 'https:', host: 'home.example' } as Location;

    expect(buildTwinSocketUrl(location, { runId: 'run spaced', sequence: 7 })).toBe('wss://home.example/ws?runId=run+spaced&afterSequence=7');
  });

  it('parses heartbeat messages separately from update messages', () => {
    expect(parseTwinSocketMessage(JSON.stringify({
      type: 'twin.heartbeat',
      ts: '2026-06-19T00:00:00.000Z',
      runId: 'run_1',
      sequence: 12
    }))).toEqual({
      type: 'twin.heartbeat',
      ts: '2026-06-19T00:00:00.000Z',
      runId: 'run_1',
      sequence: 12
    });
  });

  it('derives cursors from event-only update messages', () => {
    const update = parseTwinSocketMessage(JSON.stringify({
      type: 'twin.update',
      runId: 'run_1',
      sequence: 24,
      events: []
    }));

    expect(update.type).toBe('twin.update');
    if (update.type === 'twin.update') {
      expect(cursorFromUpdate(update)).toEqual({ runId: 'run_1', sequence: 24 });
    }
  });

  it('backs off reconnect attempts with a cap', () => {
    expect(nextReconnectDelayMs(0)).toBe(1000);
    expect(nextReconnectDelayMs(3)).toBe(8000);
    expect(nextReconnectDelayMs(10)).toBe(30000);
  });
});
