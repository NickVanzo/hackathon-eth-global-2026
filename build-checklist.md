# Agent Arena - Build Checklist (5.5 Hours Dev, 9 Hours Testing/Polish)

## Team

- **Dev A** (Senior, scoring + agents focus) — Shared interfaces + Agent base + AgentManager contract + Agent strategies
- **Dev B** (Senior, Uniswap + infra focus) — Satellite contract + Relayer + All deployments
- **PM** (Vibe coding with Claude) — Project setup + MCP server + Dashboard

**Rule**: everyone works in parallel at all times. If you need something from someone else, **mock it** and move on. Replace mocks with real implementations when the dependency is delivered.

**Development scope**: everything needed to have a working system. Testing, integration, demo prep, and polish happen in the 9-hour buffer. 0G Storage stretch goal is cut.

---

## Hour 0:00 - 0:30 — Setup (all parallel)

### Dev A — Shared interfaces + agent base
- [x] Define `Intent` struct (agentId, actionType, params)
- [x] Define all cross-chain event signatures (Deposited, AgentRegistered, WithdrawRequested, IntentQueued, ValuesReported, EpochSettled, WithdrawApproved, WithdrawReleased, CommissionAccrued, ProtocolFeeAccrued, CommissionClaimRequested, CommissionApproved, PauseRequested, WithdrawFromArenaRequested, ForceCloseRequested(agentId, source), PositionClosed(agentId, positionId, recoveredAmount), RecoveryRecorded, ClaimWithdrawRequested)
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
- [x] Configure MCP connection interface (cron-trigger.js MCP client + query-pool.mjs skill, tested against mock + live Firebase MCP)
- [x] Implement base agent loop: read market data -> decide -> produce Intent struct -> log/queue intent (cron-trigger.js: tool-calling flow via 0G Compute Adapter pattern)
- [x] Define intent action types: OPEN_POSITION, CLOSE_POSITION, MODIFY_POSITION (mapped to IShared.ActionType enum in cron-trigger.js + submit-intent.mjs)
- [x] Implement intent serialization matching the `Intent` struct from interfaces (submit-intent.mjs ABI-encodes IntentParams: amountUSDC, tickLower, tickUpper)
- [x] Verify agent can produce well-formed intents with mock market data (dry-run intents verified with mock + live MCP)
- **Skills**: `.0g-skills/AGENTS.md`, `.0g-skills/patterns/COMPUTE.md`, `backend-developer`

### Dev B — Start satellite contract
Begin satellite immediately using shared interfaces from Dev A.

- [x] Start 2.1 - Core: `deposit()`, `registerAgent()`, `requestWithdraw()`, `release()`, `updateSharePrice()`, idle reserve tracking, `onlyMessenger` modifier
- **Skills**: `.0g-skills/patterns/CHAIN.md`, `swap-integration`, `liquidity-planner`

### PM — Pool setup + start MCP server
- [ ] Finish funding wallets
- [x] Deploy or identify test USDC.e token on Sepolia
- [x] Deploy or identify Uniswap v3 pool on Sepolia (e.g., USDC.e/WETH)
- [x] Seed pool with initial liquidity
- [x] Record pool address, token addresses, fee tier in `.env`
- [x] Start MCP server: set up Node.js project with @modelcontextprotocol/sdk
- **Skills**: `liquidity-planner`, `swap-integration`, `.0g-skills/patterns/NETWORK_CONFIG.md`

---

## Hour 1:15 - 4:45 — Core Build (all parallel)

### Dev A — AgentManager contract (2.5 hours) then help with Vault
The agent lifecycle contract — scoring, intents, token bucket. Separate from the Vault for clarity and to stay under 24KB contract size limit.

**Skills**: `.0g-skills/patterns/CHAIN.md`, `.0g-skills/patterns/SECURITY.md`

