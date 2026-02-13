/**
 * Credential Loader Utility
 * 
 * Loads and decodes Beltic KYA credentials from the local .beltic/ directory.
 * Uses @belticlabs/kya SDK for credential handling.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import {
  decodeToken,
  getCredentialType,
  validateAgentCredential,
  isAgentCredential,
  type AgentCredential,
} from '@belticlabs/kya';

// ============================================================================
// Constants
// ============================================================================

/** Credential filename candidates (search across directories). */
const CREDENTIAL_FILE_NAMES = [
  'agent-credential.jwt',
  'credential.jwt',
] as const;

/** Optional environment override for a specific credential path. */
const ENV_CREDENTIAL_PATH = process.env.BELTIC_CREDENTIAL_PATH?.trim();

/** Default .beltic directory name */
const BELTIC_DIR_NAME = '.beltic';

// ============================================================================
// Types
// ============================================================================

export interface CredentialLoadResult {
  success: boolean;
  credential: AgentCredential | null;
  jwt: string | null;
  path: string | null;
  belticDir: string;
  errors: string[];
}

// Model ID used for OpenRouter API calls
export const OPENROUTER_MODEL_ID = 'nvidia/nemotron-3-nano-30b-a3b:free';
const ENV_OPENROUTER_MODEL_ID = process.env.OPENROUTER_MODEL_ID?.trim();

/** Format model provider for display */
function formatModelProvider(provider: string): string {
  const map: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    google: 'Google',
    meta: 'Meta',
    mistral: 'Mistral',
    cohere: 'Cohere',
    amazon: 'Amazon',
    microsoft: 'Microsoft',
    huggingface: 'HuggingFace',
    nvidia: 'NVIDIA',
    openrouter: 'OpenRouter',
    deepseek: 'DeepSeek',
    self_hosted: 'Self-Hosted',
    other: 'Other',
  };
  return map[provider.toLowerCase()] || provider;
}

/** Format model family for display */
function formatModelFamily(family: string): string {
  const map: Record<string, string> = {
    nemotron: 'Nemotron 3 Nano 30B',
    'deepseek-v3': 'DeepSeek V3',
    'qwen-2.5': 'Qwen 2.5',
    'claude-3.5-sonnet': 'Claude 3.5 Sonnet',
    'claude-4': 'Claude 4',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o Mini',
    'gemini-2': 'Gemini 2',
    other: 'Custom Model',
  };
  return map[family.toLowerCase()] || family.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function normalizeModelField(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function isLikelyModelId(value: string): boolean {
  return value.includes('/');
}

export interface CredentialInfo {
  // Identity
  agentId: string;
  agentName: string;
  agentVersion: string;
  agentDescription: string;
  credentialId: string;
  
  // Model & Architecture (from credential schema - may be "other")
  modelProvider: string;
  modelFamily: string;
  modelContextWindow: number;
  architectureType: string;
  modalities: string[];
  languages: string[];
  
  // Runtime model info (actual model used)
  runtimeModel: {
    provider: string;
    model: string;
    modelId: string;
  };
  
  // Verification
  issuerDid: string;
  verificationLevel: string;
  kybTier: string;
  developerVerified: boolean;
  
  // Safety
  overallSafetyRating: string;
  safetyScores: {
    harmfulContent: number;
    promptInjection: number;
    piiLeakage: number;
    toolAbuse: number;
  };
  averageSafetyScore: number;
  
  // Tools
  toolsCount: number;
  tools: Array<{
    name: string;
    riskCategory: string;
    requiresApproval: boolean;
  }>;
  
  // Data handling
  dataCategories: string[];
  dataRetention: string;
  complianceCerts: string[];
  deploymentRegion: string;
  
  // Validity
  issuedAt: string;
  expiresAt: string;
  status: string;
  
  // Source info
  loadedFrom: string;
  belticDir: string;
}

export interface PricingInfo {
  basePrice: number;
  discount: number;
  finalPrice: number;
  kybDiscount: number;
  safetyDiscount: number;
}

// ============================================================================
// Directory & File Discovery
// ============================================================================

/**
 * Find the .beltic directory starting from a given path
 */
export function findBelticDir(startDir: string = process.cwd()): string {
  const envBelticDir = process.env.BELTIC_DIR?.trim();
  if (envBelticDir) {
    const resolvedEnvDir = resolve(envBelticDir);
    if (existsSync(resolvedEnvDir)) {
      return resolvedEnvDir;
    }
  }

  let currentDir = resolve(startDir);
  let depth = 0;

  while (currentDir) {
    const candidate = join(currentDir, BELTIC_DIR_NAME);
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir || depth > 12) {
      break;
    }
    currentDir = parentDir;
    depth += 1;
  }

  return join(startDir, BELTIC_DIR_NAME);
}

function getSearchDirectories(startDir: string): string[] {
  const maxDepth = 12;
  const dirs: string[] = [];
  let currentDir = resolve(startDir);
  let depth = 0;

  while (true) {
    dirs.push(currentDir);
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir || depth >= maxDepth) {
      break;
    }
    currentDir = parentDir;
    depth += 1;
  }

  return dirs;
}

