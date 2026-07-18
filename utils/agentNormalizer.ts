// =============================================================================
// agentNormalizer.ts — Normalização de agentes ao carregar do servidor
// Garante timestamps, sessions default, deduplicação e histórico ativo
// =============================================================================

import { Agent } from '../types';
import { DEFAULT_AGENT, MEMORY_MAINTENANCE_AGENT, SUMMARY_AGENT } from '../constants';

const LOCAL_BASE = window.location.pathname.split('/').slice(0, 2).join('/') || '';

/**
 * Garante que o agente e suas sessions têm lastModified numérico.
 */
export function ensureLastModified(agent: Agent): Agent {
    const result = { ...agent };
    if (typeof result.lastModified !== 'number') {
        result.lastModified = Date.now();
    }
    if (result.sessions) {
        result.sessions = result.sessions.map(sess => {
            if (typeof sess.lastModified !== 'number') {
                return { ...sess, lastModified: Date.now() };
            }
            return sess;
        });
    }
    return result;
}

/**
 * Normaliza um agente sem promover sessions a estado canônico.
 * Apenas corrige campos auxiliares e preserva sessions como compatibilidade opcional.
 */
export function normalizeAgent(agent: Agent): Agent {
    const sessions = Array.isArray(agent.sessions) ? agent.sessions : [];

    if (typeof agent.lastModified !== 'number') {
        agent = { ...agent, lastModified: Date.now() };
    }

    if (!Array.isArray(agent.history)) {
        agent = { ...agent, history: [] };
    }

    if (!Array.isArray(agent.sessions)) {
        agent = { ...agent, sessions };
    }

    return agent;
}

/**
 * Normaliza lista de agentes: aplica ensureLastModified + normalizeAgent,
 * deduplica por id e garante que existe um agente master.
 */
export function normalizeAgents(agents: Agent[]): Agent[] {
    const normalized = agents.map(ensureLastModified).map(normalizeAgent);

    // Deduplicar por id
    const agentMap = new Map<string, Agent>();
    normalized.forEach(a => agentMap.set(a.id, a));

    // Garantir agente master
    const hasMaster = Array.from(agentMap.values()).some(a => a.isMaster);
    if (!hasMaster) {
        if (agentMap.has(DEFAULT_AGENT.id)) {
            const existing = agentMap.get(DEFAULT_AGENT.id)!;
            agentMap.set(DEFAULT_AGENT.id, { ...existing, isMaster: true });
        } else {
            agentMap.set(DEFAULT_AGENT.id, DEFAULT_AGENT);
        }
    }

    // Garantir agente default de manutenção de memória
    if (!agentMap.has(MEMORY_MAINTENANCE_AGENT.id)) {
        agentMap.set(MEMORY_MAINTENANCE_AGENT.id, {
            ...MEMORY_MAINTENANCE_AGENT,
            summary: '',
            history: [],
            sessions: [],
            activeSessionId: 'default',
            lastModified: Date.now(),
        });
    }

    // Garantir agente default de resumo de histórico
    if (!agentMap.has(SUMMARY_AGENT.id)) {
        agentMap.set(SUMMARY_AGENT.id, {
            ...SUMMARY_AGENT,
            summary: '',
            history: [],
            sessions: [],
            activeSessionId: 'default',
            lastModified: Date.now(),
        });
    }

    return Array.from(agentMap.values());
}

/**
 * Carrega o histórico real da sessão ativa via API canônica de sessões.
 */
export async function loadSessionHistories(agents: Agent[], username: string): Promise<Agent[]> {
    return Promise.all(
        agents.map(async (agent: Agent) => {
            const sessionId = agent.activeSessionId;
            const isValid = Boolean(sessionId && sessionId !== 'default' && sessionId.length > 8);
            if (!isValid) return agent;
            try {
                const res = await fetch(
                    `${LOCAL_BASE}/api/sessions/${encodeURIComponent(sessionId)}?username=${encodeURIComponent(username)}`
                );
                if (!res.ok) return { ...agent, activeSessionId: '', history: [] };
                const { session } = await res.json();
                if (Array.isArray(session?.messages)) {
                    return { ...agent, history: session.messages };
                }
            } catch {}
            return agent;
        })
    );
}
