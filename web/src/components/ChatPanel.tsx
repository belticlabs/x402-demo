'use client';

import { useState, useCallback } from 'react';
import { Shield, ShieldCheck, Zap } from 'lucide-react';
import clsx from 'clsx';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import PaymentFlow, { PaymentStep } from './PaymentFlow';
import { MessageType } from './Message';

export type Scenario = 'x402-only' | 'x402-kya';

interface ChatPanelProps {
  scenario: Scenario;
}

// Generate unique ID for messages
let messageCounter = 0;
function generateId(): string {
  return `msg-${Date.now()}-${++messageCounter}`;
}

export default function ChatPanel({ scenario }: ChatPanelProps) {
  const [messages, setMessages] = useState<MessageType[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [paymentStep, setPaymentStep] = useState<PaymentStep>('idle');
  const [paymentError, setPaymentError] = useState<string | undefined>();

  const isVerified = scenario === 'x402-kya';

  const scenarioConfig = {
    'x402-only': {
      title: 'x402 Only',
      description: 'Anonymous agent with payment capability',
      badge: {
        icon: Shield,
        text: 'Anonymous',
        className: 'bg-[var(--surface-hover)] text-[var(--muted-foreground)]',
      },
    },
    'x402-kya': {
      title: 'x402 + KYA',
      description: 'Verified agent with payment capability',
      badge: {
        icon: ShieldCheck,
        text: 'Verified',
        className: 'bg-[var(--success-muted)] text-[var(--success)]',
      },
    },
  };

  const config = scenarioConfig[scenario];
  const BadgeIcon = config.badge.icon;

  const handleSend = useCallback(async (content: string) => {
    // Add user message
    const userMessage: MessageType = {
      id: generateId(),
      role: 'user',
      content,
    };
    setMessages(prev => [...prev, userMessage]);

    // Start streaming state (waiting for first token)
    setIsStreaming(true);
    setStreamingMessageId(null);
    setPaymentStep('idle');
    setPaymentError(undefined);

    try {
      // Call the API endpoint
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          scenario,
          messages: [...messages, userMessage].map(m => ({
            role: m.role,
            content: m.content,
          })),
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6);

            // Check for done signal
            if (payload === '[DONE]') {
              break;
            }

            try {
              const data = JSON.parse(payload);

              // Handle payment flow updates
              if (data.paymentStep) {
                setPaymentStep(data.paymentStep as PaymentStep);
                if (data.error) {
                  setPaymentError(data.error);
                }
              }

              // Handle text content
              if (data.text) {
                fullContent += data.text;

                if (!assistantMessageId) {
                  assistantMessageId = generateId();
                  setStreamingMessageId(assistantMessageId);
                  setMessages(prev => [...prev, {
                    id: assistantMessageId!,
                    role: 'assistant',
                    content: fullContent,
                  }]);
                } else {
                  setMessages(prev => prev.map(m =>
                    m.id === assistantMessageId
                      ? { ...m, content: fullContent }
                      : m
                  ));
                }
              }

              // Handle error
              if (data.error && !data.paymentStep) {
                if (!assistantMessageId) {
                  assistantMessageId = generateId();
                  setMessages(prev => [...prev, {
                    id: assistantMessageId!,
                    role: 'assistant',
                    content: `Error: ${data.error}`,
                  }]);
                } else {
                  setMessages(prev => prev.map(m =>
                    m.id === assistantMessageId
                      ? { ...m, content: `Error: ${data.error}` }
                      : m
                  ));
                }
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
      setMessages(prev => [...prev, {
        id: errorMessageId,
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
      }]);
    } finally {
      setIsStreaming(false);
      setStreamingMessageId(null);
    }
  }, [scenario, messages]);

  return (
    <div className="flex flex-col h-full bg-[var(--surface)] rounded-xl border border-[var(--border)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[var(--surface-hover)] rounded-lg">
            <Zap className="w-4 h-4 text-[var(--accent)]" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-[var(--foreground)]">{config.title}</h3>
            <p className="text-xs text-[var(--muted)]">{config.description}</p>
          </div>
        </div>

        {/* Agent status badge */}
        <div className={clsx(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
          config.badge.className
        )}>
          <BadgeIcon className="w-3.5 h-3.5" />
          <span>{config.badge.text}</span>
        </div>
      </div>

      {/* Payment flow visualization */}
      {paymentStep !== 'idle' && (
        <div className="px-4 pt-4">
          <PaymentFlow
            step={paymentStep}
            isVerified={isVerified}
            error={paymentError}
          />
        </div>
      )}

      {/* Messages */}
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        streamingMessageId={streamingMessageId}
      />

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        disabled={isStreaming}
        placeholder={`Ask the ${isVerified ? 'verified' : 'anonymous'} agent...`}
      />
    </div>
  );
}
