import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from './app';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const telemetryRetentionEvents = parsePositiveInteger(process.env.VIRTUALHOME_TELEMETRY_RETENTION_EVENTS);
const server = createServer({
  databasePath: path.join(root, 'data', 'virtualhome.db'),
  homeDefinitionPath: process.env.VIRTUALHOME_HOME_DEFINITION,
  telemetryRetentionEvents,
  autoTick: true,
  tickMs: 1000
});

const port = Number(process.env.PORT ?? 4317);
await server.listen({ host: '127.0.0.1', port });
console.log(`VirtualHome Twin API listening on http://127.0.0.1:${port}`);

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
