import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createSimulator } from '../sim/engine';
import { getScenarioIds } from '../sim/scenarios';
import type { StaticScenarioId, TwinEvent, TwinSnapshot } from '../shared/types';
import { TwinDatabase } from './persistence';

export interface ServerOptions {
  databasePath: string;
  autoTick?: boolean;
  tickMs?: number;
}

interface AdvancePayload {
  minutes?: number;
}

interface InjectPayload {
  kind?: 'door_left_open' | 'fridge_left_open' | 'network_offline' | 'senior_no_activity';
}

interface DailyStartPayload {
  date?: string;
  seed?: number;
}

export function createServer(options: ServerOptions): FastifyInstance {
  mkdirSync(path.dirname(options.databasePath), { recursive: true });
  const app = Fastify({ logger: false });
  const simulator = createSimulator({ seed: 20260617 });
  const db = new TwinDatabase(options.databasePath);
  const sockets = new Set<{ send: (payload: string) => void }>();
  const scenarioIds = getScenarioIds();
  let tickHandle: NodeJS.Timeout | undefined;

  app.register(websocket);

  function recordAndBroadcast(events: TwinEvent[]): TwinSnapshot {
    const snapshot = simulator.getSnapshot();
    db.recordSnapshot(snapshot);
    db.recordEvents(events);
    const payload = JSON.stringify({ type: 'twin.update', snapshot, events });
    for (const socket of sockets) {
      socket.send(payload);
    }
    return snapshot;
  }

  app.get('/api/scenarios', async () => scenarioIds.map((id) => ({ id })));

  app.get('/api/state', async () => simulator.getSnapshot());

  app.get('/api/events', async (request) => {
    const query = request.query as { limit?: string; runId?: string };
    const runId = query.runId ?? simulator.getSnapshot().runId;
    return db.getRecentEvents(Number(query.limit ?? 100), runId);
  });

  app.get('/api/telemetry', async (request) => {
    const query = request.query as { limit?: string; runId?: string };
    const runId = query.runId ?? simulator.getSnapshot().runId;
    return db.getRecentTelemetry(Number(query.limit ?? 100), runId);
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
    const payload = request.body as DailyStartPayload;
    const date = payload.date ?? todayInShanghai();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.status(400).send({ error: 'Date must use YYYY-MM-DD' });
    }
    const seed = payload.seed === undefined ? undefined : Number(payload.seed);
    const events = simulator.startDailyScenario({ date, seed: Number.isFinite(seed) ? seed : undefined });
    const snapshot = recordAndBroadcast(events);
    return { snapshot, events };
  });

  app.post('/api/control/advance', async (request) => {
    const payload = request.body as AdvancePayload;
    const minutes = Math.max(1, Math.min(Number(payload.minutes ?? 1), 1440));
    const events = simulator.advanceMinutes(minutes);
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
    const payload = request.body as InjectPayload;
    if (!payload.kind) {
      return reply.status(400).send({ error: 'Missing abnormality kind' });
    }
    const events = simulator.injectAbnormality(payload.kind);
    const snapshot = recordAndBroadcast(events);
    return { snapshot, events };
  });

  app.register(async (fastify) => {
    fastify.get('/ws', { websocket: true }, (socket) => {
      sockets.add(socket);
      socket.send(JSON.stringify({ type: 'twin.update', snapshot: simulator.getSnapshot(), events: [] }));
      socket.on('close', () => sockets.delete(socket));
    });
  });

  app.addHook('onReady', async () => {
    recordAndBroadcast(simulator.startDailyScenario({ date: todayInShanghai(), seed: 20260617 }));
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
