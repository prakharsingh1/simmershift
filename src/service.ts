import { randomUUID } from 'node:crypto';
import { buildPlan, normalizeConstraints } from './planner.js';
import { toolSchemas } from './schemas.js';
import { KitchenStore } from './store.js';
import { KitchenError, type Change, type Session, type ToolName } from './types.js';

export class KitchenService {
  constructor(public store: KitchenStore, private now = () => new Date().toISOString()) {}
  private time(session?: Session): string {
    return new Date(Math.max(Date.parse(session?.clock ?? this.now()), Date.parse(this.now()) + (session?.clockOffsetMs ?? 0))).toISOString();
  }
  call(name: ToolName, raw: unknown): Session | Record<string, unknown> {
    const parsed = toolSchemas[name].safeParse(raw);
    if (!parsed.success) throw new KitchenError('INVALID_INPUT', 'Check the tool arguments.', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`));
    if (name === 'get_session' || name === 'explain_changes') {
      const { sessionId } = parsed.data as { sessionId: string };
      const session = this.store.get(sessionId);
      if (name === 'get_session') return { ...session, clock: this.time(session) };
      const clock = this.time(session);
      const completed = session.steps.filter(s => s.status === 'complete').map(s => s.title);
      const active = session.steps.filter(s => s.status === 'active').map(s => ({ id: s.id, title: s.title,
        timerEndsAt: s.timerEndsAt, remainingMinutes: Math.max(0, Math.ceil((Date.parse(s.timerEndsAt!) - Date.parse(clock)) / 60_000)) }));
      const ready = session.steps.filter(s => s.status === 'pending' && s.dependencies.every(id => session.steps.find(d => d.id === id)?.status === 'complete') &&
        s.resources.every(resource => session.steps.filter(d => d.status === 'active' && d.resources.includes(resource)).length < (resource === 'burner' ? session.constraints.equipment.burners : 1)));
      return { sessionId, revision: session.revision, changes: session.changes, warnings: session.warnings,
        summary: session.changes.map(c => c.message).join(' ') || 'No changes since the last plan.',
        history: this.store.history(sessionId),
        briefing: { completed, active, nextReady: ready.map(s => ({ id: s.id, title: s.title })),
          summary: `${completed.length} steps kept complete. ${active.length ? 'Check your active food first; timers never confirm completion. ' : ''}${session.status === 'paused' ? 'The workflow is paused. Check the physical kitchen before resuming.' : 'Continue with a ready step after checking the kitchen.'}` } };
    }
    const args = parsed.data as { requestId: string; sessionId?: string; expectedRevision?: number };
    return this.store.execute(args.requestId, name, parsed.data, () => {
      if (name === 'create_plan') {
        const input = toolSchemas.create_plan.parse(parsed.data);
        const now = this.time();
        const constraints = normalizeConstraints(input.constraints);
        return { id: randomUUID(), revision: 1, name: input.name ?? 'Weeknight pantry bowl', status: 'cooking', constraints,
          createdAt: now, updatedAt: now, clock: now, clockOffsetMs: 0, ...buildPlan(constraints, now) };
      }
      let session = this.store.get(args.sessionId!);
      if (args.expectedRevision !== undefined && args.expectedRevision !== session.revision)
        throw new KitchenError('REVISION_CONFLICT', 'The plan changed. Refresh the session before trying again.');
      if (session.status === 'served') throw new KitchenError('SESSION_SERVED', 'This meal is already served. Create another plan.');
      session.clock = this.time(session);
      const event: Change[] = [];
      if (name === 'change_constraint') {
        const { patch } = toolSchemas.change_constraint.parse(parsed.data);
        if (Object.keys(patch).length === 0) throw new KitchenError('INVALID_INPUT', 'Provide at least one constraint to change.');
        if (patch.servings !== undefined && patch.servings !== session.constraints.servings && session.steps.some(s => s.status !== 'pending'))
          throw new KitchenError('CONSTRAINT_CONFLICT', 'Portions are already in progress. Create a new plan to change servings.');
        session.constraints = normalizeConstraints({ ...session.constraints, ...patch,
          equipment: { ...session.constraints.equipment, ...patch.equipment } });
        event.push({ kind: 'constraint', message: `Updated ${Object.keys(patch).join(', ')}; completed work and running timers stay recorded.` });
      }
      if (name === 'start_step' || name === 'complete_step') {
        const { stepId } = toolSchemas[name].parse(parsed.data);
        if (session.status === 'paused') throw new KitchenError('SESSION_PAUSED', 'Resume the session before updating a step.');
        const step = session.steps.find(s => s.id === stepId);
        if (!step) throw new KitchenError('STEP_NOT_FOUND', 'This step is not in the current meal.');
        if (name === 'start_step') {
          if (step.status !== 'pending') throw new KitchenError('STEP_STATE', 'Only a pending step can be started.');
          const unmet = step.dependencies.filter(id => session.steps.find(s => s.id === id)?.status !== 'complete');
          if (unmet.length) throw new KitchenError('DEPENDENCY_BLOCKED', 'Finish the prerequisite steps first.', unmet);
          for (const resource of step.resources) {
            const occupied = session.steps.filter(s => s.status === 'active' && s.resources.includes(resource)).length;
            const capacity = resource === 'burner' ? session.constraints.equipment.burners : 1;
            if (occupied >= capacity) throw new KitchenError('RESOURCE_BUSY', `The ${resource} is occupied. Confirm the active step is finished first.`);
          }
          step.status = 'active'; step.startedAt = session.clock;
          step.timerEndsAt = new Date(Date.parse(session.clock) + step.durationMinutes * 60_000).toISOString();
          event.push({ kind: 'progress', message: `Started ${step.title}. Its timer is an estimate; completion needs your confirmation.` });
        } else {
          if (step.status !== 'active') throw new KitchenError('STEP_STATE', 'Start a step before confirming completion.');
          step.status = 'complete'; step.completedAt = session.clock;
          event.push({ kind: 'progress', message: `Confirmed ${step.title} complete. This work will be kept when the plan changes.` });
        }
      }
      if (name === 'pause_resume') {
        const input = toolSchemas.pause_resume.parse(parsed.data);
        if (input.action === 'pause') {
          if (session.status !== 'cooking') throw new KitchenError('STEP_STATE', 'This session is already paused.');
          if (input.interruptionMinutes !== undefined) throw new KitchenError('INVALID_INPUT', 'interruptionMinutes is only valid when resuming.');
          if (input.physicalState !== undefined) throw new KitchenError('INVALID_INPUT', 'physicalState is only valid when resuming.');
          session.status = 'paused'; session.pausedAt = session.clock;
          event.push({ kind: 'pause', message: 'Session paused. This does not stop heat or unattended kitchen timers; make the kitchen safe yourself.' });
        } else {
          if (session.status !== 'paused') throw new KitchenError('STEP_STATE', 'Pause the session before resuming.');
          const heated = session.steps.filter(s => s.status === 'active' && s.resources.some(r => r === 'burner' || r === 'oven'));
          if (heated.length && !input.physicalState)
            throw new KitchenError('PHYSICAL_STATE_REQUIRED', 'Check the active pans before resuming. Report whether the heat stayed unchanged or changed; no cooking state is assumed.');
          if (input.interruptionMinutes !== undefined) {
            const desired = Math.max(Date.parse(session.clock), Date.parse(session.pausedAt!) + input.interruptionMinutes * 60_000);
            session.clockOffsetMs = (session.clockOffsetMs ?? 0) + desired - Date.parse(session.clock);
            session.clock = new Date(desired).toISOString();
            event.push({ kind: 'pause', message: `Simulated a ${input.interruptionMinutes}-minute interruption using a local logical clock.` });
          } else event.push({ kind: 'pause', message: input.physicalState === 'heat_changed' ? 'Resumed at the current time after your physical kitchen check.' : 'Resumed at the current time; running timers retained their original deadlines.' });
          if (input.physicalState === 'heat_changed') {
            for (const step of heated) step.timerEndsAt = new Date(Date.parse(session.clock) + step.durationMinutes * 60_000).toISOString();
            event.push({ kind: 'pause', message: 'You reported changed heat. Active heated steps received fresh full-duration estimates because prior cooking progress is uncertain. Check the food yourself before confirming completion.' });
          } else if (heated.length) event.push({ kind: 'pause', message: 'You confirmed the heat stayed unchanged. Original timer deadlines are kept; elapsed timers still require your food check.' });
          session.status = 'cooking'; delete session.pausedAt;
        }
      }
      const plan = buildPlan(session.constraints, session.clock, session);
      session = { ...session, ...plan, changes: [...event, ...plan.changes], revision: session.revision + 1, updatedAt: session.clock };
      if (session.steps.every(s => s.status === 'complete')) session.status = 'served';
      return session;
    });
  }
}
