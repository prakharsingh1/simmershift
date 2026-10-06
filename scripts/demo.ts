import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startServer } from '../src/server.js';
import type { Session } from '../src/types.js';

const directory = mkdtempSync(join(tmpdir(), 'simmershift-demo-'));
let now = '2026-10-07T18:00:00.000Z';
const dbPath = join(directory, 'demo.sqlite');
let app = await startServer({ port: 0, dbPath, now: () => now });
let transport = new StreamableHTTPClientTransport(new URL(app.url + '/mcp'));
let client = new Client({ name: 'simmershift-demo', version: '1.0.0' }, { supportedProtocolVersions: ['2025-11-25'] });
const snapshots: { action: string; session: Session }[] = [];
const checks: string[] = [];
let sequence = 0;
async function call(name: string, args: Record<string, unknown>, record = true): Promise<Session> {
  const response = await client.callTool({ name, arguments: args });
  assert.ok(!response.isError, JSON.stringify(response.content));
  const result = response.structuredContent as unknown as Session;
  if (record) snapshots.push({ action: name, session: result });
  return result;
}
async function mutate(name: string, session: Session, args: Record<string, unknown> = {}) {
  return call(name, { sessionId: session.id, expectedRevision: session.revision, requestId: `demo-${++sequence}`, ...args });
}
try {
  await client.connect(transport);
  assert.equal(transport.protocolVersion, '2025-11-25');
  const tools = (await client.listTools()).tools.map(t => t.name);
  assert.equal(tools.length, 8); checks.push('Official SDK client negotiated MCP 2025-11-25 over Streamable HTTP and discovered eight tools.');
  const create = { requestId: 'demo-create', name: 'Interrupted pantry bowl', constraints: {
    pantry: ['rice','couscous','chickpeas','carrot','lemon'], avoid: [], servings: 2,
    targetServeAt: '2026-10-07T18:25:00Z', equipment: { burners: 2, oven: false },
  } };
  let session = await call('create_plan', create);
  assert.deepEqual(await call('create_plan', create, false), session); checks.push('Identical create retry returned the same persisted session.');
  session = await mutate('start_step', session, { stepId: 'make-sauce' });
  now = session.steps.find(s => s.id === 'make-sauce')!.timerEndsAt!;
  session = await mutate('complete_step', session, { stepId: 'make-sauce' });
  session = await mutate('pause_resume', session, { action: 'pause' });
  await client.close(); await app.close();
  app = await startServer({ port: 0, dbPath, now: () => now });
  client = new Client({ name: 'simmershift-demo-reconnect', version: '1.0.0' }, { supportedProtocolVersions: ['2025-11-25'] });
  transport = new StreamableHTTPClientTransport(new URL(app.url + '/mcp'));
  await client.connect(transport);
  session = await call('get_session', { sessionId: session.id });
  assert.equal(session.status, 'paused'); assert.equal(session.steps.find(s => s.id === 'make-sauce')!.status, 'complete');
  checks.push('Server restart retained the paused session and confirmed sauce preparation in SQLite.');
  session = await mutate('pause_resume', session, { action: 'resume', interruptionMinutes: 10 });
  const rescue = session.changes.some(c => c.message.includes('rice to couscous'));
  session = await mutate('change_constraint', session, { patch: { pantry: ['couscous','chickpeas','carrot','lemon'] } });
  assert.ok(rescue || session.changes.some(c => c.message.includes('rice to couscous')));
  checks.push('After a simulated ten-minute interruption, deadline rescue chose available couscous; removing rice then kept that choice and the finished sauce.');
  for (const stepId of ['prep-base','prep-protein']) {
    session = await mutate('start_step', session, { stepId });
    const step = session.steps.find(s => s.id === stepId)!;
    now = new Date(Date.parse(step.timerEndsAt!) - (session.clockOffsetMs ?? 0)).toISOString();
    session = await mutate('complete_step', session, { stepId });
    session = await mutate('start_step', session, { stepId: stepId.replace('prep','cook') });
  }
  assert.equal(session.steps.filter(s => s.status === 'active' && s.resources.includes('burner')).length, 2);
  checks.push('Two independent cooking steps ran with separate persisted timer deadlines on two burners.');
  const first = session.steps.find(s => s.id === 'cook-protein')!;
  now = new Date(Date.parse(first.timerEndsAt!) - (session.clockOffsetMs ?? 0)).toISOString();
  session = await mutate('complete_step', session, { stepId: first.id });
  session = await mutate('change_constraint', session, { patch: { equipment: { burners: 1 } } });
  assert.ok(session.slackMinutes < 0); checks.push('Reducing to one burner rescheduled pending work and disclosed an infeasible serving target.');
  const conflict = await client.callTool({ name: 'change_constraint', arguments: { sessionId: session.id, requestId: 'demo-hard-conflict', patch: { avoid: ['lemon'] } } });
  assert.equal(conflict.isError, true);
  const persisted = await call('get_session', { sessionId: session.id }, false);
  assert.equal(persisted.revision, session.revision); checks.push('A hard avoid conflict with completed lemon preparation failed atomically.');
  // Finish the remaining synthetic tasks in valid dependency/resource order.
  while (session.status !== 'served') {
    const active = session.steps.filter(s => s.status === 'active').sort((a,b) => Date.parse(a.timerEndsAt!) - Date.parse(b.timerEndsAt!))[0];
    if (active) {
      now = new Date(Math.max(Date.parse(now), Date.parse(active.timerEndsAt!) - (session.clockOffsetMs ?? 0))).toISOString();
      session = await mutate('complete_step', session, { stepId: active.id });
    } else {
      const ready = session.steps.find(s => s.status === 'pending' && s.dependencies.every(id => session.steps.find(d => d.id === id)!.status === 'complete'));
      assert.ok(ready); session = await mutate('start_step', session, { stepId: ready.id });
    }
  }
  assert.ok(session.steps.every(s => s.status === 'complete')); checks.push('The recovered meal reached served with all prerequisite steps explicitly confirmed.');
  mkdirSync('demo', { recursive: true });
  writeFileSync('demo/recovery.json', JSON.stringify({ generatedAt: new Date().toISOString(), project: 'SimmerShift',
    simulation: 'Synthetic pantry; scripted clock and explicit interruption advance; no Alexa device connection.',
    protocolVersion: transport.protocolVersion, sdkClient: client.getServerVersion(), tools, checks, snapshots }, null, 2) + '\n');
  console.log(`Verified ${checks.length} recovery assertions through the official MCP client. Evidence: demo/recovery.json`);
} finally { await client.close(); await app.close(); rmSync(directory, { recursive: true, force: true }); }
