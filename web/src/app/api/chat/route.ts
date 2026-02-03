/**
 * Chat API route for x402 demo
 * Uses Nemotron model for high-quality responses
 * Uses Open-Meteo for real weather data (free, no API key)
 * Executes real USDC transfers on Base Sepolia for paid weather
 */

import { NextRequest } from 'next/server';
import { getScenario, isValidScenario, ScenarioId } from '@/lib/scenarios';
import { validateWalletConfig, transferUSDC, getAgentAddress, getUSDCBalance } from '@/lib/wallet';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
// Nvidia Nemotron Nano - free model
const MODEL = 'nvidia/nemotron-3-nano-30b-a3b:free';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Location coordinates for Open-Meteo
const LOCATIONS: Record<string, { lat: number; lon: number; name: string }> = {
  'state-college': { lat: 40.7934, lon: -77.8600, name: 'State College, PA' },
  'new-york': { lat: 40.7128, lon: -74.0060, name: 'New York, NY' },
  'san-francisco': { lat: 37.7749, lon: -122.4194, name: 'San Francisco, CA' },
  'london': { lat: 51.5074, lon: -0.1278, name: 'London, UK' },
  'tokyo': { lat: 35.6762, lon: 139.6503, name: 'Tokyo, Japan' },
};

// Weather code descriptions (WMO codes)
const WEATHER_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

// Stream event types
type StreamEvent =
  | { type: 'thinking_start' }
  | { type: 'thinking_end'; duration: number }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'payment_required'; resource: string; basePrice: number; finalPrice: number; discount: number }
  | { type: 'payment_waiting' }
  | { type: 'payment_processing' }
  | { type: 'payment_accepted'; txHash: string; txLink: string }
  | { type: 'payment_failed'; error: string }
  | { type: 'payment_declined' }
  | { type: 'tool_result'; data: unknown }
  | { type: 'content'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: ToolCall[];
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface ChatRequest {
  message: string;
  scenario: string;
  history?: Array<{ role: string; content: string }>;
  paymentConfirmed?: boolean;
}

// Tool definitions
const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'get_free_weather',
      description: 'Get basic weather information (temperature and conditions only). This is always free with no payment required. Use this when the user just wants a quick weather check or basic conditions.',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'The location to get weather for',
            enum: ['state-college', 'new-york', 'san-francisco', 'london', 'tokyo'],
          },
        },
        required: ['location'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_paid_weather',
      description: 'Get detailed weather information including temperature, humidity, wind speed, wind direction, atmospheric pressure, and a 5-day forecast. Requires x402 micropayment. Use this when the user wants detailed weather data, forecasts, or comprehensive weather information.',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'The location to get weather for',
            enum: ['state-college', 'new-york', 'san-francisco', 'london', 'tokyo'],
          },
        },
        required: ['location'],
      },
    },
  },
];

// System prompts for each scenario
function getSystemPrompt(scenario: ScenarioId): string {
  const scenarioConfig = getScenario(scenario);
  const isVerified = scenario === 'x402-kya';

  const basePrompt = `You are an AI assistant helping users get weather information. You have access to two weather tools:

1. **get_free_weather**: Basic weather (temperature + conditions only). Always free, no payment.
2. **get_paid_weather**: Detailed weather (temp, humidity, wind, pressure, 5-day forecast). Requires x402 payment.

**Decision Guidelines:**
- If the user asks for "weather", "what's the weather", or basic info → use get_free_weather
- If the user asks for "detailed weather", "forecast", "humidity", "wind", or comprehensive data → use get_paid_weather
- If unclear, briefly explain both options and ask which they prefer

Available locations: state-college, new-york, san-francisco, london, tokyo

After getting weather data, present it clearly and mention which tool you used and why.`;

  if (isVerified) {
    return `${basePrompt}

**Your Identity (Verified Agent):**
You are a verified agent with Beltic KYA credentials:
- Agent ID: ${scenarioConfig.agent.id}
- Agent Name: ${scenarioConfig.agent.name}
- KYB Tier: ${scenarioConfig.agent.kybTier}
- Safety Score: ${scenarioConfig.agent.safetyScore}

**Pricing for get_paid_weather:**
- Base price: $${scenarioConfig.pricing.basePrice.toFixed(4)}
- Your price: $${scenarioConfig.pricing.finalPrice.toFixed(4)} (${Math.round(scenarioConfig.pricing.discount * 100)}% discount!)
- Discount comes from: 20% KYB tier bonus + 16% safety score bonus

When using get_paid_weather, emphasize that you pay LESS because you're a verified, trusted agent.

Keep responses concise.`;
  } else {
    return `${basePrompt}

**Your Identity (Anonymous Agent):**
You are an anonymous agent with NO identity verification:
- No credentials presented to the platform
- Platform knows nothing about you
- No trust relationship established

**Pricing for get_paid_weather:**
- Price: $${scenarioConfig.pricing.finalPrice.toFixed(4)} (full price, no discount)
- No discount because you have no verifiable trust credentials

When using get_paid_weather, note that you pay the full price as an anonymous agent.

Keep responses concise.`;
  }
}

