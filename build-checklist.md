# Agent Arena - Build Checklist (Zero to Demo)

Tasks are ordered by dependency and grouped for parallel execution by Sonnet subagents. Each task lists the Claude skills (from `.claude/skills/` and `.0g-skills/`) that the executing agent should load.

---

## Phase 0: Project Setup (30 min)

All tasks in this phase can run in parallel.

### 0.1 - Scaffold project structure
- [ ] Initialize monorepo with `contracts/`, `relayer/`, `agent/`, `subgraph-mcp/`, `dashboard/` directories
- [ ] Set up root `package.json` with workspaces
- [ ] Create `.env.example` with all required variables (private keys, RPCs, contract addresses)
- [ ] Add `.gitignore` (include `.env`, node_modules, artifacts, cache)
- **Skills**: `scaffold-project`, `.0g-skills/patterns/NETWORK_CONFIG.md`

### 0.2 - Set up Foundry/Hardhat for dual-chain deployment
- [ ] Configure Hardhat with both 0G testnet and Sepolia networks
- [ ] Set `evmVersion: "cancun"` for 0G contracts
- [ ] Set up deployment scripts for both chains
- [ ] Install OpenZeppelin contracts (Math.sqrt, ERC721, ERC20)
- **Skills**: `deploy-contract`, `.0g-skills/patterns/CHAIN.md`

### 0.3 - Fund wallets on both testnets
- [ ] Get 0G testnet tokens from faucet
- [ ] Get Sepolia ETH from faucet
- [ ] Get or deploy test USDC.e on Sepolia
- [ ] Set up deployer wallet, relayer wallet, and 3 agent wallets
- **Skills**: `.0g-skills/patterns/NETWORK_CONFIG.md`, `.0g-skills/patterns/SECURITY.md`

---

## Phase 1: Vault Contract on 0G (3-4 hours)

### 1.1 - Core vault: share token + accounting
- [ ] Implement share token (ERC20) with mint/burn controlled by vault logic
- [ ] Implement `totalAssets()` derived from reported values
- [ ] Implement `sharePrice()` computation
- [ ] Implement `recordDeposit(user, amount)` -- callable by messenger only, mints shares
- [ ] Implement `processWithdraw(user, shares)` -- burns shares, emits `WithdrawApproved`
- [ ] Add `onlyMessenger` modifier for all relayer-called functions
- [ ] Add `epochCheck` modifier with lazy evaluation
- **Skills**: `deploy-contract`, `interact-contract`, `viem-integration`, `.0g-skills/patterns/CHAIN.md`

### 1.2 - Agent registry + iNFT
- [ ] Implement ERC-721 iNFT contract (mint on registration, ownerOf for auth)
- [ ] Implement `recordRegistration(agentId, agentAddress, deployer, provingAmount)` -- registers agent, mints iNFT
- [ ] Implement agent state tracking: phase (PROVING/VAULT), provingBalance, provingDeployed
- [ ] Implement `paused` mapping + `processPause(agentId, caller, paused)` with ownership check
- [ ] Implement withdraw-from-arena flow (deregister, clear state, free slot)
- **Skills**: `deploy-contract`, `interact-contract`, `.0g-skills/patterns/CHAIN.md`

### 1.3 - Intent queue + token bucket
- [ ] Implement `submitIntent(agentId, actionType, params)` with full validation
- [ ] Implement proving agent path: check `provingBalance - provingDeployed`
- [ ] Implement vault agent path: credit refill, credit check, `idleBalance()` check
- [ ] Implement cooldown check (`minActionInterval`)
- [ ] Implement credit refund on position close
- [ ] Emit `IntentQueued` event with all intent data
- **Skills**: `deploy-contract`, `interact-contract`, `.0g-skills/patterns/CHAIN.md`

### 1.4 - Epoch settlement + Sharpe scoring
- [ ] Implement `_settleEpoch()` with all 9 steps
- [ ] Implement EMA updates (emaReturn, emaReturnSq) with alpha decay
- [ ] Implement Sharpe computation with `Math.sqrt`, `MIN_VARIANCE` floor, negative clamping
- [ ] Implement all-zero fallback (equal allocation)
- [ ] Implement score-to-credit allocation (refillRate, maxCredits)
- [ ] Implement promotion ramp (effectiveMaxCredits with MAX_PROMOTION_SHARE and RAMP_EPOCHS)
- [ ] Implement `reportValues(agentId, positionValue, feesCollected)` -- stores last reported values
- [ ] Emit `EpochSettled(sharePrice, totalShares, totalAssets)`
- **Skills**: `deploy-contract`, `interact-contract`, `.0g-skills/patterns/CHAIN.md`

