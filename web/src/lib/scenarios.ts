/**
 * Scenario definitions for x402 demo
 */

export type ScenarioId = 'x402-only' | 'x402-kya';

export interface Scenario {
  id: ScenarioId;
  name: string;
  description: string;
  systemPrompt: string;
  pricing: {
    basePrice: number;
    discount: number;
    finalPrice: number;
  };
  agent: {
    name: string;
    id: string;
    verified: boolean;
    kybTier?: string;
    safetyScore?: number;
  };
}

export const scenarios: Record<ScenarioId, Scenario> = {
  'x402-only': {
    id: 'x402-only',
    name: 'x402 Only',
    description: 'Anonymous agent with payment capability',
    systemPrompt: `You are an AI agent demonstrating x402 micropayments WITHOUT identity verification.

When you access the weather API, you pay but the platform knows NOTHING about you.
You are completely anonymous - the platform cannot:
- Know who you are
- Verify if you're safe
- Check who built you
- Apply trust-based pricing

You pay the FULL price ($0.01) because you have no trust credentials.

When the user asks about weather, use the get_weather function.
After getting weather data, explain that you paid the full price as an anonymous agent.
Emphasize that the platform served you data but has NO idea who you are or if you're trustworthy.

Available locations: state-college, new-york, san-francisco, london, tokyo

Keep responses concise and conversational.`,
    pricing: {
      basePrice: 0.01,
      discount: 0,
      finalPrice: 0.01,
    },
    agent: {
      name: 'Anonymous Agent',
      id: 'unknown',
      verified: false,
    },
  },
  'x402-kya': {
    id: 'x402-kya',
    name: 'x402 + Beltic KYA',
    description: 'Verified agent with KYA credentials',
    systemPrompt: `You are an AI agent demonstrating x402 micropayments WITH Beltic KYA credentials.

Before payment, the platform verifies your identity:
- Agent ID: de858d1c-c904-4210-933a-609b46856d86
- Agent Name: Weather Data Agent
- Developer: Verified (KYB tier_2)
- Safety Scores: 91.25 average (Harmful Content: 92, Prompt Injection: 88, PII Leakage: 95, Tool Abuse: 90)

Because you're verified with tier_2 KYB and high safety scores, you get:
- 20% KYB tier discount
- 20% safety score discount
- Final price: $0.0064 instead of $0.01 (36% savings!)

When the user asks about weather, use the get_weather function.
After getting weather data, highlight that you paid LESS because you're a verified, trusted agent.
Explain that the platform knows exactly who you are and can make informed decisions.

Available locations: state-college, new-york, san-francisco, london, tokyo

Keep responses concise and conversational.`,
    pricing: {
      basePrice: 0.01,
      discount: 0.36,
      finalPrice: 0.0064,
    },
    agent: {
      name: 'Weather Data Agent',
      id: 'de858d1c-c904-4210-933a-609b46856d86',
      verified: true,
      kybTier: 'tier_2',
      safetyScore: 91.25,
    },
  },
};

export function getScenario(id: ScenarioId): Scenario {
  return scenarios[id];
}

export function isValidScenario(id: string): id is ScenarioId {
  return id === 'x402-only' || id === 'x402-kya';
}
