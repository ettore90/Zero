// =============================================================================
// useSyncStatus.ts — Indicador visual de sincronização (saving/saved/error)
// =============================================================================

import { useState, useCallback, useRef } from 'react';

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error';

export const useSyncStatus = () => {
    const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
    const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const withSync = useCallback(async (fn: () => Promise<void>) => {
        setSyncStatus('saving');
        try {
            await fn();
            setSyncStatus('saved');
        } catch {
            setSyncStatus('error');
        } finally {
            if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
            syncTimeoutRef.current = setTimeout(() => setSyncStatus('idle'), 3000);
        }
    }, []);

    return { syncStatus, withSync };
};
