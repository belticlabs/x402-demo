import { createPrivateKey, createPublicKey } from 'crypto';
import { Buffer } from 'buffer';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import * as jose from 'jose';
import {
  computeJwkThumbprint,
  exportPublicKey,
  formatCredentialsHeader,
  getCredentialType,
  importKeyFromPEM,
  parseCredentialsHeader,
  signHttpRequest,
  verifyHttpSignature,
  type HttpSignatureHeaders,
  type IncomingHttpRequest,
} from '@belticlabs/kya';
import { type NextRequest } from 'next/server';
import { findBelticDir, getCredential } from '@/lib/credential-loader';
import { evaluateModelPolicy } from '@/lib/model-policy';

export type KyaVerificationMode = 'strict' | 'compat' | 'off';

type KybTierValue = 'tier_0' | 'tier_1' | 'tier_2' | 'tier_3' | 'tier_4';

interface LocalKybPolicy {
  minKybTier: KybTierValue;
}

export interface KyaVerificationResult {
  verified: boolean;
  mode: KyaVerificationMode;
  errors: string[];
  warnings: string[];
  agentId?: string;
  developerId?: string;
  kybTier?: string;
  promptInjectionScore?: number;
  modelProvider?: string;
  modelFamily?: string;
}

export interface KyaVerificationPolicy {
  minKybTier?: string;
}

export interface KyaVerificationOptions {
  policy?: KyaVerificationPolicy;
}

interface SigningContext {
  privateKey: jose.KeyLike;
  publicJwk: jose.JWK;
  publicSpkiPem: string;
  keyId: string;
  keyDirectoryUrl: string;
  agentCredentialJwt: string;
}

let signingContextPromise: Promise<SigningContext> | null = null;

const KYB_RANK: Record<string, number> = {
  tier_0: 0,
  tier_1: 1,
  tier_2: 2,
  tier_3: 3,
  tier_4: 4,
};

const SUPPORTED_KYB_TIERS: ReadonlyArray<KybTierValue> = ['tier_0', 'tier_1', 'tier_2', 'tier_3', 'tier_4'];
const DEFAULT_KYB_POLICY: LocalKybPolicy = { minKybTier: 'tier_3' };

type SigningKeyMaterial = {
  privatePem: string;
  publicPem: string;
};

const PRIVATE_SUFFIXES = ['-private.pem', '.private.pem'];
const PUBLIC_SUFFIXES = ['-public.pem', '.public.pem'];

function extractStem(filename: string, suffixes: string[]): string | null {
  for (const suffix of suffixes) {
    if (filename.endsWith(suffix)) {
      return filename.slice(0, -suffix.length);
    }
  }
  return null;
}

function isPemContent(value: string): boolean {
  return value.trimStart().startsWith('-----BEGIN');
}

/**
 * Normalize PEM from env vars (Vercel, etc.).
 * - Replaces literal \n with real newlines (handle double-escaping).
 * - If newlines were stripped (single-line PEM), re-inserts them.
 */
function normalizePem(value: string): string {
  const trimmed = value.trim();
  const unwrapped =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1).trim()
      : trimmed;

  // Replace literal \n with real newlines (repeat for double-escaping on some platforms).
  let result = unwrapped;
  while (result.includes('\\n')) {
    result = result.replace(/\\n/g, '\n');
  }
  result = result.trim();

  // If still no newlines (Vercel may strip them), reconstruct PEM structure.
  if (result.includes('-----BEGIN') && result.includes('-----END') && !result.includes('\n')) {
    const beginMatch = result.match(/-----BEGIN [A-Z0-9 ]+-----/);
    const endMatch = result.match(/-----END [A-Z0-9 ]+-----/);
    if (beginMatch && endMatch) {
      const begin = beginMatch[0];
      const end = endMatch[0];
      const startIdx = result.indexOf(begin) + begin.length;
      const endIdx = result.indexOf(end);
      const middle = result.slice(startIdx, endIdx).replace(/[\s\\]/g, '');
      const wrapped = middle.match(/.{1,64}/g)?.join('\n') ?? middle;
      result = `${begin}\n${wrapped}\n${end}`;
    }
  }

  return result;
}

