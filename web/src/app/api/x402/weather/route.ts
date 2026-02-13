import { withX402 } from '@x402/next';
import { NextRequest, NextResponse } from 'next/server';
import { verifyIncomingBelticRequest } from '@/lib/kya';
import { fetchWeatherByQuery } from '@/lib/weather';
import {
  getResourceServer,
  getTierFromQuery,
  getTierPrice,
  getWeatherRouteConfig,
} from '@/lib/x402';

const weatherHandler = async (request: NextRequest): Promise<NextResponse> => {
  const { searchParams } = new URL(request.url);
  const location = (searchParams.get('location') || '').trim();
  const tier = getTierFromQuery(searchParams.get('tier'));
  const minKybTier = searchParams.get('minKybTier') || undefined;

  if (!location) {
    return NextResponse.json({
      success: false,
      error: 'location query parameter is required',
    }, { status: 400 });
  }

  if (tier === 'verified') {
    const verification = await verifyIncomingBelticRequest(request, {
      policy: {
        minKybTier,
      },
    });
    if (!verification.verified) {
      return NextResponse.json(
        {
          success: false,
          error: 'KYA verification failed for verified pricing',
          verification,
        },
        { status: 403 }
      );
    }
  }

  const weather = await fetchWeatherByQuery(location, true);
  if (typeof weather.error === 'string') {
    return NextResponse.json(
      {
        success: false,
        error: weather.error,
        weather,
      },
      { status: 422 }
    );
  }

  return NextResponse.json({
    success: true,
    tier,
    price: getTierPrice(tier),
    weather,
  });
};

export const GET = withX402(
  weatherHandler,
  getWeatherRouteConfig(),
  getResourceServer()
);
