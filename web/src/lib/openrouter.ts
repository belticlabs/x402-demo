/**
 * OpenRouter API client for the x402 demo
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.OPENROUTER_MODEL_ID?.trim() || 'nvidia/nemotron-3-nano-30b-a3b:free';

export function getConfiguredOpenRouterModel(): string {
  return MODEL;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface StreamChunk {
  choices: Array<{
    delta: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
}

// Weather tool definition
export const weatherTool = {
  type: 'function' as const,
  function: {
    name: 'get_weather',
    description: 'Get weather data for a location. This will make a request to a paid API using x402 micropayments.',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'The location to get weather for (city, region, or country)',
        },
      },
      required: ['location'],
    },
  },
};

/**
 * Create a streaming chat completion with OpenRouter
 */
export async function createChatCompletion(
  messages: ChatMessage[],
  tools?: typeof weatherTool[]
): Promise<Response> {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3002',
      'X-Title': 'x402 + KYA Demo',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 1024,
      stream: true,
      tools,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
  }

  return response;
}

/**
 * Parse a streaming chunk from OpenRouter
 */
export function parseStreamChunk(line: string): StreamChunk | null {
  if (!line.startsWith('data: ')) return null;

  const data = line.slice(6);
  if (data === '[DONE]') return null;

  try {
    return JSON.parse(data) as StreamChunk;
  } catch {
    return null;
  }
}
