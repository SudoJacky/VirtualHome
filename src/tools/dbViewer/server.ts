import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import react from '@vitejs/plugin-react';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { z } from 'zod';
import { DbViewerStore } from './store';
import type { DbViewerSourceType } from './types';

export interface DbViewerServerOptions {
  homeMemoryDatabasePath: string;
  agentProfileDatabasePath: string;
  deviceEventsDatabasePath?: string;
  serveClient?: boolean;
}

const optionalLimitSchema = z.coerce.number().int().min(1).max(500).default(100);
const entryQuerySchema = z.object({
  homeId: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  entryType: z.string().min(1).optional(),
  subjectType: z.string().min(1).optional(),
  text: z.string().optional(),
  limit: optionalLimitSchema
});
const searchQuerySchema = z.object({
  homeId: z.string().min(1),
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});
const homeIdQuerySchema = z.object({
  homeId: z.string().min(1).optional()
});
const memoryListQuerySchema = z.object({
  homeId: z.string().min(1),
  runId: z.string().min(1),
  text: z.string().optional(),
  limit: optionalLimitSchema
});
const sourceQuerySchema = z.object({
  sourceType: z.enum(['home_memory_evidence', 'home_memory_hypothesis', 'home_memory_portrait_section', 'device_event_query', 'user_statement', 'agent_reasoning', 'manual_review']),
  sourceId: z.string().min(1),
  homeId: z.string().min(1),
  runId: z.string().min(1).optional()
});
const deviceEventQuerySchema = z.object({
  homeId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  fromSequence: z.coerce.number().int().optional(),
  toSequence: z.coerce.number().int().optional(),
  fromSimTime: z.string().min(1).optional(),
  toSimTime: z.string().min(1).optional(),
  roomId: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
  deviceType: z.string().min(1).optional(),
  field: z.string().min(1).optional(),
  sourceEventType: z.enum(['DeviceTelemetry', 'DeviceStateChanged']).optional(),
  q: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100)
});
const deviceEventSourceQuerySchema = z.object({
  homeId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100)
});
const deviceEventAroundSourceQuerySchema = z.object({
  sourceEventId: z.string().min(1),
  homeId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  windowMinutes: z.coerce.number().min(1).max(24 * 60).default(30),
  limit: z.coerce.number().int().min(1).max(1000).default(200)
});
const deviceEventQueryAuditListSchema = z.object({
  homeId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

export function createDbViewerServer(options: DbViewerServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = new DbViewerStore(options);

  app.setErrorHandler((error, request, reply) => {
    const message = errorMessage(error);
    console.error('[db-viewer] request_failed', JSON.stringify({
      method: request.method,
      url: request.url,
      message
    }));
    reply.status(500).send({
      error: {
        code: 'DB_VIEWER_READ_FAILED',
        message
      }
    });
  });

  app.get('/api/db-viewer/health', async () => store.getHealth());

  app.get('/api/db-viewer/agent-profile/entries', async (request, reply) => {
    const result = entryQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return store.listAgentProfileEntries(result.data);
  });

  app.get('/api/db-viewer/agent-profile/search', async (request, reply) => {
    const result = searchQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return store.searchAgentProfileEntries(result.data);
  });

  app.get('/api/db-viewer/agent-profile/entries/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const entry = store.getAgentProfileEntry(params.id);
    if (!entry) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Agent Profile entry not found' } });
    }
    return entry;
  });

  app.get('/api/db-viewer/home-memory/runs', async (request, reply) => {
    const result = homeIdQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return store.listHomeMemoryRuns(result.data);
  });

  app.get('/api/db-viewer/home-memory/evidence', async (request, reply) => {
    const result = memoryListQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return store.listHomeMemoryEvidence(result.data);
  });

  app.get('/api/db-viewer/home-memory/hypotheses', async (request, reply) => {
    const result = memoryListQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return store.listHomeMemoryHypotheses(result.data);
  });

  app.get('/api/db-viewer/home-memory/portrait-sections', async (request, reply) => {
    const result = memoryListQuerySchema.omit({ limit: true }).safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return store.listHomeMemoryPortraitSections(result.data);
  });

  app.get('/api/db-viewer/home-memory/source', async (request, reply) => {
    const result = sourceQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return store.resolveHomeMemorySource({
      ...result.data,
      sourceType: result.data.sourceType as DbViewerSourceType
    });
  });

  app.get('/api/db-viewer/device-events', async (request, reply) => {
    const result = deviceEventQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return store.listDeviceEvents(result.data);
  });

  app.get('/api/db-viewer/device-events/around-source', async (request, reply) => {
    const result = deviceEventAroundSourceQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return store.listDeviceEventsAroundSource(result.data.sourceEventId, result.data);
  });

  app.get('/api/db-viewer/device-events/source/:sourceEventId', async (request, reply) => {
    const params = request.params as { sourceEventId: string };
    const result = deviceEventSourceQuerySchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return store.listDeviceEventsBySource(params.sourceEventId, result.data);
  });

  app.get('/api/db-viewer/device-events/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const event = store.getDeviceEvent(params.id);
    if (!event) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Device event not found' } });
    }
    return event;
  });

  app.get('/api/db-viewer/device-event-queries', async (request, reply) => {
    const result = deviceEventQueryAuditListSchema.safeParse(request.query);
    if (!result.success) {
      return sendValidationError(reply, result.error);
    }
    return store.listDeviceEventQueries(result.data);
  });

  app.get('/api/db-viewer/device-event-queries/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const query = store.getDeviceEventQuery(params.id);
    if (!query) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Device event query not found' } });
    }
    return query;
  });

  if (options.serveClient !== false) {
    registerClientRoutes(app);
  }

  app.addHook('onClose', async () => {
    store.close();
  });

  return app;
}