### 1.5 - Promotion, eviction, fee waterfall
- [ ] Implement promotion check: `epochsCompleted >= provingEpochsRequired` AND `sharpe >= minPromotionSharpe`
- [ ] Implement eviction: `zeroSharpeStreak` counter, skip paused agents, evict at `EVICTION_EPOCHS`
- [ ] Implement vault agent eviction (force-close vault positions, drop to proving, reset EMAs)
- [ ] Implement proving agent eviction (force-close, return capital)
- [ ] Implement fee waterfall: `protocolFee` first, then `agentCommission`, remainder to depositors
- [ ] Implement `protocolFeesAccrued` + `commissionsOwed[agentId]` tracking
- [ ] Implement `processCommissionClaim(agentId, caller)` with iNFT ownership check
- [ ] Emit `ProtocolFeeAccrued`, `CommissionAccrued`, `CommissionApproved` events
- **Skills**: `deploy-contract`, `interact-contract`, `.0g-skills/patterns/CHAIN.md`

### 1.6 - Withdrawal processing
- [ ] Implement Tier 1: instant withdrawal path (check idle balance, burn shares, emit `WithdrawApproved`)
- [ ] Implement Tier 2: queued withdrawal (lock shares, record epoch, queue)
- [ ] Implement force-close logic during epoch settlement (lowest-Sharpe first)
- [ ] Implement `claimWithdraw` processing
- **Skills**: `deploy-contract`, `interact-contract`, `.0g-skills/patterns/CHAIN.md`

### 1.7 - Deploy vault to 0G testnet
- [ ] Deploy iNFT contract
- [ ] Deploy vault contract with all constructor parameters
- [ ] Verify contracts on 0G explorer
- [ ] Record deployed addresses in `.env`
- **Skills**: `deploy-contract`, `.0g-skills/patterns/CHAIN.md`, `.0g-skills/patterns/NETWORK_CONFIG.md`

---

## Phase 2: Satellite Contract on Sepolia (3-4 hours)

Can start in parallel with Phase 1 once interfaces are agreed.

### 2.1 - Core satellite: deposits + withdrawals
- [ ] Implement `deposit(amount)` -- transfer USDC.e from user, emit `Deposited(user, amount)`
- [ ] Implement `registerAgent(agentAddress, provingAmount)` -- earmark funds, assign agentId, emit `AgentRegistered`
- [ ] Implement `requestWithdraw(tokenAmount)` -- convert to shares using cached sharePrice, emit `WithdrawRequested`
- [ ] Implement `claimWithdraw()` -- check approval via relayer, transfer tokens
- [ ] Implement `release(user, amount)` -- callable by messenger only
- [ ] Implement `updateSharePrice(sharePrice)` -- callable by messenger only
- [ ] Implement idle reserve tracking (20% of total assets)
- [ ] Add `onlyMessenger` modifier
- **Skills**: `viem-integration`, `liquidity-planner`, `.0g-skills/patterns/CHAIN.md`

### 2.2 - Uniswap execution: zap-in/out + LP management
- [ ] Implement `executeBatch(intents)` -- callable by messenger only
- [ ] Implement zap-in: swap half USDC.e for paired token via SwapRouter
- [ ] Implement LP open: call NonfungiblePositionManager.mint() with tick range
- [ ] Implement LP close: call NonfungiblePositionManager.decreaseLiquidity() + collect()
- [ ] Implement LP modify: decrease + re-mint at new range
- [ ] Implement zap-out: swap paired token back to USDC.e
- [ ] Track position NFTs per agentId
- [ ] Implement `collect()` on all positions at epoch reporting time
- [ ] Implement position valuation: read token amounts + slot0 price
- [ ] Emit `ValuesReported(agentId, positionValue, feesCollected)`
- **Skills**: `swap-integration`, `liquidity-planner`, `viem-integration`

### 2.3 - Fee reserves + claims
- [ ] Implement `reserveFees(protocolFeeAmount, agentId, commissionAmount)` -- messenger only
- [ ] Implement `protocolReserve` and `commissionReserve` pools
- [ ] Implement `claimProtocolFees()` -- callable by protocolTreasury address
- [ ] Implement `claimCommissions(agentId)` -- emit `CommissionClaimRequested(agentId, caller)`
- [ ] Implement `releaseCommission(caller, amount)` -- messenger only, pay from commissionReserve
- **Skills**: `interact-contract`, `viem-integration`

