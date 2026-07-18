export const WORKFLOW_TOOL_NODE_TYPE: 'tool';
export const WORKFLOW_TOOL_OUTPUT_CLASSES: {
  readonly INLINE: 'inline';
  readonly PREVIEW: 'preview';
  readonly ARTIFACT: 'artifact';
};
export const WORKFLOW_TOOL_RESULT_STATUS: {
  readonly SUCCESS: 'success';
  readonly ERROR: 'error';
  readonly TIMEOUT: 'timeout';
};
export const WORKFLOW_TOOL_EVENTS: {
  readonly START: 'tool_start';
  readonly RESULT: 'tool_result';
  readonly TIMEOUT: 'tool_timeout';
  readonly ERROR: 'tool_error';
};
export function createWorkflowToolResultEnvelope(input?: any): any;
export function isWorkflowToolResultEnvelope(value: any): boolean;
export function executeWorkflowTool(input: any): Promise<any>;
export function resolveWorkflowToolBindingsForNode(input: any, context?: any): any;
export function validateWorkflowToolNodeDefinition(toolName: string, nodeConfig?: any): any;
export function sanitizeWorkflowToolEventPayload(payload: any, options?: any): any;
export function runScheduledWorkflow(workflow: any, triggerSource: any, deps: any): Promise<any>;
export function cancelWorkflow(runId: string): void;
export function isCancelled(runId: string): boolean;
