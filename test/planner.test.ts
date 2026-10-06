import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlan, normalizeConstraints } from '../src/planner.js';
import { KitchenError, type Constraints, type Resource, type Session, type Step } from '../src/types.js';

const now = '2026-10-07T18:00:00.000Z';
function constraints(patch: Partial<Constraints> = {}): Constraints {
  return { pantry: ['rice', 'couscous', 'chickpeas', 'lentils', 'tofu', 'carrot', 'zucchini', 'broccoli', 'lemon', 'tomato'],
    avoid: [], servings: 2, targetServeAt: '2026-10-07T19:00:00.000Z', equipment: { burners: 2, oven: false }, ...patch };
}
function session(input = constraints()): Session {
  return { id: 'test-meal', revision: 1, name: 'Test meal', status: 'cooking', constraints: input,
    createdAt: now, updatedAt: now, clock: now, ...buildPlan(input, now) };
}
function assertSchedule(steps: Step[], equipment: Constraints['equipment']): void {
  const byId = new Map(steps.map(step => [step.id, step]));
  for (const step of steps) {
    assert.equal(new Set(step.dependencies).size, step.dependencies.length);
    assert.ok(Date.parse(step.scheduledEnd) > Date.parse(step.scheduledStart));
    for (const dependency of step.dependencies) {
      assert.ok(byId.has(dependency), `Missing ${dependency}`);
      assert.ok(Date.parse(step.scheduledStart) >= Date.parse(byId.get(dependency)!.scheduledEnd), `${step.id} precedes ${dependency}`);
    }
  }
  const capacities: Record<Resource, number> = { hands: 1, burner: equipment.burners, oven: equipment.oven ? 1 : 0 };
  for (const resource of Object.keys(capacities) as Resource[]) {
    for (const time of steps.map(step => Date.parse(step.scheduledStart))) {
      const simultaneous = steps.filter(step => step.resources.includes(resource) && Date.parse(step.scheduledStart) <= time && Date.parse(step.scheduledEnd) > time);
      assert.ok(simultaneous.length <= capacities[resource], `${resource} overbooked at ${new Date(time).toISOString()}`);
    }
  }
}

test('normalization canonicalizes aliases, deduplicates, and preserves unsupported ingredient names', () => {
  const normalized = normalizeConstraints(constraints({ pantry: [' Canned Chickpeas ', 'chickpeas', 'Carrots', 'Brown rice'], avoid: ['Gluten-free', ' SOYA '] }));
  assert.deepEqual(normalized.pantry, ['brown rice', 'carrot', 'chickpeas']);
  assert.deepEqual(normalized.avoid, ['gluten', 'soy']);
  assert.equal(normalized.targetServeAt, '2026-10-07T19:00:00.000Z');
});

test('invalid portions, equipment, and unzoned timestamps are rejected', () => {
  for (const input of [constraints({ servings: 0 }), constraints({ servings: 1.5 }), constraints({ equipment: { burners: 5, oven: false } }), constraints({ targetServeAt: '2026-10-07T19:00:00' })]) {
    assert.throws(() => normalizeConstraints(input), (error: unknown) => error instanceof KitchenError && error.code === 'INVALID_CONSTRAINTS');
  }
});

test('schedule obeys every dependency and resource capacity across equipment and portion combinations', () => {
  for (const burners of [1, 2]) {
    for (const oven of [false, true]) {
      for (const servings of [1, 2, 6]) {
        const input = constraints({ equipment: { burners, oven }, servings });
        const plan = buildPlan(input, now);
        assertSchedule(plan.steps, input.equipment);
        assert.equal(plan.steps.at(-1)?.scheduledEnd, plan.estimatedServeAt);
      }
    }
  }
});

test('two burners allow real overlapping unattended timers and finish earlier than one burner', () => {
  const two = buildPlan(constraints(), now);
  const one = buildPlan(constraints({ equipment: { burners: 1, oven: false } }), now);
  const base = two.steps.find(step => step.id === 'cook-base')!;
  const protein = two.steps.find(step => step.id === 'cook-protein')!;
  assert.ok(Date.parse(base.scheduledStart) < Date.parse(protein.scheduledEnd));
  assert.ok(Date.parse(protein.scheduledStart) < Date.parse(base.scheduledEnd));
  assert.deepEqual(base.resources, ['burner']);
  assert.deepEqual(protein.resources, ['burner']);
  assert.ok(Date.parse(two.estimatedServeAt) < Date.parse(one.estimatedServeAt));
});

