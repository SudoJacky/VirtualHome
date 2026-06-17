import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSimulator } from '../src/sim/engine';
import { TwinDatabase } from '../src/server/persistence';

describe('twin persistence', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stores state snapshots, events, and telemetry in SQLite', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-'));
    dirs.push(dir);
    const db = new TwinDatabase(path.join(dir, 'twin.db'));
    const simulator = createSimulator({ seed: 42 });

    simulator.startScenario('weekday_normal');
    const events = simulator.advanceMinutes(12);
    db.recordSnapshot(simulator.getSnapshot());
    db.recordEvents(events);

    expect(db.getLatestSnapshot()?.homeState.mode).toBe('morning');
    expect(db.getRecentEvents(50).some((event) => event.type === 'ActivityStarted')).toBe(true);
    expect(db.getRecentTelemetry(50).some((event) => event.type === 'DeviceTelemetry')).toBe(true);

    db.close();
  });
});
