/**
 * Chat API route for x402 demo - Beltic Verified Agent
 * 
 * This route loads agent credentials from .beltic/ directory and uses
 * the credential data to configure the agent identity, model, and pricing.
 */

import { NextRequest } from 'next/server';
import {
  getCredential,
  getCredentialInfo,
  getOpenRouterModel,
  calculatePricing,
  type CredentialInfo,
} from '@/lib/credential-loader';
import { createSignedBelticHeaders } from '@/lib/kya';
import { parseLegacyToolCallMarkup, parseWeatherToolArguments } from '@/lib/location';
import { fetchWeatherByQuery } from '@/lib/weather';
import { buildX402WeatherUrl, fetchDetailedWeatherThroughX402, type KybTier } from '@/lib/x402';
import { createLineBufferParser, parseSseDataLine } from '@/lib/sse';

// ============================================================================
// Credential Loading (at module initialization)
// ============================================================================

const credentialResult = getCredential();
const credentialInfo = getCredentialInfo();
const pricing = calculatePricing(credentialInfo);

// Log credential source on startup
console.log('='.repeat(60));
console.log('[Beltic Route] Credential Loading');
console.log('='.repeat(60));
console.log(`  Path: ${credentialResult.path || 'NOT FOUND'}`);
console.log(`  Beltic Dir: ${credentialResult.belticDir}`);
console.log(`  Agent: ${credentialInfo.agentName} v${credentialInfo.agentVersion}`);
console.log(`  Agent ID: ${credentialInfo.agentId}`);
console.log(`  Model: ${credentialInfo.modelProvider}/${credentialInfo.modelFamily}`);
console.log(`  KYB Tier: ${credentialInfo.kybTier}`);
console.log(`  Safety Score: ${credentialInfo.averageSafetyScore}/100`);
console.log(`  Pricing: $${pricing.basePrice} -> $${pricing.finalPrice} (${Math.round(pricing.discount * 100)}% off)`);
if (credentialResult.errors.length > 0) {
  console.log(`  Warnings: ${credentialResult.errors.join(', ')}`);
}
console.log('='.repeat(60));

// ============================================================================
// OpenRouter Configuration
// ============================================================================

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const CHAT_DISABLED = process.env.DEMO_CHAT_DISABLED === 'true';
const PAID_FLOW_DISABLED = process.env.DEMO_PAID_FLOW_DISABLED === 'true';
const MAX_MESSAGE_CHARS = (() => {
  const parsed = Number(process.env.DEMO_MAX_MESSAGE_CHARS || '2000');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2000;
})();

// Get model from credential or use default
const MODEL = getOpenRouterModel(credentialInfo.modelProvider, credentialInfo.modelFamily);
console.log(`[Beltic Route] Using OpenRouter model: ${MODEL}`);

// ============================================================================
// Types
// ============================================================================

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
  function: { name: string; arguments: string };
}

