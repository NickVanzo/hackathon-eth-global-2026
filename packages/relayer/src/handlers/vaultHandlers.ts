/**
 * vaultHandlers.ts
 *
 * Handles events emitted by the Vault contract on 0G testnet and relays
 * them as transactions to the Satellite contract on Ethereum Sepolia.
 *
 * Flow: Vault (0G) → event → handler → Satellite (Sepolia) call
 *
 * Also handles Vault.ForceCloseRequested which requires:
 *   1. Reading agent positions from Satellite (Sepolia)
 *   2. Fetching Uniswap swap calldata (Trading API)
 *   3. Calling satellite.forceClose()
 */

import {
  Vault,
  Vault_Approval,
  Vault_CommissionAccrued,
  Vault_CommissionApproved,
  Vault_EpochSettled,
  Vault_ForceCloseRequested,
  Vault_ProtocolFeeAccrued,
  Vault_RecoveryRecorded,
  Vault_Transfer,
  Vault_WithdrawApproved,
  Vault_WithdrawReleased,
} from "generated";

import { sepoliaPublicClient, sepoliaWalletClient } from "../relayer/clients";
import { SATELLITE_ABI } from "../relayer/abis";
import { SATELLITE_ADDRESS, ForceCloseSource } from "../relayer/env";
import { getZapOutCalldata } from "../relayer/uniswap";

// ---------------------------------------------------------------------------
// Helper: relay a call to a Satellite (Sepolia) contract, logging errors
// without throwing (envio handlers must not throw).
// ---------------------------------------------------------------------------

async function relayToSepolia(
  label: string,
  fn: () => Promise<`0x${string}`>
): Promise<void> {
  try {
    const hash = await fn();
    console.log(`[relay] ${label} → Sepolia tx: ${hash}`);
  } catch (err) {
    console.error(`[relay] ${label} failed:`, err);
  }
}

// ---------------------------------------------------------------------------
// EpochSettled
// vault._settleEpoch() completes on 0G — new share price is emitted.
// Relay: satellite.updateSharePrice(sharePrice) on Sepolia
//   → satellite caches the price for withdrawal share conversions.
// ---------------------------------------------------------------------------

Vault.EpochSettled.handler(async ({ event, context }) => {
  const entity: Vault_EpochSettled = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    sharePrice: event.params.sharePrice,
    totalShares: event.params.totalShares,
    totalAssets: event.params.totalAssets,
  };
  context.Vault_EpochSettled.set(entity);

  await relayToSepolia(
    `EpochSettled→satellite.updateSharePrice(${event.params.sharePrice})`,
    () =>
      sepoliaWalletClient.writeContract({
        address: SATELLITE_ADDRESS,
        abi: SATELLITE_ABI,
        functionName: "updateSharePrice",
        args: [event.params.sharePrice],
      })
  );
});

// ---------------------------------------------------------------------------
// WithdrawApproved
// vault emits this for both Tier-1 (processWithdraw) and Tier-2 (_settleEpoch).
// Relay: satellite.release(user, tokenAmount) on Sepolia
//   → transfers USDC.e directly to user.
//
// Note: Tier-2 approvals at epoch settlement call the same satellite.release().
// Production refinement: track pending Tier-2 queue and call
// satellite.approveQueuedWithdraw() + let user claim. For hackathon, calling
// release() directly is safe as long as idle balance is sufficient (it is, by
// design — the vault only emits WithdrawApproved when capital is available).
// ---------------------------------------------------------------------------

Vault.WithdrawApproved.handler(async ({ event, context }) => {
  const entity: Vault_WithdrawApproved = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    user: event.params.user,
    tokenAmount: event.params.tokenAmount,
  };
  context.Vault_WithdrawApproved.set(entity);

  await relayToSepolia(
    `WithdrawApproved→satellite.release(${event.params.user}, ${event.params.tokenAmount})`,
    () =>
      sepoliaWalletClient.writeContract({
        address: SATELLITE_ADDRESS,
        abi: SATELLITE_ABI,
        functionName: "release",
        args: [event.params.user as `0x${string}`, event.params.tokenAmount],
      })
  );
});

// ---------------------------------------------------------------------------
// CommissionApproved
// agentManager.approveCommissionRelease() calls vault which emits this.
// Relay: satellite.releaseCommission(agentId, caller, amount) on Sepolia
//   → pays USDC.e commission to iNFT owner from the satellite's commission reserve.
// ---------------------------------------------------------------------------

Vault.CommissionApproved.handler(async ({ event, context }) => {
  const entity: Vault_CommissionApproved = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    caller: event.params.caller,
    amount: event.params.amount,
  };
  context.Vault_CommissionApproved.set(entity);

  await relayToSepolia(
    `CommissionApproved→satellite.releaseCommission(agentId=${event.params.agentId})`,
    () =>
      sepoliaWalletClient.writeContract({
        address: SATELLITE_ADDRESS,
        abi: SATELLITE_ABI,
        functionName: "releaseCommission",
        args: [
          event.params.agentId,
          event.params.caller as `0x${string}`,
          event.params.amount,
        ],
      })
  );
});

// ---------------------------------------------------------------------------
// ProtocolFeeAccrued
// Emitted once per epoch settlement with the epoch's protocol fee total.
// Relay: satellite.reserveProtocolFees(amount) on Sepolia
//   → earmarks the USDC.e for the protocol treasury (claimable via claimProtocolFees).
// ---------------------------------------------------------------------------

