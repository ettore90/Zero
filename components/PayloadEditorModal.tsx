import React, { useState } from 'react';
import Editor from '@monaco-editor/react';

interface PayloadEditorModalProps {
  initialCode: string;
  modelName: string;
  onSave: (code: string) => void;
  onClose: () => void;
}

const DEFAULT_TEMPLATE = `/**
 * Custom Request Builder
 * 
 * You have access to:
 * - config: ModelConfig object (contains apiKey, modelId, etc)
 * - messages: Array of chat messages
 * 
 * Return an object with: { url, headers, body }
 */

const lastMsg = messages[messages.length - 1];

// Example for standard OpenAI-like endpoint
return {
  url: config.baseUrl + "/chat/completions",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + config.apiKey
  },
  body: {
    model: config.modelId,
    messages: messages,
    stream: true
  }
};`;

const PayloadEditorModal: React.FC<PayloadEditorModalProps> = ({ initialCode, modelName, onSave, onClose }) => {
  const [code, setCode] = useState(initialCode || DEFAULT_TEMPLATE);
  const [showDocs, setShowDocs] = useState(true);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="bg-[#1e1e1e] rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden border border-slate-700">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-[#2d2d2d] border-b border-black">
          <div className="flex items-center gap-4">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Request Builder: <span className="text-nebula-400">{modelName}</span></h3>
              <p className="text-[10px] text-slate-400">Write a JavaScript function body to construct the API request.</p>
            </div>
            <button 
              onClick={() => setShowDocs(!showDocs)}
              className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded border transition-colors ${showDocs ? 'bg-nebula-500/20 text-nebula-400 border-nebula-500/50' : 'bg-white/5 text-slate-400 border-white/10'}`}
            >
              {showDocs ? 'Hide Guidelines' : 'Show Guidelines'}
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-1.5 text-xs font-bold text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 rounded transition-colors">
              Cancel
            </button>
            <button onClick={() => onSave(code)} className="px-6 py-1.5 text-xs font-bold text-white bg-nebula-600 hover:bg-nebula-500 rounded shadow-lg shadow-nebula-600/20 transition-colors">
              Save Script
            </button>
          </div>
        </div>

        {/* Content Split */}
        <div className="flex-1 flex overflow-hidden">
           {/* Docs Panel */}
           {showDocs && (
             <div className="w-1/3 min-w-[300px] border-r border-black bg-[#252526] overflow-y-auto p-5 text-slate-300 font-sans">
                <h4 className="text-white font-bold mb-4 text-xs uppercase tracking-wider">API Guidelines</h4>
                
                <div className="space-y-6 text-xs leading-relaxed">
                   <div>
                     <h5 className="text-nebula-400 font-bold mb-1">Standard Behavior (Auto-Proxy)</h5>
                     <p className="text-slate-400">
                       By default, the Orchestrator <strong>automatically wraps</strong> your request in a CORS proxy. 
                       You should return the <strong>External Destination URL</strong>.
                     </p>
                     <div className="mt-2 bg-black/30 p-2 rounded border border-white/5 font-mono text-[10px] text-green-300">
                       return &#123;<br/>
                       &nbsp;&nbsp;url: "https://api.openai.com/...",<br/>
                       &nbsp;&nbsp;body: &#123; ... &#125;<br/>
                       &#125;
                     </div>
                   </div>

                   <div>
                     <h5 className="text-orange-400 font-bold mb-1">Manual Proxy Construction</h5>
                     <p className="text-slate-400">
                       If you are manually constructing the proxy payload (targeting <code>/api/proxy</code> yourself), the system will detect this and <strong>disable</strong> the auto-wrapper to prevent "Double Proxy" errors (502).
                     </p>
                   </div>

                   <div>
                     <h5 className="text-purple-400 font-bold mb-1">Disable Proxy Explicitly</h5>
                     <p className="text-slate-400">
                       To force a direct browser fetch (e.g., for localhost or intranet services that do not require CORS), add the flag below:
                     </p>
                     <div className="mt-2 bg-black/30 p-2 rounded border border-white/5 font-mono text-[10px] text-purple-300">
                       return &#123;<br/>
                       &nbsp;&nbsp;useProxy: false,<br/>
                       &nbsp;&nbsp;url: "http://localhost:8080/...",<br/>
                       &nbsp;&nbsp;body: &#123; ... &#125;<br/>
                       &#125;
                     </div>
                   </div>

                   <div>
                     <h5 className="text-white font-bold mb-1">Available Variables</h5>
                     <ul className="list-disc pl-4 space-y-1 text-slate-400">
                       <li><code>config</code>: The full ModelConfig object (keys, IDs, URLs).</li>
                       <li><code>messages</code>: The array of chat history.</li>
                     </ul>
                   </div>
                </div>
             </div>
           )}

           {/* Editor Area */}
           <div className="flex-1 relative bg-[#1e1e1e]">
              <Editor
                height="100%"
                defaultLanguage="javascript"
                theme="vs-dark"
                value={code}
                onChange={(val: string | undefined) => setCode(val || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  padding: { top: 20 },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
              />
           </div>
        </div>

        {/* Footer Hint */}
        <div className="p-2 bg-[#007acc] text-white text-[10px] font-mono flex justify-between px-4">
          <span>JS Context Active</span>
          <span>Return Object: {"{ url, headers, body, [useProxy] }"}</span>
        </div>
      </div>
    </div>
  );
};

export default PayloadEditorModal;