/**
 * Find a credential JWT file
 */
export function findCredentialFile(baseDir: string = process.cwd()): string | null {
  const searchDirs = getSearchDirectories(baseDir);

  if (ENV_CREDENTIAL_PATH && existsSync(ENV_CREDENTIAL_PATH)) {
    return resolve(ENV_CREDENTIAL_PATH);
  }

  for (const dir of searchDirs) {
    for (const fileName of CREDENTIAL_FILE_NAMES) {
      const directPath = join(dir, fileName);
      if (existsSync(directPath)) {
        return resolve(directPath);
      }

      const belticPath = join(dir, BELTIC_DIR_NAME, fileName);
      if (existsSync(belticPath)) {
        return resolve(belticPath);
      }
    }

    // Support historical relative layout from nested repos: ../.beltic/agent-credential.jwt
    for (const fileName of CREDENTIAL_FILE_NAMES) {
      const legacyPath = join(dir, '..', BELTIC_DIR_NAME, fileName);
      if (existsSync(legacyPath)) {
        return resolve(legacyPath);
      }
    }
  }
  
  // Search .beltic directory for any agent credential JWT
  for (const dir of searchDirs) {
    const belticDir = findBelticDir(dir);
    if (existsSync(belticDir)) {
      try {
        const files = readdirSync(belticDir);
        const credentialFile = files.find((file) =>
          file.endsWith('.jwt') &&
          !file.includes('private') &&
          (file.includes('agent') || file.includes('credential'))
        );
        if (credentialFile) {
          return resolve(join(belticDir, credentialFile));
        }
      } catch {
        // Ignore read errors
      }
    }
  }
  
  return null;
}

// ============================================================================
// Credential Loading (using SDK)
// ============================================================================

/**
 * Load and decode a credential using the SDK
 */
export function loadCredential(customPath?: string): CredentialLoadResult {
  const belticDir = findBelticDir();
  const credentialPath = customPath || findCredentialFile();
  const errors: string[] = [];
  
  if (!credentialPath) {
    return {
      success: false,
      credential: null,
      jwt: null,
      path: null,
      belticDir,
      errors: ['No credential file found in workspace.'],
    };
  }
  
  // Read the JWT file
  let jwt: string;
  try {
    jwt = readFileSync(credentialPath, 'utf-8').trim();
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      credential: null,
      jwt: null,
      path: credentialPath,
      belticDir,
      errors: [`Failed to read credential file: ${msg}`],
    };
  }
  
  // Use SDK to check credential type
  const credentialType = getCredentialType(jwt);
  if (credentialType !== 'agent') {
    return {
      success: false,
      credential: null,
      jwt,
      path: credentialPath,
      belticDir,
      errors: [`Invalid credential type: '${credentialType}'. Expected 'agent'.`],
    };
  }
  
  // Use SDK to decode the token
  let decoded: ReturnType<typeof decodeToken>;
  try {
    decoded = decodeToken(jwt);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      credential: null,
      jwt,
      path: credentialPath,
      belticDir,
      errors: [`Failed to decode JWT: ${msg}`],
    };
  }
  
  // Extract the verifiable credential from payload
  const vcPayload = decoded.payload as { vc?: AgentCredential };
  if (!vcPayload.vc) {
    return {
      success: false,
      credential: null,
      jwt,
      path: credentialPath,
      belticDir,
      errors: ['No verifiable credential (vc) claim found in JWT payload.'],
    };
  }
  
  const credential = vcPayload.vc;
  
  // Use SDK to validate the credential structure
  const validationResult = validateAgentCredential(credential);
  if (!validationResult.ok) {
    const suppressWarning = (message: string, path: string) => {
      const normalizedPath = path.trim();
      const normalizedMessage = message.trim();

      // Allow local flexibility for model identifiers and dev IDs that may be non-UUIDs
      // in early-access demos and non-platform flows.
      if (
        normalizedPath === '/primaryModelProvider' ||
        normalizedPath === '/primaryModelFamily' ||
        normalizedPath === '/developerCredentialId' ||
        normalizedMessage.includes('Must be one of:') ||
        normalizedMessage.includes('Invalid format: expected uuid')
      ) {
        return true;
      }

      return false;
    };

    // Log warnings but don't fail - credential might be using older schema
    for (const err of validationResult.errors) {
      const path = `${err.path ?? ''}`.trim();
      if (suppressWarning(err.message, path)) {
        continue;
      }
      errors.push(`Validation warning: ${err.message} at ${path}`);
    }
    console.warn('[Credential Loader] Validation warnings:', errors);
  }
  
  // Use SDK type guard to verify it's an agent credential
  if (!isAgentCredential(credential)) {
    errors.push('Credential does not pass isAgentCredential type guard');
  }
  
  console.log(`[Credential Loader] Loaded from: ${credentialPath}`);
  console.log(`[Credential Loader] Beltic dir: ${belticDir}`);
  console.log(`[Credential Loader] Agent: ${credential.agentName} v${credential.agentVersion}`);
  console.log(`[Credential Loader] Model: ${credential.primaryModelProvider}/${credential.primaryModelFamily}`);
  
  return {
    success: true,
    credential,
    jwt,
    path: credentialPath,
    belticDir,
    errors,
  };
}

