# MILKYWAY_FACILITATOR.md
## Self-Hosted x402 Facilitator
### For Claude Code

**Repo:** `milkyway-facilitator` — separate GitHub repo, separate Railway deployment.
**Domain:** `facilitator.usemilkyway.com`

This is infrastructure, not a feature. It lives in its own repo, deploys independently,
and is referenced by URL everywhere else. No Coinbase dependency. No signup. Full control.

---

## What The Facilitator Does

Two endpoints. That's the whole service.

```
POST /verify    Verify a payment signature — pure cryptography, no blockchain
                Instant. Returns: { isValid: true/false, invalidReason? }

POST /settle    Broadcast the payment on-chain
                Calls USDC.transferWithAuthorization() on the target chain
                Async — never blocks. Returns: 202 Accepted
```

---

## Multi-Chain Support

The facilitator works with ANY EVM chain that supports USDC and EIP-3009.
The chain is determined by the `network` field in the payment payload.

**Supported networks out of the box:**

```typescript
const NETWORKS: Record<string, NetworkConfig> = {
  // Mainnets
  "eip155:42161":  {
    name:    "Arbitrum One",
    rpc:     process.env.ARBITRUM_RPC!,
    usdc:    "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
  },
  "eip155:8453":   {
    name:    "Base",
    rpc:     process.env.BASE_RPC!,
    usdc:    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  },
  "eip155:1":      {
    name:    "Ethereum",
    rpc:     process.env.ETHEREUM_RPC!,
    usdc:    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
  },

  // Testnets
  "eip155:421614": {
    name:    "Arbitrum Sepolia",
    rpc:     process.env.ARBITRUM_SEPOLIA_RPC!,
    usdc:    "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"
  },
  "eip155:84532":  {
    name:    "Base Sepolia",
    rpc:     process.env.BASE_SEPOLIA_RPC!,
    usdc:    "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
  }
};
```

**To add a new chain:** add one entry to NETWORKS with its chain ID, RPC, and USDC address.
The facilitator handles the rest automatically.

**Active networks** are controlled by env vars. If an RPC URL is not set,
that network is skipped at startup.

---

## Separate Repo Structure

```
milkyway-facilitator/           ← standalone GitHub repo
├── package.json
├── tsconfig.json
├── Dockerfile
├── railway.json
├── .env.example
├── README.md
└── src/
    ├── index.ts                ← Express server, port 8080
    ├── networks.ts             ← multi-chain config
    ├── verify.ts               ← signature verification
    ├── settle.ts               ← on-chain settlement
    ├── middleware.ts           ← rate limiting, auth
    └── types.ts                ← shared types
```

---

## package.json

```json
{
  "name": "milkyway-facilitator",
  "version": "1.0.0",
  "description": "MilkyWay x402 payment facilitator — self-hosted, multi-chain",
  "scripts": {
    "dev":   "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "express":            "^4.18.0",
    "ethers":             "^6.0.0",
    "dotenv":             "^16.0.0",
    "express-rate-limit": "^7.0.0"
  },
  "devDependencies": {
    "typescript":    "^5.0.0",
    "@types/express": "^4.17.0",
    "@types/node":   "^20.0.0",
    "tsx":           "^4.0.0"
  }
}
```

---

## .env.example

```bash
# ── Facilitator Wallet ──────────────────────────────────────────
# This wallet pays gas for on-chain settlement
# Needs ETH on each chain you support (~$5 covers thousands of settlements)
# Does NOT need USDC — the payer's USDC moves directly to the agent
FACILITATOR_PRIVATE_KEY=0x...

# ── Arbitrum (primary — required) ──────────────────────────────
ARBITRUM_RPC=https://arb1.arbitrum.io/rpc
ARBITRUM_SEPOLIA_RPC=https://sepolia-rollup.arbitrum.io/rpc

# ── Other chains (optional — add as needed) ────────────────────
# BASE_RPC=https://mainnet.base.org
# BASE_SEPOLIA_RPC=https://sepolia.base.org
# ETHEREUM_RPC=https://eth.llamarpc.com

# ── Security ────────────────────────────────────────────────────
# Shared secret between facilitator and MilkyWay engine + agents
# Prevents public abuse of the facilitator (draining gas wallet)
FACILITATOR_SECRET=generate_a_long_random_string_here

# ── Server ──────────────────────────────────────────────────────
PORT=8080
NODE_ENV=development   # "production" for Railway
```

