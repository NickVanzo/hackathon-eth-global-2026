/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 */
import {
  AgentManager,
  AgentManager_AgentEvicted,
  AgentManager_AgentPromoted,
  AgentManager_ForceCloseRequested,
  AgentManager_IntentQueued,
  AgentManager_ValuesReported,
  Satellite,
  Satellite_AgentRegistered,
  Satellite_ClaimWithdrawRequested,
  Satellite_CommissionClaimRequested,
  Satellite_Deposited,
  Satellite_PauseRequested,
  Satellite_PositionClosed,
  Satellite_PositionOpened,
  Satellite_ValuesReported,
  Satellite_WithdrawFromArenaRequested,
  Satellite_WithdrawRequested,
  Satellite_WithdrawalCompleted,
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
  AgentPerformanceSnapshot,
  IndexedPosition,
  IndexedIntent,
  FeeEpochHistory,
  EpochCounter,
  AgentCumulativeFees,
} from "generated";

// ---------------------------------------------------------------------------
// Helper: map uint8 actionType to string
// ---------------------------------------------------------------------------
const ACTION_TYPE_MAP: Record<number, string> = {
  0: "OPEN_POSITION",
  1: "MODIFY_POSITION",
  2: "CLOSE_POSITION",
};

// ---------------------------------------------------------------------------
// AgentManager handlers
// ---------------------------------------------------------------------------

AgentManager.AgentEvicted.handler(async ({ event, context }) => {
  const entity: AgentManager_AgentEvicted = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    fullEviction: event.params.fullEviction,
  };
  context.AgentManager_AgentEvicted.set(entity);
});

AgentManager.AgentPromoted.handler(async ({ event, context }) => {
  const entity: AgentManager_AgentPromoted = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
  };
  context.AgentManager_AgentPromoted.set(entity);
});

AgentManager.ForceCloseRequested.handler(async ({ event, context }) => {
  const entity: AgentManager_ForceCloseRequested = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    source: event.params.source,
  };
  context.AgentManager_ForceCloseRequested.set(entity);
});

AgentManager.IntentQueued.handler(async ({ event, context }) => {
  // Raw event
  const entity: AgentManager_IntentQueued = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    actionType: event.params.actionType,
    params: event.params.params,
    blockNumber: event.params.blockNumber,
  };
  context.AgentManager_IntentQueued.set(entity);

  // Derived: IndexedIntent
  const actionTypeStr =
    ACTION_TYPE_MAP[Number(event.params.actionType)] ?? `UNKNOWN_${event.params.actionType}`;

  const intent: IndexedIntent = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    actionType: actionTypeStr,
    status: "pending",
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash ?? "",
    blockNumber: BigInt(event.block.number),
  };
  context.IndexedIntent.set(intent);
});

AgentManager.ValuesReported.handler(async ({ event, context }) => {
  // Raw event
  const entity: AgentManager_ValuesReported = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    positionValue: event.params.positionValue,
    feesCollected: event.params.feesCollected,
  };
  context.AgentManager_ValuesReported.set(entity);

  // Derived: AgentPerformanceSnapshot
  const agentIdStr = event.params.agentId.toString();
  const cumulativeId = `agent_cumulative_${agentIdStr}`;

  let cumulative = await context.AgentCumulativeFees.get(cumulativeId);
  const currentFees = event.params.feesCollected;

  let newCumulativeFees: bigint;
  let initialPV: bigint;
  if (cumulative) {
    newCumulativeFees = cumulative.cumulativeFees + currentFees;
    initialPV = cumulative.initialPositionValue;
  } else {
    newCumulativeFees = currentFees;
    initialPV = event.params.positionValue > 0n ? event.params.positionValue : 1n;
  }

  // Update cumulative tracker
  context.AgentCumulativeFees.set({
    id: cumulativeId,
    agentId: event.params.agentId,
    cumulativeFees: newCumulativeFees,
    initialPositionValue: initialPV,
  });

  // returnBps = (cumulativeFees * 10000) / initialPositionValue
  const returnBps =
    initialPV > 0n ? Number((newCumulativeFees * 10000n) / initialPV) : 0;

  const snapshot: AgentPerformanceSnapshot = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    positionValue: event.params.positionValue,
    feesCollected: currentFees,
    cumulativeFees: newCumulativeFees,
    blockNumber: BigInt(event.block.number),
    blockTimestamp: BigInt(event.block.timestamp),
    returnBps,
  };
  context.AgentPerformanceSnapshot.set(snapshot);
});

