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

/// @notice Minimal Permit2 AllowanceTransfer interface for setting spender allowances.
interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
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
/// Section 2.2 — Uniswap execution: executeBatch
///   Swap via Universal Router (relayer-provided calldata from Trading API).
///   LP via NonfungiblePositionManager (mint / decreaseLiquidity / collect / burn).
///   Position NFT tracking per agentId. Source tagging per position.
///
/// Section 2.3 — Fee reserves: reserveProtocolFees, reserveCommission, approveQueuedWithdraw,
///   claimProtocolFees, releaseCommission
///
/// Section 2.4 — Agent management: pauseAgent, unpauseAgent, withdrawFromArena
///
/// Section 2.5 — Force-close: forceClose (source-filtered zap-out + capital return)
///
/// Section 2.6 — Reporting: collectAndReport (epoch fee collection + valuation)
contract Satellite is ISatellite, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    /// @notice Canonical Permit2 address (same on all EVM chains).
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

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

    /// @notice Reverse lookup: which agent owns a given position NFT.
    mapping(uint256 tokenId => uint256 agentId) public positionAgent;

    /// @notice All position NFT IDs owned by a given agent.
    mapping(uint256 agentId => uint256[]) internal _agentPositions;

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

        // --- One-time token approvals ---

        // 1. Approve Permit2 to spend our tokens (for Universal Router swaps)
        IERC20(IUniswapV3Pool(_pool).token0()).forceApprove(PERMIT2, type(uint256).max);
        IERC20(IUniswapV3Pool(_pool).token1()).forceApprove(PERMIT2, type(uint256).max);

        // 2. Set Permit2 allowances for Universal Router (max amount, max expiry)
        IPermit2(PERMIT2).approve(
            IUniswapV3Pool(_pool).token0(), _universalRouter, type(uint160).max, type(uint48).max
        );
        IPermit2(PERMIT2).approve(
            IUniswapV3Pool(_pool).token1(), _universalRouter, type(uint160).max, type(uint48).max
        );

        // 3. Approve NonfungiblePositionManager to spend our tokens (for LP minting)
        IERC20(IUniswapV3Pool(_pool).token0()).forceApprove(_positionManager, type(uint256).max);
        IERC20(IUniswapV3Pool(_pool).token1()).forceApprove(_positionManager, type(uint256).max);
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
    // 2.2 — UNISWAP EXECUTION
    // =========================================================================

    /// @notice Execute a batch of intents from the 0G intent queue.
    ///         The relayer enriches each intent's params with swap calldata from the
    ///         Uniswap Trading API before calling this function.
    ///
    ///         Intent.params encoding per actionType:
    ///           OPEN_POSITION:   abi.encode(uint256 amountUSDC, int24 tickLower, int24 tickUpper,
    ///                                       bytes swapCalldata, ForceCloseSource source)
    ///           CLOSE_POSITION:  abi.encode(uint256 tokenId, bytes swapCalldata)
    ///           MODIFY_POSITION: abi.encode(uint256 oldTokenId, int24 newTickLower, int24 newTickUpper,
    ///                                       bytes closeSwapCalldata, bytes openSwapCalldata,
    ///                                       ForceCloseSource source)
    function executeBatch(IShared.Intent[] calldata intents) external onlyMessenger nonReentrant {
        for (uint256 i = 0; i < intents.length; i++) {
            IShared.Intent calldata intent = intents[i];

            if (intent.actionType == IShared.ActionType.OPEN_POSITION) {
                _executeOpen(intent);
            } else if (intent.actionType == IShared.ActionType.CLOSE_POSITION) {
                _executeCloseIntent(intent);
            } else if (intent.actionType == IShared.ActionType.MODIFY_POSITION) {
                _executeModify(intent);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Internal: OPEN_POSITION
    // -------------------------------------------------------------------------

    /// @dev Zap-in via Universal Router then mint LP position via NonfungiblePositionManager.
    function _executeOpen(IShared.Intent calldata intent) internal {
        (
            uint256 amountUSDC,
            int24 tickLower,
            int24 tickUpper,
            bytes memory swapCalldata,
            IShared.ForceCloseSource source
        ) = abi.decode(intent.params, (uint256, int24, int24, bytes, IShared.ForceCloseSource));

        _mintPosition(intent.agentId, amountUSDC, tickLower, tickUpper, swapCalldata, source);
    }

    // -------------------------------------------------------------------------
    // Internal: CLOSE_POSITION
    // -------------------------------------------------------------------------

    /// @dev Decrease liquidity, collect, zap-out via Universal Router, emit PositionClosed.
    function _executeCloseIntent(IShared.Intent calldata intent) internal {
        (uint256 tokenId, bytes memory swapCalldata) = abi.decode(intent.params, (uint256, bytes));

        uint256 recovered = _closeAndZapOut(intent.agentId, tokenId, swapCalldata);
        emit PositionClosed(intent.agentId, tokenId, recovered);
    }

    // -------------------------------------------------------------------------
    // Internal: MODIFY_POSITION (close old + open new)
    // -------------------------------------------------------------------------

    function _executeModify(IShared.Intent calldata intent) internal {
        (
            uint256 oldTokenId,
            int24 newTickLower,
            int24 newTickUpper,
            bytes memory closeSwapCalldata,
            bytes memory openSwapCalldata,
            IShared.ForceCloseSource source
        ) = abi.decode(intent.params, (uint256, int24, int24, bytes, bytes, IShared.ForceCloseSource));

        // Close old position
        uint256 recovered = _closeAndZapOut(intent.agentId, oldTokenId, closeSwapCalldata);
        emit PositionClosed(intent.agentId, oldTokenId, recovered);

        // Open new position with recovered capital
        _mintPosition(intent.agentId, recovered, newTickLower, newTickUpper, openSwapCalldata, source);
    }

    // -------------------------------------------------------------------------
    // Internal: mint LP position (shared by open + modify)
    // -------------------------------------------------------------------------

    function _mintPosition(
        uint256 agentId,
        uint256 amountUSDC,
        int24 tickLower,
        int24 tickUpper,
        bytes memory swapCalldata,
        IShared.ForceCloseSource source
    ) internal {
        // Compute LP amounts via swap + balance deltas (scoped to free stack slots)
        uint256 amount0Desired;
        uint256 amount1Desired;
        {
            address otherToken = depositToken == token0 ? token1 : token0;
            uint256 depositBefore = IERC20(depositToken).balanceOf(address(this));
            uint256 otherBefore   = IERC20(otherToken).balanceOf(address(this));

            // Execute zap-in swap via Universal Router
            if (swapCalldata.length > 0) {
                // solhint-disable-next-line avoid-low-level-calls
                (bool success,) = universalRouter.call(swapCalldata);
                require(success, "Satellite: zap-in swap failed");
            }

            // Compute resulting amounts from balance deltas
            uint256 depositUsed   = depositBefore - IERC20(depositToken).balanceOf(address(this));
            uint256 otherReceived = IERC20(otherToken).balanceOf(address(this)) - otherBefore;
            uint256 depositForLP  = amountUSDC > depositUsed ? amountUSDC - depositUsed : 0;

            // Order amounts for the pool's token0/token1
            if (depositToken == token0) {
                amount0Desired = depositForLP;
                amount1Desired = otherReceived;
            } else {
                amount0Desired = otherReceived;
                amount1Desired = depositForLP;
            }
        }

        // Mint LP position via NonfungiblePositionManager
        uint256 tokenId;
        uint128 mintedLiquidity;
        (tokenId, mintedLiquidity,,) = INonfungiblePositionManager(positionManager).mint(
            INonfungiblePositionManager.MintParams({
                token0:          token0,
                token1:          token1,
                fee:             poolFee,
                tickLower:       tickLower,
                tickUpper:       tickUpper,
                amount0Desired:  amount0Desired,
                amount1Desired:  amount1Desired,
                amount0Min:      0, // slippage handled by relayer's swap calldata
                amount1Min:      0,
                recipient:       address(this),
                deadline:        block.timestamp
            })
        );

        // Track the position
        positionSource[tokenId] = source;
        positionAgent[tokenId]  = agentId;
        _agentPositions[agentId].push(tokenId);

        emit PositionOpened(agentId, tokenId, tickLower, tickUpper, mintedLiquidity, amountUSDC);
    }

    // -------------------------------------------------------------------------
    // Internal: close position + zap-out (shared by close, modify, forceClose)
    // -------------------------------------------------------------------------

    /// @dev Decreases liquidity to zero, collects all tokens + fees, swaps the
    ///      non-deposit token back to depositToken, burns the NFT, cleans tracking.
    /// @return recoveredUSDC Total depositToken amount recovered (collected + swap proceeds).
    function _closeAndZapOut(
        uint256 agentId,
        uint256 tokenId,
        bytes memory swapCalldata
    ) internal returns (uint256 recoveredUSDC) {
        require(positionAgent[tokenId] == agentId, "Satellite: not agent's position");

        // 1. Get position liquidity
        (,,,,,,, uint128 liquidity,,,,) =
            INonfungiblePositionManager(positionManager).positions(tokenId);

        // 2. Decrease liquidity to zero
        if (liquidity > 0) {
            INonfungiblePositionManager(positionManager).decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId:    tokenId,
                    liquidity:  liquidity,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline:   block.timestamp
                })
            );
        }

        // 3. Collect all tokens + accrued fees
        (uint256 collected0, uint256 collected1) =
            INonfungiblePositionManager(positionManager).collect(
                INonfungiblePositionManager.CollectParams({
                    tokenId:    tokenId,
                    recipient:  address(this),
                    amount0Max: type(uint128).max,
                    amount1Max: type(uint128).max
                })
            );

        // 4. Burn the empty position NFT
        INonfungiblePositionManager(positionManager).burn(tokenId);

        // 5. Clean up tracking
        _removePosition(agentId, tokenId);
        delete positionSource[tokenId];
        delete positionAgent[tokenId];

        // 6. Zap out: swap non-deposit token back to depositToken via Universal Router
        uint256 depositCollected = depositToken == token0 ? collected0 : collected1;
        uint256 otherCollected   = depositToken == token0 ? collected1 : collected0;

        if (otherCollected > 0 && swapCalldata.length > 0) {
            uint256 depositBefore = IERC20(depositToken).balanceOf(address(this));

            // solhint-disable-next-line avoid-low-level-calls
            (bool success,) = universalRouter.call(swapCalldata);
            require(success, "Satellite: zap-out swap failed");

            uint256 depositAfter = IERC20(depositToken).balanceOf(address(this));
            recoveredUSDC = depositCollected + (depositAfter - depositBefore);
        } else {
            // No swap needed (e.g. position was entirely in depositToken)
            recoveredUSDC = depositCollected;
        }
    }

    // -------------------------------------------------------------------------
    // Internal: remove a position from the agent's tracking array
    // -------------------------------------------------------------------------

    function _removePosition(uint256 agentId, uint256 tokenId) internal {
        uint256[] storage positions = _agentPositions[agentId];
        uint256 len = positions.length;
        for (uint256 i = 0; i < len; i++) {
            if (positions[i] == tokenId) {
                positions[i] = positions[len - 1];
                positions.pop();
                return;
            }
        }
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
    ///         agentId identifies whose commission reserve to decrement.
    function releaseCommission(uint256 agentId, address caller, uint256 amount) external onlyMessenger nonReentrant {
        require(amount > 0, "Satellite: zero amount");
        require(caller != address(0), "Satellite: zero caller");
        commissionReserve[agentId] -= amount; // underflow → revert if over-releasing per agent
        _totalCommissionReserves -= amount;
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
    // 2.5 — FORCE-CLOSE
    // =========================================================================

    /// @notice Force-close positions for an agent, filtered by source tag.
    ///         Called by relayer after ForceCloseRequested events on 0G (from
    ///         AgentManager eviction/arena-exit or Vault withdrawal enforcement).
    ///
    ///         positionIds: relayer-provided from its local agentId → tokenIds cache.
    ///         source: PROVING closes only proving positions, VAULT closes only vault
    ///                 positions, ALL closes everything (withdraw-from-arena).
    ///         swapCalldata: one entry per positionId — relayer-built calldata for
    ///                 zapping the non-deposit token back to depositToken. Pass empty
    ///                 bytes for positions that are entirely in depositToken.
    ///
    ///         Vault-funded capital returns to idle. Proving capital returns to deployer.
    function forceClose(
        uint256 agentId,
        uint256[] calldata positionIds,
        IShared.ForceCloseSource source,
        bytes[] calldata swapCalldata
    ) external onlyMessenger nonReentrant {
        require(positionIds.length == swapCalldata.length, "Satellite: length mismatch");

        uint256 totalRecoveredProving;

        for (uint256 i = 0; i < positionIds.length; i++) {
            uint256 tokenId = positionIds[i];
            IShared.ForceCloseSource posSource = positionSource[tokenId];

            // Filter by requested source (ALL matches everything)
            if (source != IShared.ForceCloseSource.ALL && posSource != source) {
                continue;
            }

            uint256 recovered = _closeAndZapOut(agentId, tokenId, swapCalldata[i]);

            if (posSource == IShared.ForceCloseSource.PROVING) {
                totalRecoveredProving += recovered;
            }
            // VAULT-sourced capital stays in satellite as idle — no transfer needed

            emit PositionClosed(agentId, tokenId, recovered);
        }

        // Return proving capital to the agent's deployer
        if (totalRecoveredProving > 0) {
            address deployer = agentDeployer[agentId];
            require(deployer != address(0), "Satellite: no deployer");

            // Decrease proving capital tracking
            uint256 currentProving = provingCapital[agentId];
            uint256 decrease = totalRecoveredProving > currentProving
                ? currentProving
                : totalRecoveredProving;
            provingCapital[agentId] -= decrease;
            _totalProvingCapital    -= decrease;

            IERC20(depositToken).safeTransfer(deployer, totalRecoveredProving);
        }
    }

    // =========================================================================
    // 2.6 — REPORTING (epoch fee collection + valuation)
    // =========================================================================

    /// @notice Collect accrued trading fees on all of an agent's positions and
    ///         emit ValuesReported for the relayer to forward to 0G.
    ///
    ///         Called by relayer once per epoch per agent before settlement.
    ///         `positionValue` is computed off-chain by the relayer using pool state
    ///         (sqrtPriceX96, position liquidity, tick range).
    ///
    /// @param agentId       The agent whose positions to collect fees for.
    /// @param positionValue Off-chain computed USDC.e-equivalent value of all LP positions.
    function collectAndReport(uint256 agentId, uint256 positionValue) external onlyMessenger nonReentrant {
        uint256[] storage positions = _agentPositions[agentId];
        uint256 totalFeesInDeposit;

        for (uint256 i = 0; i < positions.length; i++) {
            (uint256 f0, uint256 f1) = INonfungiblePositionManager(positionManager).collect(
                INonfungiblePositionManager.CollectParams({
                    tokenId:    positions[i],
                    recipient:  address(this),
                    amount0Max: type(uint128).max,
                    amount1Max: type(uint128).max
                })
            );

            // Count only deposit-token-denominated fees.
            // Non-deposit-token fees remain in the satellite and are captured
            // in the position value at the next epoch.
            totalFeesInDeposit += depositToken == token0 ? f0 : f1;
        }

        emit ValuesReported(agentId, positionValue, totalFeesInDeposit);
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

    /// @notice All position NFT IDs currently owned by an agent.
    function getAgentPositions(uint256 agentId) external view returns (uint256[] memory) {
        return _agentPositions[agentId];
    }

    /// @notice Number of active positions for an agent.
    function agentPositionCount(uint256 agentId) external view returns (uint256) {
        return _agentPositions[agentId].length;
    }
}
