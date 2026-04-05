/**
 * arena-loop.mjs — Autonomous trading loop for Agent Arena.
 *
 * Each iteration:
 *   1. Query MCP for pool state via queryPool()
 *   2. Call LLM (OpenClaw gateway preferred, 0G Compute direct as fallback)
 *   3. Parse JSON decision from LLM reply
 *   4. Submit intent on-chain if action != "hold"
 *   5. Sleep for intervalMs, repeat
 *
 * Usage:
 *   node skills/run-arena-agent/arena-loop.mjs [intervalMs] [gatewayUrl] [gatewayToken]
 *
 * Defaults:
 *   intervalMs   = 120000 (2 minutes)
 *   gatewayUrl   = http://127.0.0.1:3000
 *   gatewayToken = $OPENCLAW_GATEWAY_TOKEN
 *
 * Environment:
 *   AGENT_PRIVATE_KEY        — required; wallet private key
 *   OPENCLAW_GATEWAY_TOKEN   — preferred LLM path (OpenClaw injects AGENTS.md)
 *   OG_COMPUTE_API_KEY       — fallback LLM path (reads AGENTS.md from cwd)
 */

import { readFileSync, existsSync } from "fs";
import { ethers } from "ethers";
import { CONFIG, AGENT_MANAGER_ABI } from "../lib/config.mjs";
import { getWallet, getAgentId } from "../lib/wallet.mjs";
import { queryPool } from "./query-pool.mjs";

// ---------------------------------------------------------------------------
// Configuration from args / env
// ---------------------------------------------------------------------------

const INTERVAL_MS   = parseInt(process.argv[2] ?? "120000", 10);
const GATEWAY_URL   = process.argv[3] ?? "http://127.0.0.1:3000";
const GATEWAY_TOKEN = process.argv[4] ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? "";

const OG_COMPUTE_URL =
  "https://compute-network-6.integratenetwork.work/v1/proxy/chat/completions";
const OG_COMPUTE_API_KEY = process.env.OG_COMPUTE_API_KEY ?? "";

// ---------------------------------------------------------------------------
// Action type constants
// ---------------------------------------------------------------------------

const ACTION_MAP = { open: 0, close: 1, rebalance: 2 };

// ---------------------------------------------------------------------------
// LLM call
// ---------------------------------------------------------------------------

/**
 * Call the LLM with the current pool state.
 * Routing: OpenClaw gateway (preferred) → 0G Compute direct → error
 *
 * @param {object} poolState
 * @returns {Promise<string>} raw reply text from the LLM
 */