/**
 * Fetch real weather data from Open-Meteo API
 */
async function fetchWeatherData(location: string, detailed: boolean): Promise<unknown> {
  const coords = LOCATIONS[location] || LOCATIONS['new-york'];

  // Build Open-Meteo API URL
  const params = new URLSearchParams({
    latitude: coords.lat.toString(),
    longitude: coords.lon.toString(),
    current: detailed
      ? 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure'
      : 'temperature_2m,weather_code',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'auto',
  });

  if (detailed) {
    params.append('daily', 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max');
    params.append('forecast_days', '5');
  }

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status}`);
    }
    const data = await response.json();

    // Format the response
    const weatherCode = data.current?.weather_code ?? 0;
    const conditions = WEATHER_CODES[weatherCode] || 'Unknown';

    const result: Record<string, unknown> = {
      location: coords.name,
      timestamp: new Date().toISOString(),
      temperature: Math.round(data.current?.temperature_2m ?? 0),
      conditions,
      unit: 'fahrenheit',
    };

    if (detailed && data.current) {
      result.humidity = Math.round(data.current.relative_humidity_2m ?? 0);
      result.apparentTemperature = Math.round(data.current.apparent_temperature ?? 0);
      result.windSpeed = Math.round(data.current.wind_speed_10m ?? 0);
      result.windDirection = data.current.wind_direction_10m ?? 0;
      result.pressure = Math.round(data.current.surface_pressure ?? 0);

      // Add forecast if available
      if (data.daily) {
        result.forecast = data.daily.time.map((date: string, i: number) => ({
          date,
          high: Math.round(data.daily.temperature_2m_max[i] ?? 0),
          low: Math.round(data.daily.temperature_2m_min[i] ?? 0),
          conditions: WEATHER_CODES[data.daily.weather_code[i]] || 'Unknown',
          precipitationChance: data.daily.precipitation_probability_max[i] ?? 0,
        }));
      }
    }

    return result;
  } catch (error) {
    console.error('Open-Meteo API error:', error);
    // Return mock data as fallback
    return {
      location: coords.name,
      timestamp: new Date().toISOString(),
      temperature: 55,
      conditions: 'Partly cloudy',
      unit: 'fahrenheit',
      error: 'Weather API temporarily unavailable',
    };
  }
}

/**
 * Create a streaming chat completion with OpenRouter
 */
async function createChatCompletion(
  messages: ChatMessage[],
  toolsToUse?: typeof tools
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
      max_tokens: 4096,
      stream: true,
      tools: toolsToUse,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
  }

  return response;
}

/**
 * Parse streaming chunk from OpenRouter
 */
interface StreamChunk {
  choices: Array<{
    delta: {
      content?: string;
      reasoning_content?: string;
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

function parseStreamChunk(line: string): StreamChunk | null {
  if (!line.startsWith('data: ')) return null;
  const data = line.slice(6);
  if (data === '[DONE]') return null;
  try {
    return JSON.parse(data) as StreamChunk;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const { message, scenario, history, paymentConfirmed } = body;

    if (!isValidScenario(scenario)) {
      return new Response(
        JSON.stringify({ error: 'Invalid scenario' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const scenarioId = scenario as ScenarioId;
    const scenarioConfig = getScenario(scenarioId);
    const isVerified = scenarioId === 'x402-kya';

    // Build message history
    const chatMessages: ChatMessage[] = [
      { role: 'system', content: getSystemPrompt(scenarioId) },
    ];

    // Add history if provided
    if (history && history.length > 0) {
      for (const msg of history) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          chatMessages.push({
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
          });
        }
      }
    }

    // Add current message
    chatMessages.push({ role: 'user', content: message });

    // Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: StreamEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        try {
          // Emit thinking start - we'll track time until first content/tool call
          const thinkingStartTime = Date.now();
          send({ type: 'thinking_start' });

          // First API call - may return tool_calls
          const response = await createChatCompletion(chatMessages, tools);
          const reader = response.body?.getReader();

          if (!reader) {
            throw new Error('No reader available');
          }

          const decoder = new TextDecoder();
          let fullContent = '';
          let hasEndedThinking = false;
          const toolCalls: ToolCall[] = [];
          let currentToolCall: Partial<ToolCall> | null = null;

          // Process the stream
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
              const parsed = parseStreamChunk(line);
              if (!parsed) continue;

              const choice = parsed.choices[0];
              if (!choice) continue;

              // Handle regular content
              if (choice.delta.content) {
                // End thinking on first content
                if (!hasEndedThinking) {
                  hasEndedThinking = true;
                  const duration = (Date.now() - thinkingStartTime) / 1000;
                  send({ type: 'thinking_end', duration });
                }
                fullContent += choice.delta.content;
                send({ type: 'content', text: choice.delta.content });
              }

              // Handle tool calls
              if (choice.delta.tool_calls) {
                // End thinking on first tool call
                if (!hasEndedThinking) {
                  hasEndedThinking = true;
                  const duration = (Date.now() - thinkingStartTime) / 1000;
                  send({ type: 'thinking_end', duration });
                }

                for (const tc of choice.delta.tool_calls) {
                  if (tc.id) {
                    if (currentToolCall?.id) {
                      toolCalls.push(currentToolCall as ToolCall);
                    }
                    currentToolCall = {
                      id: tc.id,
                      type: 'function',
                      function: { name: '', arguments: '' },
                    };
                  }
                  if (tc.function?.name && currentToolCall?.function) {
                    currentToolCall.function.name = tc.function.name;
                  }
                  if (tc.function?.arguments && currentToolCall?.function) {
                    currentToolCall.function.arguments += tc.function.arguments;
                  }
                }
              }

              // Check for finish
              if (choice.finish_reason === 'tool_calls') {
                if (currentToolCall?.id) {
                  toolCalls.push(currentToolCall as ToolCall);
                }
              }
            }
          }

          // End thinking if we never got content/tool calls
          if (!hasEndedThinking) {
            const duration = (Date.now() - thinkingStartTime) / 1000;
            send({ type: 'thinking_end', duration });
          }

          // If there are tool calls, execute them
          if (toolCalls.length > 0) {
            for (const toolCall of toolCalls) {
              const toolName = toolCall.function.name;
              let args: { location: string };

              try {
                args = JSON.parse(toolCall.function.arguments);
              } catch {
                args = { location: 'new-york' };
              }

              // Emit tool call event
              send({ type: 'tool_call', name: toolName, args });

              // Handle payment flow for paid weather
              if (toolName === 'get_paid_weather') {
                // Emit payment required event
                send({
                  type: 'payment_required',
                  resource: 'Weather API (Detailed)',
                  basePrice: scenarioConfig.pricing.basePrice,
                  finalPrice: scenarioConfig.pricing.finalPrice,
                  discount: scenarioConfig.pricing.discount,
                });

                // Signal that we're waiting for user confirmation
                send({ type: 'payment_waiting' });

                // If payment not pre-confirmed, we need to wait
                // The frontend will need to make a new request with paymentConfirmed=true
                if (!paymentConfirmed) {
                  // End the stream here - frontend will resume with paymentConfirmed
                  send({ type: 'done' });
                  controller.close();
                  return;
                }

                // Payment confirmed - execute real USDC transfer
                send({ type: 'payment_processing' });

                // Check wallet configuration
                const walletConfig = validateWalletConfig();
                if (!walletConfig.valid) {
                  console.warn('Wallet not configured:', walletConfig.error);
                  // Fall back to simulated payment if wallet not configured
                  send({ type: 'payment_accepted', txHash: 'simulated', txLink: '' });
                } else {
                  // Execute real transfer
                  const transferResult = await transferUSDC(scenarioConfig.pricing.finalPrice);

                  if (transferResult.success && transferResult.txHash && transferResult.txLink) {
                    send({
                      type: 'payment_accepted',
                      txHash: transferResult.txHash,
                      txLink: transferResult.txLink,
                    });
                  } else {
                    send({
                      type: 'payment_failed',
                      error: transferResult.error || 'Transaction failed',
                    });
                    send({ type: 'done' });
                    controller.close();
                    return;
                  }
                }
              }

              // Execute the tool with REAL weather data
              const isFreeWeather = toolName === 'get_free_weather';
              const weatherData = await fetchWeatherData(args.location, !isFreeWeather);

              // Add payment info to the response
              const responseData = {
                ...weatherData as Record<string, unknown>,
                tier: isFreeWeather ? 'free' : (isVerified ? 'verified' : 'anonymous'),
                ...(isFreeWeather ? {} : {
                  payment: {
                    amount: `$${scenarioConfig.pricing.finalPrice.toFixed(4)}`,
                    discount: isVerified ? `${Math.round(scenarioConfig.pricing.discount * 100)}%` : '0%',
                    network: 'Base Sepolia (testnet)',
                  },
                }),
              };

              // Emit tool result
              send({ type: 'tool_result', data: responseData });

              // Build follow-up messages for final response
              const followUpMessages: ChatMessage[] = [
                ...chatMessages,
                {
                  role: 'assistant',
                  content: fullContent || null,
                  tool_calls: [toolCall],
                },
                {
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  name: toolName,
                  content: JSON.stringify({
                    success: true,
                    data: responseData,
                  }),
                },
              ];

              // Get final response
              const finalResponse = await createChatCompletion(followUpMessages);
              const finalReader = finalResponse.body?.getReader();

              if (finalReader) {
                while (true) {
                  const { done, value } = await finalReader.read();
                  if (done) break;

                  const chunk = decoder.decode(value);
                  const lines = chunk.split('\n');

                  for (const line of lines) {
                    const parsed = parseStreamChunk(line);
                    if (!parsed) continue;

                    const delta = parsed.choices[0]?.delta;
                    if (!delta) continue;

                    if (delta.content) {
                      send({ type: 'content', text: delta.content });
                    }
                  }
                }
              }
            }
          }

          send({ type: 'done' });
          controller.close();
        } catch (error) {
          console.error('Stream error:', error);
          send({ type: 'error', message: error instanceof Error ? error.message : 'Unknown error' });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
