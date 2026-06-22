import { describe, expect, it } from 'vitest';
import type { DeviceValueEvent } from '../src/web/deviceEventSocket';
import { createHomeMemory, reduceDeviceEvents } from '../src/web/homeMemoryModel';
import type { ProfileHypothesis } from '../src/web/homeProfiler';
import { createHomeMemoryGraphModel } from '../src/web/homeMemoryGraphModel';

function deviceEvent(overrides: Partial<DeviceValueEvent> = {}): DeviceValueEvent {
  return {
    id: 'device_event_1',
    sourceEventId: 'source_event_1',
    sourceEventType: 'DeviceTelemetry',
    runId: 'run_a',
    sequence: 1,
    ts: '2026-06-22T00:00:00.000Z',
    simTime: '2026-06-22T08:00:00',
    homeId: 'home_1',
    roomId: 'kitchen',
    deviceId: 'fridge_01',
    deviceType: 'fridge',
    field: 'doorOpen',
    value: false,
    ...overrides
  };
}

function graphMemory() {
  return reduceDeviceEvents(createHomeMemory(), graphEvents());
}

function reorderedGraphMemory() {
  return reduceDeviceEvents(createHomeMemory(), [
    graphEvents()[2],
    graphEvents()[0],
    graphEvents()[1]
  ]);
}

function graphEvents(): DeviceValueEvent[] {
  return [
    deviceEvent({
      id: 'kitchen_fridge_door_1',
      sourceEventId: 'source_kitchen_fridge_door_1',
      sequence: 1,
      deviceId: 'fridge_01',
      deviceType: 'fridge',
      field: 'doorOpen',
      value: true
    }),
    deviceEvent({
      id: 'kitchen_fridge_door_2',
      sourceEventId: 'source_kitchen_fridge_door_2',
      sequence: 2,
      deviceId: 'fridge_01',
      deviceType: 'fridge',
      field: 'doorOpen',
      value: false
    }),
    deviceEvent({
      id: 'kitchen_coffee_power_1',
      sourceEventId: 'source_kitchen_coffee_power_1',
      sequence: 3,
      deviceId: 'coffee_maker_01',
      deviceType: 'coffee_maker',
      field: 'powerW',
      value: 800
    })
  ];
}

function hypotheses(): ProfileHypothesis[] {
  return [
    {
      id: 'presence:recent-activity',
      type: 'presence_signal',
      label: 'Recent presence signal',
      summary: 'Recent device activity may indicate presence in the kitchen.',
      confidence: 0.66,
      updatedAt: '2026-06-22T08:00:00',
      subjectIds: ['device:coffee_maker_01', 'room:kitchen'],
      evidence: []
    },
    {
      id: 'room:kitchen:habit',
      type: 'room_habit',
      label: 'Kitchen habit',
      summary: 'Kitchen activity is strongest during morning.',
      confidence: 0.72,
      updatedAt: '2026-06-22T08:00:00',
      subjectIds: ['room:kitchen', 'device:missing_01'],
      evidence: []
    }
  ];
}

describe('home memory graph model', () => {
  it('creates home, room, device, field, and hypothesis nodes from memory and hypotheses', () => {
    const graph = createHomeMemoryGraphModel(graphMemory(), hypotheses());

    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'home:home_1',
        kind: 'home',
        label: 'Home 1',
        activity: 3
      }),
      expect.objectContaining({
        id: 'room:kitchen',
        kind: 'room',
        label: 'Kitchen',
        activity: 3
      }),
      expect.objectContaining({
        id: 'device:fridge_01',
        kind: 'device',
        label: 'Fridge 01',
        activity: 2
      }),
      expect.objectContaining({
        id: 'field:fridge_01:doorOpen',
        kind: 'field',
        label: 'Door Open',
        activity: 2
      }),
      expect.objectContaining({
        id: 'hypothesis:room:kitchen:habit',
        kind: 'hypothesis',
        label: 'Kitchen habit',
        activity: 0.72,
        confidence: 0.72
      })
    ]));
  });

  it('creates contains, observes, and supports relationship edges', () => {
    const graph = createHomeMemoryGraphModel(graphMemory(), hypotheses());

    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'contains:home:home_1:room:kitchen',
        from: 'home:home_1',
        to: 'room:kitchen',
        kind: 'contains',
        strength: 3
      }),
      expect.objectContaining({
        id: 'contains:room:kitchen:device:fridge_01',
        from: 'room:kitchen',
        to: 'device:fridge_01',
        kind: 'contains',
        strength: 2
      }),
      expect.objectContaining({
        id: 'observes:device:fridge_01:field:fridge_01:doorOpen',
        from: 'device:fridge_01',
        to: 'field:fridge_01:doorOpen',
        kind: 'observes',
        strength: 2
      }),
      expect.objectContaining({
        id: 'supports:hypothesis:room:kitchen:habit:room:kitchen',
        from: 'hypothesis:room:kitchen:habit',
        to: 'room:kitchen',
        kind: 'supports',
        strength: 0.72
      })
    ]));
  });

  it('omits nonexistent hypothesis subjects from support edges and related ids', () => {
    const graph = createHomeMemoryGraphModel(graphMemory(), hypotheses());
    const hypothesis = graph.nodes.find((node) => node.id === 'hypothesis:room:kitchen:habit');

    expect(graph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'hypothesis:room:kitchen:habit',
        to: 'device:missing_01',
        kind: 'supports'
      })
    ]));
    expect(hypothesis?.relatedIds).toContain('room:kitchen');
    expect(hypothesis?.relatedIds).not.toContain('device:missing_01');
  });

  it('omits orphaned memory references from every node related ids', () => {
    const memory = graphMemory();
    const staleMemory = {
      ...memory,
      rooms: {
        ...memory.rooms,
        kitchen: {
          ...memory.rooms.kitchen,
          devices: [...memory.rooms.kitchen.devices, 'missing_device_01'],
          activeFields: [...memory.rooms.kitchen.activeFields, 'fridge_01:missingField']
        }
      },
      devices: {
        ...memory.devices,
        fridge_01: {
          ...memory.devices.fridge_01,
          fields: [...memory.devices.fridge_01.fields, 'fridge_01:missingField']
        }
      }
    };

    const graph = createHomeMemoryGraphModel(staleMemory, hypotheses());
    const nodeIds = new Set(graph.nodes.map((node) => node.id));

    for (const node of graph.nodes) {
      expect(node.relatedIds.every((relatedId) => nodeIds.has(relatedId))).toBe(true);
    }
  });

  it('creates only an unknown home node for empty memory', () => {
    const graph = createHomeMemoryGraphModel(createHomeMemory(), []);

    expect(graph).toEqual({
      nodes: [
        expect.objectContaining({
          id: 'home:unknown',
          kind: 'home',
          activity: 0
        })
      ],
      edges: []
    });
  });

  it('returns deterministic graph output for the same input', () => {
    const memory = graphMemory();
    const inputHypotheses = hypotheses();

    expect(createHomeMemoryGraphModel(memory, inputHypotheses)).toEqual(
      createHomeMemoryGraphModel(memory, inputHypotheses)
    );
  });

  it('returns deterministic graph output for equivalent inputs in different orders', () => {
    expect(createHomeMemoryGraphModel(graphMemory(), hypotheses())).toEqual(
      createHomeMemoryGraphModel(reorderedGraphMemory(), [...hypotheses()].reverse())
    );
  });
});
