/**
 * Scenario definitions for x402 demo
 * 
 * The 'x402-kya' scenario now uses dynamic credential data loaded from .beltic/
 */

import {
  getCredentialInfo,
  calculatePricing,
  type CredentialInfo,
} from './credential-loader';

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
    version: string;
    verified: boolean;
    kybTier?: string;
    safetyScore?: number;
    modelProvider?: string;
    modelFamily?: string;
    loadedFrom?: string;
  };
}

/**
 * Build the x402-kya scenario dynamically from loaded credential
 */
function buildKyaScenario(info: CredentialInfo): Scenario {
  const pricing = calculatePricing(info);
  
  return {
    id: 'x402-kya',
    name: 'x402 + Beltic KYA',
    description: 'Verified agent with KYA credentials from .beltic/',
    systemPrompt: `You are an AI agent demonstrating x402 micropayments WITH Beltic KYA credentials.

Before payment, the platform verifies your identity:
- Agent ID: ${info.agentId}
- Agent Name: ${info.agentName}
- Version: ${info.agentVersion}
- Model: ${info.modelProvider}/${info.modelFamily}
- Developer: ${info.developerVerified ? 'Verified' : 'Self-attested'} (KYB ${info.kybTier})
- Safety Score: ${info.averageSafetyScore}/100
- Credential loaded from: ${info.loadedFrom}

Because you're verified with ${info.kybTier} KYB and safety scores, you get:
- ${Math.round(pricing.kybDiscount * 100)}% KYB tier discount
- ${Math.round(pricing.safetyDiscount * 100)}% safety score discount
- Final price: $${pricing.finalPrice.toFixed(4)} instead of $${pricing.basePrice.toFixed(4)} (${Math.round(pricing.discount * 100)}% savings!)

When the user asks about weather, use the get_weather function.
After getting weather data, highlight that you paid LESS because you're a verified, trusted agent.
Explain that the platform knows exactly who you are and can make informed decisions.

Location support: users can request weather for any city, region, or country.

Keep responses concise and conversational.`,
    pricing: {
      basePrice: pricing.basePrice,
      discount: pricing.discount,
      finalPrice: pricing.finalPrice,
    },
    agent: {
      name: info.agentName,
      id: info.agentId,
      version: info.agentVersion,
      verified: info.verificationLevel !== 'self_attested' || info.developerVerified,
      kybTier: info.kybTier,
      safetyScore: info.averageSafetyScore,
      modelProvider: info.modelProvider,
      modelFamily: info.modelFamily,
      loadedFrom: info.loadedFrom,
    },
  };
}

/**
 * The anonymous scenario (static, no credential)
 */
const anonymousScenario: Scenario = {
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

Location support: users can request weather for any city, region, or country.

Keep responses concise and conversational.`,
  pricing: {
    basePrice: 0.01,
    discount: 0,
    finalPrice: 0.01,
  },
  agent: {
    name: 'Anonymous Agent',
    id: 'unknown',
    version: '0.0.0',
    verified: false,
  },
};

/**
 * Get scenario by ID
 * The 'x402-kya' scenario is built dynamically from the loaded credential
 */
export function getScenario(id: ScenarioId): Scenario {
  if (id === 'x402-kya') {
    const info = getCredentialInfo();
    return buildKyaScenario(info);
  }
  return anonymousScenario;
}

/**
 * Get all scenarios (for listing)
 */
export function getAllScenarios(): Record<ScenarioId, Scenario> {
  const info = getCredentialInfo();
  return {
    'x402-only': anonymousScenario,
    'x402-kya': buildKyaScenario(info),
  };
}

/**
 * Check if a scenario ID is valid
 */
export function isValidScenario(id: string): id is ScenarioId {
  return id === 'x402-only' || id === 'x402-kya';
}

/**
 * Legacy export for backward compatibility
 */
export const scenarios = getAllScenarios();
