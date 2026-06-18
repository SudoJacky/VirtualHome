import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createSimulator } from '../sim/engine';
import { getScenarioIds } from '../sim/scenarios';
import type { StaticScenarioId, TwinEvent, TwinSnapshot } from '../shared/types';
import { createDeviceAccessRecords } from './deviceAccess';
import { buildOpenApiDocument } from './openapi';
import { TwinDatabase } from './persistence';
import { projectEventsForPrivacy, projectSnapshotForPrivacy, type PrivacyMode } from './privacy';
import { summarizeTelemetry } from './telemetrySummary';

export interface ServerOptions {
  databasePath: string;
  autoTick?: boolean;
  tickMs?: number;
  heartbeatMs?: number;
  snapshotIntervalEvents?: number;
}

const limitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  runId: z.string().min(1).optional(),
  privacy: z.enum(['admin', 'public']).default('admin')
});
const telemetrySummaryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  runId: z.string().min(1).optional()
});
const privacyQuerySchema = z.object({
  privacy: z.enum(['admin', 'public']).default('admin')
});
const websocketQuerySchema = z.object({
  privacy: z.enum(['admin', 'public']).default('admin'),
  runId: z.string().min(1).optional(),
  afterSequence: z.coerce.number().int().min(0).optional()
});
const idempotencyPayloadSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(128).optional()
});
const advancePayloadSchema = idempotencyPayloadSchema.extend({
  minutes: z.coerce.number().int().min(1).max(1440).default(1)
});
const dailyStartPayloadSchema = idempotencyPayloadSchema.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  seed: z.coerce.number().int().min(0).max(0xffffffff).optional()
});
const injectPayloadSchema = idempotencyPayloadSchema.extend({
  kind: z.enum(['door_left_open', 'fridge_left_open', 'network_offline', 'senior_no_activity'])
});
const resolvePayloadSchema = injectPayloadSchema;

type UpdateResponse = {
  snapshot: TwinSnapshot;
  events: TwinEvent[];
};

