import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server/app';

describe('server API', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('starts scenarios, advances simulation, and exposes state/events/telemetry', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-api-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const start = await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    expect(start.statusCode).toBe(200);

    const advance = await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 12 }
    });
    expect(advance.statusCode).toBe(200);
    expect(advance.json().events.some((event: { type: string }) => event.type === 'ActivityStarted')).toBe(true);

    const state = await server.inject({ method: 'GET', url: '/api/state' });
    expect(state.json().homeState.mode).toBe('morning');
    expect(state.json().rooms.kitchen.people).toContain('adult_1');

    const events = await server.inject({ method: 'GET', url: '/api/events?limit=20' });
    expect(events.json().some((event: { type: string }) => event.type === 'DeviceTelemetry')).toBe(true);

    const telemetry = await server.inject({ method: 'GET', url: '/api/telemetry?limit=20' });
    expect(telemetry.json().some((event: { type: string }) => event.type === 'DeviceTelemetry')).toBe(true);

    await server.close();
  });

  it('accepts WebSocket clients and sends the current twin snapshot', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-ws-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });
    await server.ready();

    const ws = await server.injectWS('/ws');
    expect(ws.readyState).toBe(1);
    ws.close();

    await server.close();
  });

  it('pauses and resumes the simulation clock through control endpoints', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-control-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const pause = await server.inject({ method: 'POST', url: '/api/control/pause' });
    expect(pause.statusCode).toBe(200);
    expect(pause.json().snapshot.simClock.paused).toBe(true);

    const resume = await server.inject({ method: 'POST', url: '/api/control/resume' });
    expect(resume.statusCode).toBe(200);
    expect(resume.json().snapshot.simClock.paused).toBe(false);

    await server.close();
  });

  it('starts a generated daily routine through date and seed controls', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-daily-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const start = await server.inject({
      method: 'POST',
      url: '/api/daily/start',
      payload: { date: '2026-07-18', seed: 42 }
    });

    expect(start.statusCode).toBe(200);
    expect(start.json().snapshot.scenarioId).toBe('daily_2026_07_18');
    expect(start.json().events[0].type).toBe('ScenarioControl');

    const advance = await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 600 }
    });
    const events = advance.json().events as Array<{ type: string; activity?: string }>;
    expect(events.some((event) => event.type === 'PersonMoved' && event.activity === 'weekend_cleaning')).toBe(true);
    expect(events.some((event) => event.type === 'PersonMoved' && event.activity === 'school')).toBe(false);

    await server.close();
  });
});
