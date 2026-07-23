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

  it('rejects device metrics that are not declared by the device capability registry', () => {
    const definition = getHomeDefinition();
    const fridge = definition.floors[0].fixtures.devices.find((device) => device.id === 'fridge_01');
    if (!fridge) {
      throw new Error('missing fridge fixture');
    }
    fridge.metrics = ['door_open', 'not_a_fridge_metric'];

    expect(() => parseHomeDefinition(definition)).toThrow(/device fridge_01 declares unsupported metric not_a_fridge_metric/);
  });

  it('accepts snake_case aliases for camelCase metrics with acronym boundaries', () => {
    const definition = getHomeDefinition();
    const waterFlow = definition.floors[0].fixtures.devices.find((device) => device.id === 'bathroom_water_01');
    if (!waterFlow) {
      throw new Error('missing water flow fixture');
    }
    waterFlow.metrics = ['flow_l_min'];

    expect(parseHomeDefinition(definition).building.id).toBe('default_home');
  });

  it('accepts template-defined room identifiers outside the default home', () => {
    const definition = getHomeDefinition();
    const room = definition.floors[0].rooms.find((candidate) => candidate.id === 'study');
    if (!room) {
      throw new Error('missing study room');
    }

    room.id = 'music_studio';
    room.name = 'Music Studio';
    room.connectedRooms = ['living_room'];
    definition.floors[0].fixtures.devices
      .filter((device) => device.roomId === 'study')
      .forEach((device) => {
        device.roomId = 'music_studio';
      });
    definition.floors[0].rooms.forEach((candidate) => {
      candidate.connectedRooms = candidate.connectedRooms.map((roomId) => (
        roomId === 'study' ? 'music_studio' : roomId
      ));
    });
    definition.topology.connections.forEach((connection) => {
      if (connection.from === 'study') connection.from = 'music_studio';
      if (connection.to === 'study') connection.to = 'music_studio';
    });

    const parsed = parseHomeDefinition(definition);

    expect(parsed.floors[0].rooms).toContainEqual(expect.objectContaining({
      id: 'music_studio',
      name: 'Music Studio'
    }));
  });
});
