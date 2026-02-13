'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { Shield, ShieldCheck, Zap, Building2, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ChainOfThought from './ChainOfThought';
import PaymentModal from './PaymentModal';

// Message type specific to ScenarioColumn
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: {
    content: string;
    duration: number;
  };
  payment?: {
    resource: string;
    basePrice: number;
    finalPrice: number;
    discount?: number;
    status: 'pending' | 'accepted' | 'declined';
  };
}

// Agent info for verified badge
interface AgentInfo {
  name: string;
  organization: string;
  verifiedAt: string;
}

interface ScenarioColumnProps {
  scenario: 'x402-only' | 'x402-kya';
  messages: Message[];
  onPaymentDecision: (accepted: boolean) => void;
  // Optional streaming state from parent
  isThinking?: boolean;
  thinkingContent?: string;
  thinkingStartTime?: number;
  isStreaming?: boolean;
  streamingMessageId?: string | null;
  // Optional agent info for verified badge
  agentInfo?: AgentInfo;
}

// Message bubble component
function MessageBubble({
  message,
  isStreaming,
  variant,
}: {
  message: Message;
  isStreaming?: boolean;
  variant: 'anonymous' | 'verified';
}) {
  // User message - right-aligned
  if (message.role === 'user') {
    return (
      <div className="mb-4 flex justify-end animate-fade-in">
        <div className="max-w-[80%]">
          <div
            className={clsx(
              'rounded-2xl rounded-br-md px-4 py-2.5 text-white',
              variant === 'verified'
                ? 'bg-[var(--success)]'
                : 'bg-[var(--accent)]'
            )}
          >
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {message.content}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Assistant message - left-aligned
  return (
    <div className="mb-4 flex justify-start animate-fade-in">
      <div className="max-w-[80%]">
        <div
          className={clsx(
            'rounded-2xl rounded-bl-md px-4 py-2.5',
            'bg-[var(--surface)] border',
            variant === 'verified'
              ? 'border-[var(--success)]/20'
              : 'border-[var(--border)]'
          )}
        >
          <div
            className={clsx(
              'prose prose-sm prose-invert max-w-none',
              'prose-p:my-1.5 prose-p:leading-relaxed',
              'prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5',
              'prose-headings:mt-3 prose-headings:mb-1.5',
              'prose-code:bg-[var(--background)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs',
              'prose-pre:bg-[var(--background)] prose-pre:p-3 prose-pre:rounded-lg',
              'prose-a:text-[var(--accent)] prose-a:no-underline hover:prose-a:underline'
            )}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
            {isStreaming && (
              <span className="inline-block w-0.5 h-4 bg-[var(--foreground)] animate-pulse ml-0.5 align-middle" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Verified badge component
function VerifiedBadge({ agentInfo }: { agentInfo: AgentInfo }) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setShowTooltip(!showTooltip)}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={clsx(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
          'bg-[var(--success-muted)] text-[var(--success)]',
          'hover:bg-[var(--success)]/20 transition-colors cursor-pointer'
        )}
      >
        <ShieldCheck className="w-3.5 h-3.5" />
        <span>Verified</span>
      </button>

      {/* Tooltip with agent info */}
      {showTooltip && (
        <div
          className={clsx(
            'absolute top-full right-0 mt-2 z-50',
            'bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg',
            'p-3 min-w-[200px] animate-fade-in'
          )}
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
              <ShieldCheck className="w-4 h-4 text-[var(--success)]" />
              <span>{agentInfo.name}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <Building2 className="w-3.5 h-3.5" />
              <span>{agentInfo.organization}</span>
            </div>
            <div className="pt-2 border-t border-[var(--border)]">
              <p className="text-[10px] text-[var(--muted)]">
                Verified on {agentInfo.verifiedAt}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ScenarioColumn({
  scenario,
  messages,
  onPaymentDecision,
  isThinking = false,
  thinkingContent = '',
  thinkingStartTime,
  isStreaming = false,
  streamingMessageId = null,
  agentInfo,
}: ScenarioColumnProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [localThinkingStartTime] = useState(() => Date.now());
  const [defaultVerifiedDate] = useState(() => new Date().toLocaleDateString());

  const isVerified = scenario === 'x402-kya';
  const variant = isVerified ? 'verified' : 'anonymous';

  // Scenario configuration
  const scenarioConfig = {
    'x402-only': {
      title: 'Anonymous Agent',
      subtitle: 'x402 payments only',
      icon: Shield,
      accentColor: 'var(--accent)',
      badgeClass: 'bg-[var(--surface-hover)] text-[var(--muted-foreground)]',
    },
    'x402-kya': {
      title: 'Verified Agent',
      subtitle: 'x402 + KYA identity',
      icon: ShieldCheck,
      accentColor: 'var(--success)',
      badgeClass: 'bg-[var(--success-muted)] text-[var(--success)]',
    },
  };

  const config = scenarioConfig[scenario];
  const HeaderIcon = config.icon;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking, isStreaming]);

  // Handle payment accept/decline
  const handleAcceptPayment = useCallback(() => {
    onPaymentDecision(true);
  }, [onPaymentDecision]);

  const handleDeclinePayment = useCallback(() => {
    onPaymentDecision(false);
  }, [onPaymentDecision]);

  // Default agent info if not provided
  const defaultAgentInfo: AgentInfo = {
    name: 'Demo Agent',
    organization: 'Beltic Labs',
    verifiedAt: defaultVerifiedDate,
  };

  return (
    <div className="flex flex-col h-full bg-[var(--surface)] rounded-xl border border-[var(--border)] overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={clsx(
              'p-2 rounded-lg',
              isVerified ? 'bg-[var(--success-muted)]' : 'bg-[var(--surface-hover)]'
            )}
          >
            <HeaderIcon
              className={clsx(
                'w-4 h-4',
                isVerified ? 'text-[var(--success)]' : 'text-[var(--accent)]'
              )}
            />
          </div>
          <div>
            <h2 className="text-sm font-medium text-[var(--foreground)]">
              {config.title}
            </h2>
            <p className="text-xs text-[var(--muted)]">{config.subtitle}</p>
          </div>
        </div>

        {/* Show verified badge for x402-kya scenario */}
        {scenario === 'x402-kya' && (
          <VerifiedBadge agentInfo={agentInfo || defaultAgentInfo} />
        )}

        {/* Show anonymous badge for x402-only */}
        {scenario === 'x402-only' && (
          <div
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
              config.badgeClass
            )}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Anonymous</span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isThinking && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--muted)]">
            <Zap className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">Start a conversation</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            {/* Show chain of thought if message has thinking data */}
            {msg.thinking && msg.role === 'assistant' && (
              <ChainOfThought
                content={msg.thinking.content}
                isStreaming={false}
                startTime={localThinkingStartTime - msg.thinking.duration * 1000}
                defaultExpanded={false}
                variant={variant}
              />
            )}

            <MessageBubble
              message={msg}
              isStreaming={isStreaming && msg.id === streamingMessageId}
              variant={variant}
            />

            {/* Show payment modal inline if this message has a pending payment */}
            {msg.payment?.status === 'pending' && (
              <div className="my-4">
                <PaymentModal
                  isOpen={true}
                  scenario={scenario}
                  resource={msg.payment.resource}
                  basePrice={msg.payment.basePrice}
                  finalPrice={msg.payment.finalPrice}
                  discount={msg.payment.discount}
                  network="Base Sepolia"
                  onAccept={handleAcceptPayment}
                  onDecline={handleDeclinePayment}
                />
              </div>
            )}
          </div>
        ))}

        {/* Show active chain of thought if thinking */}
        {isThinking && thinkingContent && (
          <ChainOfThought
            content={thinkingContent}
            isStreaming={true}
            startTime={thinkingStartTime || localThinkingStartTime}
            defaultExpanded={true}
            variant={variant}
          />
        )}

        {/* Show loading indicator when waiting for first token */}
        {isStreaming && !streamingMessageId && !isThinking && (
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)] py-2 pl-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