- [ ] Agent registry: agent state (phase PROVING/VAULT, provingBalance, provingDeployed, agentAddress, epochsCompleted, zeroSharpeStreak)
- [ ] iNFT contract (ERC-721): mint on registration, `ownerOf` for auth checks
- [ ] `recordRegistration(agentId, agentAddress, deployer, provingAmount)` — `onlyMessenger`, registers agent, records provingBalance, mints iNFT
- [ ] `totalDeployedVault` — running counter of vault capital deployed; public getter for Vault to read
- [ ] `submitIntent(agentId, actionType, params)` — proving/vault branching, cooldown (`minActionInterval`), credit refill/check for vault agents, `provingBalance - provingDeployed` for proving agents, vault agents check `vault.totalAssets() - totalDeployedVault >= amount`, increment `totalDeployedVault` for vault intents, auto-set `source` field (PROVING/VAULT) based on phase, emit `IntentQueued`
- [ ] Token bucket: credits, refillRate, maxCredits per agent, credit refill logic
- [ ] `recordClosure(agentId, recoveredAmount, source)` — `onlyMessenger`; `source` from relayer's position cache (NOT agent phase lookup). If VAULT: decrement `totalDeployedVault`, refund credits (if agent exists). If PROVING: decrement `provingDeployed`. If agent deregistered: skip per-agent bookkeeping silently
- [ ] `reportValues(agentId, positionValue, feesCollected)` — `onlyMessenger`, stores last reported values + `lastReportedBlock`
- [ ] `settleAgents(totalAssets, maxExposureRatio)` — `onlyVault`, receives both params from Vault:
  - EMA updates (emaReturn, emaReturnSq) with alpha decay
  - Sharpe computation with `Math.sqrt`, `MIN_VARIANCE` floor, negative clamping, all-zero fallback
  - Score-to-credit allocation (refillRate, maxCredits using passed totalAssets + maxExposureRatio), promotion ramp (effectiveMaxCredits, maxPromotionShare, rampEpochs)
  - Promotion check (epochsCompleted + minPromotionSharpe), reset zeroSharpeStreak on promotion, carry over proving-phase EMAs as starting point (do NOT reset — no cold start)
  - Eviction check (zeroSharpeStreak, skip paused, evictionEpochs): vault eviction emits `ForceCloseRequested(agentId, VAULT)` + drops to proving + resets EMAs; proving ejection emits `ForceCloseRequested(agentId, PROVING)` + deregisters immediately
  - Returns to Vault: per-agent feesCollected, aggregate vault-agent position value, Sharpe-sorted agent list (lowest first)
- [ ] `processPause(agentId, caller, paused)` — `onlyMessenger`, checks `iNFT.ownerOf(agentId) == caller`
- [ ] `processCommissionClaim(agentId, caller)` — `onlyMessenger`, checks `iNFT.ownerOf(agentId) == caller`, then calls `Vault.approveCommissionRelease(agentId)` (no amount — Vault reads own state)
- [ ] `processWithdrawFromArena(agentId, caller)` — `onlyMessenger`, checks iNFT ownership, emits `ForceCloseRequested(agentId, ALL)`, deregisters agent immediately (clears token bucket, EMAs, registry, frees `maxAgents` slot)
- [ ] `setVault(address)` — one-time initialization to set circular reference after Vault deploys
- [ ] `onlyMessenger` and `onlyVault` modifiers
- [ ] Compile AgentManager + iNFT, generate ABIs, push to `shared/abis/`

**After AgentManager is done (~hour 3:45)**: Dev A starts building agent strategies (see Hour 4:45 section) or helps Dev B with Vault if needed.

### Dev B — Vault (accounting) + Satellite + deploy + relayer (3.5 hours)

**Hour 1:15 - 2:00: Vault contract (45 min)**

The Vault is now simpler — pure accounting, no agent logic. AgentManager handles all agent state.

**Skills**: `.0g-skills/patterns/CHAIN.md`, `.0g-skills/patterns/SECURITY.md`

