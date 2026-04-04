# Agent Arena - Build Checklist (5.5 Hours Dev, 14 Hours Testing/Polish)

## Team

- **Dev A** (Senior, scoring + agents focus) — Shared interfaces + Agent base + AgentManager contract + Agent strategies
- **Dev B** (Senior, Uniswap + infra focus) — Satellite contract + Relayer + All deployments
- **PM** (Vibe coding with Claude) — Project setup + MCP server + Dashboard

**Rule**: everyone works in parallel at all times. If you need something from someone else, **mock it** and move on. Replace mocks with real implementations when the dependency is delivered.

**Development scope**: everything needed to have a working system. Testing, integration, demo prep, and polish happen in the 14-hour buffer.

---

## Hour 0:00 - 0:30 — Setup (all parallel)

### Dev A — Shared interfaces + agent base
- [x] Define `Intent` struct (agentId, actionType, params)
- [x] Define all cross-chain event signatures (Deposited, AgentRegistered, WithdrawRequested, WithdrawalCompleted, IntentQueued, ValuesReported, EpochSettled, WithdrawApproved, CommissionAccrued, ProtocolFeeAccrued, CommissionClaimRequested, CommissionApproved, PauseRequested, WithdrawFromArenaRequested)
- [x] Define all cross-chain function signatures for both contracts
- [x] Write `IVault.sol`, `IAgentManager.sol`, and `ISatellite.sol` interface files
- [x] Push to `contracts/interfaces/` so Dev B can start satellite immediately
- **Skills**: `.0g-skills/patterns/CHAIN.md`

### Dev B — Forge + tooling
- [x] Configure Forge: 0G testnet (`evmVersion: "cancun"`) + Sepolia networks
- [x] Set up deployment scripts for both chains
- [x] Install OpenZeppelin contracts (Math, ERC721, ERC20)
- **Skills**: `deploy-contract`, `.0g-skills/patterns/CHAIN.md`

### PM — Scaffold + infra
- [x] Scaffold monorepo: `contracts/`, `relayer/`, `agent/`, `subgraph-mcp/`, `dashboard/`, `shared/`
- [x] Create `.env.example`, `.gitignore`, root `package.json` with workspaces
- [x] Start funding wallets: faucets for 0G testnet + Sepolia, set up deployer/relayer/3 agent wallets
- **Skills**: `scaffold-project`, `.0g-skills/patterns/NETWORK_CONFIG.md`

---

## Hour 0:30 - 1:15 — Agent Base + Pool Setup (all parallel)

