export type ModelPolicyMode = 'allowlist' | 'denylist' | 'off';

export interface ModelPolicyConfig {
  mode: ModelPolicyMode;
  providerAllowlist: string[];
  providerDenylist: string[];
  familyAllowlist: string[];
  familyDenylist: string[];
}

export interface ModelPolicyEvaluation {
  allowed: boolean;
  reasons: string[];
  provider: string;
  family: string;
  config: ModelPolicyConfig;
}

function normalizeValue(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => normalizeValue(entry))
    .filter(Boolean);
}

function toRules(values: string[]): string[] {
  return values.filter(Boolean);
}

function normalizeRules(values: string[]): string[] {
  return toRules(values.map(normalizeValue));
}

function splitGlob(value: string): string[] {
  return value.split('*').map((part) => part.trim()).filter(Boolean);
}

function matchesRule(rule: string, value: string): boolean {
  const pattern = rule.trim().toLowerCase();
  const normalizedValue = value.trim().toLowerCase();
  if (!pattern || !normalizedValue) return false;
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return normalizedValue === pattern;

  // Support basic wildcard matching (prefix/suffix/infix)
  const parts = splitGlob(pattern);
  if (parts.length === 0) return pattern === '*';
  if (parts.length === 1) {
    return normalizedValue.includes(parts[0]);
  }

  let cursor = 0;
  for (const part of parts) {
    const index = normalizedValue.indexOf(part, cursor);
    if (index === -1) return false;
    cursor = index + part.length;
  }
  return true;
}

function checkMatch(rules: string[], value: string | undefined): boolean {
  const normalizedValue = normalizeValue(value);
  if (!rules.length) return true;
  return rules.some((rule) => matchesRule(rule, normalizedValue));
}

export function getModelPolicyConfig(): ModelPolicyConfig {
  const modeRaw = normalizeValue(process.env.MODEL_POLICY_MODE);
  const mode: ModelPolicyMode =
    modeRaw === 'allowlist' || modeRaw === 'denylist' || modeRaw === 'off'
      ? modeRaw
      : 'allowlist';

  const providerAllowlist = normalizeRules(parseCsv(process.env.MODEL_PROVIDER_ALLOWLIST));
  const familyAllowlist = normalizeRules(parseCsv(process.env.MODEL_FAMILY_ALLOWLIST));
  const providerDenylist = normalizeRules(parseCsv(process.env.MODEL_PROVIDER_DENYLIST));
  const familyDenylist = normalizeRules(parseCsv(process.env.MODEL_FAMILY_DENYLIST));

  return {
    mode,
    providerAllowlist,
    providerDenylist,
    familyAllowlist,
    familyDenylist,
  };
}

export function evaluateModelPolicy(
  providerInput: string | null | undefined,
  familyInput: string | null | undefined,
  config: ModelPolicyConfig = getModelPolicyConfig()
): ModelPolicyEvaluation {
  const provider = normalizeValue(providerInput);
  const family = normalizeValue(familyInput);
  const reasons: string[] = [];

  if (config.mode === 'off') {
    return { allowed: true, reasons, provider, family, config };
  }

  if (!provider) {
    reasons.push('missing primaryModelProvider in credential');
  }

  if (!family) {
    reasons.push('missing primaryModelFamily in credential');
  }

  if (config.mode === 'allowlist') {
    if (provider && !checkMatch(config.providerAllowlist, provider)) {
      reasons.push(`primaryModelProvider "${provider}" is not in allowlist`);
    }
    if (family && !checkMatch(config.familyAllowlist, family)) {
      reasons.push(`primaryModelFamily "${family}" is not in allowlist`);
    }
  }

  if (config.mode === 'denylist') {
    if (provider && config.providerDenylist.length > 0 && checkMatch(config.providerDenylist, provider)) {
      reasons.push(`primaryModelProvider "${provider}" is denied`);
    }
    if (family && config.familyDenylist.length > 0 && checkMatch(config.familyDenylist, family)) {
      reasons.push(`primaryModelFamily "${family}" is denied`);
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    provider,
    family,
    config,
  };
}