### 2.4 - Agent management via satellite
- [ ] Implement `pauseAgent(agentId)` / `unpauseAgent(agentId)` -- emit `PauseRequested`
- [ ] Implement `withdrawFromArena(agentId)` -- emit `WithdrawFromArenaRequested`
- **Skills**: `interact-contract`, `viem-integration`

### 2.5 - Deploy satellite to Sepolia
- [ ] Deploy satellite contract with constructor params (pool, depositToken, messenger)
- [ ] Verify contract on Etherscan Sepolia
- [ ] Record deployed address in `.env`
- [ ] Deploy or identify USDC.e and target Uniswap pool on Sepolia
- [ ] Seed the Uniswap pool with initial liquidity for testing
- **Skills**: `deploy-contract`, `liquidity-planner`, `.0g-skills/patterns/NETWORK_CONFIG.md`

---

## Phase 3: Relayer Script (2-3 hours)

Can start once vault and satellite interfaces are defined (before deployment).

### 3.1 - Core relayer: event watching + transaction submission
- [ ] Set up ethers v6 providers for both 0G testnet and Sepolia
- [ ] Implement event listener for Sepolia satellite events: `Deposited`, `AgentRegistered`, `WithdrawRequested`, `ValuesReported`, `CommissionClaimRequested`, `PauseRequested`, `WithdrawFromArenaRequested`
- [ ] Implement event listener for 0G vault events: `IntentQueued`, `WithdrawApproved`, `CommissionApproved`, `ProtocolFeeAccrued`, `CommissionAccrued`, `EpochSettled`
- [ ] Implement transaction submission to both chains with retry logic
- [ ] Implement nonce management to prevent nonce conflicts
- **Skills**: `viem-integration`, `.0g-skills/patterns/NETWORK_CONFIG.md`

### 3.2 - Relayer message routing
- [ ] Route `Deposited` -> `vault.recordDeposit()`
- [ ] Route `AgentRegistered` -> `vault.recordRegistration()`
- [ ] Route `WithdrawRequested` -> `vault.processWithdraw()`
- [ ] Route `IntentQueued` -> `satellite.executeBatch()`
- [ ] Route `ValuesReported` -> `vault.reportValues()`
- [ ] Route `EpochSettled` -> `satellite.updateSharePrice()`
- [ ] Route `WithdrawApproved` -> `satellite.release()`
- [ ] Route `CommissionAccrued` + `ProtocolFeeAccrued` -> `satellite.reserveFees()`
- [ ] Route `CommissionClaimRequested` -> `vault.processCommissionClaim()`
- [ ] Route `CommissionApproved` -> `satellite.releaseCommission()`
- [ ] Route `PauseRequested` -> `vault.processPause()`
- [ ] Route `WithdrawFromArenaRequested` -> vault withdraw-from-arena flow
- **Skills**: `viem-integration`, `interact-contract`