- [x] Share token (ERC20 mint/burn), `totalAssets` state variable, `sharePrice()` = `totalAssets / totalShares`
- [x] `recordDeposit(user, amount)` — `onlyMessenger`, mints shares, increments `totalAssets`
- [x] `processWithdraw(user, shares)` — `onlyMessenger`; estimates idle as `totalAssets - agentManager.totalDeployedVault()`; if `shares * sharePrice <= idle` (Tier 1): burns shares, decrements `totalAssets`, emits `WithdrawApproved`; otherwise (Tier 2): locks shares, queues with timestamp
- [x] Withdrawal queue: Tier 1 instant, Tier 2 queued, `claimWithdraw(user, amount)` — `onlyMessenger`, marks queued entry processed, emits `WithdrawReleased`
- [x] `recordRecovery(agentId, recoveredAmount)` — `onlyMessenger`; does NOT update `totalAssets` (epoch reconciliation handles it); records audit event, emits `RecoveryRecorded`
- [x] `epochCheck` modifier + `_settleEpoch()` orchestration + public `triggerSettleEpoch()`:
  - Calls `AgentManager.settleAgents(totalAssets, maxExposureRatio)` — receives per-agent feesCollected, aggregate vault-agent position value, Sharpe-sorted agent list
  - Reconciles `totalAssets = aggregateVaultPositionValue + idle + depositorReturn`
  - Applies fee waterfall (protocolFee first, then agentCommission, remainder is depositorReturn)
  - Checks pending withdrawal queue against idle; emits `ForceCloseRequested(agentId, VAULT)` for lowest-Sharpe agents if insufficient
  - Emits `EpochSettled(sharePrice, totalShares, totalAssets)`
- [x] Fee waterfall: `protocolFeesAccrued`, `commissionsOwed[agentId]`, `approveCommissionRelease(agentId)` — `onlyAgentManager`, NO amount param (reads own state), zeroes commissionsOwed, emits `CommissionApproved(agentId, amount)`
- [x] `onlyMessenger` and `onlyAgentManager` modifiers
- [x] Compile Vault, generate ABIs, push to `shared/abis/`

**Hour 2:00 - 3:15: Finish satellite (1.25 hours)**

- [x] Finish 2.1 - Core: `claimWithdraw()`, `releaseQueuedWithdraw()` (messenger only, for Tier 2), idle reserve tracking refinement
- [x] 2.2 - Uniswap execution: `executeBatch()` (messenger only), each intent carries `source` field (PROVING/VAULT) — satellite stores in `positionSource[tokenId]` mapping at mint time. Swap legs: forward Uniswap-API-generated calldata to **Universal Router** (not SwapRouter). LP: NonfungiblePositionManager.mint/decreaseLiquidity/collect. Zap-in/zap-out via Universal Router. Position NFT tracking per agentId. `collect()` on all positions at epoch reporting. Position valuation (slot0 + token amounts). Emit `ValuesReported(agentId, positionValue, feesCollected)`
- [x] 2.3 - Fee reserves: `reserveProtocolFees(amount)` + `reserveCommission(agentId, amount)` (two separate functions, both messenger only), `protocolReserve`/`commissionReserve` pools, `claimProtocolFees()` (protocolTreasury only), `claimCommissions(agentId)` (emit CommissionClaimRequested), `releaseCommission(caller, amount)` (messenger only, from commissionReserve)
- [x] 2.4 - Agent management: `pauseAgent(agentId)`/`unpauseAgent(agentId)` (emit PauseRequested), `withdrawFromArena(agentId)` (emit WithdrawFromArenaRequested)
- [x] 2.5 - Force-close: `forceClose(agentId, positionIds[], source)` (messenger only), close positions filtered by `source` tag via zap-out, emit `PositionClosed(agentId, positionId, recoveredAmount)` per position, return capital to correct destination
- [x] Compile satellite, generate ABIs, push to `shared/abis/`

**Skills**: `.0g-skills/patterns/CHAIN.md`, `swap-integration`, `liquidity-planner`

**Hour 3:15 - 3:30: Deploy satellite (15 min)**

- [x] Deploy satellite to Sepolia with constructor params (messenger, depositToken, pool, positionManager, universalRouter, protocolTreasury, idleReserveRatio)
- [x] Verify on Etherscan Sepolia
- [x] Record address in `.env`, announce to team

**Skills**: `deploy-contract`, `.0g-skills/patterns/NETWORK_CONFIG.md`

**Hour 3:30 - 4:45: Relayer (1.25 hours)**