export function createServer(options: ServerOptions): FastifyInstance {
  mkdirSync(path.dirname(options.databasePath), { recursive: true });
  const app = Fastify({ logger: false });
  const simulator = createSimulator({ seed: 20260617 });
  const db = new TwinDatabase(options.databasePath, { snapshotIntervalEvents: options.snapshotIntervalEvents });
  const latestSnapshot = db.getLatestSnapshot();
  const restoredFromDatabase = Boolean(latestSnapshot?.runId);
  if (latestSnapshot?.runId) {
    simulator.restore(latestSnapshot, db.getEventsForRun(latestSnapshot.runId));
  }
  const sockets = new Set<{ privacy: PrivacyMode; send: (payload: string) => void }>();
  const scenarioIds = getScenarioIds();
  let tickHandle: NodeJS.Timeout | undefined;
  let heartbeatHandle: NodeJS.Timeout | undefined;

  app.register(websocket);

  app.get('/api/openapi.json', async () => buildOpenApiDocument());

  function recordAndBroadcast(events: TwinEvent[]): TwinSnapshot {
    const snapshot = simulator.getSnapshot();
    const snapshotRecorded = db.recordUpdate(snapshot, events);
    for (const socket of sockets) {
      const payload = JSON.stringify({
        type: 'twin.update',
        runId: snapshot.runId,
        sequence: snapshot.simClock.sequence,
        ...(snapshotRecorded ? { snapshot: projectSnapshotForPrivacy(snapshot, socket.privacy) } : {}),
        events: projectEventsForPrivacy(events, socket.privacy)
      });
      socket.send(payload);
    }
    return snapshot;
  }

  function broadcastHeartbeat(): void {
    const snapshot = simulator.getSnapshot();
    const payload = JSON.stringify({
      type: 'twin.heartbeat',
      ts: new Date().toISOString(),
      runId: snapshot.runId,
      sequence: snapshot.simClock.sequence
    });
    for (const socket of sockets) {
      socket.send(payload);
    }
  }

  app.get('/api/scenarios', async () => scenarioIds.map((id) => ({ id })));

  app.get('/api/state', async (request, reply) => {
    const result = privacyQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return projectSnapshotForPrivacy(simulator.getSnapshot(), result.data.privacy);
  });

  app.get('/api/events', async (request, reply) => {
    const result = limitQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const runId = result.data.runId ?? simulator.getSnapshot().runId;
    return projectEventsForPrivacy(db.getRecentEvents(result.data.limit, runId), result.data.privacy);
  });

  app.get('/api/telemetry', async (request, reply) => {
    const result = limitQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const runId = result.data.runId ?? simulator.getSnapshot().runId;
    return db.getRecentTelemetry(result.data.limit, runId);
  });

  app.get('/api/telemetry/summary', async (request, reply) => {
    const result = telemetrySummaryQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const runId = result.data.runId ?? simulator.getSnapshot().runId;
    return summarizeTelemetry(db.getRecentTelemetry(result.data.limit, runId), result.data.limit, runId);
  });

  app.get('/api/device-twins', async () => {
    const snapshot = simulator.getSnapshot();
    return createDeviceAccessRecords(snapshot, db.getRecentEvents(500, snapshot.runId));
  });

  app.post('/api/scenarios/:id/start', async (request, reply) => {
    const params = request.params as { id: StaticScenarioId };
    const result = idempotencyPayloadSchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    if (!scenarioIds.includes(params.id)) {
      return reply.status(404).send({ error: 'Unknown scenario' });
    }
    return runIdempotentCommand(reply, result.data.idempotencyKey, `POST /api/scenarios/${params.id}/start`, stripIdempotencyKey(result.data), () => {
      const events = simulator.startScenario(params.id);
      const snapshot = recordAndBroadcast(events);
      return { snapshot, events };
    });
  });

  app.post('/api/daily/start', async (request, reply) => {
    const result = dailyStartPayloadSchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return runIdempotentCommand(reply, result.data.idempotencyKey, 'POST /api/daily/start', stripIdempotencyKey(result.data), () => {
      const date = result.data.date ?? todayInShanghai();
      const events = simulator.startDailyScenario({ date, seed: result.data.seed });
      const snapshot = recordAndBroadcast(events);
      return { snapshot, events };
    });
  });

  app.post('/api/control/advance', async (request, reply) => {
    const result = advancePayloadSchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return runIdempotentCommand(reply, result.data.idempotencyKey, 'POST /api/control/advance', stripIdempotencyKey(result.data), () => {
      const events = simulator.advanceMinutes(result.data.minutes);
      const snapshot = recordAndBroadcast(events);
      return { snapshot, events };
    });
  });

  app.post('/api/control/pause', async (request, reply) => {
    const result = idempotencyPayloadSchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return runIdempotentCommand(reply, result.data.idempotencyKey, 'POST /api/control/pause', stripIdempotencyKey(result.data), () => {
      const events = simulator.setPaused(true);
      const snapshot = recordAndBroadcast(events);
      return { snapshot, events };
    });
  });

  app.post('/api/control/resume', async (request, reply) => {
    const result = idempotencyPayloadSchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return runIdempotentCommand(reply, result.data.idempotencyKey, 'POST /api/control/resume', stripIdempotencyKey(result.data), () => {
      const events = simulator.setPaused(false);
      const snapshot = recordAndBroadcast(events);
      return { snapshot, events };
    });
  });

  app.post('/api/control/inject', async (request, reply) => {
    const result = injectPayloadSchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return runIdempotentCommand(reply, result.data.idempotencyKey, 'POST /api/control/inject', stripIdempotencyKey(result.data), () => {
      const events = simulator.injectAbnormality(result.data.kind);
      const snapshot = recordAndBroadcast(events);
      return { snapshot, events };
    });
  });

  app.post('/api/control/resolve', async (request, reply) => {
    const result = resolvePayloadSchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return runIdempotentCommand(reply, result.data.idempotencyKey, 'POST /api/control/resolve', stripIdempotencyKey(result.data), () => {
      const events = simulator.resolveAbnormality(result.data.kind);
      const snapshot = recordAndBroadcast(events);
      return { snapshot, events };
    });
  });

  app.register(async (fastify) => {
    fastify.get('/ws', { websocket: true }, (socket, request) => {
      const result = websocketQuerySchema.safeParse(request.query);
      const privacy = result.success ? result.data.privacy : 'admin';
      const replayEvents = result.success && result.data.runId && result.data.afterSequence !== undefined
        ? db.getEventsAfter(result.data.runId, result.data.afterSequence)
        : [];
      const client = { privacy, send: (payload: string) => socket.send(payload) };
      sockets.add(client);
      const snapshot = simulator.getSnapshot();
      socket.send(JSON.stringify({
        type: 'twin.update',
        runId: snapshot.runId,
        sequence: snapshot.simClock.sequence,
        snapshot: projectSnapshotForPrivacy(snapshot, privacy),
        events: projectEventsForPrivacy(replayEvents, privacy)
      }));
      socket.on('close', () => sockets.delete(client));
    });
  });

  app.addHook('onReady', async () => {
    if (!restoredFromDatabase) {
      recordAndBroadcast(simulator.startDailyScenario({ date: todayInShanghai(), seed: 20260617 }));
    }
    if (options.autoTick !== false) {
      tickHandle = setInterval(() => {
        const events = simulator.advanceMinutes(1);
        if (events.length > 0) {
          recordAndBroadcast(events);
        }
      }, options.tickMs ?? 1000);
    }
    const heartbeatMs = options.heartbeatMs ?? 15000;
    if (heartbeatMs > 0) {
      heartbeatHandle = setInterval(() => broadcastHeartbeat(), heartbeatMs);
    }
  });

  app.addHook('onClose', async () => {
    if (tickHandle) {
      clearInterval(tickHandle);
    }
    if (heartbeatHandle) {
      clearInterval(heartbeatHandle);
    }
    db.close();
  });

  return app;

  function runIdempotentCommand(
    reply: FastifyReply,
    idempotencyKey: string | undefined,
    scope: string,
    payload: unknown,
    action: () => UpdateResponse
  ): UpdateResponse | FastifyReply {
    if (!idempotencyKey) {
      return action();
    }
    const requestHash = hashRequest(scope, payload);
    const cached = db.getIdempotencyRecord<UpdateResponse>(idempotencyKey);
    if (cached) {
      if (cached.requestHash !== requestHash) {
        return sendIdempotencyConflict(reply);
      }
      return cached.response;
    }
    const response = action();
    db.recordIdempotencyResponse(idempotencyKey, requestHash, response);
    return response;
  }
}

function todayInShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function sendValidationError(reply: FastifyReply, error: z.ZodError): FastifyReply {
  return reply.status(400).send({
    error: {
      code: 'VALIDATION_FAILED',
      message: 'Invalid request input',
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    }
  });
}

function sendIdempotencyConflict(reply: FastifyReply): FastifyReply {
  return reply.status(409).send({
    error: {
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'Idempotency key was already used with a different request'
    }
  });
}

function stripIdempotencyKey<T extends { idempotencyKey?: string }>(payload: T): Omit<T, 'idempotencyKey'> {
  const { idempotencyKey: _idempotencyKey, ...rest } = payload;
  return rest;
}

function hashRequest(scope: string, payload: unknown): string {
  return createHash('sha256')
    .update(stableJson({ scope, payload }))
    .digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
