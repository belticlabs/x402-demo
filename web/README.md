# x402 + Beltic KYA Demo (Web)

This is the publishable web demo for:
- `x402-only` anonymous pricing
- `x402-kya` verified pricing with signed Beltic credential requests

Weather supports any city/region/country prompt.

## Public Demo Model

- This is a sponsored **testnet** demo.
- Payments are sent by a server-side demo wallet configured in env vars.
- No wallet input or wallet connection is required in the UI.
- If you fork this repo, configure your own env wallet values.
- Location resolution is LLM-first through tool arguments, with lightweight alias fallback (`SF`, `NYC`, `LA`).

## Quickstart (No Auth Wizard Flow)

1. Install dependencies:

```bash
pnpm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Generate local credential + keys (no Beltic login required):

```bash
pnpm bootstrap:wizard-local
```

Equivalent commands:

```bash
npx @belticlabs/wizard --local --install-dir .
npx @belticlabs/wizard --offline --install-dir .
BELTIC_WIZARD_LOCAL=true npx @belticlabs/wizard --install-dir .
```

4. Validate setup:

```bash
pnpm check:setup
```

5. Run:

```bash
pnpm dev
```

Open `http://localhost:3002`.

Optional: Start a fake platform endpoint for local SDK integration testing:

```bash
export FAKE_PLATFORM_API_KEY=your-secret
pnpm smoke:platform
```

## Required Env Vars

Set these in `.env`:
- `OPENROUTER_API_KEY`
- `AGENT_PRIVATE_KEY`
- `RECIPIENT_WALLET_ADDRESS`
- `FAKE_PLATFORM_API_KEY` (only if you use the fake platform smoke test)

Optional:
- `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` (recommended for facilitator settle/verify)
- `KYA_VERIFICATION_MODE=strict|compat|off`
- `OPENROUTER_MODEL_ID` (optional explicit runtime model id override)
- `DEMO_CHAT_DISABLED=true|false` (optional emergency chat kill switch)
- `DEMO_PAID_FLOW_DISABLED=true|false` (optional emergency paid-flow kill switch)
- `DEMO_MAX_MESSAGE_CHARS` (optional request-size guard, default `2000`)

## Vercel KYA Env Format

For Vercel deployments, set these env vars directly:
- `BELTIC_CREDENTIAL_JWT`
- `KYA_SIGNING_PRIVATE_PEM`
- `KYA_SIGNING_PUBLIC_PEM`

Use Ed25519 PEM material with newline-preserving formatting. Typical safe format in env values uses escaped newlines:

```bash
KYA_SIGNING_PRIVATE_PEM=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
KYA_SIGNING_PUBLIC_PEM=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
```

If you see `asn1 encoding routines::wrong tag`, the key content is usually malformed, swapped, or not Ed25519 PEM.

## Model Acceptance Policy

The verified route can reject/accept credentials by model metadata at runtime.

Core env vars:
- `MODEL_POLICY_MODE=allowlist|denylist|off`
- `MODEL_PROVIDER_ALLOWLIST`
- `MODEL_FAMILY_ALLOWLIST`
- `MODEL_PROVIDER_DENYLIST`
- `MODEL_FAMILY_DENYLIST`

Example (strict allowlist):

```bash
MODEL_POLICY_MODE=allowlist
MODEL_PROVIDER_ALLOWLIST=openrouter,nvidia,qwen
MODEL_FAMILY_ALLOWLIST=nemotron,qwen2.5
```

Example (deny specific families):

```bash
MODEL_POLICY_MODE=denylist
MODEL_FAMILY_DENYLIST=deepseek-v3,qwen-2.5
```

## API Checks

```bash
curl http://localhost:3002/api/demo/status
```

```bash
curl "http://localhost:3002/api/x402/weather?location=San%20Francisco&tier=anonymous"
```

`/api/x402/weather` is x402-protected and returns `402` without payment headers.

## Proof and Reproducibility

- Repro instructions, expected outputs, and proof artifacts are in `docs/proof.md`.
- This includes exact setup and request flows to validate anonymous vs verified behavior.

## Abuse Response (No Active Rate Limiting Yet)

- This release does **not** enforce active rate limiting by default.
- If abuse starts, use the kill switches:
  - `DEMO_CHAT_DISABLED=true`
  - `DEMO_PAID_FLOW_DISABLED=true`
- Then roll out Upstash-backed rate limiting as a follow-up patch.

## SDK Policy Customization Notes

If you want policy at SDK-level (not app-level), update upstream repos in this order:
1. `beltic-spec`: update model provider/family enums.
2. `beltic-sdk`: sync `src/schemas/agent-credential-v2.schema.json`, regenerate types, and expose v2 validation path.
3. `wizard`: ensure generated values align with updated schema defaults/options.
