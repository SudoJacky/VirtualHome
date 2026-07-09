import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveServerRuntimeOptions } from '../src/server/runtimeOptions';

describe('server runtime options', () => {
  it('allows local verification to use an isolated port and database path', () => {
    const root = path.resolve('D:/Code/VirtualHome');
    const options = resolveServerRuntimeOptions(root, {
      PORT: '4327',
      VIRTUALHOME_DATABASE_PATH: 'output/playwright/verification.db',
      VIRTUALHOME_DEVICE_EVENTS_DATABASE_PATH: 'output/playwright/device-events.db',
      VIRTUALHOME_HOME_MEMORY_DATABASE_PATH: 'output/playwright/home-memory.db',
      VIRTUALHOME_AGENT_PROFILE_DATABASE_PATH: 'output/playwright/agent-profile.db',
      VIRTUALHOME_TELEMETRY_RETENTION_EVENTS: '250'
    });

    expect(options.port).toBe(4327);
    expect(options.serverOptions.databasePath).toBe(path.join(root, 'output/playwright/verification.db'));
    expect(options.serverOptions.deviceEventsDatabasePath).toBe(path.join(root, 'output/playwright/device-events.db'));
    expect(options.serverOptions.homeMemoryDatabasePath).toBe(path.join(root, 'output/playwright/home-memory.db'));
    expect(options.serverOptions.agentProfileDatabasePath).toBe(path.join(root, 'output/playwright/agent-profile.db'));
    expect(options.serverOptions.telemetryRetentionEvents).toBe(250);
  });

  it('resolves home memory LLM provider options without enabling network calls by default', () => {
    const root = path.resolve('D:/Code/VirtualHome');
    const disabled = resolveServerRuntimeOptions(root, {});
    const enabled = resolveServerRuntimeOptions(root, {
      HOME_MEMORY_LLM_ENABLED: 'true',
      HOME_MEMORY_LLM_BASE_URL: 'https://llm.example.test/v1',
      HOME_MEMORY_LLM_MODEL: 'memory-model'
    });

    expect(disabled.homeMemoryLlm.provider).toMatchObject({
      enabled: false,
      baseUrl: ''
    });
    expect(enabled.homeMemoryLlm.provider).toMatchObject({
      enabled: true,
      provider: 'openai-compatible',
      baseUrl: 'https://llm.example.test/v1',
      model: 'memory-model'
    });
  });
});
