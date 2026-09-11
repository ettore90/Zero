import { ModelConfig } from '../types';

export const generateDefaultScript = (config: ModelConfig): string => {
  if (config.provider === 'ollama') {
    return `/**
 * Ollama Default Request Logic
 * 
 * Auto-generated based on current settings.
 */

// 1. Prepare Model ID (strip 'models/' prefix if present)
const cleanModel = config.modelId.replace(/^models\\//, '');

// 2. Construct Endpoint
const baseUrl = config.baseUrl || '/orchestrator/ollama';
const url = baseUrl.replace(/\\/$/, '') + '/api/chat';

// 3. Return Payload
return {
  url: url,
  headers: { 
    'Content-Type': 'application/json' 
  },
  body: {
    model: cleanModel,
    messages: messages, // Ollama handles the internal message format (images etc) natively via the proxy or direct
    stream: true,
    options: { 
      num_ctx: 8192 
    }
  }
};`;
  }

  if (config.provider === 'sai') {
    return `/**
 * SAI Library - Chat Completion (OpenAI-compatible)
 * 
 * Uses legacy OpenAI Functions API (not Tools API) with X-Api-Key header only.
 * For Azure/OpenAI models via SAI that support native function calling.
 */

// 1. Get API Key
const apiKey = config.apiKey ? config.apiKey.trim() : "";

// 2. Construct Payload
const payload = {
  model: config.modelId || "gpt-5.6-luna",
  messages: messages,
  stream: false
};

// Tool format depends on the upstream behind SAI:
// - OpenAI gpt-5.x (gpt-5.6-luna, gpt-5.6-terra, ...) => Responses API, FLAT tools
// - everything else (gpt-4o/4.1, *-emea, o3/o4, grok) => nested chat-completions tools
// - gemini-* => proxied to Google, tools are not usable at all
if (tools && tools.length > 0) {
  const m = (config.modelId || '').toLowerCase();
  if (!/gemini/.test(m)) {
    payload.tools = /^gpt-5/.test(m) && !m.includes('emea')
      ? tools.map(({ function: fn }) => ({ type: 'function', ...fn }))
      : tools;
  }
}

return {
  url: 'https://sai-library.saiapplications.com/api/prompt/v1/chat/completions',
  headers: {
    'Content-Type': 'application/json',
    'X-Api-Key': apiKey
    // Authorization Bearer not needed for SAI
  },
  body: payload
};`;
  }

  return `/**
 * OpenAI-Compatible Default Request Logic
 * (Covers OpenAI, Groq, Gemini, DeepSeek, OpenRouter, etc)
 * 
 * Auto-generated based on current settings.
 */

let url = config.baseUrl;

// 1. Auto-Detect Endpoint if missing
if (!url) {
    if (config.provider === 'groq') url = 'https://api.groq.com/openai/v1/chat/completions';
    else if (config.provider === 'openai') url = 'https://api.openai.com/v1/chat/completions';
    else if (config.provider === 'gemini') url = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    else if (config.provider === 'openrouter') url = 'https://openrouter.ai/api/v1/chat/completions';
    else url = 'https://api.openai.com/v1/chat/completions';
} 
// Ensure it ends with /chat/completions if it's a standard root URL (and not a custom template)
else if (!url.endsWith('/chat/completions') && !url.includes('/execute') && !url.includes('/generate')) {
    url = url.replace(/\\/$/, '') + '/chat/completions';
}

// 2. Format Messages (Handle Vision/Images)
const finalMessages = messages.map(m => {
    if (m.images && m.images.length > 0) {
        return {
            role: m.role,
            content: [
                { type: 'text', text: m.content || '' },
                ...m.images.map(img => ({ 
                    type: 'image_url', 
                    image_url: { url: img } 
                }))
            ]
        };
    }
    return { 
        role: m.role, 
        content: m.content 
    };
});

// 3. Return Payload
return {
  url: url,
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + config.apiKey
  },
  body: {
    model: config.modelId,
    messages: finalMessages,
    stream: true
  }
};`;
};