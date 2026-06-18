import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WebSocket } from '@fastify/websocket';
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

  it('replays missed events when a WebSocket client reconnects with the last sequence', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-ws-replay-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 12 }
    });
    const lastSeen = (await server.inject({ method: 'GET', url: '/api/state' })).json();

    await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 2 }
    });

    const firstMessage = createMessagePromise();
    const ws = await server.injectWS(`/ws?runId=${lastSeen.runId}&afterSequence=${lastSeen.simClock.sequence}`, {}, {
      onInit: firstMessage.attach
    });
    const update = await firstMessage.value;

    expect(update.snapshot.runId).toBe(lastSeen.runId);
    expect(update.events.length).toBeGreaterThan(0);
    expect(update.events.every((event: { runId: string; sequence: number }) => event.runId === lastSeen.runId && event.sequence > lastSeen.simClock.sequence)).toBe(true);

    ws.close();
    await server.close();
  });

  it('sends WebSocket heartbeats with the current run cursor', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-ws-heartbeat-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false, heartbeatMs: 10 });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    const state = (await server.inject({ method: 'GET', url: '/api/state' })).json() as { runId: string; simClock: { sequence: number } };

    const heartbeat = createTypedMessagePromise('twin.heartbeat');
    const ws = await server.injectWS('/ws', {}, {
      onInit: heartbeat.attach
    });
    const message = await heartbeat.value;

    expect(message).toMatchObject({
      type: 'twin.heartbeat',
      runId: state.runId,
      sequence: state.simClock.sequence
    });

    ws.close();
    await server.close();
  });

  it('projects public state without exposing private household member details', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-privacy-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 12 }
    });

    const adminState = (await server.inject({ method: 'GET', url: '/api/state' })).json();
    const publicState = (await server.inject({ method: 'GET', url: '/api/state?privacy=public' })).json();

    expect(adminState.people.adult_1.activity).toBe('breakfast');
    expect(adminState.rooms.kitchen.people).toContain('adult_1');
    expect(publicState.homeState.occupancyCount).toBe(1);
    expect(publicState.people).toEqual({});
    expect(publicState.rooms.kitchen.people).toEqual([]);
    expect(publicState.activities).toEqual({});
    expect(JSON.stringify(publicState)).not.toContain('adult_1');
    expect(JSON.stringify(publicState)).not.toContain('breakfast');

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

  it('rejects invalid API inputs with structured 400 responses', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-validation-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const invalidAdvance = await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 'later' }
    });
    expect(invalidAdvance.statusCode).toBe(400);
    expect(invalidAdvance.json().error).toMatchObject({ code: 'VALIDATION_FAILED' });

    const invalidDaily = await server.inject({
      method: 'POST',
      url: '/api/daily/start',
      payload: { date: '18-07-2026', seed: 'not-a-seed' }
    });
    expect(invalidDaily.statusCode).toBe(400);
    expect(invalidDaily.json().error).toMatchObject({ code: 'VALIDATION_FAILED' });

    const invalidEvents = await server.inject({ method: 'GET', url: '/api/events?limit=forever' });
    expect(invalidEvents.statusCode).toBe(400);
    expect(invalidEvents.json().error.issues.length).toBeGreaterThan(0);

    const invalidInjection = await server.inject({
      method: 'POST',
      url: '/api/control/inject',
      payload: { kind: 'bad_sensor' }
    });
    expect(invalidInjection.statusCode).toBe(400);
    expect(invalidInjection.json().error).toMatchObject({ code: 'VALIDATION_FAILED' });

    const invalidResolve = await server.inject({
      method: 'POST',
      url: '/api/control/resolve',
      payload: { kind: 'bad_sensor' }
    });
    expect(invalidResolve.statusCode).toBe(400);
    expect(invalidResolve.json().error).toMatchObject({ code: 'VALIDATION_FAILED' });

    await server.close();
  });

  it('resolves abnormal device facts through the control API', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-resolve-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/control/inject',
      payload: { kind: 'fridge_left_open' }
    });
    const resolve = await server.inject({
      method: 'POST',
      url: '/api/control/resolve',
      payload: { kind: 'fridge_left_open' }
    });

    expect(resolve.statusCode).toBe(200);
    expect(resolve.json().snapshot.devices.fridge_01.state.doorOpen).toBe(false);
    expect(resolve.json().events.some((event: { type: string; ruleId?: string }) => event.type === 'RuleRecovered' && event.ruleId === 'fridge_left_open')).toBe(true);

    await server.close();
  });

  it('restores the latest persisted run after a server restart', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-recovery-'));
    dirs.push(dir);
    const databasePath = path.join(dir, 'twin.db');
    const firstServer = createServer({ databasePath, autoTick: false });

    await firstServer.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    await firstServer.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 12 }
    });
    const beforeRestart = (await firstServer.inject({ method: 'GET', url: '/api/state' })).json();
    await firstServer.close();

    const secondServer = createServer({ databasePath, autoTick: false });
    await secondServer.ready();
    const restored = (await secondServer.inject({ method: 'GET', url: '/api/state' })).json();
    const advance = await secondServer.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 1 }
    });
    const resumedEvents = advance.json().events as Array<{ runId: string; sequence: number }>;

    expect(restored.runId).toBe(beforeRestart.runId);
    expect(restored.simClock.currentTime).toBe(beforeRestart.simClock.currentTime);
    expect(restored.simClock.sequence).toBe(beforeRestart.simClock.sequence);
    expect(resumedEvents.length).toBeGreaterThan(0);
    expect(resumedEvents.every((event) => event.runId === beforeRestart.runId)).toBe(true);
    expect(resumedEvents[0].sequence).toBeGreaterThan(beforeRestart.simClock.sequence);

    await secondServer.close();
  });

  it('restores state by replaying events after the latest snapshot checkpoint', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-checkpoint-recovery-'));
    dirs.push(dir);
    const databasePath = path.join(dir, 'twin.db');
    const firstServer = createServer({ databasePath, autoTick: false, snapshotIntervalEvents: 1000 });

    await firstServer.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    await firstServer.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 1 }
    });
    const beforeRestart = (await firstServer.inject({ method: 'GET', url: '/api/state' })).json();
    await firstServer.close();

    const secondServer = createServer({ databasePath, autoTick: false, snapshotIntervalEvents: 1000 });
    await secondServer.ready();
    const restored = (await secondServer.inject({ method: 'GET', url: '/api/state' })).json();

    expect(restored.runId).toBe(beforeRestart.runId);
    expect(restored.simClock.currentTime).toBe(beforeRestart.simClock.currentTime);
    expect(restored.simClock.sequence).toBe(beforeRestart.simClock.sequence);
    expect(restored.devices.kitchen_temp_01.state.temperatureC).toBe(beforeRestart.devices.kitchen_temp_01.state.temperatureC);

    await secondServer.close();
  });
});

