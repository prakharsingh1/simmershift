import { KitchenError, type Change, type Constraints, type Resource, type Session, type Step } from './types.js';

const MINUTE = 60_000;
const aliases: Record<string, string> = {
  'white rice': 'rice', 'brown rice': 'brown rice', 'basmati rice': 'rice', 'jasmine rice': 'rice',
  'canned chickpeas': 'chickpeas', 'cooked chickpeas': 'chickpeas', 'garbanzo beans': 'chickpeas',
  'canned lentils': 'lentils', 'cooked lentils': 'lentils', 'firm tofu': 'tofu', 'extra firm tofu': 'tofu',
  carrots: 'carrot', courgette: 'zucchini', courgettes: 'zucchini', lemons: 'lemon',
  tomatoes: 'tomato', 'canned tomatoes': 'tomato', 'chopped tomatoes': 'tomato',
  'olive oil': 'oil', 'gluten free': 'gluten', 'soy free': 'soy', 'soya': 'soy',
};
const roles = {
  base: ['rice', 'couscous'],
  protein: ['chickpeas', 'lentils', 'tofu'],
  vegetable: ['carrot', 'zucchini', 'broccoli'],
  sauce: ['lemon', 'tomato'],
} as const;
type Role = keyof typeof roles;
const prepIds: Record<Role, string> = {
  base: 'prep-base', protein: 'prep-protein', vegetable: 'prep-vegetable', sauce: 'make-sauce',
};

function canonical(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ');
  return aliases[normalized] ?? normalized;
}

function dateValue(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !/(Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(parsed)) {
    throw new KitchenError('INVALID_CONSTRAINTS', `${field} must be an ISO timestamp with a timezone.`);
  }
  return parsed;
}

/** Canonical names do not infer quantities, allergens, or readiness from unknown foods. */
export function normalizeConstraints(input: Constraints): Constraints {
  if (!input || !Array.isArray(input.pantry) || !Array.isArray(input.avoid) ||
      input.pantry.some(value => typeof value !== 'string') || input.avoid.some(value => typeof value !== 'string')) {
    throw new KitchenError('INVALID_CONSTRAINTS', 'Pantry and avoid must be arrays of ingredient names.');
  }
  if (!Number.isInteger(input.servings) || input.servings < 1 || input.servings > 6) {
    throw new KitchenError('INVALID_CONSTRAINTS', 'Servings must be a whole number from 1 to 6.');
  }
  if (!input.equipment || !Number.isInteger(input.equipment.burners) ||
      input.equipment.burners < 1 || input.equipment.burners > 2 || typeof input.equipment.oven !== 'boolean') {
    throw new KitchenError('INVALID_CONSTRAINTS', 'Equipment must specify 1–2 burners and whether an oven is available.');
  }
  if (typeof input.targetServeAt !== 'string') {
    throw new KitchenError('INVALID_CONSTRAINTS', 'A serving timestamp is required.');
  }
  const target = dateValue(input.targetServeAt, 'targetServeAt');
  return {
    pantry: [...new Set(input.pantry.map(canonical).filter(Boolean))].sort(),
    avoid: [...new Set(input.avoid.map(canonical).filter(Boolean))].sort(),
    servings: input.servings,
    targetServeAt: new Date(target).toISOString(),
    equipment: { ...input.equipment },
  };
}

function excluded(ingredient: string, avoid: string[]): boolean {
  return avoid.includes(ingredient) || (ingredient === 'couscous' && (avoid.includes('gluten') || avoid.includes('wheat'))) ||
    (ingredient === 'tofu' && avoid.includes('soy'));
}

function previousIngredient(previous: Session | undefined, role: Role): string | undefined {
  return previous?.steps.find(step => step.id === prepIds[role])?.ingredients
    .find(ingredient => (roles[role] as readonly string[]).includes(ingredient));
}

function chooseIngredients(constraints: Constraints, previous?: Session): Record<Role, string> {
  const locked = previous?.steps.filter(step => step.status !== 'pending') ?? [];
  const conflicts = [...new Set(locked.flatMap(step => step.ingredients)
    .filter(ingredient => excluded(ingredient, constraints.avoid)))];
  if (conflicts.length) {
    throw new KitchenError('CONSTRAINT_CONFLICT', 'An avoid constraint conflicts with food already started or completed.',
      conflicts.map(ingredient => `${ingredient} is already in use. Start a new meal or explicitly discard that work.`));
  }
  const result = {} as Record<Role, string>;
  const missing: string[] = [];
  for (const role of Object.keys(roles) as Role[]) {
    const options = roles[role] as readonly string[];
    const inUse = [...new Set(locked.flatMap(step => step.ingredients).filter(ingredient => options.includes(ingredient)))];
    if (inUse.length > 1) {
      throw new KitchenError('CONSTRAINT_CONFLICT', `Started ${role} steps contain incompatible ingredients.`, inUse);
    }
    const old = previousIngredient(previous, role);
    const available = (ingredient: string) => constraints.pantry.includes(ingredient) && !excluded(ingredient, constraints.avoid);
    const selected = inUse[0] ?? (old && available(old) ? old : options.find(available));
    if (selected) result[role] = selected;
    else missing.push(`Missing ${role}: supply one of ${options.filter(ingredient => !excluded(ingredient, constraints.avoid)).join(', ') || 'the supported options after revising avoid constraints'}.`);
  }
  if (missing.length) throw new KitchenError('NO_PLAN', 'The listed pantry cannot produce a supported bowl under these constraints.', missing);
  return result;
}