---

## src/types.ts

```typescript
export interface NetworkConfig {
  name: string;
  rpc:  string;
  usdc: string;
}

export interface PaymentAuthorization {
  from:        string;
  to:          string;
  value:       string;
  validAfter:  string;
  validBefore: string;
  nonce:       string;
}

export interface PaymentPayload {
  x402Version: number;
  scheme:      "exact";
  network:     string;
  payload: {
    signature:     string;
    authorization: PaymentAuthorization;
  };
}

export interface VerifyRequest {
  payment:  string;   // base64 encoded PaymentPayload
  resource: string;   // endpoint URL being paid for
  amount:   string;   // expected raw USDC units e.g. "1000000" = 1 USDC
  network:  string;   // e.g. "eip155:42161"
}

export interface VerifyResponse {
  isValid:        boolean;
  invalidReason?: string;
  payer?:         string;
  payee?:         string;
  amount?:        string;
}

export interface SettleRequest {
  payment: string;   // same base64 payload
  network: string;
}

export interface SettleResponse {
  success:  boolean;
  txHash?:  string;
  error?:   string;
}
```

---

## src/networks.ts

```typescript
import { NetworkConfig } from "./types";

// Build active network map from environment variables
// A network is active only if its RPC URL is configured
export function buildNetworkMap(): Record<string, NetworkConfig> {
  const ALL_NETWORKS: Record<string, Omit<NetworkConfig, "rpc"> & { rpcEnv: string }> = {
    "eip155:42161":  {
      name:    "Arbitrum One",
      rpcEnv:  "ARBITRUM_RPC",
      usdc:    "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
    },
    "eip155:421614": {
      name:    "Arbitrum Sepolia",
      rpcEnv:  "ARBITRUM_SEPOLIA_RPC",
      usdc:    "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"
    },
    "eip155:8453":   {
      name:    "Base",
      rpcEnv:  "BASE_RPC",
      usdc:    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    },
    "eip155:84532":  {
      name:    "Base Sepolia",
      rpcEnv:  "BASE_SEPOLIA_RPC",
      usdc:    "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    },
    "eip155:1":      {
      name:    "Ethereum Mainnet",
      rpcEnv:  "ETHEREUM_RPC",
      usdc:    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    }
  };

  const active: Record<string, NetworkConfig> = {};

  for (const [networkId, config] of Object.entries(ALL_NETWORKS)) {
    const rpc = process.env[config.rpcEnv];
    if (rpc) {
      active[networkId] = { name: config.name, rpc, usdc: config.usdc };
    }
  }

  return active;
}

export const NETWORKS = buildNetworkMap();

export function getNetwork(networkId: string): NetworkConfig | null {
  return NETWORKS[networkId] || null;
}

export function getSupportedNetworkIds(): string[] {
  return Object.keys(NETWORKS);
}
```

---

## src/verify.ts

