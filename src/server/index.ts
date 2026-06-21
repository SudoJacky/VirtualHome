import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from './app';
import { resolveServerRuntimeOptions } from './runtimeOptions';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtimeOptions = resolveServerRuntimeOptions(root);
const server = createServer(runtimeOptions.serverOptions);

await server.listen({ host: '127.0.0.1', port: runtimeOptions.port });
console.log(`VirtualHome Twin API listening on http://127.0.0.1:${runtimeOptions.port}`);