function recipe(selected: Record<Role, string>, constraints: Constraints): Step[] {
  const portionWork = Math.ceil(constraints.servings / 2);
  const { base, protein, vegetable, sauce } = selected;
  const oven = constraints.equipment.oven;
  const step = (id: string, title: string, detail: string, durationMinutes: number,
    dependencies: string[], resources: Resource[], ingredients: string[]): Step => ({
    id, title, detail, durationMinutes, dependencies, resources, ingredients, status: 'pending',
    scheduledStart: '', scheduledEnd: '',
  });
  return [
    step('prep-base', `Prepare ${base}`, base === 'rice'
      ? 'Measure and rinse white rice. Have a covered pan and tap water ready; follow package water ratios.'
      : 'Measure couscous and have a covered pan and tap water ready; follow package water ratios.',
    (base === 'rice' ? 2 : 1) * portionWork, [], ['hands'], [base]),
    step('cook-base', base === 'rice' ? 'Simmer the rice' : 'Hydrate the couscous', base === 'rice'
      ? 'Bring to a simmer, cover, and cook according to its package. This estimate assumes white rice; confirm tenderness before completing.'
      : 'Heat water, add couscous, cover, and hydrate according to its package. The burner is reserved for the full estimate.',
    base === 'rice' ? 18 : 8, ['prep-base'], ['burner'], [base]),
    step('prep-protein', `Prepare ${protein}`, protein === 'tofu'
      ? 'Drain and cube ready-to-cook tofu. Check its package cooking instructions.'
      : `Drain and rinse canned or previously cooked ${protein}. Dry legumes are not supported by this short recipe.`,
    (protein === 'tofu' ? 3 : 2) * portionWork, [], ['hands'], [protein]),
    step('cook-protein', protein === 'tofu' ? 'Cook the tofu' : `Warm the ${protein}`, protein === 'tofu'
      ? 'Cook tofu in a pan with a splash of tap water, turning as needed; follow package guidance. This task occupies your hands.'
      : `Warm cooked ${protein} gently in a covered pan with a splash of tap water. Check and stir before completing.`,
    protein === 'tofu' ? 10 : 5, ['prep-protein'], protein === 'tofu' ? ['hands', 'burner'] : ['burner'], [protein]),
    step('prep-vegetable', `Chop the ${vegetable}`, `Wash and chop ${vegetable} into small even pieces. ${oven ? 'Set up an oven tray and preheat according to your usual vegetable roasting method.' : 'Set up a covered pan for steaming with tap water.'}`,
    3 * portionWork, [], ['hands'], [vegetable]),
    step('cook-vegetable', oven ? `Roast the ${vegetable}` : `Steam the ${vegetable}`, oven
      ? 'Roast on a tray until tender, checking your oven and the food. The estimate includes oven warm-up; actual time varies.'
      : 'Steam in a covered pan with tap water until tender. Check the pan and tenderness before completing.',
    oven ? 18 : 9, ['prep-vegetable'], oven ? ['oven'] : ['burner'], [vegetable]),
    step('make-sauce', sauce === 'lemon' ? 'Make the lemon finish' : 'Dice the tomato finish', sauce === 'lemon'
      ? 'Squeeze lemon for the finishing sauce; thin with a little tap water if desired.'
      : 'Wash and dice tomatoes, or drain canned tomatoes, for a fresh finishing spoonful.',
    2 * portionWork, [], ['hands'], [sauce]),
    step('assemble', 'Bring the bowls together', `Divide the base, protein, and vegetables between ${constraints.servings} bowl${constraints.servings === 1 ? '' : 's'} and finish with ${sauce}. Confirm the cooked components are ready before serving.`,
    2 * portionWork, ['cook-base', 'cook-protein', 'cook-vegetable', 'make-sauce'], ['hands'], [base, protein, vegetable, sauce]),
  ];
}