// ---------------------------------------------------------------------------
// Satellite handlers
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
});

Satellite.ClaimWithdrawRequested.handler(async ({ event, context }) => {
  const entity: Satellite_ClaimWithdrawRequested = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    user: event.params.user,
    tokenAmount: event.params.tokenAmount,
  };
  context.Satellite_ClaimWithdrawRequested.set(entity);
});

Satellite.CommissionClaimRequested.handler(async ({ event, context }) => {
  const entity: Satellite_CommissionClaimRequested = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    caller: event.params.caller,
  };
  context.Satellite_CommissionClaimRequested.set(entity);
});

Satellite.Deposited.handler(async ({ event, context }) => {
  const entity: Satellite_Deposited = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    user: event.params.user,
    amount: event.params.amount,
  };
  context.Satellite_Deposited.set(entity);
});

Satellite.PauseRequested.handler(async ({ event, context }) => {
  const entity: Satellite_PauseRequested = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    caller: event.params.caller,
    paused: event.params.paused,
  };
  context.Satellite_PauseRequested.set(entity);
});

Satellite.PositionClosed.handler(async ({ event, context }) => {
  // Raw event
  const entity: Satellite_PositionClosed = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    positionId: event.params.positionId,
    recoveredAmount: event.params.recoveredAmount,
  };
  context.Satellite_PositionClosed.set(entity);

  // Derived: update IndexedPosition status to "closed"
  const posId = `position_${event.params.agentId}_${event.params.positionId}`;
  const existing = await context.IndexedPosition.get(posId);
  if (existing) {
    context.IndexedPosition.set({
      ...existing,
      status: "closed",
      closeTimestamp: BigInt(event.block.timestamp),
    });
  }
});

Satellite.PositionOpened.handler(async ({ event, context }) => {
  // Raw event
  const entity: Satellite_PositionOpened = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    tokenId: event.params.tokenId,
    tickLower: event.params.tickLower,
    tickUpper: event.params.tickUpper,
    liquidity: event.params.liquidity,
    amountUSDC: event.params.amountUSDC,
  };
  context.Satellite_PositionOpened.set(entity);

  // Derived: IndexedPosition
  const position: IndexedPosition = {
    id: `position_${event.params.agentId}_${event.params.tokenId}`,
    agentId: event.params.agentId,
    tokenId: event.params.tokenId,
    tickLower: Number(event.params.tickLower),
    tickUpper: Number(event.params.tickUpper),
    liquidity: event.params.liquidity,
    feesCollected: 0n,
    status: "active",
    openTimestamp: BigInt(event.block.timestamp),
    closeTimestamp: 0n,
  };
  context.IndexedPosition.set(position);
});

Satellite.ValuesReported.handler(async ({ event, context }) => {
  const entity: Satellite_ValuesReported = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    positionValue: event.params.positionValue,
    feesCollected: event.params.feesCollected,
  };
  context.Satellite_ValuesReported.set(entity);
});

Satellite.WithdrawFromArenaRequested.handler(async ({ event, context }) => {
  const entity: Satellite_WithdrawFromArenaRequested = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    caller: event.params.caller,
  };
  context.Satellite_WithdrawFromArenaRequested.set(entity);
});

Satellite.WithdrawRequested.handler(async ({ event, context }) => {
  const entity: Satellite_WithdrawRequested = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    user: event.params.user,
    tokenAmount: event.params.tokenAmount,
  };
  context.Satellite_WithdrawRequested.set(entity);
});

