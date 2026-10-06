export type StepStatus = 'pending' | 'active' | 'complete';
export type Resource = 'hands' | 'burner' | 'oven';
export interface Constraints {
  pantry: string[];
  avoid: string[];
  servings: number;
  targetServeAt: string;
  equipment: { burners: number; oven: boolean };
}
export interface Step {
  id: string;
  title: string;
  detail: string;
  durationMinutes: number;
  dependencies: string[];
  resources: Resource[];
  ingredients: string[];
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  timerEndsAt?: string;
  scheduledStart: string;
  scheduledEnd: string;
}
export interface Change {
  kind: 'ingredient' | 'schedule' | 'deadline' | 'progress' | 'pause' | 'constraint';
  message: string;
}
export interface HistoryEntry { revision: number; operation: string; at: string; changes: Change[] }
export interface Session {
  id: string;
  revision: number;
  name: string;
  status: 'cooking' | 'paused' | 'served';
  constraints: Constraints;
  steps: Step[];
  createdAt: string;
  updatedAt: string;
  clock: string;
  clockOffsetMs?: number;
  pausedAt?: string;
  estimatedServeAt: string;
  slackMinutes: number;
  changes: Change[];
  warnings: string[];
}
export class KitchenError extends Error {
  constructor(public code: string, message: string, public details: string[] = []) {
    super(message);
    this.name = 'KitchenError';
  }
}
export interface CreateInput { requestId: string; constraints: Constraints; name?: string }
export interface MutationInput { sessionId: string; requestId: string; expectedRevision?: number }
export type ToolName = 'create_plan' | 'get_session' | 'change_constraint' | 'start_step' | 'complete_step' | 'pause_resume' | 'replan' | 'explain_changes';
