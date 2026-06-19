import type { Catalog, HomeDefinition } from '../shared/types';
import defaultHomeDefinitionData from './defaultHomeDefinition.json';

const defaultHomeDefinition = defaultHomeDefinitionData as HomeDefinition;

export function getHomeDefinition(): HomeDefinition {
  return structuredClone(defaultHomeDefinition);
}

export function createCatalogFromHomeDefinition(homeDefinition: HomeDefinition): Catalog {
  return {
    rooms: homeDefinition.floors.flatMap((floor) => floor.rooms),
    people: homeDefinition.people,
    devices: homeDefinition.floors.flatMap((floor) => floor.fixtures.devices)
  };
}

export function getCatalog(): Catalog {
  return createCatalogFromHomeDefinition(getHomeDefinition());
}
