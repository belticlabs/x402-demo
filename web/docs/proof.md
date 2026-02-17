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

## Vercel Deployment — Base64 PEM Keys

Vercel replaces newlines with spaces in env vars, which breaks inline PEM. Use **base64-encoded PEM**:

1. **Generate base64 values** (from repo root):

   ```bash
   cd web && pnpm vercel:export-keys
   ```

   Or manually:
   ```bash
   base64 < .beltic/*-private.pem   # paste into KYA_SIGNING_PRIVATE_PEM
   base64 < .beltic/*-public.pem    # paste into KYA_SIGNING_PUBLIC_PEM
   ```

2. In Vercel: Project → Settings → Environment Variables.
3. Add `KYA_SIGNING_PRIVATE_PEM` = the base64 string (no `-----BEGIN`, no newlines).
4. Add `KYA_SIGNING_PUBLIC_PEM` = the base64 string.
5. Redeploy.

The app detects non-PEM values and base64-decodes them automatically.

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
- The error now includes the underlying crypto message — use it to debug.
- Verify both env vars are set. Confirm private key is in `KYA_SIGNING_PRIVATE_PEM`, public in `KYA_SIGNING_PUBLIC_PEM`.

3. PEM import failures on Vercel (asn1, wrong tag, etc.)
- **Use base64**: Run `pnpm vercel:export-keys` and paste **only** the base64 lines (not the `KYA_SIGNING_*=` labels).
- Ensure no extra spaces/newlines when pasting into Vercel. Copy the base64 string only.
- If raw base64 fails, try prefixing the value with `base64:` (e.g. `base64:LS0tLS1CRUdJTi...`).
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
