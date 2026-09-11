import { ModelConfig, LogEntry } from '../types';
import { NEBULA_API_BASE } from '../constants';
import { parseOllamaStream, parseOpenAIStream, cleanLLMOutput } from './streamParsers';

interface LLMResult {
  content: string;
  tool_calls?: any[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  durationMs: number;
}

/**
 * Execute a chat request with "Waterfall" fallback logic.
 */
export const executeChatRequest = async (
  messages: any[],
  modelConfig: ModelConfig,
  allModels: ModelConfig[],
  onStream: (chunk: string) => void,
  onLog: (entry: LogEntry) => void,
  tools?: any[],
  signal?: AbortSignal
): Promise<LLMResult> => {
  try {
    return await callProvider(messages, modelConfig, onStream, onLog, tools, signal);
  } catch (error: any) {
    if (error.name === 'AbortError') throw error;

    console.warn(`Primary model ${modelConfig.name} failed:`, error);
    
    onLog({
      id: `err-${Date.now()}`,
      timestamp: Date.now(),
      type: 'error',
      method: `ERROR: ${modelConfig.provider.toUpperCase()}`,
      content: { message: error.message, stack: error.stack }
    });

    // Find a fallback that isn't the current one
    const fallback = allModels.find(m => m.isFallback && m.id !== modelConfig.id);
    
    if (fallback) {
      onLog({
        id: Date.now().toString(),
        timestamp: Date.now(),
        type: 'info',
        method: 'FALLBACK_TRIGGERED',
        content: `Switching to ${fallback.name} due to error: ${error.message}`
      });
      try {
        return await callProvider(messages, fallback, onStream, onLog, tools, signal);
      } catch (fbError: any) {
        if (fbError.name === 'AbortError') throw fbError;
        onLog({
          id: `err-fb-${Date.now()}`,
          timestamp: Date.now(),
          type: 'error',
          method: `ERROR: FALLBACK FAILED`,
          content: { message: fbError.message }
        });
        throw new Error(`Fallback (${fallback.name}) also failed: ${fbError.message}`);
      }
    }
    
    throw error;
  }
};

/**
 * Helper to simulate typing effect for non-streaming responses.
 * This slows down the UI rendering and the promise resolution, helping with rate limits.
 */
const streamTextSmoothly = async (text: string, onStream: (chunk: string) => void, signal?: AbortSignal) => {
    // Calculate a dynamic duration: longer text = longer stream, but cap at ~3 seconds to not be annoying
    const targetDuration = Math.min(text.length * 15, 3000); 
    const minStepTime = 20; // Minimum ms between frames
    
    // Determine number of steps
    const steps = Math.max(Math.floor(targetDuration / minStepTime), 1);
    const chunkSize = Math.ceil(text.length / steps);
    
    let currentIndex = 0;

    return new Promise<void>((resolve) => {
        const interval = setInterval(() => {
            if (signal?.aborted) {
                clearInterval(interval);
                resolve();
                return;
            }

            const nextIndex = Math.min(currentIndex + chunkSize, text.length);
            const chunk = text.slice(currentIndex, nextIndex);
            
            if (chunk) onStream(chunk);
            
            currentIndex = nextIndex;
            
            if (currentIndex >= text.length) {
                clearInterval(interval);
                resolve();
            }
        }, minStepTime);
    });
};




const normalizeOpenAICompatibleMessages = (messages: any[]) => {
  const normalized: any[] = [];

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (!message) continue;

    if (message.role === 'tool') {
      const previous = normalized.length > 0 ? normalized[normalized.length - 1] : null;
      const toolCallId = message.tool_call_id || `synthetic_call_${i}`;
      const toolName = message.name || 'unknown_tool';

      const previousHasMatchingToolCall =
        previous?.role === 'assistant' &&
        Array.isArray(previous.tool_calls) &&
        previous.tool_calls.some((tc: any) => tc?.id === toolCallId);

      if (previousHasMatchingToolCall) {
        normalized.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content: message.content || '',
          ...(message.name ? { name: message.name } : {})
        });
        continue;
      }