```typescript
import { ethers }        from "ethers";
import { getNetwork }    from "./networks";
import {
  VerifyRequest,
  VerifyResponse,
  PaymentPayload
} from "./types";

// Track used nonces — prevents replay attacks
// In-memory: fine for single Railway instance
// Replace with Redis for multi-instance production
const usedNonces = new Set<string>();

const TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: "from",        type: "address" },
    { name: "to",          type: "address" },
    { name: "value",       type: "uint256" },
    { name: "validAfter",  type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce",       type: "bytes32" }
  ]
};

export function verifyPayment(req: VerifyRequest): VerifyResponse {
  try {
    // Decode base64 payload
    const payload: PaymentPayload = JSON.parse(
      Buffer.from(req.payment, "base64").toString("utf8")
    );

    // Protocol version check
    if (payload.x402Version !== 1) {
      return { isValid: false, invalidReason: "Unsupported x402 version" };
    }

    // Scheme check
    if (payload.scheme !== "exact") {
      return { isValid: false, invalidReason: "Unsupported scheme — only exact is supported" };
    }

    // Network must be supported
    const network = getNetwork(req.network);
    if (!network) {
      return {
        isValid:       false,
        invalidReason: `Unsupported network: ${req.network}`
      };
    }

    // Payload network must match request network
    if (payload.network !== req.network) {
      return {
        isValid:       false,
        invalidReason: `Network mismatch: header says ${payload.network}, request says ${req.network}`
      };
    }

    const { authorization, signature } = payload.payload;

    // Deadline check (validBefore)
    const now = Math.floor(Date.now() / 1000);
    if (now > Number(authorization.validBefore)) {
      return { isValid: false, invalidReason: "Payment authorization expired" };
    }

    // validAfter check
    if (now < Number(authorization.validAfter)) {
      return { isValid: false, invalidReason: "Payment not yet valid" };
    }

    // Amount check
    if (BigInt(authorization.value) < BigInt(req.amount)) {
      return {
        isValid:       false,
        invalidReason: `Insufficient amount: expected ${req.amount}, got ${authorization.value}`
      };
    }

    // Nonce replay check
    const nonceKey = `${authorization.from}:${req.network}:${authorization.nonce}`;
    if (usedNonces.has(nonceKey)) {
      return { isValid: false, invalidReason: "Nonce already used — replay attack detected" };
    }

    // EIP-712 signature verification
    // Domain uses the actual USDC contract address for this network
    const domain = {
      name:              "USD Coin",
      version:           "2",
      chainId:           Number(req.network.split(":")[1]),
      verifyingContract: network.usdc
    };

    const message = {
      from:        authorization.from,
      to:          authorization.to,
      value:       BigInt(authorization.value),
      validAfter:  BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce:       authorization.nonce
    };

    const recoveredAddress = ethers.verifyTypedData(
      domain,
      TRANSFER_TYPES,
      message,
      signature
    );

    if (recoveredAddress.toLowerCase() !== authorization.from.toLowerCase()) {
      return {
        isValid:       false,
        invalidReason: "Invalid signature"
      };
    }

    // Mark nonce as used — prevents replay
    usedNonces.add(nonceKey);

    return {
      isValid: true,
      payer:   authorization.from,
      payee:   authorization.to,
      amount:  authorization.value
    };

  } catch (err: any) {
    return {
      isValid:       false,
      invalidReason: `Verification error: ${err.message}`
    };
  }
}
```

---

## src/settle.ts

```typescript
import { ethers }     from "ethers";
import { getNetwork } from "./networks";
import {
  SettleRequest,
  SettleResponse,
  PaymentPayload
} from "./types";

const USDC_ABI = [
  `function transferWithAuthorization(
    address from,
    address to,
    uint256 value,
    uint256 validAfter,
    uint256 validBefore,
    bytes32 nonce,
    bytes calldata signature
  ) external`
];

// Cache providers per network — don't create new ones per request
const providers: Record<string, ethers.JsonRpcProvider> = {};
const signers:   Record<string, ethers.Wallet>           = {};

function getSigner(networkId: string): ethers.Wallet {
  if (signers[networkId]) return signers[networkId];

  const network = getNetwork(networkId);
  if (!network) throw new Error(`Unsupported network: ${networkId}`);

  if (!providers[networkId]) {
    providers[networkId] = new ethers.JsonRpcProvider(network.rpc);
  }

  signers[networkId] = new ethers.Wallet(
    process.env.FACILITATOR_PRIVATE_KEY!,
    providers[networkId]
  );

  return signers[networkId];
}

export async function settlePayment(req: SettleRequest): Promise<SettleResponse> {
  try {
    const payload: PaymentPayload = JSON.parse(
      Buffer.from(req.payment, "base64").toString("utf8")
    );

    const networkId = req.network || payload.network;
    const network   = getNetwork(networkId);

    if (!network) {
      return { success: false, error: `Unsupported network: ${networkId}` };
    }

    const { authorization, signature } = payload.payload;
    const signer = getSigner(networkId);
    const usdc   = new ethers.Contract(network.usdc, USDC_ABI, signer);

    const tx = await usdc.transferWithAuthorization(
      authorization.from,
      authorization.to,
      BigInt(authorization.value),
      BigInt(authorization.validAfter),
      BigInt(authorization.validBefore),
      authorization.nonce,
      signature
    );

    const receipt = await tx.wait();

    console.log(
      `[${network.name}] Settled: ${receipt.hash}` +
      ` — ${Number(authorization.value) / 1e6} USDC` +
      ` from ${authorization.from.slice(0,8)}...` +
      ` to ${authorization.to.slice(0,8)}...`
    );

    return { success: true, txHash: receipt.hash };

  } catch (err: any) {
    console.error("Settlement failed:", err.message);
    return { success: false, error: err.message };
  }
}
```

