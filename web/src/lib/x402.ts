import { createFacilitatorConfig } from '@coinbase/x402';
import { HTTPFacilitatorClient, type RouteConfig, x402ResourceServer } from '@x402/core/server';
import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme as ExactEvmClientScheme } from '@x402/evm';
import { ExactEvmScheme as ExactEvmServerScheme } from '@x402/evm/exact/server';
import { privateKeyToAccount } from 'viem/accounts';
import { calculatePricing, getCredentialInfo } from '@/lib/credential-loader';
import { getBaseScanLink } from '@/lib/wallet';

export type WeatherTier = 'anonymous' | 'verified';

interface WeatherPricing {
  basePrice: number;
  verifiedPrice: number;
}

const SUPPORTED_KYB_TIERS = ['tier_0', 'tier_1', 'tier_2', 'tier_3', 'tier_4'] as const;
export type KybTier = (typeof SUPPORTED_KYB_TIERS)[number];

function normalizeKybTier(value?: string | null): KybTier | undefined {
  const normalized = value?.trim().toLowerCase() as KybTier | undefined;
  if (!normalized) return undefined;
  return SUPPORTED_KYB_TIERS.includes(normalized) ? normalized : undefined;
}

function decodeBase64Json(value?: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const json = Buffer.from(value, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const DEFAULT_X402_NETWORK = 'eip155:84532';
const TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

function isTransactionHash(value: unknown): value is string {
  return typeof value === 'string' && TX_HASH_PATTERN.test(value);
}

function decodeSettlementHeader(headerValue?: string | null): Record<string, unknown> | null {
  if (!headerValue) return null;
  try {
    const decoded = decodePaymentResponseHeader(headerValue);
    return decoded && typeof decoded === 'object' ? (decoded as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function extractSettlementTransaction(settlement: unknown): string {
  if (!settlement || typeof settlement !== 'object') {
    return '';
  }

  const candidateFields = [
    'transaction',
    'txHash',
    'transactionHash',
    'hash',
  ];

  for (const field of candidateFields) {
    const candidate = (settlement as Record<string, unknown>)[field];
    if (isTransactionHash(candidate)) {
      return candidate;
    }

    if (
      candidate &&
      typeof candidate === 'object' &&
      isTransactionHash((candidate as Record<string, unknown>).hash)
    ) {
      return (candidate as Record<string, unknown>).hash as string;
    }
  }

  return '';
}

function extractSettlementNetwork(settlement: unknown): string | undefined {
  if (!settlement || typeof settlement !== 'object') {
    return undefined;
  }
  const value = (settlement as Record<string, unknown>).network;
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  const chainId = (settlement as Record<string, unknown>).chainId;
  if (typeof chainId === 'number' && chainId > 0) {
    return `eip155:${chainId}`;
  }
  if (typeof chainId === 'string' && chainId.trim().length > 0) {
    if (/^\d+$/.test(chainId.trim())) {
      return `eip155:${chainId.trim()}`;
    }
    return chainId.trim();
  }

  return undefined;
}

let cachedResourceServer: x402ResourceServer | null = null;
let cachedFetchWithPayment: ReturnType<typeof wrapFetchWithPaymentFromConfig> | null = null;

function getRecipientAddress(): `0x${string}` {
  const address = process.env.RECIPIENT_WALLET_ADDRESS;
  if (!address || !address.startsWith('0x') || address.length !== 42) {
    throw new Error('RECIPIENT_WALLET_ADDRESS must be configured for x402 routes');
  }
  return address as `0x${string}`;
}

function getPricing(): WeatherPricing {
  const basePrice = 0.01;
  const credentialPricing = calculatePricing(getCredentialInfo(), basePrice);
  return {
    basePrice,
    verifiedPrice: credentialPricing.finalPrice,
  };
}

export function getTierFromQuery(value: string | null): WeatherTier {
  return value === 'verified' ? 'verified' : 'anonymous';
}

export function getTierPrice(tier: WeatherTier): number {
  const pricing = getPricing();
  return tier === 'verified' ? pricing.verifiedPrice : pricing.basePrice;
}

function formatUsdPrice(value: number): string {
  return `$${value.toFixed(4)}`;
}

export function getWeatherRouteConfig(): RouteConfig {
  return {
    accepts: {
      scheme: 'exact',
      network: 'eip155:84532',
      payTo: getRecipientAddress(),
      price: (context) => {
        const tierValue = context.adapter.getQueryParam?.('tier');
        const tier = typeof tierValue === 'string' ? getTierFromQuery(tierValue) : 'anonymous';
        return formatUsdPrice(getTierPrice(tier));
      },
    },
    resource: 'weather-detailed',
    description: 'Detailed weather data via x402',
  };
}

export function getResourceServer(): x402ResourceServer {
  if (cachedResourceServer) {
    return cachedResourceServer;
  }

  const facilitatorConfig = createFacilitatorConfig(
    process.env.CDP_API_KEY_ID,
    process.env.CDP_API_KEY_SECRET
  );

  const facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig);
  cachedResourceServer = new x402ResourceServer(facilitatorClient).register(
    'eip155:84532',
    new ExactEvmServerScheme()
  );

  return cachedResourceServer;
}

function getFetchWithPayment() {
  if (cachedFetchWithPayment) {
    return cachedFetchWithPayment;
  }

  const privateKey = process.env.AGENT_PRIVATE_KEY;
  if (!privateKey || !privateKey.startsWith('0x') || privateKey.length !== 66) {
    throw new Error('AGENT_PRIVATE_KEY must be configured for x402 client payments');
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  cachedFetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: 'eip155:84532',
        client: new ExactEvmClientScheme(account),
      },
    ],
  });

  return cachedFetchWithPayment;
}

export function buildX402WeatherUrl(
  location: string,
  tier: WeatherTier,
  appUrlOverride?: string,
  minKybTier?: KybTier
): string {
  const baseUrl = (appUrlOverride || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3002').replace(
    /\/$/,
    ''
  );
  const params = new URLSearchParams({
    location,
    tier,
  });
  const normalizedTier = normalizeKybTier(minKybTier);
  if (normalizedTier) {
    params.set('minKybTier', normalizedTier);
  }
  return `${baseUrl}/api/x402/weather?${params.toString()}`;
}

export async function fetchDetailedWeatherThroughX402(
  location: string,
  tier: WeatherTier,
  extraHeaders?: Record<string, string>,
  appUrlOverride?: string,
  minKybTier?: KybTier
): Promise<{
  data: Record<string, unknown>;
  txHash: string;
  txLink: string;
}> {
  const url = buildX402WeatherUrl(location, tier, appUrlOverride, minKybTier);

  let response: Response;
  try {
    response = await getFetchWithPayment()(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...extraHeaders,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'x402 weather request failed';
    console.error('[x402] Weather fetch failed:', { url, message });
    throw new Error(message);
  }

  let rawBody = '';
  let body: Record<string, unknown> = {};
  try {
    rawBody = await response.text();
    body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
  } catch {
    body = rawBody ? { raw: rawBody } : {};
  }

  const responseHeaders = Object.fromEntries(
    Array.from(response.headers.entries()).map(([name, value]) => [name.toLowerCase(), value])
  );
  if (!response.ok) {
    const paymentRequired = decodeBase64Json(responseHeaders['payment-required']);
    const paymentRequiredError =
      typeof paymentRequired?.error === 'string' ? paymentRequired.error : undefined;
    const message =
      typeof body.error === 'string'
        ? body.error
        : response.status === 402 && paymentRequiredError
          ? `x402 payment required (${response.status}): ${paymentRequiredError}`
          : `x402 weather request failed (${response.status})`;
    console.error('[x402] Weather response error:', {
      url,
      status: response.status,
      statusText: response.statusText,
      headers: {
        paymentRequired: responseHeaders['payment-required'],
        wwwAuthenticate: responseHeaders['www-authenticate'],
        paymentResponse: responseHeaders['payment-response'],
        xPaymentResponse: responseHeaders['x-payment-response'],
        xPaymentChallenge: responseHeaders['x-payment-challenge'],
      },
      paymentRequired,
      message,
      body,
    });
    throw new Error(message);
  }

  const settlementHeader =
    response.headers.get('PAYMENT-RESPONSE') || response.headers.get('X-PAYMENT-RESPONSE');

  const decodedSettlement = decodeSettlementHeader(settlementHeader);
  const settlementTx = extractSettlementTransaction(decodedSettlement);
  const settlementNetwork = extractSettlementNetwork(decodedSettlement);

  const txHash = settlementTx || 'simulated';
  const txLink = settlementTx
    ? getBaseScanLink(settlementTx, settlementNetwork || DEFAULT_X402_NETWORK)
    : '';

  if (process.env.NODE_ENV !== 'production') {
    console.info('[x402] Settlement', {
      hasSettlement: Boolean(decodedSettlement),
      settlementTx,
      settlementNetwork,
      txHash,
      txLink,
      settlementPayload: decodedSettlement,
    });
  }

  return {
    data: body,
    txHash,
    txLink,
  };
}

export function getPublicPricingSummary() {
  const pricing = getPricing();
  return {
    anonymous: pricing.basePrice,
    verified: pricing.verifiedPrice,
    discount: Math.max(0, pricing.basePrice - pricing.verifiedPrice),
  };
}
