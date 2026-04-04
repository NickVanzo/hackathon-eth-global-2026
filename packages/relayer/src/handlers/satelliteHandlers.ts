/**
 * satelliteHandlers.ts
 *
 * Handles events emitted by the Satellite contract on Ethereum Sepolia and
 * relays them as transactions to the 0G contracts (Vault + AgentManager).
 *
 * Flow: Satellite (Sepolia) → event → handler → 0G contract call
 */

import {
  Satellite,
  Satellite_AgentRegistered,
  Satellite_ClaimWithdrawRequested,
  Satellite_CommissionClaimRequested,
  Satellite_Deposited,
  Satellite_PauseRequested,
  Satellite_PositionClosed,
  Satellite_ValuesReported,
  Satellite_WithdrawFromArenaRequested,
  Satellite_WithdrawRequested,
  Satellite_WithdrawalCompleted,
} from "generated";

import {
  sepoliaPublicClient,
  sepoliaWalletClient,
  zgWalletClient,
  zgPublicClient,
} from "../relayer/clients";
import { SATELLITE_ABI, VAULT_ABI, AGENT_MANAGER_ABI } from "../relayer/abis";
import {
  SATELLITE_ADDRESS,
  VAULT_ADDRESS,
  AGENT_MANAGER_ADDRESS,
  ForceCloseSource,
} from "../relayer/env";

// ---------------------------------------------------------------------------
// Helper: relay a call to a 0G contract, logging errors without throwing
// (envio handlers must not throw — a throw would stall the indexer)
// ---------------------------------------------------------------------------

async function relay(
  label: string,
  fn: () => Promise<`0x${string}`>
): Promise<void> {
  try {
    const hash = await fn();
    console.log(`[relay] ${label} → tx: ${hash}`);
  } catch (err) {
    console.error(`[relay] ${label} failed:`, err);
  }
}

// Alias for readability in this file (all relay targets are 0G unless noted)
const relayTo0G = relay;

// ---------------------------------------------------------------------------
// Deposited
// Satellite.deposit() called by user on Sepolia.
// Relay: vault.recordDeposit(user, amount) on 0G → mints shares.
// ---------------------------------------------------------------------------

Satellite.Deposited.handler(async ({ event, context }) => {
  const entity: Satellite_Deposited = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    user: event.params.user,
    amount: event.params.amount,
  };
  context.Satellite_Deposited.set(entity);

  await relayTo0G(
    `Deposited(${event.params.user}, ${event.params.amount})`,
    () =>
      zgWalletClient.writeContract({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "recordDeposit",
        args: [event.params.user as `0x${string}`, event.params.amount],
      })
  );
});

// ---------------------------------------------------------------------------
// AgentRegistered
// satellite.registerAgent() called by deployer on Sepolia.
// Relay: agentManager.recordRegistration(agentId, agentAddress, deployer, provingAmount)
// on 0G → registers agent + mints iNFT.
// ---------------------------------------------------------------------------

Satellite.AgentRegistered.handler(async ({ event, context }) => {
  const entity: Satellite_AgentRegistered = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    agentAddress: event.params.agentAddress,
    deployer: event.params.deployer,
    provingAmount: event.params.provingAmount,
  };
  context.Satellite_AgentRegistered.set(entity);

  await relayTo0G(
    `AgentRegistered(agentId=${event.params.agentId})`,
    () =>
      zgWalletClient.writeContract({
        address: AGENT_MANAGER_ADDRESS,
        abi: AGENT_MANAGER_ABI,
        functionName: "recordRegistration",
        args: [
          event.params.agentId,
          event.params.agentAddress as `0x${string}`,
          event.params.deployer as `0x${string}`,
          event.params.provingAmount,
        ],
      })
  );
});

// ---------------------------------------------------------------------------
// WithdrawRequested
// satellite.requestWithdraw(tokenAmount) called by user on Sepolia.
// Relay: vault.processWithdraw(user, shares) on 0G.
//
// Share conversion: read cachedSharePrice from Satellite (kept in sync with
// vault via updateSharePrice after each EpochSettled), then:
//   shares = tokenAmount * 1e18 / cachedSharePrice
// ---------------------------------------------------------------------------