test('substitutions use real pantry stock and gluten/soy flags exclude known recipe ingredients', () => {
  const input = constraints({ pantry: ['couscous', 'lentils', 'zucchini', 'tomato'] });
  const plan = buildPlan(input, now);
  for (const ingredient of plan.steps.flatMap(step => step.ingredients)) assert.ok(input.pantry.includes(ingredient));
  assert.match(plan.steps.find(step => step.id === 'prep-base')!.title, /couscous/);
  const safeOptions = buildPlan(constraints({ avoid: ['gluten', 'soy', 'chickpeas', 'carrot', 'lemon'] }), now);
  assert.ok(safeOptions.steps.some(step => step.ingredients.includes('lentils')));
  assert.ok(!safeOptions.steps.some(step => step.ingredients.includes('tofu') || step.ingredients.includes('couscous')));
});

test('missing pantry roles and fully excluded roles produce no plan, without invented ingredients', () => {
  for (const input of [constraints({ pantry: ['rice', 'chickpeas', 'lemon'] }), constraints({ pantry: ['brown rice', 'chickpeas', 'carrot', 'lemon'] }), constraints({ avoid: ['rice', 'gluten'] })]) {
    assert.throws(() => buildPlan(input, now), (error: unknown) => error instanceof KitchenError && error.code === 'NO_PLAN' && error.details.length > 0);
  }
  assert.throws(() => buildPlan(constraints({ equipment: { burners: 0, oven: true } }), now), (error: unknown) => error instanceof KitchenError && error.code === 'INVALID_CONSTRAINTS');
});

test('a pending ingredient can be replaced and the reason explains the change', () => {
  const previous = session();
  const changed = constraints({ pantry: previous.constraints.pantry.filter(value => value !== 'rice') });
  const plan = buildPlan(changed, now, previous);
  assert.match(plan.steps.find(step => step.id === 'prep-base')!.title, /couscous/);
  assert.ok(plan.changes.some(change => /rice to couscous.*no longer listed/.test(change.message)));
});

test('completed work is retained even when its ingredient is removed from remaining pantry', () => {
  const previous = session();
  const prep = previous.steps.find(step => step.id === 'prep-base')!;
  prep.status = 'complete'; prep.completedAt = '2026-10-07T18:02:00.000Z';
  const changed = constraints({ pantry: previous.constraints.pantry.filter(value => value !== 'rice') });
  const plan = buildPlan(changed, '2026-10-07T18:03:00.000Z', previous);
  assert.deepEqual(plan.steps.find(step => step.id === 'prep-base'), prep);
  assert.deepEqual(plan.steps.find(step => step.id === 'cook-base')!.ingredients, ['rice']);
});

test('hard ingredient avoids conflict with active or completed food rather than silently substituting', () => {
  for (const status of ['active', 'complete'] as const) {
    const previous = session(constraints({ pantry: ['couscous', 'chickpeas', 'carrot', 'lemon'] }));
    previous.steps[0].status = status;
    assert.throws(() => buildPlan({ ...previous.constraints, avoid: ['gluten'] }, now, previous),
      (error: unknown) => error instanceof KitchenError && error.code === 'CONSTRAINT_CONFLICT' && error.details.some(detail => detail.includes('couscous')));
  }
});

test('active timer remains unchanged, resources stay reserved, and an expired timer remains active', () => {
  const previous = session();
  const prep = previous.steps.find(step => step.id === 'prep-base')!;
  prep.status = 'complete'; prep.completedAt = '2026-10-07T18:02:00.000Z';
  const cook = previous.steps.find(step => step.id === 'cook-base')!;
  cook.status = 'active'; cook.startedAt = '2026-10-07T18:02:00.000Z'; cook.timerEndsAt = '2026-10-07T18:20:00.000Z';
  const changed = { ...previous.constraints, equipment: { burners: 1, oven: false } };
  const plan = buildPlan(changed, '2026-10-07T18:10:00.000Z', previous);
  assert.deepEqual(plan.steps.find(step => step.id === 'cook-base'), cook);
  assert.ok(Date.parse(plan.steps.find(step => step.id === 'cook-protein')!.scheduledStart) >= Date.parse(cook.timerEndsAt));
  const expired = buildPlan(changed, '2026-10-07T18:30:00.000Z', previous);
  assert.equal(expired.steps.find(step => step.id === 'cook-base')!.status, 'active');
  assert.equal(expired.steps.find(step => step.id === 'cook-base')!.timerEndsAt, cook.timerEndsAt);
  assert.ok(expired.warnings.some(warning => /timer has elapsed.*remains active/.test(warning)));
});

