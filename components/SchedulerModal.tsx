import React, { useState } from 'react';
import { Agent, ScheduledMessage } from '../types';

interface SchedulerModalProps {
  agents: Agent[];
  scheduledMessages: ScheduledMessage[];
  onSchedule: (agentId: string, content: string, date: Date) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const SchedulerModal: React.FC<SchedulerModalProps> = ({
  agents,
  scheduledMessages,
  onSchedule,
  onDelete,
  onClose
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState(agents.length > 0 ? agents[0].id : '');
  const [content, setContent] = useState('');
  const getDefaultTime = () => {
    const d = new Date(Date.now() + 5 * 60 * 1000); // +5 min
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [scheduleTime, setScheduleTime] = useState(getDefaultTime);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgentId || !content || !scheduleTime) return;
    
    const date = new Date(scheduleTime);
    if (date.getTime() < Date.now()) {
        alert("Please select a future time.");
        return;
    }

    onSchedule(selectedAgentId, content, date);
    setContent('');
    setScheduleTime('');
  };

  const pendingMessages = scheduledMessages
    .filter(m => m.status === 'pending')
    .sort((a, b) => a.scheduledAt - b.scheduledAt);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-0 md:p-4">
      <div className="bg-white dark:bg-dark-900 md:rounded-xl shadow-2xl w-full h-full md:h-auto md:max-w-2xl overflow-hidden border-0 md:border dark:border-slate-800 transition-colors flex flex-col md:max-h-[90vh]">
        <div className="p-4 border-b dark:border-slate-800 bg-gray-50 dark:bg-dark-950 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-nebula-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-lg font-bold text-gray-800 dark:text-white">Message Scheduler</h3>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col md:flex-row h-full overflow-hidden">
            {/* Create Form */}
            <div className="w-full md:w-1/3 p-6 border-r dark:border-slate-800 overflow-y-auto bg-gray-50/50 dark:bg-dark-950/50">
                <h4 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-4">Create Schedule</h4>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">Target Agent</label>
                        <select 
                            value={selectedAgentId}
                            onChange={(e) => setSelectedAgentId(e.target.value)}
                            className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-nebula-500 bg-white dark:bg-dark-800 dark:border-slate-700 dark:text-white"
                        >
                            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">Execution Time</label>
                        <input 
                            type="datetime-local"
                            value={scheduleTime}
                            onChange={(e) => setScheduleTime(e.target.value)}
                            required
                            className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-nebula-500 bg-white dark:bg-dark-800 dark:border-slate-700 dark:text-white"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">Message</label>
                        <textarea 
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            required
                            rows={4}
                            placeholder="What should be sent to the agent?"
                            className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-nebula-500 resize-none bg-white dark:bg-dark-800 dark:border-slate-700 dark:text-white"
                        />
                    </div>
                    <button type="submit" className="w-full bg-nebula-600 hover:bg-nebula-700 text-white font-bold py-2 px-4 rounded-lg shadow-sm transition-colors text-sm">
                        Schedule Message
                    </button>
                </form>
            </div>

            {/* List */}
            <div className="flex-1 p-6 overflow-y-auto bg-white dark:bg-dark-900">
                 <h4 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-4 flex justify-between">
                    <span>Pending Queue</span>
                    <span className="bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 rounded-full">{pendingMessages.length}</span>
                 </h4>
                 
                 {pendingMessages.length === 0 && (
                     <div className="flex flex-col items-center justify-center h-48 text-slate-400 opacity-60">
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                         </svg>
                         <span className="text-xs">No pending messages</span>
                     </div>
                 )}

                 <div className="space-y-3">
                     {pendingMessages.map(msg => {
                         const agent = agents.find(a => a.id === msg.agentId);
                         return (
                             <div key={msg.id} className="flex items-start gap-3 p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-gray-50 dark:bg-dark-950/40 group hover:border-nebula-500/30 transition-colors">
                                 <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${agent?.color || 'bg-gray-400'}`} />
                                 <div className="flex-1 min-w-0">
                                     <div className="flex items-center gap-2 mb-1">
                                         <span className="font-bold text-xs text-slate-700 dark:text-slate-200">{agent?.name || 'Unknown Agent'}</span>
                                         <span className="text-[10px] bg-slate-200 dark:bg-slate-800 px-1.5 rounded text-slate-500 font-mono">
                                             {new Date(msg.scheduledAt).toLocaleString()}
                                         </span>
                                         {msg.createdBy === 'agent' && (
                                             <span className="text-[9px] bg-indigo-100 text-indigo-600 px-1.5 rounded font-black uppercase tracking-tighter">Auto</span>
                                         )}
                                     </div>
                                     <p className="text-sm text-slate-600 dark:text-slate-400 truncate">{msg.content}</p>
                                 </div>
                                 <button 
                                    onClick={() => onDelete(msg.id)}
                                    className="text-slate-400 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                 >
                                     <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                     </svg>
                                 </button>
                             </div>
                         );
                     })}
                 </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default SchedulerModal;