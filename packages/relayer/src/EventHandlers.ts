/**
 * EventHandlers.ts — Envio indexer entry point for Agent Arena.
 *
 * This file registers all event handlers split across three modules:
 *
 *   satelliteHandlers       — Satellite (Sepolia) events  →  0G contract calls
 *   vaultHandlers           — Vault (0G) events            →  Sepolia contract calls
 *   agentManagerHandlers    — AgentManager (0G) events     →  Sepolia contract calls
 *
 * Each handler does two things:
 *   1. Persists the event in the Envio DB (indexed entity via context.*.set)
 *   2. Relays the cross-chain message by sending a transaction on the peer chain
 *
 * Cross-chain relay map (per ethglobal-cannes-2026.md):
 *
 * SATELLITE → 0G
 *   Deposited                → vault.recordDeposit()
 *   AgentRegistered          → agentManager.recordRegistration()
 *   WithdrawRequested        → vault.processWithdraw()
 *   ClaimWithdrawRequested   → vault.claimWithdraw() + satellite.releaseQueuedWithdraw()
 *   ValuesReported           → agentManager.reportValues()
 *   PositionClosed           → agentManager.recordClosure() + vault.recordRecovery()
 *   CommissionClaimRequested → agentManager.processCommissionClaim()
 *   PauseRequested           → agentManager.processPause()
 *   WithdrawFromArenaRequested → agentManager.processWithdrawFromArena()
 *   WithdrawalCompleted      → indexed only
 *
 * VAULT (0G) → SATELLITE (Sepolia)
 *   EpochSettled             → satellite.updateSharePrice()
 *   WithdrawApproved         → satellite.release()
 *   CommissionApproved       → satellite.releaseCommission()
 *   ProtocolFeeAccrued       → satellite.reserveProtocolFees()
 *   CommissionAccrued        → satellite.reserveCommission()
 *   ForceCloseRequested      → satellite.forceClose() (with Uniswap API calldata)
 *   WithdrawReleased         → indexed only
 *   RecoveryRecorded         → indexed only
 *   Transfer                 → indexed only
 *   Approval                 → indexed only
 *
 * AGENT MANAGER (0G) → SATELLITE (Sepolia)
 *   IntentQueued             → Uniswap Trading API (POST /quote + /swap) → satellite.executeBatch()
 *   ForceCloseRequested      → satellite.forceClose() (eviction / arena-exit)
 *   AgentPromoted            → indexed only
 *   AgentEvicted             → indexed only
 */

// Register all Satellite event handlers
import "./handlers/satelliteHandlers";

// Register all Vault event handlers
import "./handlers/vaultHandlers";

// Register all AgentManager event handlers
import "./handlers/agentManagerHandlers";