interface ChatRequest {
  message: string;
  history?: Array<{ role: string; content: string }>;
  paymentConfirmed?: boolean;
  paymentSessionId?: string;
  paymentAttemptId?: string;
  minKybTier?: string;
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

// ============================================================================
// Tools
// ============================================================================

const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'get_free_weather',
      description: 'Get basic weather information (temperature and conditions only). Always free.',
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
      description: 'Get detailed weather with forecast. Requires x402 micropayment.',
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

// ============================================================================
// System Prompt (built from credential)
// ============================================================================

function buildSystemPrompt(info: CredentialInfo): string {
  const p = calculatePricing(info);
  
  return `You are an AI assistant helping users get weather information.

**Available Tools:**
1. **get_free_weather**: Basic weather (temp + conditions). Always free.
2. **get_paid_weather**: Detailed weather with 5-day forecast. Requires x402 payment.

**Decision Guidelines:**
- Basic weather questions → use get_free_weather
- Detailed/forecast requests → use get_paid_weather
- If unclear, ask user preference

**Tool Call Requirement:**
- Always pass a clean geographic place in the tool \`location\` argument.
- Prefer canonical names (for example: "Tampa, Florida, US" or "New York City, New York, US").
- Do not pass the full user sentence as \`location\`.

**Location support:** Users can request weather for any city, region, or country name.

**Your Identity (from Beltic KYA Credential):**
- Agent Name: ${info.agentName}
- Agent ID: ${info.agentId}
- Version: ${info.agentVersion}
- Credential ID: ${info.credentialId}
- Model: ${info.modelProvider}/${info.modelFamily}
- Architecture: ${info.architectureType}
- Verification Level: ${info.verificationLevel}
- Issuer: ${info.issuerDid}
- KYB Tier: ${info.kybTier}
- Safety Score: ${info.averageSafetyScore}/100
- Credential loaded from: ${info.loadedFrom}

**Pricing (based on your verified status):**
- Base price: $${p.basePrice.toFixed(4)}
- Your price: $${p.finalPrice.toFixed(4)} (${Math.round(p.discount * 100)}% discount!)
- KYB discount: ${Math.round(p.kybDiscount * 100)}%
- Safety discount: ${Math.round(p.safetyDiscount * 100)}%

When using get_paid_weather, emphasize you pay LESS because you're a verified, trusted agent.

Keep responses concise.`;
}

// ============================================================================
// Weather Fetching
// ============================================================================

async function fetchWeatherData(location: string, detailed: boolean): Promise<unknown> {
  return fetchWeatherByQuery(location, detailed);
}

// ============================================================================
// OpenRouter Chat Completion
// ============================================================================

async function createChatCompletion(messages: ChatMessage[], toolsToUse?: typeof tools): Promise<Response> {
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not configured');
  
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

interface StreamChunk {
  choices: Array<{
    delta: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
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

// ============================================================================
// Route Handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const appUrl = new URL(request.url).origin;
    const body: ChatRequest = await request.json();
    const {
      message: rawMessage,
      history,
      paymentConfirmed,
      paymentSessionId: requestPaymentSessionId,
      paymentAttemptId,
      minKybTier,
    } = body;

    if (CHAT_DISABLED) {
      return new Response(
        JSON.stringify({ error: 'Chat is temporarily disabled by the demo operator' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (typeof rawMessage !== 'string') {
      return new Response(
        JSON.stringify({ error: 'message must be a string' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const message = rawMessage.trim();
    if (!message) {
      return new Response(
        JSON.stringify({ error: 'message is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (message.length > MAX_MESSAGE_CHARS) {
      return new Response(
        JSON.stringify({ error: `message exceeds max length (${MAX_MESSAGE_CHARS})` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Build messages with credential-based system prompt
    const chatMessages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(credentialInfo) },
    ];
    
    if (history?.length) {
      for (const msg of history) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          chatMessages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
        }
      }
    }
    
    chatMessages.push({ role: 'user', content: message });
    
    // Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: StreamEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        
        try {
          const thinkingStartTime = Date.now();
          send({ type: 'thinking_start' });
          
          const response = await createChatCompletion(chatMessages, tools);
          const reader = response.body?.getReader();
          if (!reader) throw new Error('No reader available');
          
          const decoder = new TextDecoder();
          const initialLineParser = createLineBufferParser();
          let fullContent = '';
          let hasEndedThinking = false;
          const toolCalls: ToolCall[] = [];
          let currentToolCall: Partial<ToolCall> | null = null;
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            for (const line of initialLineParser.push(chunk)) {
              const parsed = parseStreamChunk(line);
              if (!parsed) continue;
              
              const choice = parsed.choices[0];
              if (!choice) continue;
              
              if (choice.delta.content) {
                if (!hasEndedThinking) {
                  hasEndedThinking = true;
                  send({ type: 'thinking_end', duration: (Date.now() - thinkingStartTime) / 1000 });
                }
                fullContent += choice.delta.content;
              }
              
              if (choice.delta.tool_calls) {
                if (!hasEndedThinking) {
                  hasEndedThinking = true;
                  send({ type: 'thinking_end', duration: (Date.now() - thinkingStartTime) / 1000 });
                }
                
                for (const tc of choice.delta.tool_calls) {
                  if (tc.id) {
                    if (currentToolCall?.id) toolCalls.push(currentToolCall as ToolCall);
                    currentToolCall = { id: tc.id, type: 'function', function: { name: '', arguments: '' } };
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
          }

          for (const line of initialLineParser.push(decoder.decode())) {
            const parsed = parseStreamChunk(line);
            if (!parsed) continue;

            const choice = parsed.choices[0];
            if (!choice) continue;

            if (choice.delta.content) {
              if (!hasEndedThinking) {
                hasEndedThinking = true;
                send({ type: 'thinking_end', duration: (Date.now() - thinkingStartTime) / 1000 });
              }
              fullContent += choice.delta.content;
            }

            if (choice.delta.tool_calls) {
              if (!hasEndedThinking) {
                hasEndedThinking = true;
                send({ type: 'thinking_end', duration: (Date.now() - thinkingStartTime) / 1000 });
              }

              for (const tc of choice.delta.tool_calls) {
                if (tc.id) {
                  if (currentToolCall?.id) toolCalls.push(currentToolCall as ToolCall);
                  currentToolCall = { id: tc.id, type: 'function', function: { name: '', arguments: '' } };
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
                send({ type: 'thinking_end', duration: (Date.now() - thinkingStartTime) / 1000 });
              }
              fullContent += choice.delta.content;
            }

            if (choice.delta.tool_calls) {
              if (!hasEndedThinking) {
                hasEndedThinking = true;
                send({ type: 'thinking_end', duration: (Date.now() - thinkingStartTime) / 1000 });
              }
              for (const tc of choice.delta.tool_calls) {
                if (tc.id) {
                  if (currentToolCall?.id) toolCalls.push(currentToolCall as ToolCall);
                  currentToolCall = { id: tc.id, type: 'function', function: { name: '', arguments: '' } };
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
          
          if (!hasEndedThinking) {
            send({ type: 'thinking_end', duration: (Date.now() - thinkingStartTime) / 1000 });
          }

          // Some models emit tool markup in plain text instead of tool_calls.
          // Convert that markup into a synthetic tool call instead of streaming raw tags.
          if (toolCalls.length === 0) {
            const legacyTool = parseLegacyToolCallMarkup(fullContent);
            if (legacyTool) {
              toolCalls.push({
                id: `tool-fallback-${Date.now()}`,
                type: 'function',
                function: {
                  name: legacyTool.functionName,
                  arguments: JSON.stringify({ location: legacyTool.location }),
                },
              });
              fullContent = '';
            }
          }
          
          // Execute tool calls
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
              const args: Record<string, unknown> = { location };
              
              send({ type: 'tool_call', name: toolName, args });

              if (toolName === 'get_paid_weather' && PAID_FLOW_DISABLED) {
                send({
                  type: 'error',
                  message:
                    'Detailed paid weather is temporarily disabled by the demo operator. Please ask for basic weather.',
                });
                continue;
              }
              
              // Handle payment for paid weather
              if (toolName === 'get_paid_weather') {
                const paymentSessionId = requestPaymentSessionId || buildPaymentSessionId();

                send({
                  type: 'payment_required',
                  resource: 'Weather API (Detailed)',
                  basePrice: pricing.basePrice,
                  finalPrice: pricing.finalPrice,
                  discount: pricing.discount,
                  paymentSessionId,
                });
                send({ type: 'payment_waiting', paymentSessionId });
                
                if (!paymentConfirmed) {
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
                  send({ type: 'payment_processing', paymentSessionId });
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
                    const normalizedMinKybTier =
                      typeof minKybTier === 'string' && minKybTier.trim()
                        ? (minKybTier.trim().toLowerCase() as KybTier)
                        : undefined;
                    const url = buildX402WeatherUrl(
                      location,
                      'verified',
                      appUrl,
                      normalizedMinKybTier
                    );
                    const signedHeaders = await createSignedBelticHeaders(url, 'GET');
                    const paid = await fetchDetailedWeatherThroughX402(
                      location,
                      'verified',
                      signedHeaders,
                      appUrl,
                      normalizedMinKybTier
                    );

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
              
              // Fetch weather data
              const isFree = toolName === 'get_free_weather';
              const weatherData = await fetchWeatherData(location, !isFree);
              
              const responseData = {
                ...(weatherData as Record<string, unknown>),
                tier: isFree ? 'free' : 'verified',
                ...(!isFree && {
                  payment: {
                    amount: `$${pricing.finalPrice.toFixed(4)}`,
                    discount: `${Math.round(pricing.discount * 100)}%`,
                    network: 'Base Sepolia (testnet)',
                  },
                }),
                credential: {
                  agentName: credentialInfo.agentName,
                  agentId: credentialInfo.agentId,
                  loadedFrom: credentialInfo.loadedFrom,
                },
              };
              
              send({ type: 'tool_result', data: responseData });
              
              // Get final response
              const followUpMessages: ChatMessage[] = [
                ...chatMessages,
                { role: 'assistant', content: fullContent || null, tool_calls: [toolCall] },
                { role: 'tool', tool_call_id: toolCall.id, name: toolName, content: JSON.stringify({ success: true, data: responseData }) },
              ];
              
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
                    if (parsed?.choices[0]?.delta.content) {
                      send({ type: 'content', text: parsed.choices[0].delta.content });
                    }
                  }
                }

                for (const line of finalLineParser.push(decoder.decode())) {
                  const parsed = parseStreamChunk(line);
                  if (parsed?.choices[0]?.delta.content) {
                    send({ type: 'content', text: parsed.choices[0].delta.content });
                  }
                }

                for (const line of finalLineParser.flush()) {
                  const parsed = parseStreamChunk(line);
                  if (parsed?.choices[0]?.delta.content) {
                    send({ type: 'content', text: parsed.choices[0].delta.content });
                  }
                }
              }
            }
          }

          if (toolCalls.length === 0 && fullContent.trim()) {
            send({ type: 'content', text: fullContent });
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
