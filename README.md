# x402 + KYA Demo

AI agent commerce with cryptographic identity and micropayments.

Two agents ask the same weather question side by side. One is anonymous (x402 only, pays full price). The other carries a verified [FACT/KYA](https://beltic.dev) credential and gets a trust-based discount. Both pay in USDC on Base Sepolia testnet.

**Live demo**: [x402-demo.beltic.app](https://x402-demo.beltic.app)

## What This Demonstrates

| Protocol | Question It Answers |
|----------|---------------------|
| [x402](https://x402.org) | Can this agent pay? |
| [KYA](https://beltic.dev) | Who is this agent? Is it safe? Who built it? |

Together they enable trust-based pricing: the API charges less when it can cryptographically verify who is making the request.

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm
- [Beltic CLI](https://github.com/belticlabs/beltic-cli) (for credential generation)
- An [OpenRouter API key](https://openrouter.ai/keys)

### 1. Clone and Install

```bash
git clone https://github.com/belticlabs/x402-demo.git
cd x402-demo/web
pnpm install
```

### 2. Set Up Environment

```bash
cp .env.example .env
```

Edit `.env` and add your OpenRouter key:

```bash
OPENROUTER_API_KEY=sk-or-...
```

That's the only required variable. The app runs with simulated payments and the included demo credential by default.

### 3. Run

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Type a weather question and watch both agents respond.

## Generating Your Own Credential

The repo ships with a demo credential in `.beltic/`. To generate your own:

### Install the Beltic CLI

```bash
# macOS / Linux
brew tap belticlabs/tap && brew install beltic

# or via shell script
curl -fsSL https://raw.githubusercontent.com/belticlabs/beltic-cli/master/install.sh | sh

# or via cargo
cargo install beltic
```

### Option A: Wizard (fastest)

```bash
npx @belticlabs/wizard --local --install-dir .
```

This runs an interactive flow that generates everything: config, manifest, keys, and a signed credential.

### Option B: Step by Step with the CLI

From the repo root (`x402-demo/`):

**1. Initialize the agent manifest**

```bash
beltic init
```

Prompts for agent name, version, description, model info, tools, and capabilities. Outputs `agent-manifest.json`.

**2. Generate a fingerprint of the codebase**

```bash
beltic fingerprint
```

Hashes the files listed in `.beltic.yaml` and writes the fingerprint into `agent-manifest.json`.

**3. Generate signing keys**

```bash
beltic keygen --alg EdDSA --name x402-demo
```

Creates:
- `.beltic/x402-demo-private.pem` (Ed25519 private key, 0600 permissions)
- `.beltic/x402-demo-public.pem` (Ed25519 public key)

The private key is automatically added to `.gitignore`.

**4. Sign the credential**

```bash
beltic sign \
  --key .beltic/x402-demo-private.pem \
  --payload agent-manifest.json \
  --kid x402-demo \
  --out .beltic/agent-credential.jwt
```

Creates a signed JWT containing the agent's identity, safety scores, KYB tier, and tool declarations as a W3C Verifiable Credential.

**5. Verify it worked**

```bash
beltic verify \
  --key .beltic/x402-demo-public.pem \
  --token .beltic/agent-credential.jwt
```

### What Gets Generated

```
.beltic/
  x402-demo-private.pem      # Ed25519 private key (never commit this)
  x402-demo-public.pem       # Ed25519 public key
  agent-credential.jwt       # Signed W3C Verifiable Credential
  agent-credential.json      # Credential payload (human-readable)
```

The app automatically discovers these files at startup. No additional configuration needed for local development.

## Enabling Real Payments

Without wallet configuration, payments are simulated. To use real USDC on Base Sepolia:

**1. Generate a wallet**

```bash
node -e "console.log('0x' + require('crypto').randomBytes(32).toString('hex'))"
```

**2. Fund it**

- Testnet ETH (for gas): [Coinbase Faucet](https://faucet.coinbase.com/)
- Testnet USDC: [Circle Faucet](https://faucet.circle.com/)

**3. Add to `.env`**

```bash
# Agent wallet (payer)
AGENT_PRIVATE_KEY=0x...

# Merchant wallet (receives payments)
RECIPIENT_WALLET_ADDRESS=0x...
```

Payments are USDC transfers on Base Sepolia (chain ID 84532) via [viem](https://viem.sh). Transaction hashes link to [BaseScan](https://sepolia.basescan.org).

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | API key for LLM calls via [OpenRouter](https://openrouter.ai) |

### Wallet (optional, enables real payments)

| Variable | Description |
|----------|-------------|
| `AGENT_PRIVATE_KEY` | Agent wallet private key (0x-prefixed, 64 hex chars) |
| `RECIPIENT_WALLET_ADDRESS` | Merchant wallet address (0x-prefixed) |
| `BASE_SEPOLIA_RPC_URL` | Custom RPC URL (default: `https://sepolia.base.org`) |

### KYA Signing Keys (optional, for HTTP message signatures)

| Variable | Description |
|----------|-------------|
| `KYA_SIGNING_PRIVATE_PEM` | Ed25519 private key. Accepts: file path, inline PEM, `base64:` prefix, or JSON wrapper |
| `KYA_SIGNING_PUBLIC_PEM` | Ed25519 public key. Same formats as above |
| `KYA_VERIFICATION_MODE` | `strict`, `compat` (default), or `off` |

If not set, the app falls back to discovering keys from the `.beltic/` directory.

### Serverless / Vercel Deployment

| Variable | Description |
|----------|-------------|
| `BELTIC_CREDENTIAL_JWT` | Inline JWT content (bypasses filesystem credential lookup) |
| `NEXT_PUBLIC_APP_URL` | Public app URL for OpenRouter referrer and KYA directory |
| `CDP_API_KEY_ID` | Coinbase CDP API key ID (for x402 settlement) |
| `CDP_API_KEY_SECRET` | Coinbase CDP API secret |

For Vercel, use `base64:` prefix for PEM keys to avoid newline issues:

```bash
KYA_SIGNING_PRIVATE_PEM=base64:LS0tLS1CRUdJTi...
KYA_SIGNING_PUBLIC_PEM=base64:LS0tLS1CRUdJTi...
BELTIC_CREDENTIAL_JWT=eyJhbGciOi...
```

The `vercel-export-keys` script can generate these values:

```bash
pnpm run vercel:export-keys
```

### Demo Controls (optional)

| Variable | Description |
|----------|-------------|
| `DEMO_CHAT_DISABLED` | Disable all chat routes (`true`/`false`) |
| `DEMO_PAID_FLOW_DISABLED` | Disable paid weather flow (`true`/`false`) |
| `DEMO_MAX_MESSAGE_CHARS` | Max message length (default: 2000) |
| `MODEL_POLICY_MODE` | `allowlist` (default), `denylist`, or `off` |

## How It Works

### Data Flow

```
User types a weather question
  |
  v
Sent to both API routes in parallel:
  /api/chat/general   (anonymous, no credential)
  /api/chat/beltic    (verified, sends KYA credential)
  |
  v
Each route streams SSE events back to the UI:
  thinking_start/end, tool_call, payment_required, content, done
  |
  v
LLM picks a tool:
  get_free_weather(location)   -> always free
  get_paid_weather(location)   -> triggers payment flow
  |
  v
If payment required:
  1. Stream sends payment_required event
  2. PaymentModal appears in UI
  3. User accepts -> wallet.ts transfers USDC on-chain
  4. Stream resumes with payment_accepted
  5. Weather data fetched from Open-Meteo
  6. LLM generates final response with the data
```

### Trust-Based Pricing

The verified agent's price is calculated from its credential:

**KYB tier discount:**

| Tier | Discount |
|------|----------|
| tier_0 | 0% |
| tier_1 | 10% |
| tier_2 | 20% |
| tier_3 | 25% |
| tier_4 | 30% |

**Safety score discount:**

```
min(20%, (averageSafetyScore / 100) * 20%)
```

**Total discount** is capped at 50%. Final price = base price * (1 - total discount).

With the included demo credential (tier_2, avg safety 87.5): $0.01 base -> $0.0062 final (38% discount).

### Credential Loading

At startup, `credential-loader.ts` searches for the JWT in this order:

1. `BELTIC_CREDENTIAL_JWT` environment variable (inline)
2. `BELTIC_CREDENTIAL_PATH` environment variable (file path)
3. `.beltic/agent-credential.jwt`
4. `.beltic/credential.jwt`
5. `agent-credential.jwt` (walks up parent directories)
6. `credential.jwt`

The credential is decoded using `@belticlabs/kya`, cached at module level, and reused across all requests.

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/chat/general` | POST | Anonymous agent chat (x402 only) |
| `/api/chat/beltic` | POST | Verified agent chat (x402 + KYA) |
| `/api/credential` | GET | Decoded credential info as JSON |
| `/api/credential/jwt` | GET | Raw credential JWT |
| `/api/x402/weather` | GET | x402-wrapped weather endpoint |
| `/api/demo/status` | GET | Environment and system status |
| `/api/.well-known/jwks.json` | GET | Public signing key (JWKS) |
| `/api/.well-known/http-message-signatures-directory` | GET | KYA key directory |

## Project Structure

```
x402-demo/
  .beltic/                         # Agent keys and credential
    x402-demo-private.pem
    x402-demo-public.pem
    agent-credential.jwt
    agent-credential.json
  .beltic.yaml                     # Beltic agent config
  web/                             # Next.js application
    .env.example
    package.json
    src/
      app/
        page.tsx                   # Split-screen UI
        layout.tsx                 # Root layout + theme
        globals.css                # Design system
        api/
          chat/general/route.ts    # Anonymous agent endpoint
          chat/beltic/route.ts     # Verified agent endpoint
          credential/route.ts      # Credential info API
          credential/jwt/route.ts  # Raw JWT API
          x402/weather/route.ts    # x402-wrapped weather
          demo/status/route.ts     # Demo status
          .well-known/             # JWKS + key directory
      components/
        OnboardingModal.tsx        # First-visit walkthrough
        VerifiedBadge.tsx          # Credential popover
        PaymentModal.tsx           # Payment UI + tx status
        ChainOfThought.tsx         # AI thinking visualization
        ThemeProvider.tsx          # Dark/light toggle
      lib/
        credential-loader.ts       # Credential discovery and caching
        kya.ts                     # KYA signing and verification
        x402.ts                    # x402 payment protocol
        wallet.ts                  # USDC transfers via viem
        weather.ts                 # Open-Meteo API
        scenarios.ts               # Scenario config
        sse.ts                     # Server-Sent Events parsing
    scripts/
      check-setup.mjs             # Validate environment
      claim-base-sepolia-faucet.mjs
      vercel-export-keys.mjs      # Export keys for Vercel
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16, React 19, TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Blockchain | viem (USDC on Base Sepolia) |
| Credentials | @belticlabs/kya (W3C Verifiable Credentials) |
| LLM | OpenRouter (Nvidia Nemotron 3 Nano 30B, free tier) |
| Weather | Open-Meteo API (free, no auth) |
| Payments | x402 protocol (@x402/core, @x402/evm, @coinbase/x402) |

## Known Issues

See [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## Resources

- [Beltic Documentation](https://kya-docs.beltic.app/docs)
- [Beltic CLI](https://github.com/belticlabs/beltic-cli)
- [x402 Protocol](https://x402.org)
- [W3C Verifiable Credentials](https://www.w3.org/TR/vc-data-model-2.0/)

## License

MIT
