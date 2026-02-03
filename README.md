# x402 + KYA Demo

**Demonstrating AI Agent Commerce with Cryptographic Identity and Micropayments**

This demo showcases how [KYA (Know Your Agent)](https://beltic.dev) and [x402](https://x402.org) work together to enable secure, trust-based AI agent commerce.

## What This Demo Shows

| Protocol | Question Answered |
|----------|-------------------|
| **x402** | "Can this agent pay?" |
| **KYA**  | "Who is this agent?", "Is it safe?", "Who built it?" |

Together, they enable:
- **Trust-based pricing**: Verified agents with higher KYB tiers and better safety scores get discounts
- **Tiered access**: Premium features require higher trust levels
- **Cryptographic identity**: Every request is signed and verifiable

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           DEMO ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────┐                    ┌──────────────────────────┐  │
│  │   DEMO AGENT     │                    │    DEMO PLATFORM         │  │
│  │   (Client)       │                    │    (Server)              │  │
│  │                  │                    │                          │  │
│  │  • KYA Credential│   HTTP Request     │  • KYA Verification      │  │
│  │  • HTTP Signing  │ ───────────────►   │  • x402 Middleware       │  │
│  │  • x402 Payment  │   + Signature      │  • Trust-Based Pricing   │  │
│  │                  │   + Payment        │  • Tiered Access         │  │
│  └──────────────────┘                    └──────────────────────────┘  │
│         │                                           │                   │
│         │ Serves public key                         │ Fetches key      │
│         ▼                                           │                   │
│  ┌──────────────────┐                               │                   │
│  │  KEY SERVER      │◄──────────────────────────────┘                   │
│  │  (localhost:3001)│                                                   │
│  │                  │                                                   │
│  │  /.well-known/   │                                                   │
│  │  http-message-   │                                                   │
│  │  signatures-     │                                                   │
│  │  directory       │                                                   │
│  └──────────────────┘                                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm

### 1. Install Dependencies

```bash
# Install platform dependencies
cd platform
pnpm install

# Install agent dependencies
cd ../agent
pnpm install
```

### 2. Generate Agent Keys & Credentials

```bash
cd agent
pnpm run keygen
```

This creates:
- `.beltic/` - Ed25519 keypair (PEM format)
- `agent-credential.jwt` - W3C Verifiable Credential (self-attested)
- `.beltic.yaml` - Agent configuration

### 3. Start the Services

**Terminal 1: Start the key server**
```bash
cd agent
pnpm run serve-keys
# Runs on http://localhost:3001
```

**Terminal 2: Start the platform**
```bash
cd platform
pnpm dev
# Runs on http://localhost:3000
```

**Terminal 3: Run the demo agent**
```bash
cd agent
pnpm start
```

## API Endpoints

### Platform (http://localhost:3000)

| Endpoint | Auth | Price | Description |
|----------|------|-------|-------------|
| `GET /` | None | Free | API info |
| `GET /health` | None | Free | Health check |
| `GET /pricing` | Optional KYA | Free | See your trust-based pricing |
| `GET /free/weather` | None | Free | Basic weather data |
| `GET /standard/weather` | KYA | $0.01* | Full weather data |
| `GET /premium/weather` | KYA tier_2+ | $0.10* | Weather + forecasts + alerts |

*Price varies based on agent's trust level (KYB tier + safety scores)

### Agent Key Server (http://localhost:3001)

| Endpoint | Description |
|----------|-------------|
| `GET /` | Server info |
| `GET /.well-known/http-message-signatures-directory` | JWKS containing agent's public key |
| `GET /jwks.json` | Alias for key directory |

## Trust-Based Pricing

Agents receive discounts based on their verified attributes:

### KYB Tier Discounts

| Tier | Discount | Description |
|------|----------|-------------|
| tier_0 | 0% | Unverified |
| tier_1 | 10% | Basic verification |
| tier_2 | 20% | Standard verification |
| tier_3 | 40% | Enhanced verification |
| tier_4 | 60% | Full verification |

### Safety Score Bonuses

| Average Score | Additional Discount |
|---------------|---------------------|
| 95+ | 30% |
| 90-94 | 20% |
| 80-89 | 10% |

### Verification Level Bonuses

| Level | Additional Discount |
|-------|---------------------|
| beltic_verified | 10% |
| third_party_verified | 15% |

## KYA Credential Format (W3C VC)

The agent credential follows the [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/) and the [Beltic Agent Credential v2 schema](https://schema.beltic.com/agent/v2):

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://schema.beltic.com/v2"
  ],
  "type": ["VerifiableCredential", "AgentCredential"],
  "id": "urn:uuid:...",
  "issuer": "did:web:...",
  "validFrom": "2025-01-19T...",
  "validUntil": "2026-01-19T...",
  "credentialSubject": {
    "id": "did:web:...",
    "agentId": "demo-agent-001",
    "agentName": "Demo Weather Agent",
    "kybTierRequired": "tier_2",
    "harmfulContentRefusalScore": 92,
    "promptInjectionRobustnessScore": 88,
    "piiLeakageRobustnessScore": 95,
    "toolAbuseRobustnessScore": 90,
    // ... more fields
  }
}
```

## HTTP Message Signatures (RFC 9421)

Every authenticated request includes:

```http
GET /standard/weather HTTP/1.1
Host: localhost:3000
Signature-Input: sig1=("@method" "@authority" "@path");created=1737333600;expires=1737333660;keyid="http://localhost:3001/.well-known/http-message-signatures-directory#<thumbprint>";alg="ed25519"
Signature: sig1=:<base64-signature>:
Signature-Agent: http://localhost:3001/.well-known/http-message-signatures-directory
X-Beltic-Credentials: <agent-credential-jwt>
```

## x402 Payment Flow

When payment is required, the platform returns:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "error": "Payment Required",
  "x402": {
    "version": "2",
    "accepts": [{
      "scheme": "exact",
      "network": "eip155:84532",
      "price": "$0.0080",
      "payTo": "0x...",
      "asset": "USDC"
    }]
  }
}
```