- [ ] Set up ethers v6 providers for both 0G testnet and Sepolia
- [ ] Load ABIs from `shared/abis/`
- [ ] Maintain relayer position cache: `agentId → [{tokenId, source}]` mapping, updated by watching `executeBatch` mints and `PositionClosed` burns on satellite
- [ ] Uniswap Trading API integration: call POST `/swap` and `/route` endpoints to generate optimized calldata before each `executeBatch` dispatch
- [ ] Implement event routes — **Sepolia → 0G**:
  - [ ] `Deposited` → `vault.recordDeposit()`
  - [ ] `AgentRegistered` → `agentManager.recordRegistration()`
  - [ ] `WithdrawRequested` → `vault.processWithdraw()`
  - [ ] `ValuesReported` → `agentManager.reportValues()`
  - [ ] `CommissionClaimRequested` → `agentManager.processCommissionClaim()`
  - [ ] `PauseRequested` → `agentManager.processPause()`
  - [ ] `WithdrawFromArenaRequested` → `agentManager.processWithdrawFromArena()`
  - [ ] `ClaimWithdrawRequested` → `vault.claimWithdraw()` then `satellite.releaseQueuedWithdraw()`
  - [ ] `PositionClosed` → `agentManager.recordClosure(agentId, recoveredAmount, source)` + `vault.recordRecovery(agentId, recoveredAmount)` (source from position cache)
- [ ] Implement event routes — **0G → Sepolia**:
  - [ ] `IntentQueued` → Uniswap Trading API POST → `satellite.executeBatch()` (with API calldata + source field)
  - [ ] `EpochSettled` → `satellite.updateSharePrice()`
  - [ ] `WithdrawApproved` → `satellite.release()`
  - [ ] `ProtocolFeeAccrued` → `satellite.reserveProtocolFees(amount)` (once per epoch)
  - [ ] `CommissionAccrued` → `satellite.reserveCommission(agentId, amount)` (once per agent)
  - [ ] `CommissionApproved` → `satellite.releaseCommission(caller, amount)`
  - [ ] `ForceCloseRequested(agentId, source)` → look up position cache → `satellite.forceClose(agentId, positionIds[], source)` (listen on BOTH Vault and AgentManager)