### 3.3 - Relayer error handling + logging
- [ ] Implement graceful error handling (don't crash on single failed relay)
- [ ] Implement event deduplication (don't process same event twice)
- [ ] Add structured logging (timestamp, event type, tx hash, chain)
- [ ] Implement health check endpoint (for monitoring during demo)
- **Skills**: `viem-integration`

---

## Phase 4: Subgraph MCP Server (1-2 hours)

Can run fully in parallel with Phases 1-3.

### 4.1 - MCP server setup
- [ ] Set up Node.js MCP server (using @modelcontextprotocol/sdk)
- [ ] Define MCP tools: `getPoolPrice`, `getPoolTicks`, `getPoolVolume`, `getPoolFees`, `getRecentSwaps`, `getPoolTVL`
- [ ] Connect to Uniswap v3 subgraph on Sepolia via TheGraph
- [ ] Implement GraphQL queries for each tool
- [ ] Add RPC fallback for current spot price (direct `slot0()` read)
- **Skills**: `viem-integration`

### 4.2 - Test MCP server
- [ ] Test each tool against live Sepolia subgraph data
- [ ] Verify response format matches what OpenClaw agents expect
- [ ] Test RPC fallback when subgraph is stale
- **Skills**: (none specific -- standard testing)

---

## Phase 5: OpenClaw Agents (2-3 hours)

Depends on: Subgraph MCP (Phase 4), Vault deployed (Phase 1.7).

### 5.1 - Agent scaffold + OpenClaw integration
- [ ] Set up OpenClaw agent project on fly.io
- [ ] Configure MCP connection to Subgraph MCP server
- [ ] Configure agent wallet (EOA) for submitting intents to 0G vault
- [ ] Implement base agent loop: read market data -> decide -> submit intent
- **Skills**: `.0g-skills/AGENTS.md`, `.0g-skills/patterns/COMPUTE.md`

### 5.2 - Strategy: Aggressive agent (Agent A)
- [ ] Implement tight-range strategy: concentrate liquidity within 2-3% of current price
- [ ] Implement frequent rebalancing: rebalance when price drifts >2% from range center
- [ ] Submit intents to vault via `submitIntent()`
- **Skills**: `liquidity-planner`, `.0g-skills/patterns/COMPUTE.md`

### 5.3 - Strategy: Conservative agent (Agent B)
- [ ] Implement wide-range strategy: spread liquidity across 10-20% of current price
- [ ] Implement rare rebalancing: only rebalance when price exits range entirely
- [ ] Submit intents to vault via `submitIntent()`
- **Skills**: `liquidity-planner`, `.0g-skills/patterns/COMPUTE.md`

### 5.4 - Strategy: Bad agent (Agent C)
- [ ] Implement intentionally poor strategy: random tick ranges, unnecessary rebalances
- [ ] Designed to demonstrate capital flowing away from bad performers
- [ ] Submit intents to vault via `submitIntent()`
- **Skills**: `liquidity-planner`, `.0g-skills/patterns/COMPUTE.md`

### 5.5 - Deploy agents to fly.io
- [ ] Deploy 3 sandboxed OpenClaw instances on fly.io
- [ ] Configure environment variables (agent wallets, vault address, MCP endpoint)
- [ ] Verify agents can read from Subgraph MCP and submit intents to vault
- **Skills**: `.0g-skills/patterns/COMPUTE.md`, `.0g-skills/patterns/SECURITY.md`

---

## Phase 6: Dashboard (2-3 hours)

Can start once contract interfaces are defined. Full data available after Phase 7.

### 6.1 - Dashboard scaffold
- [ ] Set up Next.js or React app
- [ ] Configure viem clients for both 0G testnet (vault reads) and Sepolia (satellite reads)
- [ ] Set up wallet connection (wagmi) for user deposits/withdrawals on Sepolia
- **Skills**: `viem-integration`, `frontend-dev`

### 6.2 - Agent performance view
- [ ] Display all agents: Sharpe score, EMA returns, credit allocation, deployed capital
- [ ] Show token bucket state: current credits, maxCredits, refillRate
- [ ] Show agent phase (proving/vault) and zeroSharpeStreak
- [ ] Highlight which agents are being starved vs rewarded
- [ ] Real-time updates via polling or event subscriptions
- **Skills**: `viem-integration`, `interact-contract`, `frontend-dev`

### 6.3 - Position + transaction view
- [ ] Show each agent's active Uniswap positions (tick range, liquidity, current price)
- [ ] Show recent intents and their execution status
- [ ] Show fees collected per agent per epoch
- **Skills**: `viem-integration`, `frontend-dev`

### 6.4 - Depositor view
- [ ] Show vault share price, total assets, user's share balance
- [ ] Deposit form (calls `satellite.deposit()`)
- [ ] Withdraw form (calls `satellite.requestWithdraw()`)
- [ ] Show pending/claimable withdrawals
- **Skills**: `viem-integration`, `swap-integration`, `frontend-dev`

### 6.5 - iNFT marketplace view
- [ ] List all iNFTs with agent track record (Sharpe, returns, commission yield)
- [ ] Show commission balance and claim button (calls `satellite.claimCommissions()`)
- [ ] Show pause/unpause controls (calls `satellite.pauseAgent()`)
- [ ] Show withdraw-from-arena button
- **Skills**: `viem-integration`, `interact-contract`, `frontend-dev`

### 6.6 - Fee waterfall display
- [ ] Show protocol fees accrued, commission pool, depositor yield
- [ ] Show per-epoch breakdown: fees collected -> protocol cut -> agent cut -> depositor return
- **Skills**: `viem-integration`, `frontend-dev`

---

## Phase 7: Integration + Demo Prep (2-3 hours)

All previous phases must be complete.

### 7.1 - End-to-end integration test
- [ ] Deposit USDC.e into satellite -> verify shares minted on vault
- [ ] Register agent via satellite -> verify iNFT minted on vault
- [ ] Agent submits intent -> relayer delivers -> satellite executes LP position
- [ ] Satellite reports values -> relayer delivers -> vault updates EMAs
- [ ] Trigger epoch settlement -> verify Sharpe scores, credit rebalancing
- [ ] Test promotion flow: proving agent meets criteria -> promoted
- [ ] Test eviction flow: bad agent accumulates zeroSharpeStreak -> evicted
- [ ] Test withdrawal flow: Tier 1 (instant) and Tier 2 (queued)
- [ ] Test commission claim flow end-to-end
- [ ] Test pause/unpause flow
- **Skills**: `interact-contract`, `viem-integration`, `.0g-skills/patterns/TESTING.md`

### 7.2 - Pre-compute demo state
- [ ] Deploy vault with short `epochLength` (few seconds of blocks)
- [ ] Register 2 bad agents (Agent B conservative + Agent C bad) with proving capital
- [ ] Let bad agents trade for several epochs (build bad track records)
- [ ] Register our good agent (Agent A aggressive) with proving capital
- [ ] Let good agent complete proving phase (all cross-chain round trips)
- [ ] Pause good agent one epoch before promotion threshold
- [ ] Verify dashboard shows: 2 bad agents with poor Sharpe, 1 good agent ready to promote
- **Skills**: `interact-contract`, `viem-integration`

### 7.3 - Demo rehearsal
- [ ] Run through the full 3-minute demo script:
  1. Show dashboard with bad agents
  2. Show good agent's proving track record
  3. Trigger promotion epoch live
  4. Show commissions accruing + iNFT marketplace
  5. Show bad agent eviction
- [ ] Time each section (30s each, ~3 min total)
- [ ] Test relayer reliability under demo conditions
- [ ] Prepare fallback: if 0G testnet is down, have Anvil fork ready
- [ ] Prepare fallback: pre-recorded video of demo flow
- **Skills**: (none -- manual rehearsal)

---

## Parallel Execution Map

```
Hour 0-1:    [Phase 0: Setup]
             0.1 | 0.2 | 0.3  (all parallel)

Hour 1-5:    [Phase 1: Vault]           [Phase 2: Satellite]      [Phase 4: MCP]
             1.1 -> 1.2 -> 1.3          2.1 -> 2.2                4.1 -> 4.2
                  -> 1.4 -> 1.5              -> 2.3 -> 2.4
                       -> 1.6                      -> 2.5
                            -> 1.7

Hour 4-7:    [Phase 3: Relayer]
             3.1 -> 3.2 -> 3.3

Hour 6-9:    [Phase 5: Agents]          [Phase 6: Dashboard]
             5.1 -> 5.2 | 5.3 | 5.4    6.1 -> 6.2 | 6.3
                  -> 5.5                     -> 6.4 | 6.5
                                             -> 6.6

Hour 9-12:   [Phase 7: Integration + Demo Prep]
             7.1 -> 7.2 -> 7.3
```

**Critical path**: Phase 0 -> Phase 1 (vault) -> Phase 3 (relayer) -> Phase 7 (integration)

**Parallelizable**: Phase 2 (satellite) with Phase 1 (vault), Phase 4 (MCP) with everything, Phase 6 (dashboard) with Phase 5 (agents)

---

## Skill Reference Quick Map

| Skill | Used In Tasks |
|-------|--------------|
| `scaffold-project` | 0.1 |
| `deploy-contract` | 0.2, 1.1-1.7, 2.1-2.5 |
| `interact-contract` | 1.1-1.6, 2.1-2.4, 3.2, 6.2, 6.5, 7.1, 7.2 |
| `viem-integration` | 1.1, 2.1-2.4, 3.1-3.3, 4.1, 6.1-6.6, 7.1, 7.2 |
| `swap-integration` | 2.2, 6.4 |
| `liquidity-planner` | 2.1, 2.2, 2.5, 5.2-5.4 |
| `frontend-dev` | 6.1-6.6 |
| `backend-developer` | 3.1-3.3, 4.1 |
| `.0g-skills/patterns/CHAIN.md` | 0.2, 1.1-1.7, 2.1 |
| `.0g-skills/patterns/NETWORK_CONFIG.md` | 0.1, 0.3, 1.7, 2.5, 3.1 |
| `.0g-skills/patterns/COMPUTE.md` | 5.1-5.5 |
| `.0g-skills/patterns/SECURITY.md` | 0.3, 5.5 |
| `.0g-skills/patterns/TESTING.md` | 7.1 |
| `.0g-skills/AGENTS.md` | 5.1 |
