import { Workflow, WorkflowNode, LogEntry, ModelConfig, Notification, Agent, LLMNodeConfig, HTTPNodeConfig, DelayNodeConfig, AlertNodeConfig } from '../types';
import { executeChatRequest } from './llmProvider';

interface EngineContext {
  workflow: Workflow;
  agents: Agent[];
  modelConfigs: ModelConfig[];
  log: (entry: LogEntry) => void;
  onAlert: (note: Notification) => void;
  outputs: Record<string, any>;
}

export const runWorkflow = async (
  workflow: Workflow,
  agents: Agent[],
  modelConfigs: ModelConfig[],
  onLog: (entry: LogEntry) => void,
  onAlert: (note: Notification) => void
): Promise<void> => {
  
  const context: EngineContext = {
    workflow,
    agents,
    modelConfigs,
    log: onLog,
    onAlert,
    outputs: {}
  };

  onLog({
    id: Date.now().toString(),
    timestamp: Date.now(),
    type: 'info',
    method: 'WORKFLOW_START',
    content: `Starting workflow: ${workflow.name} (Agent: ${workflow.agentId || 'None'})`
  });

  const startNode = workflow.nodes.find(n => n.label.toLowerCase().includes('trigger') || n.type === 'trigger');
  if (!startNode) {
    throw new Error("No Trigger node found.");
  }

  const queue: string[] = [startNode.id];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node) continue;

    try {
      const output = await executeNode(node, context);
      context.outputs[nodeId] = output;

      const outgoingEdges = workflow.edges.filter(e => e.source === nodeId);
      outgoingEdges.forEach(edge => {
         queue.push(edge.target);
      });

    } catch (e: any) {
       onLog({
          id: Date.now().toString(),
          timestamp: Date.now(),
          type: 'error',
          method: `NODE_FAIL: ${node.label}`,
          content: e.message
       });
       throw e;
    }
  }

  onLog({
    id: Date.now().toString(),
    timestamp: Date.now(),
    type: 'info',
    method: 'WORKFLOW_COMPLETE',
    content: `Workflow ${workflow.name} finished.`
  });
};

const executeNode = async (node: WorkflowNode, ctx: EngineContext): Promise<any> => {
  const label = node.label.toLowerCase();
  
  ctx.log({
     id: Date.now().toString(),
     timestamp: Date.now(),
     type: 'info',
     method: `EXECUTE_NODE`,
     content: `Running ${node.label} (${node.id})`
  });

  if (label.includes('llm') || label.includes('generate')) {
      const config = node.config as LLMNodeConfig;
      
      const assignedAgent = ctx.agents.find(a => a.id === ctx.workflow.agentId);
      const agentModelId = assignedAgent?.model;
      const targetModelId = config.modelId || agentModelId || ctx.modelConfigs[0].modelId;
      
      const model = ctx.modelConfigs.find(m => m.modelId === targetModelId) || ctx.modelConfigs[0];
      
      let prompt = config.prompt || '';
      Object.entries(ctx.outputs).forEach(([id, val]) => {
          prompt = prompt.replace(`{{${id}}}`, typeof val === 'object' ? JSON.stringify(val) : val);
      });

      const messages = [];
      if (assignedAgent) {
          messages.push({ role: 'system', content: assignedAgent.systemPrompt });
      } else {
          messages.push({ role: 'system', content: 'You are a helpful automation assistant.' });
      }
      messages.push({ role: 'user', content: prompt });

      let resText = '';
      await executeChatRequest(
          messages,
          model,
          ctx.modelConfigs,
          (chunk) => resText += chunk,
          () => {}
      );
      return resText;
  }

  if (label.includes('http') || label.includes('request')) {
      const config = node.config as HTTPNodeConfig;
      if (!config.url) throw new Error("URL required for HTTP node");
      
      const res = await fetch(config.url, {
          method: config.method || 'GET',
          headers: { 'Content-Type': 'application/json' },
          body: config.body ? JSON.stringify(JSON.parse(config.body)) : undefined
      });
      return await res.json();
  }

  if (node.type === 'delay' || label.includes('delay') || label.includes('hold')) {
      const config = node.config as DelayNodeConfig;
      const ms = config.duration || 1000;
      ctx.log({
        id: Date.now().toString(),
        timestamp: Date.now(),
        type: 'info',
        method: `DELAY`,
        content: `Holding execution for ${ms / 1000} seconds...`
      });
      await new Promise(resolve => setTimeout(resolve, ms));
      return { delayed: ms };
  }

  if (label.includes('alert')) {
      const config = node.config as AlertNodeConfig;
      
      let finalMessage = config.message || "Workflow Alert";
      Object.entries(ctx.outputs).forEach(([id, val]) => {
          finalMessage = finalMessage.replace(`{{${id}}}`, typeof val === 'object' ? JSON.stringify(val) : val);
      });

      ctx.onAlert({
          id: Date.now().toString(),
          title: "Workflow Automation",
          message: finalMessage,
          type: config.level || 'info',
          timestamp: Date.now(),
          read: false
      });
      return { alerted: true };
  }

  return { triggeredAt: Date.now() };
};
