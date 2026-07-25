import React, { useRef, useEffect, useState, useCallback, useMemo, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Agent, Message, ToolCall, Project } from '../types';
import { parseThinkBlocks, ThoughtPart } from '../utils/helpers';
import ChatCanvasShell from './ChatCanvasShell';
import { getSessionNoteIdentity } from './sessionNoteHelpers';
import { useCanvasState } from '../hooks/useCanvasState';
import { useSessionNoteSync, type SessionNoteSyncPort, type UseSessionNoteSyncResult } from './useSessionNoteSync';
import * as SystemService from '../services/systemService';
import * as ServerChat from '../services/serverChatService';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ChatInterfaceProps {
  agent: Agent;
  username: string;
  onSendMessage: (text: string, images?: string[], attachments?: Message['attachments']) => void;
  onEditAgent: () => void;
  onClearSummary: () => void;
  isGenerating: boolean;
  pendingApproval: {
    agentId: string;
    toolCalls: ToolCall[];
    sensitiveCalls: ToolCall[];
  } | null;
  onApproveTool: () => void;
  onDenyTool: () => void;
  onStop: () => void;
  syncStatus?: 'idle' | 'saving' | 'saved' | 'error';
  isChatVisible?: boolean;
  onToggleChat?: () => void;
  sessionNoteRemoteRefreshKey?: number;
  projects?: Project[];
  activeProjectId?: string | null;
  onSelectProject?: (id: string) => void;
  onAddProject?: (project: Project) => void;
  onEditProject?: (project: Project) => void;
  onDeleteProject?: (id: string) => void;
  onScanProject?: (id: string) => Promise<any>;
  scanLoading?: boolean;
  scanDraft?: import('../types').ProjectContext | null;
  onApproveContext?: (ctx: import('../types').ProjectContext) => void;
  onDismissDraft?: () => void;
}

interface PendingFile {
  id: string;
  file: File;
  preview?: string;
  type: 'image' | 'document' | 'binary';
  extractedText?: string;
}

