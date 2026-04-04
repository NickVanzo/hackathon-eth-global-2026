// SPDX-License-Identifier: MIT
pragma solidity >=0.4.16 >=0.6.2 >=0.8.4 ^0.8.20 ^0.8.24;

// lib/openzeppelin-contracts/contracts/utils/Context.sol

// OpenZeppelin Contracts (last updated v5.0.1) (utils/Context.sol)

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }

    function _contextSuffixLength() internal view virtual returns (uint256) {
        return 0;
    }
}

// lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol

// OpenZeppelin Contracts (last updated v5.4.0) (token/ERC20/IERC20.sol)

/**
 * @dev Interface of the ERC-20 standard as defined in the ERC.
 */
interface IERC20 {
    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a `spender` for an `owner` is set by
     * a call to {approve}. `value` is the new allowance.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /**
     * @dev Returns the value of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the value of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address to, uint256 value) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the
     * allowance mechanism. `value` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

// src/interfaces/IShared.sol

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
    ///         Array is Sharpe-sorted (lowest first) so Vault can target force-closes.
    struct AgentSettlementData {
        uint256 agentId;
        uint256 positionValue; // reported LP position value (vault-phase only; 0 for proving)
        uint256 feesCollected; // liquid USDC.e fees from collect() during epoch
        bool    evicted;       // true if agent should be removed this epoch
        bool    promoted;      // true if agent just promoted from PROVING to VAULT
        bool    forceClose;    // true if all positions must be closed (eviction / withdrawal)
    }
}

// lib/openzeppelin-contracts/contracts/utils/StorageSlot.sol

// OpenZeppelin Contracts (last updated v5.1.0) (utils/StorageSlot.sol)
// This file was procedurally generated from scripts/generate/templates/StorageSlot.js.

/**
 * @dev Library for reading and writing primitive types to specific storage slots.
 *
 * Storage slots are often used to avoid storage conflict when dealing with upgradeable contracts.
 * This library helps with reading and writing to such slots without the need for inline assembly.
 *
 * The functions in this library return Slot structs that contain a `value` member that can be used to read or write.
 *
 * Example usage to set ERC-1967 implementation slot:
 * ```solidity
 * contract ERC1967 {
 *     // Define the slot. Alternatively, use the SlotDerivation library to derive the slot.
 *     bytes32 internal constant _IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
 *
 *     function _getImplementation() internal view returns (address) {
 *         return StorageSlot.getAddressSlot(_IMPLEMENTATION_SLOT).value;
 *     }
 *
 *     function _setImplementation(address newImplementation) internal {
 *         require(newImplementation.code.length > 0);
 *         StorageSlot.getAddressSlot(_IMPLEMENTATION_SLOT).value = newImplementation;
 *     }
 * }
 * ```
 *
 * TIP: Consider using this library along with {SlotDerivation}.
 */
library StorageSlot {
    struct AddressSlot {
        address value;
    }

    struct BooleanSlot {
        bool value;
    }

    struct Bytes32Slot {
        bytes32 value;
    }

    struct Uint256Slot {
        uint256 value;
    }

    struct Int256Slot {
        int256 value;
    }

    struct StringSlot {
        string value;
    }

    struct BytesSlot {
        bytes value;
    }

    /**
     * @dev Returns an `AddressSlot` with member `value` located at `slot`.
     */
    function getAddressSlot(bytes32 slot) internal pure returns (AddressSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `BooleanSlot` with member `value` located at `slot`.
     */
    function getBooleanSlot(bytes32 slot) internal pure returns (BooleanSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Bytes32Slot` with member `value` located at `slot`.
     */
    function getBytes32Slot(bytes32 slot) internal pure returns (Bytes32Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Uint256Slot` with member `value` located at `slot`.
     */
    function getUint256Slot(bytes32 slot) internal pure returns (Uint256Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Int256Slot` with member `value` located at `slot`.
     */
    function getInt256Slot(bytes32 slot) internal pure returns (Int256Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `StringSlot` with member `value` located at `slot`.
     */
    function getStringSlot(bytes32 slot) internal pure returns (StringSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns an `StringSlot` representation of the string storage pointer `store`.
     */
    function getStringSlot(string storage store) internal pure returns (StringSlot storage r) {
        assembly ("memory-safe") {
            r.slot := store.slot
        }
    }

    /**
     * @dev Returns a `BytesSlot` with member `value` located at `slot`.
     */
    function getBytesSlot(bytes32 slot) internal pure returns (BytesSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns an `BytesSlot` representation of the bytes storage pointer `store`.
     */
    function getBytesSlot(bytes storage store) internal pure returns (BytesSlot storage r) {
        assembly ("memory-safe") {
            r.slot := store.slot
        }
    }
}

// lib/openzeppelin-contracts/contracts/interfaces/draft-IERC6093.sol

// OpenZeppelin Contracts (last updated v5.5.0) (interfaces/draft-IERC6093.sol)

/**
 * @dev Standard ERC-20 Errors
 * Interface of the https://eips.ethereum.org/EIPS/eip-6093[ERC-6093] custom errors for ERC-20 tokens.
 */
interface IERC20Errors {
    /**
     * @dev Indicates an error related to the current `balance` of a `sender`. Used in transfers.
     * @param sender Address whose tokens are being transferred.
     * @param balance Current balance for the interacting account.
     * @param needed Minimum amount required to perform a transfer.
     */
    error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed);

    /**
     * @dev Indicates a failure with the token `sender`. Used in transfers.
     * @param sender Address whose tokens are being transferred.
     */
    error ERC20InvalidSender(address sender);

    /**
     * @dev Indicates a failure with the token `receiver`. Used in transfers.
     * @param receiver Address to which tokens are being transferred.
     */
    error ERC20InvalidReceiver(address receiver);

    /**
     * @dev Indicates a failure with the `spender`’s `allowance`. Used in transfers.
     * @param spender Address that may be allowed to operate on tokens without being their owner.
     * @param allowance Amount of tokens a `spender` is allowed to operate with.
     * @param needed Minimum amount required to perform a transfer.
     */
    error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed);

    /**
     * @dev Indicates a failure with the `approver` of a token to be approved. Used in approvals.
     * @param approver Address initiating an approval operation.
     */
    error ERC20InvalidApprover(address approver);

    /**
     * @dev Indicates a failure with the `spender` to be approved. Used in approvals.
     * @param spender Address that may be allowed to operate on tokens without being their owner.
     */
    error ERC20InvalidSpender(address spender);
}

/**
 * @dev Standard ERC-721 Errors
 * Interface of the https://eips.ethereum.org/EIPS/eip-6093[ERC-6093] custom errors for ERC-721 tokens.
 */
interface IERC721Errors {
    /**
     * @dev Indicates that an address can't be an owner. For example, `address(0)` is a forbidden owner in ERC-721.
     * Used in balance queries.
     * @param owner Address of the current owner of a token.
     */
    error ERC721InvalidOwner(address owner);

    /**
     * @dev Indicates a `tokenId` whose `owner` is the zero address.
     * @param tokenId Identifier number of a token.
     */
    error ERC721NonexistentToken(uint256 tokenId);

    /**
     * @dev Indicates an error related to the ownership over a particular token. Used in transfers.
     * @param sender Address whose tokens are being transferred.
     * @param tokenId Identifier number of a token.
     * @param owner Address of the current owner of a token.
     */
    error ERC721IncorrectOwner(address sender, uint256 tokenId, address owner);

    /**
     * @dev Indicates a failure with the token `sender`. Used in transfers.
     * @param sender Address whose tokens are being transferred.
     */
    error ERC721InvalidSender(address sender);

    /**
     * @dev Indicates a failure with the token `receiver`. Used in transfers.
     * @param receiver Address to which tokens are being transferred.
     */
    error ERC721InvalidReceiver(address receiver);

    /**
     * @dev Indicates a failure with the `operator`’s approval. Used in transfers.
     * @param operator Address that may be allowed to operate on tokens without being their owner.
     * @param tokenId Identifier number of a token.
     */
    error ERC721InsufficientApproval(address operator, uint256 tokenId);

    /**
     * @dev Indicates a failure with the `approver` of a token to be approved. Used in approvals.
     * @param approver Address initiating an approval operation.
     */
    error ERC721InvalidApprover(address approver);

    /**
     * @dev Indicates a failure with the `operator` to be approved. Used in approvals.
     * @param operator Address that may be allowed to operate on tokens without being their owner.
     */
    error ERC721InvalidOperator(address operator);
}

/**
 * @dev Standard ERC-1155 Errors
 * Interface of the https://eips.ethereum.org/EIPS/eip-6093[ERC-6093] custom errors for ERC-1155 tokens.
 */
interface IERC1155Errors {
    /**
     * @dev Indicates an error related to the current `balance` of a `sender`. Used in transfers.
     * @param sender Address whose tokens are being transferred.
     * @param balance Current balance for the interacting account.
     * @param needed Minimum amount required to perform a transfer.
     * @param tokenId Identifier number of a token.
     */
    error ERC1155InsufficientBalance(address sender, uint256 balance, uint256 needed, uint256 tokenId);

    /**
     * @dev Indicates a failure with the token `sender`. Used in transfers.
     * @param sender Address whose tokens are being transferred.
     */
    error ERC1155InvalidSender(address sender);

    /**
     * @dev Indicates a failure with the token `receiver`. Used in transfers.
     * @param receiver Address to which tokens are being transferred.
     */
    error ERC1155InvalidReceiver(address receiver);

    /**
     * @dev Indicates a failure with the `operator`’s approval. Used in transfers.
     * @param operator Address that may be allowed to operate on tokens without being their owner.
     * @param owner Address of the current owner of a token.
     */
    error ERC1155MissingApprovalForAll(address operator, address owner);

    /**
     * @dev Indicates a failure with the `approver` of a token to be approved. Used in approvals.
     * @param approver Address initiating an approval operation.
     */
    error ERC1155InvalidApprover(address approver);

    /**
     * @dev Indicates a failure with the `operator` to be approved. Used in approvals.
     * @param operator Address that may be allowed to operate on tokens without being their owner.
     */
    error ERC1155InvalidOperator(address operator);

    /**
     * @dev Indicates an array length mismatch between ids and values in a safeBatchTransferFrom operation.
     * Used in batch transfers.
     * @param idsLength Length of the array of token identifiers
     * @param valuesLength Length of the array of token amounts
     */
    error ERC1155InvalidArrayLength(uint256 idsLength, uint256 valuesLength);
}

// src/interfaces/IAgentManager.sol

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

    /// @notice Running counter of vault capital currently deployed across all vault agents.
    ///         Incremented on intent submission, decremented via recordClosure().
    function totalDeployedVault() external view returns (uint256);
}

// lib/openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol

// OpenZeppelin Contracts (last updated v5.4.0) (token/ERC20/extensions/IERC20Metadata.sol)

/**
 * @dev Interface for the optional metadata functions from the ERC-20 standard.
 */
interface IERC20Metadata is IERC20 {
    /**
     * @dev Returns the name of the token.
     */
    function name() external view returns (string memory);

    /**
     * @dev Returns the symbol of the token.
     */
    function symbol() external view returns (string memory);

    /**
     * @dev Returns the decimals places of the token.
     */
    function decimals() external view returns (uint8);
}

// src/interfaces/IVault.sol

/// @title IVault
/// @notice Accounting-only contract on 0G testnet.
///         Holds shares (ERC20), tracks totalAssets via reported values,
///         and orchestrates epoch settlement. Never holds tokens.
///
/// Callers:
///   messenger (relayer) — recordDeposit, processWithdraw, claimWithdraw,
///                         recordRecovery
///   AgentManager        — approveCommissionRelease
///   Anyone              — triggerSettleEpoch, view functions
interface IVault {
    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted when a Tier-1 or Tier-2 withdrawal is approved.
    ///         For Tier-1: relayer calls satellite.release(user, tokenAmount).
    ///         For Tier-2 (epoch-approved): relayer calls satellite.release(user, tokenAmount).
    event WithdrawApproved(address indexed user, uint256 tokenAmount);

    /// @notice Emitted when a Tier-2 withdrawal has been claimed and processed.
    ///         Relayer calls this after satellite.claimWithdraw() emits ClaimWithdrawRequested.
    event WithdrawReleased(address indexed user, uint256 tokenAmount);

    /// @notice Emitted once per epoch when settlement completes.
    ///         Relayer calls satellite.updateSharePrice(sharePrice) on Sepolia.
    event EpochSettled(uint256 sharePrice, uint256 totalShares, uint256 totalAssets);

    /// @notice Emitted when iNFT owner's commission claim is approved.
    ///         Relayer calls satellite.releaseCommission(caller, amount) on Sepolia.
    event CommissionApproved(uint256 indexed agentId, address indexed caller, uint256 amount);

    /// @notice Emitted at epoch settlement — protocol's cut of collected fees.
    ///         Relayer calls satellite.reserveProtocolFees(amount) on Sepolia.
    event ProtocolFeeAccrued(uint256 amount);

    /// @notice Emitted at epoch settlement — agent commission accrued.
    ///         Relayer calls satellite.reserveCommission(agentId, amount) on Sepolia.
    event CommissionAccrued(uint256 indexed agentId, uint256 amount);

    /// @notice Emitted after a force-close position recovery is recorded.
    ///         Does not change totalAssets — next epoch reconciliation handles it.
    event RecoveryRecorded(uint256 indexed agentId, uint256 recoveredAmount);

    /// @notice Emitted when Vault requests a force-close of an agent's positions.
    ///         Relayer looks up its positionIds cache and calls satellite.forceClose().
    ///         Source = VAULT for withdrawal-driven closures (lowest-Sharpe agents first).
    ///         Also emitted by AgentManager for eviction and withdraw-from-arena closures.
    event ForceCloseRequested(uint256 indexed agentId, IShared.ForceCloseSource source);

    // -------------------------------------------------------------------------
    // Messenger-only functions (called by relayer)
    // -------------------------------------------------------------------------

    /// @notice Records a deposit from Sepolia; mints shares to user on 0G.
    ///         Triggered by satellite's Deposited event.
    function recordDeposit(address user, uint256 amount) external;

    /// @notice Burns shares and emits WithdrawApproved so relayer can release tokens.
    ///         Triggered by satellite's WithdrawRequested event.
    function processWithdraw(address user, uint256 shares) external;

    /// @notice Called by relayer after satellite emits ClaimWithdrawRequested.
    ///         Marks the Tier-2 queued withdrawal as processed; emits WithdrawReleased.
    ///         Relayer then calls satellite.releaseQueuedWithdraw(user, tokenAmount).
    function claimWithdraw(address user, uint256 tokenAmount) external;

    /// @notice Records a force-close recovery relayed from Satellite.
    ///         Does NOT update totalAssets — next epoch's settleAgents() reconciliation handles it.
    ///         Emits RecoveryRecorded for audit.
    function recordRecovery(uint256 agentId, uint256 recoveredAmount) external;

    // -------------------------------------------------------------------------
    // AgentManager-only functions
    // -------------------------------------------------------------------------

    /// @notice Called by AgentManager after verifying iNFT ownership.
    ///         Reads commissionsOwed[agentId] from its own state, zeroes it,
    ///         and emits CommissionApproved. No amount param — Vault owns the data.
    /// @param agentId  The agent whose commission is being released.
    /// @param caller   The iNFT owner who initiated the claim (for the event).
    function approveCommissionRelease(uint256 agentId, address caller) external;

    // -------------------------------------------------------------------------
    // Public functions (callable by anyone, including relayer)
    // -------------------------------------------------------------------------

    /// @notice Trigger epoch settlement when due.
    ///         Called by the relayer once per epoch in its main loop.
    ///         Also triggered lazily by epochCheck on recordDeposit / processWithdraw.
    ///         No-op if called before the epoch boundary or while settling.
    function triggerSettleEpoch() external;

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /// @notice Total assets under management (sum of reported position values + idle).
    function totalAssets() external view returns (uint256);

    /// @notice Current share price = totalAssets * 1e18 / totalSupply.
    function sharePrice() external view returns (uint256);

    /// @notice Vault's tracked idle balance (totalAssets minus deployed capital estimate).
    function idleBalance() external view returns (uint256);

    /// @notice ERC20 share balance of a user.
    function balanceOf(address user) external view returns (uint256 shares);

    /// @notice Total shares in circulation.
    function totalSupply() external view returns (uint256);

    /// @notice Pending withdrawal amount queued for a user (Tier 2).
    function pendingWithdrawal(address user) external view returns (uint256 tokenAmount);

    /// @notice Commissions owed to an agent's iNFT owner (claimable on Sepolia).
    function commissionsOwed(uint256 agentId) external view returns (uint256);

    /// @notice Deposit token address (stored for dashboard reads; Vault never calls it).
    function depositToken() external view returns (address);

    /// @notice Pool address (stored for dashboard reads; Vault never calls it).
    function pool() external view returns (address);
}

// lib/openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol

// OpenZeppelin Contracts (last updated v5.5.0) (utils/ReentrancyGuard.sol)

/**
 * @dev Contract module that helps prevent reentrant calls to a function.
 *
 * Inheriting from `ReentrancyGuard` will make the {nonReentrant} modifier
 * available, which can be applied to functions to make sure there are no nested
 * (reentrant) calls to them.
 *
 * Note that because there is a single `nonReentrant` guard, functions marked as
 * `nonReentrant` may not call one another. This can be worked around by making
 * those functions `private`, and then adding `external` `nonReentrant` entry
 * points to them.
 *
 * TIP: If EIP-1153 (transient storage) is available on the chain you're deploying at,
 * consider using {ReentrancyGuardTransient} instead.
 *
 * TIP: If you would like to learn more about reentrancy and alternative ways
 * to protect against it, check out our blog post
 * https://blog.openzeppelin.com/reentrancy-after-istanbul/[Reentrancy After Istanbul].
 *
 * IMPORTANT: Deprecated. This storage-based reentrancy guard will be removed and replaced
 * by the {ReentrancyGuardTransient} variant in v6.0.
 *
 * @custom:stateless
 */
abstract contract ReentrancyGuard {
    using StorageSlot for bytes32;

    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.ReentrancyGuard")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant REENTRANCY_GUARD_STORAGE =
        0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00;

    // Booleans are more expensive than uint256 or any type that takes up a full
    // word because each write operation emits an extra SLOAD to first read the
    // slot's contents, replace the bits taken up by the boolean, and then write
    // back. This is the compiler's defense against contract upgrades and
    // pointer aliasing, and it cannot be disabled.

    // The values being non-zero value makes deployment a bit more expensive,
    // but in exchange the refund on every call to nonReentrant will be lower in
    // amount. Since refunds are capped to a percentage of the total
    // transaction's gas, it is best to keep them low in cases like this one, to
    // increase the likelihood of the full refund coming into effect.
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    /**
     * @dev Unauthorized reentrant call.
     */
    error ReentrancyGuardReentrantCall();

    constructor() {
        _reentrancyGuardStorageSlot().getUint256Slot().value = NOT_ENTERED;
    }

    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     * Calling a `nonReentrant` function from another `nonReentrant`
     * function is not supported. It is possible to prevent this from happening
     * by making the `nonReentrant` function external, and making it call a
     * `private` function that does the actual work.
     */
    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    /**
     * @dev A `view` only version of {nonReentrant}. Use to block view functions
     * from being called, preventing reading from inconsistent contract state.
     *
     * CAUTION: This is a "view" modifier and does not change the reentrancy
     * status. Use it only on view functions. For payable or non-payable functions,
     * use the standard {nonReentrant} modifier instead.
     */
    modifier nonReentrantView() {
        _nonReentrantBeforeView();
        _;
    }

    function _nonReentrantBeforeView() private view {
        if (_reentrancyGuardEntered()) {
            revert ReentrancyGuardReentrantCall();
        }
    }

    function _nonReentrantBefore() private {
        // On the first call to nonReentrant, _status will be NOT_ENTERED
        _nonReentrantBeforeView();

        // Any calls to nonReentrant after this point will fail
        _reentrancyGuardStorageSlot().getUint256Slot().value = ENTERED;
    }

    function _nonReentrantAfter() private {
        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        _reentrancyGuardStorageSlot().getUint256Slot().value = NOT_ENTERED;
    }

    /**
     * @dev Returns true if the reentrancy guard is currently set to "entered", which indicates there is a
     * `nonReentrant` function in the call stack.
     */
    function _reentrancyGuardEntered() internal view returns (bool) {
        return _reentrancyGuardStorageSlot().getUint256Slot().value == ENTERED;
    }

    function _reentrancyGuardStorageSlot() internal pure virtual returns (bytes32) {
        return REENTRANCY_GUARD_STORAGE;
    }
}

// lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol

// OpenZeppelin Contracts (last updated v5.5.0) (token/ERC20/ERC20.sol)

/**
 * @dev Implementation of the {IERC20} interface.
 *
 * This implementation is agnostic to the way tokens are created. This means
 * that a supply mechanism has to be added in a derived contract using {_mint}.
 *
 * TIP: For a detailed writeup see our guide
 * https://forum.openzeppelin.com/t/how-to-implement-erc20-supply-mechanisms/226[How
 * to implement supply mechanisms].
 *
 * The default value of {decimals} is 18. To change this, you should override
 * this function so it returns a different value.
 *
 * We have followed general OpenZeppelin Contracts guidelines: functions revert
 * instead returning `false` on failure. This behavior is nonetheless
 * conventional and does not conflict with the expectations of ERC-20
 * applications.
 */
abstract contract ERC20 is Context, IERC20, IERC20Metadata, IERC20Errors {
    mapping(address account => uint256) private _balances;

    mapping(address account => mapping(address spender => uint256)) private _allowances;

    uint256 private _totalSupply;

    string private _name;
    string private _symbol;

    /**
     * @dev Sets the values for {name} and {symbol}.
     *
     * Both values are immutable: they can only be set once during construction.
     */
    constructor(string memory name_, string memory symbol_) {
        _name = name_;
        _symbol = symbol_;
    }

    /**
     * @dev Returns the name of the token.
     */
    function name() public view virtual returns (string memory) {
        return _name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public view virtual returns (string memory) {
        return _symbol;
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     * For example, if `decimals` equals `2`, a balance of `505` tokens should
     * be displayed to a user as `5.05` (`505 / 10 ** 2`).
     *
     * Tokens usually opt for a value of 18, imitating the relationship between
     * Ether and Wei. This is the default value returned by this function, unless
     * it's overridden.
     *
     * NOTE: This information is only used for _display_ purposes: it in
     * no way affects any of the arithmetic of the contract, including
     * {IERC20-balanceOf} and {IERC20-transfer}.
     */
    function decimals() public view virtual returns (uint8) {
        return 18;
    }

    /// @inheritdoc IERC20
    function totalSupply() public view virtual returns (uint256) {
        return _totalSupply;
    }

    /// @inheritdoc IERC20
    function balanceOf(address account) public view virtual returns (uint256) {
        return _balances[account];
    }

    /**
     * @dev See {IERC20-transfer}.
     *
     * Requirements:
     *
     * - `to` cannot be the zero address.
     * - the caller must have a balance of at least `value`.
     */
    function transfer(address to, uint256 value) public virtual returns (bool) {
        address owner = _msgSender();
        _transfer(owner, to, value);
        return true;
    }

    /// @inheritdoc IERC20
    function allowance(address owner, address spender) public view virtual returns (uint256) {
        return _allowances[owner][spender];
    }

    /**
     * @dev See {IERC20-approve}.
     *
     * NOTE: If `value` is the maximum `uint256`, the allowance is not updated on
     * `transferFrom`. This is semantically equivalent to an infinite approval.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     */
    function approve(address spender, uint256 value) public virtual returns (bool) {
        address owner = _msgSender();
        _approve(owner, spender, value);
        return true;
    }

    /**
     * @dev See {IERC20-transferFrom}.
     *
     * Skips emitting an {Approval} event indicating an allowance update. This is not
     * required by the ERC. See {xref-ERC20-_approve-address-address-uint256-bool-}[_approve].
     *
     * NOTE: Does not update the allowance if the current allowance
     * is the maximum `uint256`.
     *
     * Requirements:
     *
     * - `from` and `to` cannot be the zero address.
     * - `from` must have a balance of at least `value`.
     * - the caller must have allowance for ``from``'s tokens of at least
     * `value`.
     */
    function transferFrom(address from, address to, uint256 value) public virtual returns (bool) {
        address spender = _msgSender();
        _spendAllowance(from, spender, value);
        _transfer(from, to, value);
        return true;
    }

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to`.
     *
     * This internal function is equivalent to {transfer}, and can be used to
     * e.g. implement automatic token fees, slashing mechanisms, etc.
     *
     * Emits a {Transfer} event.
     *
     * NOTE: This function is not virtual, {_update} should be overridden instead.
     */
    function _transfer(address from, address to, uint256 value) internal {
        if (from == address(0)) {
            revert ERC20InvalidSender(address(0));
        }
        if (to == address(0)) {
            revert ERC20InvalidReceiver(address(0));
        }
        _update(from, to, value);
    }

    /**
     * @dev Transfers a `value` amount of tokens from `from` to `to`, or alternatively mints (or burns) if `from`
     * (or `to`) is the zero address. All customizations to transfers, mints, and burns should be done by overriding
     * this function.
     *
     * Emits a {Transfer} event.
     */
    function _update(address from, address to, uint256 value) internal virtual {
        if (from == address(0)) {
            // Overflow check required: The rest of the code assumes that totalSupply never overflows
            _totalSupply += value;
        } else {
            uint256 fromBalance = _balances[from];
            if (fromBalance < value) {
                revert ERC20InsufficientBalance(from, fromBalance, value);
            }
            unchecked {
                // Overflow not possible: value <= fromBalance <= totalSupply.
                _balances[from] = fromBalance - value;
            }
        }

        if (to == address(0)) {
            unchecked {
                // Overflow not possible: value <= totalSupply or value <= fromBalance <= totalSupply.
                _totalSupply -= value;
            }
        } else {
            unchecked {
                // Overflow not possible: balance + value is at most totalSupply, which we know fits into a uint256.
                _balances[to] += value;
            }
        }

        emit Transfer(from, to, value);
    }

    /**
     * @dev Creates a `value` amount of tokens and assigns them to `account`, by transferring it from address(0).
     * Relies on the `_update` mechanism
     *
     * Emits a {Transfer} event with `from` set to the zero address.
     *
     * NOTE: This function is not virtual, {_update} should be overridden instead.
     */
    function _mint(address account, uint256 value) internal {
        if (account == address(0)) {
            revert ERC20InvalidReceiver(address(0));
        }
        _update(address(0), account, value);
    }

    /**
     * @dev Destroys a `value` amount of tokens from `account`, lowering the total supply.
     * Relies on the `_update` mechanism.
     *
     * Emits a {Transfer} event with `to` set to the zero address.
     *
     * NOTE: This function is not virtual, {_update} should be overridden instead
     */
    function _burn(address account, uint256 value) internal {
        if (account == address(0)) {
            revert ERC20InvalidSender(address(0));
        }
        _update(account, address(0), value);
    }

    /**
     * @dev Sets `value` as the allowance of `spender` over the `owner`'s tokens.
     *
     * This internal function is equivalent to `approve`, and can be used to
     * e.g. set automatic allowances for certain subsystems, etc.
     *
     * Emits an {Approval} event.
     *
     * Requirements:
     *
     * - `owner` cannot be the zero address.
     * - `spender` cannot be the zero address.
     *
     * Overrides to this logic should be done to the variant with an additional `bool emitEvent` argument.
     */
    function _approve(address owner, address spender, uint256 value) internal {
        _approve(owner, spender, value, true);
    }

    /**
     * @dev Variant of {_approve} with an optional flag to enable or disable the {Approval} event.
     *
     * By default (when calling {_approve}) the flag is set to true. On the other hand, approval changes made by
     * `_spendAllowance` during the `transferFrom` operation sets the flag to false. This saves gas by not emitting any
     * `Approval` event during `transferFrom` operations.
     *
     * Anyone who wishes to continue emitting `Approval` events on the `transferFrom` operation can force the flag to
     * true using the following override:
     *
     * ```solidity
     * function _approve(address owner, address spender, uint256 value, bool) internal virtual override {
     *     super._approve(owner, spender, value, true);
     * }
     * ```
     *
     * Requirements are the same as {_approve}.
     */
    function _approve(address owner, address spender, uint256 value, bool emitEvent) internal virtual {
        if (owner == address(0)) {
            revert ERC20InvalidApprover(address(0));
        }
        if (spender == address(0)) {
            revert ERC20InvalidSpender(address(0));
        }
        _allowances[owner][spender] = value;
        if (emitEvent) {
            emit Approval(owner, spender, value);
        }
    }

    /**
     * @dev Updates `owner`'s allowance for `spender` based on spent `value`.
     *
     * Does not update the allowance value in case of infinite allowance.
     * Revert if not enough allowance is available.
     *
     * Does not emit an {Approval} event.
     */
    function _spendAllowance(address owner, address spender, uint256 value) internal virtual {
        uint256 currentAllowance = allowance(owner, spender);
        if (currentAllowance < type(uint256).max) {
            if (currentAllowance < value) {
                revert ERC20InsufficientAllowance(spender, currentAllowance, value);
            }
            unchecked {
                _approve(owner, spender, currentAllowance - value, false);
            }
        }
    }
}

// src/Vault.sol

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

/// @title Vault
/// @notice Accounting-only contract on 0G testnet.
///
///   Holds shares (ERC20), tracks totalAssets via reported position values,
///   orchestrates epoch settlement, and manages the fee waterfall.
///   NEVER holds tokens — all USDC.e lives on the Satellite (Sepolia).
///
/// Section 3.1 — ERC20 shares + access control + constructor
/// Section 3.2 — Deposit accounting: recordDeposit, totalAssets, sharePrice, idleBalance
/// Section 3.3 — Withdrawal system: processWithdraw (Tier-1/2), approveCommissionRelease
/// Section 3.4 — Epoch settlement: epochCheck, triggerSettleEpoch, _settleEpoch, fee waterfall
contract Vault is IVault, ERC20, ReentrancyGuard {

    // =========================================================================
    // 3.1 — ERC20 SHARES + ACCESS CONTROL + CONSTRUCTOR
    // =========================================================================

    // -------------------------------------------------------------------------
    // Immutables
    // -------------------------------------------------------------------------

    /// @notice Relayer EOA (hackathon) or permissionless relayer contract (production).
    address public immutable messenger;

    /// @notice AgentManager contract on 0G — called during epoch settlement.
    ///         Mutable so it can be pointed at a redeployed AgentManager without
    ///         redeploying the Vault. Only the deployer can update it.
    address public agentManager;

    /// @notice Original deployer — only address allowed to call setAgentManager().
    address public immutable deployer;

    /// @notice Address that receives protocol fee notifications (on Sepolia via relayer).
    address public immutable protocolTreasury;

    /// @notice Epoch length in blocks. Settlement triggers lazily on first action after expiry.
    uint256 public immutable epochLength;

    /// @notice Protocol's share of collected fees, in basis points (e.g. 500 = 5 %).
    uint256 public immutable protocolFeeRate;

    /// @notice Agent iNFT owner's share of remaining fees, in basis points (e.g. 1000 = 10 %).
    uint256 public immutable commissionRate;

    /// @notice Maximum fraction of totalAssets that may be deployed across all agents,
    ///         in basis points (e.g. 8000 = 80 %).
    uint256 public immutable maxExposureRatio;

    /// @notice Deposit token address (stored for dashboard reads; Vault never calls it).
    address public immutable depositToken;

    /// @notice Pool address (stored for dashboard reads; Vault never calls it).
    address public immutable pool;

    // -------------------------------------------------------------------------
    // State: accounting
    // -------------------------------------------------------------------------

    /// @notice Total USDC.e value owned by depositors (principal + depositor fees - withdrawals).
    ///         Does NOT include protocol fees or commissions — those are reserved on Satellite.
    uint256 internal _trackedTotalAssets;

    /// @notice Shares locked per user for Tier-2 withdrawals (held by vault until fulfillment).
    mapping(address user => uint256 shares) internal _pendingShareLocks;

    /// @notice Epoch number when a user's Tier-2 withdrawal was queued.
    mapping(address user => uint256 epoch) internal _pendingEpochs;

    // -------------------------------------------------------------------------
    // State: epoch
    // -------------------------------------------------------------------------

    /// @notice Block number at which the last epoch settled.
    uint256 public lastEpochBlock;

    /// @notice Monotonically increasing epoch counter (starts at 0).
    uint256 public currentEpoch;

    /// @dev Guards against re-entrant epoch settlement triggered by external calls.
    bool private _settling;

    // -------------------------------------------------------------------------
    // State: fee accrual
    // -------------------------------------------------------------------------

    /// @notice Cumulative protocol fees accrued (informational; satellite holds the USDC.e).
    uint256 public protocolFeesAccrued;

    /// @notice Commission owed to each agent's iNFT owner (claimable via satellite).
    ///         Public mapping — auto-getter satisfies IVault.commissionsOwed().
    mapping(uint256 agentId => uint256 amount) public commissionsOwed;

    // -------------------------------------------------------------------------
    // State: withdrawal queue (Tier-2)
    // -------------------------------------------------------------------------

    /// @notice Queued Tier-2 withdrawal amounts per user.
    mapping(address user => uint256 tokenAmount) internal _pendingWithdrawals;

    /// @notice Ordered list of users with pending Tier-2 withdrawals.
    address[] internal _pendingUsers;

    /// @notice Whether a user is already tracked in _pendingUsers (prevents duplicates).
    mapping(address user => bool) internal _inPendingQueue;

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyMessenger() {
        require(msg.sender == messenger, "Vault: not messenger");
        _;
    }

    modifier onlyAgentManager() {
        require(msg.sender == agentManager, "Vault: not agentManager");
        _;
    }

    modifier onlyDeployer() {
        require(msg.sender == deployer, "Vault: not deployer");
        _;
    }

    /// @dev Lazily triggers epoch settlement when the epoch window has elapsed.
    ///      Guarded by _settling to prevent re-entrancy from AgentManager callbacks.
    modifier epochCheck() {
        if (!_settling && block.number >= lastEpochBlock + epochLength) {
            _settleEpoch();
        }
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param _agentManager       AgentManager address on 0G.
    /// @param _epochLength        Settlement cadence in blocks (e.g. 7200 ≈ 1 day).
    /// @param _maxExposureRatio   Max deployable fraction of assets (bps, e.g. 8000 = 80 %).
    /// @param _protocolFeeRate    Protocol cut of collected fees (bps, e.g. 500 = 5 %).
    /// @param _protocolTreasury   Address that receives protocol fee signals on Sepolia.
    /// @param _commissionRate     Agent iNFT owner cut of remaining fees (bps, e.g. 1000 = 10 %).
    /// @param _depositToken       USDC.e address (stored for dashboard reads; Vault never calls it).
    /// @param _pool               Uniswap pool address (stored for dashboard reads only).
    /// @param _messenger          Trusted relayer address.
    constructor(
        address _agentManager,
        uint256 _epochLength,
        uint256 _maxExposureRatio,
        uint256 _protocolFeeRate,
        address _protocolTreasury,
        uint256 _commissionRate,
        address _depositToken,
        address _pool,
        address _messenger
    ) ERC20("Agent Arena Shares", "AAS") {
        require(_agentManager     != address(0), "Vault: zero agentManager");
        require(_protocolTreasury != address(0), "Vault: zero treasury");
        require(_messenger        != address(0), "Vault: zero messenger");
        require(_depositToken     != address(0), "Vault: zero depositToken");
        require(_pool             != address(0), "Vault: zero pool");
        require(_epochLength      >  0,          "Vault: zero epochLength");
        require(_protocolFeeRate  <= 10_000,     "Vault: protocolFeeRate > 100%");
        require(_commissionRate   <= 10_000,     "Vault: commissionRate > 100%");
        require(_maxExposureRatio <= 10_000,     "Vault: maxExposureRatio > 100%");

        deployer         = msg.sender;
        agentManager     = _agentManager;
        epochLength      = _epochLength;
        maxExposureRatio = _maxExposureRatio;
        protocolFeeRate  = _protocolFeeRate;
        protocolTreasury = _protocolTreasury;
        commissionRate   = _commissionRate;
        depositToken     = _depositToken;
        pool             = _pool;
        messenger        = _messenger;

        lastEpochBlock = block.number;
    }

    // -------------------------------------------------------------------------
    // ERC20 overrides — resolve IVault ↔ ERC20 diamond conflict
    // -------------------------------------------------------------------------

    function balanceOf(address user)
        public view override(IVault, ERC20) returns (uint256)
    { return super.balanceOf(user); }

    function totalSupply()
        public view override(IVault, ERC20) returns (uint256)
    { return super.totalSupply(); }

    // =========================================================================
    // Stubs — filled in by subsequent commits
    // =========================================================================

    // =========================================================================
    // 3.2 — DEPOSIT ACCOUNTING
    // =========================================================================

    /// @notice Record a user deposit relayed from Satellite.
    ///         Mints shares proportional to the current share price so existing
    ///         holders are not diluted.  Triggers lazy epoch settlement first.
    ///
    ///         Share minting formula:
    ///           shares = amount × totalSupply / totalAssets   (if supply > 0)
    ///           shares = amount                               (bootstrap: 1:1)
    function recordDeposit(address user, uint256 amount)
        external
        onlyMessenger
        epochCheck
    {
        require(user   != address(0), "Vault: zero user");
        require(amount >  0,          "Vault: zero amount");

        uint256 shares = _tokensToShares(amount);

        _trackedTotalAssets += amount;

        _mint(user, shares);
    }

    // =========================================================================
    // 3.3 — WITHDRAWAL SYSTEM
    // =========================================================================

    /// @notice Process a withdrawal request relayed from Satellite.
    ///         The relayer converts tokenAmount → shares using cachedSharePrice
    ///         before calling this function.
    ///
    ///   Tier-1 (instant): tokenAmount ≤ idle (totalAssets - totalDeployedVault)
    ///     → burn shares, decrement totalAssets, emit WithdrawApproved immediately.
    ///       Relayer calls satellite.release(user, tokenAmount) on Sepolia.
    ///
    ///   Tier-2 (queued): tokenAmount > idle
    ///     → lock shares (transfer to vault), queue tokenAmount + epoch number.
    ///       WithdrawApproved fires at the next epoch once idle is freed.
    ///       Locked shares are burned when the withdrawal is fulfilled.
    function processWithdraw(address user, uint256 shares)
        external
        onlyMessenger
        nonReentrant
        epochCheck
    {
        require(user   != address(0),      "Vault: zero user");
        require(shares >  0,               "Vault: zero shares");
        require(balanceOf(user) >= shares, "Vault: insufficient shares");

        uint256 tokenAmount = _sharesToTokens(shares);
        require(tokenAmount > 0, "Vault: zero tokenAmount");

        uint256 idle = _idleBalance();

        if (tokenAmount <= idle) {
            // ── Tier-1: instant release ──────────────────────────────────────
            _burn(user, shares);
            _trackedTotalAssets -= tokenAmount;
            emit WithdrawApproved(user, tokenAmount);
        } else {
            // ── Tier-2: lock shares, queue for next epoch ────────────────────
            // Shares are transferred to the vault (locked) — totalSupply and
            // totalAssets both stay unchanged, so sharePrice is unaffected.
            // Shares are burned and totalAssets decremented when fulfilled.
            _transfer(user, address(this), shares);
            _pendingWithdrawals[user] += tokenAmount;
            _pendingShareLocks[user]  += shares;
            _pendingEpochs[user]       = currentEpoch;
            if (!_inPendingQueue[user]) {
                _pendingUsers.push(user);
                _inPendingQueue[user] = true;
            }
        }
    }

    /// @notice Called by relayer after satellite emits ClaimWithdrawRequested.
    ///         Marks the Tier-2 queued withdrawal as processed and emits WithdrawReleased
    ///         so the off-chain system has a confirmation event for audit.
    ///         The internal _pendingWithdrawals entry was already cleared by
    ///         _processPendingWithdrawals() at epoch settlement time.
    function claimWithdraw(address user, uint256 tokenAmount)
        external
        onlyMessenger
    {
        require(user        != address(0), "Vault: zero user");
        require(tokenAmount >  0,          "Vault: zero amount");
        emit WithdrawReleased(user, tokenAmount);
    }

    /// @notice Called by relayer after a force-close settles on Sepolia.
    ///         Does NOT update totalAssets — the next epoch's settleAgents() reconciliation
    ///         handles that via reported position values.
    ///         Records the recovery event for audit.
    function recordRecovery(uint256 agentId, uint256 recoveredAmount)
        external
        onlyMessenger
    {
        require(recoveredAmount > 0, "Vault: zero amount");
        emit RecoveryRecorded(agentId, recoveredAmount);
    }

    /// @notice Called by AgentManager after verifying iNFT ownership on-chain.
    ///         Reads commissionsOwed[agentId] from its own state, zeroes it,
    ///         and emits CommissionApproved so the relayer can call
    ///         satellite.releaseCommission(caller, amount).
    function approveCommissionRelease(uint256 agentId, address caller)
        external
        onlyAgentManager
    {
        require(caller != address(0), "Vault: zero caller");
        uint256 amount = commissionsOwed[agentId];
        require(amount > 0, "Vault: no commission owed");

        commissionsOwed[agentId] = 0;
        emit CommissionApproved(agentId, caller, amount);
    }

    // =========================================================================
    // 3.4 — EPOCH SETTLEMENT
    // =========================================================================

    /// @notice Trigger epoch settlement when due.
    ///         Called by the relayer once per epoch in its main loop, or by anyone.
    ///         Also fires lazily via epochCheck on recordDeposit / processWithdraw.
    ///         No-op if the epoch boundary has not elapsed or settlement is in progress.
    function triggerSettleEpoch() external {
        if (!_settling && block.number >= lastEpochBlock + epochLength) {
            _settleEpoch();
        }
    }

    function totalAssets() external view returns (uint256) { return _trackedTotalAssets; }
    function sharePrice()  external view returns (uint256) { return _sharePrice(); }
    function idleBalance() external view returns (uint256) { return _idleBalance(); }
    function pendingWithdrawal(address user) external view returns (uint256) {
        return _pendingWithdrawals[user];
    }

    /// @notice Point the Vault at a new AgentManager contract.
    ///         Only callable by the original deployer.
    ///         Use after deploying/redeploying AgentManager without redeploying Vault.
    function setAgentManager(address _agentManager) external onlyDeployer {
        require(_agentManager != address(0), "Vault: zero agentManager");
        agentManager = _agentManager;
    }

    function _idleBalance() internal view returns (uint256) {
        uint256 deployed = IAgentManager(agentManager).totalDeployedVault();
        return _trackedTotalAssets > deployed ? _trackedTotalAssets - deployed : 0;
    }

    function _sharePrice() internal view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 1e18;
        return (_trackedTotalAssets * 1e18) / supply;
    }

    function _tokensToShares(uint256 tokenAmount) internal view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0 || _trackedTotalAssets == 0) return tokenAmount;
        return (tokenAmount * supply) / _trackedTotalAssets;
    }

    function _sharesToTokens(uint256 shares) internal view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return shares;
        return (shares * _trackedTotalAssets) / supply;
    }

    // -------------------------------------------------------------------------
    // Internal: settlement orchestration
    // -------------------------------------------------------------------------

    /// @dev Full epoch settlement — called by epochCheck modifier or triggerSettleEpoch().
    ///
    ///   Order of operations:
    ///     1. settleAgents()         — EMA, Sharpe, promotion, eviction
    ///     2. totalAssets reconciliation + fee waterfall
    ///     3. Tier-2 queue           — process pending withdrawals, force-close if needed
    ///     4. EpochSettled event     — relayer syncs satellite share price
    ///     5. advance epoch counter
    function _settleEpoch() internal {
        _settling = true;

        // ── Step 1: settle agents ─────────────────────────────────────────────
        // AgentManager updates EMAs, Sharpe scores, promotion ramp, evictions,
        // and returns per-agent settlement data (Sharpe-sorted, lowest first)
        // plus aggregate vault-agent position value for totalAssets reconciliation.
        (IShared.AgentSettlementData[] memory data, uint256 aggregateVaultPositionValue) =
            IAgentManager(agentManager).settleAgents(_trackedTotalAssets, maxExposureRatio);

        // ── Step 2: fee waterfall + totalAssets reconciliation ─────────────────
        // For each agent with collected fees:
        //   protocolFee     = feesCollected × protocolFeeRate / 10000
        //   agentCommission = (feesCollected − protocolFee) × commissionRate / 10000
        //   depositorReturn = feesCollected − protocolFee − agentCommission
        //
        // protocolFee + agentCommission are reserved on the Satellite when the
        // relayer processes ProtocolFeeAccrued / CommissionAccrued events.
        // depositorReturn stays in _trackedTotalAssets — it increases share value.
        uint256 totalProtocolFee;
        uint256 totalDepositorReturn;

        for (uint256 i = 0; i < data.length; i++) {
            IShared.AgentSettlementData memory d = data[i];
            if (d.feesCollected == 0) continue;

            uint256 protocolFee     = (d.feesCollected * protocolFeeRate) / 10_000;
            uint256 remaining       = d.feesCollected - protocolFee;
            uint256 commission      = (remaining * commissionRate) / 10_000;
            uint256 depositorReturn = remaining - commission;

            if (protocolFee > 0) {
                protocolFeesAccrued += protocolFee;
                totalProtocolFee    += protocolFee;
            }

            if (commission > 0) {
                commissionsOwed[d.agentId] += commission;
                emit CommissionAccrued(d.agentId, commission);
            }

            totalDepositorReturn += depositorReturn;
        }

        // Single ProtocolFeeAccrued per epoch — relayer batches the satellite call.
        if (totalProtocolFee > 0) {
            emit ProtocolFeeAccrued(totalProtocolFee);
        }

        // Reconcile totalAssets: position values from settleAgents + idle + depositor fees.
        // idle = totalAssets - totalDeployedVault (nominal deployed amount from AgentManager).
        // Reconciliation formula: totalAssets = aggregateVaultPositionValue + idle + depositorReturn
        // This correctly accounts for impermanent loss: if positions lost value,
        // totalAssets decreases by (totalDeployedVault - aggregateVaultPositionValue).
        uint256 idle = _idleBalance();
        _trackedTotalAssets = aggregateVaultPositionValue + idle + totalDepositorReturn;

        // ── Step 3: process Tier-2 withdrawal queue ───────────────────────────
        // If idle is insufficient, emit ForceCloseRequested for lowest-Sharpe
        // vault agents (data is already sorted lowest-first by AgentManager).
        _processPendingWithdrawals(data);

        // ── Step 4: emit EpochSettled ─────────────────────────────────────────
        // Relayer calls satellite.updateSharePrice(sharePrice) on Sepolia so
        // requestWithdraw() can convert tokenAmount → shares accurately.
        emit EpochSettled(_sharePrice(), totalSupply(), _trackedTotalAssets);

        // ── Step 5: advance epoch ─────────────────────────────────────────────
        lastEpochBlock = block.number;
        currentEpoch++;

        _settling = false;
    }

    /// @dev FIFO processing of queued Tier-2 withdrawals.
    ///      Iterates _pendingUsers, fulfils any entry that fits within current
    ///      idle balance, and compacts the queue for the next epoch.
    ///      If idle is insufficient after processing, emits ForceCloseRequested
    ///      for lowest-Sharpe vault agents (data is Sharpe-sorted, lowest first).
    ///
    ///      Gas bound: O(n) over _pendingUsers length + O(m) over agents for
    ///      force-close targeting. Safe for demo scale.
    function _processPendingWithdrawals(IShared.AgentSettlementData[] memory data) internal {
        uint256 len = _pendingUsers.length;
        if (len == 0) return;

        // Read idle once; track locally as we decrement totalAssets per fulfilment.
        uint256 currentIdle = _idleBalance();

        address[] memory remaining = new address[](len);
        uint256 remainingCount;
        uint256 unfulfilledTotal;

        for (uint256 i = 0; i < len; i++) {
            address user   = _pendingUsers[i];
            uint256 amount = _pendingWithdrawals[user];

            if (amount == 0) {
                // Already cleared (e.g., user re-deposited and zeroed their entry)
                _inPendingQueue[user]     = false;
                _pendingShareLocks[user]  = 0;
                _pendingEpochs[user]      = 0;
                continue;
            }

            if (currentIdle >= amount) {
                // Fulfil: burn the locked shares held by the vault, decrement totalAssets.
                uint256 lockedShares = _pendingShareLocks[user];
                _burn(address(this), lockedShares);
                _trackedTotalAssets       -= amount;
                currentIdle               -= amount;
                _pendingWithdrawals[user]  = 0;
                _pendingShareLocks[user]   = 0;
                _pendingEpochs[user]       = 0;
                _inPendingQueue[user]      = false;
                emit WithdrawApproved(user, amount);
            } else {
                // Insufficient idle — carry over to next epoch
                remaining[remainingCount++] = user;
                unfulfilledTotal += amount;
            }
        }

        // Rebuild queue with only unresolved entries
        delete _pendingUsers;
        for (uint256 i = 0; i < remainingCount; i++) {
            _pendingUsers.push(remaining[i]);
        }

        // If withdrawals remain unfulfilled, emit ForceCloseRequested for
        // lowest-Sharpe vault agents until projected recovery covers the shortfall.
        // data is Sharpe-sorted lowest-first by AgentManager.
        if (unfulfilledTotal > 0) {
            uint256 projectedRecovery;
            for (uint256 i = 0; i < data.length && projectedRecovery < unfulfilledTotal; i++) {
                IShared.AgentSettlementData memory d = data[i];
                // Only target vault agents with open positions
                if (d.positionValue == 0) continue;
                emit ForceCloseRequested(d.agentId, IShared.ForceCloseSource.VAULT);
                projectedRecovery += d.positionValue;
            }
        }
    }
}

