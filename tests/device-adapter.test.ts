import { describe, expect, it } from 'vitest';
import { createAdapterCommand, createAdapterStateReport } from '../src/server/deviceAdapter';
import type { DeviceAccessRecord } from '../src/server/deviceAccess';

describe('device adapter boundary', () => {
  const routerRecord: DeviceAccessRecord = {
    deviceId: 'router_01',
    roomId: 'study',
    deviceType: 'router',
    displayName: 'Router',
    protocol: 'simulated',
    desiredState: { online: true, latencyMs: 18 },
    reportedState: { online: false, latencyMs: 0 },
    stateFields: {},
    supportedCommands: ['restart'],
    connectivity: 'offline',
    lastSeenAt: '2026-06-19T08:00:00+08:00',
    dataQuality: {
      source: 'simulator',
      confidence: 1,
      freshness: 'live'
    },
    lastCommand: {
      commandId: 'evt_1',
      status: 'failed',
      requestedAt: '2026-06-19T08:00:00+08:00',
      acknowledgedAt: null,
      reason: 'abnormality:network_offline'
    }
  };

  it('creates adapter state reports from reported device state', () => {
    expect(createAdapterStateReport(routerRecord)).toEqual({
      deviceId: 'router_01',
      deviceType: 'router',
      protocol: 'simulated',
      reportedState: { online: false, latencyMs: 0 },
      connectivity: 'offline',
      lastSeenAt: '2026-06-19T08:00:00+08:00',
      dataQuality: {
        source: 'simulator',
        confidence: 1,
        freshness: 'live'
      }
    });
  });

  it('creates requested commands only when the device capability supports them', () => {
    expect(createAdapterCommand(routerRecord, 'restart', '2026-06-19T08:01:00+08:00')).toEqual({
      commandId: 'router_01:restart:2026-06-19T08:01:00+08:00',
      deviceId: 'router_01',
      command: 'restart',
      desiredState: { online: true, latencyMs: 18 },
      status: 'requested',
      requestedAt: '2026-06-19T08:01:00+08:00'
    });

    expect(() => createAdapterCommand(routerRecord, 'turn_on', '2026-06-19T08:01:00+08:00'))
      .toThrow(/Unsupported command turn_on for router_01/);
  });
});