      if (previous?.role === 'assistant') {
        previous.tool_calls = [
          {
            id: toolCallId,
            type: 'function',
            function: {
              name: toolName,
              arguments: '{}'
            }
          }
        ];

        if (typeof previous.content !== 'string') {
          previous.content = '';
        }

        normalized.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content: message.content || '',
          ...(message.name ? { name: message.name } : {})
        });
        continue;
      }

      normalized.push({
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: toolCallId,
            type: 'function',
            function: {
              name: toolName,
              arguments: '{}'
            }
          }
        ]
      });

      normalized.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: message.content || '',
        ...(message.name ? { name: message.name } : {})
      });
      continue;
    }

    if (message.role === 'assistant') {
      const assistantMessage: any = {
        role: 'assistant',
        content: typeof message.content === 'string' ? message.content : ''
      };

      if (Array.isArray(message.images) && message.images.length > 0) {
        assistantMessage.images = message.images;
      }

      if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        assistantMessage.tool_calls = message.tool_calls.map((tc: any, index: number) => ({
          id: tc?.id || `synthetic_call_${i}_${index}`,
          type: 'function',
          function: {
            name: tc?.function?.name || tc?.name || '',
            arguments:
              typeof tc?.function?.arguments === 'string'
                ? tc.function.arguments
                : JSON.stringify(tc?.function?.arguments || tc?.arguments || {})
          }
        }));
      }

      normalized.push(assistantMessage);
      continue;
    }

    const normalizedMessage: any = {
      role: message.role,
      content: message.content || ''
    };

    if (Array.isArray(message.images) && message.images.length > 0) {
      normalizedMessage.images = message.images;
    }

    normalized.push(normalizedMessage);
  }

  return normalized;
};

const extractNonStreamingResponse = (json: any) => {
  let text = '';
  const toolCalls: any[] = [];

  if (Array.isArray(json?.choices) && json.choices[0]?.message) {
    const message = json.choices[0].message;
    text = message.content || '';
    if (Array.isArray(message.tool_calls)) {
      toolCalls.push(...message.tool_calls);
    }
  } else if (typeof json?.output_text === 'string') {
    text = json.output_text;
  } else if (Array.isArray(json?.output)) {
    for (const item of json.output) {
      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part?.type === 'output_text' && typeof part.text === 'string') {
            text += part.text;
          }
        }
      }
      if (item?.type === 'function_call') {
        toolCalls.push({
          id: item.call_id || item.id || `call_${toolCalls.length}`,
          type: 'function',
          function: {
            name: item.name || '',
            arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {})
          }
        });
      }
    }
  } else if (typeof json?.output === 'string') text = json.output;
  else if (typeof json?.result === 'string') text = json.result;
  else if (typeof json?.Result === 'string') text = json.Result;
  else text = JSON.stringify(json, null, 2);

  return { text: cleanLLMOutput(text), toolCalls };
};


const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getRetryAfterMs = (response: Response) => {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryDate = Date.parse(retryAfter);
  if (Number.isNaN(retryDate)) return null;

  return Math.max(0, retryDate - Date.now());
};

const isRetriableStatus = (status: number) => [408, 409, 425, 429, 500, 502, 503, 504].includes(status);

const calculateBackoffMs = (attempt: number, baseDelayMs = 1500, maxDelayMs = 12000) => {
  const jitter = Math.floor(Math.random() * 400);
  return Math.min(maxDelayMs, baseDelayMs * Math.pow(2, Math.max(0, attempt - 1))) + jitter;
};

