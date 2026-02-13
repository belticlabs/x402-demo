import { NextRequest, NextResponse } from 'next/server';
import { calculatePricing, getCredential, getCredentialInfo } from '@/lib/credential-loader';

const DEFAULT_API_KEY = process.env.FAKE_PLATFORM_API_KEY || '';

function unauthorizedResponse(reason: string) {
  return NextResponse.json({ success: false, error: reason }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const key = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace(/^Bearer /i, '') || '';

  if (!DEFAULT_API_KEY) {
    return NextResponse.json(
      {
        success: false,
        error: 'FAKE_PLATFORM_API_KEY is not configured on this server.',
      },
      { status: 500 }
    );
  }

  if (!key || key !== DEFAULT_API_KEY) {
    return unauthorizedResponse('Invalid or missing API key.');
  }

  const credential = getCredential();
  if (!credential.success || !credential.jwt || !credential.path) {
    return NextResponse.json(
      {
        success: false,
        error: 'No local agent credential available. Run `pnpm bootstrap:wizard-local`.',
      },
      { status: 404 }
    );
  }

  const info = getCredentialInfo();
  return NextResponse.json({
    success: true,
    data: {
      credential: credential.jwt,
      credentialType: 'agent',
      platform: 'x402-demo-fake-platform',
      source: credential.path,
      developer: {
        id: info.credentialId,
        agentId: info.agentId,
        agentName: info.agentName,
        modelProvider: info.modelProvider,
        modelFamily: info.modelFamily,
      },
    },
      public: {
      loadedFrom: info.loadedFrom,
      kybTier: info.kybTier,
      verificationLevel: info.verificationLevel,
      pricing: calculatePricing(info),
    },
  });
}
