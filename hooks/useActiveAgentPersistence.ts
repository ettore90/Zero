import { useEffect, useRef } from 'react';
import { Agent } from '../types';
import { ACTIVE_AGENT_STORAGE_KEY, LEGACY_ACTIVE_AGENT_STORAGE_KEYS } from '../constants';

export const useActiveAgentPersistence = (
  agents: Agent[],
  viewMode: string,
  activeAgentId: string,
  setActiveAgentId: (id: string) => void
) => {
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    if (viewMode !== 'chat' || agents.length === 0) return;

    const activeAgentStillExists = !!activeAgentId && agents.some(a => a.id === activeAgentId);
    if (activeAgentStillExists) {
      hasHydratedRef.current = true;
      return;
    }

    const lastActive = localStorage.getItem(ACTIVE_AGENT_STORAGE_KEY)
      ?? LEGACY_ACTIVE_AGENT_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find((value) => value);
    const nextActiveId = lastActive && agents.some(a => a.id === lastActive)
      ? lastActive
      : (agents.find(a => a.isMaster)?.id || agents[0]?.id || '');

    if (!nextActiveId) return;
    if (!hasHydratedRef.current || !activeAgentStillExists) {
      hasHydratedRef.current = true;
      setActiveAgentId(nextActiveId);
    }
  }, [agents, viewMode, activeAgentId, setActiveAgentId]);

  useEffect(() => {
    if (activeAgentId) {
      localStorage.setItem(ACTIVE_AGENT_STORAGE_KEY, activeAgentId);
    }
  }, [activeAgentId]);
};
