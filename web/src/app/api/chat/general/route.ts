/**
 * Chat API route for x402 demo - General (Anonymous) Agent
 * Uses Nemotron model for high-quality responses
 * Uses Open-Meteo for real weather data (free, no API key)
 * Executes real USDC transfers on Base Sepolia for paid weather
 */

import { NextRequest } from 'next/server';
import { getScenario } from '@/lib/scenarios';
import { fetchWeatherByQuery } from '@/lib/weather';
import { parseWeatherToolArguments } from '@/lib/location';
import { fetchDetailedWeatherThroughX402 } from '@/lib/x402';
import { createLineBufferParser, parseSseDataLine } from '@/lib/sse';
import { getConfiguredOpenRouterModel } from '@/lib/openrouter';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
// Nvidia Nemotron Nano - free model
const MODEL = getConfiguredOpenRouterModel();
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Stream event types
type StreamEvent =
  | { type: 'thinking_start' }
  | { type: 'thinking_end'; duration: number }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'payment_required'; resource: string; basePrice: number; finalPrice: number; discount: number; paymentSessionId: string }
  | { type: 'payment_waiting'; paymentSessionId: string }
  | { type: 'payment_processing'; paymentSessionId: string }
  | { type: 'payment_accepted'; paymentSessionId: string; txHash: string; txLink: string }
  | { type: 'payment_failed'; paymentSessionId: string; error: string }
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
  history?: Array<{ role: string; content: string }>;
  paymentConfirmed?: boolean;
  paymentSessionId?: string;
  paymentAttemptId?: string;
}

type PaymentAttemptStatus = 'processing' | 'accepted' | 'failed';

interface PaymentAttemptRecord {
  status: PaymentAttemptStatus;
  updatedAt: number;
  txHash?: string;
  txLink?: string;
  error?: string;
}

const paymentAttempts = new Map<string, PaymentAttemptRecord>();
const PAYMENT_ATTEMPT_TTL_MS = 30 * 60 * 1000;

