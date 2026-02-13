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

export function buildX402WeatherUrl(location: string, tier: WeatherTier): string {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3002').replace(/\/$/, '');
  return `${baseUrl}/api/x402/weather?location=${encodeURIComponent(location)}&tier=${tier}`;
}

export async function fetchDetailedWeatherThroughX402(
  location: string,
  tier: WeatherTier,
  extraHeaders?: Record<string, string>
): Promise<{
  data: Record<string, unknown>;
  txHash: string;
  txLink: string;
}> {
  const url = buildX402WeatherUrl(location, tier);

  const response = await getFetchWithPayment()(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...extraHeaders,
    },
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : `x402 weather request failed (${response.status})`;
    throw new Error(message);
  }

  const settlementHeader =
    response.headers.get('PAYMENT-RESPONSE') || response.headers.get('X-PAYMENT-RESPONSE');

  const decodedSettlement = settlementHeader
    ? decodePaymentResponseHeader(settlementHeader)
    : null;

  const txHash = decodedSettlement?.transaction || 'simulated';
  const txLink = txHash.startsWith('0x') ? getBaseScanLink(txHash as `0x${string}`) : '';

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
