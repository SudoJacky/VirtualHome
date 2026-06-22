import { describe, expect, it } from 'vitest';
import {
  buildDeviceEventSocketUrl,
  cursorFromDeviceEvent,
  nextDeviceEventReconnectDelayMs,
  parseDeviceEventSocketMessage
} from '../src/web/deviceEventSocket';

describe('device event WebSocket client helpers', () => {
  it('builds the device event socket URL', () => {
    const location = { protocol: 'http:', host: 'localhost:5173' } as Location;

    expect(buildDeviceEventSocketUrl(location)).toBe('ws://localhost:5173/ws/device-events');
  });

  it('builds reconnect URLs with the last device event cursor', () => {
    const location = { protocol: 'http:', host: 'localhost:5173' } as Location;

    expect(buildDeviceEventSocketUrl(location, { runId: 'run_abc', sequence: 42 })).toBe(
      'ws://localhost:5173/ws/device-events?runId=run_abc&afterSequence=42'
    );
  });

  it('uses secure WebSockets for HTTPS pages and URL-encodes cursor values', () => {
    const location = { protocol: 'https:', host: 'home.example' } as Location;

    expect(buildDeviceEventSocketUrl(location, { runId: 'run spaced', sequence: 7 })).toBe(
      'wss://home.example/ws/device-events?runId=run+spaced&afterSequence=7'
    );
  });

  it('parses device update messages and derives cursors from device events', () => {
    const update = parseDeviceEventSocketMessage(JSON.stringify({
      type: 'device.update',
      runId: 'run_1',
      sequence: 42,
      replayComplete: true,
      events: [
        {
          id: 'dev_evt_1',
          sourceEventId: 'evt_1',
          sourceEventType: 'DeviceTelemetry',
          runId: 'run_1',
          sequence: 42,
          ts: '2026-06-22T00:00:00.000Z',
          simTime: '2026-06-22T08:00:00.000Z',
          homeId: 'home_1',
          roomId: 'kitchen',
          deviceId: 'light_1',
          deviceType: 'light',
          field: 'power',
          value: true
        }
      ]
    }));

    expect(update.type).toBe('device.update');
    if (update.type === 'device.update') {
      const event = update.events[0];
      const sourceEventType: 'DeviceTelemetry' | 'DeviceStateChanged' = event.sourceEventType;

      expect(update.runId).toBe('run_1');
      expect(update.sequence).toBe(42);
      expect(update.replayComplete).toBe(true);
      expect(sourceEventType).toBe('DeviceTelemetry');
      expect(event).toEqual({
        id: 'dev_evt_1',
        sourceEventId: 'evt_1',
        sourceEventType: 'DeviceTelemetry',
        runId: 'run_1',
        sequence: 42,
        ts: '2026-06-22T00:00:00.000Z',
        simTime: '2026-06-22T08:00:00.000Z',
        homeId: 'home_1',
        roomId: 'kitchen',
        deviceId: 'light_1',
        deviceType: 'light',
        field: 'power',
        value: true
      });
      expect('scenarioId' in event).toBe(false);
      expect(cursorFromDeviceEvent(event)).toEqual({ runId: 'run_1', sequence: 42 });
    }
  });

  it('parses heartbeat messages separately from update messages', () => {
    expect(parseDeviceEventSocketMessage(JSON.stringify({
      type: 'device.heartbeat',
      ts: '2026-06-22T00:00:00.000Z',
      runId: 'run_1',
      sequence: 12
    }))).toEqual({
      type: 'device.heartbeat',
      ts: '2026-06-22T00:00:00.000Z',
      runId: 'run_1',
      sequence: 12
    });
  });

  it('backs off device event reconnect attempts with a cap', () => {
    expect(nextDeviceEventReconnectDelayMs(0)).toBe(1000);
    expect(nextDeviceEventReconnectDelayMs(4)).toBe(16000);
    expect(nextDeviceEventReconnectDelayMs(9)).toBe(30000);
  });
});