function buildPaymentSessionId(): string {
  return `pay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildPaymentAttemptKey(paymentSessionId: string, paymentAttemptId: string): string {
  return `${paymentSessionId}:${paymentAttemptId}`;
}

function cleanupPaymentAttempts() {
  const cutoff = Date.now() - PAYMENT_ATTEMPT_TTL_MS;
  for (const [key, record] of paymentAttempts.entries()) {
    if (record.updatedAt < cutoff) {
      paymentAttempts.delete(key);
    }
  }
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
          },
        },
        required: ['location'],
      },
    },
  },
];

// System prompt for anonymous agent
function getSystemPrompt(): string {
  const scenarioConfig = getScenario('x402-only');

  return `You are an AI assistant helping users get weather information. You have access to two weather tools:

1. **get_free_weather**: Basic weather (temperature + conditions only). Always free, no payment.
2. **get_paid_weather**: Detailed weather (temp, humidity, wind, pressure, 5-day forecast). Requires x402 payment.

**Decision Guidelines:**
- If the user asks for "weather", "what's the weather", or basic info → use get_free_weather
- If the user asks for "detailed weather", "forecast", "humidity", "wind", or comprehensive data → use get_paid_weather
- If unclear, briefly explain both options and ask which they prefer

Users can ask for weather in any city, region, or country.

After getting weather data, present it clearly and mention which tool you used and why.

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

/**
 * Fetch weather data for any user-provided location (geocoded first).
 */
async function fetchWeatherData(location: string, detailed: boolean): Promise<unknown> {
  return fetchWeatherByQuery(location, detailed);
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
  const data = parseSseDataLine(line);
  if (!data) return null;
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
    const {
      message,
      history,
      paymentConfirmed,
      paymentSessionId: requestPaymentSessionId,
      paymentAttemptId,
    } = body;

    const scenarioConfig = getScenario('x402-only');

    // Build message history
    const chatMessages: ChatMessage[] = [
      { role: 'system', content: getSystemPrompt() },
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
          const initialLineParser = createLineBufferParser();
          let fullContent = '';
          let hasEndedThinking = false;
          const toolCalls: ToolCall[] = [];
          let currentToolCall: Partial<ToolCall> | null = null;

          // Process the stream
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            for (const line of initialLineParser.push(chunk)) {
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

          for (const line of initialLineParser.push(decoder.decode())) {
            const parsed = parseStreamChunk(line);
            if (!parsed) continue;

            const choice = parsed.choices[0];
            if (!choice) continue;

            if (choice.delta.content) {
              if (!hasEndedThinking) {
                hasEndedThinking = true;
                const duration = (Date.now() - thinkingStartTime) / 1000;
                send({ type: 'thinking_end', duration });
              }
              fullContent += choice.delta.content;
              send({ type: 'content', text: choice.delta.content });
            }

            if (choice.delta.tool_calls) {
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

            if (choice.finish_reason === 'tool_calls' && currentToolCall?.id) {
              toolCalls.push(currentToolCall as ToolCall);
            }
          }

          for (const line of initialLineParser.flush()) {
            const parsed = parseStreamChunk(line);
            if (!parsed) continue;

            const choice = parsed.choices[0];
            if (!choice) continue;

            if (choice.delta.content) {
              if (!hasEndedThinking) {
                hasEndedThinking = true;
                const duration = (Date.now() - thinkingStartTime) / 1000;
                send({ type: 'thinking_end', duration });
              }
              fullContent += choice.delta.content;
              send({ type: 'content', text: choice.delta.content });
            }

            if (choice.delta.tool_calls) {
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

            if (choice.finish_reason === 'tool_calls' && currentToolCall?.id) {
              toolCalls.push(currentToolCall as ToolCall);
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
              const parsedArgs = parseWeatherToolArguments(
                toolCall.function.arguments,
                message,
              );

              if (!parsedArgs) {
                send({
                  type: 'error',
                  message:
                    'I could not determine the weather location. Please ask using a specific city, region, or country.',
                });
                continue;
              }

              const location = parsedArgs.location;
              const args: Record<string, unknown> = { ...parsedArgs };

              // Emit tool call event
              send({ type: 'tool_call', name: toolName, args });

              // Handle payment flow for paid weather
              if (toolName === 'get_paid_weather') {
                const paymentSessionId = requestPaymentSessionId || buildPaymentSessionId();

                // Emit payment required event
                send({
                  type: 'payment_required',
                  resource: 'Weather API (Detailed)',
                  basePrice: scenarioConfig.pricing.basePrice,
                  finalPrice: scenarioConfig.pricing.finalPrice,
                  discount: scenarioConfig.pricing.discount,
                  paymentSessionId,
                });

                // Signal that we're waiting for user confirmation
                send({ type: 'payment_waiting', paymentSessionId });

                // If payment not pre-confirmed, we need to wait
                // The frontend will need to make a new request with paymentConfirmed=true
                if (!paymentConfirmed) {
                  // End the stream here - frontend will resume with paymentConfirmed
                  send({ type: 'done' });
                  controller.close();
                  return;
                }

                if (!requestPaymentSessionId || !paymentAttemptId) {
                  send({
                    type: 'payment_failed',
                    paymentSessionId,
                    error: 'Missing payment confirmation context. Please retry payment.',
                  });
                  send({ type: 'done' });
                  controller.close();
                  return;
                }

                cleanupPaymentAttempts();
                const attemptKey = buildPaymentAttemptKey(
                  requestPaymentSessionId,
                  paymentAttemptId
                );
                const existingAttempt = paymentAttempts.get(attemptKey);

                if (existingAttempt?.status === 'accepted') {
                  send({
                    type: 'payment_accepted',
                    paymentSessionId,
                    txHash: existingAttempt.txHash || 'simulated',
                    txLink: existingAttempt.txLink || '',
                  });
                } else if (existingAttempt?.status === 'failed') {
                  send({
                    type: 'payment_failed',
                    paymentSessionId,
                    error: existingAttempt.error || 'Transaction failed',
                  });
                  send({ type: 'done' });
                  controller.close();
                  return;
                } else if (existingAttempt?.status === 'processing') {
                  send({
                    type: 'payment_processing',
                    paymentSessionId,
                  });
                  send({
                    type: 'payment_failed',
                    paymentSessionId,
                    error: 'Payment already in progress. Please wait and retry.',
                  });
                  send({ type: 'done' });
                  controller.close();
                  return;
                } else {
                  paymentAttempts.set(attemptKey, {
                    status: 'processing',
                    updatedAt: Date.now(),
                  });
                  send({ type: 'payment_processing', paymentSessionId });

                  try {
                    const paid = await fetchDetailedWeatherThroughX402(location, 'anonymous');
                    paymentAttempts.set(attemptKey, {
                      status: 'accepted',
                      updatedAt: Date.now(),
                      txHash: paid.txHash,
                      txLink: paid.txLink,
                    });
                    send({
                      type: 'payment_accepted',
                      paymentSessionId,
                      txHash: paid.txHash,
                      txLink: paid.txLink,
                    });
                  } catch (paymentError) {
                    const message =
                      paymentError instanceof Error ? paymentError.message : 'x402 payment request failed';
                    paymentAttempts.set(attemptKey, {
                      status: 'failed',
                      updatedAt: Date.now(),
                      error: message,
                    });
                    send({
                      type: 'payment_failed',
                      paymentSessionId,
                      error: message,
                    });
                    send({ type: 'done' });
                    controller.close();
                    return;
                  }
                }
              }

              // Execute the tool with REAL weather data
              const isFreeWeather = toolName === 'get_free_weather';
              const weatherData = await fetchWeatherData(location, !isFreeWeather);

              // Add payment info to the response
              const responseData = {
                ...weatherData as Record<string, unknown>,
                tier: isFreeWeather ? 'free' : 'anonymous',
                ...(isFreeWeather ? {} : {
                  payment: {
                    amount: `$${scenarioConfig.pricing.finalPrice.toFixed(4)}`,
                    discount: '0%',
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
                const finalLineParser = createLineBufferParser();
                while (true) {
                  const { done, value } = await finalReader.read();
                  if (done) break;

                  const chunk = decoder.decode(value, { stream: true });
                  for (const line of finalLineParser.push(chunk)) {
                    const parsed = parseStreamChunk(line);
                    if (!parsed) continue;

                    const delta = parsed.choices[0]?.delta;
                    if (!delta) continue;

                    if (delta.content) {
                      send({ type: 'content', text: delta.content });
                    }
                  }
                }

                for (const line of finalLineParser.push(decoder.decode())) {
                  const parsed = parseStreamChunk(line);
                  if (!parsed) continue;

                  const delta = parsed.choices[0]?.delta;
                  if (!delta) continue;

                  if (delta.content) {
                    send({ type: 'content', text: delta.content });
                  }
                }

                for (const line of finalLineParser.flush()) {
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
