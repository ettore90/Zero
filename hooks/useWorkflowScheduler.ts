// =============================================================================
// useWorkflowScheduler.ts — Scheduler de workflows (intervalo 60s)
// e handler de execução manual/automática
// =============================================================================

import { useEffect, useCallback, MutableRefObject } from 'react';
import { Workflow, Agent, ModelConfig, LogEntry } from '../types';
import * as WorkflowEngine from '../services/workflowEngine';
import { calculateNextRun } from '../utils/helpers';

interface UseWorkflowSchedulerOptions {
    workflowsRef: MutableRefObject<Workflow[]>;
    agents: Agent[];
    modelConfigs: ModelConfig[];
    timezone?: string;
    setWorkflows: (wf: Workflow[]) => void;
    saveField: (field: string, value: any) => Promise<void>;
    addLog: (entry: LogEntry) => void;
    addNotification: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const useWorkflowScheduler = ({
    workflowsRef,
    agents,
    modelConfigs,
    timezone,
    setWorkflows,
    saveField,
    addLog,
    addNotification,
}: UseWorkflowSchedulerOptions) => {

    const handleRunWorkflow = useCallback(async (wf: Workflow, isAuto = false) => {
        addLog({
            id: Date.now().toString(),
            timestamp: Date.now(),
            type: 'info',
            method: 'WORKFLOW_TRIGGER',
            content: `${isAuto ? 'Auto' : 'Manual'} trigger: ${wf.name}`
        });
        try {
            await WorkflowEngine.runWorkflow(
                wf, agents, modelConfigs, addLog,
                (note: any) => addNotification(note.title, note.message, note.type)
            );
            if (!isAuto) addNotification('System', `Workflow ${wf.name} completed.`, 'success');
        } catch (e: any) {
            addNotification('System Error', `Workflow failed: ${e.message}`, 'error');
        }
    }, [agents, modelConfigs, addLog, addNotification]);

    // Scheduler: verifica workflows agendados a cada 60s
    useEffect(() => {
        const timer = setInterval(() => {
            const now = Date.now();
            let changed = false;
            const updatedWorkflows = [...workflowsRef.current];
            workflowsRef.current.forEach((wf, index) => {
                if (wf.schedule?.enabled && wf.status !== 'paused' && wf.schedule.nextRun && now >= wf.schedule.nextRun) {
                    handleRunWorkflow(wf, true);
                    const nextRun = calculateNextRun(wf.schedule.type, wf.schedule.time, wf.schedule.days, timezone);
                    updatedWorkflows[index] = { ...wf, schedule: { ...wf.schedule, nextRun, lastRun: now } };
                    changed = true;
                }
            });
            if (changed) {
                setWorkflows(updatedWorkflows);
                saveField('workflows', updatedWorkflows);
            }
        }, 60000);
        return () => clearInterval(timer);
    }, [workflowsRef, handleRunWorkflow, setWorkflows, saveField]);

    return { handleRunWorkflow };
};