async function callLLM(poolState) {
  const userContent = JSON.stringify(poolState, null, 2);

  if (GATEWAY_TOKEN) {
    // OpenClaw gateway — injects AGENTS.md automatically as system context
    const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify({
        model: "openclaw/default",
        messages: [{ role: "user", content: userContent }],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenClaw gateway error ${res.status}: ${body}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  if (OG_COMPUTE_API_KEY) {
    // 0G Compute direct — read AGENTS.md from cwd as system prompt
    const agentsMd = readFileSync("AGENTS.md", "utf8");

    const res = await fetch(OG_COMPUTE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OG_COMPUTE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
        messages: [
          { role: "system", content: agentsMd },
          { role: "user", content: userContent },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`0G Compute error ${res.status}: ${body}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  throw new Error(
    "No OPENCLAW_GATEWAY_TOKEN or OG_COMPUTE_API_KEY set — cannot call LLM"
  );
}

// ---------------------------------------------------------------------------
// Decision parsing
// ---------------------------------------------------------------------------

/**
 * Extract a JSON trading decision from the LLM reply.
 * Strips <tool_call> tags, then tries to match a JSON object with an "action" field.
 *
 * @param {string} reply
 * @returns {{ action: string, amountUSDC?: string, tickLower?: number, tickUpper?: number, reason?: string }}
 */
function parseDecision(reply) {
  // Strip <tool_call>...</tool_call> tags
  let cleaned = reply.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "").trim();

  // Try to find a JSON object with an "action" field
  const actionMatch = cleaned.match(/\{[^{}]*"action"\s*:[^{}]*\}/);
  if (actionMatch) {
    try {
      return JSON.parse(actionMatch[0]);
    } catch {
      // fall through
    }
  }

  // Fallback: first {...} block
  const firstMatch = cleaned.match(/\{[\s\S]*?\}/);
  if (firstMatch) {
    try {
      return JSON.parse(firstMatch[0]);
    } catch {
      // fall through
    }
  }

  // Last resort: treat as hold
  console.warn("[arena] Could not parse decision JSON — defaulting to hold");
  return { action: "hold", reason: "parse failure" };
}

// ---------------------------------------------------------------------------
// On-chain submission
// ---------------------------------------------------------------------------

/**
 * ABI-encode intent params and call agentManager.submitIntent.
 *
 * @param {{ action: string, amountUSDC?: string, tickLower?: number, tickUpper?: number }} decision
 * @param {ethers.Contract} agentManager
 * @param {number} agentId
 * @returns {Promise<string>} tx hash
 */
async function submitOnChain(decision, agentManager, agentId) {
  const { action, amountUSDC, tickLower, tickUpper } = decision;

  const actionType = ACTION_MAP[action.toLowerCase()];
  if (actionType === undefined) {
    throw new Error(`Unknown action "${action}" — expected open, close, or rebalance`);
  }

  let paramsBytes;
  if (actionType === ACTION_MAP.close) {
    paramsBytes = "0x";
  } else {
    if (amountUSDC === undefined || tickLower === undefined || tickUpper === undefined) {
      throw new Error(
        `Action "${action}" requires amountUSDC, tickLower, tickUpper in decision`
      );
    }
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    paramsBytes = abiCoder.encode(
      ["uint256", "int24", "int24"],
      [
        ethers.parseUnits(String(amountUSDC), 6),
        parseInt(tickLower, 10),
        parseInt(tickUpper, 10),
      ]
    );
  }

  const tx = await agentManager.submitIntent(agentId, actionType, paramsBytes);
  return tx.hash;
}

// ---------------------------------------------------------------------------
// Sleep helper
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

(async () => {
  // --- Startup: wallet + agent ID ---
  let wallet, address;
  try {
    ({ wallet, address } = getWallet());
  } catch (err) {
    console.error(`[arena] Error: ${err.message}`);
    process.exit(1);
  }

  const agentId = await getAgentId(address);
  if (agentId === 0) {
    console.error(
      "[arena] Error: wallet is not registered as an agent.\n" +
      "        Run register-agent.mjs first."
    );
    process.exit(1);
  }

  // --- Startup: AGENTS.md check ---
  if (!existsSync("AGENTS.md")) {
    console.error(
      "[arena] Error: AGENTS.md not found in the current working directory.\n" +
      "        Run this script from the ai-plugin/ directory, or ensure AGENTS.md exists.\n" +
      "        Example: cd ai-plugin && node skills/run-arena-agent/arena-loop.mjs"
    );
    process.exit(1);
  }

  // --- Startup summary ---
  console.log(`[arena] Starting autonomous trading loop`);
  console.log(`[arena]   Wallet   : ${address}`);
  console.log(`[arena]   Agent ID : ${agentId}`);
  console.log(`[arena]   Interval : ${INTERVAL_MS}ms`);
  const llmRoute = GATEWAY_TOKEN
    ? `OpenClaw gateway (${GATEWAY_URL})`
    : OG_COMPUTE_API_KEY
    ? "0G Compute direct"
    : "NONE — will exit on first LLM call";
  console.log(`[arena]   LLM      : ${llmRoute}`);
  console.log("[arena] Press Ctrl+C to stop\n");

  // --- AgentManager contract ---
  const agentManager = new ethers.Contract(
    CONFIG.AGENT_MANAGER_ADDRESS,
    [
      "function submitIntent(uint256 agentId, uint8 actionType, bytes calldata params) external",
    ],
    wallet
  );

  // --- Graceful shutdown ---
  let running = true;
  let previousPrice = null;

  const shutdown = () => {
    console.log("\n[arena] Shutting down…");
    running = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // --- Main loop ---
  while (running) {
    const epochTime = new Date().toISOString();

    try {
      // 1. Query pool state
      const poolState = await queryPool(address);
      poolState.previousPrice = previousPrice;

      console.log(
        `[arena] epoch @ ${epochTime} — tick=${poolState.currentTick} price=${poolState.currentPrice}`
      );

      // 2. Call LLM
      const reply = await callLLM(poolState);

      // 3. Parse decision
      const decision = parseDecision(reply);
      console.log(
        `[arena]   decision: action=${decision.action}` +
        (decision.reason ? ` reason="${decision.reason}"` : "") +
        (decision.amountUSDC ? ` amountUSDC=${decision.amountUSDC}` : "") +
        (decision.tickLower !== undefined ? ` ticks=[${decision.tickLower},${decision.tickUpper}]` : "")
      );

      // 4. Submit on-chain if action != hold
      if (decision.action && decision.action.toLowerCase() !== "hold") {
        const txHash = await submitOnChain(decision, agentManager, agentId);
        console.log(`[arena]   submitted tx: ${txHash}`);
      } else {
        console.log(`[arena]   holding — no on-chain action`);
      }

      // Track price for next epoch
      previousPrice = poolState.currentPrice;
    } catch (err) {
      console.error(`[arena] Epoch error: ${err.message}`);
      // Continue loop — one bad epoch should not stop the agent
    }

    // 5. Sleep
    if (running) {
      await sleep(INTERVAL_MS);
    }
  }

  console.log("[arena] Loop exited cleanly.");
})();
