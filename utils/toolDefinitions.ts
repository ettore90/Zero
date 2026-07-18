// =============================================================================
// toolDefinitions.ts — re-export shim
// Single source of truth lives in /toolDefinitions.js (plain ESM, used by server too)
// This file re-exports for browser TypeScript consumers.
// =============================================================================

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { SYSTEM_TOOLS as _SYSTEM_TOOLS, buildToolsForAgent as _buildToolsForAgent, buildToolWeightInstructions as _buildToolWeightInstructions } from '../toolDefinitions.js';

export type ToolDefinition = {
  type: 'function';
  weight?: number;
  group?: string;
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
};

export const SYSTEM_TOOLS: ToolDefinition[] = _SYSTEM_TOOLS;
export const buildToolsForAgent: (agent: { allowedTools?: string[] } | null) => ToolDefinition[] = _buildToolsForAgent;
export const buildToolWeightInstructions: (allowedTools?: string[]) => string = _buildToolWeightInstructions;
