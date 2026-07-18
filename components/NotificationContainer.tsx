import React from 'react';
import { Notification } from '../types';

interface NotificationDropdownProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
  onMarkAsRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClear: () => void;
  onClose: () => void;
}

const NotificationDropdown: React.FC<NotificationDropdownProps> = ({ 
    notifications, 
    onDismiss, 
    onMarkAsRead,
    onMarkAllRead,
    onClear,
    onClose
}) => {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-96 animate-in slide-in-from-bottom-2 fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">Notifications</h3>
          <div className="flex gap-2">
              <button 
                onClick={onMarkAllRead}
                className="text-[9px] font-bold uppercase text-nebula-600 hover:text-nebula-700 dark:text-nebula-400"
                title="Mark all as read"
              >
                  Read All
              </button>
              <button 
                onClick={onClear}
                className="text-[9px] font-bold uppercase text-slate-400 hover:text-red-500"
                title="Clear all notifications"
              >
                  Clear
              </button>
              <button onClick={onClose} className="md:hidden text-slate-400">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
              </button>
          </div>
      </div>

      {/* List */}
      <div className="overflow-y-auto custom-scrollbar flex-1">
          {notifications.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mx-auto mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  <p className="text-xs font-medium">All caught up</p>
              </div>
          ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {notifications.map(note => (
                      <div 
                        key={note.id} 
                        className={`p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors relative group ${!note.read ? 'bg-nebula-50/50 dark:bg-nebula-900/10' : ''}`}
                        onClick={() => !note.read && onMarkAsRead(note.id)}
                      >
                          {!note.read && (
                              <span className="absolute left-0 top-0 bottom-0 w-1 bg-nebula-500 rounded-r"></span>
                          )}
                          <div className="flex justify-between items-start gap-2">
                              <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-0.5">
                                      {note.type === 'error' && <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"/>}
                                      {note.type === 'warning' && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"/>}
                                      {note.type === 'success' && <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"/>}
                                      <h4 className={`text-xs font-bold truncate ${note.read ? 'text-slate-600 dark:text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}>
                                          {note.title}
                                      </h4>
                                  </div>
                                  <p className={`text-[11px] leading-snug break-words ${note.read ? 'text-slate-500' : 'text-slate-700 dark:text-slate-300'}`}>
                                      {note.message}
                                  </p>
                                  <span className="text-[9px] text-slate-400 mt-1 block">
                                      {new Date(note.timestamp).toLocaleTimeString()}
                                  </span>
                              </div>
                              <button 
                                onClick={(e) => { e.stopPropagation(); onDismiss(note.id); }}
                                className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                              >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                     <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                  </svg>
                              </button>
                          </div>
                      </div>
                  ))}
              </div>
          )}
      </div>
    </div>
  );
};

export default NotificationDropdown;