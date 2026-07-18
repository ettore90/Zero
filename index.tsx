import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

declare global {
  interface Window {
    __APP_STARTUP_LOG__?: ((event: string, details?: unknown) => void) & {
      history?: unknown[];
      entries?: unknown[];
      buffer?: unknown[];
      events?: unknown[];
      logs?: unknown[];
      breadcrumbs?: unknown[];
      recent?: unknown[];
    };
    __APP_STARTUP_DIAGNOSTICS__?: {
      history?: unknown[];
      entries?: unknown[];
      buffer?: unknown[];
      events?: unknown[];
      logs?: unknown[];
      breadcrumbs?: unknown[];
      recent?: unknown[];
    };
    __APP_STARTUP_FATAL__?: (title?: string, message?: string, extra?: string) => void;
  }
}

const startupLog = (event: string, details?: unknown) => {
  try {
    if (typeof window !== 'undefined' && typeof window.__APP_STARTUP_LOG__ === 'function') {
      window.__APP_STARTUP_LOG__(event, details);
      return;
    }
  } catch {}

  try {
    console.log('[app-startup:fallback]', { event, details });
  } catch {}
};

const showFatalScreen = (title: string, message: string, extra?: string) => {
  try {
    if (typeof window !== 'undefined' && typeof window.__APP_STARTUP_FATAL__ === 'function') {
      window.__APP_STARTUP_FATAL__(title, message, extra);
    }
  } catch {}
};

const getRecentBreadcrumbs = (): string[] => {
  try {
    if (typeof window === 'undefined') return [];

    const sources = [
      window.__APP_STARTUP_DIAGNOSTICS__,
      window.__APP_STARTUP_LOG__,
    ];

    for (const source of sources) {
      if (!source || typeof source !== 'object') continue;

      const candidate =
        ('recent' in source && Array.isArray(source.recent) && source.recent) ||
        ('breadcrumbs' in source && Array.isArray(source.breadcrumbs) && source.breadcrumbs) ||
        ('history' in source && Array.isArray(source.history) && source.history) ||
        ('entries' in source && Array.isArray(source.entries) && source.entries) ||
        ('buffer' in source && Array.isArray(source.buffer) && source.buffer) ||
        ('events' in source && Array.isArray(source.events) && source.events) ||
        ('logs' in source && Array.isArray(source.logs) && source.logs);

      if (!candidate) continue;

      return candidate
        .slice(-8)
        .map((entry) => {
          if (typeof entry === 'string') return entry;
          if (entry instanceof Error) return entry.message;
          if (entry && typeof entry === 'object' && 'event' in entry) {
            const event = typeof entry.event === 'string' ? entry.event : JSON.stringify(entry.event);
            const details = 'details' in entry ? entry.details : undefined;
            return details === undefined ? event : `${event} ${JSON.stringify(details)}`;
          }
          try {
            return JSON.stringify(entry);
          } catch {
            return String(entry);
          }
        })
        .filter(Boolean);
    }
  } catch {}

  return [];
};

class StartupErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    startupLog('index.tsx:error-boundary:caught', {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
    showFatalScreen('Application failed to render', error.message || 'An unexpected startup error occurred.');
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    const breadcrumbs = getRecentBreadcrumbs();

    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#0f172a',
          color: '#e2e8f0',
          padding: '24px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '960px',
            background: 'rgba(15, 23, 42, 0.92)',
            border: '1px solid rgba(148, 163, 184, 0.35)',
            borderRadius: '12px',
            padding: '24px',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.35)',
          }}
        >
          <h1 style={{ margin: '0 0 12px', fontSize: '20px', color: '#f8fafc' }}>
            Application failed to render
          </h1>
          <p style={{ margin: '0 0 16px', color: '#cbd5e1' }}>
            {this.state.error.message || 'An unexpected startup error occurred.'}
          </p>
          {breadcrumbs.length > 0 && (
            <div>
              <h2 style={{ margin: '0 0 8px', fontSize: '14px', color: '#94a3b8' }}>
                Recent startup breadcrumbs
              </h2>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: '12px',
                  lineHeight: 1.5,
                  color: '#e2e8f0',
                }}
              >
                {breadcrumbs.join('\n')}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }
}

startupLog('index.tsx:bootstrap:start');

const rootElement = document.getElementById('root');
startupLog('index.tsx:root:lookup', { found: !!rootElement });

if (!rootElement) {
  const error = new Error('Could not find root element to mount to');
  startupLog('index.tsx:root:missing', { message: error.message });
  showFatalScreen('Application failed to start', error.message);
  throw error;
}

try {
  const root = ReactDOM.createRoot(rootElement);
  startupLog('index.tsx:react-render:start');
  root.render(
    <React.StrictMode>
      <StartupErrorBoundary>
        <App />
      </StartupErrorBoundary>
    </React.StrictMode>
  );
  startupLog('index.tsx:react-render:success');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  startupLog('index.tsx:react-render:failure', {
    message,
    stack: error instanceof Error ? error.stack : undefined,
  });
  showFatalScreen('Application failed to start', message);
  throw error;
}
