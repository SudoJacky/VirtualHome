import { describe, expect, it } from 'vitest';
import { getHomeDefinition } from '../src/sim/catalog';
import { parseHomeDefinition } from '../src/server/homeDefinitionLoader';

describe('home definition loader', () => {
  it('rejects templates with unsupported device types or dangling room references', () => {
    const definition = getHomeDefinition();
    definition.floors[0].rooms = definition.floors[0].rooms.filter((room) => room.id !== 'garden');
    definition.floors[0].fixtures.devices.push({
      id: 'unknown_device_01',
      roomId: 'garden',
      type: 'unsupported_widget',
      name: 'Unsupported Widget',
      metrics: ['status']
    });
    definition.topology.connections.push({ from: 'living_room', to: 'garden' });

    expect(() => parseHomeDefinition(definition)).toThrow(/unsupported device type unsupported_widget/);
    expect(() => parseHomeDefinition(definition)).toThrow(/device unknown_device_01 references missing room garden/);
    expect(() => parseHomeDefinition(definition)).toThrow(/topology connection living_room->garden references missing room garden/);
  });

  it('rejects templates with duplicate room, device, or person identifiers', () => {
    const definition = getHomeDefinition();
    definition.floors[0].rooms.push({ ...definition.floors[0].rooms[0] });
    definition.floors[0].fixtures.devices.push({ ...definition.floors[0].fixtures.devices[0] });
    definition.people.push({ ...definition.people[0] });

    expect(() => parseHomeDefinition(definition)).toThrow(/duplicate room id entrance/);
    expect(() => parseHomeDefinition(definition)).toThrow(/duplicate device id door_lock_01/);
    expect(() => parseHomeDefinition(definition)).toThrow(/duplicate person id adult_1/);
  });
});
