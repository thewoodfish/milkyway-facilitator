import dotenv          from "dotenv";
import { NetworkConfig } from "./types";

dotenv.config();

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
