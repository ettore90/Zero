import React, { useMemo, useState } from 'react';
import { APP_DISPLAY_NAME } from '../constants';
import { SessionUser } from '../services/localApiService';

interface AuthProps {
  onLogin: (username: string) => void;
  onCreateUser: (payload: { username: string; displayName?: string }) => void;
  users: SessionUser[];
  error?: string;
  loading?: boolean;
}

const Auth: React.FC<AuthProps> = ({ onLogin, onCreateUser, users, error, loading = false }) => {
  const [selectedUsername, setSelectedUsername] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.username.localeCompare(b.username)),
    [users],
  );

  const handleExistingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUsername.trim()) return;
    onLogin(selectedUsername.trim());
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim()) return;
    onCreateUser({
      username: newUsername.trim(),
      displayName: newDisplayName.trim() || newUsername.trim(),
    });
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-gray-100 dark:bg-dark-950 p-4 transition-colors">
      <div className="max-w-xl w-full bg-white dark:bg-dark-900 rounded-2xl shadow-2xl overflow-hidden border dark:border-slate-800">
        <div className="bg-slate-900 dark:bg-dark-950 p-10 text-center border-b dark:border-slate-800 relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-nebula-500 to-indigo-600"></div>
          <h1 className="text-3xl font-black text-white mb-2 tracking-tighter uppercase">{APP_DISPLAY_NAME}</h1>
          <p className="text-nebula-500 text-[10px] font-black uppercase tracking-[0.3em]">Production Environment</p>
        </div>

        <div className="grid md:grid-cols-2 gap-0">
          <form onSubmit={handleExistingSubmit} className="p-8 space-y-6 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-800 dark:text-white">Select user</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">All users are local admins. Session is passwordless.</p>
            </div>

            {error && (
              <div className="bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 text-[11px] font-bold p-3 rounded-xl border border-red-100 dark:border-red-800/50 uppercase tracking-tight">
                {error}
              </div>
            )}

            <div className="space-y-1">
              <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Existing users</label>
              <select
                value={selectedUsername}
                onChange={(e) => setSelectedUsername(e.target.value)}
                className="w-full border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 focus:ring-4 focus:ring-nebula-500/10 focus:border-nebula-500 outline-none transition-all bg-slate-50 dark:bg-dark-800 dark:text-white font-medium"
              >
                <option value="">Choose a user</option>
                {sortedUsers.map((user) => (
                  <option key={user.id} value={user.username}>
                    {user.displayName || user.username} ({user.username})
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={loading || !selectedUsername.trim()}
              className="w-full bg-nebula-600 text-white py-4 rounded-xl font-black text-xs uppercase tracking-[0.2em] hover:bg-nebula-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-nebula-600/20"
            >
              {loading ? 'Opening session...' : 'Open Session'}
            </button>
          </form>

          <form onSubmit={handleCreateSubmit} className="p-8 space-y-6">
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-800 dark:text-white">Create user</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Creates a new local admin profile in SQLite.</p>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Username</label>
              <input
                type="text"
                required
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="w-full border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 focus:ring-4 focus:ring-nebula-500/10 focus:border-nebula-500 outline-none transition-all bg-slate-50 dark:bg-dark-800 dark:text-white font-medium"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Display name</label>
              <input
                type="text"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                className="w-full border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 focus:ring-4 focus:ring-nebula-500/10 focus:border-nebula-500 outline-none transition-all bg-slate-50 dark:bg-dark-800 dark:text-white font-medium"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !newUsername.trim()}
              className="w-full bg-slate-900 text-white py-4 rounded-xl font-black text-xs uppercase tracking-[0.2em] hover:bg-slate-800 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            >
              {loading ? 'Creating...' : 'Create User'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Auth;
