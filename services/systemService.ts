import { NEBULA_API_BASE } from '../constants';

const headers = { 'Content-Type': 'application/json' };

// agentId é opcional — quando não fornecido usa 'terminal' como ID fixo
// (usado pelo Terminal.tsx que é interface humana, não agente)

export const runCommand = async (command: string, agentId = 'terminal') => {
    const res = await fetch(`${NEBULA_API_BASE}/system/exec`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ command, agentId })
    });
    return await res.json();
};

export const runPython = async (code: string, agentId = 'terminal') => {
    const res = await fetch(`${NEBULA_API_BASE}/system/python`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ code, agentId })
    });
    return await res.json();
};

export const readFile = async (path: string, agentId = 'terminal') => {
    const res = await fetch(`${NEBULA_API_BASE}/system/fs/read`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ path, agentId })
    });
    return await res.json();
};

export const writeFile = async (path: string, content: string, agentId = 'terminal') => {
    const res = await fetch(`${NEBULA_API_BASE}/system/fs/write`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ path, content, agentId })
    });
    return await res.json();
};

export const listDirectory = async (path?: string, agentId = 'terminal') => {
    const res = await fetch(`${NEBULA_API_BASE}/system/fs/list`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ path, agentId })
    });
    return await res.json();
};

export const findFiles = async (pattern: string, cwd?: string, maxDepth?: number) => {
    const res = await fetch(`${NEBULA_API_BASE}/system/fs/find`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ pattern, cwd, maxDepth })
    });
    return await res.json();
};

export const patchFile = async (path: string, oldStr: string, newStr: string) => {
    const res = await fetch(`${NEBULA_API_BASE}/system/fs/patch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ path, oldStr, newStr })
    });
    return await res.json();
};
