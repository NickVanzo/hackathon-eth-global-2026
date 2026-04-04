// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISatellite} from "./interfaces/ISatellite.sol";
import {IShared} from "./interfaces/IShared.sol";

interface IUniswapV3Pool {
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
}

interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function mint(MintParams calldata params)
        external
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1);

    function collect(CollectParams calldata params) external returns (uint256 amount0, uint256 amount1);

    function burn(uint256 tokenId) external;

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );
}

// ---------------------------------------------------------------------------
// Satellite
// ---------------------------------------------------------------------------

/// @title Satellite
/// @notice Token custody + Uniswap execution contract on Ethereum Sepolia.
///         Holds ALL tokens (USDC.e), owns all Uniswap v3 LP position NFTs,
///         executes agent intents relayed from the 0G vault.
///
/// Section 2.1 — Core:
///   deposit, registerAgent, requestWithdraw, claimWithdraw (emits ClaimWithdrawRequested),
///   releaseQueuedWithdraw (messenger — actual Tier-2 token transfer), release,
///   updateSharePrice, idle reserve tracking, onlyMessenger
///
/// Section 2.2 — Uniswap execution: executeBatch (TODO)
/// Section 2.3 — Fee reserves: reserveProtocolFees, reserveCommission, approveQueuedWithdraw,
///   claimProtocolFees, releaseCommission
/// Section 2.4 — Agent management: pauseAgent, unpauseAgent, withdrawFromArena
/// Section 2.5 — Force-close: forceClose (TODO)
contract Satellite is ISatellite, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Immutables — set at construction, never change
    // -------------------------------------------------------------------------

    /// @notice The Uniswap v3 pool all agents trade on (USDC.e / WETH on Sepolia).
    address public immutable pool;

    /// @notice USDC.e — the single deposit/withdrawal token.
    address public immutable depositToken;

    /// @notice NonfungiblePositionManager for LP position lifecycle.
    address public immutable positionManager;

    /// @notice Uniswap Universal Router — receives API-generated swap calldata.
    ///         Replaces the legacy SwapRouter02; the Trading API's /swap endpoint
    ///         generates calldata specifically for this contract.
    address public immutable universalRouter;

    /// @notice Relayer EOA (hackathon) or permissionless relayer contract (production).
    ///         Only this address may call messenger-only functions.
    address public immutable messenger;

    /// @notice Protocol treasury — receives protocol fee claims.
    address public immutable protocolTreasury;

    /// @notice Target fraction of total assets to hold idle, in basis points (e.g. 2000 = 20%).
    ///         Deployment invariant: idleReserveRatio + maxExposureRatio (Vault) == 10000.
    uint256 public immutable idleReserveRatio;

    // -------------------------------------------------------------------------
    // Pool-derived constants — resolved once in constructor
    // -------------------------------------------------------------------------

    address public immutable token0; // pool.token0()
    address public immutable token1; // pool.token1()
    uint24 public immutable poolFee; // pool.fee()

    // -------------------------------------------------------------------------
    // State: accounting
    // -------------------------------------------------------------------------

    /// @notice Cached share price from the last EpochSettled event on 0G vault.
    ///         Used to convert tokenAmount → shares in requestWithdraw().
    uint256 public cachedSharePrice;

    /// @notice Protocol fees reserved (from reserveProtocolFees calls). NOT part of idle balance.
    uint256 public protocolReserve;

    /// @notice Commission reserves per agent. NOT part of idle balance.
    mapping(uint256 agentId => uint256 amount) public commissionReserve;

    /// @notice Running total of all commission reserves across agents.
    uint256 internal _totalCommissionReserves;

    /// @notice Proving capital earmarked per agent at registration.
    ///         Belongs to deployer — NOT vault depositor funds.
    mapping(uint256 agentId => uint256 amount) public provingCapital;

    /// @notice Running total of all proving capital across all agents.
    uint256 internal _totalProvingCapital;

    // -------------------------------------------------------------------------
    // State: position tracking
    // -------------------------------------------------------------------------

    /// @notice Source tag per Uniswap position NFT (PROVING or VAULT).
    ///         Set at mint time in executeBatch using the intent's source field.
    ///         Used by forceClose to selectively close only the intended class.
    mapping(uint256 tokenId => IShared.ForceCloseSource source) public positionSource;

    // -------------------------------------------------------------------------
    // State: agent registry
    // -------------------------------------------------------------------------

    /// @notice Sequential agentId counter. Starts at 1.
    uint256 internal _nextAgentId;

    /// @notice Deployer address recorded at registration (proving capital owner).
    mapping(uint256 agentId => address deployer) public agentDeployer;

    // -------------------------------------------------------------------------
    // State: withdrawals
    // -------------------------------------------------------------------------

    /// @notice Queued Tier-2 withdrawal amount per user.
    ///         Set when vault epoch settlement approves a Tier-2 request.
    ///         Cleared by claimWithdraw() when the user initiates the final claim.
    mapping(address user => uint256 tokenAmount) internal _pendingWithdrawals;

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    /// @dev Restricts function to the trusted relayer (messenger).
    modifier onlyMessenger() {
        require(msg.sender == messenger, "Satellite: not messenger");
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param _pool                Uniswap v3 pool address on Sepolia (USDC.e/WETH)
    /// @param _depositToken        USDC.e token address on Sepolia
    /// @param _positionManager     NonfungiblePositionManager address on Sepolia
    /// @param _universalRouter     Uniswap Universal Router address on Sepolia
    /// @param _messenger           Relayer EOA (hackathon) or relayer network contract
    /// @param _protocolTreasury    Address that receives protocol fee claims
    /// @param _idleReserveRatio    Target idle fraction in bps (e.g. 2000 = 20%).
    ///                             Must satisfy: _idleReserveRatio + Vault.maxExposureRatio == 10000.
    constructor(
        address _pool,
        address _depositToken,
        address _positionManager,
        address _universalRouter,
        address _messenger,
        address _protocolTreasury,
        uint256 _idleReserveRatio
    ) {
        require(_pool != address(0),             "zero pool");
        require(_depositToken != address(0),     "zero depositToken");
        require(_positionManager != address(0),  "zero positionManager");
        require(_universalRouter != address(0),  "zero universalRouter");
        require(_messenger != address(0),        "zero messenger");
        require(_protocolTreasury != address(0), "zero treasury");
        require(_idleReserveRatio <= 10_000,     "idleReserveRatio > 100%");

        pool             = _pool;
        depositToken     = _depositToken;
        positionManager  = _positionManager;
        universalRouter  = _universalRouter;
        messenger        = _messenger;
        protocolTreasury = _protocolTreasury;
        idleReserveRatio = _idleReserveRatio;

        // Resolve pool constants once — avoids repeated external calls
        token0  = IUniswapV3Pool(_pool).token0();
        token1  = IUniswapV3Pool(_pool).token1();
        poolFee = IUniswapV3Pool(_pool).fee();

        _nextAgentId     = 1;
        cachedSharePrice = 1e18; // 1:1 initial share price
    }

    // =========================================================================
    // 2.1 — CORE
    // =========================================================================

    // -------------------------------------------------------------------------
    // deposit()
    // -------------------------------------------------------------------------

    /// @notice User deposits USDC.e into the protocol.
    ///         Tokens are held here; the relayer mints shares on 0G vault.
    /// @dev User must approve this contract for `amount` USDC.e before calling.
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Satellite: zero amount");
        IERC20(depositToken).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    // -------------------------------------------------------------------------
    // registerAgent()
    // -------------------------------------------------------------------------

    /// @notice Register a new agent and deposit its proving capital.
    ///         Assigns a sequential agentId and emits AgentRegistered.
    ///         Relayer picks up the event and calls agentManager.recordRegistration() on 0G.
    /// @param agentAddress EOA that will submit intents on 0G on behalf of this agent.
    /// @param provingAmount USDC.e amount the deployer stakes as proving capital.
    function registerAgent(address agentAddress, uint256 provingAmount) external nonReentrant {
        require(agentAddress != address(0), "Satellite: zero agentAddress");
        require(provingAmount > 0, "Satellite: zero provingAmount");

        // Pull proving capital from deployer
        IERC20(depositToken).safeTransferFrom(msg.sender, address(this), provingAmount);

        uint256 agentId = _nextAgentId++;

        // Record deployer so proving capital can be returned on eviction / arena exit
        agentDeployer[agentId] = msg.sender;
        provingCapital[agentId] = provingAmount;
        _totalProvingCapital += provingAmount;

        emit AgentRegistered(agentId, agentAddress, msg.sender, provingAmount);
    }

    // -------------------------------------------------------------------------
    // requestWithdraw()
    // -------------------------------------------------------------------------

    /// @notice User requests a withdrawal of `tokenAmount` USDC.e.
    ///         Emits WithdrawRequested; relayer calls vault.processWithdraw() on 0G.
    ///         Tier 1 (fits idle): vault burns shares → WithdrawApproved → satellite.release().
    ///         Tier 2 (exceeds idle): vault queues; capital freed at next epoch settlement.
    function requestWithdraw(uint256 tokenAmount) external nonReentrant {
        require(tokenAmount > 0, "Satellite: zero amount");
        emit WithdrawRequested(msg.sender, tokenAmount);
    }

    // -------------------------------------------------------------------------
    // claimWithdraw() — Tier-2 user-initiated claim
    // -------------------------------------------------------------------------

    /// @notice Initiate a Tier-2 withdrawal claim.
    ///         Reads the pending amount approved by the vault epoch settlement,
    ///         clears it to prevent double-claiming, and emits ClaimWithdrawRequested.
    ///         The relayer picks up the event, calls vault.claimWithdraw() on 0G
    ///         (marks the vault entry processed, emits WithdrawReleased), then calls
    ///         satellite.releaseQueuedWithdraw(user, tokenAmount) to transfer tokens.
    function claimWithdraw() external nonReentrant {
        uint256 amount = _pendingWithdrawals[msg.sender];
        require(amount > 0, "Satellite: nothing to claim");
        _pendingWithdrawals[msg.sender] = 0;
        emit ClaimWithdrawRequested(msg.sender, amount);
    }

    // -------------------------------------------------------------------------
    // releaseQueuedWithdraw() — messenger only
    // -------------------------------------------------------------------------

    /// @notice Complete a Tier-2 withdrawal after the user has claimed.
    ///         Called by the relayer after vault.claimWithdraw() marks the entry processed.
    ///         Transfers tokens to the user and emits WithdrawalCompleted.
    function releaseQueuedWithdraw(address user, uint256 tokenAmount)
        external
        onlyMessenger
        nonReentrant
    {
        require(user        != address(0), "Satellite: zero user");
        require(tokenAmount >  0,          "Satellite: zero amount");
        IERC20(depositToken).safeTransfer(user, tokenAmount);
        emit WithdrawalCompleted(user, tokenAmount);
    }

    // -------------------------------------------------------------------------
    // release() — messenger only
    // -------------------------------------------------------------------------

    /// @notice Instant (Tier-1) withdrawal: transfer tokens directly to user.
    ///         Called by relayer after vault emits WithdrawApproved.
    function release(address user, uint256 tokenAmount) external onlyMessenger nonReentrant {
        require(user != address(0), "Satellite: zero user");
        require(tokenAmount > 0, "Satellite: zero amount");
        require(tokenAmount <= idleBalance(), "Satellite: insufficient idle balance");
        IERC20(depositToken).safeTransfer(user, tokenAmount);
        emit WithdrawalCompleted(user, tokenAmount);
    }

    // -------------------------------------------------------------------------
    // updateSharePrice() — messenger only
    // -------------------------------------------------------------------------

    /// @notice Cache the latest share price emitted by vault's EpochSettled event.
    ///         Used by requestWithdraw() to convert token amounts to shares on 0G.
    function updateSharePrice(uint256 sharePrice) external onlyMessenger {
        require(sharePrice > 0, "Satellite: zero sharePrice");
        cachedSharePrice = sharePrice;
    }

    // =========================================================================
    // 2.3 — Fee reserves
    // =========================================================================

    /// @notice Reserve protocol fees from epoch settlement into the protocol reserve pool.
    ///         Called by relayer after vault's ProtocolFeeAccrued event (once per epoch).
    function reserveProtocolFees(uint256 amount) external onlyMessenger {
        require(amount > 0, "Satellite: zero amount");
        protocolReserve += amount;
    }

    /// @notice Reserve commission for an agent's iNFT owner into the commission reserve pool.
    ///         Called by relayer after vault's CommissionAccrued event (once per agent per epoch).
    function reserveCommission(uint256 agentId, uint256 amount) external onlyMessenger {
        require(amount > 0, "Satellite: zero amount");
        commissionReserve[agentId] += amount;
        _totalCommissionReserves += amount;
    }

    /// @notice Record a Tier-2 withdrawal approval from vault epoch settlement.
    ///         Called by relayer after vault's WithdrawApproved event for queued entries.
    ///         Sets the pending amount so the user can call claimWithdraw().
    function approveQueuedWithdraw(address user, uint256 tokenAmount) external onlyMessenger {
        require(user        != address(0), "Satellite: zero user");
        require(tokenAmount >  0,          "Satellite: zero amount");
        _pendingWithdrawals[user] += tokenAmount;
    }

    /// @notice Protocol treasury claims accumulated protocol fees.
    function claimProtocolFees() external nonReentrant {
        require(msg.sender == protocolTreasury, "Satellite: not treasury");
        uint256 amount = protocolReserve;
        require(amount > 0, "Satellite: no fees");
        protocolReserve = 0;
        IERC20(depositToken).safeTransfer(protocolTreasury, amount);
    }

    /// @notice iNFT owner initiates commission claim. Emits event; relayer verifies ownership on 0G.
    function claimCommissions(uint256 agentId) external {
        emit CommissionClaimRequested(agentId, msg.sender);
    }

    /// @notice Pay commission to iNFT owner. Called by relayer after CommissionApproved.
    function releaseCommission(address caller, uint256 amount) external onlyMessenger nonReentrant {
        require(amount > 0, "Satellite: zero amount");
        require(caller != address(0), "Satellite: zero caller");
        _totalCommissionReserves -= amount; // underflow → revert if over-releasing
        IERC20(depositToken).safeTransfer(caller, amount);
    }

    // =========================================================================
    // 2.4 — Agent management
    // =========================================================================

    function pauseAgent(uint256 agentId) external {
        emit PauseRequested(agentId, msg.sender, true);
    }

    function unpauseAgent(uint256 agentId) external {
        emit PauseRequested(agentId, msg.sender, false);
    }

    function withdrawFromArena(uint256 agentId) external {
        emit WithdrawFromArenaRequested(agentId, msg.sender);
    }

    // =========================================================================
    // 2.2 stub — Uniswap execution (full implementation in Section 2.2)
    // =========================================================================

    /// @notice Execute a batch of intents from the 0G intent queue.
    ///         TODO: implement zap-in via Universal Router, NonfungiblePositionManager.mint, close, modify
    function executeBatch(IShared.Intent[] calldata /* intents */ ) external onlyMessenger {
        revert("Satellite: executeBatch not yet implemented");
    }

    // =========================================================================
    // 2.5 stub — force-close (full implementation in Section 2.5)
    // =========================================================================

    /// @notice Force-close positions for an agent filtered by source.
    ///         positionIds: relayer-provided from its local agentId → tokenIds cache.
    ///         source: PROVING closes only proving positions, VAULT closes only vault
    ///                 positions, ALL closes everything (withdraw-from-arena).
    ///         TODO: implement zap-out per position, PositionClosed events
    function forceClose(
        uint256 /* agentId */,
        uint256[] calldata /* positionIds */,
        IShared.ForceCloseSource /* source */
    ) external onlyMessenger {
        revert("Satellite: forceClose not yet implemented");
    }

    // =========================================================================
    // View functions
    // =========================================================================

    /// @notice Available USDC.e not committed to LP positions, reserves, or proving capital.
    ///         = total balance − protocol reserve − commission reserves − proving capital
    ///
    ///         This is the pool the vault's idleBalance accounting tracks.
    ///         The idleReserveRatio target is enforced by the allocator at epoch settlement,
    ///         not hardcoded here — idleBalance() just returns actual available balance.
    function idleBalance() public view returns (uint256) {
        uint256 total = IERC20(depositToken).balanceOf(address(this));
        uint256 committed = protocolReserve + _totalCommissionReserves + _totalProvingCapital;
        return total > committed ? total - committed : 0;
    }

    /// @notice Pending Tier-2 withdrawal queued for a user.
    function pendingWithdrawal(address user) external view returns (uint256) {
        return _pendingWithdrawals[user];
    }
}