---

## src/middleware.ts

```typescript
import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";

export const rateLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max:      200,          // 200 requests per minute per IP
  message:  { error: "Rate limit exceeded" }
});

// Shared secret auth — prevents public abuse
export function authenticateFacilitator(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const secret = process.env.FACILITATOR_SECRET;

  // No secret set → open access (for local dev)
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.warn("WARNING: FACILITATOR_SECRET not set in production");
    }
    return next();
  }

  const provided = req.headers["x-facilitator-secret"] as string;
  if (!provided || provided !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}
```

---

## src/index.ts

```typescript
import express    from "express";
import dotenv     from "dotenv";
import { verifyPayment }  from "./verify";
import { settlePayment }  from "./settle";
import { rateLimiter, authenticateFacilitator } from "./middleware";
import {
  NETWORKS,
  getSupportedNetworkIds
} from "./networks";

dotenv.config();

const app  = express();
const PORT = Number(process.env.PORT) || 8080;

app.use(express.json());
app.use(rateLimiter);

// ── GET / ──────────────────────────────────────────────────────
// Returns supported payment kinds — x402 discovery endpoint
app.get("/", (_, res) => {
  res.json({
    name:    "MilkyWay x402 Facilitator",
    version: "1.0.0",
    supportedKinds: getSupportedNetworkIds().map(networkId => ({
      x402Version: 1,
      scheme:      "exact",
      network:     networkId,
      name:        NETWORKS[networkId].name,
      extra:       {}
    }))
  });
});

// ── GET /health ────────────────────────────────────────────────
app.get("/health", (_, res) => {
  res.json({
    status:   "ok",
    networks: getSupportedNetworkIds().map(id => ({
      id,
      name: NETWORKS[id].name
    })),
    version:  "1.0.0"
  });
});

// ── POST /verify ───────────────────────────────────────────────
app.post("/verify", authenticateFacilitator, (req, res) => {
  const { payment, resource, amount, network } = req.body;

  if (!payment || !amount || !network) {
    return res.status(400).json({
      isValid:       false,
      invalidReason: "Missing required fields: payment, amount, network"
    });
  }

  const result = verifyPayment({ payment, resource, amount, network });
  res.json(result);
});

// ── POST /settle ───────────────────────────────────────────────
app.post("/settle", authenticateFacilitator, async (req, res) => {
  const { payment, network } = req.body;

  if (!payment || !network) {
    return res.status(400).json({
      success: false,
      error:   "Missing required fields: payment, network"
    });
  }

  // Return 202 immediately — settlement is fire-and-forget
  res.status(202).json({ success: true, message: "Settlement queued" });

  // Settle async in background
  settlePayment({ payment, network })
    .then(result => {
      if (!result.success) {
        console.error(`Settlement failed: ${result.error}`);
      }
    })
    .catch(console.error);
});

// ── Start ──────────────────────────────────────────────────────
const activeNetworks = getSupportedNetworkIds();

if (activeNetworks.length === 0) {
  console.error("ERROR: No networks configured. Set at least ARBITRUM_RPC or ARBITRUM_SEPOLIA_RPC.");
  process.exit(1);
}

if (!process.env.FACILITATOR_PRIVATE_KEY) {
  console.error("ERROR: FACILITATOR_PRIVATE_KEY not set.");
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`\n✓ MilkyWay x402 Facilitator — facilitator.usemilkyway.com`);
  console.log(`  Port:    ${PORT}`);
  console.log(`  Auth:    ${process.env.FACILITATOR_SECRET ? "enabled" : "OPEN (set FACILITATOR_SECRET)"}`);
  console.log(`  Networks:`);
  activeNetworks.forEach(id => {
    console.log(`    ${id.padEnd(16)}  ${NETWORKS[id].name}`);
  });
  console.log();
});
```

