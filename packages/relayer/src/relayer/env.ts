import "dotenv/config";

// ---------------------------------------------------------------------------
// Contract addresses — default to deployed hackathon addresses from .env
// ---------------------------------------------------------------------------

export const SATELLITE_ADDRESS =
  (process.env.SATELLITE_ADDRESS as `0x${string}`) ||
  "0xc4ac79312fe204f5ddb2e312dd7749d519190624";

export const VAULT_ADDRESS =
  (process.env.VAULT_ADDRESS as `0x${string}`) ||
  "0x34df20c3f8b16f35e7e86eaad55c0471e8ef0eec";

export const AGENT_MANAGER_ADDRESS =
  (process.env.AGENT_MANAGER_ADDRESS as `0x${string}`) ||
  "0x58eb63577f409bb638628abe8e55f0553032e8dc";

// ---------------------------------------------------------------------------
// Token addresses (Sepolia)
// ---------------------------------------------------------------------------

export const DEPOSIT_TOKEN_ADDRESS =
  (process.env.USDC_E_ADDRESS as `0x${string}`) ||
  "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

export const WETH_ADDRESS =
  (process.env.WETH_ADDRESS as `0x${string}`) ||
  "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";

// ---------------------------------------------------------------------------
// RPC URLs
// ---------------------------------------------------------------------------

export const SEPOLIA_RPC_URL =
  process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia.publicnode.com";

export const ZG_RPC_URL =
  process.env.ZG_RPC_URL || "https://evmrpc-testnet.0g.ai";

// ---------------------------------------------------------------------------
// Relayer private key (set via PRIVATE_KEY_RELAYER in .env)
// ---------------------------------------------------------------------------

export const RELAYER_PRIVATE_KEY =
  (process.env.PRIVATE_KEY_RELAYER as `0x${string}`) || "0x";

// ---------------------------------------------------------------------------
// Uniswap Trading API
// ---------------------------------------------------------------------------

export const UNISWAP_API_KEY = process.env.UNISWAP_API_KEY || "";
export const UNISWAP_API_URL = "https://trade-api.gateway.uniswap.org/v1";

// ---------------------------------------------------------------------------
// Chain IDs
// ---------------------------------------------------------------------------

export const SEPOLIA_CHAIN_ID = 11155111;
export const ZG_CHAIN_ID = 16602;

// ---------------------------------------------------------------------------
// ForceCloseSource enum (mirrors IShared.ForceCloseSource)
// ---------------------------------------------------------------------------

export const ForceCloseSource = {
  PROVING: 0,
  VAULT: 1,
  ALL: 2,
} as const;

export type ForceCloseSourceValue = (typeof ForceCloseSource)[keyof typeof ForceCloseSource];

// ---------------------------------------------------------------------------
// ActionType enum (mirrors IShared.ActionType)
// ---------------------------------------------------------------------------

export const ActionType = {
  OPEN_POSITION: 0,
  CLOSE_POSITION: 1,
  MODIFY_POSITION: 2,
} as const;
