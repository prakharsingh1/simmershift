import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { KitchenService } from '../src/service.js';
import { KitchenStore } from '../src/store.js';
import { KitchenError, type Constraints, type HistoryEntry, type Resource, type Session, type ToolName } from '../src/types.js';

const MINUTE = 60_000;
const START = Date.parse('2026-10-07T18:00:00.000Z');
const PANTRY = ['rice', 'couscous', 'chickpeas', 'carrot', 'lemon', 'oil'];
const STEP_IDS = ['prep-base', 'cook-base', 'prep-protein', 'cook-protein', 'prep-vegetable', 'cook-vegetable', 'make-sauce', 'assemble'];

interface Explanation {
  revision: number;
  summary: string;
  history: HistoryEntry[];
  briefing: {
    completed: string[];
    active: { id: string; title: string; timerEndsAt: string; remainingMinutes: number }[];
    nextReady: { id: string; title: string }[];
    summary: string;
  };
}

function constraints(patch: Partial<Constraints> = {}): Constraints {
  return {
    pantry: [...PANTRY], avoid: [], servings: 2,
    targetServeAt: '2026-10-07T19:00:00.000Z', equipment: { burners: 2, oven: false },
    ...patch,
  };
}

function fixture(t: TestContext, path = ':memory:') {
  const clock = { ms: START };
  let store = new KitchenStore(path);
  let service = new KitchenService(store, () => new Date(clock.ms).toISOString());
  let request = 0;
  t.after(() => store.close());
  return {
    clock,
    get store() { return store; },
    get service() { return service; },
    advance(minutes: number) { clock.ms += minutes * MINUTE; },
    reopen() {
      store.close();
      store = new KitchenStore(path);
      service = new KitchenService(store, () => new Date(clock.ms).toISOString());
    },
    create(patch: Partial<Constraints> = {}) {
      return service.call('create_plan', {
        requestId: `create-${++request}`, name: 'SimmerShift test dinner', constraints: constraints(patch),
      }) as Session;
    },
    mutate(name: ToolName, session: Session, extra: Record<string, unknown> = {}) {
      return service.call(name, {
        sessionId: session.id, requestId: `mutation-${++request}`, expectedRevision: session.revision, ...extra,
      }) as Session;
    },
    finish(session: Session, stepId: string) {
      const started = this.mutate('start_step', session, { stepId });
      this.advance(step(started, stepId).durationMinutes);
      return this.mutate('complete_step', started, { stepId });
    },
  };
}

function step(session: Session, id: string) {
  const found = session.steps.find(item => item.id === id);
  assert.ok(found, `Expected step ${id} in the meal`);
  return found;
}

function throwsCode(work: () => unknown, code: string) {
  assert.throws(work, (error: unknown) => {
    assert.ok(error instanceof KitchenError);
    assert.equal(error.code, code);
    return true;
  });
}

function assertUnchanged(store: KitchenStore, session: Session, events: number) {
  assert.deepEqual(store.get(session.id), session, 'A rejected mutation must not overwrite the persisted meal');
  assert.equal(store.eventCount(session.id), events, 'A rejected mutation must not append an event');
}

function assertSchedule(session: Session) {
  assert.deepEqual(session.steps.map(item => item.id), STEP_IDS);
  for (const item of session.steps) {
    assert.ok(Date.parse(item.scheduledStart) < Date.parse(item.scheduledEnd), `${item.id} must have positive scheduled duration`);
    for (const dependency of item.dependencies) {
      assert.ok(
        Date.parse(item.scheduledStart) >= Date.parse(step(session, dependency).scheduledEnd),
        `${item.id} cannot be scheduled before ${dependency} finishes`,
      );
    }
  }
  const capacity: Record<Resource, number> = { hands: 1, burner: session.constraints.equipment.burners, oven: session.constraints.equipment.oven ? 1 : 0 };
  const boundaries = [...new Set(session.steps.flatMap(item => [Date.parse(item.scheduledStart), Date.parse(item.scheduledEnd)]))];
  for (const instant of boundaries) {
    for (const resource of ['hands', 'burner', 'oven'] as Resource[]) {
      const occupied = session.steps.filter(item => item.resources.includes(resource) &&
        Date.parse(item.scheduledStart) <= instant && instant < Date.parse(item.scheduledEnd)).length;
      assert.ok(occupied <= capacity[resource], `${resource} capacity exceeded at ${new Date(instant).toISOString()}`);
    }
  }
}

