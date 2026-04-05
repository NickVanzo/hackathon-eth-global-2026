/**
 * submit-intent.mjs — Submit a trading intent to AgentManager on-chain.
 *
 * Usage:
 *   node skills/submit-intent/submit-intent.mjs <actionType> [paramsJson]
 *
 * actionType:
 *   0 = OPEN   — open a new LP position
 *   1 = CLOSE  — close the current position
 *   2 = MODIFY — rebalance / adjust the position
 *
 * paramsJson (required for OPEN and MODIFY, ignored for CLOSE):
 *   { "amountUSDC": "100", "tickLower": -887272, "tickUpper": 887272 }
 *
 * Environment:
 *   AGENT_PRIVATE_KEY  — wallet private key (required)
 */

import { ethers } from "ethers";
import { CONFIG, AGENT_MANAGER_ABI } from "../lib/config.mjs";
import { getWallet, getAgentId } from "../lib/wallet.mjs";

// ---------------------------------------------------------------------------
// Action type constants
// ---------------------------------------------------------------------------

const ACTION_OPEN   = 0;
const ACTION_CLOSE  = 1;
const ACTION_MODIFY = 2;
const ACTION_NAMES  = { 0: "OPEN", 1: "CLOSE", 2: "MODIFY" };

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const rawActionType = process.argv[2];
const rawParams     = process.argv[3] ?? "{}";

if (rawActionType === undefined) {
  console.error("Usage: node submit-intent.mjs <actionType> [paramsJson]");
  console.error("  actionType: 0=OPEN, 1=CLOSE, 2=MODIFY");
  process.exit(1);
}

const actionType = parseInt(rawActionType, 10);
if (![ACTION_OPEN, ACTION_CLOSE, ACTION_MODIFY].includes(actionType)) {
  console.error(`Error: actionType must be 0, 1, or 2 (got "${rawActionType}")`);
  process.exit(1);
}

let params;
try {
  params = JSON.parse(rawParams);
} catch {
  console.error(`Error: paramsJson is not valid JSON — ${rawParams}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// ABI-encode intent payload
// ---------------------------------------------------------------------------

/**
 * Build the intentData bytes passed to submitIntent.
 *
 * Layout (ABI-encoded):
 *   CLOSE  → 0x  (empty bytes — no position params needed)
 *   OPEN / MODIFY → abi.encode(uint8 actionType, uint256 amountUSDC6, int24 tickLower, int24 tickUpper)
 */
function buildIntentData(actionType, params) {
  if (actionType === ACTION_CLOSE) {
    return "0x";
  }

  const { amountUSDC, tickLower, tickUpper } = params;

  if (amountUSDC === undefined || tickLower === undefined || tickUpper === undefined) {
    console.error(
      `Error: OPEN and MODIFY require amountUSDC, tickLower, tickUpper in paramsJson.\n` +
      `Example: '{"amountUSDC":"100","tickLower":-887272,"tickUpper":887272}'`
    );
    process.exit(1);
  }

  const amountUSDC6 = ethers.parseUnits(String(amountUSDC), 6);
  const tickLowerInt = parseInt(tickLower, 10);
  const tickUpperInt = parseInt(tickUpper, 10);

  if (isNaN(tickLowerInt) || isNaN(tickUpperInt)) {
    console.error("Error: tickLower and tickUpper must be integers");
    process.exit(1);
  }

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(
    ["uint8", "uint256", "int24", "int24"],
    [actionType, amountUSDC6, tickLowerInt, tickUpperInt]
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  // --- Wallet ---
  let wallet, address;
  try {
    ({ wallet, address } = getWallet());
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  console.log(`Wallet address : ${address}`);

  // --- Agent ID ---
  const agentId = await getAgentId(address);
  if (agentId === 0) {
    console.error(
      "Error: wallet is not registered as an agent.\n" +
      "Run register-agent.mjs first."
    );
    process.exit(1);
  }

  console.log(`Agent ID       : ${agentId}`);
  console.log(`Action type    : ${actionType} (${ACTION_NAMES[actionType]})`);

  // --- Build intent payload ---
  const intentData = buildIntentData(actionType, params);
  console.log(`Intent data    : ${intentData}`);

  // --- Submit ---
  const agentManager = new ethers.Contract(
    CONFIG.AGENT_MANAGER_ADDRESS,
    AGENT_MANAGER_ABI,
    wallet
  );

  let tx;
  try {
    tx = await agentManager.submitIntent(agentId, intentData);
  } catch (err) {
    console.error(`Error submitting intent: ${err.message}`);
    process.exit(1);
  }

  console.log(`Tx hash        : ${tx.hash}`);
  console.log("Waiting for confirmation…");

  const receipt = await tx.wait();
  console.log(
    `Confirmed in block ${receipt.blockNumber} (status: ${receipt.status === 1 ? "success" : "reverted"})`
  );

  if (receipt.status !== 1) {
    console.error("Transaction reverted on-chain.");
    process.exit(1);
  }

  console.log("Intent submitted successfully.");
})();
