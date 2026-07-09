import path from 'node:path';
import { resolveHomeMemoryLlmConfig, type HomeMemoryLlmConfig } from '../sim/llm/homeMemoryEnrichment';
import type { ServerOptions } from './app';

export interface ServerRuntimeOptions {
  port: number;
  serverOptions: ServerOptions;
  homeMemoryLlm: HomeMemoryLlmConfig;
}

export function resolveServerRuntimeOptions(root: string, env: NodeJS.ProcessEnv = process.env): ServerRuntimeOptions {
  const telemetryRetentionEvents = parsePositiveInteger(env.VIRTUALHOME_TELEMETRY_RETENTION_EVENTS);
  const homeMemoryLlm = resolveHomeMemoryLlmConfig(env);
  return {
    port: Number(env.PORT ?? 4317),
    homeMemoryLlm,
    serverOptions: {
      databasePath: resolvePath(root, env.VIRTUALHOME_DATABASE_PATH ?? path.join('data', 'virtualhome.db')),
      deviceEventsDatabasePath: resolvePath(root, env.VIRTUALHOME_DEVICE_EVENTS_DATABASE_PATH ?? path.join('data', 'device-events.db')),
      homeMemoryDatabasePath: resolvePath(root, env.VIRTUALHOME_HOME_MEMORY_DATABASE_PATH ?? path.join('data', 'home-memory.db')),
      agentProfileDatabasePath: resolvePath(root, env.VIRTUALHOME_AGENT_PROFILE_DATABASE_PATH ?? path.join('data', 'agent-profile.db')),
      homeDefinitionPath: env.VIRTUALHOME_HOME_DEFINITION,
      homeMemoryLlm,
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
