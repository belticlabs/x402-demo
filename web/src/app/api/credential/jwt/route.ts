import { NextResponse } from 'next/server';
import { getCredential } from '@/lib/credential-loader';

export async function GET() {
  const credential = getCredential();
  if (!credential.success || !credential.jwt) {
    return new NextResponse('Credential not found', { status: 404 });
  }

  return new NextResponse(credential.jwt, {
    headers: {
      'Content-Type': 'application/jwt',
    },
  });
}
