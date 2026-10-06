import { z } from 'zod';
const id = z.string().min(1).max(120);
const items = z.array(z.string().trim().min(1).max(50)).max(80);
const equipment = z.object({ burners: z.number().int().min(1).max(2), oven: z.boolean() }).strict();
export const constraintsSchema = z.object({
  pantry: items, avoid: items, servings: z.number().int().min(1).max(6),
  targetServeAt: z.iso.datetime({ offset: true }), equipment,
}).strict();
const mutation = { sessionId: id, requestId: id, expectedRevision: z.number().int().positive().optional() };
export const toolSchemas = {
  create_plan: z.object({ requestId: id, name: z.string().min(1).max(100).optional(), constraints: constraintsSchema }).strict(),
  get_session: z.object({ sessionId: id }).strict(),
  change_constraint: z.object({ ...mutation, patch: constraintsSchema.partial().extend({ equipment: equipment.partial().optional() }).strict() }).strict(),
  start_step: z.object({ ...mutation, stepId: id }).strict(),
  complete_step: z.object({ ...mutation, stepId: id }).strict(),
  pause_resume: z.object({ ...mutation, action: z.enum(['pause', 'resume']), interruptionMinutes: z.number().int().min(0).max(180).optional(), physicalState: z.enum(['heat_unchanged', 'heat_changed']).optional() }).strict(),
  replan: z.object(mutation).strict(),
  explain_changes: z.object({ sessionId: id }).strict(),
};
