// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IShared} from "./IShared.sol";

/// @title IAgentManager
/// @notice Agent lifecycle contract on 0G testnet.
///         Handles registration, intent submission, token bucket allocation,
///         Sharpe scoring, promotion, eviction, and iNFT ownership checks.
///
/// Callers:
///   messenger (relayer) — recordRegistration, reportValues, processPause, processCommissionClaim
///   agents (EOAs)       — submitIntent
///   Vault               — settleAgents, setVault (one-time init)
interface IAgentManager {
    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted when an agent submits a valid intent.
    ///         Relayer calls satellite.executeBatch([intent]) on Sepolia.
    event IntentQueued(
        uint256 indexed agentId,
        IShared.ActionType actionType,
        bytes params,
        uint256 blockNumber
    );

    /// @notice Emitted after satellite reports updated position valuations.
    event ValuesReported(uint256 indexed agentId, uint256 positionValue, uint256 feesCollected);

    /// @notice Emitted when an agent is promoted from PROVING to VAULT phase.
    event AgentPromoted(uint256 indexed agentId);

    /// @notice Emitted when an agent is evicted (vault or proving eviction).
    event AgentEvicted(uint256 indexed agentId, bool fullEviction);

    // -------------------------------------------------------------------------
    // Messenger-only functions (called by relayer)
    // -------------------------------------------------------------------------

    /// @notice Registers a new agent and mints an iNFT to the deployer.
    ///         Triggered by satellite's AgentRegistered event.
    function recordRegistration(
        uint256 agentId,
        address agentAddress,
        address deployer,
        uint256 provingAmount
    ) external;

    /// @notice Stores the satellite's reported position valuations for an agent.
    ///         Triggered by satellite's ValuesReported event.
    function reportValues(uint256 agentId, uint256 positionValue, uint256 feesCollected) external;

    /// @notice Sets agent paused flag after iNFT owner calls satellite.pauseAgent().
    ///         Triggered by satellite's PauseRequested event.
    function processPause(uint256 agentId, address caller, bool paused) external;

    /// @notice Verifies iNFT ownership then calls vault.approveCommissionRelease().
    ///         Triggered by satellite's CommissionClaimRequested event.
    function processCommissionClaim(uint256 agentId, address caller) external;

    // -------------------------------------------------------------------------
    // Agent-callable functions
    // -------------------------------------------------------------------------

    /// @notice Submit a liquidity intent for the calling agent.
    ///         - PROVING agents: bounded by provingBalance - provingDeployed
    ///         - VAULT agents: bounded by token bucket credits + vault.idleBalance()
    ///         Emits IntentQueued on success.
    function submitIntent(
        uint256 agentId,
        IShared.ActionType actionType,
        bytes calldata params
    ) external;

    // -------------------------------------------------------------------------
    // Vault-only functions
    // -------------------------------------------------------------------------

    /// @notice One-time setter called after Vault is deployed to complete the
    ///         circular AgentManager <-> Vault reference.
    function setVault(address vault) external;

    /// @notice Called by Vault._settleEpoch() to update EMAs, Sharpe scores,
    ///         token bucket params, handle promotions and evictions.
    ///         Vault passes its own totalAssets and maxExposureRatio so AgentManager
    ///         can compute credit allocations without cross-contract reads.
    ///         Returns per-agent settlement data (Sharpe-sorted, lowest first) and
    ///         aggregate vault-agent position value for totalAssets reconciliation.
    function settleAgents(uint256 totalAssets, uint256 maxExposureRatio)
        external
        returns (IShared.AgentSettlementData[] memory agentData, uint256 aggregateVaultPositionValue);

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /// @notice Returns the EOA address registered for an agent.
    function agentAddress(uint256 agentId) external view returns (address);

    /// @notice Returns the current phase of an agent (PROVING or VAULT).
    function agentPhase(uint256 agentId) external view returns (IShared.AgentPhase);

    /// @notice Returns whether an agent is paused (no new intents accepted).
    function isPaused(uint256 agentId) external view returns (bool);

    /// @notice Returns the current token bucket credits for a vault-phase agent.
    function credits(uint256 agentId) external view returns (uint256);

    /// @notice Returns the Sharpe score (scaled x10000) for an agent.
    function sharpeScore(uint256 agentId) external view returns (uint256);

    /// @notice Returns the proving balance deposited at registration.
    function provingBalance(uint256 agentId) external view returns (uint256);

    /// @notice Returns the amount of proving balance currently deployed.
    function provingDeployed(uint256 agentId) external view returns (uint256);
}