interface Reservation { start: number; end: number; resources: Resource[] }

function slot(start: number, duration: number, resources: Resource[], reservations: Reservation[], capacity: Record<Resource, number>): number {
  let candidate = start;
  for (;;) {
    let jump: number | undefined;
    for (const resource of resources) {
      const overlapping = reservations.filter(item => item.resources.includes(resource) && item.start < candidate + duration && item.end > candidate);
      const boundaries = [...new Set([candidate, ...overlapping.map(item => item.start).filter(time => time > candidate)])].sort((a, b) => a - b);
      for (const boundary of boundaries) {
        const occupied = overlapping.filter(item => item.start <= boundary && item.end > boundary);
        if (occupied.length >= capacity[resource]) {
          const release = Math.min(...occupied.map(item => item.end));
          jump = jump === undefined ? release : Math.min(jump, release);
          break;
        }
      }
    }
    if (jump === undefined) return candidate;
    candidate = jump;
  }
}

function schedule(steps: Step[], now: number, constraints: Constraints): void {
  const capacity: Record<Resource, number> = { hands: 1, burner: constraints.equipment.burners, oven: constraints.equipment.oven ? 1 : 0 };
  const reservations: Reservation[] = [];
  const finish = new Map<string, number>();
  for (const step of steps.filter(item => item.status !== 'pending')) {
    if (step.status === 'complete') {
      finish.set(step.id, Math.min(now, dateValue(step.completedAt ?? step.scheduledEnd, 'completed step timestamp')));
    } else {
      const end = dateValue(step.timerEndsAt ?? step.scheduledEnd, 'active step timer');
      const remainingEnd = Math.max(now, end);
      step.scheduledStart = step.startedAt ?? step.scheduledStart;
      step.scheduledEnd = step.timerEndsAt ?? step.scheduledEnd;
      finish.set(step.id, remainingEnd);
      const unavailable = step.resources.filter(resource => capacity[resource] === 0);
      if (unavailable.length) throw new KitchenError('CONSTRAINT_CONFLICT', 'An active step needs equipment now marked unavailable.', unavailable);
      if (remainingEnd > now) reservations.push({ start: now, end: remainingEnd, resources: step.resources });
    }
  }
  for (const resource of ['hands', 'burner', 'oven'] as Resource[]) {
    if (steps.filter(item => item.status === 'active' && item.resources.includes(resource)).length > capacity[resource]) {
      throw new KitchenError('CONSTRAINT_CONFLICT', `Active steps exceed the available ${resource} capacity.`);
    }
  }
  const remaining = steps.filter(step => step.status === 'pending');
  while (remaining.length) {
    const candidates = remaining.filter(step => step.dependencies.every(id => finish.has(id))).map(step => {
      const unavailable = step.resources.filter(resource => capacity[resource] === 0);
      if (unavailable.length) throw new KitchenError('NO_PLAN', `Cannot schedule ${step.title}: required equipment is unavailable.`, unavailable);
      const earliest = Math.max(now, ...step.dependencies.map(id => finish.get(id)!));
      return { step, start: slot(earliest, step.durationMinutes * MINUTE, step.resources, reservations, capacity) };
    });
    if (!candidates.length) throw new KitchenError('NO_PLAN', 'The remaining steps have an unresolved dependency cycle.');
    // Earliest start first; source order breaks ties deterministically and launches the base early.
    candidates.sort((a, b) => a.start - b.start || steps.indexOf(a.step) - steps.indexOf(b.step));
    const { step, start } = candidates[0];
    const end = start + step.durationMinutes * MINUTE;
    step.scheduledStart = new Date(start).toISOString();
    step.scheduledEnd = new Date(end).toISOString();
    finish.set(step.id, end);
    reservations.push({ start, end, resources: step.resources });
    remaining.splice(remaining.indexOf(step), 1);
  }
}

