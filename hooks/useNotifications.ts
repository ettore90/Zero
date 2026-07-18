// =============================================================================
// useNotifications.ts — Gerenciamento de notificações da aplicação
// =============================================================================

import { useState, useCallback } from 'react';
import { Notification } from '../types';
import { generateId } from '../utils/helpers';

export const useNotifications = () => {
    const [notifications, setNotifications] = useState<Notification[]>([]);

    const addNotification = useCallback((
        title: string,
        message: string,
        type: 'info' | 'success' | 'warning' | 'error' = 'info'
    ) => {
        setNotifications(prev => [
            { id: generateId(), title, message, type, timestamp: Date.now(), read: false },
            ...prev
        ]);
    }, []);

    const markNotificationAsRead = useCallback((id: string) => {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    }, []);

    const markAllNotificationsRead = useCallback(() => {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    }, []);

    const clearNotifications = useCallback(() => setNotifications([]), []);

    const dismissNotification = useCallback((id: string) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    }, []);

    return {
        notifications,
        addNotification,
        markNotificationAsRead,
        markAllNotificationsRead,
        clearNotifications,
        dismissNotification,
    };
};
