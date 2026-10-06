import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../src/server.js';
import { PROTOCOL_VERSION } from '../src/mcp.js';
import type { Session } from '../src/types.js';

const constraints = { pantry: ['rice', 'couscous', 'chickpeas', 'carrot', 'lemon'], avoid: [], servings: 2,
  targetServeAt: '2026-10-07T18:45:00Z', equipment: { burners: 2, oven: false } };

async function connect(url: string) {
  const client = new Client({ name: 'simmershift-integration-test', version: '1.0.0' }, { supportedProtocolVersions: [PROTOCOL_VERSION] });
  const transport = new StreamableHTTPClientTransport(new URL(url + '/mcp'));
  await client.connect(transport);
  assert.equal(transport.protocolVersion, PROTOCOL_VERSION);
  return client;
}

test('official MCP client negotiates 2025-11-25 and recovers a persisted kitchen after HTTP server restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'simmershift-mcp-'));
  const dbPath = join(dir, 'kitchen.sqlite');
  let app = await startServer({ port: 0, dbPath, now: () => '2026-10-07T18:00:00Z' });
  let client = await connect(app.url);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(t => t.name).sort(), ['create_plan','get_session','change_constraint','start_step','complete_step','pause_resume','replan','explain_changes'].sort());
    const call = async (name: string, args: Record<string, unknown>): Promise<Session> => {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result.content));
      return result.structuredContent as unknown as Session;
    };
    let session = await call('create_plan', { requestId: 'mcp-create', constraints });
    const replay = await call('create_plan', { requestId: 'mcp-create', constraints });
    assert.deepEqual(replay, session);
    session = await call('start_step', { requestId: 'mcp-sauce-start', sessionId: session.id, stepId: 'make-sauce', expectedRevision: session.revision });
    session = await call('complete_step', { requestId: 'mcp-sauce-done', sessionId: session.id, stepId: 'make-sauce', expectedRevision: session.revision });
    session = await call('pause_resume', { requestId: 'mcp-pause', sessionId: session.id, action: 'pause' });
    const sessionId = session.id;
    await client.close(); await app.close();
    app = await startServer({ port: 0, dbPath, now: () => '2026-10-07T18:01:00Z' });
    client = await connect(app.url);
    session = await call('get_session', { sessionId });
    assert.equal(session.status, 'paused');
    assert.equal(session.steps.find(s => s.id === 'make-sauce')!.status, 'complete');
    session = await call('pause_resume', { requestId: 'mcp-resume', sessionId, action: 'resume', interruptionMinutes: 10 });
    assert.equal(session.clock, '2026-10-07T18:10:00.000Z');
    session = await call('change_constraint', { requestId: 'mcp-no-rice', sessionId, patch: { pantry: ['couscous','chickpeas','carrot','lemon'] } });
    assert.deepEqual(session.steps.find(s => s.id === 'prep-base')!.ingredients, ['couscous']);
    assert.equal(session.steps.find(s => s.id === 'make-sauce')!.status, 'complete');
    const explanation = await client.callTool({ name: 'explain_changes', arguments: { sessionId } });
    assert.match(JSON.stringify(explanation.structuredContent), /rice to couscous/);
    const blocked = await client.callTool({ name: 'start_step', arguments: { sessionId, requestId: 'mcp-blocked', stepId: 'assemble' } });
    assert.equal(blocked.isError, true);
    assert.match(JSON.stringify(blocked.content), /DEPENDENCY_BLOCKED/);
    const conflict = await client.callTool({ name: 'change_constraint', arguments: { sessionId, requestId: 'mcp-avoid', patch: { avoid: ['lemon'] } } });
    assert.equal(conflict.isError, true);
    assert.match(JSON.stringify(conflict.content), /CONSTRAINT_CONFLICT/);
    const current = await call('get_session', { sessionId }); assert.equal(current.revision, session.revision);
  } finally { await client.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('local HTTP guard blocks cross-origin mutations and malformed API requests', async () => {
  const app = await startServer({ port: 0, dbPath: ':memory:' });
  try {
    let response = await fetch(app.url + '/api/tools/create_plan', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.com' }, body: '{}' });
    assert.equal(response.status, 403);
    const rawStatus = await new Promise<number | undefined>((yes, no) => {
      const req = request(app.url + '/health', { headers: { host: 'attacker.example' } }, res => { res.resume(); yes(res.statusCode); });
      req.on('error', no); req.end();
    }); assert.equal(rawStatus, 403);
    response = await fetch(app.url + '/api/tools/create_plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{invalid' });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as {error:{code:string}}).error.code, 'INVALID_JSON');
    response = await fetch(app.url + '/api/tools/create_plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ arguments: { requestId:'bad',constraints:{...constraints,equipment:{burners:99,oven:false}} } }) });
    assert.equal(response.status, 400);
  } finally { await app.close(); }
});

test('Streamable HTTP handles initialized notification and optional GET, and rejects unsupported protocol headers', async () => {
  const app = await startServer({ port:0,dbPath:':memory:' });
  try {
    const headers = { 'content-type':'application/json',accept:'application/json, text/event-stream','MCP-Protocol-Version':PROTOCOL_VERSION };
    let response = await fetch(app.url+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});
    assert.equal(response.status,202);
    response = await fetch(app.url+'/mcp',{method:'GET',headers});
    assert.equal(response.status,405); // Stateless server deliberately does not offer an SSE notification stream.
    response = await fetch(app.url+'/mcp',{method:'POST',headers:{...headers,'MCP-Protocol-Version':'1999-01-01'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
    assert.equal(response.status,400);
  } finally { await app.close(); }
});

test('concurrent API edits from one revision have one winner and one explicit stale conflict', async () => {
  const app=await startServer({port:0,dbPath:':memory:',now:()=>'2026-10-07T18:00:00Z'});
  try {
    const create=app.service.call('create_plan',{requestId:'race-create',constraints}) as Session;
    const edit=(requestId:string,patch:unknown)=>fetch(app.url+'/api/tools/change_constraint',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({arguments:{sessionId:create.id,requestId,expectedRevision:create.revision,patch}})});
    const responses=await Promise.all([edit('race-a',{equipment:{burners:1}}),edit('race-b',{avoid:['rice']})]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    const current=app.store.get(create.id);assert.equal(current.revision,2);assert.equal(app.store.eventCount(create.id),2);
    const failed=responses.find(r=>r.status===409)!;
    assert.equal((await failed.json() as {error:{code:string}}).error.code,'REVISION_CONFLICT');
  } finally { await app.close(); }
});
