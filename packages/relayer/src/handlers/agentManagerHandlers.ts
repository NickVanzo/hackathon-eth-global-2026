/**
 * agentManagerHandlers.ts
 *
 * Handles events emitted by the AgentManager contract on 0G testnet and
 * relays them as transactions to the Satellite contract on Ethereum Sepolia.
 *
 * Flow: AgentManager (0G) -> event -> handler -> Satellite (Sepolia) call
 *
 * Key route:
 *   IntentQueued -> Uniswap Trading API POST /quote + /swap -> satellite.executeBatch()
 *
 * Also handles AgentManager.ForceCloseRequested (eviction / arena-exit driven).
 */

import {
  AgentManager,
  AgentManager_IntentQueued,
  AgentManager_ForceCloseRequested,
  AgentManager_AgentPromoted,
  AgentManager_AgentEvicted,
  IndexedIntent,
} from "generated";

import { sepoliaPublicClient, sepoliaWalletClient, zgPublicClient } from "../relayer/clients";
import { SATELLITE_ABI, AGENT_MANAGER_ABI } from "../relayer/abis";
import { SATELLITE_ADDRESS, AGENT_MANAGER_ADDRESS, ActionType } from "../relayer/env";
import {
  getZapInCalldata,
  getZapOutCalldata,
  decodeOpenPositionParams,
  encodeOpenPositionParams,
  encodeClosePositionParams,
} from "../relayer/uniswap";

// ---------------------------------------------------------------------------
// Helper: relay a call to Satellite (Sepolia), logging errors without throwing
// (envio handlers must not throw — a throw would stall the indexer)
// ---------------------------------------------------------------------------

async function relayToSepolia(
  label: string,
  fn: () => Promise<`0x${string}`>
): Promise<{ hash: string | null; error: boolean }> {
  try {
    const hash = await fn();
    console.log(`[relay] ${label} -> Sepolia tx: ${hash}`);
    return { hash, error: false };
  } catch (err) {
    console.error(`[relay] ${label} failed:`, err);
    return { hash: null, error: true };
  }
}

// ---------------------------------------------------------------------------
// IntentQueued
// AgentManager.submitIntent() emits this on 0G after validating credits/cooldown.
//
// Relay flow:
//   1. Decode intent params to understand what the agent wants
//   2. For OPEN_POSITION: call Uniswap Trading API (POST /quote + /swap) to get
//      Universal Router calldata for the USDC.e -> WETH zap-in swap
//   3. For CLOSE_POSITION: call Trading API for WETH -> USDC.e zap-out swap
//   4. Re-encode params with the swap calldata
//   5. Call satellite.executeBatch() on Sepolia with the enriched intent
// ---------------------------------------------------------------------------

AgentManager.IntentQueued.handler(async ({ event, context }) => {
  const entity: AgentManager_IntentQueued = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    actionType: event.params.actionType,
    params: event.params.params,
    blockNumber: event.params.blockNumber,
  };
  context.AgentManager_IntentQueued.set(entity);

  // Create IndexedIntent for frontend (status starts as "pending", updated below)
  const actionNames = ["OPEN_POSITION", "CLOSE_POSITION", "MODIFY_POSITION"] as const;
  const intentId = `intent_${event.chainId}_${event.block.number}_${event.logIndex}`;
  const indexedIntent: IndexedIntent = {
    id: intentId,
    agentId: event.params.agentId,
    actionType: actionNames[Number(event.params.actionType)] ?? "UNKNOWN",
    status: "pending",
    timestamp: BigInt(event.block.timestamp),
    txHash: "",
    blockNumber: BigInt(event.block.number),
  };
  context.IndexedIntent.set(indexedIntent);

  const agentId = event.params.agentId;
  const actionType = Number(event.params.actionType);
  const rawParams = event.params.params as `0x${string}`;

  const relayResult = await relayToSepolia(
    `IntentQueued(agentId=${agentId}, action=${actionType})`,
    async () => {
      let enrichedParams: `0x${string}` = rawParams;

      if (actionType === ActionType.OPEN_POSITION) {
        // Decode the agent's intent: (amountUSDC, tickLower, tickUpper)
        const decoded = decodeOpenPositionParams(rawParams);

        // Read agent phase to set the correct source tag on the position.
        // Default to PROVING (conservative: over-attributing to proving is
        // recoverable; under-attributing to vault would inflate exposure).
        let source = 0;
        try {
          const phase = await zgPublicClient.readContract({
            address: AGENT_MANAGER_ADDRESS,
            abi: AGENT_MANAGER_ABI,
            functionName: "agentPhase",
            args: [agentId],
          });
          source = Number(phase); // 0=PROVING, 1=VAULT
        } catch (err) {
          console.warn(`[intent] agentPhase read failed for agent=${agentId}, defaulting to PROVING:`, err);
        }

        // Call Uniswap Trading API: swap ~50% of USDC.e -> WETH for the LP's WETH leg
        const halfAmount = decoded.amountUSDC / 2n;
        const swapCalldata = await getZapInCalldata(halfAmount);

        enrichedParams = encodeOpenPositionParams(
          decoded.amountUSDC,
          decoded.tickLower,
          decoded.tickUpper,
          swapCalldata,
          source,
        );

        console.log(
          `[intent] OPEN_POSITION: agent=${agentId} amount=${decoded.amountUSDC} ` +
          `ticks=[${decoded.tickLower},${decoded.tickUpper}] swapCalldata=${swapCalldata.length > 4 ? "OK" : "empty"}`
        );
      } else if (actionType === ActionType.CLOSE_POSITION) {
        // For close: the raw params contain (tokenId). We need to fetch the position's
        // WETH value to generate zap-out calldata. For now, pass "0x" and let the
        // satellite handle deposit-token-only recovery. In production, read position
        // value from NonfungiblePositionManager.
        // TODO: read actual WETH amount from position for better zap-out
        const swapCalldata = await getZapOutCalldata(0n);
        enrichedParams = rawParams; // close params are passed through as-is

        console.log(
          `[intent] CLOSE_POSITION: agent=${agentId} swapCalldata=${swapCalldata.length > 4 ? "OK" : "empty"}`
        );
      }
      // MODIFY_POSITION: pass through as-is for now

      // Build the intent tuple for satellite.executeBatch()
      const intent = {
        agentId: agentId,
        actionType: actionType,
        params: enrichedParams,
        blockNumber: event.params.blockNumber,
      };

      return sepoliaWalletClient.writeContract({
        address: SATELLITE_ADDRESS,
        abi: SATELLITE_ABI,
        functionName: "executeBatch",
        args: [[intent]],
      });
    }
  );

  // Update IndexedIntent status based on relay result
  context.IndexedIntent.set({
    ...indexedIntent,
    status: relayResult.error ? "failed" : "executed",
    txHash: relayResult.hash ?? "",
  });
});

