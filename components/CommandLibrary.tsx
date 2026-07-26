import React from 'react';
import { APP_DISPLAY_NAME } from '../constants';
import { SYSTEM_TOOLS } from '../utils/toolDefinitions';
import { ExternalTool } from '../types';

interface CommandLibraryProps {
  externalTools?: ExternalTool[];
}

// Define a type for tool parameter properties
interface ToolParameterProperty {
  type: string;
  description?: string;
  enum?: any[];
  [key: string]: any;
}

// Helper to safely get properties from parameters object
const getParameterProperties = (params: ExternalTool['parameters']): Record<string, ToolParameterProperty> => {
  if (!params || typeof params !== 'object') return {};
  const properties = (params as any).properties;
  return properties && typeof properties === 'object' ? properties : {};
};

const getRequired = (params: ExternalTool['parameters']): string[] => {
  if (!params || typeof params !== 'object') return [];
  const required = (params as any).required;
  return Array.isArray(required) ? required : [];
};

const CommandLibrary: React.FC<CommandLibraryProps> = ({
  externalTools = [],
}) => {
  const safeSystemTools = Array.isArray(SYSTEM_TOOLS) ? SYSTEM_TOOLS : [];
  const safeExternalTools = Array.isArray(externalTools) ? externalTools : [];
  const getHostname = (urlStr: string) => {
    try {
      return new URL(urlStr).hostname;
    } catch {
      return urlStr;
    }
  };

  return (
    <div className="h-full bg-white dark:bg-dark-950 p-6 md:p-10 overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-black text-slate-800 dark:text-white uppercase tracking-tight mb-2">Command Library</h1>
          <p className="text-slate-500 text-sm max-w-2xl">
            This reference guide details the Action Commands available across {APP_DISPLAY_NAME} and its agents. 
            Agents can invoke these tools to manipulate the file system, manage configuration, or execute workflows.
          </p>
        </div>

        <div className="grid gap-8">
          {/* System Tools Section */}
          <section className="space-y-6">
            <h2 className="text-xs font-black uppercase text-slate-400 tracking-[0.3em] border-b dark:border-slate-800 pb-2">Core System Commands</h2>
            <div className="grid gap-6">
              {safeSystemTools.map((tool, idx) => (
                <div key={`sys-${idx}`} className="bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden hover:border-nebula-500/50 transition-colors">
                  <div className="p-4 bg-slate-100 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-bold text-nebula-600 dark:text-nebula-400 bg-nebula-100 dark:bg-nebula-900/30 px-2 py-1 rounded">
                        {tool.function.name}
                      </span>
                      <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded">
                        SYSTEM
                      </span>
                    </div>
                  </div>
                  
                  <div className="p-6 space-y-4">
                    <p className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed">
                      {tool.function.description}
                    </p>

                    <div className="bg-white dark:bg-black/20 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                      <div className="text-[10px] font-black uppercase text-slate-500 mb-3 tracking-wider">Parameters Schema</div>
                      <div className="space-y-3">
                        {Object.entries(getParameterProperties((tool as any)?.function?.parameters)).map(([key, value]) => {
                          const typedValue = value as ToolParameterProperty;
                          return (
                            <div key={key} className="flex flex-col md:flex-row md:items-start gap-1 md:gap-4 text-xs">
                              <span className="font-mono font-bold text-slate-700 dark:text-slate-200 min-w-[120px] shrink-0">
                                {key} {getRequired((tool as any)?.function?.parameters).includes(key) && <span className="text-red-500">*</span>}
                              </span>
                              <div className="flex-1">
                                <span className="text-slate-400 font-mono text-[10px] uppercase bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded mr-2">
                                  {typedValue.type}
                                </span>
                                <span className="text-slate-600 dark:text-slate-400">
                                  {typedValue.description || (typedValue.enum ? `One of: ${typedValue.enum.join(', ')}` : '')}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* External Dynamic Tools Section */}
          {safeExternalTools.length > 0 && (
            <section className="space-y-6">
              <h2 className="text-xs font-black uppercase text-nebula-500 tracking-[0.3em] border-b dark:border-nebula-900/30 pb-2">External Dynamic Commands</h2>
              <div className="grid gap-6">
                {safeExternalTools.map((tool) => (
                  <div key={tool.name} className="bg-nebula-50/20 dark:bg-nebula-950/10 border border-nebula-200 dark:border-nebula-900/30 rounded-2xl overflow-hidden hover:border-nebula-500/50 transition-colors">
                    <div className="p-4 bg-nebula-100/40 dark:bg-nebula-900/20 border-b border-nebula-200 dark:border-nebula-900/30 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm font-bold text-nebula-600 dark:text-nebula-400 bg-nebula-100 dark:bg-nebula-900/30 px-2 py-1 rounded">
                          {tool.name}
                        </span>
                        <span className="text-[9px] font-black uppercase text-white bg-nebula-500 px-1.5 py-0.5 rounded">
                          EXTERNAL
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-nebula-200 dark:bg-nebula-800 text-nebula-700 dark:text-nebula-300">
                          {tool.config.method}
                        </span>
                        <span className="text-[10px] font-mono font-bold text-nebula-400">
                          {getHostname(tool.config.url)}
                        </span>
                      </div>
                    </div>
                    
                    <div className="p-6 space-y-4">
                      <p className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed">
                        {tool.description}
                      </p>

                      <div className="bg-white dark:bg-black/20 rounded-xl border border-nebula-100 dark:border-nebula-900/20 p-4">
                        <div className="text-[10px] font-black uppercase text-nebula-500/60 mb-3 tracking-wider">Arguments Schema</div>
                        <div className="space-y-3">
                          {getParameterProperties(tool.parameters) && Object.entries(getParameterProperties(tool.parameters)).map(([key, value]) => (
                            <div key={key} className="flex flex-col md:flex-row md:items-start gap-1 md:gap-4 text-xs">
                              <span className="font-mono font-bold text-slate-700 dark:text-slate-200 min-w-[120px] shrink-0">
                                {key} {getRequired(tool.parameters).includes(key) && <span className="text-red-500">*</span>}
                              </span>
                              <div className="flex-1">
                                <span className="text-slate-400 font-mono text-[10px] uppercase bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded mr-2">
                                  {value.type}
                                </span>
                                <span className="text-slate-600 dark:text-slate-400">
                                  {value.description}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

export default CommandLibrary;