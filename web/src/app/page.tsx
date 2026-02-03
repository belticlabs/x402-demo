'use client';

import { useState, useCallback, useRef, useEffect, KeyboardEvent } from 'react';
import Image from 'next/image';
import { ShieldCheck, Shield, ArrowUp, Loader2, ExternalLink, CheckCircle2, RotateCcw } from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ChainOfThought from '@/components/ChainOfThought';
import PaymentModal from '@/components/PaymentModal';
import VerifiedBadge from '@/components/VerifiedBadge';

export type Scenario = 'x402-only' | 'x402-kya';

// Message type for display
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: {
    content: string;
    duration: number;
    startTime: number;
  };
}

// Stream state for a scenario
interface StreamState {
  messages: Message[];
  isStreaming: boolean;
  streamingMessageId: string | null;
  // Thinking state
  isThinking: boolean;
  thinkingContent: string;
  thinkingStartTime: number | null;
  thinkingDuration: number | null;
  // Payment state
  paymentRequired: boolean;
  paymentInfo: {
    resource: string;
    basePrice: number;
    finalPrice: number;
    discount: number;
  } | null;
  paymentStatus: 'none' | 'pending' | 'accepted' | 'declined';
  // Transaction state
  txProcessing: boolean;
  txHash: string | null;
  txLink: string | null;
  txError: string | null;
  // Last successful transaction (persists after stream ends)
  lastTx: {
    hash: string;
    link: string;
    amount: string;
  } | null;
  // Pending request for payment confirmation
  pendingPaymentRequest: {
    message: string;
    thinkingContent: string;
    thinkingStartTime: number | null;
    thinkingDuration: number | null;
  } | null;
}

// Generate unique ID for messages
let messageCounter = 0;
function generateId(): string {
  return `msg-${Date.now()}-${++messageCounter}`;
}

// Scenario configuration
const scenarioConfig = {
  'x402-only': {
    title: 'Anonymous Agent',
    subtitle: 'x402 Only',
    description: 'Payment capability without identity verification',
    badge: {
      icon: Shield,
      text: 'Anonymous',
      className: 'bg-[var(--surface-hover)] text-[var(--muted-foreground)] border border-[var(--border)]',
    },
    accentColor: 'var(--muted-foreground)',
  },
  'x402-kya': {
    title: 'Verified Agent',
    subtitle: 'x402 + KYA',
    description: 'Payment capability with verified identity',
    badge: {
      icon: ShieldCheck,
      text: 'Verified',
      className: 'bg-[var(--success-muted)] text-[var(--success)] border border-[var(--success)]/30',
    },
    accentColor: 'var(--success)',
  },
};

// Agent info for verified badge
const verifiedAgentInfo = {
  agentName: 'Weather Data Agent',
  agentId: 'de858d1c-c904-4210-933a-609b46856d86',
  agentVersion: '1.0.0',
  kybTier: 'tier_2',
  safetyScores: {
    harmfulContent: 92,
    promptInjection: 88,
    piiLeakage: 95,
    toolAbuse: 90,
  },
  overallRating: 'LOW RISK',
  validFrom: 'Jan 2026',
  validUntil: 'Jan 2027',
  issuer: 'Beltic Labs',
};

// Header component - minimal
function Header({ onReset }: { onReset: () => void }) {
  return (
    <header className="border-b border-[var(--border)]">
      <div className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {/* Beltic logo: white for dark mode, black for light mode */}
          <Image
            src="/white.png"
            alt="Beltic"
            width={100}
            height={28}
            className="h-7 w-auto dark:block hidden"
            priority
          />
          <Image
            src="/black.png"
            alt="Beltic"
            width={100}
            height={28}
            className="h-7 w-auto block dark:hidden"
            priority
          />
          <span className="font-medium text-base text-[var(--foreground)]">x402 + KYA</span>
        </div>
        <nav className="flex items-center gap-4">
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)] border border-[var(--border)] hover:border-[var(--border-hover)] rounded-lg transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
          <a
            href="https://docs.belticlabs.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            Docs
          </a>
          <a
            href="https://github.com/belticlabs"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}

