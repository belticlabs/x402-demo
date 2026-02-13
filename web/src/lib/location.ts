/**
 * Helpers for extracting weather locations from tool-call arguments.
 */

export interface ParsedToolArgs {
  location: string;
}

function trimLocation(value: string | undefined): string | null {
  const trimmed = (value || '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseLocationFromToolPayload(rawArguments: string): string | null {
  try {
    const parsed = JSON.parse(rawArguments) as { [key: string]: unknown };
    if (typeof parsed?.location === 'string') {
      const location = trimLocation(parsed.location);
      if (location) return location;
    }

    if (typeof (parsed as { [key: string]: unknown }).query === 'string') {
      const query = trimLocation(parsed.query as string);
      if (query) return query;
    }

    if (typeof (parsed as { [key: string]: unknown }).city === 'string') {
      const city = trimLocation((parsed as { [key: string]: unknown }).city as string);
      if (city) return city;
    }
  } catch {
    // Fallback to quick JSON-shaped regex extraction when parse fails.
  }

  const fallbackMatch = rawArguments.match(/"location"\s*:\s*"([^"]+)"/i);
  if (fallbackMatch?.[1]) {
    const location = trimLocation(fallbackMatch[1]);
    if (location) return location;
  }

  const quoteFallbackMatch = rawArguments.match(/'location'\s*:\s*'([^']+)'/i);
  if (quoteFallbackMatch?.[1]) {
    const location = trimLocation(quoteFallbackMatch[1]);
    if (location) return location;
  }

  return null;
}

function parseLocationFromMessage(message: string): string | null {
  const patterns = [
    /weather\s+(?:for|in|at|around)\s+([^.!?,;:]+?)(?:\s+today|\s+tomorrow|\s+now)?$/i,
    /forecast\s+(?:for|in|at|around)\s+([^.!?,;:]+?)(?:\s+today|\s+tomorrow|\s+now)?$/i,
    /(?:in|for|at|around)\s+([A-Z][A-Za-z\s.'-]+)(?:\s+right now|\s+today|\s+now|\s+please|\s+thanks)?[.!?]?$/,
  ];

  const normalized = message.trim();
  if (!normalized) return null;

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const location = trimLocation(match[1]);
      if (location) return location;
    }
  }

  return null;
}

export function parseWeatherToolArguments(
  rawArguments: string,
  userMessage: string,
): ParsedToolArgs | null {
  const location =
    parseLocationFromToolPayload(rawArguments) || parseLocationFromMessage(userMessage);

  if (!location) {
    return null;
  }

  return { location };
}