// ============================================================================
// Credential Info Extraction
// ============================================================================

/**
 * Extract structured info from a loaded credential
 */
export function extractCredentialInfo(result: CredentialLoadResult): CredentialInfo {
  const cred = result.credential;
  // Cast to access optional/extended fields
  const credAny = cred as Record<string, unknown> | null;
  
  // Safety scores are 0-1 in credential, convert to 0-100
  const harmfulContent = Math.round((cred?.harmfulContentRefusalScore ?? 0) * 100);
  const promptInjection = Math.round((cred?.promptInjectionRobustnessScore ?? 0) * 100);
  const piiLeakage = Math.round((cred?.piiLeakageRobustnessScore ?? 0) * 100);
  const toolAbuse = Math.round(((credAny?.toolAbuseRobustnessScore as number) ?? 0) * 100);
  
  const averageSafetyScore = Math.round(
    (harmfulContent + promptInjection + piiLeakage + toolAbuse) / 4
  );
  
  // Extract tools list
  const toolsList = (credAny?.toolsList as Array<{
    toolName: string;
    riskCategory: string;
    requiresHumanApproval: boolean;
  }>) ?? [];
  
  const tools = toolsList.map(t => ({
    name: t.toolName,
    riskCategory: t.riskCategory,
    requiresApproval: t.requiresHumanApproval,
  }));
  
  // Extract deployment info
  const deploymentEnv = (credAny?.deploymentEnvironment as { primaryRegion?: string }) ?? {};
  const dataLocation = (credAny?.dataLocationProfile as { storageRegions?: string[] }) ?? {};
  
  return {
    // Identity
    agentId: (credAny?.agentId as string) ?? 'unknown',
    agentName: (credAny?.agentName as string) ?? 'Unknown Agent',
    agentVersion: (credAny?.agentVersion as string) ?? '0.0.0',
    agentDescription: (credAny?.agentDescription as string) ?? '',
    credentialId: (credAny?.credentialId as string) ?? 'unknown',
    
    // Model & Architecture (from credential)
    modelProvider: (credAny?.primaryModelProvider as string) ?? 'unknown',
    modelFamily: (credAny?.primaryModelFamily as string) ?? 'unknown',
    modelContextWindow: (credAny?.modelContextWindow as number) ?? 32000,
    architectureType: (credAny?.architectureType as string) ?? 'unknown',
    modalities: (credAny?.modalitySupport as string[]) ?? [],
    languages: (credAny?.languageCapabilities as string[]) ?? [],
    
    // Runtime model info (derived from credential, formatted for display)
    runtimeModel: {
      provider: formatModelProvider((credAny?.primaryModelProvider as string) ?? 'unknown'),
      model: formatModelFamily((credAny?.primaryModelFamily as string) ?? 'unknown'),
      modelId: getOpenRouterModel(
        (credAny?.primaryModelProvider as string) ?? 'unknown',
        (credAny?.primaryModelFamily as string) ?? 'unknown'
      ),
    },
    
    // Verification
    issuerDid: (credAny?.issuerDid as string) ?? 'unknown',
    verificationLevel: (credAny?.verificationLevel as string) ?? 'self_attested',
    kybTier: (credAny?.kybTierRequired as string) ?? 'tier_0',
    developerVerified: (credAny?.developerCredentialVerified as boolean) ?? false,
    
    // Safety
    overallSafetyRating: (credAny?.overallSafetyRating as string) ?? 'evaluation_pending',
    safetyScores: { harmfulContent, promptInjection, piiLeakage, toolAbuse },
    averageSafetyScore,
    
    // Tools
    toolsCount: tools.length,
    tools,
    
    // Data handling
    dataCategories: (credAny?.dataCategoriesProcessed as string[]) ?? [],
    dataRetention: (credAny?.dataRetentionMaxPeriod as string) ?? '',
    complianceCerts: (credAny?.complianceCertifications as string[]) ?? [],
    deploymentRegion: deploymentEnv.primaryRegion ?? dataLocation.storageRegions?.[0] ?? '',
    
    // Validity
    issuedAt: (credAny?.credentialIssuanceDate as string) ?? '',
    expiresAt: (credAny?.credentialExpirationDate as string) ?? '',
    status: (credAny?.credentialStatus as string) ?? 'unknown',
    
    // Source
    loadedFrom: result.path ?? 'not loaded',
    belticDir: result.belticDir,
  };
}

