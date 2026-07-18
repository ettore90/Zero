// =============================================================================
// systemTools.ts — handlers de tools de sistema/arquivos
// =============================================================================

import * as SystemService from '../../services/systemService';
import { canvasBus, canvasContentBridge } from '../useCanvasState';
import { NEBULA_API_BASE } from '../../constants';

const runCommandWithOptions = async (
    command: string,
    agentId: string,
    options: { timeout?: number; env?: Record<string, string>; cwd?: string }
) => {
    const res = await fetch(`${NEBULA_API_BASE}/system/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, agentId, ...options }),
    });
    return res.json();
};

export async function handleSystemTool(
    toolName: string,
    args: Record<string, any>,
    toolId: string,
    agentId: string,
    deps: {
        executeWithRetry: (toolName: string, args: Record<string, any>, executor: () => Promise<any>, agentId: string) => Promise<any>;
        onTerminalOutput?: (output: string, agentId: string) => void;
        onWriteFileDryRun?: (path: string, originalContent: string, proposedContent: string, agentId: string, toolCallId: string) => Promise<boolean>;
        getLiveContent?: (path: string) => string | null;
    }
): Promise<any> {
    const { executeWithRetry, onTerminalOutput, onWriteFileDryRun, getLiveContent } = deps;

    if (toolName === 'run_terminal_command') {
        const INTERACTIVE_CMDS = /^\s*(vi|vim|nano|emacs|less|more|top|htop|watch|read\s|ssh\s|ftp\s|telnet\s|mysql\s+(-u|-p)|psql\s)/;
        let output: any;
        if (INTERACTIVE_CMDS.test(args.command)) {
            output = { error: `Command "${args.command.split(' ')[0]}" is interactive and cannot be run as a tool call. Use a non-interactive alternative.`, exitCode: -1 };
        } else {
            const execOptions = {
                ...(args.timeout ? { timeout: args.timeout } : {}),
                ...(args.env ? { env: args.env } : {}),
                ...(args.cwd ? { cwd: args.cwd } : {}),
            };
            output = await executeWithRetry(toolName, args, () =>
                Object.keys(execOptions).length > 0
                    ? runCommandWithOptions(args.command, agentId, execOptions)
                    : SystemService.runCommand(args.command, agentId),
                agentId
            );
        }
        if (onTerminalOutput) {
            const outStr = typeof output === 'object'
                ? ((output as any).output || (output as any).error || JSON.stringify(output))
                : String(output);
            if (outStr) onTerminalOutput(`0m[agent: ${agentId}] ${args.command}\n${outStr}`, agentId);
        }
        return output;
    }

    if (toolName === 'run_python_code') {
        return executeWithRetry(toolName, args, () => SystemService.runPython(args.code, agentId), agentId);
    }

    if (toolName === 'read_file') {
        const liveContent = canvasContentBridge.getLiveContent(args.path)
            ?? (getLiveContent ? getLiveContent(args.path) : null);
        let rawOutput: any = liveContent !== null
            ? { content: liveContent, source: 'canvas_editor', path: args.path }
            : await SystemService.readFile(args.path, agentId);

        if (args.start_line !== undefined || args.end_line !== undefined) {
            const fullText = typeof rawOutput === 'object' ? (rawOutput as any)?.content ?? '' : String(rawOutput);
            const lines = fullText.split('\n');
            const total = lines.length;
            const start = Math.max(0, (Number(args.start_line) || 1) - 1);
            const end = Math.min(total, Number(args.end_line) || total);
            const sliced = lines.slice(start, end).join('\n');
            rawOutput = {
                content: sliced,
                path: args.path,
                start_line: start + 1,
                end_line: end,
                total_lines: total,
                partial: true,
            };
        }

        try {
            const fileContent = typeof rawOutput === 'object'
                ? (rawOutput as any)?.content ?? JSON.stringify(rawOutput)
                : String(rawOutput);
            canvasBus.emit({ type: 'file:open', payload: { path: args.path, content: fileContent, agentId } });
        } catch {}
        return rawOutput;
    }

    if (toolName === 'write_file') {
        let originalContent = '';
        try {
            const existing = await SystemService.readFile(args.path, agentId).catch(() => null);
            originalContent = existing
                ? (typeof existing === 'object' ? (existing as any)?.content ?? '' : String(existing))
                : '';
        } catch {}

        if (onWriteFileDryRun) {
            const approved = await onWriteFileDryRun(args.path, originalContent, args.content, agentId, toolId);
            if (!approved) {
                return { skipped: true, reason: 'User cancelled write operation in dry-run review.' };
            }
            const output = await executeWithRetry(toolName, args, () => SystemService.writeFile(args.path, args.content, agentId), agentId);
            try { canvasBus.emit({ type: 'file:open', payload: { path: args.path, content: args.content, agentId } }); } catch {}
            return output;
        }

        try {
            canvasBus.emit({ type: 'file:diff', payload: { path: args.path, original: originalContent, proposed: args.content, agentId } });
        } catch {}
        return executeWithRetry(toolName, args, () => SystemService.writeFile(args.path, args.content, agentId), agentId);
    }

    if (toolName === 'replace_in_file') {
        const replaceRes = await fetch(`${NEBULA_API_BASE}/system/fs/patch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: args.path,
                old_str: args.old_str,
                new_str: args.new_str,
                replace_all: args.replace_all ?? false,
                agentId,
            }),
        });
        const output = await replaceRes.json();
        if (output && !(output as any).error) {
            try {
                const updated = await SystemService.readFile(args.path, agentId);
                const updatedContent = typeof updated === 'object' ? (updated as any)?.content ?? '' : String(updated);
                canvasBus.emit({ type: 'file:open', payload: { path: args.path, content: updatedContent, agentId } });
            } catch {}
        }
        return output;
    }

    if (toolName === 'list_directory') {
        return SystemService.listDirectory(args.path, agentId);
    }

    if (toolName === 'find_files') {
        const findRes = await fetch(`${NEBULA_API_BASE}/system/fs/find`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: args.path || args.cwd || undefined,
                pattern: args.pattern || '*',
                type: args.type || '',
                max_depth: args.max_depth || undefined,
                exclude: args.exclude || [],
                relative: args.relative ?? false,
                agentId,
            }),
        });
        return findRes.json();
    }

    if (toolName === 'read_project_json') {
        const raw = await SystemService.readFile(args.path, agentId);
        const text = typeof raw === 'object' ? (raw as any)?.content ?? JSON.stringify(raw) : String(raw);
        try { return JSON.parse(text); }
        catch { return { error: 'Failed to parse JSON', raw: text.slice(0, 500) }; }
    }

    if (toolName === 'run_tests') {
        const cwd = args.cwd || '.';
        const cmd = args.command || 'npm test -- --watchAll=false 2>&1 || yarn test --watchAll=false 2>&1';
        return SystemService.runCommand(`cd "${cwd}" && ${cmd}`, agentId);
    }

    if (toolName === 'lint_code') {
        const cwd = args.cwd || '.';
        const files = args.files ? args.files.join('\n') : '.';
        const cmd = `cd "${cwd}" && (npx eslint ${files} --max-warnings=0 2>&1 || echo "eslint not found") && (npx tsc --noEmit 2>&1 || echo "tsc not found")`;
        return SystemService.runCommand(cmd, agentId);
    }

    if (toolName === 'format_code') {
        const cwd = args.cwd || '.';
        const files = args.files ? args.files.join('\n') : '.';
        const checkOnly = args.check === true;
        const flag = checkOnly ? '--check' : '--write';
        const cmd = `cd "${cwd}" && npx prettier ${flag} ${files} 2>&1`;
        return SystemService.runCommand(cmd, agentId);
    }

    return null;
}