Satellite.WithdrawRequested.handler(async ({ event, context }) => {
  const entity: Satellite_WithdrawRequested = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    user: event.params.user,
    tokenAmount: event.params.tokenAmount,
  };
  context.Satellite_WithdrawRequested.set(entity);

  await relayTo0G(
    `WithdrawRequested(${event.params.user}, ${event.params.tokenAmount})`,
    async () => {
      // Read cached share price from Satellite on Sepolia
      const cachedSharePrice = await sepoliaPublicClient.readContract({
        address: SATELLITE_ADDRESS,
        abi: SATELLITE_ABI,
        functionName: "cachedSharePrice",
      });

      // shares = tokenAmount * 1e18 / sharePrice
      const shares =
        cachedSharePrice > 0n
          ? (event.params.tokenAmount * 10n ** 18n) / cachedSharePrice
          : event.params.tokenAmount;

      return zgWalletClient.writeContract({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "processWithdraw",
        args: [event.params.user as `0x${string}`, shares],
      });
    }
  );
});

// ---------------------------------------------------------------------------
// ClaimWithdrawRequested
// satellite.claimWithdraw() called by user on Sepolia after Tier-2 approval.
// Relay:
//   1. vault.claimWithdraw(user, tokenAmount) on 0G → marks entry processed
//   2. satellite.releaseQueuedWithdraw(user, tokenAmount) on Sepolia → transfers tokens
// ---------------------------------------------------------------------------

Satellite.ClaimWithdrawRequested.handler(async ({ event, context }) => {
  const entity: Satellite_ClaimWithdrawRequested = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    user: event.params.user,
    tokenAmount: event.params.tokenAmount,
  };
  context.Satellite_ClaimWithdrawRequested.set(entity);

  // Step 1: mark claimed on vault (0G)
  await relayTo0G(
    `ClaimWithdraw→vault.claimWithdraw(${event.params.user})`,
    () =>
      zgWalletClient.writeContract({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "claimWithdraw",
        args: [event.params.user as `0x${string}`, event.params.tokenAmount],
      })
  );

  // Step 2: release tokens on satellite (Sepolia)
  await relay(
    `ClaimWithdraw→satellite.releaseQueuedWithdraw(${event.params.user})`,
    () =>
      sepoliaWalletClient.writeContract({
        address: SATELLITE_ADDRESS,
        abi: SATELLITE_ABI,
        functionName: "releaseQueuedWithdraw",
        args: [event.params.user as `0x${string}`, event.params.tokenAmount],
      })
  );
});

// ---------------------------------------------------------------------------
// ValuesReported
// satellite.collectAndReport() called by relayer per epoch per agent.
// Relay: agentManager.reportValues(agentId, positionValue, feesCollected) on 0G.
// ---------------------------------------------------------------------------

Satellite.ValuesReported.handler(async ({ event, context }) => {
  const entity: Satellite_ValuesReported = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    positionValue: event.params.positionValue,
    feesCollected: event.params.feesCollected,
  };
  context.Satellite_ValuesReported.set(entity);

  await relayTo0G(
    `ValuesReported(agentId=${event.params.agentId})`,
    () =>
      zgWalletClient.writeContract({
        address: AGENT_MANAGER_ADDRESS,
        abi: AGENT_MANAGER_ABI,
        functionName: "reportValues",
        args: [
          event.params.agentId,
          event.params.positionValue,
          event.params.feesCollected,
        ],
      })
  );
});

// ---------------------------------------------------------------------------
// PositionClosed
// Emitted by satellite on any position close (agent-initiated, modify, or forceClose).
// Relay:
//   1. agentManager.recordClosure(agentId, recoveredAmount, source) on 0G
//      → decrements totalDeployedVault (VAULT) or provingDeployed (PROVING),
//        refunds credits if vault phase
//   2. vault.recordRecovery(agentId, recoveredAmount) on 0G → audit event
//
// Source approximation: query agentManager.agentPhase() on 0G.
//   PROVING (0) → ForceCloseSource.PROVING
//   VAULT   (1) → ForceCloseSource.VAULT
// ---------------------------------------------------------------------------

Satellite.PositionClosed.handler(async ({ event, context }) => {
  const entity: Satellite_PositionClosed = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    positionId: event.params.positionId,
    recoveredAmount: event.params.recoveredAmount,
  };
  context.Satellite_PositionClosed.set(entity);

  // Determine source from agent phase on 0G (0=PROVING, 1=VAULT).
  // NOTE: We cannot read positionSource from Satellite here because
  // _closeAndZapOut deletes it before PositionClosed is emitted.
  // Reading agentPhase is correct for single-phase agents; for agents
  // that were promoted mid-lifecycle, a relayer-side position cache
  // (tracking source at open time) would be more accurate.
  let source: number = ForceCloseSource.VAULT;
  try {
    const phase = await zgPublicClient.readContract({
      address: AGENT_MANAGER_ADDRESS,
      abi: AGENT_MANAGER_ABI,
      functionName: "agentPhase",
      args: [event.params.agentId],
    });
    source = Number(phase) === 0 ? ForceCloseSource.PROVING : ForceCloseSource.VAULT;
  } catch {
    // Agent may be deregistered; default to VAULT (conservative — triggers
    // totalDeployedVault decrement, which is safer than skipping it)
  }

  // recordClosure — spec-defined, may not be in deployed ABI yet
  await relayTo0G(
    `PositionClosed→agentManager.recordClosure(agentId=${event.params.agentId})`,
    () =>
      zgWalletClient.writeContract({
        address: AGENT_MANAGER_ADDRESS,
        abi: AGENT_MANAGER_ABI,
        functionName: "recordClosure",
        args: [event.params.agentId, event.params.recoveredAmount, source],
      })
  );

  // vault.recordRecovery — audit event
  await relayTo0G(
    `PositionClosed→vault.recordRecovery(agentId=${event.params.agentId})`,
    () =>
      zgWalletClient.writeContract({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "recordRecovery",
        args: [event.params.agentId, event.params.recoveredAmount],
      })
  );
});