// ============================================================================
// Model Mapping
// ============================================================================

/** Map credential model info to OpenRouter model ID */
const OPENROUTER_MODEL_MAP: Record<string, Record<string, string>> = {
  openrouter: {
    nemotron: 'nvidia/nemotron-3-nano-30b-a3b:free',
  },
  nvidia: {
    nemotron: 'nvidia/nemotron-3-nano-30b-a3b:free',
  },
};

/** Default model for demos */
const DEFAULT_MODEL = ENV_OPENROUTER_MODEL_ID || OPENROUTER_MODEL_ID;

function isPlaceholderModelValue(value: string): boolean {
  const normalized = value.toLowerCase();
  if (!normalized || normalized === 'unknown' || normalized === 'other') {
    return true;
  }
  return false;
}

/**
 * Get OpenRouter model ID from credential model info
 */
export function getOpenRouterModel(provider: string, family: string): string {
  if (ENV_OPENROUTER_MODEL_ID) {
    return ENV_OPENROUTER_MODEL_ID;
  }

  const normalizedProvider = normalizeModelField(provider);
  const normalizedFamily = normalizeModelField(family);

  if (!normalizedProvider || !normalizedFamily) {
    return DEFAULT_MODEL;
  }

  if (isPlaceholderModelValue(normalizedProvider) || isPlaceholderModelValue(normalizedFamily)) {
    return DEFAULT_MODEL;
  }

  if (isLikelyModelId(normalizedFamily)) {
    return family.trim();
  }

  const providerMap = OPENROUTER_MODEL_MAP[provider.toLowerCase()];
  if (providerMap) {
    // Try exact match first
    if (providerMap[normalizedFamily]) {
      return providerMap[normalizedFamily];
    }
    // Try partial match
    for (const [key, value] of Object.entries(providerMap)) {
      const normalizedMapKey = key.toLowerCase();
      if (normalizedFamily.includes(normalizedMapKey) || normalizedMapKey.includes(normalizedFamily)) {
        return value;
      }
    }
  }

  const directModelCandidate = `${provider.trim()}/${family.trim()}`;
  if (isLikelyModelId(directModelCandidate)) {
    return directModelCandidate;
  }

  if (normalizedProvider === 'openrouter' && normalizedFamily.includes('/')) {
    return family.trim();
  }

  return `${provider.trim()}/${family.trim()}`;
}

// ============================================================================
// Pricing Calculation
// ============================================================================

/** KYB tier discount percentages */
const KYB_DISCOUNTS: Record<string, number> = {
  tier_0: 0,
  tier_1: 0.10,
  tier_2: 0.20,
  tier_3: 0.25,
  tier_4: 0.30,
};

/**
 * Calculate pricing based on credential verification level
 */
export function calculatePricing(info: CredentialInfo, basePrice = 0.01): PricingInfo {
  const kybDiscount = KYB_DISCOUNTS[info.kybTier] ?? 0;
  const safetyDiscount = Math.min(0.20, (info.averageSafetyScore / 100) * 0.20);
  const totalDiscount = Math.min(0.50, kybDiscount + safetyDiscount);
  
  return {
    basePrice,
    discount: totalDiscount,
    finalPrice: Math.round(basePrice * (1 - totalDiscount) * 10000) / 10000,
    kybDiscount,
    safetyDiscount,
  };
}

// ============================================================================
// Singleton Cache
// ============================================================================

let _cachedResult: CredentialLoadResult | null = null;
let _cachedInfo: CredentialInfo | null = null;

/**
 * Get credential (cached)
 */
export function getCredential(forceReload = false): CredentialLoadResult {
  if (!_cachedResult || forceReload) {
    _cachedResult = loadCredential();
  }
  return _cachedResult;
}

/**
 * Get credential info (cached)
 */
export function getCredentialInfo(forceReload = false): CredentialInfo {
  if (!_cachedInfo || forceReload) {
    _cachedInfo = extractCredentialInfo(getCredential(forceReload));
  }
  return _cachedInfo;
}

/**
 * Clear cache
 */
export function clearCache(): void {
  _cachedResult = null;
  _cachedInfo = null;
}

// ============================================================================
// Re-exports from SDK for convenience
// ============================================================================

export { decodeToken, getCredentialType, validateAgentCredential, isAgentCredential };
export type { AgentCredential };