The agent then:
1. Signs a payment with their wallet
2. Retries the request with `X-PAYMENT` header
3. Receives the data

## Configuration

### Platform (.env)

```bash
PORT=3000
WALLET_ADDRESS=0x...           # Receives payments
DEMO_MODE=true                 # Accept self-attested credentials
NETWORK=eip155:84532           # Base Sepolia (testnet)
```

### Agent (.env)

```bash
PLATFORM_URL=http://localhost:3000
KEY_SERVER_PORT=3001
WALLET_PRIVATE_KEY=0x...       # For x402 payments
AGENT_ID=demo-agent-001
AGENT_NAME=Demo Weather Agent
DEVELOPER_KYB_TIER=tier_2
```

### Web App (.env)

The web app at `web/` supports real USDC payments on Base Sepolia:

```bash
# OpenRouter API Key (for AI chat)
OPENROUTER_API_KEY=sk-or-...

# Agent Wallet Private Key (the payer - AI agent's wallet)
# Generate with: node -e "console.log('0x' + require('crypto').randomBytes(32).toString('hex'))"
AGENT_PRIVATE_KEY=0x...

# Recipient Wallet Address (platform owner - receives payments)
RECIPIENT_WALLET_ADDRESS=0x...

# Optional: Custom RPC URL for Base Sepolia
# BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
```

To set up real payments:
1. Generate or export a private key for the agent wallet
2. Fund the agent wallet with testnet ETH (for gas) from [Coinbase Faucet](https://faucet.coinbase.com/)
3. Get testnet USDC from [Circle Faucet](https://faucet.circle.com/)
4. Set the `RECIPIENT_WALLET_ADDRESS` to receive payments
5. Run `cd web && pnpm dev` to start the app

## Real x402 Payments

To enable real payments on Base Sepolia testnet:

1. Generate a wallet:
   ```bash
   node -e "console.log('0x' + require('crypto').randomBytes(32).toString('hex'))"
   ```

2. Get testnet USDC from [Circle Faucet](https://faucet.circle.com/)

3. Add to agent `.env`:
   ```bash
   WALLET_PRIVATE_KEY=0x...
   ```

4. Add your address to platform `.env`:
   ```bash
   WALLET_ADDRESS=0x...
   ```

## Project Structure

```
x402-demo/
├── platform/                   # Server (Hono)
│   ├── src/
│   │   ├── index.ts           # Main server
│   │   ├── middleware/
│   │   │   └── kya.ts         # KYA verification
│   │   └── services/
│   │       └── weather.ts     # Mock weather API
│   └── package.json
│
├── agent/                      # Client
│   ├── src/
│   │   ├── index.ts           # Demo script
│   │   ├── client.ts          # HTTP client with KYA signing
│   │   ├── keygen.ts          # Key generation
│   │   └── key-server.ts      # Public key server
│   ├── .beltic/               # Generated keys
│   ├── agent-credential.jwt   # Generated credential
│   └── package.json
│
└── README.md
```

## Resources

- [Beltic Documentation](https://docs.beltic.dev)
- [x402 Documentation](https://x402.gitbook.io/x402)
- [W3C Verifiable Credentials](https://www.w3.org/TR/vc-data-model-2.0/)
- [RFC 9421 - HTTP Message Signatures](https://www.rfc-editor.org/rfc/rfc9421.html)

## License

MIT
