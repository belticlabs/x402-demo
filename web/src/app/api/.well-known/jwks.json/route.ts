import { NextResponse } from 'next/server';
import { getKyaPublicMetadata } from '@/lib/kya';

export async function GET() {
  const meta = await getKyaPublicMetadata();
  const jwk = {
    ...meta.publicJwk,
    use: 'sig',
    alg: 'EdDSA',
    kid: meta.keyId,
  };

  return NextResponse.json({ keys: [jwk] });
}