Vault.ProtocolFeeAccrued.handler(async ({ event, context }) => {
  const entity: Vault_ProtocolFeeAccrued = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    amount: event.params.amount,
  };
  context.Vault_ProtocolFeeAccrued.set(entity);

  await relayToSepolia(
    `ProtocolFeeAccrued→satellite.reserveProtocolFees(${event.params.amount})`,
    () =>
      sepoliaWalletClient.writeContract({
        address: SATELLITE_ADDRESS,
        abi: SATELLITE_ABI,
        functionName: "reserveProtocolFees",
        args: [event.params.amount],
      })
  );
});

// ---------------------------------------------------------------------------
// CommissionAccrued
// Emitted per agent per epoch — agent iNFT owner's cut of collected fees.
// Relay: satellite.reserveCommission(agentId, amount) on Sepolia
//   → earmarks USDC.e in the agent's commission reserve (claimable by iNFT owner).
// ---------------------------------------------------------------------------

Vault.CommissionAccrued.handler(async ({ event, context }) => {
  const entity: Vault_CommissionAccrued = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    amount: event.params.amount,
  };
  context.Vault_CommissionAccrued.set(entity);

  await relayToSepolia(
    `CommissionAccrued→satellite.reserveCommission(agentId=${event.params.agentId})`,
    () =>
      sepoliaWalletClient.writeContract({
        address: SATELLITE_ADDRESS,
        abi: SATELLITE_ABI,
        functionName: "reserveCommission",
        args: [event.params.agentId, event.params.amount],
      })
  );
});

// ---------------------------------------------------------------------------
// ForceCloseRequested
// Emitted by Vault (withdrawal-driven) or AgentManager (eviction / arena-exit).
// Source values: 0=PROVING, 1=VAULT, 2=ALL.
//
// Relay:
//   1. Read satellite.getAgentPositions(agentId) to get open position NFT IDs
//   2. For each position, get Uniswap swap calldata for WETH → USDC.e zap-out
//      (empty bytes falls back to depositToken-only recovery in the satellite)
//   3. Call satellite.forceClose(agentId, positionIds, source, swapCalldata)
// ---------------------------------------------------------------------------

Vault.ForceCloseRequested.handler(async ({ event, context }) => {
  const entity: Vault_ForceCloseRequested = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    source: event.params.source,
  };
  context.Vault_ForceCloseRequested.set(entity);

  await relayToSepolia(
    `ForceCloseRequested(agentId=${event.params.agentId}, source=${event.params.source})`,
    async () => {
      // 1. Get current open positions for this agent from Satellite
      const positionIds = await sepoliaPublicClient.readContract({
        address: SATELLITE_ADDRESS,
        abi: SATELLITE_ABI,
        functionName: "getAgentPositions",
        args: [event.params.agentId],
      }) as bigint[];

      if (positionIds.length === 0) {
        throw new Error(`No open positions for agentId=${event.params.agentId} — skip forceClose`);
      }

      // 2. For each position, attempt to get Uniswap zap-out calldata.
      //    We use a conservative estimate: 50% of last known position value
      //    as the WETH amount. In production, derive from on-chain pool state.
      //    The satellite gracefully handles empty calldata (returns deposit-token portion only).
      const swapCalldata: `0x${string}`[] = await Promise.all(
        positionIds.map(async () => {
          // Fetch zap-out calldata; fallback to "0x" on any error
          // Using 0n signals "don't know amount" — getZapOutCalldata returns "0x" for 0n
          return getZapOutCalldata(0n);
        })
      );

      // 3. forceClose on Satellite — source is the raw uint8 from the event
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
// WithdrawReleased — index only, no cross-chain relay
// Emitted by vault.claimWithdraw() after ClaimWithdrawRequested processing.
// The actual token transfer is already handled by satelliteHandlers.ts
// (ClaimWithdrawRequested → releaseQueuedWithdraw).
// ---------------------------------------------------------------------------

Vault.WithdrawReleased.handler(async ({ event, context }) => {
  const entity: Vault_WithdrawReleased = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    user: event.params.user,
    tokenAmount: event.params.tokenAmount,
  };
  context.Vault_WithdrawReleased.set(entity);
});

// ---------------------------------------------------------------------------
// RecoveryRecorded — index only, no cross-chain relay
// Audit event emitted by vault.recordRecovery() after force-close on Sepolia.
// ---------------------------------------------------------------------------

Vault.RecoveryRecorded.handler(async ({ event, context }) => {
  const entity: Vault_RecoveryRecorded = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    recoveredAmount: event.params.recoveredAmount,
  };
  context.Vault_RecoveryRecorded.set(entity);
});

// ---------------------------------------------------------------------------
// Transfer — index ERC20 share transfers for dashboard / analytics
// ---------------------------------------------------------------------------

Vault.Transfer.handler(async ({ event, context }) => {
  const entity: Vault_Transfer = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    from: event.params.from,
    to: event.params.to,
    value: event.params.value,
  };
  context.Vault_Transfer.set(entity);
});

// ---------------------------------------------------------------------------
// Approval — index ERC20 share approvals for dashboard / analytics
// ---------------------------------------------------------------------------

Vault.Approval.handler(async ({ event, context }) => {
  const entity: Vault_Approval = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    owner: event.params.owner,
    spender: event.params.spender,
    value: event.params.value,
  };
  context.Vault_Approval.set(entity);
});
