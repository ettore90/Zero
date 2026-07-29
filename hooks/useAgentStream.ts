// =============================================================================
// useAgentStream.ts — Fase 4 do Daemon Mode
// Conecta ao SSE broker do servidor e recebe eventos do agente em tempo real.
// Permite que o browser veja o que o agente está fazendo mesmo após reconectar.
// =============================================================================

import { useEffect, useRef, useCallback } from 'react';
import { APP_BASE_PATH } from '../constants';

const LOCAL_BASE = (window.location.pathname.split('/').slice(0, 2).join('/') || APP_BASE_PATH || '').replace(/\/$/, '');

export type AgentStreamEvent =
    | { type: 'chunk';            agentId: string; content: string }
    | { type: 'tool_call';        agentId: string; toolName: string; args: any; tool_call_id: string }
    | { type: 'tool_result';      agentId: string; toolName: string; output: any; tool_call_id: string }
    | { type: 'agent_start';      agentId: string; agentName: string; model: string }
    | { type: 'agent_done';       agentId: string; agentName: string; durationMs: number; iterations: number }
    | { type: 'approval_required'; agentId: string; requestId: string; title: string; objective: string; approach: string; risks?: string; checklist?: string[] }
    | { type: 'approval:decision'; agentId?: string | null; requestId: string; sessionId?: string | null; approved: boolean; payload?: any; plan?: any; status: string }
    | { type: 'write_file_dry_run'; agentId: string; requestId: string; tool_call_id: string; path: string; originalContent: string; proposedContent: string }
    | { type: 'alerts';           alerts: Alert[] }
    | { type: 'delegate_status';  masterAgentId: string; subAgentId: string; subAgentName?: string; status: string; detail?: any; taskPreview?: string }
    | { type: 'memory_metrics';   agentId: string; phase: string; timestamp: number; [key: string]: any }
    | { type: 'memory_injection'; agentId: string; memories: any[]; timestamp: number }
    | { type: 'error';            agentId?: string; message: string };

export interface Alert {
    id: string;
    title: string;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
    timestamp: number;
    read: boolean;
    agentId?: string;
}

interface UseAgentStreamOptions {
    username: string;
    enabled?: boolean;
    onEvent?: (event: AgentStreamEvent) => void;
    onApprovalRequired?: (data: Extract<AgentStreamEvent, { type: 'approval_required' }>) => void;
    onAlert?: (alerts: Alert[]) => void;
    onReconnect?: () => void; // chamado quando SSE reconecta — usar para pull do estado do servidor
}

export function useAgentStream({
    username,
    enabled = true,
    onEvent,
    onApprovalRequired,
    onAlert,
    onReconnect,
}: UseAgentStreamOptions) {
    const esRef = useRef<EventSource | null>(null);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectDelay = useRef(1000);

    // Usar refs para callbacks — evita recriar EventSource a cada render
    const onEventRef = useRef(onEvent);
    const onApprovalRef = useRef(onApprovalRequired);
    const onAlertRef = useRef(onAlert);
    const onReconnectRef = useRef(onReconnect);
    useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);
    useEffect(() => { onApprovalRef.current = onApprovalRequired; }, [onApprovalRequired]);
    useEffect(() => { onAlertRef.current = onAlert; }, [onAlert]);
    useEffect(() => { onReconnectRef.current = onReconnect; }, [onReconnect]);

    const connect = useCallback(() => {
        if (!username || !enabled) return;

        const url = `${LOCAL_BASE}/api/stream?username=${encodeURIComponent(username)}`;
        const es = new EventSource(url);
        esRef.current = es;

        const handleEvent = (eventType: string, rawData: string) => {
            try {
                const data = JSON.parse(rawData);
                const event = { type: eventType, ...data } as AgentStreamEvent;

                onEventRef.current?.(event);

                if (eventType === 'approval_required') {
                    onApprovalRef.current?.(event as any);
                }
                if (eventType === 'alerts') {
                    onAlertRef.current?.(data.alerts);
                }
            } catch {}
        };

        // Registrar handlers para cada tipo de evento
        const eventTypes = ['chunk', 'tool_call', 'tool_result', 'agent_start', 'agent_done',
                           'approval_required', 'approval:decision', 'write_file_dry_run', 'alerts', 'error', 'tool_ui_required',
                           'session_updated', 'llm_request', 'llm_response', 'delegate_status', 'memory_metrics', 'memory_injection'];

        for (const type of eventTypes) {
            es.addEventListener(type, (e: MessageEvent) => handleEvent(type, e.data));
        }

        es.onopen = () => {
            console.log('[AgentStream] Connected');
            reconnectDelay.current = 1000;
            // Pull on reconnect — buscar estado atual do servidor
            // Cobre o caso de iOS/iPadOS suspender a aba e perder eventos SSE
            onReconnectRef.current?.();
        };

        es.onerror = () => {
            es.close();
            esRef.current = null;
            // Reconectar com backoff exponencial (max 30s)
            const delay = Math.min(reconnectDelay.current, 30000);
            reconnectDelay.current = Math.min(delay * 2, 30000);
            console.log(`[AgentStream] Disconnected — reconnecting in ${delay}ms`);
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
            reconnectTimer.current = setTimeout(connect, delay);
        };
    }, [username, enabled]);

    useEffect(() => {
        connect();
        return () => {
            esRef.current?.close();
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        };
    }, [connect]);

    // Responder a um request_plan_approval
    const respondToApproval = useCallback(async (requestId: string, approved: boolean, payload?: any) => {
        await fetch(`${LOCAL_BASE}/api/approval/respond`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId, approved, username, payload }),
        });
    }, [username]);

    // Marcar alertas como lidos
    const markAlertsRead = useCallback(async (ids?: string[]) => {
        await fetch(`${LOCAL_BASE}/api/alerts/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, ids }),
        });
    }, [username]);

    return { respondToApproval, markAlertsRead };
}
