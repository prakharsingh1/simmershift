import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeStreamableHTTPServerTransport, localhostHostValidation } from '@modelcontextprotocol/node';
import { createMcpServer, PROTOCOL_VERSION } from './mcp.js';
import { KitchenService } from './service.js';
import { KitchenStore } from './store.js';
import { KitchenError, type ToolName } from './types.js';
import { toolSchemas } from './schemas.js';

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk); length += bytes.length;
    if (length > 256_000) throw new KitchenError('BODY_TOO_LARGE', 'Request body exceeds 256 KB.');
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new KitchenError('INVALID_JSON', 'Provide a valid JSON request body.'); }
}
export async function startServer(options: { port?: number; dbPath?: string; now?: () => string } = {}) {
  const store = new KitchenStore(options.dbPath ?? resolve('data/simmershift.sqlite'));
  const service = new KitchenService(store, options.now);
  const validateHost = localhostHostValidation();
  const http = createServer(async (req, res) => {
    if (!validateHost(req, res)) return;
    // An Origin must be this exact local host/port, not a different local app.
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
      json(res, 403, { error: { code: 'ORIGIN_REJECTED', message: 'Use the same local origin.' } }); return;
    }
    res.setHeader('x-content-type-options', 'nosniff');
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (path === '/mcp') {
        // The spec permits 405 when the optional server-to-client SSE stream is not offered.
        if (req.method === 'GET') { res.setHeader('allow', 'POST'); json(res, 405, { error: { code: 'SSE_NOT_OFFERED', message: 'Use POST for this stateless MCP endpoint.' } }); return; }
        const server = createMcpServer(service);
        const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.once('close', () => { void server.close(); });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.method === 'POST' ? await body(req) : undefined);
        return;
      }
      if (path === '/health' && req.method === 'GET') {
        json(res, 200, { status: 'ok', name: 'simmershift-mcp', protocolVersion: PROTOCOL_VERSION, simulation: true }); return;
      }
      if (path.startsWith('/api/tools/') && req.method === 'POST') {
        const name = path.slice('/api/tools/'.length);
        if (!(name in toolSchemas) || !Object.hasOwn(toolSchemas, name)) throw new KitchenError('TOOL_NOT_FOUND', 'Unknown kitchen tool.');
        if (!req.headers['content-type']?.startsWith('application/json')) throw new KitchenError('INVALID_INPUT', 'Use application/json.');
        const data = await body(req);
        if (!data || typeof data !== 'object' || !Object.hasOwn(data, 'arguments')) throw new KitchenError('INVALID_INPUT', 'Provide an arguments object.');
        const result = service.call(name as ToolName, (data as { arguments: unknown }).arguments);
        json(res, 200, { result }); return;
      }
      const assets: Record<string, [string, string]> = {
        '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'],
        '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'],
        '/mark.svg': ['mark.svg', 'image/svg+xml'],
      };
      if (req.method === 'GET' && assets[path]) {
        const [file, mime] = assets[path];
        const content = await readFile(resolve('public', file));
        res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-cache',
          'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
        res.end(content); return;
      }
      json(res, 404, { error: { code: 'NOT_FOUND', message: 'Route not found.' } });
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      const e = error instanceof KitchenError ? error : new KitchenError('INTERNAL_ERROR', 'The local server could not process this request.');
      if (!(error instanceof KitchenError)) console.error(error);
      const status = ['REVISION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'CONSTRAINT_CONFLICT', 'DEPENDENCY_BLOCKED', 'RESOURCE_BUSY', 'SESSION_PAUSED', 'PHYSICAL_STATE_REQUIRED', 'STEP_STATE', 'SESSION_SERVED'].includes(e.code) ? 409 : e.code === 'SESSION_NOT_FOUND' ? 404 : e.code === 'BODY_TOO_LARGE' ? 413 : e.code === 'INTERNAL_ERROR' ? 500 : 400;
      json(res, status, { error: { code: e.code, message: e.message, details: e.details } });
    }
  });
  await new Promise<void>((yes, no) => { http.once('error', no); http.listen(options.port ?? 4317, '127.0.0.1', yes); });
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : 4317;
  return { port, url: `http://127.0.0.1:${port}`, service, store, close: async () => {
    http.closeAllConnections();
    await new Promise<void>((yes, no) => http.close(e => e ? no(e) : yes())); store.close();
  } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = await startServer({ port: Number(process.env.PORT ?? 4317), dbPath: process.env.DB_PATH });
  console.log(`SimmerShift local demo: ${app.url}\nMCP endpoint: ${app.url}/mcp (protocol ${PROTOCOL_VERSION})`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