### Dev A — Agent base loop + intent format
Build the agent foundation that all 3 strategies will extend. **Mock**: agents log intents to console instead of submitting on-chain (vault doesn't exist yet).

- [x] Set up OpenClaw agent project structure
- [ ] Configure MCP connection interface (will connect to real MCP server later)
- [ ] Implement base agent loop: read market data -> decide -> produce Intent struct -> log/queue intent
- [ ] Define intent action types: OPEN_POSITION, CLOSE_POSITION, MODIFY_POSITION
- [ ] Implement intent serialization matching the `Intent` struct from interfaces
- [ ] Verify agent can produce well-formed intents with mock market data
- **Skills**: `.0g-skills/AGENTS.md`, `.0g-skills/patterns/COMPUTE.md`, `backend-developer`

### Dev B — Start satellite contract
Begin satellite immediately using shared interfaces from Dev A.

- [x] Start 2.1 - Core: `deposit()`, `registerAgent()`, `requestWithdraw()`, `release()`, `updateSharePrice()`, idle reserve tracking, `onlyMessenger` modifier
- **Skills**: `.0g-skills/patterns/CHAIN.md`, `swap-integration`, `liquidity-planner`

### PM — Pool setup + start MCP server
- [ ] Finish funding wallets
- [ ] Deploy or identify test USDC.e token on Sepolia
- [ ] Deploy or identify Uniswap v3 pool on Sepolia (e.g., USDC.e/WETH)
- [ ] Seed pool with initial liquidity
- [ ] Record pool address, token addresses, fee tier in `.env`
- [ ] Start MCP server: set up Node.js project with @modelcontextprotocol/sdk
- **Skills**: `liquidity-planner`, `swap-integration`, `.0g-skills/patterns/NETWORK_CONFIG.md`

---

## Hour 1:15 - 4:45 — Core Build (all parallel)

### Dev A — AgentManager contract (2.5 hours) then help with Vault
The agent lifecycle contract — scoring, intents, token bucket. Separate from the Vault for clarity and to stay under 24KB contract size limit.

**Skills**: `.0g-skills/patterns/CHAIN.md`, `.0g-skills/patterns/SECURITY.md`

- [ ] Agent registry: agent state (phase PROVING/VAULT, provingBalance, provingDeployed, agentAddress, epochsCompleted, zeroSharpeStreak)
- [ ] iNFT contract (ERC-721): mint on registration, `ownerOf` for auth checks
- [ ] `recordRegistration(agentId, agentAddress, deployer, provingAmount)` — registers agent, mints iNFT
- [ ] `submitIntent(agentId, actionType, params)` — proving/vault branching, cooldown (`minActionInterval`), credit refill/check for vault agents, `provingBalance - provingDeployed` for proving agents, calls `Vault.idleBalance()` for vault agents, credit refund on close, emit `IntentQueued`
- [ ] Token bucket: credits, refillRate, maxCredits per agent, credit refill logic
- [ ] `reportValues(agentId, positionValue, feesCollected)` — stores last reported values + `lastReportedBlock` (messenger only)
- [ ] `settleAgents()` — called by Vault during epoch settlement:
  - EMA updates (emaReturn, emaReturnSq) with alpha decay
  - Sharpe computation with `Math.sqrt`, `MIN_VARIANCE` floor, negative clamping, all-zero fallback
  - Score-to-credit allocation (refillRate, maxCredits), promotion ramp (effectiveMaxCredits, MAX_PROMOTION_SHARE, RAMP_EPOCHS)
  - Promotion check (epochsCompleted + minPromotionSharpe)
  - Eviction check (zeroSharpeStreak, skip paused, EVICTION_EPOCHS), vault eviction (drop to proving, reset EMAs), proving eviction (return capital)
  - Returns per-agent feesCollected, eviction/promotion results, force-close intents
- [ ] `processPause(agentId, caller, paused)` — checks `iNFT.ownerOf(agentId) == caller`
- [ ] `processCommissionClaim(agentId, caller)` — checks `iNFT.ownerOf(agentId) == caller`, then calls `Vault.approveCommissionRelease(agentId, amount)`
- [ ] Withdraw-from-arena: deregister agent, clear state, free `maxAgents` slot
- [ ] `setVault(address)` — one-time initialization to set circular reference after Vault deploys
- [ ] Compile AgentManager + iNFT, generate ABIs, push to `shared/abis/`

**After AgentManager is done (~hour 3:45)**: Dev A starts building agent strategies (see Hour 4:45 section) or helps Dev B with Vault if needed.

### Dev B — Vault (accounting) + Satellite + deploy + relayer (3.5 hours)

**Hour 1:15 - 2:00: Vault contract (45 min)**

The Vault is now simpler — pure accounting, no agent logic. AgentManager handles all agent state.

**Skills**: `.0g-skills/patterns/CHAIN.md`, `.0g-skills/patterns/SECURITY.md`

- [ ] Share token (ERC20 mint/burn), `totalAssets()`, `sharePrice()`, `idleBalance()`
- [ ] `recordDeposit(user, amount)` — messenger only, mints shares
- [ ] `processWithdraw(user, shares)` — burns shares, emits `WithdrawApproved`
- [ ] Withdrawal queue: Tier 1 instant (check idle, burn, approve), Tier 2 queued (lock shares, record epoch), `claimWithdraw` processing
- [ ] `epochCheck` modifier + `_settleEpoch()` orchestration + public `triggerSettleEpoch()` (called by AgentManager's epochCheck): calls `AgentManager.settleAgents()`, applies fee waterfall (protocolFee first, then agentCommission), handles pending withdrawals (reduce allocations, queue force-close for lowest-Sharpe), emits `EpochSettled(sharePrice, totalShares, totalAssets)`
- [ ] Fee waterfall: `protocolFeesAccrued`, `commissionsOwed[agentId]`, `approveCommissionRelease(agentId, amount)` — called by AgentManager after ownership check, zeroes commissionsOwed and emits CommissionApproved
- [ ] `onlyMessenger` modifier
- [ ] Compile Vault, generate ABIs, push to `shared/abis/`

**Hour 2:00 - 3:15: Finish satellite (1.25 hours)**

- [ ] Finish 2.1 - Core: `claimWithdraw()`, idle reserve tracking refinement
- [ ] 2.2 - Uniswap execution: `executeBatch()` (messenger only), zap-in (swap half USDC.e for paired token via SwapRouter), LP open (NonfungiblePositionManager.mint), LP close (decreaseLiquidity + collect), LP modify (decrease + re-mint), zap-out (swap back to USDC.e), position NFT tracking per agentId, `collect()` on all positions at epoch reporting, position valuation (slot0 + token amounts), emit `ValuesReported(agentId, positionValue, feesCollected)`
- [ ] 2.3 - Fee reserves: `reserveFees()` (messenger only), `protocolReserve`/`commissionReserve` pools, `claimProtocolFees()` (protocolTreasury only), `claimCommissions()` (emit CommissionClaimRequested), `releaseCommission()` (messenger only, from commissionReserve)
- [ ] 2.4 - Agent management: `pauseAgent()`/`unpauseAgent()` (emit PauseRequested), `withdrawFromArena()` (emit WithdrawFromArenaRequested)
- [ ] 2.5 - Force-close: `forceClose()` (messenger only), close all agent positions via zap-out, return capital to correct destination
- [ ] Compile satellite, generate ABIs, push to `shared/abis/`

**Skills**: `.0g-skills/patterns/CHAIN.md`, `swap-integration`, `liquidity-planner`

**Hour 3:15 - 3:30: Deploy satellite (15 min)**

- [ ] Deploy satellite to Sepolia with constructor params (pool, depositToken, messenger, protocolTreasury)
- [ ] Verify on Etherscan Sepolia
- [ ] Record address in `.env`, announce to team

**Skills**: `deploy-contract`, `.0g-skills/patterns/NETWORK_CONFIG.md`

**Hour 3:30 - 4:45: Relayer (1.25 hours)**

- [ ] Set up ethers v6 providers for both 0G testnet and Sepolia
- [ ] Load ABIs from `shared/abis/`
- [ ] Implement all 12 event routes (note: some go to Vault, some to AgentManager):
  - [ ] `Deposited` -> `vault.recordDeposit()`
  - [ ] `AgentRegistered` -> `agentManager.recordRegistration()`
  - [ ] `WithdrawRequested` -> `vault.processWithdraw()`
  - [ ] `IntentQueued` -> `satellite.executeBatch()`
  - [ ] `ValuesReported` -> `agentManager.reportValues()`
  - [ ] `EpochSettled` -> `satellite.updateSharePrice()`
  - [ ] `WithdrawApproved` -> `satellite.release()`
  - [ ] `CommissionAccrued` + `ProtocolFeeAccrued` -> `satellite.reserveFees()`
  - [ ] `CommissionClaimRequested` -> `agentManager.processCommissionClaim()`
  - [ ] `CommissionApproved` -> `satellite.releaseCommission()`
  - [ ] `PauseRequested` -> `agentManager.processPause()`
  - [ ] `WithdrawFromArenaRequested` -> agentManager withdraw-from-arena flow
- [ ] Event deduplication (don't process same event twice)
- [ ] Retry logic + nonce management
- [ ] Structured logging (timestamp, event type, tx hash, chain)
- [ ] Health check endpoint (for monitoring during demo)
- [ ] Start relayer as persistent process (pm2 or background node)

**Skills**: `backend-developer`, `.0g-skills/patterns/CHAIN.md`, `.0g-skills/patterns/NETWORK_CONFIG.md`

### PM — MCP server + dashboard (3.5 hours)

**Hour 1:15 - 2:15: Finish MCP server (1 hour)**

- [ ] Implement MCP tools: `getPoolPrice`, `getPoolTicks`, `getPoolVolume`, `getPoolFees`, `getRecentSwaps`, `getPoolTVL`
- [ ] Connect to Uniswap v3 subgraph on Sepolia via TheGraph
- [ ] Implement GraphQL queries for each tool
- [ ] Add RPC fallback for current spot price (direct `slot0()` read)
- [ ] Test against live Sepolia pool data
- [ ] Deploy/run MCP server, record endpoint URL in `.env`

**Skills**: `backend-developer`, `viem-integration`

**Hour 2:15 - 4:45: Dashboard (2.5 hours)**

Start with **mock data** (hardcoded agents, scores, positions). Wire to real contracts when ABIs arrive.

- [ ] 6.1 - Scaffold: Next.js app, viem clients for both chains, wagmi wallet connection for Sepolia
- [ ] 6.2 - Agent performance view: Sharpe scores, EMA returns, credit allocation, token bucket state (credits, maxCredits, refillRate), agent phase (proving/vault), zeroSharpeStreak, highlight starved vs rewarded agents
- [ ] 6.3 - Position view: agent Uniswap positions (tick range, liquidity, current price), recent intents + execution status, fees collected per agent per epoch
- [ ] 6.4 - Depositor view: share price, total assets, user share balance, deposit form (`satellite.deposit()`), withdraw form (`satellite.requestWithdraw()`), pending/claimable withdrawals
- [ ] 6.5 - iNFT marketplace view: list iNFTs with track record (Sharpe, returns, commission yield), commission claim button (`satellite.claimCommissions()`), pause/unpause controls (`satellite.pauseAgent()`), withdraw-from-arena button (`satellite.withdrawFromArena()`)
- [ ] 6.6 - Fee waterfall display: protocol fees accrued, commission pool, depositor yield, per-epoch breakdown
- [ ] Wire all mock data to real contract reads when ABIs land in `shared/abis/` (~hour 3:15+)

**Skills**: `frontend-dev`, `viem-integration`

---

## Hour 3:45 - 5:15 — Agent Strategies + Deploy All + Wire (all parallel)

### Dev A — Build 3 strategies + deploy agents (1.5 hours)
AgentManager is done. Now build the strategies that use it.

- [ ] Build 3 agent strategies (simple variations of the base loop):
  - [ ] Aggressive (Agent A): tight range (2-3% of price), rebalance when drift > 2%
  - [ ] Conservative (Agent B): wide range (10-20%), rebalance only when price exits range
  - [ ] Bad (Agent C): random tick ranges, unnecessary rebalances
- [ ] Wire agents to real MCP server endpoint (from PM)
- [ ] Wire agents to submit intents to real AgentManager address on 0G
- [ ] Deploy 3 OpenClaw instances to fly.io
- [ ] Verify agents produce and submit well-formed intents
- **Skills**: `.0g-skills/patterns/COMPUTE.md`, `liquidity-planner`, `backend-developer`

### Dev B — Deploy all 0G contracts + verify relayer
- [ ] Deploy iNFT contract to 0G testnet
- [ ] Deploy AgentManager to 0G testnet (with constructor params: alpha, maxAgents, totalRefillBudget, provingEpochsRequired, minPromotionSharpe, minActionInterval, messenger)
- [ ] Deploy Vault to 0G testnet (with constructor params: agentManager address, epochLength, maxExposureRatio, protocolFeeRate, protocolTreasury, commissionRate, depositToken, pool, messenger, satellite)
- [ ] Call `AgentManager.setVault(vaultAddress)` to complete circular reference
- [ ] Verify all contracts on 0G explorer
- [ ] Record all addresses in `.env`, announce to team
- [ ] Smoke test: deposit on satellite -> relayer -> shares minted on vault
- [ ] Verify relayer routes correctly to both Vault and AgentManager
- **Skills**: `deploy-contract`, `interact-contract`, `.0g-skills/patterns/NETWORK_CONFIG.md`

### PM — Wire dashboard to real contracts
- [ ] Replace all mock data with real contract reads using deployed addresses + ABIs
- [ ] Verify deposit/withdraw forms call real satellite functions
- [ ] Verify agent performance view reads real AgentManager state (Sharpe, EMAs, credits)
- **Skills**: `frontend-dev`, `viem-integration`

---

## Development Complete (~5.25 hours)

At this point, all components are built and deployed:
- Vault on 0G testnet (pure accounting: shares, deposits, withdrawals, fee waterfall, epoch orchestration)
- AgentManager on 0G testnet (agent lifecycle: registry, intents, token bucket, Sharpe scoring, promotion, eviction)
- iNFT on 0G testnet (ERC-721 ownership deeds)
- Satellite on Sepolia (deposits, Uniswap LP execution, fee reserves)
- Relayer running (12 event routes across Vault + AgentManager + Satellite)
- MCP server running (Uniswap subgraph data for agents)
- 3 agents on fly.io (submitting intents to AgentManager)
- Dashboard reading real data from both chains

---

## 14-Hour Buffer: Testing, Integration, Demo Prep

Everything below happens in the remaining ~14 hours. Order is flexible.

### Integration testing (Dev B leads, all help)
- [ ] End-to-end: deposit -> register agent -> submit intent -> relayer -> satellite executes LP -> report values -> epoch settlement -> Sharpe update
- [ ] Test promotion: proving agent meets `provingEpochsRequired` + `minPromotionSharpe` -> promoted
- [ ] Test eviction: bad agent accumulates `zeroSharpeStreak` >= `EVICTION_EPOCHS` -> evicted
- [ ] Test withdrawal: Tier 1 instant + Tier 2 queued + force-close enforcement
- [ ] Test commission claim: fee waterfall -> accrue -> claim on Sepolia -> satellite pays from commissionReserve
- [ ] Test pause/unpause: iNFT owner pauses via satellite -> AgentManager rejects intents
- [ ] Test withdraw-from-arena: force-close all positions, return capital, deregister
- [ ] Fix bugs across all components

### Demo state preparation (Dev A leads)
- [ ] Deploy FRESH AgentManager + Vault on 0G with demo-tuned params (short epochLength, low provingEpochsRequired, low EVICTION_EPOCHS)
- [ ] Call `AgentManager.setVault()` to link them
- [ ] Deploy FRESH satellite on Sepolia with same messenger
- [ ] Reconfigure relayer + dashboard + agents to new addresses
- [ ] Register 2 bad agents with proving capital, let them trade (build bad Sharpe)
- [ ] Register good agent with proving capital, let it complete proving phase
- [ ] Pause good agent one epoch before promotion threshold
- [ ] Verify bad agents have zeroSharpeStreak near eviction threshold
- [ ] Verify dashboard shows correct state for demo

### Dashboard polish (PM leads)
- [ ] Color coding for good/bad agents (green/red Sharpe indicators)
- [ ] Visual capital flow animation (credits moving between agents)
- [ ] Responsive layout for presentation screen
- [ ] Error states and loading indicators

### Demo rehearsal (all together)
- [ ] Run full 3-minute demo script:
  1. Show bad agents on dashboard (~30s)
  2. Show good agent's proving track record (~45s)
  3. Trigger promotion epoch live (~30s)
  4. Show commissions + iNFT marketplace (~30s)
  5. Show bad agent eviction (~30s)
- [ ] Time each section
- [ ] Test relayer reliability under demo conditions

### Fallback preparation (Dev B leads)
- [ ] Set up Anvil fork of 0G testnet as backup
- [ ] Verify contracts deploy and work on Anvil fork
- [ ] Record fallback demo video

### Stretch goal: 0G Storage for epoch history (PM)
- [ ] Listen for `EpochSettled` events on vault
- [ ] Upload epoch snapshots to 0G decentralized storage
- [ ] Store root hashes on-chain for auditability
- [ ] Dashboard reads historical data from 0G storage for charts
- **Skills**: `upload-file`, `storage-plus-chain`, `.0g-skills/patterns/STORAGE.md`, `merkle-verification`

---

## Handoff Protocol

| What | From | To | Where | When |
|------|------|----|-------|------|
| Shared interfaces (`IVault.sol`, `ISatellite.sol`, `IAgentManager.sol`) | Dev A | Dev B | `contracts/interfaces/` | Hour 0:30 |
| Sepolia pool address + USDC.e | PM | Dev A, Dev B | `.env` | Hour 1:15 |
| Vault ABIs | Dev B | Dev A, PM | `shared/abis/` | Hour 2:00 |
| MCP server endpoint | PM | Dev A | `.env` | Hour 2:15 |
| Satellite ABIs | Dev B | Dev A, PM | `shared/abis/` | Hour 3:15 |
| Deployed satellite address | Dev B | Dev A, PM | `.env` | Hour 3:30 |
| AgentManager ABIs | Dev A | Dev B, PM | `shared/abis/` | Hour 3:45 |
| Deployed vault + AgentManager + iNFT addresses | Dev B | Dev A, PM | `.env` | Hour 4:45 |
| Running relayer | Dev B | Dev A (agents) | local / fly.io | Hour 4:45 |

## Mocking Strategy

**Don't wait. Mock and move on.**

| If you need... | Mock it with... | Replace when... |
|---|---|---|
| Contract ABIs | Hardcode interface types in your code | ABIs land in `shared/abis/` |
| Deployed contract address | Use `0x0000...` placeholder in `.env` | Real address is deployed |
| Vault for agent testing | Agents log intents to console | Vault is deployed + relayer runs |
| MCP server for agents | Hardcoded pool price and tick data | PM's MCP server is running |
| Real contract data for dashboard | Hardcoded JSON with fake agents/scores | Wire to real contracts with viem |
| Relayer running | Submit intents directly to AgentManager for testing | Relayer is live |
| Uniswap pool on Sepolia | Use any existing pool temporarily | PM sets up the real pool |

---

## Skill Reference Per Developer

| Developer | Skills to load |
|-----------|---------------|
| **Dev A** | `.0g-skills/patterns/CHAIN.md`, `.0g-skills/patterns/SECURITY.md`, `.0g-skills/AGENTS.md`, `.0g-skills/patterns/COMPUTE.md`, `liquidity-planner`, `backend-developer` |
| **Dev B** | `.0g-skills/patterns/CHAIN.md`, `swap-integration`, `liquidity-planner`, `deploy-contract`, `interact-contract`, `backend-developer`, `.0g-skills/patterns/NETWORK_CONFIG.md` |
| **PM** | `scaffold-project`, `frontend-dev`, `viem-integration`, `liquidity-planner`, `backend-developer`, `.0g-skills/patterns/NETWORK_CONFIG.md` |

---

## Timeline View

```
              0:00   0:30   1:15    2:00         3:15   3:30   3:45         4:45    5:15
Dev A    [interfaces] [agent base] [-------- AgentManager contract --------] [-- strategies + deploy --]
Dev B    [hardhat   ] [-- vault --] [--- satellite ---] [dep sat] [-- relayer --] [dep vault+AM]
PM       [scaffold+fund] [pool+MCP server] [----------- dashboard (mock -> real) -----------]
                                    ^        ^                         ^              ^
                                    |        |                         |              |
                               MCP ready  vault ABIs             sat ABIs       AM ABIs + all
                              pool ready                        + deployed      deployed + relayer

                     5:15 -------- 14 HOURS -------->
                     [integration testing | demo prep | polish | fallbacks | 0G storage (stretch)]
```

**Critical path**: interfaces (0:30) -> AgentManager (1:15-3:45) -> strategies + deploy (3:45-5:15)

**Key advantage of the split**: Dev B builds the simpler Vault (45 min) THEN satellite (1.25 hrs) — both money-flow contracts. Dev A builds AgentManager (2.5 hrs) — all scoring/lifecycle. They never touch the same `.sol` file. Dev B finishes Vault ABIs at hour 2:00, giving PM earlier access to contract types for dashboard wiring.
