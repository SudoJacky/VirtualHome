import { describe, expect, it } from 'vitest';
import type { DeviceTelemetryEvent } from '../src/shared/types';
import { projectDeviceValueEvents } from '../src/server/deviceEventStream';

describe('device event stream projection', () => {
  it('keeps confidence as a sibling value without extending the wire schema', () => {
    const event: DeviceTelemetryEvent = {
      id: 'motion_source_1',
      runId: 'run_1',
      type: 'DeviceTelemetry',
      ts: '2026-06-22T10:00:00.000Z',
      simTime: '2026-06-22T18:00:00+08:00',
      homeId: 'home_1',
      scenarioId: 'weekday_normal',
      sequence: 1,
      sourceLayer: 'sensor',
      lineage: {
        eventTime: '2026-06-22T10:00:00.000Z',
        ingestTime: '2026-06-22T10:00:00.000Z',
        sourceLayer: 'sensor',
        causeEventIds: [],
        episodeId: 'sensor:living_motion_01',
        observability: 'ml_observation',
        quality: { confidence: 0.2 },
        schemaVersion: 1,
        behaviorModelVersion: 'test'
      },
      roomId: 'living_room',
      deviceId: 'living_motion_01',
      deviceType: 'motion_sensor',
      measurements: {
        confidence: 0.2,
        motion: true
      }
    };

    expect(projectDeviceValueEvents([event])).toEqual([
      expect.objectContaining({
        id: 'motion_source_1:confidence',
        field: 'confidence',
        value: 0.2
      }),
      expect.objectContaining({
        id: 'motion_source_1:motion',
        field: 'motion',
        value: true
      })
    ]);
    expect(projectDeviceValueEvents([event]).every((valueEvent) => !Object.hasOwn(valueEvent, 'sourceConfidence'))).toBe(true);
  });
});