// ---------------------------------------------------------------------------
// ThoughtRenderer (sem alterações)
// ---------------------------------------------------------------------------
const ThoughtRenderer = memo(({ content, isUser }: { content: string; isUser: boolean }) => {
  if (isUser) {
    return (
      <div className="prose prose-sm md:prose-base max-w-none prose-invert font-medium">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    );
  }

  const parts: ThoughtPart[] = parseThinkBlocks(content);
  if (parts.length === 0) {
    return (
      <div className="prose prose-sm md:prose-base max-w-none dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {parts.map((part, i) =>
        part.type === 'thought' ? (
          <details key={i} className="group">
            <summary className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none list-none">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="font-mono uppercase tracking-wider text-[9px]">Reasoning</span>
            </summary>
            <div className="mt-2 pl-4 border-l-2 border-slate-700/50">
              <div className="prose prose-sm max-w-none dark:prose-invert prose-slate text-slate-400 font-mono text-xs">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.content}</ReactMarkdown>
              </div>
            </div>
          </details>
        ) : (
          <div key={i} className="prose prose-sm md:prose-base max-w-none dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.content}</ReactMarkdown>
          </div>
        )
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// MessageItem (sem alterações estruturais)
// ---------------------------------------------------------------------------
const MessageItem = memo(({ msg, isGenerating, isLast }: { msg: Message; isGenerating: boolean; isLast: boolean }) => {
  const isUser = msg.role === 'user';
  const isActionOnly = msg.role === 'assistant' && !msg.content && msg.tool_calls && msg.tool_calls.length > 0;
  const isEmpty = msg.role === 'assistant' && (!msg.content || msg.content.trim() === '') && !msg.tool_calls?.length;

  // Marcador de contexto arquivado
  if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.startsWith('__CONTEXT_ARCHIVED__:')) {
    const archivedAt = msg.content.replace('__CONTEXT_ARCHIVED__:', '');
    return (
      <div className="flex items-center gap-3 py-2 px-1">
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700/60" />
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/50">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
          </svg>
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Context archived</span>
          <span className="text-[9px] text-slate-300 dark:text-slate-600 font-mono">{archivedAt}</span>
        </div>
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700/60" />
      </div>
    );
  }

  // Mensagem vazia sem tool_calls: spinner se gerando, null se não
  if (isEmpty) {
    if (isGenerating && isLast) {
      return (
        <div className="flex gap-3 justify-start">
          <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center shrink-0 mt-0.5">
            <div className="w-2 h-2 rounded-full bg-nebula-500 animate-pulse" />
          </div>
          <div className="bg-white dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/50 rounded-2xl px-4 py-3">
            <div className="flex items-center space-x-2 py-1">
              {[0, 150, 300].map(delay => (
                <div key={delay} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${delay}ms` }} />
              ))}
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  if (msg.role === 'tool') return null;

  // Mensagem assistant com tool_calls e sem content textual — mostrar pill com nome das tools
  if (msg.role === 'assistant' && isActionOnly && msg.tool_calls) {
    const toolNames = msg.tool_calls.map((tc: ToolCall) => tc.function?.name ?? 'tool').filter(Boolean);
    return (
      <div className="flex gap-3 justify-start">
        <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center shrink-0 mt-0.5">
          <div className="w-2 h-2 rounded-full bg-nebula-500" />
        </div>
        <div className="flex flex-wrap gap-1.5 items-center py-1">
          {toolNames.map((name: string, i: number) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60 text-[10px] font-mono text-slate-500 dark:text-slate-400"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5 text-nebula-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {name}
            </span>
          ))}
          {isGenerating && isLast && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] text-slate-400 dark:text-slate-500 italic">
              {[0, 150, 300].map(delay => (
                <div key={delay} className="w-1 h-1 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${delay}ms` }} />
              ))}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center shrink-0 mt-0.5">
          <div className="w-2 h-2 rounded-full bg-nebula-500" />
        </div>
      )}

      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
        isUser
          ? 'bg-nebula-600 text-white'
          : 'bg-white dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/50 text-slate-800 dark:text-slate-100'
      }`}>
        {/* Attachments */}
        {msg.images && msg.images.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {msg.images.map((img, i) => (
              <img key={i} src={img} alt="" className="max-h-48 rounded-lg object-cover" />
            ))}
          </div>
        )}

        {isGenerating && isLast && msg.role === 'assistant' && !msg.content ? (
          <div className="flex items-center space-x-2 py-1">
            {[0, 150, 300].map(delay => (
              <div key={delay} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${delay}ms` }} />
            ))}
          </div>
        ) : (
          <>
            {msg.content && <ThoughtRenderer content={msg.content} isUser={isUser} />}
            {isActionOnly && (
              <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 italic text-xs py-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>Executing...</span>
              </div>
            )}
          </>
        )}

        <div className={`mt-2 text-[9px] font-black uppercase tracking-[0.2em] opacity-30 ${isUser ? 'text-right' : ''}`}>
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      {isUser && (
        <div className="w-7 h-7 rounded-full bg-nebula-600 flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-black text-white">
          U
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// ChatInput
// ---------------------------------------------------------------------------
const ChatInput = memo(({
  onSend, onStop, isGenerating,
}: {
  onSend: (text: string, images?: string[], attachments?: Message['attachments']) => void;
  onStop: () => void;
  isGenerating: boolean;
}) => {
  const [input, setInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const resizeFrameRef = useRef<number | null>(null);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!input.trim() && pendingFiles.length === 0) || isGenerating || isProcessingFiles) return;
    const images = pendingFiles.filter(f => f.type === 'image' && f.preview).map(f => f.preview!);
    const attachments = pendingFiles.filter(f => f.type !== 'image').map(f => ({
      name: f.file.name,
      type: 'file' as const,
      content: f.extractedText ?? '',
    }));
    onSend(input.trim(), images.length ? images : undefined, attachments.length ? attachments : undefined);
    setInput('');
    setPendingFiles([]);
    if (textAreaRef.current) { textAreaRef.current.style.height = 'auto'; }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const scheduleTextareaResize = useCallback((target: HTMLTextAreaElement) => {
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
    }
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      target.style.height = 'auto';
      target.style.height = Math.min(target.scrollHeight, 160) + 'px';
      resizeFrameRef.current = null;
    });
  }, []);

  const stopRecordingTracks = useCallback(() => {
    mediaRecorderRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
  }, []);

  const handleToggleRecording = useCallback(async () => {
    if (isGenerating || isProcessingFiles || isTranscribing) return;

    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }

    const mediaDevices = navigator.mediaDevices;

    if (!mediaDevices?.getUserMedia) {
      const diagnostics = [
        `secure=${String(window.isSecureContext)}`,
        `mediaDevices=${String(Boolean(mediaDevices))}`,
        `getUserMedia=${String(Boolean(mediaDevices?.getUserMedia))}`,
        `mediaRecorder=${String(Boolean((globalThis as typeof globalThis & { MediaRecorder?: typeof MediaRecorder }).MediaRecorder))}`,
        `origin=${window.location.origin}`,
      ].join(' | ');
      window.alert(`Audio capture is not available in this browser. ${diagnostics}`);
      return;
    }

    try {
      const stream = await mediaDevices.getUserMedia({ audio: true });
      const MediaRecorderCtor = (globalThis as typeof globalThis & { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;

      if (!MediaRecorderCtor) {
        audioInputRef.current?.click();
        stopRecordingTracks();
        return;
      }

      const preferredMimeType = ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
        .find(type => typeof MediaRecorderCtor.isTypeSupported !== 'function' || MediaRecorderCtor.isTypeSupported(type));
      const recorder = preferredMimeType ? new MediaRecorderCtor(stream, { mimeType: preferredMimeType }) : new MediaRecorderCtor(stream);

      recordedChunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener('stop', async () => {
        const mimeType = recorder.mimeType || preferredMimeType || 'audio/webm';
        const audioBlob = new Blob(recordedChunksRef.current, { type: mimeType });
        recordedChunksRef.current = [];
        stopRecordingTracks();
        setIsRecording(false);

        if (!audioBlob.size) return;

        setIsTranscribing(true);
        try {
          const result = await ServerChat.transcribeAudio(audioBlob, mimeType);
          const transcript = (result.text || '').trim();
          if (!transcript) return;
          setInput(prev => {
            const next = prev.trim().length ? `${prev.trimEnd()} ${transcript}` : transcript;
            window.requestAnimationFrame(() => {
              if (textAreaRef.current) {
                scheduleTextareaResize(textAreaRef.current);
                textAreaRef.current.focus();
              }
            });
            return next;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to transcribe audio.';
          window.alert(message);
        } finally {
          setIsTranscribing(false);
        }
      });

      recorder.start();
      setIsRecording(true);
    } catch (error) {
      stopRecordingTracks();
      setIsRecording(false);
      const message = error instanceof Error ? error.message : 'Unable to access microphone.';
      window.alert(message);
    }
  }, [isGenerating, isProcessingFiles, isRecording, isTranscribing, scheduleTextareaResize, stopRecordingTracks]);

  useEffect(() => {
    return () => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      stopRecordingTracks();
    };
  }, [stopRecordingTracks]);

  const handleAudioCaptureChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || isGenerating || isProcessingFiles || isTranscribing) return;

    setIsTranscribing(true);
    try {
      const result = await ServerChat.transcribeAudio(file, file.type || 'audio/mp4');
      const transcript = (result.text || '').trim();
      if (!transcript) return;
      setInput(prev => {
        const next = prev.trim().length ? `${prev.trimEnd()} ${transcript}` : transcript;
        window.requestAnimationFrame(() => {
          if (textAreaRef.current) {
            scheduleTextareaResize(textAreaRef.current);
            textAreaRef.current.focus();
          }
        });
        return next;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to transcribe audio.';
      window.alert(message);
    } finally {
      setIsTranscribing(false);
      if (audioInputRef.current) audioInputRef.current.value = '';
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setIsProcessingFiles(true);
    const processed: PendingFile[] = await Promise.all(files.map(async file => {
      const id = Math.random().toString(36).slice(2);
      if (file.type.startsWith('image/')) {
        const preview = await new Promise<string>(res => {
          const reader = new FileReader();
          reader.onload = ev => res(ev.target?.result as string);
          reader.readAsDataURL(file);
        });
        return { id, file, preview, type: 'image' as const };
      }
      if (file.type === 'text/plain' || file.name.endsWith('.md') || file.name.endsWith('.ts') || file.name.endsWith('.tsx') || file.name.endsWith('.js') || file.name.endsWith('.json')) {
        const extractedText = await file.text();
        return { id, file, type: 'document' as const, extractedText };
      }
      return { id, file, type: 'binary' as const };
    }));
    setPendingFiles(prev => [...prev, ...processed]);
    setIsProcessingFiles(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-2">
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1">
          {pendingFiles.map(f => (
            <div key={f.id} className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg px-2 py-1 text-xs">
              {f.type === 'image' && f.preview ? (
                <img src={f.preview} alt="" className="h-5 w-5 rounded object-cover" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
              <span className="text-slate-600 dark:text-slate-400 max-w-[80px] truncate">{f.file.name}</span>
              <button onClick={() => setPendingFiles(prev => prev.filter(p => p.id !== f.id))} className="text-slate-400 hover:text-red-500 transition-colors">×</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 rounded-2xl shadow-sm px-3 focus-within:border-nebula-400 dark:focus-within:border-nebula-500 transition-colors">
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />
        <input ref={audioInputRef} type="file" accept="audio/*" capture className="hidden" onChange={handleAudioCaptureChange} />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-2 text-slate-400 hover:text-nebula-500 transition-colors shrink-0"
          title="Attach file"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>

        <button
          onClick={handleToggleRecording}
          disabled={isGenerating || isProcessingFiles || isTranscribing}
          className={`p-2 rounded-full transition-colors shrink-0 ${isRecording ? 'text-red-500 bg-red-50 dark:bg-red-500/10' : isTranscribing ? 'text-amber-500 bg-amber-50 dark:bg-amber-500/10' : 'text-slate-400 hover:text-nebula-500'} ${(isGenerating || isProcessingFiles || isTranscribing) && !isRecording ? 'opacity-50 cursor-not-allowed' : ''}`}
          title={isRecording ? 'Stop recording' : isTranscribing ? 'Transcribing audio...' : 'Record audio'}
        >
          {isRecording ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6 6h8v8H6V6z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 15a3 3 0 003-3V8a3 3 0 10-6 0v4a3 3 0 003 3z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11.5a7 7 0 01-14 0" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 18v3" />
            </svg>
          )}
        </button>

        <textarea
          ref={textAreaRef}
          value={input}
          onChange={e => {
            setInput(e.target.value);
            scheduleTextareaResize(e.target);
          }}
          onKeyDown={handleKeyDown}
          placeholder={isTranscribing ? 'Transcribing audio...' : isRecording ? 'Recording audio...' : isGenerating ? 'Generation in progress...' : 'Message...'}
          rows={1}
          disabled={isGenerating || isTranscribing}
          spellCheck={false}
          autoComplete="off"
          className="flex-1 bg-transparent border-none text-slate-800 dark:text-slate-100 px-2 py-3.5 focus:ring-0 outline-none resize-none placeholder-slate-400 dark:placeholder-slate-500 text-[15px] font-medium disabled:opacity-50"
        />

        {isGenerating ? (
          <button onClick={onStop} className="p-3.5 rounded-full text-white bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/30 transition-all hover:scale-105 active:scale-95 group">
            <div className="w-3 h-3 bg-white rounded-sm group-hover:scale-90 transition-transform" />
          </button>
        ) : (
          <button
            onClick={() => handleSubmit()}
            disabled={(!input.trim() && pendingFiles.length === 0) || isProcessingFiles || isTranscribing}
            className={`p-3.5 rounded-full transition-all ${(!input.trim() && pendingFiles.length === 0) || isProcessingFiles || isTranscribing ? 'text-slate-200 dark:text-slate-800 opacity-40' : 'text-nebula-600 hover:bg-nebula-50 dark:hover:bg-nebula-500/10 active:scale-90 shadow-sm'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 rotate-90" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
          </button>
        )}
      </div>

      <div className="hidden md:flex justify-center items-center gap-5 text-[8px] font-black text-slate-400 uppercase tracking-[0.25em] px-4 opacity-60 select-none">
        <span>ENTER FOR LINEBREAK</span>
        <span className="w-1 h-1 bg-slate-200 dark:bg-slate-800 rounded-full" />
        <span>CTRL+ENTER TO SEND</span>
        <span className="w-1 h-1 bg-slate-200 dark:bg-slate-800 rounded-full" />
        <span className="text-nebula-500">SYSTEM ONLINE</span>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// ChatPanel — coluna do chat
// ---------------------------------------------------------------------------
interface ChatPanelProps {
  agent: Agent;
  isGenerating: boolean;
  onSendMessage: (text: string, images?: string[], attachments?: Message['attachments']) => void;
  onClearSummary: () => void;
  onStop: () => void;
  syncStatus?: 'idle' | 'saving' | 'saved' | 'error';
  isChatVisible?: boolean;
  onToggleChat?: () => void;
  mobileRail?: React.ReactNode;
}

const ChatPanel: React.FC<ChatPanelProps> = memo(({
  agent, isGenerating,
  onSendMessage, onClearSummary, onStop,
  syncStatus = 'idle', isChatVisible = true, onToggleChat, mobileRail,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const history = Array.isArray(agent.history)
    ? agent.history
    : ((agent.history as any)?.messages ?? []);




  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history.length, history[history.length - 1]?.content]);

  return (
    <div className={`flex flex-col ${isChatVisible ? 'h-full' : 'h-12'} overflow-hidden`}>
      {/* Chat Header */}
      <div className="h-12 px-4 border-b border-slate-100 dark:border-slate-800/60 flex items-center gap-2 shrink-0 bg-white dark:bg-dark-900">
        {/* Agent info */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: agent.color }} />
          <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{agent.name}</span>
          {agent.isMaster && (
            <span className="text-[8px] font-black text-nebula-500 uppercase tracking-widest hidden sm:block">Master</span>
          )}
          {isGenerating && (
            <div className="flex gap-1 ml-1">
              {[0, 120, 240].map(d => (
                <div key={d} className="w-1 h-1 rounded-full bg-nebula-500 animate-bounce" style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          )}
          {/* Botão minimizar chat */}
          {onToggleChat && (
            <button
              onClick={onToggleChat}
              className="ml-1 p-1 rounded text-slate-400 hover:text-nebula-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title={isChatVisible ? 'Minimize chat' : 'Restore chat'}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {isChatVisible
                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                }
              </svg>
            </button>
          )}
          {!isGenerating && syncStatus !== 'idle' && (
            <div className={`flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide transition-all duration-300 ${
              syncStatus === 'saving' ? 'text-amber-500 dark:text-amber-400' :
              syncStatus === 'saved'  ? 'text-emerald-500 dark:text-emerald-400' :
              'text-red-500 dark:text-red-400'
            }`}>
              {syncStatus === 'saving' && (
                <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
              )}
              {syncStatus === 'saved' && (
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {syncStatus === 'error' && (
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
                </svg>
              )}
              {syncStatus}
            </div>
          )}
        </div>

      </div>

      {/* Neural Cache Summary */}
      {agent.summary && (
        <div className="mx-4 mt-3 p-3 bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl flex gap-3 shrink-0 relative group">
          <div className="shrink-0 p-1.5 bg-white dark:bg-slate-700/60 rounded-lg h-fit text-nebula-500">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">Neural Cache</h4>
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{agent.summary}</p>
          </div>
          <button
            onClick={onClearSummary}
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            title="Dismiss summary"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 pb-6 md:pb-24 space-y-5 scroll-smooth custom-scrollbar relative min-h-0">
        {history.length === 0 && !agent.summary && (
          <div className="absolute inset-0 flex flex-col items-center justify-center opacity-30 select-none pointer-events-none">
            <div className="w-16 h-16 rounded-2xl mb-4 shadow-2xl animate-pulse" style={{ background: agent.color }} />
            <h3 className="text-xl font-black text-slate-800 dark:text-white uppercase tracking-widest">{agent.name}</h3>
            <p className="text-xs font-mono text-slate-500 mt-1">Ready for instructions</p>
          </div>
        )}

        {history.map((msg: Message, i: number) => (
          <MessageItem
            key={i}
            msg={msg}
            isGenerating={isGenerating}
            isLast={i === history.length - 1}
          />
        ))}
      </div>


      {/* Input */}
      <div className="relative p-4 bg-gradient-to-t from-white via-white to-transparent dark:from-dark-950 dark:via-dark-950 dark:to-transparent shrink-0 z-10">
        {mobileRail && (
          <div className="pointer-events-none absolute left-4 right-4 bottom-[calc(100%+0.75rem)] md:hidden z-20">
            <div className="pointer-events-auto ml-auto w-fit">
              {mobileRail}
            </div>
          </div>
        )}
        <ChatInput onSend={onSendMessage} onStop={onStop} isGenerating={isGenerating} />
      </div>
    </div>
  );
});

type RailSessionNoteItem = {
  id: string;
  noteId?: string | null;
  sessionId?: string | null;
  title?: string | null;
  contentHtml?: string | null;
};

// ---------------------------------------------------------------------------
// ChatInterface principal — state owner + shell composition
// ---------------------------------------------------------------------------
const ChatInterface: React.FC<ChatInterfaceProps> = ({
  agent,
  username,
  onSendMessage,
  onEditAgent,
  onClearSummary,
  isGenerating,
  pendingApproval,
  onApproveTool,
  onDenyTool,
  onStop,
  syncStatus = 'idle',
  isChatVisible = true,
  onToggleChat,
  sessionNoteRemoteRefreshKey,
  projects = [],
  activeProjectId = null,
  onSelectProject,
  onAddProject,
  onEditProject,
  onDeleteProject,
  onScanProject,
  scanLoading,
  scanDraft,
  onApproveContext,
  onDismissDraft,
}) => {
  const canvas = (useCanvasState as any)(agent.id);
  const [isCanvasProjectTreeSectionOpen, setIsCanvasProjectTreeSectionOpen] = useState(false);
  const [isCanvasSessionNotesSectionOpen, setIsCanvasSessionNotesSectionOpen] = useState(false);
  const sessionNoteLoadKeyRef = useRef<string | null>(null);

  const sessionNoteSyncPort: SessionNoteSyncPort = useMemo(() => ({
    loadSession: async (sessionId: string, currentUsername: string) => {
      const session = await ServerChat.loadSession(sessionId, currentUsername);
      const noteList = await ServerChat.listNotes(currentUsername, sessionId).catch(() => null);
      const notes = Array.isArray(noteList?.notes) ? noteList.notes : [];
      return session ? {
        ...session,
        notes,
        activeNoteId: session.activeNoteId ?? null,
      } : null;
    },
    saveSessionNote: async (sessionId: string, currentUsername: string, payload: { title: string; contentHtml: string; noteId?: string | null }) => {
      const response = await ServerChat.saveSessionNote(sessionId, currentUsername, payload);
      if (!response?.success) return null;
      const session = response.session ?? {};
      return {
        ...session,
        note: response.note ?? session.note ?? null,
        notes: Array.isArray(session.notes) ? session.notes : (response.note ? [response.note] : undefined),
        activeNoteId: session.activeNoteId ?? response.noteId ?? response.note?.noteId ?? null,
      };
    },
    writeFile: (path: string, content: string, mode: string) => SystemService.writeFile(path, content, mode),
    revealSessionNotesUi: () => {
      setIsCanvasSessionNotesSectionOpen(true);
      setIsCanvasProjectTreeSectionOpen(false);
    },
  }), []);

  const { handleCreateSessionNote, handleSaveTab, sessionSnapshot, selectSessionNoteLocally }: UseSessionNoteSyncResult = useSessionNoteSync({
    agent,
    username,
    canvas,
    port: sessionNoteSyncPort,
    sessionNoteLoadKeyRef,
    sessionNoteRemoteRefreshKey,
  });

  const railSessionNotes = useMemo<RailSessionNoteItem[]>(() => Array.isArray(sessionSnapshot.notes)
    ? sessionSnapshot.notes.map((note) => ({
        id: String(note.id || note.noteId || ''),
        noteId: String(note.noteId || note.id || ''),
        sessionId: typeof (note as any).sessionId === 'string' ? (note as any).sessionId : null,
        title: typeof note.title === 'string' ? note.title : 'Session note',
        contentHtml: typeof note.contentHtml === 'string' ? note.contentHtml : null,
      }))
    : [], [sessionSnapshot.notes]);

  const clearCanvasRailSelection = useCallback(() => {
    setIsCanvasProjectTreeSectionOpen(false);
    setIsCanvasSessionNotesSectionOpen(false);
  }, []);

  const handleCreateScratchTab = useCallback(() => {
    const existingScratchIndexes = canvas.tabs
      .map((tab: any) => String(tab.path || ''))
      .filter((path: string) => path.startsWith('.scratch/untitled-') && path.endsWith('.md'))
      .map((path: string) => {
        const match = path.match(/untitled-(\d+)\.md$/);
        return match ? Number(match[1]) : 0;
      });
    const nextIndex = existingScratchIndexes.length ? Math.max(...existingScratchIndexes) + 1 : 1;
    const scratchPath = `.scratch/untitled-${nextIndex}.md`;
    canvas.openFile(scratchPath, '');
    canvas.setActiveCanvasTab('editor');
    setIsCanvasProjectTreeSectionOpen(true);
    setIsCanvasSessionNotesSectionOpen(false);
  }, [canvas]);

  const handleSaveAsTab = async (_tabId: string, content: string, currentPath: string) => {
    const suggestedPath = window.prompt('Save as path', currentPath);
    if (!suggestedPath) return;
    const trimmedPath = suggestedPath.trim();
    if (!trimmedPath || trimmedPath.startsWith('.session-note/')) return;
    try {
      await SystemService.writeFile(trimmedPath, content, 'manual-save-as');
      if (typeof canvas.upsertTab === 'function') {
        canvas.upsertTab(trimmedPath, content, { activate: true });
      } else {
        canvas.openFile(trimmedPath, content);
      }
      canvas.setActiveCanvasTab('editor');
    } catch (e: any) {
      console.error('Save As failed:', e);
      window.alert(`Save As failed for ${trimmedPath}`);
    }
  };

  const isDarkTheme = document.documentElement.classList.contains('dark');
  useEffect(() => {
    if (pendingApproval && pendingApproval.agentId === agent.id) {
      canvas.setActiveCanvasTab('commands');
      if (!canvas.isCanvasVisible) canvas.toggleCanvas();
    }
  }, [pendingApproval, agent.id]);

  const shellState = {
    isCanvasVisible: canvas.isCanvasVisible,
    isCanvasProjectTreeSectionOpen,
    isCanvasSessionNotesSectionOpen,
  };

  const openSessionNoteFromRail = useCallback(async (noteId: string, noteSessionId?: string | null) => {
    const canonicalNoteId = String(noteId || '').trim();
    const explicitSessionId = String(noteSessionId || '').trim() || null;
    if (!canonicalNoteId) return;

    if (!canvas.isCanvasVisible) canvas.toggleCanvas();
    canvas.setActiveCanvasTab('editor');
    setIsCanvasSessionNotesSectionOpen(false);
    setIsCanvasProjectTreeSectionOpen(false);

    const optimisticNote = explicitSessionId
      ? sessionSnapshot.notes.find((note) => String(note?.noteId || note?.id || '').trim() === canonicalNoteId) || null
      : null;
    const optimisticResolved = optimisticNote
      ? {
          ...optimisticNote,
          id: canonicalNoteId,
          noteId: canonicalNoteId,
          title: typeof optimisticNote.title === 'string' ? optimisticNote.title : 'Session note',
          contentHtml: typeof optimisticNote.contentHtml === 'string' ? optimisticNote.contentHtml : undefined,
        }
      : null;
    const hasOptimisticContent = typeof optimisticResolved?.contentHtml === 'string' && optimisticResolved.contentHtml.length > 0;

    if (optimisticResolved && hasOptimisticContent && explicitSessionId) {
      selectSessionNoteLocally(optimisticResolved, { activate: true });
      const optimisticPath = getSessionNoteIdentity({ id: canonicalNoteId, noteId: canonicalNoteId }, explicitSessionId, canonicalNoteId).path;
      if (typeof canvas.pinTabByPath === 'function') {
        canvas.pinTabByPath(optimisticPath, optimisticResolved.title);
      }
      canvas.setActiveCanvasTab('editor');
    }

    const readResult = await ServerChat.readNote(username, canonicalNoteId, explicitSessionId || undefined).catch(() => null);
    if (readResult?.ambiguous) return;

    const resolvedSessionId = String(readResult?.sessionId || explicitSessionId || '').trim();
    const resolvedNote = readResult?.note && typeof readResult.note === 'object'
      ? {
          ...readResult.note,
          id: canonicalNoteId,
          noteId: canonicalNoteId,
          title: typeof readResult.note?.title === 'string' ? readResult.note.title : (optimisticResolved?.title || 'Session note'),
          contentHtml: typeof readResult.note?.contentHtml === 'string' ? readResult.note.contentHtml : (optimisticResolved?.contentHtml || ''),
        }
      : optimisticResolved;

    if (!resolvedNote || !resolvedSessionId) return;

    await ServerChat.setActiveSessionNote(resolvedSessionId, username, canonicalNoteId).catch(() => null);

    selectSessionNoteLocally(resolvedNote, { activate: true });
    const tabPath = getSessionNoteIdentity({ id: canonicalNoteId, noteId: canonicalNoteId }, resolvedSessionId, canonicalNoteId).path;
    if (typeof canvas.pinTabByPath === 'function') {
      canvas.pinTabByPath(tabPath, typeof resolvedNote.title === 'string' ? resolvedNote.title : 'Session note');
    }
    const existingTab = Array.isArray(canvas.tabs)
      ? canvas.tabs.find((tab: any) => String(tab?.path || '').trim() === String(tabPath).trim())
      : null;
    if (existingTab?.id && typeof canvas.markTabSaved === 'function') {
      canvas.markTabSaved(existingTab.id, typeof resolvedNote.contentHtml === 'string' ? resolvedNote.contentHtml : '');
    }
    canvas.setActiveCanvasTab('editor');
  }, [username, canvas, sessionSnapshot.notes, selectSessionNoteLocally]);


  const shellActions = {
    onEditAgent: onEditAgent ?? (() => {}),
    onCreateSessionNote: handleCreateSessionNote,
    onCreateScratchTab: handleCreateScratchTab,
    onSelectProject,
  onAddProject,
  onEditProject,
  onDeleteProject,
  onScanProject,
  scanLoading,
  scanDraft,
  onApproveContext,
  onDismissDraft,
    onApproveTool,
    onDenyTool,
    onClearCanvasRailSelection: clearCanvasRailSelection,
    onOpenSessionNoteFromRail: openSessionNoteFromRail,
    setIsCanvasProjectTreeSectionOpen,
    setIsCanvasSessionNotesSectionOpen,
    handleSaveTab,
    handleSaveAsTab,
  };

  return (
      <ChatCanvasShell
        agent={agent as any}
        pendingApproval={pendingApproval}
        chatContent={<ChatPanel agent={agent} isGenerating={isGenerating} onSendMessage={onSendMessage} onClearSummary={onClearSummary} onStop={onStop} syncStatus={syncStatus} isChatVisible={isChatVisible} onToggleChat={onToggleChat} />}
        isChatVisible={isChatVisible}
        shellState={shellState}
        canvas={canvas}
        isDarkTheme={isDarkTheme}
        shellActions={shellActions}
        sessionNotes={railSessionNotes}
        activeNoteId={sessionSnapshot.activeNoteId ?? null}
        projects={projects}
        activeProjectId={activeProjectId}
        onScanProject={onScanProject}
        scanLoading={scanLoading}
        scanDraft={scanDraft}
        onApproveContext={onApproveContext}
        onDismissDraft={onDismissDraft}
      />
  );
};

export default ChatInterface;
