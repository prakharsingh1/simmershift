import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { KitchenService } from './service.js';
import { toolSchemas } from './schemas.js';
import { KitchenError, type ToolName } from './types.js';

export const PROTOCOL_VERSION = '2025-11-25';
const descriptions: Record<ToolName, string> = {
  create_plan: 'Create a persisted pantry-bowl plan with serving time, dependency order and resource schedule. Supply a unique requestId.',
  get_session: 'Resume by reading a persisted sessionId. Timers are estimates and do not automatically complete food.',
  change_constraint: 'Atomically update pantry, avoid list, servings, equipment or serving time, and replan. Started food remains fixed. Use requestId and expectedRevision.',
  start_step: 'Start a ready step after all dependencies are confirmed complete and resources are free. Records a timer deadline.',
  complete_step: 'Confirm a started step is actually complete. This records user confirmation, not a food safety assessment.',
  pause_resume: 'Pause or resume the planning session. Heat and cooking timers do not pause. Before resuming active heated food, check the kitchen and report physicalState heat_unchanged or heat_changed. Changed heat resets full-duration estimates; food is never auto-completed. Optional interruptionMinutes advances a clearly simulated logical clock.',
  replan: 'Recompute remaining steps at the current kitchen clock, keeping confirmed work and active timer deadlines.',
  explain_changes: 'Explain the most recent plan revision and disclose timing warnings.',
};
export function createMcpServer(service: KitchenService): McpServer {
  const server = new McpServer({ name: 'simmershift-mcp', version: '0.1.0' }, {
    supportedProtocolVersions: [PROTOCOL_VERSION],
    instructions: 'SimmerShift is a local kitchen planning simulation, not an Alexa device connection. Ask the user to confirm completion. Pause never turns off appliances. Persist the returned sessionId. Use unique requestId values for mutations and reuse one only to retry identical arguments.',
  });
  for (const name of Object.keys(toolSchemas) as ToolName[]) {
    const readOnly = name === 'get_session' || name === 'explain_changes';
    server.registerTool(name, {
      description: descriptions[name], inputSchema: toolSchemas[name],
      annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (args: unknown): Promise<CallToolResult> => {
      try {
        const result = service.call(name, args);
        const structuredContent = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent };
      } catch (error) {
        const e = error instanceof KitchenError ? error : new KitchenError('INTERNAL_ERROR', 'The local planner could not process this request.');
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: e.code, message: e.message, details: e.details } }) }] };
      }
    });
  }
  return server;
}
