import { NextResponse } from 'next/server';
import { getKyaPublicMetadata } from '@/lib/kya';

export async function GET() {
  try {
    const meta = await getKyaPublicMetadata();
    return NextResponse.json(
      {
        keys: [meta.publicJwk],
        agentCredentialUrl: `${(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3002').replace(/\/$/, '')}/api/credential/jwt`,
      },
      {
        headers: {
          'Content-Type': 'application/http-message-signatures-directory+json',
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Key directory unavailable',
      },
      {
        status: 503,
        headers: {
          'Content-Type': 'application/http-message-signatures-directory+json',
        },
      }
    );
  }
}