const fetchWithRateLimitRetry = async (
  fetchUrl: string,
  fetchBody: string,
  config: ModelConfig,
  onLog: (entry: LogEntry) => void,
  signal?: AbortSignal
) => {
  const maxAttempts = 4;
  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(fetchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: fetchBody,
        redirect: 'manual',
        signal
      });

      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        throw new Error("Authentication Failed: API endpoint redirected to login page. Check API Key.");
      }

      if (response.ok) {
        return response;
      }

      const errText = await response.text();
      onLog({
        id: `err-body-${Date.now()}-${attempt}`,
        timestamp: Date.now(),
        type: 'error',
        method: `HTTP_${response.status}_BODY`,
        content: { status: response.status, statusText: response.statusText, body: errText, attempt, maxAttempts }
      });

      if (!isRetriableStatus(response.status) || attempt >= maxAttempts) {
        throw new Error(`HTTP ${response.status} (${response.statusText}): ${errText.substring(0, 500)}`);
      }

      const waitMs = getRetryAfterMs(response) ?? calculateBackoffMs(attempt);
      onLog({
        id: `retry-${Date.now()}-${attempt}`,
        timestamp: Date.now(),
        type: 'info',
        method: 'HTTP_RETRY_SCHEDULED',
        model: config.modelId,
        content: {
          provider: config.provider,
          status: response.status,
          statusText: response.statusText,
          attempt,
          maxAttempts,
          waitMs
        }
      });

      await sleep(waitMs);
    } catch (error: any) {
      lastError = error;
      if (error?.name === 'AbortError') throw error;

      if (attempt >= maxAttempts) {
        throw error;
      }

      const waitMs = calculateBackoffMs(attempt, 800, 8000);
      onLog({
        id: `retry-net-${Date.now()}-${attempt}`,
        timestamp: Date.now(),
        type: 'info',
        method: 'NETWORK_RETRY_SCHEDULED',
        model: config.modelId,
        content: {
          provider: config.provider,
          attempt,
          maxAttempts,
          waitMs,
          message: error?.message || String(error)
        }
      });

      await sleep(waitMs);
    }
  }

  throw lastError || new Error('Request failed after retry attempts');
};