function createMessagePromise(): {
  value: Promise<{ snapshot: { runId: string }; events: Array<{ runId: string; sequence: number }> }>;
  attach: (ws: WebSocket) => void;
} {
  let resolveMessage: (message: { snapshot: { runId: string }; events: Array<{ runId: string; sequence: number }> }) => void = () => {};
  let rejectMessage: (error: Error) => void = () => {};
  let cleanup = (): void => {};
  const value = new Promise<{ snapshot: { runId: string }; events: Array<{ runId: string; sequence: number }> }>((resolve, reject) => {
    resolveMessage = resolve;
    rejectMessage = reject;
    const timer = setTimeout(() => reject(new Error('Timed out waiting for WebSocket message')), 2000);
    cleanup = () => clearTimeout(timer);
  });

  return {
    value,
    attach: (ws) => {
      ws.once('message', (data: { toString(): string }) => {
        cleanup();
        resolveMessage(JSON.parse(data.toString()) as { snapshot: { runId: string }; events: Array<{ runId: string; sequence: number }> });
      });
      ws.once('error', (error: Error) => {
        cleanup();
        rejectMessage(error);
      });
    }
  };
}

function createTypedMessagePromise(type: string): {
  value: Promise<Record<string, unknown>>;
  attach: (ws: WebSocket) => void;
} {
  let resolveMessage: (message: Record<string, unknown>) => void = () => {};
  let rejectMessage: (error: Error) => void = () => {};
  let cleanup = (): void => {};
  const value = new Promise<Record<string, unknown>>((resolve, reject) => {
    resolveMessage = resolve;
    rejectMessage = reject;
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for WebSocket ${type}`)), 2000);
    cleanup = () => clearTimeout(timer);
  });

  return {
    value,
    attach: (ws) => {
      ws.on('message', (data: { toString(): string }) => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (message.type === type) {
          cleanup();
          resolveMessage(message);
        }
      });
      ws.once('error', (error: Error) => {
        cleanup();
        rejectMessage(error);
      });
    }
  };
}