---

## Dockerfile

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN npm run build
EXPOSE 8080
CMD ["npm", "start"]
```

---

## railway.json

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE"
  },
  "deploy": {
    "startCommand":          "npm start",
    "healthcheckPath":       "/health",
    "restartPolicyType":     "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

---

## Railway Environment Variables

Set these in Railway dashboard → Variables:

```
# Required
FACILITATOR_PRIVATE_KEY     0x...
FACILITATOR_SECRET          long_random_string

# Arbitrum (add both — same service handles mainnet + testnet)
ARBITRUM_RPC                https://arb1.arbitrum.io/rpc
ARBITRUM_SEPOLIA_RPC        https://sepolia-rollup.arbitrum.io/rpc

# Optional — add when you want to support other chains
# BASE_RPC                  https://mainnet.base.org
# BASE_SEPOLIA_RPC          https://sepolia.base.org

NODE_ENV                    production
PORT                        8080
```

Custom domain: `facilitator.usemilkyway.com`
Set in Railway → Settings → Domains.

---

## Fund The Facilitator Wallet

The facilitator wallet pays gas. It needs ETH on every chain it supports.

```
Arbitrum Sepolia (testnet):
  Get free ETH from arbitrum.faucet.dev
  ~0.001 ETH covers hundreds of test settlements

Arbitrum One (mainnet):
  Send ~$5 of ETH to the wallet address on Arbitrum One
  Each settlement costs ~$0.001
  $5 covers ~5,000 settlements
```

Never send USDC to the facilitator wallet. It doesn't need it.

---

## Update All .env Files In The Main Repo

### services/.env

```bash
# Remove CDP variables entirely
# Replace with:
X402_FACILITATOR_URL=https://facilitator.usemilkyway.com
FACILITATOR_SECRET=same_secret_as_facilitator_env
```

### Agent .env.example (in create-milkyway-agent template)

```bash
# x402 payment verification — MilkyWay's facilitator
X402_FACILITATOR_URL=https://facilitator.usemilkyway.com
FACILITATOR_SECRET=get_from_your_milkyway_dashboard
```

---

## Update packages/agent-sdk/src/verify.ts

```typescript
export async function verifyPayment(
  paymentHeader: string,
  resource:      string,
  amountUsdc:    string,
  network:       string = "eip155:421614"  // default Sepolia for dev
): Promise<void> {
  const facilitatorUrl = process.env.X402_FACILITATOR_URL
    || "https://facilitator.usemilkyway.com";

  const rawAmount = String(
    Math.round(parseFloat(amountUsdc) * 1_000_000)
  );

  const res = await fetch(`${facilitatorUrl}/verify`, {
    method:  "POST",
    headers: {
      "Content-Type":          "application/json",
      "X-Facilitator-Secret":  process.env.FACILITATOR_SECRET || ""
    },
    body: JSON.stringify({
      payment:  paymentHeader,
      resource,
      amount:   rawAmount,
      network
    })
  });

  if (!res.ok) {
    throw new PaymentError(`Facilitator unreachable: HTTP ${res.status}`);
  }

  const result = await res.json();

  if (!result.isValid) {
    throw new PaymentError(result.invalidReason || "Payment invalid");
  }
}
```

---

## Testing Against Arbitrum Sepolia

For local development and testing, the facilitator handles Sepolia automatically:

```bash
# In your agent .env:
X402_FACILITATOR_URL=http://localhost:8080   # local facilitator

# In facilitator .env:
ARBITRUM_SEPOLIA_RPC=https://sepolia-rollup.arbitrum.io/rpc
FACILITATOR_PRIVATE_KEY=0x...   # funded with Sepolia ETH from faucet