test('a fresh meal has a dependency-valid schedule with overlapping independent cooking', t => {
  const f = fixture(t);
  const meal = f.create();
  assert.equal(meal.revision, 1);
  assert.equal(meal.status, 'cooking');
  assert.equal(meal.clock, new Date(START).toISOString());
  assert.equal(f.store.eventCount(meal.id), 1);
  assertSchedule(meal);
  const base = step(meal, 'cook-base');
  const protein = step(meal, 'cook-protein');
  assert.ok(Date.parse(base.scheduledStart) < Date.parse(protein.scheduledEnd) &&
    Date.parse(protein.scheduledStart) < Date.parse(base.scheduledEnd), 'Two burners should allow independent cooking to overlap');
});

test('SQLite reopen preserves progress, pause state, active timer deadlines, and replay records', t => {
  const directory = mkdtempSync(join(tmpdir(), 'simmershift-service-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const f = fixture(t, join(directory, 'nested', 'kitchen.sqlite'));
  let meal = f.create();
  meal = f.finish(meal, 'prep-base');
  meal = f.mutate('start_step', meal, { stepId: 'cook-base' });
  const pauseArgs = { sessionId: meal.id, requestId: 'durable-pause', expectedRevision: meal.revision, action: 'pause' };
  meal = f.service.call('pause_resume', pauseArgs) as Session;
  const events = f.store.eventCount(meal.id);
  const saved = structuredClone(meal);
  f.reopen();
  assert.deepEqual(f.store.get(meal.id), saved);
  assert.deepEqual(f.service.call('get_session', { sessionId: meal.id }), saved);
  assert.deepEqual(f.service.call('pause_resume', pauseArgs), saved);
  assert.equal(f.store.eventCount(meal.id), events);
  f.advance(4);
  meal = f.mutate('pause_resume', meal, { action: 'resume', physicalState: 'heat_unchanged' });
  assert.equal(meal.status, 'cooking');
  assert.deepEqual(step(meal, 'prep-base'), step(saved, 'prep-base'));
  assert.equal(step(meal, 'cook-base').timerEndsAt, step(saved, 'cook-base').timerEndsAt);
  assert.equal(f.store.eventCount(meal.id), events + 1);
});

test('requestId replay returns the original result without duplicate mutations or events', t => {
  const f = fixture(t);
  const createArgs = { requestId: 'same-create', constraints: constraints() };
  const original = f.service.call('create_plan', createArgs) as Session;
  f.advance(1);
  assert.deepEqual(f.service.call('create_plan', createArgs), original);
  assert.equal(f.store.eventCount(original.id), 1);
  const startArgs = { sessionId: original.id, requestId: 'same-start', expectedRevision: 1, stepId: 'prep-base' };
  const started = f.service.call('start_step', startArgs) as Session;
  f.advance(2);
  assert.deepEqual(f.service.call('start_step', startArgs), started);
  const completed = f.mutate('complete_step', started, { stepId: 'prep-base' });
  assert.deepEqual(f.service.call('start_step', {
    stepId: 'prep-base', expectedRevision: 1, requestId: 'same-start', sessionId: original.id,
  }), started, 'Object key order does not change the operation fingerprint');
  assert.deepEqual(f.store.get(original.id), completed, 'Replaying an older result must not roll back current progress');
  assert.equal(f.store.eventCount(original.id), 3);
});

test('reusing a requestId for a different payload or tool is a conflict and leaves the meal intact', t => {
  const f = fixture(t);
  const meal = f.create();
  const started = f.service.call('start_step', {
    sessionId: meal.id, requestId: 'unique-work', stepId: 'prep-base',
  }) as Session;
  const events = f.store.eventCount(meal.id);
  throwsCode(() => f.service.call('start_step', {
    sessionId: meal.id, requestId: 'unique-work', stepId: 'prep-protein',
  }), 'IDEMPOTENCY_CONFLICT');
  throwsCode(() => f.service.call('complete_step', {
    sessionId: meal.id, requestId: 'unique-work', stepId: 'prep-base',
  }), 'IDEMPOTENCY_CONFLICT');
  assertUnchanged(f.store, started, events);
});

test('a stale revision is rejected atomically and does not consume its requestId', t => {
  const f = fixture(t);
  const meal = f.create();
  const started = f.mutate('start_step', meal, { stepId: 'prep-base' });
  f.advance(2);
  const args = { sessionId: meal.id, requestId: 'retry-after-refresh', expectedRevision: meal.revision, stepId: 'prep-base' };
  throwsCode(() => f.service.call('complete_step', args), 'REVISION_CONFLICT');
  assertUnchanged(f.store, started, 2);
  const completed = f.service.call('complete_step', { ...args, expectedRevision: started.revision }) as Session;
  assert.equal(step(completed, 'prep-base').status, 'complete');
  assert.equal(completed.revision, started.revision + 1);
  assert.equal(f.store.eventCount(meal.id), 3);
});

test('steps require completed dependencies and explicit start before completion', t => {
  const f = fixture(t);
  let meal = f.create();
  throwsCode(() => f.mutate('start_step', meal, { stepId: 'cook-base' }), 'DEPENDENCY_BLOCKED');
  throwsCode(() => f.mutate('complete_step', meal, { stepId: 'prep-base' }), 'STEP_STATE');
  throwsCode(() => f.mutate('start_step', meal, { stepId: 'unknown-step' }), 'STEP_NOT_FOUND');
  assertUnchanged(f.store, meal, 1);
  meal = f.finish(meal, 'prep-base');
  meal = f.mutate('start_step', meal, { stepId: 'cook-base' });
  assert.equal(step(meal, 'cook-base').status, 'active');
  throwsCode(() => f.mutate('start_step', meal, { stepId: 'assemble' }), 'DEPENDENCY_BLOCKED');
  assertUnchanged(f.store, meal, 4);
});

test('occupied hands and both burners block another task, even after timers elapse', t => {
  const f = fixture(t);
  let meal = f.create();
  meal = f.mutate('start_step', meal, { stepId: 'prep-base' });
  f.advance(3);
  throwsCode(() => f.mutate('start_step', meal, { stepId: 'prep-protein' }), 'RESOURCE_BUSY');
  assertUnchanged(f.store, meal, 2);
  meal = f.mutate('complete_step', meal, { stepId: 'prep-base' });
  meal = f.mutate('start_step', meal, { stepId: 'cook-base' });
  const baseDeadline = step(meal, 'cook-base').timerEndsAt;
  meal = f.finish(meal, 'prep-protein');
  meal = f.mutate('start_step', meal, { stepId: 'cook-protein' });
  meal = f.finish(meal, 'prep-vegetable');
  const events = f.store.eventCount(meal.id);
  throwsCode(() => f.mutate('start_step', meal, { stepId: 'cook-vegetable' }), 'RESOURCE_BUSY');
  assertUnchanged(f.store, meal, events);
  f.advance(30);
  throwsCode(() => f.mutate('start_step', meal, { stepId: 'cook-vegetable' }), 'RESOURCE_BUSY');
  assertUnchanged(f.store, meal, events);
  meal = f.mutate('complete_step', meal, { stepId: 'cook-protein' });
  meal = f.mutate('start_step', meal, { stepId: 'cook-vegetable' });
  assert.deepEqual(meal.steps.filter(item => item.status === 'active').map(item => item.id), ['cook-base', 'cook-vegetable']);
  assert.equal(step(meal, 'cook-base').timerEndsAt, baseDeadline);
  assert.ok(meal.warnings.some(warning => warning.includes('timer has elapsed')));
});

test('paused meals forbid step updates and real-time resume retains running timer deadlines', t => {
  const f = fixture(t);
  let meal = f.create();
  meal = f.finish(meal, 'prep-base');
  meal = f.mutate('start_step', meal, { stepId: 'cook-base' });
  const deadline = step(meal, 'cook-base').timerEndsAt;
  meal = f.mutate('pause_resume', meal, { action: 'pause' });
  f.advance(5);
  const events = f.store.eventCount(meal.id);
  throwsCode(() => f.mutate('start_step', meal, { stepId: 'prep-protein' }), 'SESSION_PAUSED');
  throwsCode(() => f.mutate('complete_step', meal, { stepId: 'cook-base' }), 'SESSION_PAUSED');
  assertUnchanged(f.store, meal, events);
  meal = f.mutate('pause_resume', meal, { action: 'resume', physicalState: 'heat_unchanged' });
  assert.equal(meal.status, 'cooking');
  assert.equal(meal.pausedAt, undefined);
  assert.equal(meal.clock, new Date(START + 7 * MINUTE).toISOString());
  assert.equal(meal.clockOffsetMs, 0);
  assert.equal(step(meal, 'cook-base').timerEndsAt, deadline);
  assert.equal(step(meal, 'cook-base').status, 'active');
});

test('simulated interruption advances a durable logical clock without extending active timers', t => {
  const f = fixture(t);
  let meal = f.create();
  meal = f.finish(meal, 'prep-base');
  meal = f.mutate('start_step', meal, { stepId: 'cook-base' });
  const running = structuredClone(step(meal, 'cook-base'));
  f.advance(1);
  meal = f.mutate('pause_resume', meal, { action: 'pause' });
  f.advance(1);
  meal = f.mutate('pause_resume', meal, { action: 'resume', interruptionMinutes: 15, physicalState: 'heat_unchanged' });
  assert.equal(meal.clock, new Date(START + 18 * MINUTE).toISOString());
  assert.equal(meal.clockOffsetMs, 14 * MINUTE);
  assert.deepEqual(step(meal, 'cook-base'), running);
  assert.ok(meal.changes.some(change => change.message.includes('Simulated a 15-minute interruption')));
  assert.ok(meal.steps.filter(item => item.status === 'pending').every(item => Date.parse(item.scheduledStart) >= Date.parse(meal.clock)));
  f.advance(3);
  const read = f.service.call('get_session', { sessionId: meal.id }) as Session;
  assert.equal(read.clock, new Date(START + 21 * MINUTE).toISOString(), 'Logical time continues advancing with real time after simulation');
  meal = f.mutate('replan', meal);
  assert.equal(meal.clock, read.clock);
  assert.equal(step(meal, 'cook-base').timerEndsAt, running.timerEndsAt);
  assert.equal(step(meal, 'cook-base').status, 'active', 'An elapsed timer must not auto-complete food');
  assert.ok(meal.warnings.some(warning => warning.includes('Simmer the rice: the timer has elapsed')));
});

test('resume with active heat requires a physical-state report and missing confirmation is atomic', t => {
  const f = fixture(t);
  let meal = f.create();
  meal = f.finish(meal, 'prep-base');
  meal = f.mutate('start_step', meal, { stepId: 'cook-base' });
  const deadline = step(meal, 'cook-base').timerEndsAt;
  meal = f.mutate('pause_resume', meal, { action: 'pause' });
  const events = f.store.eventCount(meal.id);
  f.advance(3);
  const args = {
    sessionId: meal.id, requestId: 'physical-state-retry', expectedRevision: meal.revision,
    action: 'resume', interruptionMinutes: 12,
  };
  throwsCode(() => f.service.call('pause_resume', args), 'PHYSICAL_STATE_REQUIRED');
  assertUnchanged(f.store, meal, events);
  assert.equal(f.store.get(meal.id).status, 'paused');
  assert.equal(f.store.get(meal.id).clockOffsetMs, 0, 'Rejected resume must not partially apply the simulated interruption');
  meal = f.service.call('pause_resume', { ...args, physicalState: 'heat_unchanged' }) as Session;
  assert.equal(meal.status, 'cooking');
  assert.equal(meal.clock, new Date(START + 14 * MINUTE).toISOString());
  assert.equal(step(meal, 'cook-base').timerEndsAt, deadline);
  assert.equal(step(meal, 'cook-base').status, 'active');
  assert.equal(f.store.eventCount(meal.id), events + 1, 'The failed requestId remains available for a corrected retry');
});

test('resume needs no heat report when only a preparation task is active', t => {
  const f = fixture(t);
  let meal = f.create();
  meal = f.mutate('start_step', meal, { stepId: 'prep-base' });
  const active = structuredClone(step(meal, 'prep-base'));
  meal = f.mutate('pause_resume', meal, { action: 'pause' });
  f.advance(3);
  meal = f.mutate('pause_resume', meal, { action: 'resume' });
  assert.equal(meal.status, 'cooking');
  assert.deepEqual(step(meal, 'prep-base'), active);
  assert.equal(step(meal, 'prep-base').status, 'active', 'An elapsed preparation estimate still requires completion confirmation');
});

test('changed heat resets full-duration estimates for active heated food without completing it', t => {
  const f = fixture(t);
  let meal = f.create({ equipment: { burners: 2, oven: true } });
  meal = f.finish(meal, 'prep-base');
  meal = f.mutate('start_step', meal, { stepId: 'cook-base' });
  meal = f.finish(meal, 'prep-vegetable');
  meal = f.mutate('start_step', meal, { stepId: 'cook-vegetable' });
  meal = f.mutate('start_step', meal, { stepId: 'prep-protein' });
  const before = structuredClone(meal);
  meal = f.mutate('pause_resume', meal, { action: 'pause' });
  f.advance(1);
  meal = f.mutate('pause_resume', meal, { action: 'resume', interruptionMinutes: 25, physicalState: 'heat_changed' });
  assert.equal(meal.clock, new Date(START + 30 * MINUTE).toISOString());
  for (const id of ['cook-base', 'cook-vegetable']) {
    const current = step(meal, id);
    assert.equal(current.status, 'active');
    assert.equal(current.startedAt, step(before, id).startedAt, 'Original start remains recorded');
    assert.equal(current.timerEndsAt, new Date(Date.parse(meal.clock) + current.durationMinutes * MINUTE).toISOString());
    assert.notEqual(current.timerEndsAt, step(before, id).timerEndsAt);
    assert.equal(current.scheduledEnd, current.timerEndsAt);
  }
  assert.deepEqual(step(meal, 'prep-protein'), step(before, 'prep-protein'), 'A task without heat keeps its existing timer');
  for (const id of ['prep-base', 'prep-vegetable']) assert.deepEqual(step(meal, id), step(before, id));
  assert.ok(meal.changes.some(change => change.message.includes('fresh full-duration estimates')));
  throwsCode(() => f.mutate('start_step', meal, { stepId: 'assemble' }), 'DEPENDENCY_BLOCKED');
});

test('briefing and the last ten journal entries survive reopen, and mutation replay adds no history', t => {
  const directory = mkdtempSync(join(tmpdir(), 'simmershift-briefing-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const f = fixture(t, join(directory, 'kitchen.sqlite'));
  let meal = f.create();
  meal = f.finish(meal, 'prep-base');
  meal = f.mutate('start_step', meal, { stepId: 'cook-base' });
  meal = f.finish(meal, 'prep-protein');
  const startArgs = {
    sessionId: meal.id, requestId: 'journal-retry', expectedRevision: meal.revision, stepId: 'cook-protein',
  };
  const replayResult = f.service.call('start_step', startArgs) as Session;
  meal = f.finish(replayResult, 'prep-vegetable');
  const explain = () => f.service.call('explain_changes', { sessionId: meal.id }) as unknown as Explanation;
  const initial = explain();
  assert.deepEqual(initial.briefing.completed, ['Prepare rice', 'Prepare chickpeas', 'Chop the carrot']);
  assert.deepEqual(initial.briefing.active.map(item => [item.id, item.remainingMinutes]), [['cook-base', 13], ['cook-protein', 2]]);
  assert.deepEqual(initial.briefing.nextReady.map(item => item.id), ['make-sauce'], 'A ready dependency alone is insufficient when both burners remain occupied');
  assert.match(initial.briefing.summary, /3 steps kept complete/);
  assert.deepEqual(initial.history.map(item => item.revision), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(initial.history.map(item => item.operation), [
    'create_plan', 'start_step', 'complete_step', 'start_step', 'start_step', 'complete_step', 'start_step', 'start_step', 'complete_step',
  ]);
  assert.equal(initial.history.at(-1)?.at, meal.updatedAt);
  assert.deepEqual(initial.history.at(-1)?.changes, meal.changes);
  f.advance(1);
  for (let index = 0; index < 4; index++) meal = f.mutate('replan', meal);
  const beforeReopen = explain();
  assert.deepEqual(beforeReopen.briefing.active.map(item => [item.id, item.remainingMinutes]), [['cook-base', 12], ['cook-protein', 1]]);
  assert.equal(beforeReopen.history.length, 10);
  assert.deepEqual(beforeReopen.history.map(item => item.revision), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  f.reopen();
  assert.deepEqual(explain(), beforeReopen);
  assert.deepEqual(f.service.call('start_step', startArgs), replayResult);
  assert.deepEqual(explain(), beforeReopen, 'Replayed mutations must not duplicate the persisted journal');
  assertUnchanged(f.store, meal, 13);
});

test('impossible pantry, avoid, and invalid equipment patches do not overwrite a stored meal', t => {
  const f = fixture(t);
  const meal = f.create();
  throwsCode(() => f.mutate('change_constraint', meal, { patch: { pantry: ['rice', 'carrot', 'lemon'] } }), 'NO_PLAN');
  throwsCode(() => f.mutate('change_constraint', meal, { patch: { avoid: ['rice', 'couscous'] } }), 'NO_PLAN');
  throwsCode(() => f.mutate('change_constraint', meal, { patch: { equipment: { burners: 0 } } }), 'INVALID_INPUT');
  throwsCode(() => f.mutate('change_constraint', meal, { patch: {} }), 'INVALID_INPUT');
  assertUnchanged(f.store, meal, 1);
});

test('new avoid constraints cannot silently discard food already prepared', t => {
  const f = fixture(t);
  const meal = f.finish(f.create(), 'prep-base');
  throwsCode(() => f.mutate('change_constraint', meal, { patch: { avoid: ['rice'] } }), 'CONSTRAINT_CONFLICT');
  assertUnchanged(f.store, meal, 3);
  assert.equal(step(f.store.get(meal.id), 'prep-base').ingredients[0], 'rice');
});

test('servings can change before work starts but cannot change after a step is started or completed', t => {
  const f = fixture(t);
  let meal = f.create();
  meal = f.mutate('change_constraint', meal, { patch: { servings: 4 } });
  assert.equal(meal.constraints.servings, 4);
  assert.equal(step(meal, 'prep-base').durationMinutes, 4);
  meal = f.mutate('start_step', meal, { stepId: 'prep-base' });
  throwsCode(() => f.mutate('change_constraint', meal, { patch: { servings: 2 } }), 'CONSTRAINT_CONFLICT');
  assertUnchanged(f.store, meal, 3);
  f.advance(4);
  meal = f.mutate('complete_step', meal, { stepId: 'prep-base' });
  throwsCode(() => f.mutate('change_constraint', meal, { patch: { servings: 3 } }), 'CONSTRAINT_CONFLICT');
  assertUnchanged(f.store, meal, 4);
  const completed = structuredClone(step(meal, 'prep-base'));
  meal = f.mutate('change_constraint', meal, { patch: { servings: 4 } });
  assert.deepEqual(step(meal, 'prep-base'), completed, 'Reconfirming the existing portion count is allowed and retains completed work');
});

test('reducing burner capacity below active cooking is rejected atomically', t => {
  const f = fixture(t);
  let meal = f.create();
  meal = f.finish(meal, 'prep-base');
  meal = f.mutate('start_step', meal, { stepId: 'cook-base' });
  meal = f.finish(meal, 'prep-protein');
  meal = f.mutate('start_step', meal, { stepId: 'cook-protein' });
  const events = f.store.eventCount(meal.id);
  throwsCode(() => f.mutate('change_constraint', meal, { patch: { equipment: { burners: 1 } } }), 'CONSTRAINT_CONFLICT');
  assertUnchanged(f.store, meal, events);
});

test('a whole meal recovers from interruption and a pantry change, retaining completed work', t => {
  const f = fixture(t);
  let meal = f.create();
  meal = f.finish(meal, 'prep-protein');
  meal = f.mutate('start_step', meal, { stepId: 'cook-protein' });
  meal = f.finish(meal, 'prep-vegetable');
  meal = f.mutate('start_step', meal, { stepId: 'cook-vegetable' });
  const completed = meal.steps.filter(item => item.status === 'complete').map(item => structuredClone(item));
  const running = meal.steps.filter(item => item.status === 'active').map(item => structuredClone(item));
  meal = f.mutate('pause_resume', meal, { action: 'pause' });
  f.advance(1);
  meal = f.mutate('pause_resume', meal, { action: 'resume', interruptionMinutes: 12, physicalState: 'heat_unchanged' });
  meal = f.mutate('change_constraint', meal, { patch: { pantry: PANTRY.filter(item => item !== 'rice') } });
  assert.equal(step(meal, 'prep-base').ingredients[0], 'couscous');
  for (const old of [...completed, ...running]) assert.deepEqual(step(meal, old.id), old);
  const explanation = f.service.call('explain_changes', { sessionId: meal.id }) as { summary: string; revision: number };
  assert.equal(explanation.revision, meal.revision);
  assert.match(explanation.summary, /Changed base from rice to couscous because rice is no longer listed in the pantry/);
  assert.ok(meal.warnings.some(warning => warning.includes('timer has elapsed')));
  meal = f.mutate('complete_step', meal, { stepId: 'cook-protein' });
  meal = f.mutate('complete_step', meal, { stepId: 'cook-vegetable' });
  meal = f.finish(meal, 'prep-base');
  meal = f.mutate('start_step', meal, { stepId: 'cook-base' });
  meal = f.finish(meal, 'make-sauce');
  throwsCode(() => f.mutate('start_step', meal, { stepId: 'assemble' }), 'DEPENDENCY_BLOCKED');
  f.advance(6);
  meal = f.mutate('complete_step', meal, { stepId: 'cook-base' });
  meal = f.finish(meal, 'assemble');
  assert.equal(meal.status, 'served');
  assert.ok(meal.steps.every(item => item.status === 'complete'));
  for (const old of completed) assert.deepEqual(step(meal, old.id), old, 'Earlier completed work survives the complete recovery workflow');
  assert.deepEqual(f.store.get(meal.id), meal);
  assert.equal(f.store.eventCount(meal.id), meal.revision, 'Each successful mutation is persisted exactly once');
  throwsCode(() => f.mutate('replan', meal), 'SESSION_SERVED');
  assertUnchanged(f.store, meal, meal.revision);
});