// ---------------------------------------------------------------------------
// CommissionClaimRequested
// satellite.claimCommissions(agentId) called by iNFT owner on Sepolia.
// Relay: agentManager.processCommissionClaim(agentId, caller) on 0G.
//   → verifies iNFT ownership, calls vault.approveCommissionRelease(agentId)
//   → vault emits CommissionApproved → vaultHandlers.ts calls satellite.releaseCommission()
// ---------------------------------------------------------------------------

Satellite.CommissionClaimRequested.handler(async ({ event, context }) => {
  const entity: Satellite_CommissionClaimRequested = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    caller: event.params.caller,
  };
  context.Satellite_CommissionClaimRequested.set(entity);

  await relayTo0G(
    `CommissionClaimRequested(agentId=${event.params.agentId}, caller=${event.params.caller})`,
    () =>
      zgWalletClient.writeContract({
        address: AGENT_MANAGER_ADDRESS,
        abi: AGENT_MANAGER_ABI,
        functionName: "processCommissionClaim",
        args: [event.params.agentId, event.params.caller as `0x${string}`],
      })
  );
});

// ---------------------------------------------------------------------------
// PauseRequested
// satellite.pauseAgent() / unpauseAgent() called by iNFT owner on Sepolia.
// Relay: agentManager.processPause(agentId, caller, paused) on 0G.
// ---------------------------------------------------------------------------

Satellite.PauseRequested.handler(async ({ event, context }) => {
  const entity: Satellite_PauseRequested = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    caller: event.params.caller,
    paused: event.params.paused,
  };
  context.Satellite_PauseRequested.set(entity);

  await relayTo0G(
    `PauseRequested(agentId=${event.params.agentId}, paused=${event.params.paused})`,
    () =>
      zgWalletClient.writeContract({
        address: AGENT_MANAGER_ADDRESS,
        abi: AGENT_MANAGER_ABI,
        functionName: "processPause",
        args: [
          event.params.agentId,
          event.params.caller as `0x${string}`,
          event.params.paused,
        ],
      })
  );
});

// ---------------------------------------------------------------------------
// WithdrawFromArenaRequested
// satellite.withdrawFromArena(agentId) called by iNFT owner on Sepolia.
// Relay: agentManager.processWithdrawFromArena(agentId, caller) on 0G.
//   → checks iNFT ownership, emits ForceCloseRequested(agentId, ALL),
//     deregisters agent immediately.
//   → vaultHandlers.ts picks up ForceCloseRequested and closes all positions.
// ---------------------------------------------------------------------------

Satellite.WithdrawFromArenaRequested.handler(async ({ event, context }) => {
  const entity: Satellite_WithdrawFromArenaRequested = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    caller: event.params.caller,
  };
  context.Satellite_WithdrawFromArenaRequested.set(entity);

  await relayTo0G(
    `WithdrawFromArenaRequested(agentId=${event.params.agentId})`,
    () =>
      zgWalletClient.writeContract({
        address: AGENT_MANAGER_ADDRESS,
        abi: AGENT_MANAGER_ABI,
        functionName: "processWithdrawFromArena",
        args: [event.params.agentId, event.params.caller as `0x${string}`],
      })
  );
});

// ---------------------------------------------------------------------------
// WithdrawalCompleted — index only, no cross-chain relay needed
// Emitted after satellite.release() or releaseQueuedWithdraw() succeeds.
// ---------------------------------------------------------------------------

Satellite.WithdrawalCompleted.handler(async ({ event, context }) => {
  const entity: Satellite_WithdrawalCompleted = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    user: event.params.user,
    tokenAmount: event.params.tokenAmount,
  };
  context.Satellite_WithdrawalCompleted.set(entity);
});