// Message component - user bubbles, assistant plain text
function MessageDisplay({ message, isStreaming }: { message: Message; isStreaming: boolean }) {
  const isUser = message.role === 'user';

  if (isUser) {
    // User messages in subtle bubbles
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl px-4 py-3 bg-[var(--surface-hover)] text-[var(--foreground)]">
          <p className="text-[15px] whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  // Assistant messages - plain text, no bubble
  return (
    <div className="text-[var(--foreground)]">
      <div className="prose prose-base prose-invert max-w-none text-[var(--foreground)] leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {message.content}
        </ReactMarkdown>
        {isStreaming && (
          <span className="inline-block w-0.5 h-5 bg-[var(--foreground)] animate-pulse ml-0.5 align-middle" />
        )}
      </div>
    </div>
  );
}

// Scenario column component
interface ScenarioColumnProps {
  scenario: Scenario;
  state: StreamState;
  onPaymentDecision: (accepted: boolean) => void;
}

function ScenarioColumn({ scenario, state, onPaymentDecision }: ScenarioColumnProps) {
  const config = scenarioConfig[scenario];
  const BadgeIcon = config.badge.icon;
  const isVerified = scenario === 'x402-kya';
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.messages, state.thinkingContent, state.paymentRequired]);

  return (
    <div className="flex flex-col h-full">
      {/* Simplified column header - just icon + title */}
      <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <BadgeIcon className={clsx(
            "w-5 h-5",
            isVerified ? "text-[var(--success)]" : "text-[var(--muted)]"
          )} />
          <span className="text-base font-medium text-[var(--foreground)]">{config.title}</span>
        </div>

        {/* Badge */}
        {isVerified ? (
          <VerifiedBadge {...verifiedAgentInfo} />
        ) : (
          <span className="text-sm text-[var(--muted)]">{config.badge.text}</span>
        )}
      </div>

      {/* Messages area with more padding */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
        {state.messages.length === 0 && !state.isThinking && (
          <div className="flex items-center justify-center h-full text-[var(--muted)] text-sm">
            <p>Ask about weather...</p>
          </div>
        )}

        {state.messages.map((message) => (
          <div key={message.id} className="space-y-3">
            {/* Show thinking if this message has it */}
            {message.thinking && message.role === 'assistant' && (
              <ChainOfThought
                content={message.thinking.content}
                isStreaming={false}
                startTime={message.thinking.startTime}
                variant={isVerified ? 'verified' : 'anonymous'}
              />
            )}
            <MessageDisplay
              message={message}
              isStreaming={state.isStreaming && message.id === state.streamingMessageId}
            />
          </div>
        ))}

        {/* Active thinking (before message appears) */}
        {state.isThinking && state.thinkingStartTime && (
          <ChainOfThought
            content={state.thinkingContent}
            isStreaming={true}
            startTime={state.thinkingStartTime}
            variant={isVerified ? 'verified' : 'anonymous'}
          />
        )}

        {/* Payment modal */}
        {state.paymentRequired && state.paymentInfo && (state.paymentStatus === 'pending' || state.txProcessing || state.txError) && (
          <PaymentModal
            isOpen={true}
            scenario={scenario}
            resource={state.paymentInfo.resource}
            basePrice={state.paymentInfo.basePrice}
            finalPrice={state.paymentInfo.finalPrice}
            discount={state.paymentInfo.discount}
            network="Base Sepolia"
            onAccept={() => onPaymentDecision(true)}
            onDecline={() => onPaymentDecision(false)}
            isProcessing={state.txProcessing}
            txHash={state.txHash || undefined}
            txLink={state.txLink || undefined}
            txError={state.txError || undefined}
          />
        )}

        {/* Transaction confirmation - shows after successful payment */}
        {state.lastTx && !state.isStreaming && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[var(--success)]/20 bg-[var(--success)]/5">
            <CheckCircle2 className="w-5 h-5 text-[var(--success)] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--foreground)]">
                Payment confirmed · {state.lastTx.amount}
              </p>
              <a
                href={state.lastTx.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] inline-flex items-center gap-1 font-mono"
              >
                {state.lastTx.hash.slice(0, 10)}...{state.lastTx.hash.slice(-8)}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <span className="text-xs text-[var(--muted)]">Base Sepolia</span>
          </div>
        )}

        {/* Loading indicator when streaming but no message yet */}
        {state.isStreaming && !state.isThinking && !state.streamingMessageId && !state.paymentRequired && (
          <div className="flex items-center gap-2 text-[var(--muted)] text-sm">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

// Unified input component
interface UnifiedInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

const suggestions = [
  "What's the weather in NYC?",
  "Detailed weather for San Francisco",
  "Tokyo forecast",
];

function UnifiedInput({ onSend, disabled = false }: UnifiedInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
    }
  }, [input]);

  const handleSend = () => {
    if (!input.trim() || disabled) return;
    onSend(input.trim());
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = input.trim() && !disabled;

  return (
    <div className="border-t border-[var(--border)] px-6 py-5">
      <div className="max-w-3xl mx-auto space-y-3">
        {/* Suggestions */}
        {!disabled && input.length === 0 && (
          <div className="flex flex-wrap gap-2 justify-center">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => onSend(suggestion)}
                className="px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)] border border-[var(--border)] hover:border-[var(--border-hover)] rounded-full transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="flex items-end gap-3 border border-[var(--border)] rounded-xl px-5 py-4 bg-[var(--surface)]">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about weather..."
            disabled={disabled}
            className={clsx(
              "flex-1 bg-transparent resize-none text-base leading-relaxed",
              "placeholder:text-[var(--muted)] text-[var(--foreground)]",
              "focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed",
              "min-h-[28px] max-h-[120px]"
            )}
            rows={1}
          />
          <button
            onClick={handleSend}
            disabled={!canSend}
            className={clsx(
              "p-2.5 rounded-lg transition-colors flex-shrink-0",
              canSend
                ? "bg-[var(--foreground)] text-[var(--background)] hover:opacity-90"
                : "text-[var(--muted)] cursor-not-allowed"
            )}
          >
            {disabled ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <ArrowUp className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Initial stream state
const initialStreamState: StreamState = {
  messages: [],
  isStreaming: false,
  streamingMessageId: null,
  isThinking: false,
  thinkingContent: '',
  thinkingStartTime: null,
  thinkingDuration: null,
  paymentRequired: false,
  paymentInfo: null,
  paymentStatus: 'none',
  txProcessing: false,
  txHash: null,
  txLink: null,
  txError: null,
  lastTx: null,
  pendingPaymentRequest: null,
};

// Main page component
export default function Home() {
  // Stream states for each scenario
  const [leftState, setLeftState] = useState<StreamState>({ ...initialStreamState });
  const [rightState, setRightState] = useState<StreamState>({ ...initialStreamState });


  // Stream response for a specific scenario
  const streamResponse = useCallback(async (
    scenario: Scenario,
    userMessage: string,
    setState: React.Dispatch<React.SetStateAction<StreamState>>,
    paymentConfirmed: boolean = false,
    existingThinking?: { content: string; startTime: number | null; duration: number | null }
  ) => {
    // Only add user message if this is not a payment confirmation retry
    if (!paymentConfirmed) {
      const userMsgId = generateId();
      setState(prev => ({
        ...prev,
        messages: [...prev.messages, { id: userMsgId, role: 'user', content: userMessage }],
        isStreaming: true,
        streamingMessageId: null,
        isThinking: false,
        thinkingContent: '',
        thinkingStartTime: null,
        thinkingDuration: null,
        paymentRequired: false,
        paymentInfo: null,
        paymentStatus: 'none',
        txProcessing: false,
        txHash: null,
        txLink: null,
        txError: null,
        lastTx: null, // Clear previous transaction
        pendingPaymentRequest: null,
      }));
    } else {
      // This is a payment confirmation retry - just update streaming state
      // Keep paymentInfo so the modal can still display price
      setState(prev => ({
        ...prev,
        isStreaming: true,
        paymentRequired: true, // Keep modal open for processing state
        pendingPaymentRequest: null,
        txProcessing: false,
        txHash: null,
        txLink: null,
        txError: null,
      }));
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          scenario,
          paymentConfirmed,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No reader available');
      }

      const decoder = new TextDecoder();
      let assistantMessageId: string | null = null;
      let fullContent = '';
      // Use existing thinking info if this is a retry
      const thinkingContent = existingThinking?.content || '';
      let thinkingStartTime: number | null = existingThinking?.startTime || null;
      let thinkingDuration: number | null = existingThinking?.duration || null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6);
            if (payload === '[DONE]') break;

            try {
              const event = JSON.parse(payload);

              switch (event.type) {
                case 'thinking_start':
                  thinkingStartTime = Date.now();
                  setState(prev => ({
                    ...prev,
                    isThinking: true,
                    thinkingStartTime: thinkingStartTime,
                  }));
                  break;

                case 'thinking_end':
                  thinkingDuration = event.duration;
                  setState(prev => ({
                    ...prev,
                    isThinking: false,
                    thinkingDuration: thinkingDuration,
                  }));
                  break;

                case 'payment_required':
                  // Show payment modal
                  setState(prev => ({
                    ...prev,
                    paymentRequired: true,
                    paymentInfo: {
                      resource: event.resource,
                      basePrice: event.basePrice,
                      finalPrice: event.finalPrice,
                      discount: event.discount,
                    },
                    paymentStatus: 'pending',
                  }));
                  break;

                case 'payment_waiting':
                  // Store the pending request info for when user confirms
                  setState(prev => ({
                    ...prev,
                    isStreaming: false, // Stream has paused
                    pendingPaymentRequest: {
                      message: userMessage,
                      thinkingContent,
                      thinkingStartTime,
                      thinkingDuration,
                    },
                  }));
                  break;

                case 'payment_processing':
                  setState(prev => ({
                    ...prev,
                    txProcessing: true,
                    txError: null,
                  }));
                  break;

                case 'payment_accepted':
                  setState(prev => ({
                    ...prev,
                    paymentStatus: 'accepted',
                    paymentRequired: false,
                    txProcessing: false,
                    txHash: event.txHash || null,
                    txLink: event.txLink || null,
                    // Save for display after stream ends
                    lastTx: event.txHash && event.txHash !== 'simulated' ? {
                      hash: event.txHash,
                      link: event.txLink || '',
                      amount: prev.paymentInfo ? `$${prev.paymentInfo.finalPrice.toFixed(4)}` : '',
                    } : null,
                  }));
                  break;

                case 'payment_failed':
                  setState(prev => ({
                    ...prev,
                    txProcessing: false,
                    txError: event.error || 'Transaction failed',
                    paymentRequired: true,
                  }));
                  break;

                case 'content':
                  fullContent += event.text;
                  if (!assistantMessageId) {
                    assistantMessageId = generateId();
                    setState(prev => ({
                      ...prev,
                      streamingMessageId: assistantMessageId,
                      messages: [...prev.messages, {
                        id: assistantMessageId!,
                        role: 'assistant',
                        content: fullContent,
                        thinking: thinkingContent ? {
                          content: thinkingContent,
                          duration: thinkingDuration || 0,
                          startTime: thinkingStartTime || Date.now(),
                        } : undefined,
                      }],
                    }));
                  } else {
                    setState(prev => ({
                      ...prev,
                      messages: prev.messages.map(m =>
                        m.id === assistantMessageId
                          ? { ...m, content: fullContent }
                          : m
                      ),
                    }));
                  }
                  break;

                case 'error':
                  if (!assistantMessageId) {
                    assistantMessageId = generateId();
                    setState(prev => ({
                      ...prev,
                      messages: [...prev.messages, {
                        id: assistantMessageId!,
                        role: 'assistant',
                        content: `Error: ${event.message}`,
                      }],
                    }));
                  }
                  break;

                case 'done':
                  break;
              }
            } catch {
              // Ignore JSON parse errors
            }
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessageId = generateId();
      setState(prev => ({
        ...prev,
        messages: [...prev.messages, {
          id: errorMessageId,
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
        }],
      }));
    } finally {
      setState(prev => {
        // Don't reset payment state if we're waiting for user confirmation
        if (prev.pendingPaymentRequest) {
          return prev;
        }
        // Always fully reset streaming and payment state when done
        return {
          ...prev,
          isStreaming: false,
          streamingMessageId: null,
          isThinking: false,
          paymentRequired: false,
          paymentStatus: 'none',
          txProcessing: false,
          txHash: null,
          txLink: null,
          txError: null,
        };
      });
    }
  }, []);

  // Handle payment decisions
  const handleLeftPaymentDecision = useCallback((accepted: boolean) => {
    if (accepted && leftState.pendingPaymentRequest) {
      // User accepted - resume with paymentConfirmed
      const pending = leftState.pendingPaymentRequest;
      streamResponse(
        'x402-only',
        pending.message,
        setLeftState,
        true, // paymentConfirmed
        {
          content: pending.thinkingContent,
          startTime: pending.thinkingStartTime,
          duration: pending.thinkingDuration,
        }
      );
    } else {
      // User declined
      setLeftState(prev => ({
        ...prev,
        paymentStatus: 'declined',
        paymentRequired: false,
        pendingPaymentRequest: null,
        txProcessing: false,
        txHash: null,
        txLink: null,
        txError: null,
        messages: [...prev.messages, {
          id: generateId(),
          role: 'assistant',
          content: 'Payment declined. I cannot access the detailed weather data without payment.',
        }],
      }));
    }
  }, [leftState.pendingPaymentRequest, streamResponse]);

  const handleRightPaymentDecision = useCallback((accepted: boolean) => {
    if (accepted && rightState.pendingPaymentRequest) {
      // User accepted - resume with paymentConfirmed
      const pending = rightState.pendingPaymentRequest;
      streamResponse(
        'x402-kya',
        pending.message,
        setRightState,
        true, // paymentConfirmed
        {
          content: pending.thinkingContent,
          startTime: pending.thinkingStartTime,
          duration: pending.thinkingDuration,
        }
      );
    } else {
      // User declined
      setRightState(prev => ({
        ...prev,
        paymentStatus: 'declined',
        paymentRequired: false,
        pendingPaymentRequest: null,
        txProcessing: false,
        txHash: null,
        txLink: null,
        txError: null,
        messages: [...prev.messages, {
          id: generateId(),
          role: 'assistant',
          content: 'Payment declined. I cannot access the detailed weather data without payment.',
        }],
      }));
    }
  }, [rightState.pendingPaymentRequest, streamResponse]);

  // Handle sending message to both columns
  const handleSendToBoth = useCallback((content: string) => {
    // Start streaming for both columns in parallel
    streamResponse('x402-only', content, setLeftState);
    streamResponse('x402-kya', content, setRightState);
  }, [streamResponse]);

  // Reset both columns
  const handleReset = useCallback(() => {
    setLeftState({ ...initialStreamState });
    setRightState({ ...initialStreamState });
  }, []);

  const isEitherStreaming = leftState.isStreaming || rightState.isStreaming;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--background)]">
      {/* Header */}
      <Header onReset={handleReset} />

      {/* Main content - Two columns */}
      <div className="flex-1 flex min-h-0">
        {/* Left Column - x402 Only (Anonymous) */}
        <div className="flex-1 border-r border-[var(--border)] flex flex-col min-h-0">
          <ScenarioColumn
            scenario="x402-only"
            state={leftState}
            onPaymentDecision={handleLeftPaymentDecision}
          />
        </div>

        {/* Right Column - x402 + KYA (Verified) */}
        <div className="flex-1 flex flex-col min-h-0">
          <ScenarioColumn
            scenario="x402-kya"
            state={rightState}
            onPaymentDecision={handleRightPaymentDecision}
          />
        </div>
      </div>

      {/* Unified input at bottom */}
      <UnifiedInput
        onSend={handleSendToBoth}
        disabled={isEitherStreaming}
      />
    </div>
  );
}
