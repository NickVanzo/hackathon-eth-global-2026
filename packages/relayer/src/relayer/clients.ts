import { createPublicClient, createWalletClient, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  SEPOLIA_RPC_URL,
  ZG_RPC_URL,
  RELAYER_PRIVATE_KEY,
  SEPOLIA_CHAIN_ID,
  ZG_CHAIN_ID,
} from "./env";

// ---------------------------------------------------------------------------
// Chain definitions
// ---------------------------------------------------------------------------

const sepolia: Chain = {
  id: SEPOLIA_CHAIN_ID,
  name: "Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [SEPOLIA_RPC_URL] },
    public: { http: [SEPOLIA_RPC_URL] },
  },
};

const zgTestnet: Chain = {
  id: ZG_CHAIN_ID,
  name: "0G Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: {
    default: { http: [ZG_RPC_URL] },
    public: { http: [ZG_RPC_URL] },
  },
};

// ---------------------------------------------------------------------------
// Relayer account (singleton — private key loaded once from env)
// ---------------------------------------------------------------------------

export const relayerAccount = privateKeyToAccount(RELAYER_PRIVATE_KEY);

// ---------------------------------------------------------------------------
// Public clients (read-only, no signing)
// ---------------------------------------------------------------------------

export const sepoliaPublicClient = createPublicClient({
  chain: sepolia,
  transport: http(),
});

export const zgPublicClient = createPublicClient({
  chain: zgTestnet,
  transport: http(),
});

// ---------------------------------------------------------------------------
// Wallet clients (signing + broadcasting)
// ---------------------------------------------------------------------------

export const sepoliaWalletClient = createWalletClient({
  account: relayerAccount,
  chain: sepolia,
  transport: http(),
});

export const zgWalletClient = createWalletClient({
  account: relayerAccount,
  chain: zgTestnet,
  transport: http(),
});

// ---------------------------------------------------------------------------
// Shared helper: send a contract write and wait for receipt
// ---------------------------------------------------------------------------

export async function sendAndConfirm(
  client: typeof sepoliaWalletClient | typeof zgWalletClient,
  publicClient: typeof sepoliaPublicClient | typeof zgPublicClient,
  request: Parameters<typeof client.writeContract>[0]
): Promise<`0x${string}`> {
  const hash = await client.writeContract(request as any);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
