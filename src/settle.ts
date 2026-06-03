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
