import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createSimulator } from '../sim/engine';
import { getScenarioIds } from '../sim/scenarios';
import type { StaticScenarioId, TwinEvent, TwinSnapshot } from '../shared/types';
import { TwinDatabase } from './persistence';
import { projectEventsForPrivacy, projectSnapshotForPrivacy, type PrivacyMode } from './privacy';

export interface ServerOptions {
  databasePath: string;
  autoTick?: boolean;
  tickMs?: number;
}

const limitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  runId: z.string().min(1).optional(),
  privacy: z.enum(['admin', 'public']).default('admin')
});
const privacyQuerySchema = z.object({
  privacy: z.enum(['admin', 'public']).default('admin')
});
const websocketQuerySchema = z.object({
  privacy: z.enum(['admin', 'public']).default('admin'),
  runId: z.string().min(1).optional(),
  afterSequence: z.coerce.number().int().min(0).optional()
});
const advancePayloadSchema = z.object({
  minutes: z.coerce.number().int().min(1).max(1440).default(1)
});
const dailyStartPayloadSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  seed: z.coerce.number().int().min(0).max(0xffffffff).optional()
});
const injectPayloadSchema = z.object({
  kind: z.enum(['door_left_open', 'fridge_left_open', 'network_offline', 'senior_no_activity'])
});

export function createServer(options: ServerOptions): FastifyInstance {
  mkdirSync(path.dirname(options.databasePath), { recursive: true });
  const app = Fastify({ logger: false });
  const simulator = createSimulator({ seed: 20260617 });
  const db = new TwinDatabase(options.databasePath);
  const latestSnapshot = db.getLatestSnapshot();
  const restoredFromDatabase = Boolean(latestSnapshot?.runId);
  if (latestSnapshot?.runId) {
    simulator.restore(latestSnapshot, db.getEventsForRun(latestSnapshot.runId));
  }
  const sockets = new Set<{ privacy: PrivacyMode; send: (payload: string) => void }>();
  const scenarioIds = getScenarioIds();
  let tickHandle: NodeJS.Timeout | undefined;

  app.register(websocket);

  function recordAndBroadcast(events: TwinEvent[]): TwinSnapshot {
    const snapshot = simulator.getSnapshot();
    db.recordSnapshot(snapshot);
    db.recordEvents(events);
    for (const socket of sockets) {
      const payload = JSON.stringify({
        type: 'twin.update',
        snapshot: projectSnapshotForPrivacy(snapshot, socket.privacy),
        events: projectEventsForPrivacy(events, socket.privacy)
      });
      socket.send(payload);
    }
    return snapshot;
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

  app.post('/api/scenarios/:id/start', async (request, reply) => {
    const params = request.params as { id: StaticScenarioId };
    if (!scenarioIds.includes(params.id)) {
      return reply.status(404).send({ error: 'Unknown scenario' });
    }
    const events = simulator.startScenario(params.id);
    const snapshot = recordAndBroadcast(events);
    return { snapshot, events };
  });

  app.post('/api/daily/start', async (request, reply) => {
    const result = dailyStartPayloadSchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const date = result.data.date ?? todayInShanghai();
    const events = simulator.startDailyScenario({ date, seed: result.data.seed });
    const snapshot = recordAndBroadcast(events);
    return { snapshot, events };
  });

  app.post('/api/control/advance', async (request, reply) => {
    const result = advancePayloadSchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const events = simulator.advanceMinutes(result.data.minutes);
    const snapshot = recordAndBroadcast(events);
    return { snapshot, events };
  });

  app.post('/api/control/pause', async () => {
    const events = simulator.setPaused(true);
    const snapshot = recordAndBroadcast(events);
    return { snapshot, events };
  });

  app.post('/api/control/resume', async () => {
    const events = simulator.setPaused(false);
    const snapshot = recordAndBroadcast(events);
    return { snapshot, events };
  });

  app.post('/api/control/inject', async (request, reply) => {
    const result = injectPayloadSchema.safeParse(request.body ?? {});
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    const events = simulator.injectAbnormality(result.data.kind);
    const snapshot = recordAndBroadcast(events);
    return { snapshot, events };
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
      socket.send(JSON.stringify({
        type: 'twin.update',
        snapshot: projectSnapshotForPrivacy(simulator.getSnapshot(), privacy),
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
  });

  app.addHook('onClose', async () => {
    if (tickHandle) {
      clearInterval(tickHandle);
    }
    db.close();
  });

  return app;
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
