#!/usr/bin/env node

import process from 'node:process';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3002';
const API_KEY = process.env.FAKE_PLATFORM_API_KEY || '';

async function requestPlatform(route, apiKey) {
  const response = await fetch(`${BASE_URL}${route}`, {
    headers: {
      Accept: 'application/json',
      'x-api-key': apiKey || '',
    },
  });

  const body = await response.json().catch(() => null);
  return { response, body };
}

async function main() {
  if (!API_KEY) {
    console.error('[platform-smoke] FAKE_PLATFORM_API_KEY is not configured in environment.');
    process.exitCode = 1;
    return;
  }

  const unauthorized = await requestPlatform('/api/platform/credential', '');
  if (unauthorized.response.status !== 401) {
    console.error('[platform-smoke] expected unauthorized response without API key');
    process.exitCode = 1;
    return;
  }
  console.log('[platform-smoke] unauthorized check: passed');

  const withKey = await requestPlatform('/api/platform/credential', API_KEY);
  if (!withKey.response.ok || !withKey.body?.success) {
    console.error('[platform-smoke] credential request failed:', withKey.body?.error || withKey.response.statusText);
    process.exitCode = 1;
    return;
  }

  if (!withKey.body.data?.credential) {
    console.error('[platform-smoke] platform response missing credential');
    process.exitCode = 1;
    return;
  }

  console.log('[platform-smoke] platform API OK');
  console.log(`[platform-smoke] credential source: ${withKey.body.data.source}`);
  console.log(`[platform-smoke] platform: ${withKey.body.data.platform}`);
}

main();
