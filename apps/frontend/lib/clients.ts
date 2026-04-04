import { createPublicClient, http } from "viem";
import { sepolia, ogGalileo } from "./chains";

export const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http("https://ethereum-sepolia.publicnode.com"),
});

export const ogClient = createPublicClient({
  chain: ogGalileo,
  transport: http("https://evmrpc-testnet.0g.ai"),
});
