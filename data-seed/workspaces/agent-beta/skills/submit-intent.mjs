import { ethers } from "ethers";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load .env from workspace root
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../.env") });

const {
  AGENT_ID,
  PRIVATE_KEY_ENV_VAR,
  ZG_RPC_URL = "https://evmrpc-testnet.0g.ai",
} = process.env;

// AgentManager address — submitIntent lives on AgentManager, not Vault
const AGENT_MANAGER_ADDRESS = process.env.AGENT_MANAGER_ADDRESS ?? process.env.VAULT_ADDRESS;

const privateKey = process.env[PRIVATE_KEY_ENV_VAR];
if (!privateKey) throw new Error(`${PRIVATE_KEY_ENV_VAR} is not set`);

// Matches IAgentManager.submitIntent(uint256 agentId, uint8 actionType, bytes params)
// IShared.ActionType enum: 0=OPEN_POSITION, 1=CLOSE_POSITION, 2=MODIFY_POSITION
const AGENT_MANAGER_ABI = [
  "function submitIntent(uint256 agentId, uint8 actionType, bytes params) external",
];

const provider = new ethers.JsonRpcProvider(ZG_RPC_URL);
const wallet = new ethers.Wallet(privateKey, provider);
const agentManager = new ethers.Contract(AGENT_MANAGER_ADDRESS, AGENT_MANAGER_ABI, wallet);

// Args: <actionType:uint8> [paramsJson]
// actionType: 0=OPEN_POSITION, 1=CLOSE_POSITION, 2=MODIFY_POSITION
const actionType = parseInt(process.argv[2], 10);
if (isNaN(actionType) || actionType < 0 || actionType > 2) {
  throw new Error(`Invalid actionType: ${process.argv[2]} (expected 0, 1, or 2)`);
}

const paramsJson = process.argv[3] || "{}";
const parsed = JSON.parse(paramsJson);

// ABI-encode IntentParams for OPEN/MODIFY: (uint256 amountUSDC, int24 tickLower, int24 tickUpper)
// For CLOSE: empty bytes
let paramsBytes;
if (actionType === 1) {
  // CLOSE_POSITION — no params needed
  paramsBytes = "0x";
} else {
  // OPEN_POSITION or MODIFY_POSITION — encode IntentParams
  paramsBytes = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "int24", "int24"],
    [
      ethers.parseUnits(String(parsed.amountUSDC ?? 1000), 6), // USDC has 6 decimals
      parsed.tickLower,
      parsed.tickUpper,
    ]
  );
}

// AGENT_ID is a string like "agent-alpha" but the contract expects uint256.
// The agentId is assigned sequentially by the satellite at registration time.
// For now, extract numeric ID from env or use a mapping.
const agentIdNum = parseInt(process.env.AGENT_ID_NUM ?? "0", 10);

const tx = await agentManager.submitIntent(agentIdNum, actionType, paramsBytes);
console.log(`submitted: ${tx.hash}`);
await tx.wait(1);
console.log(`confirmed: ${tx.hash}`);
