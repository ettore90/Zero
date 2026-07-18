import { Agent, LogEntry, Message, ToolCall } from '../types';

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
    tool_calls?: ToolCall[];
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

export const checkOllamaConnection = async (host: string): Promise<boolean> => {
  try {
    const res = await fetch(`${host}/api/tags`);
    return res.ok;
  } catch (e) {
    return false;
  }
};

export const fetchModels = async (host: string): Promise<string[]> => {
  try {
    const res = await fetch(`${host}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.models.map((m: { name: string }) => m.name);
  } catch (e) {
    console.error("Error fetching models", e);
    return [];
  }
};

export const generateChatResponse = async (
  host: string,
  agent: Agent,
  userMessage: string | null,
  onStream: (chunk: string) => void,
  onLog?: (entry: LogEntry) => void,
  images?: string[],
  tools?: ToolDefinition[]
): Promise<{ content: string; tool_calls?: ToolCall[] }> => {
  
  const messagesToSend: Array<{
    role: string;
    content: string;
    images?: string[];
    tool_calls?: ToolCall[];
    tool_call_id?: string;
  }> = [];

  // System context
  let systemContent = agent.systemPrompt;
  if (agent.summary) {
    systemContent += `\n\n[CONTEXT SUMMARY]: ${agent.summary}`;
  }
  
  messagesToSend.push({ role: 'system', content: systemContent });

  // Add relevant history
  const recentHistory = agent.history.slice(-10); 
  recentHistory.forEach((msg: Message) => {
    if (msg.role !== 'system') {
        const payload: {
          role: string;
          content: string;
          images?: string[];
          tool_calls?: ToolCall[];
          tool_call_id?: string;
        } = { 
          role: msg.role, 
          content: msg.content,
        };
        
        if (msg.images && msg.images.length > 0) {
            payload.images = msg.images.map(img => img.split(',')[1] || img);
        }

        if (msg.role === 'assistant' && msg.tool_calls) {
            payload.tool_calls = msg.tool_calls;
        }

        if (msg.role === 'tool' && msg.tool_call_id) {
            payload.tool_call_id = msg.tool_call_id;
        }

        messagesToSend.push(payload);
    }
  });

  // Add current user message if it exists
  if (userMessage) {
      messagesToSend.push({ 
        role: 'user', 
        content: userMessage,
        images: images?.map(img => img.split(',')[1] || img)
      });
  }

  const payload: any = {
    model: agent.model,
    messages: messagesToSend,
    stream: true,
    options: {
        num_ctx: 8192
    }
  };

  if (tools && tools.length > 0) {
      payload.tools = tools;
  }

  if (onLog) {
      onLog({
          id: Date.now().toString(),
          timestamp: Date.now(),
          type: 'request',
          method: 'POST /api/chat',
          model: agent.model,
          content: { ...payload, messages: `${payload.messages.length} messages in context` }
      });
  }

  try {
    const response = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(`Ollama Error: ${response.statusText}`);
    }

    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    const accumulatedToolCalls: ToolCall[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        try {
          const json: OllamaChatResponse = JSON.parse(line);
          
          // Handle Content
          if (json.message?.content) {
            fullResponse += json.message.content;
            onStream(json.message.content);
          }

          // Handle Tool Calls (Accumulate them)
          if (json.message?.tool_calls) {
             json.message.tool_calls.forEach((tc: ToolCall) => {
                 accumulatedToolCalls.push(tc);
             });
          }

          if (json.done) {
            if (onLog) {
                const evalDurationS = (json.eval_duration || 0) / 1000000000;
                const tokens = json.eval_count || 0;
                const tps = evalDurationS > 0 ? tokens / evalDurationS : 0;

                onLog({
                    id: Date.now().toString(),
                    timestamp: Date.now(),
                    type: 'response',
                    method: 'DONE',
                    model: agent.model,
                    durationMs: Math.round((json.total_duration || 0) / 1000000),
                    tokens: tokens,
                    tokensPerSec: parseFloat(tps.toFixed(2)),
                    content: { ...json, tool_calls_count: accumulatedToolCalls.length }
                });
            }
            break;
          }
        } catch (e) {}
      }
    }

    return { content: fullResponse, tool_calls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined };

  } catch (error: any) {
    if (onLog) {
        onLog({
            id: Date.now().toString(),
            timestamp: Date.now(),
            type: 'error',
            method: 'Network Error',
            content: error.message
        });
    }
    throw error;
  }
};

export const summarizeConversation = async (host: string, agent: Agent): Promise<string> => {
    if (agent.history.length < 4) return agent.summary;
    const messagesToSummarize = agent.history.slice(0, -3);
    const textToSummarize = messagesToSummarize.map(m => `${m.role}: ${m.content}`).join('\n');
    const prompt = `Summarize key facts from this conversation. Previous summary: "${agent.summary}". \n\nConversation:\n${textToSummarize}`;

    try {
        const response = await fetch(`${host}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: agent.model,
              prompt: prompt,
              stream: false
            }),
          });
        const data = await response.json();
        return data.response;
    } catch (e) {
        return agent.summary;
    }
};