
// Regex for detecting <think> blocks
const THINK_REGEX = /<think>([\s\S]*?)(?:<\/think>|$)/g;
const CALL_REGEX = /\[CALL:\s*([a-zA-Z0-9_\s\-]+)\]/i;

export interface ThoughtPart {
  type: 'text' | 'thought';
  content: string;
}

/**
 * Parses text into content and thought blocks.
 */
export const parseThinkBlocks = (content: string): ThoughtPart[] => {
  const parts: ThoughtPart[] = [];
  let lastIndex = 0;
  let match;

  while ((match = THINK_REGEX.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: content.substring(lastIndex, match.index) });
    }
    parts.push({ type: 'thought', content: match[1] });
    lastIndex = THINK_REGEX.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', content: content.substring(lastIndex) });
  }

  return parts;
};

/**
 * Detects agent delegation commands.
 */
export const detectDelegation = (text: string): string | null => {
  const match = text.match(CALL_REGEX);
  return match ? match[1].trim() : null;
};

/**
 * Robustly cleans JSON from LLM output (handles markdown blocks).
 */
export const extractJson = (text: string): any => {
  try {
    // Remove markdown code blocks
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error("JSON Parse Error on:", text);
    throw new Error("Failed to parse JSON from model output");
  }
};

/**
 * Safe ID generator
 */
export const generateId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

/**
 * Returns the current "wall clock" date/time in a given IANA timezone.
 * e.g. timezone = 'America/New_York' → returns a Date whose local fields
 * (getHours, getDate, getDay…) reflect that timezone.
 */
const nowInTimezone = (timezone?: string): Date => {
    if (!timezone) return new Date();
    try {
        // Use Intl to get the current time parts in the target timezone
        const fmt = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false,
        });
        const parts = fmt.formatToParts(new Date());
        const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value || '0');
        // Build a local Date with those fields (treated as local time for arithmetic)
        return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    } catch {
        return new Date();
    }
};

/**
 * Calculates the next UTC timestamp for a schedule, respecting the user's timezone.
 * The `time` field (HH:mm) is interpreted in the given timezone.
 */
export const calculateNextRun = (
    type: 'once' | 'daily' | 'weekly',
    time?: string,
    days?: number[],
    timezone?: string
): number => {
    // Work in the target timezone's "local" representation
    const now = nowInTimezone(timezone);
    const next = new Date(now);

    if (type === 'once' && !time) {
        // No time specified → run in 1 minute from real now
        return Date.now() + 60000;
    }

    if (time) {
        const [hours, minutes] = time.split(':').map(Number);
        next.setHours(hours, minutes, 0, 0);
    } else {
        next.setHours(next.getHours() + 1, 0, 0, 0);
    }

    // Daily / once logic
    if (type === 'daily' || type === 'once') {
        if (next.getTime() <= now.getTime()) {
            next.setDate(next.getDate() + 1);
        }
    }

    // Weekly logic
    if (type === 'weekly' && days && days.length > 0) {
        for (let i = 0; i < 8; i++) {
            const candidate = new Date(now);
            candidate.setDate(now.getDate() + i);
            if (time) {
                const [h, m] = time.split(':').map(Number);
                candidate.setHours(h, m, 0, 0);
            }
            if (candidate.getTime() <= now.getTime()) continue;
            if (days.includes(candidate.getDay())) {
                // Convert back: offset between tz-local "now" and real UTC now
                const offset = Date.now() - now.getTime();
                return candidate.getTime() + offset;
            }
        }
        next.setDate(next.getDate() + 1);
    }

    // Convert tz-local timestamp back to UTC
    const offset = Date.now() - now.getTime();
    return next.getTime() + offset;
};