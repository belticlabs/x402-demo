'use client';

import { useState, useCallback, useRef, useEffect, KeyboardEvent } from 'react';
import Image from 'next/image';
import { ShieldCheck, Shield, ArrowUp, Loader2, ExternalLink, CheckCircle2, RotateCcw, Sun, Moon } from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ChainOfThought from '@/components/ChainOfThought';
import PaymentModal from '@/components/PaymentModal';
import VerifiedBadge from '@/components/VerifiedBadge';
import { useTheme } from '@/components/ThemeProvider';
import { createLineBufferParser, parseSseDataLine } from '@/lib/sse';

export type Scenario = 'x402-only' | 'x402-kya';
type PaymentFlowState =
  | 'idle'
  | 'streaming'
  | 'payment_required'
  | 'payment_waiting'
  | 'payment_processing'
  | 'payment_failed'
  | 'completed';

const KYA_TIER_OPTIONS = ['tier_0', 'tier_1', 'tier_2', 'tier_3', 'tier_4'] as const;
type KybTier = (typeof KYA_TIER_OPTIONS)[number];

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
  paymentFlowState: PaymentFlowState;
  paymentRequired: boolean;
  paymentInfo: {
    resource: string;
    basePrice: number;
    finalPrice: number;
    discount: number;
  } | null;
  paymentSessionId: string | null;
  paymentAttemptId: string | null;
  isPayActionLocked: boolean;
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
    paymentSessionId: string;
    minKybTier: KybTier;
  } | null;
}

// Generate unique ID for messages
let messageCounter = 0;
function generateId(): string {
  return `msg-${Date.now()}-${++messageCounter}`;
}