Satellite.WithdrawalCompleted.handler(async ({ event, context }) => {
  const entity: Satellite_WithdrawalCompleted = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    user: event.params.user,
    tokenAmount: event.params.tokenAmount,
  };
  context.Satellite_WithdrawalCompleted.set(entity);
});

// ---------------------------------------------------------------------------
// Vault handlers
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

Vault.CommissionAccrued.handler(async ({ event, context }) => {
  const entity: Vault_CommissionAccrued = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    amount: event.params.amount,
  };
  context.Vault_CommissionAccrued.set(entity);
});

Vault.CommissionApproved.handler(async ({ event, context }) => {
  const entity: Vault_CommissionApproved = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    caller: event.params.caller,
    amount: event.params.amount,
  };
  context.Vault_CommissionApproved.set(entity);
});

Vault.EpochSettled.handler(async ({ event, context }) => {
  // Raw event
  const entity: Vault_EpochSettled = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    sharePrice: event.params.sharePrice,
    totalShares: event.params.totalShares,
    totalAssets: event.params.totalAssets,
  };
  context.Vault_EpochSettled.set(entity);

  // Derived: FeeEpochHistory — increment epoch counter
  const counterId = "epoch_counter";
  let counter = await context.EpochCounter.get(counterId);
  const epochNum = counter ? counter.count + 1 : 1;
  context.EpochCounter.set({ id: counterId, count: epochNum });

  // For now, protocolFee and commission are 0 — they are tracked separately
  // via CommissionAccrued and ProtocolFeeAccrued events. A simple approximation:
  const feeEpoch: FeeEpochHistory = {
    id: `epoch_${epochNum}`,
    epoch: epochNum,
    protocolFee: 0n,
    commission: 0n,
    depositorYield: 0n,
    sharePrice: event.params.sharePrice,
    blockTimestamp: BigInt(event.block.timestamp),
  };
  context.FeeEpochHistory.set(feeEpoch);
});

Vault.ForceCloseRequested.handler(async ({ event, context }) => {
  const entity: Vault_ForceCloseRequested = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    source: event.params.source,
  };
  context.Vault_ForceCloseRequested.set(entity);
});

Vault.ProtocolFeeAccrued.handler(async ({ event, context }) => {
  const entity: Vault_ProtocolFeeAccrued = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    amount: event.params.amount,
  };
  context.Vault_ProtocolFeeAccrued.set(entity);

  // Update the latest FeeEpochHistory with protocol fee
  const counter = await context.EpochCounter.get("epoch_counter");
  if (counter) {
    const epochId = `epoch_${counter.count}`;
    const epoch = await context.FeeEpochHistory.get(epochId);
    if (epoch) {
      context.FeeEpochHistory.set({
        ...epoch,
        protocolFee: epoch.protocolFee + event.params.amount,
      });
    }
  }
});

Vault.RecoveryRecorded.handler(async ({ event, context }) => {
  const entity: Vault_RecoveryRecorded = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    recoveredAmount: event.params.recoveredAmount,
  };
  context.Vault_RecoveryRecorded.set(entity);
});

Vault.Transfer.handler(async ({ event, context }) => {
  const entity: Vault_Transfer = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    from: event.params.from,
    to: event.params.to,
    value: event.params.value,
  };
  context.Vault_Transfer.set(entity);
});

Vault.WithdrawApproved.handler(async ({ event, context }) => {
  const entity: Vault_WithdrawApproved = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    user: event.params.user,
    tokenAmount: event.params.tokenAmount,
  };
  context.Vault_WithdrawApproved.set(entity);
});

Vault.WithdrawReleased.handler(async ({ event, context }) => {
  const entity: Vault_WithdrawReleased = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    user: event.params.user,
    tokenAmount: event.params.tokenAmount,
  };
  context.Vault_WithdrawReleased.set(entity);
});
