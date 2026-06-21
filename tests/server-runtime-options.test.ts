import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveServerRuntimeOptions } from '../src/server/runtimeOptions';

describe('server runtime options', () => {
  it('allows local verification to use an isolated port and database path', () => {
    const root = path.resolve('D:/Code/VirtualHome');
    const options = resolveServerRuntimeOptions(root, {
      PORT: '4327',
      VIRTUALHOME_DATABASE_PATH: 'output/playwright/verification.db',
      VIRTUALHOME_TELEMETRY_RETENTION_EVENTS: '250'
    });

    expect(options.port).toBe(4327);
    expect(options.serverOptions.databasePath).toBe(path.join(root, 'output/playwright/verification.db'));
    expect(options.serverOptions.telemetryRetentionEvents).toBe(250);
  });
});
