import { describe, expect, it } from 'vitest';
import { createAdapterCommand, createAdapterStateReport } from '../src/server/deviceAdapter';
import type { DeviceAccessRecord } from '../src/server/deviceAccess';

describe('device adapter boundary', () => {
  const routerRecord: DeviceAccessRecord = {
    deviceId: 'router_01',
    roomId: 'study',
    deviceType: 'router',
    displayName: 'Home Router',
    shortLabel: 'Router',
    instanceGroup: 'network_infrastructure',
    privacyLevel: 'household',
    riskLevel: 'confirmation',
    visualModel: 'router_antennas',
    visualScale: 0.95,
    pose: {
      x: 4.25,
      y: 0.28,
      z: -1.25,
      rotation: 0,
      mount: 'counter',
      visualVariant: null
    },
    protocol: 'simulated',
    desiredState: { online: true, latencyMs: 18 },
    reportedState: { online: false, latencyMs: 0 },
    stateFields: {},
    supportedCommands: ['restart'],
    commandMetadata: {
      restart: {
        label: 'Restart router',
        controlType: 'button',
        valueType: 'none',
        field: null,
        highRisk: false,
        requiresConfirmation: true,
        lifecycle: ['requested', 'sent', 'acknowledged', 'failed', 'rolled_back'],
        failureReasons: ['offline', 'unsupported', 'invalid_params', 'device_rejected', 'timeout']
      }
    },
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
      reason: 'abnormality:network_offline',
      timeline: [
        { status: 'requested', at: '2026-06-19T08:00:00+08:00', reason: null },
        { status: 'sent', at: '2026-06-19T08:00:00+08:00', reason: null },
        { status: 'failed', at: '2026-06-19T08:00:00+08:00', reason: 'abnormality:network_offline' }
      ]
    },
    healthStatus: [{
      kind: 'connectivity',
      label: 'Connectivity',
      sourceField: 'online',
      status: 'alert',
      reportedValue: false,
      recommendation: 'Check connectivity or restart the device before relying on related automation.',
      impact: 'automation_reliability'
    }]
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
