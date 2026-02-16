/**
 * Helpers for extracting weather locations from tool-call arguments.
 */

export interface ParsedToolArgs {
  location: string;
}

export interface LegacyToolCallMarkup {
  functionName: string;
  location: string;
}

const LOCATION_ALIASES: Record<string, string> = {
  sf: 'San Francisco, California, US',
  'san fran': 'San Francisco, California, US',
  nyc: 'New York City, New York, US',
  la: 'Los Angeles, California, US',
};

function stripOuterQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('“') && value.endsWith('”')) ||
    (value.startsWith('‘') && value.endsWith('’'))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

export function normalizeLocationInput(value: string | undefined): string | null {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;

  const normalized = stripOuterQuotes(trimmed)
    .replace(/\s+/g, ' ')
    .replace(/[.!?;:]+$/g, '')
    .trim();

  return normalized || null;
}

export function expandLocationAlias(value: string): string {
  return LOCATION_ALIASES[value.toLowerCase()] || value;
}

function normalizeAndExpandLocation(value: string | undefined): string | null {
  const normalized = normalizeLocationInput(value);
  if (!normalized) return null;
  return expandLocationAlias(normalized);
}

function parseLocationFromToolPayload(rawArguments: string): string | null {
  try {
    const parsed = JSON.parse(rawArguments) as { [key: string]: unknown };
    const candidates = ['location', 'query', 'city'] as const;

    for (const key of candidates) {
      const value = parsed?.[key];
      if (typeof value === 'string') {
        const normalized = normalizeAndExpandLocation(value);
        if (normalized) return normalized;
      }
    }
  } catch {
    // Fallback for malformed JSON-like fragments.
  }

  const fallbackMatch = rawArguments.match(/"location"\s*:\s*"([^"]+)"/i);
  if (fallbackMatch?.[1]) {
    const location = normalizeAndExpandLocation(fallbackMatch[1]);
    if (location) return location;
  }

  const quoteFallbackMatch = rawArguments.match(/'location'\s*:\s*'([^']+)'/i);
  if (quoteFallbackMatch?.[1]) {
    const location = normalizeAndExpandLocation(quoteFallbackMatch[1]);
    if (location) return location;
  }

  return null;
}

function parseLocationFromMessage(message: string): string | null {
  const normalized = normalizeLocationInput(message);
  if (!normalized) return null;

  // Lightweight fallback only. Primary source of truth is tool-call args.
  const keywordMatch = normalized.match(/\b(?:in|for|at|around|from)\b\s+(.+)$/i);
  if (!keywordMatch?.[1]) return null;

  const candidate = keywordMatch[1]
    .replace(/\b(?:please|thanks|thank you|detailed)\b/gi, '')
    .trim();

  return normalizeAndExpandLocation(candidate);
}

export function parseWeatherToolArguments(
  rawArguments: string,
  userMessage: string,
): ParsedToolArgs | null {
  const locationFromTool = parseLocationFromToolPayload(rawArguments);
  if (locationFromTool) {
    return { location: locationFromTool };
  }

  const locationFromMessage = parseLocationFromMessage(userMessage);
  if (locationFromMessage) {
    return { location: locationFromMessage };
  }

  return null;
}

export function parseLegacyToolCallMarkup(content: string): LegacyToolCallMarkup | null {
  if (!content || !content.includes('<tool_call')) {
    return null;
  }

  const functionMatch = content.match(/<function=([a-zA-Z0-9_-]+)>/i);
  const locationMatch = content.match(/<parameter=location>\s*([^<]+?)\s*<\/parameter>/i);
  if (!functionMatch?.[1] || !locationMatch?.[1]) {
    return null;
  }

  const functionName = functionMatch[1].trim();
  const location = normalizeAndExpandLocation(locationMatch[1]);
  if (!functionName || !location) {
    return null;
  }

  return { functionName, location };
}