- [ ] Periodic `vault.triggerSettleEpoch()` call (once per epoch in main loop)
- [ ] Event deduplication (don't process same event twice)
- [ ] Retry logic + nonce management
- [ ] Structured logging (timestamp, event type, tx hash, chain)
- [ ] Health check endpoint (for monitoring during demo)
- [ ] Start relayer as persistent process (pm2 or background node)

**Skills**: `backend-developer`, `.0g-skills/patterns/CHAIN.md`, `.0g-skills/patterns/NETWORK_CONFIG.md`

### PM — MCP server + dashboard (3.5 hours)

**Hour 1:15 - 2:15: Finish MCP server (1 hour)**

- [x] Implement MCP tools — subgraph data: `getPoolPrice`, `getPoolTicks`, `getPoolVolume`, `getPoolFees`, `getRecentSwaps`, `getPoolTVL`
- [x] Connect to Uniswap v3 subgraph on Sepolia via TheGraph
- [x] Implement GraphQL queries for each tool
- [x] Implement MCP tools — Uniswap Trading API GET proxying: `getQuote` (→ GET /quote), `getRoute` (→ GET /route), `getPools` (→ GET /pools), `getPositions` (→ GET /positions). MCP server holds the Uniswap API key — agents never see it
- [x] Add RPC fallback for current spot price (direct `slot0()` read)
- [x] Test against live Sepolia pool data
- [x] Deploy/run MCP server, record endpoint URL in `.env`

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

- [x] Build 3 agent strategies (revised per design doc to match demo narrative):
  - [x] Passive LP (Agent Alpha, bad): max tick range, never rebalance — Sharpe → 0 → evicted
  - [x] Contrarian (Agent Beta, bad): range opposite to price direction every epoch — always out of range → evicted
  - [x] Disciplined Rebalancer (Agent Gamma, good): ±200 tick range, hold unless drift >80% — stays in range → promoted
- [x] Wire agents to real MCP server endpoint (cron-trigger.js calls live Firebase MCP at us-central1-subgraph-mcp.cloudfunctions.net/mcp)
- [ ] Wire agents to submit intents to real AgentManager address on 0G (blocked: VAULT_ADDRESS/AGENT_MANAGER_ADDRESS not deployed yet)
- [x] Deploy 3 OpenClaw instances to fly.io (running with DRY_RUN=true)
- [x] Verify agents produce and submit well-formed intents (dry-run verified with mock + live MCP)
- **Skills**: `.0g-skills/patterns/COMPUTE.md`, `liquidity-planner`, `backend-developer`

### Dev B — Deploy all 0G contracts + verify relayer
- [ ] Deploy iNFT contract to 0G testnet
- [ ] Deploy AgentManager to 0G testnet (with constructor params: alpha, maxAgents, totalRefillBudget, provingEpochsRequired, minPromotionSharpe, minActionInterval, maxPromotionShare, rampEpochs, evictionEpochs, messenger)
- [x] Deploy Vault to 0G testnet (with constructor params: agentManager, epochLength, maxExposureRatio, protocolFeeRate, protocolTreasury, commissionRate, depositToken, pool, messenger). Verify deployment invariant: `maxExposureRatio + idleReserveRatio = 10000`
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
- Vault on 0G testnet (pure accounting: shares, totalAssets state variable, deposits, withdrawals, fee waterfall, epoch orchestration with totalAssets reconciliation, onlyMessenger + onlyAgentManager)
- AgentManager on 0G testnet (agent lifecycle: registry, intents, totalDeployedVault counter, token bucket, recordClosure with source param, Sharpe scoring, promotion, eviction with ForceCloseRequested emission, onlyMessenger + onlyVault)
- iNFT on 0G testnet (ERC-721 ownership deeds)
- Satellite on Sepolia (deposits, Uniswap LP execution via Universal Router + NonfungiblePositionManager, positionSource mapping, fee reserves split into reserveProtocolFees + reserveCommission, forceClose with source param)
- Relayer running (event routes across Vault + AgentManager + Satellite, Uniswap Trading API POST integration, position cache, periodic triggerSettleEpoch)
- MCP server running (Uniswap subgraph data + Uniswap Trading API GET proxying for agents)
- 3 agents on fly.io (submitting intents to AgentManager)
- Dashboard reading real data from both chains

---

## 9-Hour Buffer: Testing, Integration, Demo Prep

Everything below happens in the remaining ~9 hours. **Parallelism is critical** — all 3 people work simultaneously at every phase. The stretch goal is cut.

### Phase 1: Integration testing + dashboard polish (hours 0-4, all parallel)

Use the SAME deployed contracts from development for integration testing — don't fresh-deploy yet. Fix bugs as you find them.

**Dev B — core flow testing (hours 0-4)**
- [ ] End-to-end happy path: deposit → register agent → submit intent → relayer → satellite executes LP → report values → epoch settlement → Sharpe update
- [ ] Test Uniswap Trading API integration: relayer POST calls return valid Universal Router calldata, satellite executes it successfully
- [ ] Test withdrawal: Tier 1 instant + Tier 2 queued + force-close enforcement
- [ ] Test relayer position cache: verify agentId → tokenIds mapping stays accurate through opens, closes, and force-closes
- [ ] Test recordClosure with `source` parameter: verify VAULT source decrements `totalDeployedVault`, PROVING source decrements `provingDeployed`, deregistered agent skips silently
- [ ] Fix relayer/satellite bugs as found

**Dev A — agent lifecycle testing (hours 0-4)**
- [ ] Test promotion: proving agent meets `provingEpochsRequired` + `minPromotionSharpe` → promoted
- [ ] Test eviction: bad agent accumulates `zeroSharpeStreak` >= `evictionEpochs` → evicted (vault agent drops to proving)
- [ ] Test proving agent ejection: Sharpe clamped to 0 for `evictionEpochs` → immediate deregistration + ForceCloseRequested(agentId, PROVING) emitted
- [ ] Test commission claim: fee waterfall → accrue → claim on Sepolia → satellite pays from commissionReserve
- [ ] Test pause/unpause: iNFT owner pauses via satellite → AgentManager rejects intents
- [ ] Test withdraw-from-arena: force-close all positions (both VAULT + PROVING tagged), return capital, immediate deregister, verify recordClosure works for deregistered agent
- [ ] Fix AgentManager/agent bugs as found

**PM — dashboard polish + verification (hours 0-4)**
- [ ] Color coding for good/bad agents (green/red Sharpe indicators)
- [ ] Responsive layout for presentation screen
- [ ] Error states and loading indicators
- [ ] Verify deposit/withdraw forms work end-to-end through real satellite
- [ ] Verify agent performance view reads real AgentManager state correctly

### Phase 2: Demo state preparation (hours 4-6, Dev A leads + Dev B assists)

Only fresh-deploy if integration testing revealed contract bugs requiring redeployment. Otherwise reuse existing contracts and just reset agent state.

**Dev A + Dev B**
- [ ] Deploy FRESH AgentManager + Vault on 0G with demo-tuned params (short epochLength, low provingEpochsRequired, low evictionEpochs, maxPromotionShare, rampEpochs). Verify `maxExposureRatio + idleReserveRatio = 10000`
- [ ] Call `AgentManager.setVault()` to link them
- [ ] Deploy FRESH satellite on Sepolia with same messenger (only if satellite bugs were found; otherwise reuse)
- [ ] Reconfigure relayer + dashboard + agents to new addresses
- [ ] Register 2 bad agents with proving capital, let them trade (build bad Sharpe)
- [ ] Register good agent with proving capital, let it run through proving phase until `provingEpochsRequired - 1` epochs completed (running normally, NOT paused — next epoch settlement triggers automatic promotion live on stage)
- [ ] Verify bad agents have zeroSharpeStreak near eviction threshold
- [ ] Verify dashboard shows correct state for demo

**PM — while devs prep demo state**
- [ ] Prepare pitch slides / talking points if needed
- [ ] Final dashboard tweaks based on real demo data appearance

### Phase 3: Demo rehearsal (hours 6-7, all together — NON-NEGOTIABLE)

- [ ] Run full 3-minute demo script:
  1. Show bad agents on dashboard (~30s)
  2. Show good agent's proving track record (~45s)
  3. Trigger promotion epoch live (~30s)
  4. Show commissions + iNFT marketplace (~30s)
  5. Show bad agent eviction (~30s)
- [ ] Time each section
- [ ] Test relayer reliability under demo conditions
- [ ] If anything fails: fix and re-rehearse (this is why we have 1 full hour)

### Phase 4: Fallback preparation (hours 7-8, Dev B leads)

- [ ] Set up Anvil fork of 0G testnet as backup
- [ ] Verify contracts deploy and work on Anvil fork
- [ ] Record fallback demo video (screen recording of the full 3-minute flow)

### Hour 8-9: Buffer for fires

Unallocated hour for whatever went wrong. If nothing did: rest, review pitch, charge laptops.

### CUT: 0G Storage stretch goal
~~0G Storage for epoch history~~ — dropped due to 9-hour budget. Can mention as "future work" in the pitch if asked.

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

                     5:15 ---------- 9 HOURS ---------->
                     [--- integration + polish (4h) ---][demo prep (2h)][rehearsal (1h)][fallback (1h)][buffer (1h)]
                     Dev A: agent lifecycle tests        deploy+agents   all together    rest/fires
                     Dev B: core flow tests              assist deploy   all together    Anvil+video
                     PM:    dashboard polish+verify      pitch prep      all together    rest/fires
```

**Critical path**: interfaces (0:30) -> AgentManager (1:15-3:45) -> strategies + deploy (3:45-5:15)

**Key advantage of the split**: Dev B builds the simpler Vault (45 min) THEN satellite (1.25 hrs) — both money-flow contracts. Dev A builds AgentManager (2.5 hrs) — all scoring/lifecycle. They never touch the same `.sol` file. Dev B finishes Vault ABIs at hour 2:00, giving PM earlier access to contract types for dashboard wiring.
