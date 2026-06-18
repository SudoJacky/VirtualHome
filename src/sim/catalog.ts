import type { Catalog, HomeDefinition } from '../shared/types';
import defaultHomeDefinitionData from './defaultHomeDefinition.json';

const defaultHomeDefinition = defaultHomeDefinitionData as HomeDefinition;

export function getHomeDefinition(): HomeDefinition {
  return structuredClone(defaultHomeDefinition);
}

export function getCatalog(): Catalog {
  const homeDefinition = getHomeDefinition();
  return {
    rooms: homeDefinition.floors.flatMap((floor) => floor.rooms),
    people: homeDefinition.people,
    devices: homeDefinition.floors.flatMap((floor) => floor.fixtures.devices)
  };
}