/** Extract raw DER from PEM (base64 between headers) and import via Node crypto. */
function importPrivateKeyFromPemOrDer(pem: string): ReturnType<typeof createPrivateKey> {
  const base64 = pem
    .replace(/-----BEGIN [A-Z0-9 ]+-----/g, '')
    .replace(/-----END [A-Z0-9 ]+-----/g, '')
    .replace(/[^A-Za-z0-9+/=]/g, '');
  const der = Buffer.from(base64, 'base64');
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

/** Extract raw DER from PEM and import public key via Node crypto. */
function importPublicKeyFromPemOrDer(pem: string): ReturnType<typeof createPublicKey> {
  const base64 = pem
    .replace(/-----BEGIN [A-Z0-9 ]+-----/g, '')
    .replace(/-----END [A-Z0-9 ]+-----/g, '')
    .replace(/[^A-Za-z0-9+/=]/g, '');
  const der = Buffer.from(base64, 'base64');
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function getPemLabel(value: string): string {
  const match = value.match(/-----BEGIN ([A-Z0-9 ]+)-----/);
  return match?.[1] || 'UNKNOWN';
}

function assertExpectedPemFormat(
  value: string,
  envName: 'KYA_SIGNING_PRIVATE_PEM' | 'KYA_SIGNING_PUBLIC_PEM'
) {
  if (!isPemContent(value)) {
    throw new Error(
      `${envName} must be inline PEM content (BEGIN/END block) or a valid file path.`
    );
  }

  const label = getPemLabel(value);
  if (envName === 'KYA_SIGNING_PRIVATE_PEM') {
    const validPrivateLabel = label === 'PRIVATE KEY' || label === 'ED25519 PRIVATE KEY';
    if (!validPrivateLabel) {
      throw new Error(
        `${envName} must be an Ed25519 private key PEM (BEGIN PRIVATE KEY). Received: BEGIN ${label}.`
      );
    }
    return;
  }

  if (label !== 'PUBLIC KEY') {
    throw new Error(
      `${envName} must be an Ed25519 public key PEM (BEGIN PUBLIC KEY). Received: BEGIN ${label}.`
    );
  }
}

function resolveSigningKeyMaterial(belticDir: string): SigningKeyMaterial {
  const rawPrivate = process.env.KYA_SIGNING_PRIVATE_PEM?.trim();
  const rawPublic = process.env.KYA_SIGNING_PUBLIC_PEM?.trim();

  console.info('[KYA] Resolving signing key material:', {
    hasPrivateEnv: Boolean(rawPrivate),
    hasPublicEnv: Boolean(rawPublic),
    privateLooksLikePem: Boolean(rawPrivate && isPemContent(normalizePem(rawPrivate))),
    publicLooksLikePem: Boolean(rawPublic && isPemContent(normalizePem(rawPublic))),
    belticDir,
    belticDirExists: existsSync(belticDir),
  });

  const explicitPrivate = rawPrivate ? normalizePem(rawPrivate) : undefined;
  const explicitPublic = rawPublic ? normalizePem(rawPublic) : undefined;

  if ((explicitPrivate && !explicitPublic) || (!explicitPrivate && explicitPublic)) {
    throw new Error('Set both KYA_SIGNING_PRIVATE_PEM and KYA_SIGNING_PUBLIC_PEM together');
  }

  if (explicitPrivate && explicitPublic) {
    const privateIsPem = isPemContent(explicitPrivate);
    const publicIsPem = isPemContent(explicitPublic);
    console.info('[KYA] PEM content detection:', { privateIsPem, publicIsPem });

    // If values look like PEM content, use directly (Vercel env var flow)
    if (privateIsPem && publicIsPem) {
      assertExpectedPemFormat(explicitPrivate, 'KYA_SIGNING_PRIVATE_PEM');
      assertExpectedPemFormat(explicitPublic, 'KYA_SIGNING_PUBLIC_PEM');
      return { privatePem: explicitPrivate, publicPem: explicitPublic };
    }

    if (privateIsPem !== publicIsPem) {
      throw new Error(
        'KYA_SIGNING_PRIVATE_PEM and KYA_SIGNING_PUBLIC_PEM must both be inline PEM values or both be file paths'
      );
    }

    // Otherwise treat as file paths
    if (!existsSync(explicitPrivate)) {
      throw new Error(`KYA_SIGNING_PRIVATE_PEM not found: ${explicitPrivate}`);
    }
    if (!existsSync(explicitPublic)) {
      throw new Error(`KYA_SIGNING_PUBLIC_PEM not found: ${explicitPublic}`);
    }
    return {
      privatePem: readFileSync(explicitPrivate, 'utf-8'),
      publicPem: readFileSync(explicitPublic, 'utf-8'),
    };
  }

  if (!existsSync(belticDir)) {
    throw new Error(`No .beltic directory found at ${belticDir}. Run: npx @belticlabs/wizard --local --install-dir .`);
  }

  const files = readdirSync(belticDir);
  const candidates: Array<{ privatePemPath: string; publicPemPath: string; modifiedAt: number }> = [];

  for (const file of files) {
    const stem = extractStem(file, PRIVATE_SUFFIXES);
    if (!stem) continue;

    const matchedPublic = PUBLIC_SUFFIXES
      .map((suffix) => `${stem}${suffix}`)
      .find((publicName) => files.includes(publicName));

    if (!matchedPublic) continue;

    const privatePemPath = `${belticDir}/${file}`;
    const publicPemPath = `${belticDir}/${matchedPublic}`;
    const modifiedAt = Math.max(
      statSync(privatePemPath).mtimeMs,
      statSync(publicPemPath).mtimeMs
    );

    candidates.push({ privatePemPath, publicPemPath, modifiedAt });
  }

  if (candidates.length === 0) {
    throw new Error(
      `No signing key pair found in ${belticDir}. Expected files like "*-private.pem" and "*-public.pem".`
    );
  }

  candidates.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return {
    privatePem: readFileSync(candidates[0].privatePemPath, 'utf-8'),
    publicPem: readFileSync(candidates[0].publicPemPath, 'utf-8'),
  };
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function resolveKeyDirectoryUrl(): string {
  const explicitUrl = process.env.KYA_KEY_DIRECTORY_URL?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  const appBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3002').trim();
  let parsed: URL;

  try {
    parsed = new URL(appBaseUrl);
  } catch {
    throw new Error(`NEXT_PUBLIC_APP_URL must be an absolute URL (received "${appBaseUrl}")`);
  }

  const localHost = isLocalHost(parsed.hostname);
  if (!localHost && parsed.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    throw new Error('KYA key directory URL must use https for non-local hosts in production');
  }

  const protocol = localHost && parsed.protocol === 'http:' ? 'https:' : parsed.protocol;
  const base = `${protocol}//${parsed.host}`.replace(/\/$/, '');
  return `${base}/api/.well-known/http-message-signatures-directory`;
}

export function getKyaVerificationMode(): KyaVerificationMode {
  const mode = process.env.KYA_VERIFICATION_MODE?.toLowerCase();
  if (mode === 'strict' || mode === 'compat' || mode === 'off') {
    return mode;
  }
  return 'compat';
}

function normalizeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function getSigningContext(): Promise<SigningContext> {
  if (!signingContextPromise) {
    const promise = (async () => {
      const belticDir = findBelticDir();
      const { privatePem, publicPem } = resolveSigningKeyMaterial(belticDir);

      let privateKey: jose.KeyLike;
      try {
        privateKey = await importKeyFromPEM(privatePem, 'EdDSA');
      } catch {
        try {
          privateKey = createPrivateKey({ key: privatePem, format: 'pem' }) as jose.KeyLike;
        } catch {
          try {
            privateKey = importPrivateKeyFromPemOrDer(privatePem) as jose.KeyLike;
          } catch {
            throw new Error(
              'Invalid KYA_SIGNING_PRIVATE_PEM. Paste the full PEM as one line with \\n for newlines.'
            );
          }
        }
      }

      let publicKey: jose.KeyLike;
      try {
        publicKey = await importKeyFromPEM(publicPem, 'EdDSA');
      } catch {
        try {
          publicKey = createPublicKey({ key: publicPem, format: 'pem' }) as jose.KeyLike;
        } catch {
          try {
            publicKey = importPublicKeyFromPemOrDer(publicPem) as jose.KeyLike;
          } catch {
            throw new Error('Invalid KYA_SIGNING_PUBLIC_PEM. Paste the full PEM as one line with \\n for newlines.');
          }
        }
      }
      const publicJwk = await exportPublicKey(publicKey);
      const keyId = await computeJwkThumbprint(publicJwk);

      const credential = getCredential();
      if (!credential.success || !credential.jwt) {
        throw new Error(
          `Missing agent credential JWT for KYA signing: ${credential.errors.join('; ') || 'unknown reason'}`
        );
      }

      const keyDirectoryUrl = resolveKeyDirectoryUrl();

      return {
        privateKey,
        publicJwk,
        publicSpkiPem: publicPem,
        keyId,
        keyDirectoryUrl,
        agentCredentialJwt: credential.jwt,
      };
    })();

    // Don't cache rejected promises — allow retry on next call
    promise.catch(() => {
      signingContextPromise = null;
    });
    signingContextPromise = promise;
  }

  return signingContextPromise;
}

async function verifyAgentCredentialJwt(jwt: string, publicSpkiPem: string): Promise<jose.JWTPayload> {
  const key = await jose.importSPKI(publicSpkiPem, 'EdDSA');
  const verified = await jose.jwtVerify(jwt, key, { clockTolerance: 300 });
  return verified.payload;
}

async function getSigningContextOrThrow(
  keyUnavailableMessage: string
): Promise<SigningContext | null> {
  try {
    return await getSigningContext();
  } catch (error) {
    console.warn(
      `[KYA] ${keyUnavailableMessage}:`,
      error instanceof Error ? error.message : 'unknown error'
    );
    return null;
  }
}

function getHeaderCaseInsensitive(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find((h) => h.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

function normalizeKybTier(value?: string): KybTierValue | undefined {
  const normalized = value?.trim().toLowerCase() as KybTierValue | undefined;
  if (normalized && SUPPORTED_KYB_TIERS.includes(normalized)) {
    return normalized;
  }
  return undefined;
}

function resolveKybPolicy(options: KyaVerificationOptions = {}): LocalKybPolicy {
  const requestedTier = normalizeKybTier(options.policy?.minKybTier);
  return requestedTier ? { minKybTier: requestedTier } : DEFAULT_KYB_POLICY;
}

function rankKybTier(tier: string): number {
  return KYB_RANK[tier] ?? KYB_RANK.tier_0;
}

function buildIncomingRequest(req: NextRequest): IncomingHttpRequest {
  return {
    method: req.method,
    url: req.url,
    headers: normalizeHeaders(req.headers),
  };
}

export async function createSignedBelticHeaders(url: string, method = 'GET'): Promise<Record<string, string>> {
  const ctx = await getSigningContext().catch((error) => {
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new Error(`KYA signing unavailable: ${reason}`);
  });

  const baseHeaders: Record<string, string> = {
    Accept: 'application/json',
    'Beltic-Credentials': formatCredentialsHeader(ctx.agentCredentialJwt),
  };

  const signatureHeaders: HttpSignatureHeaders = await signHttpRequest(
    {
      method,
      url,
      headers: baseHeaders,
    },
    {
      privateKey: ctx.privateKey,
      keyId: ctx.keyId,
      keyDirectoryUrl: ctx.keyDirectoryUrl,
      components: ['@method', '@authority', '@path', '@query', 'signature-agent'],
    }
  );

  return {
    ...baseHeaders,
    ...signatureHeaders,
  };
}

export async function verifyIncomingBelticRequest(
  req: NextRequest,
  options: KyaVerificationOptions = {}
): Promise<KyaVerificationResult> {
  const mode = getKyaVerificationMode();

  if (mode === 'off') {
    return { verified: true, mode, errors: [], warnings: ['KYA verification is disabled'] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const incoming = buildIncomingRequest(req);

  const ctx = await getSigningContextOrThrow('Unable to verify incoming request signature');
  if (!ctx) {
    return {
      verified: false,
      mode,
      errors: ['KYA signing unavailable. Set KYA_SIGNING_PRIVATE_PEM and KYA_SIGNING_PUBLIC_PEM, or add key files to .beltic/.'],
      warnings,
    };
  }

  const signature = await verifyHttpSignature(incoming, {
    keyResolver: async (keyId) => (keyId === ctx.keyId ? ctx.publicJwk : null),
    requiredComponents: ['@method', '@authority', '@path', 'signature-agent'],
  });

  if (!signature.valid) {
    return {
      verified: false,
      mode,
      errors: [signature.errors[0]?.message || 'HTTP signature verification failed'],
      warnings,
    };
  }

  const credentialsHeader = getHeaderCaseInsensitive(incoming.headers, 'Beltic-Credentials');
  if (!credentialsHeader) {
    return {
      verified: false,
      mode,
      errors: ['Missing Beltic-Credentials header'],
      warnings,
    };
  }

  let parsedCredentials: { agentJwt: string };
  try {
    parsedCredentials = parseCredentialsHeader(credentialsHeader);
  } catch (error) {
    return {
      verified: false,
      mode,
      errors: [error instanceof Error ? error.message : 'Invalid Beltic-Credentials header'],
      warnings,
    };
  }

  if (getCredentialType(parsedCredentials.agentJwt) !== 'agent') {
    errors.push('Beltic-Credentials agent JWT is not an agent credential');
    return { verified: false, mode, errors, warnings };
  }

  let payload: jose.JWTPayload;
  try {
    payload = await verifyAgentCredentialJwt(parsedCredentials.agentJwt, ctx.publicSpkiPem);
  } catch (error) {
    return {
      verified: false,
      mode,
      errors: [error instanceof Error ? error.message : 'Credential signature verification failed'],
      warnings,
    };
  }

  const vc = payload.vc as Record<string, unknown> | undefined;
  if (!vc) {
    return { verified: false, mode, errors: ['Credential payload missing vc claim'], warnings };
  }

  const kybTier = String(vc.kybTierRequired || 'tier_0');
  const promptScore = Number(vc.promptInjectionRobustnessScore ?? 0);
  const developerVerified = Boolean(vc.developerCredentialVerified);
  const modelProvider =
    typeof vc.primaryModelProvider === 'string' ? vc.primaryModelProvider : undefined;
  const modelFamily =
    typeof vc.primaryModelFamily === 'string' ? vc.primaryModelFamily : undefined;
  const policy = resolveKybPolicy(options);
  const minKybTier = policy.minKybTier ?? DEFAULT_KYB_POLICY.minKybTier;
  const minKybRank = rankKybTier(minKybTier);

  if (!developerVerified) {
    errors.push('developerCredentialVerified must be true');
  }

  if (rankKybTier(kybTier) < minKybRank) {
    errors.push(`kybTierRequired must be at least ${minKybTier} (got ${kybTier})`);
  }

  if (promptScore < 0.8) {
    errors.push(`promptInjectionRobustnessScore must be >= 0.8 (got ${promptScore})`);
  }

  const modelPolicy = evaluateModelPolicy(modelProvider, modelFamily);
  if (!modelPolicy.allowed) {
    errors.push(
      ...modelPolicy.reasons.map((reason) => `Model policy violation: ${reason}`)
    );
  }

  const credentialThumbprint =
    typeof vc.httpSigningKeyJwkThumbprint === 'string' ? vc.httpSigningKeyJwkThumbprint : undefined;
  const credentialDirectory = typeof vc.keyDirectoryUrl === 'string' ? vc.keyDirectoryUrl : undefined;

  if (credentialThumbprint && credentialThumbprint !== signature.keyId) {
    errors.push('HTTP signature key does not match credential thumbprint');
  }

  if (credentialDirectory && credentialDirectory !== signature.signatureAgent) {
    errors.push('Signature-Agent URL does not match credential keyDirectoryUrl');
  }

  if (!credentialThumbprint || !credentialDirectory) {
    const message = 'Credential is missing key binding fields (httpSigningKeyJwkThumbprint/keyDirectoryUrl)';
    if (mode === 'strict') {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }

  return {
    verified: errors.length === 0,
    mode,
    errors,
    warnings,
    agentId: typeof vc.agentId === 'string' ? vc.agentId : undefined,
    developerId: typeof vc.developerCredentialId === 'string' ? vc.developerCredentialId : undefined,
    kybTier,
    promptInjectionScore: promptScore,
    modelProvider,
    modelFamily,
  };
}

export async function getKyaPublicMetadata(): Promise<{
  keyId: string;
  keyDirectoryUrl: string;
  publicJwk: jose.JWK;
}> {
  const ctx = await getSigningContext();
  return {
    keyId: ctx.keyId,
    keyDirectoryUrl: ctx.keyDirectoryUrl,
    publicJwk: ctx.publicJwk,
  };
}
