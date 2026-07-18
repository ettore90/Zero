// =============================================================================
// useSessionManager.ts — Gerenciamento de sessões de chat por agente
// =============================================================================

import { useCallback } from 'react';
import type { Agent } from '../types';
import { generateId } from '../utils/helpers';
import * as ServerChat from '../services/serverChatService';
import * as localApiService from '../services/localApiService';
const { fetchAgents, localPut } = localApiService as any;

interface UseSessionManagerOptions {
    username: string;
    agents: Agent[];
    setPersistedAgents: (agents: Agent[] | ((prev: Agent[]) => Agent[])) => void;
    setActiveAgentId: (id: string) => void;
    setViewMode: (mode: 'chat' | 'automation' | 'commands' | 'dashboard' | 'memory') => void;
    setIsChatVisible: (v: boolean) => void;
}

const syncAgentsFromServer = async (username: string, setPersistedAgents: (agents: Agent[] | ((prev: Agent[]) => Agent[])) => void): Promise<Agent[] | null> => {
    const freshAgents = await fetchAgents(username);
    if (!freshAgents) return null;
    setPersistedAgents(freshAgents as Agent[]);
    return freshAgents as Agent[];
};

const persistActiveSession = async (
    username: string,
    agentId: string,
    activeSessionId?: string
): Promise<void> => {
    const payload: Record<string, any> = { username };

    if (activeSessionId !== undefined) {
        payload.activeSessionId = activeSessionId;
    }

    await localPut(`/api/agents/${encodeURIComponent(agentId)}/sessions`, payload);
};

export const useSessionManager = ({
    username,
    agents,
    setPersistedAgents,
    setActiveAgentId,
    setViewMode,
    setIsChatVisible,
}: UseSessionManagerOptions) => {

    const handleNewSession = useCallback(async (agentId: string) => {
        const newSessionId = generateId();
        await ServerChat.createSession(username, agentId, newSessionId, 'New Session');
        await persistActiveSession(username, agentId, newSessionId);
        await syncAgentsFromServer(username, setPersistedAgents);
        setActiveAgentId(agentId);
        setViewMode('chat');
        setIsChatVisible(true);
    }, [username, setPersistedAgents, setActiveAgentId, setViewMode, setIsChatVisible]);

    const handleSelectSession = useCallback(async (agentId: string, sessionId: string) => {
        await persistActiveSession(username, agentId, sessionId);
        await syncAgentsFromServer(username, setPersistedAgents);
        setActiveAgentId(agentId);
        setViewMode('chat');
        setIsChatVisible(true);
    }, [username, setPersistedAgents, setActiveAgentId, setViewMode, setIsChatVisible]);

    const handleRenameSession = useCallback(async (agentId: string, sessionId: string, title: string) => {
        await ServerChat.renameSession(sessionId, username, agentId, title);
        await syncAgentsFromServer(username, setPersistedAgents);
    }, [username, setPersistedAgents]);

    const handleDeleteSession = useCallback(async (agentId: string, sessionId: string) => {
        const agent = agents.find(item => item.id === agentId);
        if (!agent) return;

        await ServerChat.deleteSession(sessionId, username);

        const refreshedSessions = await ServerChat.listSessions(username, agentId);
        let nextActiveSessionId = agent.activeSessionId;

        if (agent.activeSessionId === sessionId) {
            if (refreshedSessions.length > 0) {
                nextActiveSessionId = refreshedSessions[0].id;
            } else {
                nextActiveSessionId = generateId();
                await ServerChat.createSession(username, agentId, nextActiveSessionId, 'New Session');
            }
        }

        await persistActiveSession(username, agentId, nextActiveSessionId);
        await syncAgentsFromServer(username, setPersistedAgents);
        setActiveAgentId(agentId);
        setViewMode('chat');
        setIsChatVisible(true);
    }, [username, agents, setPersistedAgents, setActiveAgentId, setViewMode, setIsChatVisible]);

    return {
        handleNewSession,
        handleSelectSession,
        handleRenameSession,
        handleDeleteSession,
    };
};
