# Proof and Reproducibility Guide

This guide shows how to reproduce the public demo behavior end to end.

## What This Demo Proves

1. `x402-only` path can access paid weather as an anonymous agent (full price).
2. `x402-kya` path can access paid weather as a KYA-verified agent (discounted price).
3. Both routes complete the flow on Base Sepolia testnet.

## Demo Model

- Sponsored testnet demo.
- Wallet keys stay server-side in env vars.
- No wallet input or wallet connection in UI.

## Prerequisites

1. Node.js + pnpm installed.
2. An `OPENROUTER_API_KEY`.
3. Testnet wallet values for:
   - `AGENT_PRIVATE_KEY`
   - `RECIPIENT_WALLET_ADDRESS`

## Setup

```bash
pnpm install
cp .env.example .env
```

Set at minimum in `.env`:

```bash
OPENROUTER_API_KEY=...
AGENT_PRIVATE_KEY=0x...
RECIPIENT_WALLET_ADDRESS=0x...
NEXT_PUBLIC_APP_URL=http://localhost:3002
```

Bootstrap credential + local keys:

```bash
pnpm bootstrap:wizard-local
pnpm check:setup
```

Run:

```bash
pnpm dev
```

Open `http://localhost:3002`.

## Repro Flow (UI)

1. Send a basic prompt like:
   - `What's the weather in San Francisco?`
   - Expected: both columns return free/basic weather.
2. Send a detailed prompt like:
   - `Give me a detailed weather forecast for San Francisco`
   - Expected: payment UI appears for both columns.
3. Accept payment.
   - Expected: both columns complete with transaction confirmation.
   - Expected: verified column reflects discounted pricing vs anonymous.

## Repro Flow (API)

Health/status:

```bash
curl http://localhost:3002/api/demo/status
```

Direct x402 route (without payment headers should challenge/fail):

```bash
curl "http://localhost:3002/api/x402/weather?location=San%20Francisco&tier=anonymous"
```

Credential payload used by UI:

```bash
curl http://localhost:3002/api/credential
```

## Proof Artifacts to Share

1. Public deployment URL.
2. A short screen recording:
   - one free request
   - one paid request
   - both anonymous and verified columns
3. At least one Base Sepolia tx hash from each scenario path.
4. `/api/demo/status` output showing env readiness and mode flags.

## Fork and Use Your Own Wallet

1. Fork repo.
2. Set your own env vars in Vercel or local `.env`.
3. Do not paste wallet keys into client-side code or UI.

## Operational Notes

- This release does not enforce active rate limiting by default.
- Emergency controls:
  - `DEMO_CHAT_DISABLED=true`
  - `DEMO_PAID_FLOW_DISABLED=true`
- If abuse appears, add Upstash-backed rate limiting in a follow-up patch.

## Troubleshooting

1. Error: `No location match found ...`
- Retry with explicit place names like `Tampa, Florida, US` or `New York City, New York, US`.
- Short aliases `SF` / `NYC` / `LA` are supported.

2. Error: `Invalid KYA_SIGNING_PRIVATE_PEM` or `Invalid KYA_SIGNING_PUBLIC_PEM`
- Verify both env vars are set.
- Confirm private key is in `KYA_SIGNING_PRIVATE_PEM` and public key in `KYA_SIGNING_PUBLIC_PEM`.
- Ensure values are Ed25519 PEM blocks with preserved newlines (`\n` in env values is acceptable).

3. Error: `asn1 encoding routines::wrong tag` or PEM import failures on Vercel
- **On Vercel**: Vercel mangles multiline env vars. Use base64 encoding instead:
  ```bash
  cat .beltic/*-private.pem | base64
  cat .beltic/*-public.pem | base64
  ```
  Paste each output into `KYA_SIGNING_PRIVATE_PEM` and `KYA_SIGNING_PUBLIC_PEM` in Vercel. The app auto-detects and decodes base64.
- Otherwise: Use `\n` for newlines (single-line PEM), not literal line breaks.
- Re-copy key material and check BEGIN/END headers:
  - `BEGIN PRIVATE KEY` for private key
  - `BEGIN PUBLIC KEY` for public key

4. Check operator status quickly

```bash
curl http://localhost:3002/api/demo/status
```

Look for:
- `kyaSigningReady: true`
- `kyaSigningError` empty/undefined
