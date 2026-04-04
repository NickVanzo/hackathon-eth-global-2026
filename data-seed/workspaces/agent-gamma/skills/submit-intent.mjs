import { ethers } from "ethers";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load .env from workspace root
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../.env") });

const {
  AGENT_ID,
  VAULT_ADDRESS,
  PRIVATE_KEY_ENV_VAR,
  ZG_RPC_URL = "https://evmrpc-testnet.0g.ai",
} = process.env;

const privateKey = process.env[PRIVATE_KEY_ENV_VAR];
if (!privateKey) throw new Error(`${PRIVATE_KEY_ENV_VAR} is not set`);

const VAULT_ABI = [
  "function submitIntent(string agentId, string actionType, bytes params) external returns (uint256 intentId)",
];

const provider = new ethers.JsonRpcProvider(ZG_RPC_URL);
const wallet = new ethers.Wallet(privateKey, provider);
const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, wallet);

const actionType = process.argv[2];
const paramsJson = process.argv[3] || "{}";
const paramsBytes = ethers.toUtf8Bytes(paramsJson);

const tx = await vault.submitIntent(AGENT_ID, actionType, paramsBytes);
console.log(`submitted: ${tx.hash}`);
await tx.wait(1);
console.log(`confirmed: ${tx.hash}`);
