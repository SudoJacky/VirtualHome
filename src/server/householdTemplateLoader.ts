import { readFileSync } from 'node:fs';

export function loadHouseholdTemplateFromFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}
