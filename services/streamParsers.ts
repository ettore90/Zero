// Llama 3 and other model control tokens to strip
const CONTROL_TOKENS_REGEX = /<\|begin_of_text\|>|<\|start_header_id\|>.*?<\|end_header_id\|>|<\|eot_id\|>|<\|end_of_text\|>|<\|reserved_special_token_\d+\|>/g;

export const cleanLLMOutput = (text: string): string => {
  if (!text) return '';
  return text.replace(CONTROL_TOKENS_REGEX, '');
};

/**
 * Handles parsing of Ollama's NDJSON stream format.
 * Returns the remaining buffer string.
 */
export const parseOllamaStream = (
    chunk: string, 
    buffer: string,
    onContent: (text: string) => void, 
    onTool: (tool: any) => void,
    onMetadata?: (meta: any) => void
  ): string => {
    const combined = buffer + chunk;
    const lines = combined.split('\n');
    
    // The last line might be incomplete, so we keep it in the buffer
    // unless the chunk ended with a newline.
    const remainingBuffer = lines.pop() || '';
  
    for (const line of lines) {
      if (line.trim() === '') continue;
      try {
        const json = JSON.parse(line);
        
        if (json.message?.content) {
          const cleanText = cleanLLMOutput(json.message.content);
          if (cleanText) onContent(cleanText);
        }
        
        if (json.message?.tool_calls) {
           json.message.tool_calls.forEach((tc: any) => onTool(tc));
        }

        // Check for final usage stats (Ollama sends 'done: true' with stats)
        if (json.done && onMetadata) {
            onMetadata({
                prompt_eval_count: json.prompt_eval_count || 0,
                eval_count: json.eval_count || 0,
                total_duration: json.total_duration,
                load_duration: json.load_duration
            });
        }

      } catch (e) { 
        // If strict JSON parsing fails despite split, we log but don't crash
      }
    }
    
    return remainingBuffer;
  };
  
  /**
   * Handles parsing of OpenAI/Groq SSE (Server-Sent Events) stream format.
   * Returns the remaining buffer string.
   */
  export const parseOpenAIStream = (
    chunk: string, 
    buffer: string,
    onContent: (text: string) => void,
    onTool: (tool: any) => void,
    onMetadata?: (meta: any) => void
  ): string => {
    const combined = buffer + chunk;
    const lines = combined.split('\n');
    const remainingBuffer = lines.pop() || '';
  
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const dataStr = line.slice(6);
        if (dataStr === '[DONE]') continue;
        try {
          const json = JSON.parse(dataStr);
          const delta = json.choices[0]?.delta;
          
          if (delta?.content) {
            const cleanText = cleanLLMOutput(delta.content);
            if (cleanText) onContent(cleanText);
          }

          // OpenAI sends tool_calls in chunks (deltas)
          if (delta?.tool_calls) {
            delta.tool_calls.forEach((tc: any) => onTool(tc));
          }

          // SAI Functions API: sends function_call (flat) instead of tool_calls
          if (delta?.function_call) {
            // Emit as a single tool call at index 0 (SAI uses single function_call)
            onTool({
              index: 0,
              id: undefined, // will be generated if missing by accumulator
              type: 'function',
              function: {
                name: delta.function_call.name || '',
                arguments: delta.function_call.arguments || ''
              }
            });
          }

          // Some providers send usage in the final chunk (OpenAI style standard)
          if (json.usage && onMetadata) {
              onMetadata(json.usage);
          }

        } catch (e) {}
      }
    }
    
    return remainingBuffer;
  };