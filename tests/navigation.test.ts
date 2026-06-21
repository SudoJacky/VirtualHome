import { describe, expect, it } from 'vitest';
import { findRoute, movementCost, nextRoomToward } from '../src/sim/world/navigation';

describe('household navigation', () => {
  it('uses the same room graph for people and pets', () => {
    const humanRoute = findRoute('master_bedroom', 'garden', 'human');
    const petRoute = findRoute('master_bedroom', 'garden', 'pet');

    expect(humanRoute.rooms).toEqual(['master_bedroom', 'living_room', 'dining_room', 'garden']);
    expect(petRoute.rooms).toEqual(humanRoute.rooms);
    expect(nextRoomToward('master_bedroom', 'garden')).toBe('living_room');
    expect(movementCost('master_bedroom', 'garden', 'senior')).toBeGreaterThan(movementCost('master_bedroom', 'garden', 'human'));
  });

  it('rejects impossible routes instead of teleporting', () => {
    expect(() => findRoute('away', 'kitchen', 'human')).toThrow(/Cannot route/);
  });
});