# The network in payment payloads:
"network": "eip155:421614"      # Arbitrum Sepolia chain ID
```

Get Sepolia USDC from `faucet.circle.com` (select Arbitrum Sepolia).
Get Sepolia ETH from `arbitrum.faucet.dev` for the facilitator wallet gas.

---

## Deployment Steps

```bash
# 1. Create repo on GitHub
#    github.com/new → name: milkyway-facilitator

# 2. Clone and build
git clone https://github.com/yourname/milkyway-facilitator
cd milkyway-facilitator
# copy all files from this spec
npm install && npm run build

# 3. Verify locally
npm run dev
curl http://localhost:8080/health
curl http://localhost:8080/

# 4. Push to GitHub
git add . && git commit -m "initial"
git push

# 5. Deploy on Railway
#    railway.app → New Project → Deploy from GitHub → milkyway-facilitator
#    Add all environment variables
#    Railway builds and deploys automatically

# 6. Set custom domain
#    Railway → Settings → Domains → facilitator.usemilkyway.com

# 7. Verify live
curl https://facilitator.usemilkyway.com/health

# 8. Update main repo .env
X402_FACILITATOR_URL=https://facilitator.usemilkyway.com
```

---

## README.md

```markdown
# MilkyWay x402 Facilitator

Self-hosted x402 payment facilitator for the MilkyWay agent marketplace.
Deployed at: `facilitator.usemilkyway.com`

## What It Does

Verifies and settles x402 USDC micropayments on EVM chains.

POST /verify   — verify a payment signature (instant, no blockchain)
POST /settle   — settle payment on-chain (async)
GET  /         — discover supported networks
GET  /health   — health check

## Supported Chains

- Arbitrum One (eip155:42161)
- Arbitrum Sepolia (eip155:421614)
- Base (eip155:8453) — optional
- Base Sepolia (eip155:84532) — optional
- Ethereum (eip155:1) — optional

## Add A New Chain

Add to NETWORKS in src/networks.ts:
{ name, rpc, usdc }

Set RPC URL in .env.
Restart. Done.

## Deploy

See MILKYWAY_FACILITATOR.md for full deployment guide.
```

---

## Build Order for Claude Code

```
1.  Write src/types.ts
2.  Write src/networks.ts
3.  Write src/verify.ts
4.  Write src/settle.ts
5.  Write src/middleware.ts
6.  Write src/index.ts
7.  Write package.json
8.  Write tsconfig.json
9.  Write Dockerfile
10. Write railway.json
11. Write .env.example
12. Write README.md
13. npm install && npm run build (must succeed)

14. Test locally:
    npm run dev
    curl http://localhost:8080/health
    curl http://localhost:8080/
    → should list Arbitrum Sepolia if ARBITRUM_SEPOLIA_RPC is set

15. Test verify with a well-formed payload
16. Deploy to Railway
17. Set custom domain: facilitator.usemilkyway.com
18. Update main repo: X402_FACILITATOR_URL=https://facilitator.usemilkyway.com
19. Update agent-sdk/src/verify.ts to point to MilkyWay facilitator
20. Remove all CDP references from all files
```

---

## Common Mistakes — Never Make These

- **The facilitator wallet needs ETH not USDC.**
  It pays gas. USDC moves between payer and agent directly.
- **FACILITATOR_SECRET must be set in production.**
  Without it your gas wallet gets drained by random callers.
  Same secret must be in the main repo services/.env.
- **Nonce key includes the network ID.**
  `from:network:nonce` — not just `from:nonce`.
  Same nonce on different chains is a different payment.
- **Providers are cached per network.**
  Don't create a new JsonRpcProvider on every request.
  The getSigner() cache handles this.
- **Settle returns 202 immediately.**
  Never await settlement before responding.
  The response is already served — settlement is background work.
- **If no networks are configured the server exits.**
  This is intentional — a facilitator with no chains is useless.
- **Never log FACILITATOR_PRIVATE_KEY.**
  Log the wallet address only. Check every console.log.
- **Railway free tier sleeps after inactivity.**
  Upgrade to a paid plan ($5/month) before mainnet launch.
  A sleeping facilitator means failed payments.

---

*MilkyWay x402 Facilitator*
*Separate repo. Separate deploy. Own your infrastructure.*
*facilitator.usemilkyway.com*
