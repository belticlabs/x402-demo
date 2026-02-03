// Message types for chat interface
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

// Agent types
export type AgentType = 'anonymous' | 'verified';

// Agent configuration
export interface AgentConfig {
  type: AgentType;
  name: string;
  description: string;
  icon: 'bot' | 'shield-check';
  color: 'muted' | 'success';
}

// Scenario for demo
export interface Scenario {
  id: string;
  title: string;
  description: string;
  userPrompt: string;
  expectedBehavior: {
    anonymous: string;
    verified: string;
  };
}

// Chat panel state
export interface ChatPanelState {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
}

// Payment request from x402
export interface PaymentRequest {
  amount: string;
  currency: string;
  recipient: string;
  memo?: string;
}

// KYA credential information
export interface KYACredential {
  issuer: string;
  subject: string;
  issuedAt: string;
  expiresAt: string;
  claims: Record<string, unknown>;
  signature: string;
}

// API response types
export interface ChatResponse {
  message: Message;
  paymentRequired?: PaymentRequest;
  kyaVerified?: boolean;
  kyaCredential?: KYACredential;
}

// Demo state
export interface DemoState {
  anonymous: ChatPanelState;
  verified: ChatPanelState;
  activeScenario: Scenario | null;
}
