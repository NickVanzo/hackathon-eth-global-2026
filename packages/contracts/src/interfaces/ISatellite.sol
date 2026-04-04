// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IShared} from "./IShared.sol";

/// @title ISatellite
/// @notice Token custody + Uniswap execution contract on Ethereum Sepolia.
///         Holds ALL tokens, owns all LP position NFTs, executes Uniswap calls,
///         and handles deposits / withdrawals for users.
///
/// Callers:
///   users               — deposit, registerAgent, requestWithdraw, claimWithdraw,
///                         claimCommissions, pauseAgent, unpauseAgent, withdrawFromArena
///   messenger (relayer) — executeBatch, release, releaseQueuedWithdraw, updateSharePrice,
///                         reserveFees, releaseCommission, forceClose
interface ISatellite {
    // -------------------------------------------------------------------------
    // Events — emitted on Sepolia, watched by relayer → relayed to 0G
    // -------------------------------------------------------------------------

    /// @notice User deposited USDC.e. Relayer calls vault.recordDeposit() on 0G.
    event Deposited(address indexed user, uint256 amount);

    /// @notice New agent registered with proving capital.
    ///         Relayer calls agentManager.recordRegistration() on 0G.
    event AgentRegistered(
        uint256 indexed agentId, address agentAddress, address indexed deployer, uint256 provingAmount
    );

    /// @notice User requested a withdrawal. Relayer calls vault.processWithdraw() on 0G.
    event WithdrawRequested(address indexed user, uint256 tokenAmount);

    /// @notice User withdrawal was completed and funds were released.
    event WithdrawalCompleted(address indexed user, uint256 tokenAmount);

    /// @notice User initiated a Tier-2 claim after epoch settlement freed capital.
    ///         Relayer calls vault.claimWithdraw(user, tokenAmount) on 0G, then
    ///         calls satellite.releaseQueuedWithdraw(user, tokenAmount) on Sepolia.
    event ClaimWithdrawRequested(address indexed user, uint256 tokenAmount);

    /// @notice Satellite reports updated position valuations after executeBatch / epoch collect.
    ///         Relayer calls agentManager.reportValues() on 0G.
    event ValuesReported(uint256 indexed agentId, uint256 positionValue, uint256 feesCollected);

    /// @notice iNFT owner wants to claim commissions.
    ///         Relayer calls agentManager.processCommissionClaim() on 0G.
    event CommissionClaimRequested(uint256 indexed agentId, address indexed caller);

    /// @notice iNFT owner requested pause/unpause.
    ///         Relayer calls agentManager.processPause() on 0G.
    event PauseRequested(uint256 indexed agentId, address indexed caller, bool paused);

    /// @notice iNFT owner requested full arena withdrawal.
    ///         Relayer triggers agentManager withdraw-from-arena flow on 0G.
    event WithdrawFromArenaRequested(uint256 indexed agentId, address indexed caller);

    // -------------------------------------------------------------------------
    // User-callable functions
    // -------------------------------------------------------------------------

    /// @notice Deposit USDC.e into the vault. Emits Deposited.
    ///         Relayer mints shares on 0G via vault.recordDeposit().
    function deposit(uint256 amount) external;

    /// @notice Register a new agent with proving capital. Emits AgentRegistered.
    ///         Relayer mints iNFT and records agent on 0G.
    function registerAgent(address agentAddress, uint256 provingAmount) external;

    /// @notice Request a withdrawal. Emits WithdrawRequested.
    ///         Tier 1 (fits idle reserve): relayer triggers instant release.
    ///         Tier 2 (exceeds reserve): shares locked, fulfilled next epoch.
    function requestWithdraw(uint256 tokenAmount) external;

    /// @notice Initiate a Tier-2 withdrawal claim after vault has approved it.
    ///         Emits ClaimWithdrawRequested — relayer processes the actual transfer.
    ///         Clears the internal pending entry to prevent double-claiming.
    function claimWithdraw() external;

    /// @notice iNFT owner initiates commission claim. Emits CommissionClaimRequested.
    ///         Relayer verifies ownership on 0G; satellite pays on approval.
    function claimCommissions(uint256 agentId) external;

    /// @notice iNFT owner pauses the agent. Emits PauseRequested.
    function pauseAgent(uint256 agentId) external;

    /// @notice iNFT owner unpauses the agent. Emits PauseRequested(paused=false).
    function unpauseAgent(uint256 agentId) external;

    /// @notice iNFT owner permanently removes agent from vault. Emits WithdrawFromArenaRequested.
    ///         Forces all positions closed; proving capital returned to deployer.
    function withdrawFromArena(uint256 agentId) external;

    // -------------------------------------------------------------------------
    // Messenger-only functions (called by relayer)
    // -------------------------------------------------------------------------

    /// @notice Execute a batch of intents from the 0G intent queue.
    ///         For each OPEN intent: zap-in (Universal Router) + mint LP (NonfungiblePositionManager).
    ///         For each CLOSE intent: collect fees + decreaseLiquidity + zap-out.
    ///         For each MODIFY intent: close existing + open new range.
    ///         Emits ValuesReported after execution.
    function executeBatch(IShared.Intent[] calldata intents) external;

    /// @notice Release tokens to a user after vault.processWithdraw() approves (Tier-1).
    ///         Also used for Tier-2 approvals at epoch time.
    ///         Triggered by vault's WithdrawApproved event.
    function release(address user, uint256 tokenAmount) external;

    /// @notice Complete a Tier-2 withdrawal after the user has claimed.
    ///         Called by relayer after vault.claimWithdraw() marks the entry processed.
    ///         Transfers tokens to user and emits WithdrawalCompleted.
    function releaseQueuedWithdraw(address user, uint256 tokenAmount) external;

    /// @notice Cache the latest share price from vault's EpochSettled event.
    ///         Used by requestWithdraw() to convert token amounts to shares.
    function updateSharePrice(uint256 sharePrice) external;

    /// @notice Set aside fees into separate reserve pools so they don't mix with
    ///         the idle reserve or agent allocations.
    ///         Triggered by vault's ProtocolFeeAccrued + CommissionAccrued events.
    function reserveFees(uint256 protocolFeeAmount, uint256 agentId, uint256 commissionAmount) external;

    /// @notice Pay commission to iNFT owner from commissionReserve.
    ///         Triggered by vault's CommissionApproved event.
    function releaseCommission(address caller, uint256 amount) external;

    /// @notice Force-close positions for an agent (eviction, withdrawal, or arena exit).
    ///         positionIds: relayer-provided list from its local cache.
    ///         source: filters which positions to close (PROVING, VAULT, or ALL).
    ///         Vault-funded capital returns to idle; proving capital returns to deployer.
    function forceClose(
        uint256 agentId,
        uint256[] calldata positionIds,
        IShared.ForceCloseSource source
    ) external;

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /// @notice Current idle USDC.e balance (not deployed in any LP position).
    function idleBalance() external view returns (uint256);

    /// @notice Cached share price from last EpochSettled (used for withdrawals).
    function cachedSharePrice() external view returns (uint256);

    /// @notice Total USDC.e in the protocol reserve (protocol fees waiting to be claimed).
    function protocolReserve() external view returns (uint256);

    /// @notice Commission USDC.e reserved for a specific agent's iNFT owner.
    function commissionReserve(uint256 agentId) external view returns (uint256);
}