const callProvider = async (
  messages: any[],
  config: ModelConfig,
  onStream: (chunk: string) => void,
  onLog: (entry: LogEntry) => void,
  tools?: any[],
  signal?: AbortSignal
): Promise<LLMResult> => {
  const startTime = Date.now();
  
  // Note: We no longer inject textual tool descriptions here.
  // Tools are passed via the native 'tools' JSON payload below.
  // Agents can call 'list_commands' if they need a refresher.
  const preparedMessages = [...messages];
  const preparedImageCount = preparedMessages.reduce((sum: number, message: any) => sum + (Array.isArray(message?.images) ? message.images.length : 0), 0);
  const lastPreparedMessage: any = preparedMessages.length > 0 ? preparedMessages[preparedMessages.length - 1] : null;
  console.log(`[LLMProvider] PREPARED | provider=${config.provider} | model=${config.modelId} | messages=${preparedMessages.length} | totalImages=${preparedImageCount} | lastRole=${lastPreparedMessage?.role || 'none'} | lastImages=${Array.isArray(lastPreparedMessage?.images) ? lastPreparedMessage.images.length : 0}`);

  // 1. Configuration & Custom Builder Execution
  const isOllama = config.provider === 'ollama';
  const isSaiVertex = config.provider === 'sai-vertex';
  const isSai = config.provider === 'sai';
  const isAzureOpenAI = config.provider === 'azure-openai' || config.provider === 'azure-foundry';
  let customRequest = null;
  let logicSource = 'STANDARD_PRESET';

  // Strict check: If requestBuilder exists and isn't empty/whitespace, WE USE IT.
  if (config.requestBuilder && config.requestBuilder.trim().length > 0) {
    logicSource = 'CUSTOM_SCRIPT';
    try {
      const builderFn = new Function('config', 'messages', config.requestBuilder);
      customRequest = builderFn(config, preparedMessages);

      if (!customRequest || typeof customRequest !== 'object') {
          throw new Error("Custom script executed but returned null/undefined. You MUST return an object: { url, headers, body }");
      }
      if (!customRequest.url) {
          throw new Error("Custom script result missing 'url' property.");
      }
      onLog({
        id: `build-${Date.now()}`,
        timestamp: Date.now(),
        type: 'info',
        method: 'JS_BUILDER_RESULT',
        content: { ...customRequest, _note: "Generated from custom script." }
      });
    } catch (e: any) {
      throw new Error(`Custom Request Script Failed: ${e.message}`);
    }
  }

  // 2. Body Construction
  let targetUrl = '';
  let headers: any = { 'Content-Type': 'application/json' };
  let payload: any;
  let useProxyWrapper = !config.bypassProxy;
  let isStreaming = !isSaiVertex;

  if (customRequest) {
    targetUrl = customRequest.url;
    headers = customRequest.headers || headers;
    payload = customRequest.body;
    if (payload.stream === false) isStreaming = false;
    if (typeof customRequest.useProxy === 'boolean') {
        useProxyWrapper = customRequest.useProxy;
    } else if (customRequest.url.includes('/api/proxy') || customRequest.url.includes('/orchestrator/api/proxy')) {
        useProxyWrapper = false;
    }
  } else {
    const cleanModelId = config.modelId.replace(/^models\//, '');
    
    if (isOllama) {
        const defaultBase = config.bypassProxy ? 'http://127.0.0.1:11434' : '/orchestrator/ollama';
        targetUrl = `${config.baseUrl || defaultBase}/api/chat`;
        useProxyWrapper = false; 

        payload = {
          model: cleanModelId,
          messages: preparedMessages,
          stream: true,
          options: { num_ctx: 8192 }
        };
        if (tools && tools.length > 0) payload.tools = tools;
    } else if (isSaiVertex) {
        let baseUrl = config.baseUrl || 'https://sai-library.saiapplications.com/api/prompt/v1/chat/completions';
        
        // If user provided just the domain, try to fix it, otherwise trust the user input
        if (config.baseUrl && !config.baseUrl.includes('/chat/completions')) {
             baseUrl = `${config.baseUrl.replace(/\/$/, '')}/api/prompt/v1/chat/completions`;
        }
        targetUrl = baseUrl;

        const rawKey = config.apiKey ? config.apiKey.trim() : '';
        const cleanKey = rawKey.replace(/^Bearer\s+/i, '');

        // Specific headers for SAI
        headers['X-Api-Key'] = cleanKey;
        headers['Authorization'] = `Bearer ${cleanKey}`;

        // Standard OpenAI-like payload, but with stream: false forced
        const finalMessages = normalizeOpenAICompatibleMessages(preparedMessages).map((m: any) => {
            if (m.images && m.images.length > 0) {
                const parts: any[] = [{ type: 'text', text: m.content || '' }];
                m.images.forEach((img: string) => {
                    parts.push({ type: 'image_url', image_url: { url: img, detail: 'auto' } });
                });
                return { ...m, content: parts, images: undefined };
            }
            return m;
        });

        payload = {
            model: cleanModelId || "gemini-2.5-flash",
            messages: finalMessages,
            stream: false
        };
        console.log(`[LLMProvider] SAI_VERTEX_PAYLOAD | messages=${finalMessages.length} | multimodalMessages=${finalMessages.filter((m: any) => Array.isArray(m?.content)).length} | lastContentType=${Array.isArray(finalMessages[finalMessages.length - 1]?.content) ? 'array' : typeof finalMessages[finalMessages.length - 1]?.content}`);
        isStreaming = false;
    } else if (isSai) {
        // SAI OpenAI-compatible (Azure/GPT models with native tool calling)
        // Uses legacy Functions API: send 'functions' instead of 'tools'
        let baseUrl = config.baseUrl || 'https://sai-library.saiapplications.com/api/prompt/v1/chat/completions';
        if (config.baseUrl && !config.baseUrl.includes('/chat/completions')) {
             baseUrl = `${config.baseUrl.replace(/\/$/, '')}/api/prompt/v1/chat/completions`;
        }
        targetUrl = baseUrl;

        const rawKey = config.apiKey ? config.apiKey.trim() : '';
        const cleanKey = rawKey.replace(/^Bearer\s+/i, '');
        // SAI requires X-Api-Key header only; Authorization Bearer not needed
        headers['X-Api-Key'] = cleanKey;

        payload = {
          model: cleanModelId,
          messages: preparedMessages,
          stream: false
        };
        if (tools && tools.length > 0) {
            const lowerModel = cleanModelId.toLowerCase();
            if (/gemini/.test(lowerModel)) {
                // Proxied to Google's native API: neither tool shape is accepted there.
                console.warn(`[LLMProvider] SAI: dropping tools, ${cleanModelId} cannot use them`);
            } else if (/^gpt-5/.test(lowerModel) && !lowerModel.includes('emea')) {
                // OpenAI gpt-5.x (incl. gpt-5.6-luna/terra) is served via the Responses
                // API, which wants FLAT tool definitions and rejects `functions`.
                payload.tools = tools.map(({ function: fn }) => ({ type: 'function', ...fn }));
            } else {
                payload.tools = tools.map(({ weight: _w, group: _g, ...t }: any) => t);
            }
        }
        isStreaming = false;
    } else {
        let base = config.baseUrl;

        if (isAzureOpenAI) {
            if (!base) {
                throw new Error('Azure OpenAI/Azure Foundry requires a baseUrl.');
            }

            // Azure AI Foundry / Azure OpenAI — Chat Completions API
            // Endpoint: /openai/deployments/{deployment}/chat/completions?api-version=...
            // Auth: api-key header (not Bearer)
            const apiVersionResolved = config.apiVersion || '2024-12-01-preview';
            const deployment = config.modelId.replace(/^models\//, '');
            targetUrl = `${base.replace(/\/$/, '')}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersionResolved)}`;
            headers['api-key'] = config.apiKey;
            delete headers['Authorization'];
            isStreaming = false;

            const finalMessages = normalizeOpenAICompatibleMessages(preparedMessages).map((m: any) => {
                if (m.images && m.images.length > 0) {
                    const parts: any[] = [{ type: 'text', text: m.content || '' }];
                    m.images.forEach((img: string) => {
                        parts.push({ type: 'image_url', image_url: { url: img, detail: 'auto' } });
                    });
                    return { ...m, content: parts, images: undefined };
                }
                return m;
            });

            payload = {
                messages: finalMessages,
                ...(config.maxTokens ? { max_completion_tokens: config.maxTokens } : {}),
                ...(config.temperature != null && !String(deployment).toLowerCase().includes('gpt-5')
                    ? { temperature: config.temperature }
                    : {})
            };

            if (tools && tools.length > 0) payload.tools = tools;
        } else {
            if (config.provider === 'gemini' && (!base || base.includes('googleapis.com'))) {
                base = 'https://generativelanguage.googleapis.com/v1beta/openai';
            } else if (!base) {
                if (config.provider === 'groq') base = 'https://api.groq.com/openai/v1';
                else if (config.provider === 'openai') base = 'https://api.openai.com/v1';
                else if (config.provider === 'openrouter') base = 'https://openrouter.ai/api/v1';
            }

            if (base && !base.endsWith('/chat/completions')) {
                targetUrl = `${base.replace(/\/$/, '')}/chat/completions`;
            } else {
                targetUrl = base || '';
            }

            headers['Authorization'] = `Bearer ${config.apiKey}`;

            const finalMessages = normalizeOpenAICompatibleMessages(preparedMessages).map((m: any) => {
                if (m.images && m.images.length > 0) {
                    const parts: any[] = [{ type: 'text', text: m.content || '' }];
                    m.images.forEach((img: string) => {
                        parts.push({ type: 'image_url', image_url: { url: img, detail: 'auto' } });
                    });
                    return { ...m, content: parts, images: undefined };
                }
                return m;
            });

            payload = {
                model: cleanModelId,
                messages: finalMessages,
                stream: true,
                ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
                ...(config.temperature != null && !String(cleanModelId).toLowerCase().includes('gpt-5')
                    ? { temperature: config.temperature }
                    : {})
            };

            if (tools && tools.length > 0) payload.tools = tools;
        }
    }
  }

  // 3. Network Request
  let fetchBody;
  let fetchUrl;

  if (useProxyWrapper) {
      fetchUrl = `${NEBULA_API_BASE}/proxy`;
      fetchBody = JSON.stringify({ targetUrl, headers, body: payload });
  } else {
      fetchUrl = targetUrl;
      fetchBody = JSON.stringify(payload);
  }

  const loggableBody = JSON.parse(fetchBody);
  if (useProxyWrapper) {
      if (loggableBody.headers?.Authorization) loggableBody.headers.Authorization = 'Bearer [HIDDEN]';
      if (loggableBody.headers?.['X-Api-Key']) loggableBody.headers['X-Api-Key'] = '[HIDDEN]';
  } else {
      if (loggableBody.headers?.Authorization) loggableBody.headers.Authorization = 'Bearer [HIDDEN]';
  }

  onLog({
    id: `net-${Date.now()}`,
    timestamp: Date.now(),
    type: 'request',
    method: 'BROWSER_FETCH',
    model: config.modelId,
    content: { logicSource, url: fetchUrl, isProxyWrapper: useProxyWrapper, payload: loggableBody }
  });

  const response = await fetchWithRateLimitRetry(fetchUrl, fetchBody, config, onLog, signal);

  if (!response.body) throw new Error("Empty response body from provider");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  const accumulatedToolCalls: any[] = [];
  const toolCallAccumulator = new Map<number, any>();
  let buffer = '';
  
  // Usage tracking
  let usage: LLMResult['usage'] = undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    // Check signal manually in case stream stalls
    if (signal?.aborted) {
        reader.cancel();
        throw new DOMException('Aborted', 'AbortError');
    }

    const chunk = decoder.decode(value, { stream: true });
    
    if (!isStreaming) {
        fullContent += chunk; 
        continue; 
    }

    if (isOllama && !customRequest) {
        buffer = parseOllamaStream(
            chunk, 
            buffer,
            (txt) => { fullContent += txt; onStream(txt); },
            (tool) => accumulatedToolCalls.push(tool),
            (meta) => {
                if (meta) {
                    usage = {
                        prompt_tokens: meta.prompt_eval_count || 0,
                        completion_tokens: meta.eval_count || 0,
                        total_tokens: (meta.prompt_eval_count || 0) + (meta.eval_count || 0)
                    };
                }
            }
        );
    } else {
        buffer = parseOpenAIStream(
            chunk,
            buffer,
            (txt) => { fullContent += txt; onStream(txt); },
            (toolDelta) => {
                const index = toolDelta.index;
                if (!toolCallAccumulator.has(index)) {
                    toolCallAccumulator.set(index, {
                        index,
                        id: toolDelta.id,
                        type: toolDelta.type || 'function',
                        function: { name: '', arguments: '' }
                    });
                }
                const current = toolCallAccumulator.get(index);
                if (toolDelta.id) current.id = toolDelta.id;
                if (toolDelta.function?.name) current.function.name += toolDelta.function.name;
                if (toolDelta.function?.arguments) current.function.arguments += toolDelta.function.arguments;
            },
            (meta) => {
                if (meta) {
                    usage = {
                        prompt_tokens: meta.prompt_tokens || 0,
                        completion_tokens: meta.completion_tokens || 0,
                        total_tokens: meta.total_tokens || 0
                    };
                }
            }
        );
    }
  }

  // Handle Non-Streaming Responses (Fake Stream logic)
  if (!isStreaming) {
      try {
          const json = JSON.parse(fullContent);
          const extracted = extractNonStreamingResponse(json);
          fullContent = extracted.text;

          if (extracted.toolCalls.length > 0) {
              accumulatedToolCalls.push(...extracted.toolCalls);
          }

          await streamTextSmoothly(fullContent, onStream, signal);

          if (json.usage) {
              usage = {
                  prompt_tokens: json.usage.prompt_tokens || json.usage.input_tokens || 0,
                  completion_tokens: json.usage.completion_tokens || json.usage.output_tokens || 0,
                  total_tokens:
                      json.usage.total_tokens ||
                      ((json.usage.input_tokens || 0) + (json.usage.output_tokens || 0))
              };
          }
      } catch (e) {
          fullContent = cleanLLMOutput(fullContent);
          await streamTextSmoothly(fullContent, onStream, signal);
      }
  }

  if (toolCallAccumulator.size > 0) {
      accumulatedToolCalls.push(...Array.from(toolCallAccumulator.values()));
  }

  // Fallback usage estimation if none returned
  if (!usage) {
      const estimatedTokens = Math.ceil(fullContent.length / 4);
      usage = {
          prompt_tokens: 0,
          completion_tokens: estimatedTokens,
          total_tokens: estimatedTokens
      };
  }

  const duration = Date.now() - startTime;
  onLog({
    id: Date.now().toString(),
    timestamp: Date.now(),
    type: 'response',
    method: 'HTTP_RESPONSE',
    model: config.modelId,
    durationMs: duration,
    tokens: usage.total_tokens,
    tokensPerSec: duration > 0 ? parseFloat((usage.completion_tokens / (duration / 1000)).toFixed(2)) : 0,
    content: { 
        contentLength: fullContent.length, 
        toolCalls: accumulatedToolCalls.length,
        usage 
    }
  });

  return {
    content: fullContent,
    tool_calls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
    durationMs: duration,
    usage
  };
};