test('equipment loss conflicts with active work and pending vegetables switch away from a lost oven', () => {
  const previous = session(constraints({ equipment: { burners: 2, oven: true } }));
  const withoutOven = { ...previous.constraints, equipment: { burners: 2, oven: false } };
  const plan = buildPlan(withoutOven, now, previous);
  assert.deepEqual(plan.steps.find(step => step.id === 'cook-vegetable')!.resources, ['burner']);
  previous.steps.find(step => step.id === 'cook-vegetable')!.status = 'active';
  assert.throws(() => buildPlan(withoutOven, now, previous), (error: unknown) => error instanceof KitchenError && error.code === 'CONSTRAINT_CONFLICT');
});

test('elapsed active timers still count when checking a lower equipment capacity', () => {
  const previous = session();
  for (const id of ['cook-base', 'cook-protein']) {
    const step = previous.steps.find(item => item.id === id)!;
    step.status = 'active'; step.startedAt = '2026-10-07T18:05:00.000Z'; step.timerEndsAt = '2026-10-07T18:10:00.000Z';
  }
  assert.throws(() => buildPlan({ ...previous.constraints, equipment: { burners: 1, oven: false } }, '2026-10-07T18:30:00.000Z', previous),
    (error: unknown) => error instanceof KitchenError && error.code === 'CONSTRAINT_CONFLICT');
});

test('ingredient substitutions do not invent an unrelated equipment change explanation', () => {
  const previous = session();
  const plan = buildPlan({ ...previous.constraints, avoid: ['carrot'] }, now, previous);
  assert.ok(plan.changes.some(change => /carrot to zucchini/.test(change.message)));
  assert.ok(!plan.changes.some(change => /Changed vegetable cooking/.test(change.message)));
});

test('available previous ingredients are retained to avoid needless recipe churn', () => {
  const previous = session(constraints({ pantry: ['couscous', 'lentils', 'zucchini', 'tomato'] }));
  const plan = buildPlan(constraints(), now, previous);
  assert.deepEqual(plan.steps.map(step => step.ingredients), previous.steps.map(step => step.ingredients));
  assert.ok(!plan.changes.some(change => change.kind === 'ingredient'));
});

test('an infeasible serving time tries the faster base and still reports the missed target honestly', () => {
  const plan = buildPlan(constraints({ targetServeAt: '2026-10-07T18:01:00.000Z' }), now);
  assert.deepEqual(plan.steps.find(step => step.id === 'prep-base')!.ingredients, ['couscous']);
  assert.ok(plan.slackMinutes < 0);
  assert.ok(Date.parse(plan.estimatedServeAt) > Date.parse('2026-10-07T18:01:00.000Z'));
  assert.ok(plan.warnings.some(warning => /not feasible.*Current estimated serving/.test(warning)));
  assert.ok(plan.changes.some(change => change.kind === 'deadline'));
  assert.ok(plan.changes.some(change => /rice to couscous.*serving-time pressure/.test(change.message)));
});

test('deadline rescue after an interruption preserves completed work and recovers the serving target', () => {
  const previous = session(constraints({ targetServeAt: '2026-10-07T18:30:00.000Z' }));
  const proteinPrep = previous.steps.find(step => step.id === 'prep-protein')!;
  proteinPrep.status = 'complete'; proteinPrep.completedAt = '2026-10-07T18:02:00.000Z';
  assert.deepEqual(previous.steps.find(step => step.id === 'prep-base')!.ingredients, ['rice']);
  const plan = buildPlan(previous.constraints, '2026-10-07T18:12:00.000Z', previous);
  assert.deepEqual(plan.steps.find(step => step.id === 'prep-base')!.ingredients, ['couscous']);
  assert.deepEqual(plan.steps.find(step => step.id === 'prep-protein'), proteinPrep);
  assert.ok(plan.slackMinutes >= 0);
  assert.ok(plan.changes.some(change => /rice to couscous.*serving-time pressure.*saves an estimated/.test(change.message)));
  assert.ok(!plan.changes.some(change => /rice.*no longer listed/.test(change.message)));
  assertSchedule(plan.steps, previous.constraints.equipment);
});

