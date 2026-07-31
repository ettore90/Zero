// =============================================================================
// toolDefinitions.js — Single source of truth for tool definitions
// Used by: server.js (Node ESM) and utils/toolDefinitions.ts (browser shim)
// IMPORTANT: Keep as plain JS — no TypeScript syntax
// =============================================================================

export const SYSTEM_TOOLS = [
  // ---------------------------------------------------------------------------
  // FILE SYSTEM
  // ---------------------------------------------------------------------------
  {
    type: 'function',
    group: 'File System',
    function: {
      name: 'read_file',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Read a file from the filesystem. Supports partial reads via start_line/end_line for large files.',
      parameters: {
        type: 'object',
        properties: {
          path:       { type: 'string', description: 'Absolute path to the file' },
          start_line: { type: 'number', description: '1-indexed start line (inclusive). Omit for full file.' },
          end_line:   { type: 'number', description: '1-indexed end line (inclusive). Omit for full file.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    group: 'File System',
    function: {
      name: 'write_file',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Write content to a file. For files larger than ~200 lines, prefer write_file_chunked to avoid token limits. For targeted edits to existing files, use replace_in_file instead.',
      parameters: {
        type: 'object',
        properties: {
          path:    { type: 'string', description: 'Absolute path to the file' },
          content: { type: 'string', description: 'Content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    group: 'File System',
    function: {
      name: 'write_file_chunked',
      description: 'Write a large file in chunks to avoid token limits. Call with chunk_index=0 and append=false to start (clears file), then chunk_index=1,2,... with append=true for subsequent chunks. Use when file content exceeds ~200 lines.',
      parameters: {
        type: 'object',
        properties: {
          path:        { type: 'string', description: 'Absolute path to the file' },
          content:     { type: 'string', description: 'Chunk of content to write' },
          append:      { type: 'boolean', description: 'false = overwrite/start new file, true = append to existing' },
          chunk_index: { type: 'number', description: 'Chunk sequence number (0, 1, 2, ...)' },
        },
        required: ['path', 'content', 'append'],
      },
    },
  },
  {
    type: 'function',
    group: 'File System',
    function: {
      name: 'replace_in_file',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Replace a specific string/block in a file without rewriting the whole file. Much more token-efficient than read_file + write_file for targeted edits. Fails clearly if old_str is not found.',
      parameters: {
        type: 'object',
        properties: {
          path:        { type: 'string', description: 'Absolute path to the file' },
          old_str:     { type: 'string', description: 'Exact string to find and replace (must match file content exactly, including whitespace and newlines)' },
          new_str:     { type: 'string', description: 'Replacement string' },
          replace_all: { type: 'boolean', description: 'Replace all occurrences (default: false — only first)' },
        },
        required: ['path', 'old_str', 'new_str'],
      },
    },
  },
  {
    type: 'function',
    group: 'File System',
    function: {
      name: 'list_directory',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'List files and directories at a given path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to directory' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    group: 'File System',
    function: {
      name: 'find_files',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Search for files matching a pattern within a directory. Always provide a path to avoid scanning the entire filesystem.',
      parameters: {
        type: 'object',
        properties: {
          path:      { type: 'string', description: 'Base directory to search in' },
          pattern:   { type: 'string', description: 'Filename pattern (e.g. "*.ts", "package.json")' },
          type:      { type: 'string', enum: ['file', 'dir', ''], description: 'Restrict to files or directories' },
          max_depth: { type: 'number', description: 'Max directory depth (default: 8, max: 15)' },
          exclude:   { type: 'array', items: { type: 'string' }, description: 'Patterns to exclude (e.g. ["node_modules", "dist"])' },
          relative:  { type: 'boolean', description: 'Return paths relative to base path (default: false)' },
        },
        required: ['path'],
      },
    },
  },

  // ---------------------------------------------------------------------------
  // EXECUTION
  // ---------------------------------------------------------------------------
  {
    type: 'function',
    weight: 0.3,
    group: 'Execution',
    function: {
      name: 'run_terminal_command',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Execute a shell command. Supports pipes, redirections, &&, and environment variables. Interactive commands (vim, ssh, etc.) are blocked.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          cwd:     { type: 'string', description: 'Working directory for this command' },
          timeout: { type: 'number', description: 'Timeout in seconds (default: 60, max: 600)' },
          env:     { type: 'object', description: 'Environment variables to set (e.g. { "NODE_ENV": "test" })' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    weight: 0.3,
    group: 'Execution',
    function: {
      name: 'run_python_code',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Execute Python code and return stdout/stderr.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Python code to execute' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    group: 'Orchestration',
    function: {
      name: 'request_plan_approval',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Request approval of the plan before execution.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Plan title' },
          objective: { type: 'string', description: 'What the plan aims to achieve' },
          approach: { type: 'string', description: 'How the plan will be executed' },
          risks: { type: 'string', description: 'Optional risks or concerns' },
          checklist: {
            type: 'array',
            description: 'Optional checklist items. Accepts legacy strings or structured items with comments.',
            items: {
              anyOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    text: { type: 'string' },
                    done: { type: 'boolean' },
                    comments: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          author: { type: 'string' },
                          role: { type: 'string', enum: ['agent', 'user'] },
                          text: { type: 'string' },
                          createdAt: { type: 'number' },
                        },
                        required: ['text'],
                      },
                    },
                  },
                  required: ['text'],
                },
              ],
            },
          },
        },
        required: ['title', 'objective', 'approach'],
      },
    },
  },
  {
    type: 'function',
    group: 'Orchestration',
    function: {
      name: 'complete_plan_checklist_item',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Mark a specific checklist item in the active in-progress plan as completed.',
      parameters: {
        type: 'object',
        properties: {
          planKey: { type: 'string', description: 'Plan key of the plan' },
          itemId: { type: 'string', description: 'Checklist item id' },
          itemText: { type: 'string', description: 'Fallback matcher by checklist item text when itemId is unavailable' },
        },
        required: ['planKey'],
      },
    },
  },
  {
    type: 'function',
    group: 'Orchestration',
    function: {
      name: 'comment_plan_checklist_item',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Add a progress comment to a specific checklist item in the active in-progress plan.',
      parameters: {
        type: 'object',
        properties: {
          planKey: { type: 'string', description: 'Plan key of the plan' },
          itemId: { type: 'string', description: 'Checklist item id' },
          itemText: { type: 'string', description: 'Fallback matcher by checklist item text when itemId is unavailable' },
          text: { type: 'string', description: 'Comment text to append to the checklist item' },
        },
        required: ['planKey', 'text'],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'list_prompt_refs',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'List local prompt refs for a canonical prompt document resolved by visible agent, explicit document reference, or global scope.',
      parameters: {
        type: 'object',
        properties: {
          agentId:     { type: 'string', description: 'Agent ID or name' },
          identifier:  { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          documentId:  { type: 'string', description: 'Prompt document id to read' },
          documentKey: { type: 'string', description: 'Prompt document key to read' },
          key:         { type: 'string', description: 'Prompt document key to read (alias of documentKey)' },
          global:      { type: 'boolean', description: 'When true, read the canonical global prompt document' },
          scope:       { type: 'string', description: 'Optional scope selector; use global for the global prompt document' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'resolve_prompt_refs',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Resolve effective prompt refs for a visible agent only, including inherited/global composition semantics for that agent.',
      parameters: {
        type: 'object',
        properties: {
          agentId:    { type: 'string', description: 'Agent ID or name' },
          identifier: { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          agentType:  { type: 'string', description: 'Optional agent type override for effective ref resolution' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'prompt_usage_map',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Map prompt usage and blast radius for a block, document, agent, or global prompt scope.',
      parameters: {
        type: 'object',
        properties: {
          blockId:     { type: 'string', description: 'Prompt block id to inspect' },
          documentId:  { type: 'string', description: 'Prompt document id to inspect' },
          documentKey: { type: 'string', description: 'Prompt document key to inspect' },
          key:         { type: 'string', description: 'Prompt document key to inspect (alias of documentKey)' },
          agentId:     { type: 'string', description: 'Agent ID or name' },
          identifier:  { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          agentType:   { type: 'string', description: 'Optional agent type hint for effective usage resolution' },
          global:      { type: 'boolean', description: 'When true, inspect the canonical global prompt document' },
          scope:       { type: 'string', description: 'Optional scope selector; use global for the global prompt document' }
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'validate_prompt_architecture',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Validate prompt architecture for a canonical prompt target resolved by document, block, global scope, or agent type.',
      parameters: {
        type: 'object',
        properties: {
          documentId:  { type: 'string', description: 'Prompt document id to validate' },
          blockId:     { type: 'string', description: 'Prompt block id to validate' },
          global:      { type: 'boolean', description: 'When true, validate the canonical global prompt document' },
          scope:       { type: 'string', description: 'Optional scope selector; use global for the global prompt document' },
          agentType:   { type: 'string', description: 'Agent type used to resolve the effective architecture for validation' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'prompt_operational_diff',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Compare current prompt state against preview or a specific persisted version for a single canonical target.',
      parameters: {
        type: 'object',
        properties: {
          documentId:  { type: 'string', description: 'Prompt document id to compare' },
          documentKey: { type: 'string', description: 'Prompt document key to compare' },
          key:         { type: 'string', description: 'Prompt document key to compare (alias of documentKey)' },
          agentId:     { type: 'string', description: 'Agent ID or name' },
          identifier:  { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          agentType:   { type: 'string', description: 'Optional agent type hint for effective diff resolution' },
          global:      { type: 'boolean', description: 'When true, compare the canonical global prompt document' },
          compareTo:   { type: 'string', enum: ['preview', 'version'], description: 'Diff target kind' },
          versionId:   { type: 'string', description: 'Prompt version id to compare when compareTo=version' }
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'list_prompt_blocks',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'List prompt blocks for a canonical prompt document resolved by agent or explicit document reference.',
      parameters: {
        type: 'object',
        properties: {
          agentId:     { type: 'string', description: 'Agent ID or name' },
          identifier:  { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          documentId:  { type: 'string', description: 'Prompt document id to read' },
          documentKey: { type: 'string', description: 'Prompt document key to read' },
          key:         { type: 'string', description: 'Prompt document key to read (alias of documentKey)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'reorder_prompt_blocks',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Reorder local prompt block refs for a canonical prompt document resolved by agent or explicit document reference.',
      parameters: {
        type: 'object',
        properties: {
          agentId:     { type: 'string', description: 'Agent ID or name' },
          identifier:  { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          documentId:  { type: 'string', description: 'Prompt document id to write' },
          documentKey: { type: 'string', description: 'Prompt document key to write' },
          key:         { type: 'string', description: 'Prompt document key to write (alias of documentKey)' },
          blockIds:    { type: 'array', items: { type: 'string' }, description: 'Ordered block ids to place first in the local document ref order' },
          orderedBlockIds: { type: 'array', items: { type: 'string' }, description: 'Legacy alias of blockIds' }
        },
        required: ['blockIds'],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'set_prompt_block_refs',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Reconcile the local prompt block refs for a canonical prompt document to exactly match the ordered refs array. Omitted refs are removed locally. This tool does not delete canonical prompt_block_type_assignments; use delete_prompt_block_assignments or inspect/reconcile drift tools when needed.',
      parameters: {
        type: 'object',
        properties: {
          agentId:     { type: 'string', description: 'Agent ID or name' },
          identifier:  { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          documentId:  { type: 'string', description: 'Prompt document id to write' },
          documentKey: { type: 'string', description: 'Prompt document key to write' },
          key:         { type: 'string', description: 'Prompt document key to write (alias of documentKey)' },
          refs: {
            type: 'array',
            description: 'Ordered local refs to reconcile for the document. refs=[] clears all local refs for the document.',
            items: {
              type: 'object',
              properties: {
                blockId: { type: 'string', description: 'Prompt block id' },
                blockVersionId: { type: 'string', description: 'Pinned prompt block version id' },
                included: { type: 'boolean', description: 'Whether the ref is included locally' },
                position: { type: 'number', description: 'Optional position hint; final order follows array order' },
                metadata: { type: 'object', description: 'Prompt ref metadata' },
                followCurrent: { type: 'boolean', description: 'When true, follow current block version instead of pinning a version' }
              },
              required: ['blockId']
            }
          }
        },
        required: ['refs'],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'delete_prompt_block_assignments',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Delete canonical prompt block assignments for a canonical prompt document, optionally limited to specific blockIds or only orphan assignments without local refs.',
      parameters: {
        type: 'object',
        properties: {
          agentId:     { type: 'string', description: 'Agent ID or name' },
          identifier:  { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          documentId:  { type: 'string', description: 'Prompt document id to mutate' },
          documentKey: { type: 'string', description: 'Prompt document key to mutate' },
          key:         { type: 'string', description: 'Prompt document key to mutate (alias of documentKey)' },
          blockIds:    { type: 'array', items: { type: 'string' }, description: 'Optional list of blockIds whose canonical assignments should be removed' },
          orphanOnly:  { type: 'boolean', description: 'When true, remove only assignments that currently have no local ref' }
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'inspect_prompt_block_assignment_drift',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Inspect legacy drift between local prompt block refs and canonical prompt_block_type_assignments for a canonical prompt document. Dry-run only; does not mutate data.',
      parameters: {
        type: 'object',
        properties: {
          agentId:     { type: 'string', description: 'Agent ID or name' },
          identifier:  { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          documentId:  { type: 'string', description: 'Prompt document id to inspect' },
          documentKey: { type: 'string', description: 'Prompt document key to inspect' },
          key:         { type: 'string', description: 'Prompt document key to inspect (alias of documentKey)' }
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'reconcile_prompt_block_assignment_drift',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Manually reconcile legacy drift between local refs and canonical prompt_block_type_assignments for a canonical prompt document. Safe and explicit: can delete orphan assignments; local ref inclusion conflicts are reported in the inspection payload and are not auto-toggled by this tool.',
      parameters: {
        type: 'object',
        properties: {
          agentId:     { type: 'string', description: 'Agent ID or name' },
          identifier:  { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          documentId:  { type: 'string', description: 'Prompt document id to reconcile' },
          documentKey: { type: 'string', description: 'Prompt document key to reconcile' },
          key:         { type: 'string', description: 'Prompt document key to reconcile (alias of documentKey)' },
          deleteOrphans: { type: 'boolean', description: 'When true, delete canonical assignments that currently have no local ref' },
          fixIncludedRefs: { type: 'boolean', description: 'Reserved compatibility flag. Local ref inclusion conflicts are reported but not auto-toggled by this tool.' }
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'get_prompt_block',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Get a prompt block by blockId, with optional canonical document context validation.',
      parameters: {
        type: 'object',
        properties: {
          blockId:     { type: 'string', description: 'Prompt block id' },
          agentId:     { type: 'string', description: 'Agent ID or name' },
          identifier:  { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          documentId:  { type: 'string', description: 'Prompt document id to validate against' },
          documentKey: { type: 'string', description: 'Prompt document key to validate against' },
          key:         { type: 'string', description: 'Prompt document key to validate against (alias of documentKey)' },
        },
        required: ['blockId'],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'create_prompt_block',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Create a prompt block under a canonical prompt document resolved by agent or explicit document reference.',
      parameters: {
        type: 'object',
        properties: {
          agentId:     { type: 'string', description: 'Agent ID or name' },
          identifier:  { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          documentId:  { type: 'string', description: 'Prompt document id to write' },
          documentKey: { type: 'string', description: 'Prompt document key to write' },
          key:         { type: 'string', description: 'Prompt document key to write (alias of documentKey)' },
          blockKey:    { type: 'string', description: 'Prompt block key' },
          blockType:   { type: 'string', description: 'Prompt block type' },
          title:       { type: 'string', description: 'Prompt block title' },
          content:     { type: 'string', description: 'Prompt block content' },
          metadata:    { type: 'object', description: 'Prompt block metadata' },
        },
        required: ['blockKey', 'content'],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'create_prompt_block_version',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Create a new version for a prompt block by blockId, with optional canonical document context validation.',
      parameters: {
        type: 'object',
        properties: {
          blockId:     { type: 'string', description: 'Prompt block id' },
          agentId:     { type: 'string', description: 'Agent ID or name' },
          identifier:  { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          documentId:  { type: 'string', description: 'Prompt document id to validate against' },
          documentKey: { type: 'string', description: 'Prompt document key to validate against' },
          key:         { type: 'string', description: 'Prompt document key to validate against (alias of documentKey)' },
          content:     { type: 'string', description: 'Prompt block version content' },
          metadata:    { type: 'object', description: 'Prompt block version metadata' },
        },
        required: ['blockId', 'content'],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'delete_prompt_block',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Delete a prompt block by blockId, with optional canonical document context validation and prompt store coherence.',
      parameters: {
        type: 'object',
        properties: {
          blockId:     { type: 'string', description: 'Prompt block id' },
          agentId:     { type: 'string', description: 'Agent ID or name' },
          identifier:  { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          documentId:  { type: 'string', description: 'Prompt document id to validate against' },
          documentKey: { type: 'string', description: 'Prompt document key to validate against' },
          key:         { type: 'string', description: 'Prompt document key to validate against (alias of documentKey)' },
        },
        required: ['blockId'],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'list_prompt_block_versions',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'List versions for a prompt block by blockId, with optional canonical document context validation.',
      parameters: {
        type: 'object',
        properties: {
          blockId:     { type: 'string', description: 'Prompt block id' },
          agentId:     { type: 'string', description: 'Agent ID or name' },
          identifier:  { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          documentId:  { type: 'string', description: 'Prompt document id to validate against' },
          documentKey: { type: 'string', description: 'Prompt document key to validate against' },
          key:         { type: 'string', description: 'Prompt document key to validate against (alias of documentKey)' },
        },
        required: ['blockId'],
      },
    },
  },
  {
    type: 'function',
    group: 'Execution',
    function: {
      name: 'run_tests',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Run tests or a smoke/sanity validation pass. Auto-detects package manager and common runners (vitest, jest, playwright, pytest, cargo, go). Falls back to lightweight sanity checks instead of becoming a silent no-op.',
      parameters: {
        type: 'object',
        properties: {
          cwd:             { type: 'string', description: 'Working directory' },
          command:         { type: 'string', description: 'Custom test command (overrides auto-detection)' },
          mode:            { type: 'string', enum: ['auto', 'smoke', 'full'], description: 'auto = best detected test command, smoke = prefer fast validation paths, full = prefer primary suite' },
          files:           { type: 'array', items: { type: 'string' }, description: 'Optional specific test files/patterns when supported by the detected runner' },
          timeout:         { type: 'number', description: 'Timeout in seconds (default: 180, max: 900)' },
          passWithNoTests: { type: 'boolean', description: 'When supported by the runner, do not fail if no tests are discovered (default: true)' },
        },
      },
    },
  },

  // ---------------------------------------------------------------------------
  // GIT
  // ---------------------------------------------------------------------------
  {
    type: 'function',
    group: 'Git',
    function: {
      name: 'git_status',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Show current git status with staged/unstaged changes.',
      parameters: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Working directory (git repo root)' },
        },
      },
    },
  },
  {
    type: 'function',
    group: 'Git',
    function: {
      name: 'git_diff',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Show diff of changed files. Returns unified diff output.',
      parameters: {
        type: 'object',
        properties: {
          cwd:   { type: 'string', description: 'Working directory' },
          files: { type: 'array', items: { type: 'string' }, description: 'Specific files to diff (optional — omit for all)' },
        },
      },
    },
  },
  {
    type: 'function',
    group: 'Git',
    function: {
      name: 'git_commit',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Run git add -A then commit with the given message. Set no_add:true to skip staging (use after git_add).',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Commit message' },
          cwd:     { type: 'string', description: 'Working directory' },
          no_add:  { type: 'boolean', description: 'Skip git add -A (default: false)' },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    group: 'Git',
    function: {
      name: 'git_log',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Show commit history in oneline format.',
      parameters: {
        type: 'object',
        properties: {
          cwd:    { type: 'string', description: 'Working directory' },
          limit:  { type: 'number', description: 'Number of commits (default: 10, max: 100)' },
          author: { type: 'string', description: 'Filter by author name or email' },
        },
      },
    },
  },

  {
    type: 'function',
    group: 'Notes',
    function: {
      name: 'list_notes',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'List notes with basic metadata only. Returns metadata-only note summaries and never the full note body. sessionId is optional; when present, it also accepts dispatcher aliases current and active. Results are ordered by updatedAt descending before pagination. Pagination uses simple numeric cursor/limit semantics, and the tool returns top-level nextCursor as a number when another page exists or null otherwise. Do not rely on agentId as an effective filter because it is not enforced by the current dispatcher. limit is optional and follows the dispatcher default.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Optional maximum number of notes to return; uses the dispatcher default when omitted.' },
          cursor: { type: 'string', description: 'Optional numeric pagination cursor (offset-style) consumed by the dispatcher.' },
          sessionId: { type: 'string', description: 'Optional session identifier; when present, also accepts dispatcher aliases current and active.' },
          agentId: { type: 'string', description: 'Agent identifier field present for compatibility only; not an effective filter in the current dispatcher.' },
        },
      },
    },
  },
  {
    type: 'function',
    group: 'Notes',
    function: {
      name: 'read_note',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Read a note. With noteId, reads the targeted note; without noteId, reads the active note. When blockId, sectionId, or anchor is provided, returns a targeted fragment instead of only the full note payload. blockId remains exact, sectionId returns the explicitly addressed section/container, and anchor may resolve semantically for heading targets by returning the heading plus its associated following content. Returns top-level isActive:boolean indicating whether the returned note matches the session active note. sessionId, when present, also accepts dispatcher aliases current and active.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session identifier' },
          noteId: { type: 'string', description: 'Optional note identifier; when provided, reads the targeted note.' },
          blockId: { type: 'string', description: 'Optional block selector for fragment reads.' },
          sectionId: { type: 'string', description: 'Optional section selector for fragment reads.' },
          anchor: { type: 'string', description: 'Optional anchor selector for fragment reads.' },
          includeHtml: { type: 'boolean', description: 'Optional; defaults to true. When false, omits fragment.html for targeted reads.' },
          includeText: { type: 'boolean', description: 'Optional; when true, includes fragment.text for targeted reads.' },
        },
        required: ['sessionId'],
      },
    },
  },
  {
    type: 'function',
    group: 'Notes',
    function: {
      name: 'write_note',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Write a note payload for a session. sessionId accepts dispatcher aliases current and active. With noteId, updates the targeted note; without noteId, creates a new note with a runtime-generated identifier and makes it active. Use contentHtml as the canonical payload for full overwrite/update flows and for localized/partial edits together with expectedVersion, target, operation, and operations. The tool returns a top-level operation field only in the output, with values created or updated. title is optional and, when present, is persisted/updated together with contentHtml according to the dispatcher\'s current create/update/merge semantics.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session identifier; dispatcher aliases current and active are accepted.' },
          noteId: { type: 'string', description: 'Optional note identifier; when provided, updates the targeted note.' },
          title: { type: 'string', description: 'Optional note title; persisted/updated together with contentHtml according to dispatcher semantics.' },
          expectedVersion: { type: 'number', description: 'Optional expected note version for localized/partial edit concurrency control.' },
          target: { type: 'object', description: 'Optional localized edit target descriptor.' },
          operation: { type: 'string', description: 'Optional localized edit operation name.' },
          contentHtml: { type: 'string', description: 'Optional canonical HTML payload for full overwrite/update flows and localized/partial edits.' },
          operations: { type: 'array', items: { type: 'object' }, description: 'Optional batch of localized edit operations.' },
        },
        required: ['sessionId'],
      },
    },
  },
  {
    type: 'function',
    group: 'Notes',
    function: {
      name: 'delete_note',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Delete a note. With noteId, removes the targeted note. Without noteId, removes the active note and re-coerces activeNoteId according to dispatcher behavior. The tool returns a top-level deletedNoteId field in the output.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session identifier' },
          noteId: { type: 'string', description: 'Optional note identifier; when provided, removes the targeted note.' },
        },
        required: ['sessionId'],
      },
    },
  },
  {
    type: 'function',
    group: 'Notes',
    function: {
      name: 'set_active_note',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Set the active note reference for the session without changing note content. sessionId accepts dispatcher aliases current and active.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session identifier; dispatcher aliases current and active are accepted.' },
          noteId: { type: 'string', description: 'Note identifier to mark as active' },
        },
        required: ['sessionId', 'noteId'],
      },
    },
  },
  // ---------------------------------------------------------------------------
  // MEMORY
  // ---------------------------------------------------------------------------
  {
    type: 'function',
    group: 'Memory',
    function: {
      name: 'remember_fact',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Store information in long-term memory. Choose the category that best describes the nature of the information.',
      parameters: {
        type: 'object',
        properties: {
          content:  { type: 'string', description: 'The information to remember' },
          category: {
            type: 'string',
            enum: ['fact', 'state', 'event', 'behavior', 'issue', 'knowledge', 'design'],
            description: 'fact: objective stable info | state: current mutable status | event: something that happened | behavior: user preference or pattern | issue: problem or limitation observed | knowledge: structural understanding of a system or codebase',
          },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for retrieval' },
        },
        required: ['content', 'category'],
      },
    },
  },
  {
    type: 'function',
    group: 'Memory',
    function: {
      name: 'delete_memory',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Delete one or more memories from long-term storage. Use recall_memory first to find the IDs. Can delete by ID, bulk IDs, category, or tags. This tool must not be used to delete agents or agent state objects.',
      parameters: {
        type: 'object',
        properties: {
          id:       { type: 'string', description: 'Single memory ID to delete' },
          ids:      { type: 'array', items: { type: 'string' }, description: 'Multiple memory IDs to delete at once' },
          category: { type: 'string', enum: ['fact', 'state', 'event', 'behavior', 'issue', 'knowledge', 'design', 'summary'], description: 'Delete ALL memories of this category' },
          tags:     { type: 'array', items: { type: 'string' }, description: 'Delete all memories that have ALL specified tags' },
          force:    { type: 'boolean', description: 'Optional override. Required when tags/IDs look like agent identifiers (agent-...). Default false.' },
        },
      },
    },
  },
  {
    type: 'function',
    group: 'Memory',
    function: {
      name: 'recall_memory',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Search long-term memory for relevant facts. Can filter by category or tags.',
      parameters: {
        type: 'object',
        properties: {
          query:    { type: 'string', description: 'Search query (semantic + keyword search)' },
          limit:    { type: 'number', description: 'Max results (default: 10)' },
          category: { type: 'string', enum: ['fact', 'state', 'event', 'behavior', 'issue', 'knowledge', 'design', 'summary'], description: 'Filter by category — returns only memories of this type' },
          tags:     { type: 'array', items: { type: 'string' }, description: 'Filter by tags — returns only memories that have ALL specified tags' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    group: 'Memory',
    function: {
      name: 'update_memory',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Update an existing memory in long-term storage. Use recall_memory first to find the ID. Updates content, summary, tags, confidence or importance without creating a duplicate. Use this instead of remember_fact when a matching memory already exists.',
      parameters: {
        type: 'object',
        properties: {
          id:         { type: 'string', description: 'Memory ID to update (required)' },
          content:    { type: 'string', description: 'New full content (optional — omit to keep existing)' },
          summary:    { type: 'string', description: 'New short summary (optional)' },
          tags:       { type: 'array', items: { type: 'string' }, description: 'New tags (optional — replaces existing tags)' },
          category:   { type: 'string', enum: ['fact', 'state', 'event', 'behavior', 'issue', 'knowledge', 'design'], description: 'New category (optional)' },
          confidence: { type: 'number', description: 'New confidence score 0.0–1.0 (optional)' },
          importance: { type: 'number', description: 'New importance score (optional)' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    group: 'Memory',
    function: {
      name: 'scan_project',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Scan a project directory to understand its structure, dependencies, and tech stack. Automatically saves findings as memories. If the project runs an HTTP server, provide server_base_path to validate that endpoints are reachable with the correct path prefix.',
      parameters: {
        type: 'object',
        properties: {
          path:             { type: 'string',  description: 'Absolute path to scan (defaults to current working directory)' },
          depth:            { type: 'number',  description: 'Directory depth to traverse (default: 3)' },
          save_memories:    { type: 'boolean', description: 'Persist findings as memories (default: true)' },
          server_base_path: { type: 'string',  description: 'Base path prefix of the HTTP server (e.g. "/green"). When provided, performs a health check on key endpoints using http://localhost:${PORT}{server_base_path}/api/... using the current server port.' },
        },
        required: [],
      },
    },
  },

  // ---------------------------------------------------------------------------
  // HTTP / EXTERNAL
  // ---------------------------------------------------------------------------
  {
    type: 'function',
    weight: 0.4,
    group: 'HTTP',
    function: {
      name: 'sleep',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Pause execution for a specified number of seconds. Use this to wait for async background processes to complete — e.g. after triggering a build, deploy, or release job, sleep before polling the job status. Prefer sleep over immediate polling to avoid hammering the API.',
      parameters: {
        type: 'object',
        properties: {
          seconds: { type: 'number', description: 'Number of seconds to sleep (max: 60). Typical values: 15-30s for builds, 5-10s for quick ops.' },
        },
        required: ['seconds'],
      },
    },
  },
  {
    type: 'function',
    group: 'HTTP',
    function: {
      name: 'make_http_request',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Make an HTTP request to an external URL.',
      parameters: {
        type: 'object',
        properties: {
          url:     { type: 'string', description: 'Target URL' },
          method:  { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method (default: GET)' },
          headers: { type: 'object', description: 'Request headers' },
          body:    { type: 'string', description: 'Request body (for POST/PUT/PATCH)' },
        },
        required: ['url'],
      },
    },
  },

  // ---------------------------------------------------------------------------
  // AGENT ORCHESTRATION
  // ---------------------------------------------------------------------------
  {
    type: 'function',
    group: 'Orchestration',
    function: {
      name: 'delegate_task',
      callableBy: ['llm', 'agent'],
      description: 'Delegate one bounded task to a sub-agent using a shared strict/flex contract. Fixed prompt blocks are assembled first for cache efficiency; dynamic task content goes last. For normal multi-step investigation/execution, give the worker enough room to operate: prefer maxIterations in the 6-10 range unless the task is truly trivial; avoid overly tight budgets such as 2 when tool use, file tracing, or iterative validation is expected.',
      parameters: {
        type: 'object',
        properties: {
          subAgentIdentifier:   { type: 'string', description: 'Agent name or ID.' },
          task:                 { type: 'string', description: 'Micro-task for the sub-agent. Keep it specific and execution-oriented.' },
          mode:                 { type: 'string', enum: ['strict', 'flex'], description: 'strict = structured executor; flex = looser helper/summarizer.' },
          outputMode:           { type: 'string', enum: ['json', 'text'], description: 'Desired final output mode.' },
          expectedOutputFields: { type: 'array', items: { type: 'string' }, description: 'Required JSON fields when using strict/json mode.' },
          expectedSchema:       { type: 'object', description: 'Optional schema/contract metadata for the expected output.' },
          expectedOutputDescription: { type: 'string', description: 'Human description of valid output.' },
          timeoutSeconds:       { type: 'number', description: 'Timeout for the delegated execution.' },
          maxIterations:        { type: 'number', description: 'Bounded iteration cap for multi-step workers. Prefer 6-10 for normal investigative/editing work; use lower values only for truly trivial one-shot tasks.' },
          ephemeral:            { type: 'boolean', description: 'Default true for sub-agents; avoids polluting persisted chat history.' },
          contextMode:          { type: 'string', enum: ['minimal', 'task-only', 'with-files'], description: 'Controls how much dynamic context is sent.' },
          targetEnvironment:    { type: 'string', description: 'Target environment for delegation.' },
          targetRoot:           { type: 'string', description: 'Target root path for delegation.' },
          forbiddenRoots:       { type: 'array', items: { type: 'string' }, description: 'Roots the delegated worker must avoid.' },
        },
        required: ['subAgentIdentifier', 'task'],
      },
    },
  },
  {
    type: 'function',
    group: 'Orchestration',
    function: {
      name: 'delegate_parallel',
      callableBy: ['llm', 'agent'],
      description: 'Run a bounded batch of delegate_task items in parallel using the same strict/flex contract per item. Use only for truly independent tasks. Each worker should still receive enough room to complete its task; prefer maxIterations in the 6-10 range for normal tool-using work unless the task is genuinely trivial.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: 'List of delegate_task-shaped items to execute in parallel.',
            items: {
              type: 'object',
              properties: {
                subAgentIdentifier:   { type: 'string', description: 'Agent name or ID' },
                task:                 { type: 'string', description: 'Micro-task for this worker' },
                mode:                 { type: 'string', enum: ['strict', 'flex'] },
                outputMode:           { type: 'string', enum: ['json', 'text'] },
                expectedOutputFields: { type: 'array', items: { type: 'string' }, description: 'Required JSON fields in strict/json mode' },
                expectedSchema:       { type: 'object', description: 'Optional schema/contract metadata' },
                label:                { type: 'string', description: 'Optional label to identify this result in the aggregated output' },
                timeoutSeconds:       { type: 'number', description: 'Per-task timeout' },
                maxIterations:        { type: 'number', description: 'Bounded iteration cap per task. Prefer 6-10 for normal investigative/editing work; use lower values only for truly trivial one-shot tasks.' },
                ephemeral:            { type: 'boolean', description: 'Default true for sub-agent tasks' },
                contextMode:          { type: 'string', enum: ['minimal', 'task-only', 'with-files'] },
                targetEnvironment:    { type: 'string', description: 'Target environment for delegation.' },
                targetRoot:           { type: 'string', description: 'Target root path for delegation.' },
                forbiddenRoots:       { type: 'array', items: { type: 'string' }, description: 'Roots the delegated worker must avoid.' },
              },
              required: ['subAgentIdentifier', 'task'],
            },
          },
          failFast: { type: 'boolean', description: 'If true, stop batch evaluation on first failed task.' },
          maxConcurrency: { type: 'number', description: 'Optional concurrency cap for the batch.' },
        },
        required: ['tasks'],
      },
    },
  },
  {
    type: 'function',
    group: 'Orchestration',
    function: {
      name: 'list_available_tools',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'List all available tools in the system, optionally filtered by agent or grouped by category.',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Agent ID or name to filter by allowed tools' },
          identifier: { type: 'string', description: 'Agent ID or name (alias of agentId)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    group: 'Orchestration',
    function: {
      name: 'list_agents',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'List all available agents with their capabilities.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    group: 'Orchestration',
    function: {
      name: 'get_agent_details',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Get detailed info about a specific agent including system prompt and allowed tools.',
      parameters: {
        type: 'object',
        properties: {
          agentId:    { type: 'string', description: 'Agent ID or name' },
          identifier: { type: 'string', description: 'Agent ID or name (alias of agentId)' },
        },
        required: ['agentId'],
      },
    },
  },
  {
    type: 'function',
    group: 'Orchestration',
    function: {
      name: 'create_agent',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Create a new agent dynamically.',
      parameters: {
        type: 'object',
        properties: {
          name:         { type: 'string', description: 'Agent name' },
          systemPrompt: { type: 'string', description: 'System prompt defining the agent role' },
          model:        { type: 'string', description: 'Model ID to use' },
          modelId:      { type: 'string', description: 'Model ID to use (alias of model)' },
          color:        { type: 'string', description: 'Avatar color (hex)' },
          allowedTools: { type: 'array', items: { type: 'string' }, description: 'Tool names this agent can use. Empty array means unrestricted.' },
        },
        required: ['name', 'systemPrompt'],
      },
    },
  },
  {
    type: 'function',
    group: 'Orchestration',
    function: {
      name: 'update_agent_profile',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Update an existing agent configuration including allowed tools. Pass allowedTools: [] for unrestricted access to all tools.',
      parameters: {
        type: 'object',
        properties: {
          identifier:   { type: 'string', description: 'Agent ID or name to update' },
          name:         { type: 'string', description: 'New agent name' },
          systemPrompt: { type: 'string', description: 'New system prompt' },
          modelId:      { type: 'string', description: 'Model ID to use' },
          color:        { type: 'string', description: 'Avatar color (hex)' },
          role:         { type: 'string', enum: ['master', 'worker', 'infra'], description: 'Visible agent role/category.' },
          executionMode:{ type: 'string', enum: ['strict', 'flex'], description: 'Execution contract default for this agent.' },
          tags:         { type: 'array', items: { type: 'string' }, description: 'Visible tags for filtering and diagnostics.' },
          allowedTools: { type: 'array', items: { type: 'string' }, description: 'Allowed tool names. Empty array [] = unrestricted (all tools). Omit to keep current setting.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'get_prompt_document',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Get the canonical prompt document and current version for a specific visible agent or explicit prompt document.',
      parameters: {
        type: 'object',
        properties: {
          agentId:     { type: 'string', description: 'Agent ID or name' },
          identifier:  { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          documentId:  { type: 'string', description: 'Prompt document id to read' },
          documentKey: { type: 'string', description: 'Prompt document key to read' },
          key:         { type: 'string', description: 'Prompt document key to read (alias of documentKey)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'upsert_prompt_document',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Create or update a canonical prompt document, optionally targeting a visible agent document or an explicit prompt document key/id.',
      parameters: {
        type: 'object',
        properties: {
          agentId:     { type: 'string', description: 'Agent ID or name' },
          identifier:  { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          documentId:  { type: 'string', description: 'Prompt document id to update' },
          documentKey: { type: 'string', description: 'Prompt document key to create/update' },
          key:         { type: 'string', description: 'Prompt document key to create/update (alias of documentKey)' },
          title:       { type: 'string', description: 'Prompt document title' },
          content:     { type: 'string', description: 'Prompt content; when provided on update, creates a new current version' },
          createdBy:   { type: 'string', description: 'Optional author marker for created/updated versioning' },
          metadata:    { type: 'object', description: 'Optional document/version metadata' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'get_current_prompt_version',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Get the current version for a canonical prompt document resolved by agent, explicit document reference, or global scope.',
      parameters: {
        type: 'object',
        properties: {
          agentId:     { type: 'string', description: 'Agent ID or name' },
          identifier:  { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          documentId:  { type: 'string', description: 'Prompt document id to read' },
          documentKey: { type: 'string', description: 'Prompt document key to read' },
          key:         { type: 'string', description: 'Prompt document key to read (alias of documentKey)' },
          global:      { type: 'boolean', description: 'When true, read the canonical global prompt document' },
          scope:       { type: 'string', description: 'Optional scope selector; use global for the global prompt document' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'rollback_prompt_version',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Rollback a canonical prompt document to a specific version and return the updated current version.',
      parameters: {
        type: 'object',
        properties: {
          versionId:   { type: 'string', description: 'Prompt version id to rollback to' },
          agentId:     { type: 'string', description: 'Agent ID or name' },
          identifier:  { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          documentId:  { type: 'string', description: 'Prompt document id to validate against' },
          documentKey: { type: 'string', description: 'Prompt document key to validate against' },
          key:         { type: 'string', description: 'Prompt document key to validate against (alias of documentKey)' },
          global:      { type: 'boolean', description: 'When true, use the canonical global prompt document' },
          scope:       { type: 'string', description: 'Optional scope selector; use global for the global prompt document' },
        },
        required: ['versionId'],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'list_prompt_versions',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'List canonical prompt versions for a specific visible agent.',
      parameters: {
        type: 'object',
        properties: {
          agentId:    { type: 'string', description: 'Agent ID or name' },
          identifier: { type: 'string', description: 'Agent ID or name (alias of agentId)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'resolve_prompt_preview',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Resolve a canonical prompt preview by document or visible agent using composed prompt blocks/refs. Optional content acts only as a transient preview override and is not published.',
      parameters: {
        type: 'object',
        properties: {
          agentId:    { type: 'string', description: 'Agent ID or name' },
          identifier: { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          documentId: { type: 'string', description: 'Prompt document id to preview directly' },
          documentKey:{ type: 'string', description: 'Prompt document key to preview directly' },
          key:        { type: 'string', description: 'Prompt document key to preview directly (alias of documentKey)' },
          global:     { type: 'boolean', description: 'When true, preview the canonical global prompt document' },
          scope:      { type: 'string', description: 'Optional scope selector; use global for the global prompt document' },
          agentType:  { type: 'string', description: 'Optional agent type used when resolving composition semantics' },
          content:    { type: 'string', description: 'Optional transient preview override; does not mutate stored prompt versions' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    group: 'Prompt Blocks',
    function: {
      name: 'publish_prompt_version',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Publish a new canonical prompt version as a snapshot of the resolved document composition for a visible agent or explicit prompt document. Legacy raw content may be provided only as a temporary compatibility override.',
      parameters: {
        type: 'object',
        properties: {
          agentId:    { type: 'string', description: 'Agent ID or name' },
          identifier: { type: 'string', description: 'Agent ID or name (alias of agentId)' },
          documentId: { type: 'string', description: 'Prompt document id to publish directly' },
          documentKey:{ type: 'string', description: 'Prompt document key to publish directly' },
          key:        { type: 'string', description: 'Prompt document key to publish directly (alias of documentKey)' },
          global:     { type: 'boolean', description: 'When true, publish the canonical global prompt document' },
          scope:      { type: 'string', description: 'Optional scope selector; use global for the global prompt document' },
          agentType:  { type: 'string', description: 'Optional agent type used when resolving composition semantics before publish' },
          content:    { type: 'string', description: 'Optional legacy raw content override for compatibility; prefer publishing the resolved composition snapshot' },
          createdBy:  { type: 'string', description: 'Optional author marker for the published version' },
          metadata:   { type: 'object', description: 'Optional metadata stored with the published version' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    group: 'Orchestration',
    function: {
      name: 'delete_agent',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Delete an existing visible agent by id or name.',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string', description: 'Agent ID or name to delete' },
          agentId:    { type: 'string', description: 'Agent ID or name to delete (alias of identifier)' },
          name:       { type: 'string', description: 'Agent ID or name to delete (fallback alias)' },
        },
        required: ['identifier'],
      },
    },
  },

  // ---------------------------------------------------------------------------
  // CONFIG & SYSTEM
  // ---------------------------------------------------------------------------
  {
    type: 'function',
    group: 'Config & System',
    function: {
      name: 'manage_workflow',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Create, list, run, rename, or delete workflows. Workflows are automated pipelines with nodes (trigger, agent, llm, http, delay, alert, condition, loop, code, subworkflow, transform) connected by edges.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'create', 'run', 'remove', 'rename'],
            description: 'Action to perform: list (list all), create (new workflow), remove (delete), rename (change name), run (execute manually). Note: use "remove" not "delete".'
          },
          workflow: {
            type: 'object',
            description: 'Complete workflow definition. Required fields: name (string), nodes (array). Optional: description (string), status ("active"|"paused", default: "active"), schedule (object).',
            properties: {
              id:          { type: 'string', description: 'Workflow ID (auto-generated UUID if omitted)' },
              name:        { type: 'string', description: 'Workflow name (required for create)' },
              description: { type: 'string', description: 'Description of what the workflow does' },
              agentId:     { type: 'string', description: 'Agent ID that will execute agent nodes (usually "default")' },
              status:      { type: 'string', enum: ['active', 'paused'], description: 'Workflow status (default: "active")' },
              nodes: {
                type: 'array',
                description: 'Array of workflow nodes. Each node: { id: string, type: string, label: string, config: object, position?: {x:number,y:number} }. Node types: trigger, agent, llm, http, delay, alert, condition, loop, code, subworkflow, transform.',
                items: {
                  type: 'object',
                  properties: {
                    id:       { type: 'string', description: 'Unique node ID (e.g. "node-1")' },
                    type:     { type: 'string', enum: ['trigger', 'agent', 'llm', 'http', 'delay', 'alert', 'condition', 'loop', 'code', 'subworkflow', 'transform'], description: 'Node type' },
                    label:    { type: 'string', description: 'Display label for the node' },
                    config:   { type: 'object', description: 'Node-specific configuration. Structure depends on type.' },
                    position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, description: 'Optional position on canvas' }
                  },
                  required: ['id', 'type', 'label']
                }
              },
              edges: {
                type: 'array',
                description: 'Array of edges connecting nodes. Each edge: { id: string, source: string, target: string, sourceHandle?: string, targetHandle?: string }',
                items: {
                  type: 'object',
                  properties: {
                    id:           { type: 'string', description: 'Unique edge ID' },
                    source:       { type: 'string', description: 'Source node ID' },
                    target:       { type: 'string', description: 'Target node ID' },
                    sourceHandle: { type: 'string', description: 'Optional source handle (for multi-output nodes)' },
                    targetHandle: { type: 'string', description: 'Optional target handle (for multi-input nodes)' }
                  },
                  required: ['id', 'source', 'target']
                }
              },
              schedule: {
                type: 'object',
                description: 'Schedule configuration for automatic execution (optional)',
                properties: {
                  enabled: { type: 'boolean', description: 'Whether schedule is enabled' },
                  type:    { type: 'string', enum: ['once', 'daily', 'weekly'], description: 'Schedule type' },
                  time:    { type: 'string', description: 'Time in HH:MM format' },
                  days:    { type: 'array', items: { type: 'number' }, description: 'Days of week (0=Sun, 1=Mon, ..., 6=Sat) — used for weekly schedule' }
                }
              }
            }
          },
          workflowId: { type: 'string', description: 'Workflow ID or name to identify the workflow (for remove/rename)' },
          name:       { type: 'string', description: 'New name for the workflow (for action=rename)' },
          id:         { type: 'string', description: 'Workflow ID to run manually (for action=run)' },
          observabilityMode: { type: 'string', enum: ['default', 'audit'], description: 'Applies when action="run" to control observability/audit persistence.' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    group: 'Config & System',
    function: {
      name: 'manage_model',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'List or configure LLM models.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'add', 'update', 'delete'] },
          model:  { type: 'object', description: 'Model configuration (for add/update)' },
          id:     { type: 'string', description: 'Model ID (for update/delete)' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    group: 'Config & System',
    function: {
      name: 'manage_variable',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Manage environment variables.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'set', 'delete'] },
          key:    { type: 'string', description: 'Variable name' },
          value:  { type: 'string', description: 'Variable value (for set)' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    group: 'Config & System',
    function: {
      name: 'get_secret',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Retrieve a stored secret by key.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Secret key name' },
        },
        required: ['key'],
      },
    },
  },

  // ---------------------------------------------------------------------------
  // JIRA INTEGRATION
  // ---------------------------------------------------------------------------
  {
    type: 'function',
    group: 'Jira',
    function: {
      name: 'jira_queue',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Fetch Jira issues via JQL and return structured issue data. Usage flow: jql fetches from Jira and persists a snapshot; snapshotKey + analytics, snapshotKey + discover, or snapshotKey + exportRaw reads/projects persisted snapshot data. analytics.select must be an array of objects with a non-empty path and optional as; simple strings are invalid. Auth is resolved automatically from server-side stored secrets (JIRA_KEY/JIRA_TOKEN), falling back to x-jira-token header or JIRA_TOKEN env var.',
      parameters: {
        type: 'object',
        properties: {
          jql: {
            type: 'string',
            description: 'JQL query string to filter issues (e.g. "project = MYPROJ AND status = Open"). If sent together with snapshotKey, jql takes precedence and triggers a new fetch.',
          },
          snapshotKey: {
            type: 'string',
            description: 'Optional persisted snapshot key used for discover/analytics flows. Ignored when jql is provided.',
          },
          listSnapshots: {
            oneOf: [
              { type: 'boolean' },
              {
                type: 'object',
                description: 'Optional list snapshots options. Supports filters/paging such as limit, offset, includeStats, search, sortBy and order.',
              },
            ],
            description: 'Optional flag or options object to list available persisted Jira queue snapshots.',
          },
          deleteSnapshot: {
            type: 'object',
            description: 'Optional delete options object for the persisted snapshot identified by snapshotKey. Supports flags such as dryRun.',
          },
          summary: {
            type: 'object',
            description: 'Optional fetch-only summary spec executed after persistence. Supports select, filters, groupBy, sort and top. If it fails, fetch still succeeds without summary.',
          },
          discover: {
            type: 'object',
            description: 'Optional discovery spec against a persisted snapshot identified by snapshotKey. Supports include, exclude, maxDepth, types, sampleIssues, maxPaths and includeSamples.',
          },
          exportRaw: {
            oneOf: [
              { type: 'boolean' },
              {
                type: 'object',
                description: 'Optional raw snapshot export options. Supports paging via limit and offset.',
              },
            ],
            description: 'Optional flag or options object to return persisted raw snapshot rows for the given snapshotKey, with minimal snapshot metadata and record paging.',
          },
          analytics: {
            type: 'object',
            description: 'Optional analytics query executed against payload_json from a persisted snapshot identified by snapshotKey. Supports select, filters, groupBy, sort and top.',
          },
          fields: {
            type: 'string',
            description: 'Comma-separated list of Jira field names to include. Omit for default set (summary, status, priority, assignee, description, labels, etc.)',
          },
          includeComments: {
            type: 'boolean',
            description: 'Whether to fetch full comment threads per issue. Blocked if total issues > 200.',
          },
          compact: {
            type: 'boolean',
            description: 'Return a compact subset of fields (key, summary, status, priority, issuetype, storyPoints, assignee, comments, commentCount).',
          },
          preserveRequestedFields: {
            type: 'boolean',
            description: 'When true, add extraFields per issue with requested Jira fields that exist in issue.fields, excluding already normalized/base fields and comment.',
          },
          fieldAliases: {
            type: 'object',
            description: 'Optional map of requested Jira field ids/names to output aliases applied inside extraFields.',
            additionalProperties: { type: 'string' },
          },
        },

      },
    },
  },
  {
    type: 'function',
    group: 'Jira',
    function: {
      name: 'jira_action',
      callableBy: ['workflow', 'llm', 'agent'],
      description: 'Execute a Jira write operation. Supported actions: comment, update_fields, transition, add_label, create_issue, delete_issue. Auth is resolved automatically from server-side stored secrets. create_issue supports dual mode: generic Jira issue creation via fields, or Jira Service Management request creation via serviceDeskId + requestTypeId + requestFieldValues, with optional postUpdateFields. For action=transition, send a single args object containing issueKey OR issueId, transitionId, and optional fields in the same payload; shape: { action: "transition", issueKey?: "PROJ-123" | issueId?: "10001", transitionId: "31", fields?: { ... } }. For action=comment, commentBody is structured Atlassian Document Format (ADF) and is the preferred path for rich comments and real Jira mentions. To create a real Jira mention, put it in commentBody, not text; expected mention shape is doc -> paragraph -> mention, with mention.attrs.id = accountId and mention.attrs.text = visible @Name. Pseudo-mentions written in text such as [~accountid:...] are plain text only and are not reliable rich mentions. Keep text for backward-compatible simple comments.',      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['comment', 'update_fields', 'transition', 'add_label', 'create_issue', 'delete_issue'],
            description: 'The write operation to perform.',
          },
          issueKey: {
            type: 'string',
            description: '[comment|update_fields|add_label] Jira issue key (e.g. "PROJ-123"). Required for comment, update_fields, and add_label.',
          },
          issueId: {
            type: 'string',
            description: '[transition|delete_issue] Jira issue numeric ID. Use for transition when issueKey is not sufficient, or for delete_issue when issueKey is unavailable.',
          },
          text: {
            type: 'string',
            description: '[comment] Plain text body of the comment to add. Kept for backward compatibility.',
          },
          commentBody: {
            type: 'object',
            description: '[comment] Structured Jira comment body in Atlassian Document Format (ADF). Use this for rich/structured comments; text remains supported for backward compatibility.',
          },
          fields: {
            type: 'object',
            description: '[create_issue|fields mode|transition] Generic Jira issue fields payload. Use this for standard Jira issue creation, or include required fields together with a Jira transition when the target transition demands them.',
          },
          serviceDeskId: {
            type: 'string',
            description: '[create_issue|JSM mode] Jira Service Management service desk ID for request creation.',
          },
          requestTypeId: {
            type: 'string',
            description: '[create_issue|JSM mode] Jira Service Management request type ID for request creation.',
          },
          requestFieldValues: {
            type: 'object',
            description: '[create_issue|JSM mode] Jira Service Management request field values payload for request creation.',
          },
          postUpdateFields: {
            type: 'object',
            description: '[create_issue] Optional follow-up field updates applied after issue/request creation.',
          },
          transitionId: {
            type: 'string',
            description: '[transition] The Jira transition ID to apply.',
          },
          label: {
            type: 'string',
            description: '[add_label] Label string to add to the issue.',
          },
        },
        required: ['action'],
      },
    },
  },
];

// =============================================================================
// buildToolWeightInstructions — injeta preferências de tools no system prompt
// =============================================================================
export function buildToolWeightInstructions(allowedTools = []) {
  const weightedTools = SYSTEM_TOOLS.filter((t) => {
    const w = t.weight;
    if (w === undefined || w >= 1) return false;
    const name = t.function?.name;
    if (!name) return false;
    if (allowedTools.length > 0 && !allowedTools.includes(name)) return false;
    return true;
  });

  if (weightedTools.length === 0) return '';

  const lines = weightedTools.map((t) => {
    const name = t.function.name;
    const w = t.weight;
    if (w <= 0.2) return `- \`${name}\`: use ONLY as last resort when no specific tool can accomplish the task`;
    if (w <= 0.5) return `- \`${name}\`: prefer specific tools over this; use only when no targeted tool is available`;
    return `- \`${name}\`: consider specific tools first before using this`;
  });

  return `\n## Tool Usage Preferences\nThe following tools are general-purpose and should be avoided when a more specific tool exists:\n${lines.join('\n')}\nAlways check if a dedicated tool (read_file, write_file, git_*, lint_code, etc.) can accomplish the task before falling back to these.`;
}

export function buildToolsForAgent(agent) {
    if (!agent) return SYSTEM_TOOLS; // no agent = unrestricted
    const allowed = Array.isArray(agent.allowedTools) ? agent.allowedTools : null;
    // Empty or omitted allowedTools = unrestricted (all tools)
    if (!allowed || allowed.length === 0) return SYSTEM_TOOLS;
    // Respect explicit allow-lists for every agent, including master agents
    return SYSTEM_TOOLS.filter(t => allowed.includes(t.function.name));
}
