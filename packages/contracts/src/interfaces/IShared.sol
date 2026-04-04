// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IShared
/// @notice Shared types used by Vault, AgentManager, and Satellite.
///         Import this everywhere instead of redefining structs.
library IShared {
    // -------------------------------------------------------------------------
    // Enums
    // -------------------------------------------------------------------------

    /// @notice Actions an agent can submit as an intent.
    enum ActionType {
        OPEN_POSITION,    // 0 — deploy capital into a new LP range
        CLOSE_POSITION,   // 1 — exit an existing LP position
        MODIFY_POSITION   // 2 — close existing range and re-open at new ticks
    }

    /// @notice Agent lifecycle phase.
    enum AgentPhase {
        PROVING,  // 0 — trading own capital to build track record
        VAULT     // 1 — managing vault funds via token bucket
    }

    /// @notice Source of positions to close in a ForceClose operation.
    ///         Carried from 0G intent → satellite positionSource mapping → recordClosure source param.
    enum ForceCloseSource {
        PROVING, // 0 — close only proving-phase positions (return capital to deployer)
        VAULT,   // 1 — close only vault-phase positions (return capital to idle reserve)
        ALL      // 2 — close all positions regardless of source (withdraw-from-arena)
    }

    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------

    /// @notice Intent submitted by an agent on 0G, relayed to satellite on Sepolia.
    struct Intent {
        uint256    agentId;
        ActionType actionType;
        bytes      params;      // ABI-encoded IntentParams
        uint256    blockNumber; // block.number on 0G when intent was queued
    }

    /// @notice Decoded params inside Intent.params for OPEN / MODIFY.
    ///         For CLOSE, only agentId is needed (close all positions for agent).
    struct IntentParams {
        uint256 amountUSDC; // total USDC.e to deploy (satellite zaps ~50% to token1)
        int24   tickLower;  // Uniswap v3 lower tick bound
        int24   tickUpper;  // Uniswap v3 upper tick bound
    }

    /// @notice Per-agent data returned by AgentManager.settleAgents() to Vault.
    struct AgentSettlementData {
        uint256 agentId;
        uint256 feesCollected; // liquid USDC.e fees from collect() during epoch
        bool    evicted;       // true if agent should be removed this epoch
        bool    promoted;      // true if agent just promoted from PROVING to VAULT
        bool    forceClose;    // true if all positions must be closed (eviction / withdrawal)
    }
}
