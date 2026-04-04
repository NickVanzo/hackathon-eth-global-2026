/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
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
  const entity: Satellite_PositionClosed = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    agentId: event.params.agentId,
    positionId: event.params.positionId,
    recoveredAmount: event.params.recoveredAmount,
  };

  context.Satellite_PositionClosed.set(entity);
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
  const entity: Vault_EpochSettled = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    sharePrice: event.params.sharePrice,
    totalShares: event.params.totalShares,
    totalAssets: event.params.totalAssets,
  };

  context.Vault_EpochSettled.set(entity);
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