/** Predicts remaining work; a timer ending never itself marks an active step complete. */
export function buildPlan(input: Constraints, now: string, previous?: Session): {
  steps: Step[]; estimatedServeAt: string; slackMinutes: number; changes: Change[]; warnings: string[];
} {
  const constraints = normalizeConstraints(input);
  const nowValue = dateValue(now, 'now');
  let selected = chooseIngredients(constraints, previous);
  const evaluate = (ingredients: Record<Role, string>) => {
    const steps = recipe(ingredients, constraints).map(step => {
      const old = previous?.steps.find(item => item.id === step.id && item.status !== 'pending');
      return old ? structuredClone(old) : step;
    });
    schedule(steps, nowValue, constraints);
    const estimate = Math.max(nowValue, ...steps.filter(step => step.status !== 'complete').map(step => Date.parse(step.scheduledEnd)));
    return { steps, estimate };
  };
  let evaluated = evaluate(selected);
  const originalBase = selected.base;
  const originalEstimate = evaluated.estimate;
  const baseStarted = previous?.steps.some(step => step.status !== 'pending' &&
    step.ingredients.some(ingredient => (roles.base as readonly string[]).includes(ingredient))) ?? false;
  // Compare only pantry-listed bases, and only under deadline pressure. This bounded
  // rescue does not claim that the greedy schedule is globally optimal.
  if (originalEstimate > Date.parse(constraints.targetServeAt) && !baseStarted) {
    for (const alternative of roles.base) {
      if (alternative === selected.base || !constraints.pantry.includes(alternative) || excluded(alternative, constraints.avoid)) continue;
      const candidateIngredients = { ...selected, base: alternative };
      const candidate = evaluate(candidateIngredients);
      if (candidate.estimate < evaluated.estimate) {
        selected = candidateIngredients;
        evaluated = candidate;
      }
    }
  }
  const { steps, estimate: estimatedValue } = evaluated;
  const estimatedServeAt = new Date(estimatedValue).toISOString();
  const slackMinutes = Math.round((Date.parse(constraints.targetServeAt) - estimatedValue) / MINUTE * 100) / 100;
  const warnings = ['Pantry availability does not verify quantities or dietary suitability; check labels and portions. Timings are estimates and require completion confirmation.'];
  const changes: Change[] = [];
  const rescuedBase = originalBase !== selected.base;
  if (rescuedBase) {
    const savedMinutes = Math.round((originalEstimate - estimatedValue) / MINUTE * 100) / 100;
    changes.push({ kind: 'ingredient', message: `Changed base from ${originalBase} to ${selected.base} because of serving-time pressure. Base preparation has not started, and ${selected.base} is in the pantry. This saves an estimated ${savedMinutes} minute(s): serving moves from ${new Date(originalEstimate).toISOString()} to ${estimatedServeAt}.` });
  }
  for (const role of Object.keys(roles) as Role[]) {
    const old = previousIngredient(previous, role);
    if (old && old !== selected[role]) {
      if (role === 'base' && rescuedBase && old === originalBase) continue;
      const reason = excluded(old, constraints.avoid) ? `${old} is excluded by the avoid constraints` : `${old} is no longer listed in the pantry`;
      changes.push({ kind: 'ingredient', message: `Changed ${role} from ${old} to ${selected[role]} because ${reason}.` });
    }
  }
  if (!previous) changes.push({ kind: 'ingredient', message: `Using ${selected.base}, ${selected.protein}, ${selected.vegetable}, and ${selected.sauce} from the listed pantry.` });
  const oldVegetable = previous?.steps.find(step => step.id === 'cook-vegetable');
  const newVegetable = steps.find(step => step.id === 'cook-vegetable')!;
  if (oldVegetable && oldVegetable.resources.includes('oven') !== newVegetable.resources.includes('oven') && oldVegetable.status === 'pending') {
    changes.push({ kind: 'schedule', message: `Changed vegetable cooking to ${constraints.equipment.oven ? 'roasting with the available oven' : 'steaming on a burner because no oven is available'}.` });
  }
  if (previous && previous.constraints.servings !== constraints.servings) {
    changes.push({ kind: 'constraint', message: `Updated portions to ${constraints.servings} servings; previously started work remains unchanged. Confirm those portions are sufficient.` });
  }
  const servingDrift = previous ? Math.abs(Date.parse(previous.estimatedServeAt) - estimatedValue) : 0;
  const ingredientChanged = changes.some(change => change.kind === 'ingredient');
  if (!previous || (servingDrift > 0 && (servingDrift >= 30_000 || ingredientChanged))) {
    changes.push({ kind: 'schedule', message: previous
      ? `Remaining work was rescheduled from ${now}; estimated serving moved from ${previous.estimatedServeAt} to ${estimatedServeAt}.`
      : `Estimated serving is ${estimatedServeAt}, with independent cooking tasks overlapping where equipment permits.` });
  }
  for (const step of steps.filter(item => item.status === 'active' && Date.parse(item.timerEndsAt ?? item.scheduledEnd) <= nowValue)) {
    warnings.push(`${step.title}: the timer has elapsed. Confirm completion before starting dependent steps; it remains active.`);
  }
  if (slackMinutes < 0) {
    const message = `The requested serving time is not feasible with the current schedule. Current estimated serving is ${estimatedServeAt}, ${Math.ceil(-slackMinutes)} minute(s) after the target.`;
    warnings.push(message);
    changes.push({ kind: 'deadline', message });
  }
  return { steps, estimatedServeAt, slackMinutes, changes, warnings };
}
