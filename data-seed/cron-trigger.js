#!/usr/bin/env node
/**
 * Epoch trigger for Agent Arena.
 *
 * Each epoch:
 *   1. Build pool state (mock until Subgraph MCP is available)
 *   2. Call the 0G compute API directly with each agent's AGENTS.md as system prompt
 *   3. Parse the JSON decision from the reply
 *   4. In DRY_RUN mode, write intent to /data/intents/ instead of submitting on-chain
 */

import { mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const STATE_DIR =
  process.env.OPENCLAW_STATE_DIR ?? join(__dirname, "../local");
const EPOCH_INTERVAL_MS = parseInt(process.env.EPOCH_INTERVAL_MS || "30000", 10);
const DRY_RUN = process.env.DRY_RUN === "true";
const AGENTS = ["agent-alpha", "agent-beta", "agent-gamma"];
const WORKSPACE_BASE = join(STATE_DIR, "workspaces");

const GATEWAY_URL = "http://127.0.0.1:3000";

// Tracks previous price per agent for beta's contrarian strategy
const previousPrices = {};

/**
 * Returns mock pool state.
 * Replace with a real Subgraph fetch when the MCP server is available.
 */
function getPoolState(agentId) {
  const currentPrice = 1800.0 + Math.random() * 20 - 10;
  const previousPrice = previousPrices[agentId] ?? currentPrice;
  previousPrices[agentId] = currentPrice;

  return {
    currentPrice: parseFloat(currentPrice.toFixed(4)),
    previousPrice: parseFloat(previousPrice.toFixed(4)),
    currentTick: Math.floor(Math.log(currentPrice) / Math.log(1.0001)),
    openPosition: { tickLower: null, tickUpper: null, liquidity: null },
  };
}

/**
 * Calls the OpenClaw gateway HTTP endpoint.
 * The gateway injects the agent's AGENTS.md system prompt automatically.
 */
async function callAgent(agentId, message) {
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!token) throw new Error("OPENCLAW_GATEWAY_TOKEN is not set");

  const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: `openclaw/${agentId}`,
      messages: [{ role: "user", content: message }],
      max_tokens: 128,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gateway error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

/**
 * Extracts the first JSON object from the agent's reply.
 */
function parseDecision(reply) {
  const match = reply.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error(`no JSON found in: ${reply}`);
  const repaired = match[0].replace(/(\d)"([},])/g, "$1$2");
  return JSON.parse(repaired);
}

/**
 * Submits or dry-runs the intent for the given agent and action.
 */
function submitIntent(agentId, action, params = {}) {
  if (DRY_RUN) {
    const intentsDir = join(STATE_DIR, "intents");
    mkdirSync(intentsDir, { recursive: true });
    const filename = `${agentId}-${action}-${Date.now()}.json`;
    const intent = { agentId, action, params, timestamp: new Date().toISOString() };
    writeFileSync(join(intentsDir, filename), JSON.stringify(intent, null, 2));
    console.log(`[${agentId}] dry-run: wrote ${filename}`);
    return;
  }

  // TODO: call submit-intent.mjs once vault is deployed
  console.warn(`[${agentId}] non-dry-run submit not yet implemented`);
}

async function runAgentEpoch(agentId) {
  const poolState = getPoolState(agentId);
  const message =
    `Epoch trigger. Pool state: ${JSON.stringify(poolState)}. ` +
    `Output your JSON decision now.`;

  let reply;
  try {
    reply = await callAgent(agentId, message);
  } catch (err) {
    console.error(`[${agentId}] agent call failed: ${err.message}`);
    return;
  }

  let decision;
  try {
    decision = parseDecision(reply);
  } catch (err) {
    console.error(`[${agentId}] parse failed: ${err.message} | reply: ${reply}`);
    return;
  }

  console.log(`[${agentId}] decision: ${JSON.stringify(decision)}`);

  try {
    if (decision.action === "hold") {
      console.log(`[${agentId}] holding — no intent submitted`);
      return;
    }

    if (decision.action === "rebalance") {
      submitIntent(agentId, "close", {});
      submitIntent(agentId, "open", {
        tickLower: decision.tickLower,
        tickUpper: decision.tickUpper,
        liquidity: "1000000000000000000",
      });
      return;
    }

    if (decision.action === "open") {
      submitIntent(agentId, "open", {
        tickLower: decision.tickLower,
        tickUpper: decision.tickUpper,
        liquidity: "1000000000000000000",
      });
      return;
    }

    if (decision.action === "close") {
      submitIntent(agentId, "close", {});
      return;
    }

    console.warn(`[${agentId}] unknown action: ${decision.action}`);
  } catch (err) {
    console.error(`[${agentId}] submit-intent failed: ${err.message}`);
  }
}

async function runEpoch() {
  console.log(`[cron] epoch @ ${new Date().toISOString()}`);
  for (const agentId of AGENTS) {
    await runAgentEpoch(agentId);
  }
}

// Short startup delay
setTimeout(async () => {
  await runEpoch();
  setInterval(runEpoch, EPOCH_INTERVAL_MS);
}, 3_000);

console.log(`[cron] started — epoch every ${EPOCH_INTERVAL_MS / 1000}s, agents: ${AGENTS.join(", ")}`);
