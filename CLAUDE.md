# CLAUDE.md — x402-demo

## What This Project Is

A split-screen demo showing **AI Agent Commerce** using two protocols:

- **x402** — "Can this agent pay?" HTTP-based micropayment protocol using USDC on Base Sepolia
- **KYA (Know Your Agent)** — "Who is this agent?" Beltic's cryptographic identity and trust verification

The demo runs two agents side-by-side asking the same weather question: an **anonymous agent** (x402 only, pays full price) vs a **verified agent** (x402 + KYA credentials, gets trust-based discounts).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16, React 19, TypeScript 5 |
| Styling | Tailwind CSS v4, custom design system in `globals.css` |
| Blockchain | viem — USDC transfers on Base Sepolia (testnet) |
| Credentials | @belticlabs/kya — W3C Verifiable Credential loading/validation |
| LLM | OpenRouter (Nvidia Nemotron 3 Nano 30B, free tier) |
| Weather Data | Open-Meteo API (free, no auth) |
| Icons | lucide-react |
| Markdown | react-markdown + remark-gfm |

## Project Structure

```
x402-demo/
├── .beltic/                    # Agent keys & credential files
├── .beltic.yaml                # Beltic agent config
├── README.md                   # Full project documentation
└── web/                        # Next.js application
    ├── package.json
    ├── .env / .env.example
    ├── agent-credential.jwt    # Generated W3C Verifiable Credential
    └── src/
        ├── app/
        │   ├── page.tsx                    # Main split-screen UI
        │   ├── layout.tsx                  # Root layout + theme provider
        │   ├── globals.css                 # Full design system (colors, animations)
        │   └── api/
        │       ├── chat/
        │       │   ├── general/route.ts    # Anonymous agent endpoint (x402 only)
        │       │   └── beltic/route.ts     # Verified agent endpoint (x402 + KYA)
        │       └── credential/route.ts     # Serves agent credential data
        ├── components/
        │   ├── VerifiedBadge.tsx            # Credential popover (4 tabs)
        │   ├── PaymentModal.tsx             # x402 payment UI + tx status
        │   ├── ChainOfThought.tsx           # AI thinking visualization
        │   ├── ScenarioColumn.tsx           # Single scenario column
        │   ├── UnifiedChatInput.tsx         # Shared input at bottom
        │   ├── Message.tsx / MessageList.tsx
        │   ├── ChatInput.tsx / ChatPanel.tsx
        │   ├── PaymentFlow.tsx
        │   └── ThemeProvider.tsx            # Dark/light theme toggle
        └── lib/
            ├── credential-loader.ts        # Load JWT from .beltic/, decode VC, calc pricing
            ├── scenarios.ts                # Scenario config built from credentials
            ├── wallet.ts                   # USDC transfers via viem on Base Sepolia
            ├── types.ts                    # TypeScript type definitions
            └── openrouter.ts               # OpenRouter API helper (unused)
```

## Commands

```bash
cd web
pnpm install        # Install dependencies
pnpm dev            # Start dev server (http://localhost:3000)
pnpm build          # Production build
pnpm lint           # Run ESLint
```

## Environment Variables

```bash
# Required
OPENROUTER_API_KEY=sk-or-...              # OpenRouter API key for LLM calls

# Optional — enables real USDC payments (simulated without these)
AGENT_PRIVATE_KEY=0x...                   # Agent wallet private key
RECIPIENT_WALLET_ADDRESS=0x...            # Receives payments

# Optional
BASE_SEPOLIA_RPC_URL=https://...          # Custom RPC (default: sepolia.base.org)
NEXT_PUBLIC_APP_URL=http://localhost:3000  # OpenRouter referer header
```

Without wallet keys, payments show as "simulated" — the app still runs fully.

## Architecture

### Data Flow

```
User types question in UnifiedChatInput
    ↓
Sent to both API routes in parallel:
├── /api/chat/general  (anonymous — no credential)
└── /api/chat/beltic   (verified — sends KYA credential)
    ↓
Each route streams SSE events:
  → thinking_start/end, tool_call, content, payment_required, done
    ↓
LLM picks a tool:
  - get_free_weather(location)  → always free
  - get_paid_weather(location)  → triggers payment flow
    ↓
If payment required:
  1. Stream sends payment_required event
  2. PaymentModal appears in UI
  3. User accepts → wallet.ts transfers USDC on-chain
  4. Stream resumes with payment_accepted
  5. Fetches weather from Open-Meteo
  6. LLM generates final response
```

### Trust-Based Pricing

```
Base price:           $0.01 per request
KYB discount:         tier_0=0%, tier_1=10%, tier_2=20%, tier_3=25%, tier_4=30%
Safety discount:      min(20%, (avgSafetyScore / 100) * 20%)
Total discount:       min(50%, kybDiscount + safetyDiscount)
Final price:          basePrice * (1 - totalDiscount)
```

### Credential Loading

`credential-loader.ts` searches for JWT files in priority order:
1. `.beltic/agent-credential.jwt`
2. `.beltic/credential.jwt`
3. `agent-credential.jwt`
4. `credential.jwt`

Decodes the W3C Verifiable Credential using `@belticlabs/kya`, extracts agent identity, safety scores, and KYB tier, then caches at module level.

### Stream Event Protocol

All chat API routes use Server-Sent Events with this format:

| Event | Purpose |
|-------|---------|
| `thinking_start` / `thinking_end` | AI reasoning visualization |
| `tool_call` | Function execution notification |
| `payment_required` | Triggers PaymentModal with price info |
| `payment_waiting` / `payment_processing` | Transaction lifecycle |
| `payment_accepted` / `payment_failed` | Transaction result |
| `content` | Streamed text chunks |
| `error` / `done` | Stream control |

## Key Patterns

- **Streaming responses**: API routes return `ReadableStream` with SSE-formatted events. Frontend parses with `getReader()` + text decoder.
- **Parallel execution**: Both scenarios run simultaneously from a single user input.
- **Graceful degradation**: Missing wallet config = simulated payments. Missing credential = anonymous mode.
- **Module-level caching**: Credentials loaded once at import time, reused across requests.
- **Theme system**: CSS custom properties in `globals.css` toggled by `ThemeProvider`, stored in localStorage.

## Design System

Dark mode is default. Key colors:

| Token | Dark | Light |
|-------|------|-------|
| Background | `#14120B` | `#FAF9F6` |
| Surface | `#1A1913` | `#FFFFFF` |
| Foreground | `#E8E6E0` | `#1A1913` |
| Accent | `#FF6B35` | `#FF6B35` |
| Border | `#2E2C23` | `#E8E6E0` |

## Working With This Codebase

- All app code lives under `web/src/` — the root only has Beltic config and docs.
- The two chat API routes (`general/` and `beltic/`) are the core logic — start there to understand the demo.
- `credential-loader.ts` is the bridge between Beltic credentials and the pricing system.
- `wallet.ts` handles all blockchain interactions — isolated from the rest of the app.
- Components are self-contained; `page.tsx` orchestrates the split-screen layout.
- The app uses no database or external state — everything is ephemeral per session.