// ---------------------------------------------------------------------------
// ForceCloseRequested (from AgentManager)
// Emitted during settleAgents() for eviction or processWithdrawFromArena().
// Source: 0=PROVING, 1=VAULT, 2=ALL
//
// Relay:
//   1. Read satellite.getAgentPositions(agentId)
//   2. For each position, get Uniswap zap-out calldata (WETH -> USDC.e)
//   3. Call satellite.forceClose(agentId, positionIds, source, swapCalldata)
// ---------------------------------------------------------------------------

AgentManager.ForceCloseRequested.handler(async ({ event, context }) => {
  const entity: AgentManager_ForceCloseRequested = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    source: event.params.source,
  };
  context.AgentManager_ForceCloseRequested.set(entity);

  await relayToSepolia(
    `AM.ForceCloseRequested(agentId=${event.params.agentId}, source=${event.params.source})`,
    async () => {
      // 1. Get open positions from Satellite
      const positionIds = await sepoliaPublicClient.readContract({
        address: SATELLITE_ADDRESS,
        abi: SATELLITE_ABI,
        functionName: "getAgentPositions",
        args: [event.params.agentId],
      }) as bigint[];

      if (positionIds.length === 0) {
        throw new Error(`No open positions for agentId=${event.params.agentId} — skip forceClose`);
      }

      // 2. Get zap-out calldata per position
      // TODO: read actual WETH amounts from NonfungiblePositionManager for better quotes
      const swapCalldata: `0x${string}`[] = await Promise.all(
        positionIds.map(() => getZapOutCalldata(0n))
      );

      // 3. forceClose on Satellite
      return sepoliaWalletClient.writeContract({
        address: SATELLITE_ADDRESS,
        abi: SATELLITE_ABI,
        functionName: "forceClose",
        args: [
          event.params.agentId,
          positionIds,
          Number(event.params.source) as 0 | 1 | 2,
          swapCalldata,
        ],
      });
    }
  );
});

// ---------------------------------------------------------------------------
// AgentPromoted — index only (dashboard / analytics)
// ---------------------------------------------------------------------------

AgentManager.AgentPromoted.handler(async ({ event, context }) => {
  const entity: AgentManager_AgentPromoted = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
  };
  context.AgentManager_AgentPromoted.set(entity);
  console.log(`[index] AgentPromoted: agentId=${event.params.agentId}`);
});

// ---------------------------------------------------------------------------
// AgentEvicted — index only (dashboard / analytics)
// ---------------------------------------------------------------------------

AgentManager.AgentEvicted.handler(async ({ event, context }) => {
  const entity: AgentManager_AgentEvicted = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    fullEviction: event.params.fullEviction,
  };
  context.AgentManager_AgentEvicted.set(entity);
  console.log(`[index] AgentEvicted: agentId=${event.params.agentId}, full=${event.params.fullEviction}`);
});
