import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Session } from '../src/types.js';

async function launch(dbPath: string): Promise<{ process: ChildProcess; url: string }> {
  const child = spawn(process.execPath, ['--import','tsx','src/server.ts'], { env: { ...process.env, PORT: '0', DB_PATH: dbPath }, stdio: ['ignore','pipe','pipe'] });
  const url = await new Promise<string>((yes, no) => {
    let out = ''; let err = '';
    const timeout = setTimeout(() => { child.kill(); no(new Error('Server startup timed out: ' + err)); }, 30_000);
    child.stderr!.on('data', chunk => { err += chunk; });
    child.stdout!.on('data', chunk => { out += chunk; const match = /local demo: (http:\/\/127\.0\.0\.1:\d+)/.exec(out); if (match) { clearTimeout(timeout); yes(match[1]); } });
    child.once('error', error => { clearTimeout(timeout); no(error); });
    child.once('exit', code => { clearTimeout(timeout); if (!out.includes('local demo:')) no(new Error(`Server exited ${code}: ${err}`)); });
  });
  return { process: child, url };
}
async function stop(child: ChildProcess) { const stopped = once(child,'exit'); child.kill('SIGTERM'); await stopped; }
async function api(url: string, name: string, args: unknown): Promise<Session> {
  const response = await fetch(url + '/api/tools/' + name, { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({arguments:args}) });
  assert.equal(response.status,200,await response.clone().text());
  return (await response.json() as {result:Session}).result;
}
test('actual Node process restart preserves paused state, completed work and idempotency receipts', async () => {
  const dir = mkdtempSync(join(tmpdir(),'simmershift-process-'));
  let server = await launch(join(dir,'kitchen.sqlite'));
  try {
    const create = { requestId:'process-create',constraints:{pantry:['rice','chickpeas','carrot','lemon'],avoid:[],servings:2,targetServeAt:new Date(Date.now()+45*60_000).toISOString(),equipment:{burners:2,oven:false}} };
    const original = await api(server.url,'create_plan',create);
    let session = await api(server.url,'start_step',{sessionId:original.id,requestId:'process-start',stepId:'make-sauce'});
    session = await api(server.url,'complete_step',{sessionId:session.id,requestId:'process-done',stepId:'make-sauce'});
    session = await api(server.url,'pause_resume',{sessionId:session.id,requestId:'process-pause',action:'pause'});
    await stop(server.process);
    server = await launch(join(dir,'kitchen.sqlite'));
    const restored = await api(server.url,'get_session',{sessionId:session.id});
    assert.equal(restored.status,'paused'); assert.equal(restored.revision,session.revision);
    assert.equal(restored.steps.find(s=>s.id==='make-sauce')!.status,'complete');
    assert.deepEqual(await api(server.url,'create_plan',create),original);
  } finally { if (server.process.exitCode === null) await stop(server.process); rmSync(dir,{recursive:true,force:true}); }
});