function generateClientId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isPaymentBlockingState(state: StreamState): boolean {
  if (state.isPayActionLocked) return true;
  if (state.pendingPaymentRequest) return true;
  return (
    state.paymentFlowState === 'payment_required' ||
    state.paymentFlowState === 'payment_waiting' ||
    state.paymentFlowState === 'payment_processing' ||
    state.paymentFlowState === 'payment_failed'
  );
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

// Agent credential type from API (matches credential-loader output)
interface AgentCredentialData {
  agentName: string;
  agentId: string;
  agentVersion: string;
  agentDescription: string;
  credentialId: string;
  modelProvider: string;
  modelFamily: string;
  modelContextWindow: number;
  architectureType: string;
  modalities?: string[];
  languages?: string[];
  runtimeModel: {
    provider: string;
    model: string;
    modelId: string;
  };
  issuerDid: string;
  verificationLevel: string;
  kybTier: string;
  developerVerified: boolean;
  overallSafetyRating: string;
  safetyScores: {
    harmfulContent: number;
    promptInjection: number;
    piiLeakage: number;
    toolAbuse: number;
  };
  averageSafetyScore: number;
  issuedAt: string;
  expiresAt: string;
  status: string;
  // Tools
  toolsCount?: number;
  tools?: Array<{
    name: string;
    riskCategory: string;
    requiresApproval: boolean;
  }>;
  // Data handling
  dataCategories?: string[];
  dataRetention?: string;
  complianceCerts?: string[];
  deploymentRegion?: string;
  // Pricing
  pricing: {
    basePrice: number;
    discount: number;
    finalPrice: number;
    kybDiscount: number;
    safetyDiscount: number;
  };
  source: {
    loadedFrom: string;
    belticDir: string;
  };
}

// Format date for display (e.g., "Feb 2026")
function formatCredentialDate(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch {
    return isoDate;
  }
}
const TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

function isTransactionHash(value: string): boolean {
  return TX_HASH_PATTERN.test(value);
}

function buildTxExplorerLink(txHash: string): string {
  if (!isTransactionHash(txHash)) {
    return '';
  }
  return `https://sepolia.basescan.org/tx/${txHash}`;
}

// Map verification level to display text
function getOverallRating(verificationLevel: string, safetyRating?: string): string {
  if (safetyRating && safetyRating !== 'evaluation_pending') {
    return safetyRating.toUpperCase().replace(/_/g, ' ');
  }
  // For self-attested credentials, show a neutral rating
  if (verificationLevel === 'self_attested') {
    return 'SELF-ATTESTED';
  }
  return 'VERIFIED';
}

// Default/fallback agent info (used while loading)
const defaultAgentInfo = {
  agentName: 'Loading...',
  agentId: '...',
  agentVersion: '...',
  agentDescription: '',
  credentialId: '',
  modelProvider: '',
  modelFamily: '',
  modelContextWindow: 0,
  architectureType: '',
  modalities: [] as string[],
  languages: [] as string[],
  runtimeModel: { provider: '', model: '', modelId: '' },
  kybTier: '...',
  verificationLevel: '',
  developerVerified: false,
  safetyScores: {
    harmfulContent: 0,
    promptInjection: 0,
    piiLeakage: 0,
    toolAbuse: 0,
  },
  overallRating: '...',
  toolsCount: 0,
  tools: [] as Array<{ name: string; riskCategory: string; requiresApproval: boolean }>,
  dataCategories: [] as string[],
  dataRetention: '',
  complianceCerts: [] as string[],
  deploymentRegion: '',
  validFrom: '...',
  validUntil: '...',
  status: '',
  issuer: '...',
  loadedFrom: '',
};

// Header component - minimal
function Header({
  onReset,
  minKybTier,
  onMinKybTierChange,
  controlsDisabled,
}: {
  onReset: () => void;
  minKybTier: KybTier;
  onMinKybTierChange: (tier: KybTier) => void;
  controlsDisabled: boolean;
}) {
  const { theme, toggleTheme } = useTheme();

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
          <KybTierSelector
            value={minKybTier}
            onChange={onMinKybTierChange}
            disabled={controlsDisabled}
          />
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center w-9 h-9 text-[var(--muted)] hover:text-[var(--foreground)] border border-[var(--border)] hover:border-[var(--border-hover)] rounded-lg transition-colors"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
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
      <div className="prose prose-base dark:prose-invert max-w-none text-[var(--foreground)] leading-relaxed prose-p:text-[var(--foreground)] prose-strong:text-[var(--foreground)] prose-headings:text-[var(--foreground)]">
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

// Verified badge props type (matches VerifiedBadge component)
interface VerifiedBadgeInfo {
  agentName: string;
  agentId: string;
  agentVersion: string;
  agentDescription?: string;
  credentialId?: string;
  modelProvider?: string;
  modelFamily?: string;
  modelContextWindow?: number;
  architectureType?: string;
  modalities?: string[];
  languages?: string[];
  runtimeModel: {
    provider: string;
    model: string;
    modelId: string;
  };
  kybTier: string;
  verificationLevel?: string;
  developerVerified?: boolean;
  safetyScores: {
    harmfulContent: number;
    promptInjection: number;
    piiLeakage: number;
    toolAbuse: number;
  };
  overallRating: string;
  toolsCount?: number;
  tools?: Array<{ name: string; riskCategory: string; requiresApproval: boolean }>;
  dataCategories?: string[];
  dataRetention?: string;
  complianceCerts?: string[];
  deploymentRegion?: string;
  validFrom: string;
  validUntil: string;
  status?: string;
  issuer: string;
  loadedFrom?: string;
}

interface KybTierSelectorProps {
  value: KybTier;
  onChange: (tier: KybTier) => void;
  disabled?: boolean;
}

function KybTierSelector({ value, onChange, disabled = false }: KybTierSelectorProps) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-xs text-[var(--muted)] whitespace-nowrap">Min KYB tier</span>
      <div className="inline-flex rounded-md border border-[var(--border)] overflow-hidden bg-[var(--surface)]">
        {KYA_TIER_OPTIONS.map((tier, idx) => (
          <button
            type="button"
            onClick={() => onChange(tier)}
            disabled={disabled}
              className={clsx(
                "px-2.5 py-1.5 text-xs transition-colors",
                value === tier
                  ? "border-l-0"
                  : idx > 0 && "border-l border-[var(--border)]",
                "last:border-r-0",
                value === tier
                  ? "bg-[var(--surface-hover)] text-[var(--foreground)] border-[var(--foreground)]/30 dark:bg-[var(--accent)] dark:text-[#14120B] dark:border-[var(--accent-hover)] dark:font-semibold dark:brightness-110"
                  : "text-[var(--foreground)] hover:bg-[var(--surface-hover)]",
                "outline-none focus:outline-none",
                "dark:focus-visible:ring-2 dark:focus-visible:ring-[var(--accent)] dark:focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[var(--surface)]",
                "focus-visible:shadow-none",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            key={tier}
            onMouseDown={(event) => event.currentTarget.blur()}
          >
            {idx}
          </button>
        ))}
      </div>
    </div>
  );
}

// Scenario column component
interface ScenarioColumnProps {
  scenario: Scenario;
  state: StreamState;
  onPaymentDecision: (accepted: boolean) => void;
  agentInfo: VerifiedBadgeInfo;
}

function ScenarioColumn({ scenario, state, onPaymentDecision, agentInfo }: ScenarioColumnProps) {
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
          <VerifiedBadge {...agentInfo} />
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
            disableActions={state.isPayActionLocked}
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
              {state.lastTx.link ? (
                <a
                  href={state.lastTx.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] inline-flex items-center gap-1 font-mono"
                >
                  {state.lastTx.hash.slice(0, 10)}...{state.lastTx.hash.slice(-8)}
                  <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <span className="text-xs text-[var(--muted)] font-mono">
                  {state.lastTx.hash.slice(0, 10)}...{state.lastTx.hash.slice(-8)} (verification link unavailable)
                </span>
              )}
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
  'Ask about the weather in any city, region, or country',
  'Get detailed weather for a region you care about',
  'Compare weather at two places',
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
  paymentFlowState: 'idle',
  paymentRequired: false,
  paymentInfo: null,
  paymentSessionId: null,
  paymentAttemptId: null,
  isPayActionLocked: false,
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
  const payClickLocks = useRef<{ left: boolean; right: boolean }>({ left: false, right: false });
  const [selectedKybTier, setSelectedKybTier] = useState<KybTier>('tier_2');

  // Agent credential info (fetched from API)
  const [agentInfo, setAgentInfo] = useState<VerifiedBadgeInfo>(defaultAgentInfo);

  // Fetch credential data on mount
  useEffect(() => {
    async function fetchCredential() {
      try {
        const response = await fetch('/api/credential');
        const data = await response.json();

        if (data.success && data.credential) {
          const cred = data.credential as AgentCredentialData;
          setAgentInfo({
            // Identity
            agentName: cred.agentName,
            agentId: cred.agentId,
            agentVersion: cred.agentVersion,
            agentDescription: cred.agentDescription,
            credentialId: cred.credentialId,
            // Model
            modelProvider: cred.modelProvider,
            modelFamily: cred.modelFamily,
            modelContextWindow: cred.modelContextWindow,
            architectureType: cred.architectureType,
            modalities: cred.modalities,
            languages: cred.languages,
            runtimeModel: cred.runtimeModel,
            // Verification
            kybTier: cred.kybTier || cred.verificationLevel,
            verificationLevel: cred.verificationLevel,
            developerVerified: cred.developerVerified,
            // Safety
            safetyScores: cred.safetyScores,
            overallRating: getOverallRating(cred.verificationLevel, cred.overallSafetyRating),
            // Tools
            toolsCount: cred.toolsCount,
            tools: cred.tools,
            // Data
            dataCategories: cred.dataCategories,
            dataRetention: cred.dataRetention,
            complianceCerts: cred.complianceCerts,
            deploymentRegion: cred.deploymentRegion,
            // Validity
            validFrom: formatCredentialDate(cred.issuedAt),
            validUntil: formatCredentialDate(cred.expiresAt),
            status: cred.status,
            issuer: cred.issuerDid,
            loadedFrom: cred.source.loadedFrom,
          });
          // Log credential source
          console.log(`[UI] Credential loaded from: ${cred.source.loadedFrom}`);
          console.log(`[UI] Model: ${cred.modelProvider}/${cred.modelFamily}`);
        }
      } catch (error) {
        console.error('Failed to fetch credential:', error);
      }
    }
    fetchCredential();
  }, []);

  // Stream response for a specific scenario
  const streamResponse = useCallback(async (
    scenario: Scenario,
    userMessage: string,
    setState: React.Dispatch<React.SetStateAction<StreamState>>,
    paymentConfirmed: boolean = false,
    existingThinking?: { content: string; startTime: number | null; duration: number | null },
    paymentResume?: { paymentSessionId: string; paymentAttemptId: string; minKybTier?: KybTier }
  ) => {
    const requestedKybTier = paymentResume?.minKybTier || selectedKybTier;

    const hasValidPaymentResume =
      !!paymentResume?.paymentSessionId && !!paymentResume?.paymentAttemptId;

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
        paymentFlowState: 'streaming',
        paymentRequired: false,
        paymentInfo: null,
        paymentSessionId: null,
        paymentAttemptId: null,
        isPayActionLocked: false,
        paymentStatus: 'none',
        txProcessing: false,
        txHash: null,
        txLink: null,
        txError: null,
        lastTx: null, // Clear previous transaction
        pendingPaymentRequest: null,
      }));
    } else {
      if (!hasValidPaymentResume) {
        setState(prev => ({
          ...prev,
          isStreaming: false,
          paymentFlowState: 'payment_failed',
          txProcessing: false,
          txError: 'Missing payment session context. Please retry payment.',
          isPayActionLocked: false,
        }));
        return;
      }
      // This is a payment confirmation retry - just update streaming state
      // Keep paymentInfo so the modal can still display price
      setState(prev => ({
        ...prev,
        isStreaming: true,
        paymentFlowState: 'payment_processing',
        paymentRequired: true, // Keep modal open for processing state
        paymentSessionId: paymentResume?.paymentSessionId || prev.paymentSessionId,
        paymentAttemptId: paymentResume?.paymentAttemptId || prev.paymentAttemptId,
        isPayActionLocked: true,
        paymentStatus: 'pending',
        pendingPaymentRequest: null,
        txProcessing: true,
        txHash: null,
        txLink: null,
        txError: null,
      }));
    }

    try {
      // Use separate endpoints for each scenario
      const endpoint = scenario === 'x402-only' ? '/api/chat/general' : '/api/chat/beltic';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          paymentConfirmed,
          paymentSessionId: paymentResume?.paymentSessionId,
          paymentAttemptId: paymentResume?.paymentAttemptId,
          minKybTier: requestedKybTier,
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
      const lineParser = createLineBufferParser();
      let assistantMessageId: string | null = null;
      let fullContent = '';
      // Use existing thinking info if this is a retry
      const thinkingContent = existingThinking?.content || '';
      let thinkingStartTime: number | null = existingThinking?.startTime || null;
      let thinkingDuration: number | null = existingThinking?.duration || null;

      const processLine = (line: string) => {
        const payload = parseSseDataLine(line);
        if (!payload || payload === '[DONE]') return;

        try {
          const event = JSON.parse(payload) as {
            type: string;
            duration?: number;
            resource?: string;
            basePrice?: number;
            finalPrice?: number;
            discount?: number;
            paymentSessionId?: string;
            txHash?: string;
            txLink?: string;
            error?: string;
            text?: string;
            message?: string;
          };

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
              thinkingDuration = event.duration ?? thinkingDuration;
              setState(prev => ({
                ...prev,
                isThinking: false,
                thinkingDuration: thinkingDuration,
              }));
              break;

            case 'payment_required':
              setState(prev => ({
                ...prev,
                paymentFlowState: 'payment_required',
                paymentRequired: true,
                paymentInfo: {
                  resource: event.resource || 'Paid API',
                  basePrice: event.basePrice ?? 0,
                  finalPrice: event.finalPrice ?? 0,
                  discount: event.discount ?? 0,
                },
                paymentSessionId: event.paymentSessionId || prev.paymentSessionId,
                paymentAttemptId: null,
                isPayActionLocked: false,
                paymentStatus: 'pending',
                txProcessing: false,
                txError: null,
              }));
              break;

            case 'payment_waiting':
              setState(prev => {
                const paymentSessionId =
                  event.paymentSessionId || prev.paymentSessionId;
                if (!paymentSessionId) return prev;
                return {
                  ...prev,
                  paymentFlowState: 'payment_waiting',
                  isStreaming: false,
                  txProcessing: false,
                  isPayActionLocked: false,
                  paymentSessionId,
                  pendingPaymentRequest: {
                    message: userMessage,
                    thinkingContent,
                    thinkingStartTime,
                    thinkingDuration,
                    paymentSessionId,
                    minKybTier: requestedKybTier,
                  },
                };
              });
              break;

            case 'payment_processing':
              setState(prev => ({
                ...prev,
                paymentFlowState: 'payment_processing',
                txProcessing: true,
                txError: null,
                isPayActionLocked: true,
                paymentSessionId: event.paymentSessionId || prev.paymentSessionId,
              }));
              break;

            case 'payment_accepted':
              const acceptedTxHash = event.txHash || '';
              const acceptedTxLink = event.txLink || buildTxExplorerLink(acceptedTxHash);
              setState(prev => ({
                ...prev,
                paymentFlowState: 'completed',
                paymentStatus: 'accepted',
                paymentRequired: false,
                pendingPaymentRequest: null,
                txProcessing: false,
                txHash: acceptedTxHash || null,
                txLink: acceptedTxLink || null,
                txError: null,
                isPayActionLocked: false,
                paymentSessionId: event.paymentSessionId || prev.paymentSessionId,
                paymentAttemptId: null,
                lastTx: acceptedTxHash && acceptedTxHash !== 'simulated' ? {
                  hash: acceptedTxHash,
                  link: acceptedTxLink,
                  amount: prev.paymentInfo ? `$${prev.paymentInfo.finalPrice.toFixed(4)}` : '',
                } : null,
              }));
              break;

            case 'payment_failed':
              setState(prev => {
                const paymentSessionId =
                  event.paymentSessionId || prev.paymentSessionId;
                if (!paymentSessionId) {
                  return {
                    ...prev,
                    paymentFlowState: 'payment_failed',
                    txProcessing: false,
                    txError: event.error || 'Transaction failed',
                    paymentRequired: true,
                    isPayActionLocked: false,
                    paymentAttemptId: null,
                  };
                }
                return {
                  ...prev,
                  paymentFlowState: 'payment_failed',
                  txProcessing: false,
                  txError: event.error || 'Transaction failed',
                  paymentRequired: true,
                  paymentStatus: 'pending',
                  isPayActionLocked: false,
                  paymentSessionId,
                  paymentAttemptId: null,
                  pendingPaymentRequest: {
                    message: userMessage,
                    thinkingContent,
                    thinkingStartTime,
                    thinkingDuration,
                    paymentSessionId,
                    minKybTier: requestedKybTier,
                  },
                };
              });
              break;

            case 'content':
              if (!event.text) break;
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
                    content: `Error: ${event.message || 'Unknown error'}`,
                  }],
                }));
              }
              break;

            case 'done':
              break;
          }
        } catch {
          // Ignore JSON parse errors from malformed lines
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of lineParser.push(chunk)) {
          processLine(line);
        }
      }

      for (const line of lineParser.push(decoder.decode())) {
        processLine(line);
      }
      for (const line of lineParser.flush()) {
        processLine(line);
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
        if (isPaymentBlockingState(prev)) {
          return {
            ...prev,
            isStreaming: false,
            streamingMessageId: null,
            isThinking: false,
          };
        }
        return {
          ...prev,
          isStreaming: false,
          streamingMessageId: null,
          isThinking: false,
          paymentFlowState: 'idle',
          paymentRequired: false,
          paymentSessionId: null,
          paymentAttemptId: null,
          isPayActionLocked: false,
          paymentStatus: 'none',
          txProcessing: false,
          txHash: null,
          txLink: null,
          txError: null,
        };
      });
    }
  }, [selectedKybTier]);

  const handlePaymentDecision = useCallback((
    scenario: Scenario,
    state: StreamState,
    setState: React.Dispatch<React.SetStateAction<StreamState>>,
    lockKey: 'left' | 'right',
    accepted: boolean
  ) => {
    if (!accepted) {
      setState(prev => {
        if (!prev.pendingPaymentRequest || prev.isPayActionLocked || prev.txProcessing) {
          return prev;
        }
        payClickLocks.current[lockKey] = false;
        return {
          ...prev,
          paymentFlowState: 'completed',
          paymentStatus: 'declined',
          paymentRequired: false,
          paymentSessionId: null,
          paymentAttemptId: null,
          pendingPaymentRequest: null,
          txProcessing: false,
          txHash: null,
          txLink: null,
          txError: null,
          isPayActionLocked: false,
          messages: [...prev.messages, {
            id: generateId(),
            role: 'assistant',
            content: 'Payment declined. I cannot access the detailed weather data without payment.',
          }],
        };
      });
      return;
    }

    if (payClickLocks.current[lockKey]) return;
    if (!state.pendingPaymentRequest || state.isPayActionLocked || state.txProcessing) return;

    const pending = state.pendingPaymentRequest;
    const paymentAttemptId = generateClientId('pay-attempt');
    payClickLocks.current[lockKey] = true;

    setState(prev => {
      if (!prev.pendingPaymentRequest || prev.isPayActionLocked || prev.txProcessing) {
        payClickLocks.current[lockKey] = false;
        return prev;
      }
      return {
        ...prev,
        isStreaming: true,
        paymentFlowState: 'payment_processing',
        paymentRequired: true,
        paymentStatus: 'pending',
        pendingPaymentRequest: null,
        txProcessing: true,
        txError: null,
        isPayActionLocked: true,
        paymentAttemptId,
      };
    });

    void streamResponse(
      scenario,
      pending.message,
      setState,
      true,
      {
        content: pending.thinkingContent,
        startTime: pending.thinkingStartTime,
        duration: pending.thinkingDuration,
      },
      {
        paymentSessionId: pending.paymentSessionId,
        paymentAttemptId,
        minKybTier: pending.minKybTier,
      }
    ).finally(() => {
      payClickLocks.current[lockKey] = false;
    });
  }, [streamResponse]);

  const handleLeftPaymentDecision = useCallback((accepted: boolean) => {
    handlePaymentDecision('x402-only', leftState, setLeftState, 'left', accepted);
  }, [handlePaymentDecision, leftState]);

  const handleRightPaymentDecision = useCallback((accepted: boolean) => {
    handlePaymentDecision('x402-kya', rightState, setRightState, 'right', accepted);
  }, [handlePaymentDecision, rightState]);

  // Handle sending message to both columns
  const handleSendToBoth = useCallback((content: string) => {
    // Start streaming for both columns in parallel
    streamResponse('x402-only', content, setLeftState, false, undefined, undefined);
    streamResponse('x402-kya', content, setRightState, false, undefined, undefined);
  }, [streamResponse, selectedKybTier]);

  // Reset both columns
  const handleReset = useCallback(() => {
    setLeftState({ ...initialStreamState });
    setRightState({ ...initialStreamState });
  }, []);

  const isEitherStreaming = leftState.isStreaming || rightState.isStreaming;
  const isInputBlocked =
    isEitherStreaming ||
    isPaymentBlockingState(leftState) ||
    isPaymentBlockingState(rightState);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--background)]">
      {/* Header */}
      <Header
        onReset={handleReset}
        minKybTier={selectedKybTier}
        onMinKybTierChange={setSelectedKybTier}
        controlsDisabled={isInputBlocked}
      />

      {/* Main content - Two columns */}
      <div className="flex-1 flex min-h-0">
        {/* Left Column - x402 Only (Anonymous) */}
        <div className="flex-1 border-r border-[var(--border)] flex flex-col min-h-0">
          <ScenarioColumn
            scenario="x402-only"
            state={leftState}
            onPaymentDecision={handleLeftPaymentDecision}
            agentInfo={agentInfo}
          />
        </div>

        {/* Right Column - x402 + KYA (Verified) */}
        <div className="flex-1 flex flex-col min-h-0">
          <ScenarioColumn
            scenario="x402-kya"
            state={rightState}
            onPaymentDecision={handleRightPaymentDecision}
            agentInfo={agentInfo}
          />
        </div>
      </div>

      {/* Unified input at bottom */}
      <UnifiedInput
        onSend={handleSendToBoth}
        disabled={isInputBlocked}
      />
    </div>
  );
}
