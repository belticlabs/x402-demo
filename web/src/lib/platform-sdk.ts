import { decodeToken, getCredentialType, validateAgentCredential, type AgentCredential } from '@belticlabs/kya';

export interface FakePlatformCredentialRecord {
  credential: string;
  credentialType: string;
  platform: string;
  source: string;
}

export interface FakePlatformResult {
  success: true;
  data: FakePlatformCredentialRecord;
}

export interface FakePlatformError {
  success: false;
  error: string;
  status: number;
}

interface GetOptions {
  apiKey?: string;
  baseUrl?: string;
}

function resolveBaseUrl(inputBaseUrl?: string): string {
  return (inputBaseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3002').replace(/\/$/, '');
}

async function request(
  path: string,
  options: GetOptions
): Promise<{ status: number; body: { success: false; error: string; data?: unknown } | FakePlatformResult }> {
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      'x-api-key': options.apiKey || '',
      Accept: 'application/json',
    },
  });

  const raw = await response.json().catch(() => ({ error: 'Invalid JSON response' }));
  return { status: response.status, body: raw };
}

export async function fetchPlatformCredential(
  options: GetOptions = {}
): Promise<FakePlatformResult | FakePlatformError> {
  const apiKey = options.apiKey || process.env.FAKE_PLATFORM_API_KEY || '';
  const { status, body } = await request('/api/platform/credential', { apiKey, baseUrl: options.baseUrl });

  if (!body || typeof body !== 'object') {
    return { success: false, status, error: 'Unexpected response from platform endpoint' };
  }

  if (status !== 200) {
    return {
      success: false,
      status,
      error: (body as { error?: string }).error || `Request failed with ${status}`,
    };
  }

  if (!('success' in body) || body.success !== true || !('data' in body)) {
    return { success: false, status: 502, error: 'Platform response missing expected payload.' };
  }

  return body as FakePlatformResult;
}

export function parsePlatformCredentialJwt(jwt: string): AgentCredential {
  const decoded = decodeToken(jwt);
  const credentialType = getCredentialType(jwt);
  if (credentialType !== 'agent') {
    throw new Error(`Expected an agent credential, received: ${credentialType || 'unknown'}`);
  }

  const vcPayload = decoded.payload as { vc?: AgentCredential };
  if (!vcPayload.vc) {
    throw new Error('Platform credential payload missing vc claim');
  }

  const validation = validateAgentCredential(vcPayload.vc);
  if (!validation.ok) {
    throw new Error(validation.errors.map((error) => error.message).join('; '));
  }

  return vcPayload.vc;
}

export function validatePlatformCredential(jwt: string): boolean {
  try {
    parsePlatformCredentialJwt(jwt);
    return true;
  } catch {
    return false;
  }
}