test('deadline rescue never substitutes a base whose preparation has started or completed', () => {
  for (const status of ['active', 'complete'] as const) {
    const previous = session(constraints({ targetServeAt: '2026-10-07T18:30:00.000Z' }));
    const basePrep = previous.steps.find(step => step.id === 'prep-base')!;
    basePrep.status = status; basePrep.startedAt = now; basePrep.timerEndsAt = '2026-10-07T18:02:00.000Z';
    if (status === 'complete') basePrep.completedAt = '2026-10-07T18:02:00.000Z';
    const plan = buildPlan(previous.constraints, '2026-10-07T18:20:00.000Z', previous);
    assert.deepEqual(plan.steps.find(step => step.id === 'prep-base'), basePrep);
    assert.deepEqual(plan.steps.find(step => step.id === 'cook-base')!.ingredients, ['rice']);
    assert.ok(plan.slackMinutes < 0);
    assert.ok(!plan.changes.some(change => /Changed base/.test(change.message)));
  }
});

test('deadline rescue respects pantry availability and avoid flags', () => {
  for (const input of [constraints({ pantry: ['rice', 'chickpeas', 'carrot', 'lemon'], targetServeAt: '2026-10-07T18:01:00.000Z' }),
    constraints({ avoid: ['gluten'], targetServeAt: '2026-10-07T18:01:00.000Z' })]) {
    const plan = buildPlan(input, now);
    assert.deepEqual(plan.steps.find(step => step.id === 'prep-base')!.ingredients, ['rice']);
    assert.ok(plan.slackMinutes < 0);
  }
});

test('a feasible current base is kept even when a faster base is also available', () => {
  const previous = session();
  const plan = buildPlan(previous.constraints, '2026-10-07T18:10:00.000Z', previous);
  assert.deepEqual(plan.steps.find(step => step.id === 'prep-base')!.ingredients, ['rice']);
  assert.ok(!plan.changes.some(change => change.kind === 'ingredient'));
});

test('deadline rescue does not change bases when an independent active timer prevents an earlier finish', () => {
  const previous = session(constraints({ equipment: { burners: 2, oven: true }, targetServeAt: '2026-10-07T18:30:00.000Z' }));
  const vegetablePrep = previous.steps.find(step => step.id === 'prep-vegetable')!;
  vegetablePrep.status = 'complete'; vegetablePrep.completedAt = '2026-10-07T18:07:00.000Z';
  const vegetables = previous.steps.find(step => step.id === 'cook-vegetable')!;
  vegetables.status = 'active'; vegetables.startedAt = '2026-10-07T18:07:00.000Z'; vegetables.timerEndsAt = '2026-10-07T18:45:00.000Z';
  const plan = buildPlan(previous.constraints, '2026-10-07T18:12:00.000Z', previous);
  assert.deepEqual(plan.steps.find(step => step.id === 'prep-base')!.ingredients, ['rice']);
  assert.ok(plan.slackMinutes < 0);
  assert.ok(!plan.changes.some(change => /Changed base/.test(change.message)));
});

test('small clock drift updates timestamps quietly unless an ingredient changes', () => {
  const previous = session();
  const drifted = buildPlan(previous.constraints, '2026-10-07T18:00:20.000Z', previous);
  assert.equal(Date.parse(drifted.estimatedServeAt) - Date.parse(previous.estimatedServeAt), 20_000);
  assert.ok(!drifted.changes.some(change => change.kind === 'schedule'));
  const changed = buildPlan({ ...previous.constraints, avoid: ['carrot'] }, '2026-10-07T18:00:20.000Z', previous);
  assert.ok(changed.changes.some(change => change.kind === 'ingredient'));
  assert.ok(changed.changes.some(change => change.kind === 'schedule'));
  assert.ok(buildPlan(previous.constraints, '2026-10-07T18:00:30.000Z', previous).changes.some(change => change.kind === 'schedule'));
});

test('the same inputs produce the same plan without mutating constraints or prior session', () => {
  const previous = session();
  const snapshot = structuredClone(previous);
  assert.deepEqual(buildPlan(previous.constraints, now, previous), buildPlan(previous.constraints, now, previous));
  assert.deepEqual(previous, snapshot);
});