function registerClientRoutes(app: FastifyInstance): void {
  let viteServerPromise: Promise<ViteDevServer> | null = null;
  const getViteServer = (): Promise<ViteDevServer> => {
    viteServerPromise ??= createViteServer({
      appType: 'custom',
      configFile: false,
      plugins: [react()],
      root: process.cwd(),
      server: {
        middlewareMode: true
      }
    });
    return viteServerPromise;
  };
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>VirtualHome DB Viewer</title>
    <script type="module" src="/src/tools/dbViewer/client/main.tsx"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

  app.get('/', async (_request, reply) => {
    const vite = await getViteServer();
    reply.type('text/html').send(await vite.transformIndexHtml('/', html));
  });

  app.get('/*', async (request, reply) => {
    const vite = await getViteServer();
    const transformed = await vite.transformRequest(request.raw.url ?? request.url);
    if (transformed) {
      return reply
        .header('Content-Type', 'application/javascript')
        .send(transformed.code);
    }
    reply.hijack();
    vite.middlewares(request.raw, reply.raw, (error: unknown) => {
      if (error) {
        console.error('[db-viewer] client_asset_failed', error);
        if (!reply.raw.headersSent) {
          reply.raw.statusCode = 500;
          reply.raw.end('Failed to serve DB viewer client asset');
        }
        return;
      }
      if (!reply.raw.writableEnded) {
        reply.raw.statusCode = 404;
        reply.raw.end('Not found');
      }
    });
  });

  app.addHook('onClose', async () => {
    if (viteServerPromise) {
      const vite = await viteServerPromise;
      await vite.close();
    }
  });
}

function sendValidationError(reply: FastifyReply, error: z.ZodError): FastifyReply {
  return reply.status(400).send({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid viewer request',
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface DbViewerCliOptions extends DbViewerServerOptions {
  port: number;
}

export function parseDbViewerCliArgs(args: string[], cwd = process.cwd()): DbViewerCliOptions {
  let homeMemoryDatabasePath = path.join(cwd, 'data', 'home-memory.db');
  let agentProfileDatabasePath = path.join(cwd, 'data', 'agent-profile.db');
  let deviceEventsDatabasePath: string | undefined;
  let port = 4329;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--home-memory-db') {
      homeMemoryDatabasePath = resolveCliPath(args[index + 1], cwd, '--home-memory-db');
      index += 1;
      continue;
    }
    if (arg.startsWith('--home-memory-db=')) {
      homeMemoryDatabasePath = resolveCliPath(arg.slice('--home-memory-db='.length), cwd, '--home-memory-db');
      continue;
    }
    if (arg === '--agent-profile-db') {
      agentProfileDatabasePath = resolveCliPath(args[index + 1], cwd, '--agent-profile-db');
      index += 1;
      continue;
    }
    if (arg === '--device-events-db') {
      deviceEventsDatabasePath = resolveCliPath(args[index + 1], cwd, '--device-events-db');
      index += 1;
      continue;
    }
    if (arg.startsWith('--device-events-db=')) {
      deviceEventsDatabasePath = resolveCliPath(arg.slice('--device-events-db='.length), cwd, '--device-events-db');
      continue;
    }
    if (arg.startsWith('--agent-profile-db=')) {
      agentProfileDatabasePath = resolveCliPath(arg.slice('--agent-profile-db='.length), cwd, '--agent-profile-db');
      continue;
    }
    if (arg === '--port') {
      port = Number(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--port=')) {
      port = Number(arg.slice('--port='.length));
      continue;
    }
    throw new Error(`Unknown db viewer argument: ${arg}`);
  }
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid db viewer port: ${port}`);
  }
  return {
    homeMemoryDatabasePath,
    agentProfileDatabasePath,
    deviceEventsDatabasePath,
    port
  };
}

function resolveCliPath(value: string | undefined, cwd: string, flag: string): string {
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return path.isAbsolute(value) ? value : path.join(cwd, value);
}

async function main(): Promise<void> {
  const options = parseDbViewerCliArgs(process.argv.slice(2));
  const app = createDbViewerServer(options);
  try {
    await app.listen({ host: '127.0.0.1', port: options.port });
    console.log(`[db-viewer] listening http://127.0.0.1:${options.port}`);
    console.log(`[db-viewer] homeMemoryDatabasePath=${options.homeMemoryDatabasePath}`);
    console.log(`[db-viewer] agentProfileDatabasePath=${options.agentProfileDatabasePath}`);
    if (options.deviceEventsDatabasePath) {
      console.log(`[db-viewer] deviceEventsDatabasePath=${options.deviceEventsDatabasePath}`);
    }
  } catch (error) {
    console.error('[db-viewer] startup_failed', error);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main();
}
