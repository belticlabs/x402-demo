# x402 + Beltic KYA Demo (Web)

This is the publishable web demo for:
- `x402-only` anonymous pricing
- `x402-kya` verified pricing with signed Beltic credential requests

Weather supports any city/region/country prompt.

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

## SDK Policy Customization Notes

If you want policy at SDK-level (not app-level), update upstream repos in this order:
1. `beltic-spec`: update model provider/family enums.
2. `beltic-sdk`: sync `src/schemas/agent-credential-v2.schema.json`, regenerate types, and expose v2 validation path.
3. `wizard`: ensure generated values align with updated schema defaults/options.
