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
    const payload: PaymentPayload = JSON.parse(
      Buffer.from(req.payment, "base64").toString("utf8")
    );

    if (payload.x402Version !== 1) {
      return { isValid: false, invalidReason: "Unsupported x402 version" };
    }

    if (payload.scheme !== "exact") {
      return { isValid: false, invalidReason: "Unsupported scheme — only exact is supported" };
    }

    const network = getNetwork(req.network);
    if (!network) {
      return {
        isValid:       false,
        invalidReason: `Unsupported network: ${req.network}`
      };
    }

    if (payload.network !== req.network) {
      return {
        isValid:       false,
        invalidReason: `Network mismatch: header says ${payload.network}, request says ${req.network}`
      };
    }

    const { authorization, signature } = payload.payload;

    const now = Math.floor(Date.now() / 1000);
    if (now > Number(authorization.validBefore)) {
      return { isValid: false, invalidReason: "Payment authorization expired" };
    }

    if (now < Number(authorization.validAfter)) {
      return { isValid: false, invalidReason: "Payment not yet valid" };
    }

    if (BigInt(authorization.value) < BigInt(req.amount)) {
      return {
        isValid:       false,
        invalidReason: `Insufficient amount: expected ${req.amount}, got ${authorization.value}`
      };
    }

    // Nonce key includes network ID — same nonce on different chains is a different payment
    const nonceKey = `${authorization.from}:${req.network}:${authorization.nonce}`;
    if (usedNonces.has(nonceKey)) {
      return { isValid: false, invalidReason: "Nonce already used — replay attack detected" };
    }

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
