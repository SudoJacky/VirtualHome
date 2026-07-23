import { readFileSync } from 'node:fs';
import { parseHomeDefinition } from '../shared/homeDefinition';
import type { HomeDefinition } from '../shared/types';

export { parseHomeDefinition } from '../shared/homeDefinition';

export function loadHomeDefinitionFromFile(filePath: string): HomeDefinition {
  return parseHomeDefinition(JSON.parse(readFileSync(filePath, 'utf8')));
}
