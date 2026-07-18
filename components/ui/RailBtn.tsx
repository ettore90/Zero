import React from 'react';

interface RailBtnProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
  danger?: boolean;
}

const RailBtn: React.FC<RailBtnProps> = ({ icon, label, active, badge, onClick, danger }) => (
  <button
    onClick={onClick}
    title={label}
    aria-label={label}
    className={`relative flex items-center justify-center w-10 h-10 rounded-xl transition-all group ${
      active
        ? 'bg-nebula-600/20 text-nebula-500 dark:text-nebula-400 ring-1 ring-nebula-500/30'
        : danger
        ? 'text-slate-400 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-100/60 dark:hover:bg-red-900/20'
        : 'text-slate-500 dark:text-slate-600 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
    }`}
  >
    {icon}
    {badge != null && badge > 0 && (
      <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[8px] font-black rounded-full flex items-center justify-center">
        {badge > 9 ? '9+' : badge}
      </span>
    )}
    <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-[10px] font-bold uppercase tracking-wider text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-[100]">
      {label}
    </span>
  </button>
);

export default RailBtn;
