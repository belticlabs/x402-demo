import { NextResponse } from 'next/server';
import { getKyaPublicMetadata, getKyaVerificationMode } from '@/lib/kya';
import { getPublicPricingSummary } from '@/lib/x402';
import { getCredentialInfo } from '@/lib/credential-loader';
import { evaluateModelPolicy } from '@/lib/model-policy';

function sanitizeStatusError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  return error.message.replace(/-----BEGIN[\s\S]*?-----END [^-]+-----/g, '[redacted-pem]');
}

export async function GET() {
  try {
    let keyMeta = null;
    let kyaSigningReady = false;
    let kyaSigningError: string | undefined;
    try {
      keyMeta = await getKyaPublicMetadata();
      kyaSigningReady = true;
    } catch (error) {
      // Keep status endpoint usable without local keys for anonymous/self-hosted setups.
      keyMeta = null;
      kyaSigningReady = false;
      kyaSigningError = sanitizeStatusError(error);
    }
    const credentialInfo = getCredentialInfo();
    const modelPolicy = evaluateModelPolicy(
      credentialInfo.modelProvider,
      credentialInfo.modelFamily
    );

    return NextResponse.json({
      success: true,
      kyaMode: getKyaVerificationMode(),
      pricing: getPublicPricingSummary(),
      modelPolicy: {
        mode: modelPolicy.config.mode,
        allowed: modelPolicy.allowed,
        reasons: modelPolicy.reasons,
        credentialModel: {
          provider: credentialInfo.modelProvider,
          family: credentialInfo.modelFamily,
        },
        config: {
          providerAllowlist: modelPolicy.config.providerAllowlist,
          providerDenylist: modelPolicy.config.providerDenylist,
          familyAllowlist: modelPolicy.config.familyAllowlist,
          familyDenylist: modelPolicy.config.familyDenylist,
        },
      },
      key: {
        keyId: keyMeta?.keyId,
        keyDirectoryUrl: keyMeta?.keyDirectoryUrl,
      },
      kyaSigningReady,
      kyaSigningError,
      env: {
        hasOpenRouter: Boolean(process.env.OPENROUTER_API_KEY),
        hasAgentPrivateKey: Boolean(process.env.AGENT_PRIVATE_KEY),
        hasRecipientAddress: Boolean(process.env.RECIPIENT_WALLET_ADDRESS),
        hasCdpApiKeyId: Boolean(process.env.CDP_API_KEY_ID),
        hasCdpApiKeySecret: Boolean(process.env.CDP_API_KEY_SECRET),
        chatDisabled: process.env.DEMO_CHAT_DISABLED === 'true',
        paidFlowDisabled: process.env.DEMO_PAID_FLOW_DISABLED === 'true',
        maxMessageChars: process.env.DEMO_MAX_MESSAGE_CHARS || '2000',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'status unavailable',
      },
      { status: 500 }
    );
  }
}
