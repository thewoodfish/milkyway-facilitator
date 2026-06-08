import express    from "express";
import dotenv     from "dotenv";
import { verifyPayment }  from "./verify";
import { settlePayment }  from "./settle";
import { rateLimiter, authenticateFacilitator, checkAddressRateLimit } from "./middleware";
import {
  NETWORKS,
  getSupportedNetworkIds
} from "./networks";

dotenv.config();

const app  = express();
const PORT = Number(process.env.PORT) || 8080;

app.use(express.json());
app.use(rateLimiter);

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

app.post("/settle", authenticateFacilitator, async (req, res) => {
  const { payment, network } = req.body;

  if (!payment || !network) {
    return res.status(400).json({
      success: false,
      error:   "Missing required fields: payment, network"
    });
  }

  // Per-address rate limit — parsed here so we can reject before queuing
  try {
    const payload = JSON.parse(Buffer.from(payment, "base64").toString("utf8"));
    const from    = payload?.payload?.authorization?.from;
    if (from && !checkAddressRateLimit(from)) {
      return res.status(429).json({ success: false, error: "Settlement rate limit exceeded for this address" });
    }
  } catch {
    // Malformed payload — let settlePayment surface the error
  }

  res.status(202).json({ success: true, message: "Settlement queued" });

  settlePayment({ payment, network })
    .then(result => {
      if (!result.success) {
        console.error(`Settlement failed: ${result.error}`);
      }
    })
    .catch(console.error);
});

const activeNetworks = getSupportedNetworkIds();

if (activeNetworks.length === 0) {
  console.error("ERROR: No networks configured. Set at least ARBITRUM_RPC, BASE_RPC, or ETHEREUM_RPC.");
  process.exit(1);
}

if (!process.env.FACILITATOR_PRIVATE_KEY) {
  console.error("ERROR: FACILITATOR_PRIVATE_KEY not set.");
  process.exit(1);
}

if (!process.env.FACILITATOR_SECRET && process.env.NODE_ENV === "production") {
  console.error("ERROR: FACILITATOR_SECRET must be set in production.");
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
