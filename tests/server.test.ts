import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WebSocket } from '@fastify/websocket';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server/app';
import { getHomeDefinition } from '../src/sim/catalog';
import { deviceCapabilities } from '../src/shared/deviceRegistry';

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

  it('serves an OpenAPI document for REST and WebSocket clients', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-openapi-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const response = await server.inject({ method: 'GET', url: '/api/openapi.json' });
    const document = response.json();

    expect(response.statusCode).toBe(200);
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.title).toBe('VirtualHome Twin API');
    expect(Object.keys(document.paths)).toEqual(expect.arrayContaining([
      '/api/state',
      '/api/events',
      '/api/telemetry',
      '/api/device-twins',
      '/api/device-capabilities',
      '/api/home-definition',
      '/api/daily/start',
      '/api/control/advance',
      '/api/control/inject',
      '/api/control/resolve',
      '/api/alerts/{alertId}/status',
      '/api/audit/access',
      '/ws'
    ]));
    expect(document.paths['/api/control/advance'].post.requestBody.content['application/json'].schema.properties).toHaveProperty('idempotencyKey');
    expect(document.components.schemas).toHaveProperty('ValidationError');
    expect(document.components.schemas).toHaveProperty('NotFoundError');
    expect(document.components.schemas).toHaveProperty('DeviceCapability');
    expect(document.components.schemas.DeviceCapability.properties).toHaveProperty('markerKind');
    expect(document.components.schemas.DeviceCapability.properties).toHaveProperty('animationHint');
    expect(document.components.schemas.DeviceCapability.properties).toHaveProperty('defaultState');
    expect(document.components.schemas.DeviceCapability.properties).toHaveProperty('stateFields');
    expect(document.components.schemas.DeviceCapability.properties.stateFields.additionalProperties.properties).toHaveProperty('defaultValue');
    expect(document.components.schemas.DeviceCapability.properties.stateFields.additionalProperties.properties).toHaveProperty('unit');
    expect(document.components.schemas.DeviceCapability.properties.stateFields.additionalProperties.properties).toHaveProperty('normalRange');
    expect(document.components.schemas).toHaveProperty('AccessAuditRecord');
    expect(document.components.schemas.DeviceAccessRecord.required).toEqual(expect.arrayContaining(['stateFields', 'supportedCommands']));
    expect(document.components.schemas.DeviceAccessRecord.properties).toHaveProperty('stateFields');
    expect(document.components.schemas.DeviceAccessRecord.properties).toHaveProperty('supportedCommands');
    expect(document.components.schemas.DeviceAccessRecord.properties.lastCommand.anyOf[0].properties.status.enum).toEqual([
      'requested',
      'sent',
      'acknowledged',
      'failed',
      'timed-out',
      'none'
    ]);
    expect(document.components.schemas).toHaveProperty('AbnormalityInjectedEvent');
    expect(document.components.schemas).toHaveProperty('AlertStatusChangedEvent');
    expect(document.components.schemas.TwinEvent.anyOf).toContainEqual({ $ref: '#/components/schemas/AlertStatusChangedEvent' });
    expect(document.components.schemas.AbnormalityInjectedEvent.required).toEqual(expect.arrayContaining(['type', 'kind', 'affectedEntities']));
    expect(document.components.schemas.AbnormalityInjectedEvent.properties.kind.enum).toEqual([
      'door_left_open',
      'fridge_left_open',
      'network_offline',
      'senior_no_activity'
    ]);
    expect(document.components.schemas.TwinEvent.anyOf).toContainEqual({ $ref: '#/components/schemas/AbnormalityInjectedEvent' });
    expect(document.paths['/api/alerts/{alertId}/status'].post.responses['404'].content['application/json'].schema)
      .toEqual({ $ref: '#/components/schemas/NotFoundError' });

    await server.close();
  });

  it('serves the model-driven default home definition', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-home-definition-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const response = await server.inject({ method: 'GET', url: '/api/home-definition' });
    const definition = response.json();

    expect(response.statusCode).toBe(200);
    expect(definition.building.id).toBe('default_home');
    expect(definition.floors[0].rooms.map((room: { id: string }) => room.id)).toContain('kitchen');
    expect(definition.floors[0].fixtures.devices.map((device: { id: string }) => device.id)).toContain('router_01');
    expect(definition.topology.connections.some((connection: { from: string; to: string }) => connection.from === 'living_room' && connection.to === 'study')).toBe(true);

    await server.close();
  });

  it('loads a configured home definition JSON into the API and simulator state', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-custom-home-definition-'));
    dirs.push(dir);
    const homeDefinition = getHomeDefinition();
    homeDefinition.building.id = 'custom_home';
    homeDefinition.building.name = 'Custom Loft';
    homeDefinition.floors[0].rooms = homeDefinition.floors[0].rooms.map((room) => (
      room.id === 'kitchen' ? { ...room, name: 'Chef Kitchen' } : room
    ));
    const homeDefinitionPath = path.join(dir, 'home-definition.json');
    writeFileSync(homeDefinitionPath, JSON.stringify(homeDefinition), 'utf8');
    const server = createServer({
      databasePath: path.join(dir, 'twin.db'),
      autoTick: false,
      homeDefinitionPath
    });

    const definitionResponse = await server.inject({ method: 'GET', url: '/api/home-definition' });
    const stateResponse = await server.inject({ method: 'GET', url: '/api/state' });

    expect(definitionResponse.statusCode).toBe(200);
    expect(definitionResponse.json().building).toMatchObject({
      id: 'custom_home',
      name: 'Custom Loft'
    });
    expect(stateResponse.json().homeId).toBe('custom_home');
    expect(stateResponse.json().rooms.kitchen.name).toBe('Chef Kitchen');

    await server.close();
  });

  it('exposes serializable device capability metadata for clients and adapters', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-device-capabilities-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const response = await server.inject({ method: 'GET', url: '/api/device-capabilities' });
    const capabilities = response.json();

    expect(response.statusCode).toBe(200);
    expect(Object.keys(capabilities).sort()).toEqual(Object.keys(deviceCapabilities).sort());
    expect(capabilities.router).toMatchObject({
      displayName: 'Router',
      shortLabel: 'Router',
      icon: 'router',
      markerKind: 'appliance',
      animationHint: 'pulse',
      defaultState: { online: true, latencyMs: 18 },
      supportedCommands: ['restart'],
      telemetry: {
        online: { unit: 'bool' },
        latencyMs: { unit: 'ms' }
      },
      stateFields: {
        online: { type: 'boolean', required: false, defaultValue: true, unit: 'bool' },
        latencyMs: { type: 'number', required: false, defaultValue: 18, unit: 'ms' }
      }
    });
    expect(capabilities.router).not.toHaveProperty('isActive');
    expect(capabilities.router).not.toHaveProperty('stateSchema');

    await server.close();
  });

  it('projects devices into a bidirectional access model for adapters', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-device-access-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    await server.inject({
      method: 'POST',
      url: '/api/control/inject',
      payload: { kind: 'network_offline' }
    });
    const response = await server.inject({ method: 'GET', url: '/api/device-twins' });
    const records = response.json();
    const router = records.find((record: { deviceId: string }) => record.deviceId === 'router_01');

    expect(response.statusCode).toBe(200);
    expect(records.length).toBeGreaterThan(20);
    expect(router).toMatchObject({
      deviceId: 'router_01',
      protocol: 'simulated',
      connectivity: 'offline',
      reportedState: { online: false, latencyMs: 0 },
      desiredState: { online: true, latencyMs: 18 },
      stateFields: {
        online: { type: 'boolean', required: false, defaultValue: true, unit: 'bool' },
        latencyMs: { type: 'number', required: false, defaultValue: 18, unit: 'ms' }
      },
      supportedCommands: ['restart'],
      dataQuality: { source: 'simulator', confidence: 1 },
      lastCommand: {
        status: 'failed',
        reason: 'abnormality:network_offline'
      }
    });
    expect(typeof router.lastSeenAt).toBe('string');

    await server.close();
  });

  it('summarizes recent telemetry by device and metric', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-telemetry-summary-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 3 }
    });
    const response = await server.inject({ method: 'GET', url: '/api/telemetry/summary?limit=200' });
    const summary = response.json();
    const kitchenClimate = summary.devices.find((device: { deviceId: string }) => device.deviceId === 'kitchen_temp_01');

    expect(response.statusCode).toBe(200);
    expect(summary.runId).toBeDefined();
    expect(summary.window.eventLimit).toBe(200);
    expect(kitchenClimate.metrics.temperature_c.count).toBeGreaterThan(0);
    expect(kitchenClimate.metrics.temperature_c.avg).toBeTypeOf('number');
    expect(kitchenClimate.metrics.temperature_c.min).toBeLessThanOrEqual(kitchenClimate.metrics.temperature_c.max);

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

  it('fails closed to public WebSocket projection when privacy query is invalid', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-ws-privacy-'));
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

    const firstMessage = createMessagePromise();
    const ws = await server.injectWS('/ws?privacy=owner', {}, {
      onInit: firstMessage.attach
    });
    const update = await firstMessage.value as unknown as { snapshot: { people: Record<string, unknown>; activities: Record<string, unknown>; rooms: Record<string, { people: string[] }> } };

    expect(update.snapshot.people).toEqual({});
    expect(update.snapshot.activities).toEqual({});
    expect(JSON.stringify(update.snapshot)).not.toContain('adult_1');
    expect(Object.values(update.snapshot.rooms).every((room) => room.people.length === 0)).toBe(true);

    ws.close();
    await server.close();
  });

  it('broadcasts event-only WebSocket updates between snapshot checkpoints', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-ws-incremental-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false, snapshotIntervalEvents: 1000 });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    const beforeAdvance = (await server.inject({ method: 'GET', url: '/api/state' })).json() as { runId: string; simClock: { sequence: number } };
    const nextUpdate = createNthTypedMessagePromise('twin.update', 2);
    const ws = await server.injectWS(`/ws?runId=${beforeAdvance.runId}&afterSequence=${beforeAdvance.simClock.sequence}`, {}, {
      onInit: nextUpdate.attach
    });

    await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 1 }
    });
    const update = await nextUpdate.value;

    expect(update.snapshot).toBeUndefined();
    expect(update.runId).toBe(beforeAdvance.runId);
    expect(Number(update.sequence)).toBeGreaterThan(beforeAdvance.simClock.sequence);
    expect((update.events as Array<{ sequence: number }>).length).toBeGreaterThan(0);

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

  it('records access audit entries for privacy-sensitive read APIs', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-access-audit-'));
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
    const state = (await server.inject({ method: 'GET', url: '/api/state?privacy=public' })).json();
    await server.inject({ method: 'GET', url: '/api/events?limit=5&privacy=public' });

    const audit = await server.inject({ method: 'GET', url: '/api/audit/access?limit=10' });
    const records = audit.json();

    expect(audit.statusCode).toBe(200);
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'GET',
        endpoint: '/api/state',
        privacy: 'public',
        runId: state.runId,
        sequence: state.simClock.sequence
      }),
      expect.objectContaining({
        method: 'GET',
        endpoint: '/api/events',
        privacy: 'public',
        runId: state.runId
      })
    ]));
    expect(records.every((record: { ts: string }) => typeof record.ts === 'string')).toBe(true);

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

  it('returns the first control result when an idempotency key is retried', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-idempotency-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/scenarios/weekday_normal/start'
    });
    const first = await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 1, idempotencyKey: 'advance-once' }
    });
    const second = await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 1, idempotencyKey: 'advance-once' }
    });
    const current = (await server.inject({ method: 'GET', url: '/api/state' })).json();

    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(current.simClock.sequence).toBe(first.json().snapshot.simClock.sequence);

    await server.close();
  });

  it('rejects idempotency key reuse with a different control payload', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-idempotency-conflict-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 1, idempotencyKey: 'advance-conflict' }
    });
    const conflict = await server.inject({
      method: 'POST',
      url: '/api/control/advance',
      payload: { minutes: 2, idempotencyKey: 'advance-conflict' }
    });

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

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

  it('changes alert status through an auditable control event', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-alert-status-'));
    dirs.push(dir);
    const databasePath = path.join(dir, 'twin.db');
    const server = createServer({ databasePath, autoTick: false });

    await server.inject({
      method: 'POST',
      url: '/api/control/inject',
      payload: { kind: 'fridge_left_open' }
    });
    const acknowledge = await server.inject({
      method: 'POST',
      url: '/api/alerts/fridge_left_open_001/status',
      payload: { status: 'acknowledged' }
    });

    expect(acknowledge.statusCode).toBe(200);
    expect(acknowledge.json().snapshot.alerts.fridge_left_open_001.status).toBe('acknowledged');
    expect(acknowledge.json().events).toEqual([
      expect.objectContaining({
        type: 'AlertStatusChanged',
        alertId: 'fridge_left_open_001',
        previousStatus: 'active',
        status: 'acknowledged'
      })
    ]);

    await server.close();

    const restartedServer = createServer({ databasePath, autoTick: false });
    const restored = await restartedServer.inject({ method: 'GET', url: '/api/state' });
    expect(restored.json().alerts.fridge_left_open_001.status).toBe('acknowledged');

    await restartedServer.close();
  });

  it('returns a structured not found error for unknown alert status changes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'virtualhome-alert-status-not-found-'));
    dirs.push(dir);
    const server = createServer({ databasePath: path.join(dir, 'twin.db'), autoTick: false });

    const response = await server.inject({
      method: 'POST',
      url: '/api/alerts/missing_alert/status',
      payload: { status: 'acknowledged' }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Unknown alert'
    });

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

function createNthTypedMessagePromise(type: string, count: number): {
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
      let seen = 0;
      ws.on('message', (data: { toString(): string }) => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (message.type !== type) {
          return;
        }
        seen += 1;
        if (seen === count) {
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
