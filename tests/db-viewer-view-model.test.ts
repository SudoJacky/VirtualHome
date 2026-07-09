import { describe, expect, it } from 'vitest';
import { createAgentProfileRows, createDeviceEventRows, createHomeMemoryRows, describeSourceResolution } from '../src/tools/dbViewer/client/viewModel';

describe('db viewer view model', () => {
  it('maps agent profile and home memory API payloads into dense table rows', () => {
    expect(createAgentProfileRows([{
      id: 'entry_1',
      homeId: 'home_001',
      title: 'Weekday breakfast',
      summary: 'Breakfast summary.',
      subjectType: 'household',
      subjectId: 'household',
      entryType: 'conclusion',
      status: 'active',
      confidence: 0.72,
      stability: 'working',
      createdBy: 'agent',
      createdAt: '2026-07-09T07:55:00.000Z',
      updatedAt: '2026-07-09T08:00:00.000Z'
    }])).toEqual([{
      id: 'entry_1',
      title: 'Weekday breakfast',
      subject: 'household:household',
      entryType: 'conclusion',
      status: 'active',
      confidence: '0.72',
      stability: 'working',
      updatedAt: '2026-07-09 08:00'
    }]);

    expect(createHomeMemoryRows('hypotheses', [{
      id: 'hypothesis_1',
      homeId: 'home_001',
      runId: 'run_a',
      type: 'daily_rhythm',
      summary: 'Morning activity.',
      confidence: 0.61,
      updatedAt: '2026-07-09T08:10:00.000Z',
      evidenceIds: ['evidence_1', 'evidence_2'],
      payload: { id: 'hypothesis_1' }
    }])[0]).toMatchObject({
      id: 'hypothesis_1',
      primary: 'daily_rhythm',
      secondary: 'Morning activity.',
      metric: '0.61',
      count: '2'
    });

    expect(createDeviceEventRows([{
      id: 'value_1',
      importId: 'import_1',
      sourceEventId: 'source_1',
      sourceEventType: 'DeviceTelemetry',
      runId: 'run_a',
      sequence: 1,
      ts: '2026-06-22T00:00:00.000Z',
      simTime: '2026-06-22T08:00:00',
      homeId: 'home_001',
      roomId: 'kitchen',
      deviceId: 'coffee_maker_01',
      deviceType: 'coffee_maker',
      field: 'powerW',
      value: 850,
      payload: { id: 'value_1' }
    }])).toEqual([{
      id: 'value_1',
      sourceEventId: 'source_1',
      simTime: '2026-06-22T08:00:00',
      room: 'kitchen',
      device: 'coffee_maker_01',
      field: 'powerW',
      value: '850'
    }]);
  });

  it('describes missing source references visibly', () => {
    expect(describeSourceResolution({
      status: 'missing',
      sourceType: 'home_memory_hypothesis',
      sourceId: 'hypothesis_404',
      homeId: 'home_001',
      runId: 'run_a'
    })).toBe('Missing home_memory_hypothesis hypothesis_404 in home_001/run_a');
  });
});
