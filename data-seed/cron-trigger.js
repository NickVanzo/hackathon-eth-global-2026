#!/usr/bin/env node
/**
 * Epoch trigger for local development with 0G vLLM (no tool calling).
 *
 * Each epoch:
 *   1. Build pool state (mock until Subgraph MCP is available)
 *   2. Ask each agent via `openclaw agent --local` with pool state injected
 *   3. Parse the JSON decision from the agent's reply
 *   4. Execute submit-intent.mjs as a child process
 */

import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const STATE_DIR =
  process.env.OPENCLAW_STATE_DIR ?? join(__dirname, "../local");
const EPOCH_INTERVAL_MS = parseInt(process.env.EPOCH_INTERVAL_MS || "30000", 10);
const AGENTS = ["agent-alpha", "agent-beta", "agent-gamma"];
const WORKSPACE_BASE = join(__dirname, "workspaces");

// Tracks previous price per agent for beta's contrarian strategy
const previousPrices = {};

/**
 * Returns mock pool state.
 * Replace with a real Subgraph fetch when the MCP server is available.
 */
function getPoolState(agentId) {
  const currentPrice = 1800.0 + Math.random() * 20 - 10; // small drift each epoch
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
 * Calls openclaw agent --local, returns the last non-empty line of stdout.
 */
function callAgent(agentId, message) {
  const result = spawnSync(
    "openclaw",
    ["agent", "--agent", agentId, "--local", "--message", message],
    {
      env: { ...process.env, OPENCLAW_STATE_DIR: STATE_DIR },
      encoding: "utf8",
      timeout: 90_000,
    }
  );

  if (result.error) throw new Error(`spawn failed: ${result.error.message}`);

  // Strip ANSI codes and find last non-empty line (the agent reply)
  const clean = result.stdout.replace(/\x1b\[[0-9;]*m/g, "");
  const lines = clean.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

/**
 * Extracts the first JSON object from the agent's reply.
 */
function parseDecision(reply) {
  const match = reply.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error(`no JSON found in: ${reply}`);
  return JSON.parse(match[0]);
}

/**
 * Runs submit-intent.mjs for the given agent and action.
 * The script reads VAULT_ADDRESS, AGENT_ID, PRIVATE_KEY_ENV_VAR from the
 * workspace .env and the private key from process.env[PRIVATE_KEY_ENV_VAR].
 */
function submitIntent(agentId, action, params = {}) {
  const scriptPath = join(WORKSPACE_BASE, agentId, "skills", "submit-intent.mjs");
  const paramsJson = JSON.stringify(params);

  const result = spawnSync("node", [scriptPath, action, paramsJson], {
    env: process.env,
    encoding: "utf8",
    timeout: 30_000,
  });

  if (result.stdout) console.log(`[${agentId}] submit-intent: ${result.stdout.trim()}`);
  if (result.stderr) console.error(`[${agentId}] submit-intent stderr: ${result.stderr.trim()}`);
  if (result.status !== 0) throw new Error(`submit-intent exited ${result.status}`);
}

async function runAgentEpoch(agentId) {
  const poolState = getPoolState(agentId);
  const message =
    `Epoch trigger. Pool state: ${JSON.stringify(poolState)}. ` +
    `Output your JSON decision now.`;

  let reply;
  try {
    reply = callAgent(agentId, message);
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
      // Close existing then open new
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

// Short startup delay so openclaw gateway (if running) is fully up
setTimeout(async () => {
  await runEpoch();
  setInterval(runEpoch, EPOCH_INTERVAL_MS);
}, 3_000);

console.log(`[cron] started — epoch every ${EPOCH_INTERVAL_MS / 1000}s, agents: ${AGENTS.join(", ")}`);
