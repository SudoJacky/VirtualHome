import path from 'node:path';
import type { ServerOptions } from './app';

export interface ServerRuntimeOptions {
  port: number;
  serverOptions: ServerOptions;
}

export function resolveServerRuntimeOptions(root: string, env: NodeJS.ProcessEnv = process.env): ServerRuntimeOptions {
  const telemetryRetentionEvents = parsePositiveInteger(env.VIRTUALHOME_TELEMETRY_RETENTION_EVENTS);
  return {
    port: Number(env.PORT ?? 4317),
    serverOptions: {
      databasePath: resolvePath(root, env.VIRTUALHOME_DATABASE_PATH ?? path.join('data', 'virtualhome.db')),
      homeDefinitionPath: env.VIRTUALHOME_HOME_DEFINITION,
      telemetryRetentionEvents,
      autoTick: true,
      tickMs: 1000
    }
  };
}

function resolvePath(root: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
