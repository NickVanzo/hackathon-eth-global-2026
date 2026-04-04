import { createPublicClient, http, formatUnits } from "viem";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env manually
const env = Object.fromEntries(
  readFileSync(resolve(import.meta.dirname, "../.env"), "utf8")
    .split("\n")
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => { const [k, ...v] = l.split("="); return [k.trim(), v.join("=").trim().replace(/^"|"$/g, "")]; })
);

const zg = {
  id: 16602, name: "0G Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: [env.ZG_RPC_URL || "https://evmrpc-testnet.0g.ai"] } },
};
const client = createPublicClient({ chain: zg, transport: http() });

const [mb, db] = await Promise.all([
  client.getBalance({ address: "0x71a376c2E8F8201d843b4BAD0f7Dd18b8A13213E" }),
  client.getBalance({ address: "0x9F36F2581A4f5773cE1B7E25Bc2F83b1b3cFAC06" }),
]);
console.log("0G Messenger:", formatUnits(mb, 18), "0G  (needed for relaying to 0G)");
console.log("0G Deployer: ", formatUnits(db, 18), "0G");
console.log(mb === 0n ? "\n⚠ MESSENGER HAS NO 0G GAS — relay txs to 0G will fail\n  Fund: https://faucet.0g.ai/" : "\n✓ Messenger has 0G gas");
