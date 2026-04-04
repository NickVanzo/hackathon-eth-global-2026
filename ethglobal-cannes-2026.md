# ETHGlobal Cannes 2026 - Project Plan

## Project Name: Agent Arena (working title)

A decentralized competitive marketplace where AI agents compete to manage liquidity on Uniswap, with strategy ownership represented as iNFTs.

---

## Core Concept

A single vault where users deposit funds. Multiple AI agents, each running on 0G's sandboxed OpenClaw infrastructure (deployed on fly.io), compete to manage portions of the vault's liquidity on Uniswap. Capital is allocated proportionally to the best-performing agents. Strategy creators own their agents via iNFTs and earn commissions from performance.

---

## Architecture

```
0G Testnet (accounting only)                              Ethereum Sepolia (all tokens)
+------------------------------------------------------+  +------------------------------+
| Vault (pure accounting)  | AgentManager (lifecycle)   |  | Satellite Contract           |
| - share token (ERC20)    | - agent registry           |  | - holds ALL tokens (USDC.e)  |
| - totalAssets, sharePrice | - iNFT contract (ERC721)  |  | - holds idle reserve (20%)   |
| - deposits/withdrawals   | - intent queue + validation|  | - owns all LP positions      |
| - fee waterfall          | - token bucket allocator   |  | - swap via Universal Router  |
| - commission ledger      | - Sharpe scoring / EMAs    |  | - LP via PositionManager     |
| - epochCheck + settle    | - promotion / eviction     |  | - reports position values    |
|                          | - pause mechanism          |  | - handles deposits/withdraws |
+-----------+--------------+-----------+----------------+  +------------------------------+
            |                          |
  Vault calls AgentManager       Relayer (JS script for
  for fees + eviction results    hackathon; permissionless
  during epoch settlement.       network for prod)
  AgentManager tracks            <--------- connects --------->
  totalDeployedVault.            both sides via events
            |
            | submitIntent(agentId, action, params)
            |          (on AgentManager)
  +-----------+-----------+
  |           |           |
Agent A     Agent B     Agent C
(iNFT #1)   (iNFT #2)   (iNFT #3)
[bucket]    [bucket]    [bucket]
(agent EOA) (agent EOA) (agent EOA)
  |           |           |
  +-----+-----+
        |
  Data Layer MCP
  (subgraph + Uniswap API GET:
   quotes, pools, positions)

Users deposit/withdraw directly on Sepolia via satellite
Proving agents deposit on Sepolia via satellite
```

### Contract Split: Vault vs AgentManager

The 0G-side logic is split into two contracts to stay under the 24KB Solidity contract size limit and for clarity:

**Vault** (pure accounting) — owns shares, money flow, and epoch orchestration:
- Share token (ERC20 mint/burn), `totalAssets` state variable (vault-agent positions only — see "Proving vs vault capital in `totalAssets()`" under Performance Tracking; updated by `recordDeposit` +amount, `processWithdraw` -amount, and reconciled at each epoch settlement as `aggregateVaultPositionValue + idle + depositorReturn` — see `_settleEpoch()` step 2), `sharePrice()` = `totalAssets / totalShares`
- `recordDeposit()` — `onlyMessenger`
- `processWithdraw(user, shares)` — `onlyMessenger`; conditional behavior: estimates satellite idle as `totalAssets() - totalDeployedVault` (same approximation used in `submitIntent()`); if `shares * sharePrice <= idle estimate` (Tier 1), burns shares immediately and emits `WithdrawApproved`; otherwise (Tier 2), locks shares and queues the request with a timestamp
- `claimWithdraw(user, amount)` — `onlyMessenger`; called by relayer after satellite releases a Tier 2 withdrawal, marks the queued entry as processed (prevents double-release), emits `WithdrawReleased`
- `recordRecovery(agentId, recoveredAmount)` — `onlyMessenger`; called by relayer after a force-close settles on Sepolia. Does not update `totalAssets` directly — the next epoch's `settleAgents()` reconciliation handles it. Records the recovery event for audit and emits `RecoveryRecorded(agentId, recoveredAmount)`
- Withdrawal queue (Tier 1 instant, Tier 2 queued)
- Fee waterfall computation (`protocolFeesAccrued`, `commissionsOwed`)
- `approveCommissionRelease(agentId)` — `onlyAgentManager`; reads `commissionsOwed[agentId]` from its own storage, zeroes it, and emits `CommissionApproved(agentId, amount)`. AgentManager never needs to know the amount — the relayer reads it from the emitted event
- `epochCheck` modifier + `_settleEpoch()` orchestration (calls AgentManager for agent data)
- `onlyMessenger` and `onlyAgentManager` modifiers

**AgentManager** (agent lifecycle) — owns agents, intents, scoring:
- Agent registry (phase, provingBalance, provingDeployed, agentAddress)
- `recordRegistration(agentId, agentAddress, deployer, provingAmount)` — `onlyMessenger`; registers agent, records `provingBalance`, mints iNFT to deployer
- iNFT contract (ERC-721, minted on registration)
- `totalDeployedVault` — running counter of vault capital currently deployed across all vault agents; incremented on intent submission, decremented via `recordClosure()`. Public getter used by Vault for accounting
- `recordClosure(agentId, recoveredAmount, source)` — `onlyMessenger`; called by relayer after any position close (agent-initiated or force-close). The `source` parameter (`VAULT` or `PROVING`) is provided by the relayer from its `positionSource` cache — the function does NOT look up the agent's current phase (which may be stale after eviction). If `source == VAULT`: decrements `totalDeployedVault`, refunds credits (if agent still has a bucket). If `source == PROVING`: decrements `provingDeployed`. If agent is no longer registered (ejected proving agent): skips per-agent bookkeeping silently
- `submitIntent()` — entry point for agents, validates credits/cooldown/pause; for vault agents checks `vault.totalAssets() - totalDeployedVault >= amount` (one read from Vault, no cross-contract write), emits `IntentQueued`
- Token bucket (credits, refillRate, maxCredits per agent)
- `reportValues(agentId, positionValue, feesCollected)` — `onlyMessenger`; stores `positionValue`, `feesCollected`, `lastReportedBlock` per agent
- Sharpe scoring: EMA updates, variance, sqrt, MIN_VARIANCE floor, negative clamping, all-zero fallback
- Score-to-credit allocation, promotion ramp
- Promotion check (`provingEpochsRequired` + `minPromotionSharpe`)
- Eviction (`zeroSharpeStreak`, skip paused, `evictionEpochs`)
- `processPause(agentId, caller, paused)` — `onlyMessenger`; checks iNFT ownership, updates paused flag
- `processCommissionClaim(agentId, caller)` — `onlyMessenger`; checks `iNFT.ownerOf(agentId) == caller`, then calls `vault.approveCommissionRelease(agentId)` (no amount — Vault reads from its own state)
- `settleAgents(totalAssets, maxExposureRatio)` — `onlyVault`; called by Vault's `_settleEpoch()`. Runs EMA updates, Sharpe computation, eviction/promotion checks, bucket rebalancing. Emits `ForceCloseRequested(agentId, source)` directly for eviction-driven force-closes. Returns to Vault: per-agent `feesCollected`, aggregate vault-agent position value, and Sharpe-sorted agent list (lowest first, for Vault's withdrawal-driven force-close targeting)
- `processWithdrawFromArena(agentId, caller)` — `onlyMessenger`; checks iNFT ownership, emits `ForceCloseRequested(agentId, ALL)`, and **deregisters the agent immediately** (clears token bucket, EMAs, registry entry, frees `maxAgents` slot). This is safe because `recordClosure` uses the relayer-provided `source` parameter — it doesn't need the agent to be registered. For VAULT-tagged closures, `totalDeployedVault` is a global counter (works without the agent existing); credit refund is skipped (meaningless for a departing agent). For PROVING-tagged closures, per-agent bookkeeping is skipped silently
- `onlyMessenger` and `onlyVault` modifiers

**Cross-contract calls:**
- `_settleEpoch()` (on Vault) calls `AgentManager.settleAgents(totalAssets, maxExposureRatio)` — `onlyVault` on AgentManager; Vault passes its own `totalAssets` and `maxExposureRatio` so AgentManager can compute credit allocations without reading back. Returns: per-agent `feesCollected`, aggregate vault-agent position value (for Vault's `totalAssets` update), and Sharpe-sorted agent list (for withdrawal-driven force-close targeting). Eviction/ejection force-close events are emitted directly by AgentManager during the call — not returned. Scores stay in AgentManager state
- `processWithdraw()` and `_settleEpoch()` step 3 (on Vault) read `agentManager.totalDeployedVault()` to estimate satellite idle as `totalAssets - totalDeployedVault` — a single public getter read, no write
- `submitIntent()` (on AgentManager) reads `vault.totalAssets()` to compute available idle capital against `totalDeployedVault` — a single read, no write
- `processCommissionClaim()` (on AgentManager) calls `Vault.approveCommissionRelease(agentId)` after verifying iNFT ownership — Vault reads its own `commissionsOwed[agentId]`, no amount parameter needed
- All three contracts (Vault, AgentManager, Satellite) share the `messenger` address for relayer authorization

**Force-close event flow** (eviction, forced withdrawal, withdraw-from-arena):
`ForceCloseRequested(agentId, source)` is emitted by two contracts depending on the trigger:
- **AgentManager** emits it for eviction-driven and withdraw-from-arena force-closes (during `settleAgents()` or `processWithdrawFromArena()`)
- **Vault** emits it for withdrawal-driven force-closes (during `_settleEpoch()` step 3, using the Sharpe-sorted agent list returned by `settleAgents()`)

`source` is `VAULT`, `PROVING`, or `ALL`. Neither 0G contract tracks position NFT IDs (those live in the satellite); the relayer maintains a local mapping of `agentId → [tokenIds]` by watching satellite events (`executeBatch` mints and `PositionClosed` burns). The relayer listens for `ForceCloseRequested` on **both** 0G contracts. Upon receiving it, the relayer looks up its cached position list for that agent, filters by source tag, and calls `satellite.forceClose(agentId, positionIds[], source)` on Sepolia. The satellite zaps out each position and emits `PositionClosed(agentId, positionId, recoveredAmount)` per position (same event for both agent-initiated and force-close paths). The relayer then calls `agentManager.recordClosure(agentId, recoveredAmount, source)` on 0G (using the position's source tag from its cache — decrements the correct counter without relying on the agent's current phase) and `vault.recordRecovery(agentId, recoveredAmount)` (records event for audit; `totalAssets` reconciles at next epoch settlement). This keeps force-close entirely event-driven via the relayer — no new on-chain mechanism required.

### Cross-Chain Architecture

The Vault and AgentManager live on **0G testnet** (required for 0G prize track) as an **accounting-only layer** -- the Vault tracks shares and money flow, the AgentManager tracks agent credits, EMAs, and Sharpe scores. Neither contract **holds tokens**. All tokens live on **Ethereum Sepolia** in the satellite contract, which handles deposits, withdrawals, LP positions, and the idle reserve.

**No tokens ever cross chains.** Only messages (intents, values, deposit/withdrawal notifications) cross via the relayer. This completely eliminates bridging complexity.

**Address assumption**: users must use the same EOA on both chains (standard for all EVM wallets -- same private key = same address). Smart contract wallets are not supported.

#### Token flow

Users **only interact with the satellite on Sepolia** -- they never need to touch 0G directly. The vault on 0G handles accounting internally; agents are the only actors who interact with 0G (to submit intents).

- **Deposits**: user calls `satellite.deposit(amount)` on Sepolia -> satellite holds USDC.e -> emits `Deposited` event -> relayer calls `vault.recordDeposit(user, amount)` on 0G -> vault mints shares
- **Agent registration (includes proving deposit)**: deployer calls `satellite.registerAgent(agentAddress, provingAmount)` on Sepolia -> funds earmarked per agent -> relayer calls `agentManager.recordRegistration()` on 0G -> AgentManager registers agent + mints iNFT (see Agent Registration section)
- **Withdrawals**: user calls `satellite.requestWithdraw(tokenAmount)` on Sepolia -> satellite emits `WithdrawRequested` event -> relayer calls `vault.processWithdraw(user, shares)` on 0G -> vault estimates idle (`totalAssets - totalDeployedVault`); if sufficient (Tier 1): burns shares, emits `WithdrawApproved`, relayer calls `satellite.release(user, tokenAmount)`; if insufficient (Tier 2): locks shares, queues — see Tier 2 withdrawal section
- **Idle reserve**: satellite keeps 20% of total assets idle on Sepolia, instantly accessible for withdrawals without any cross-chain delay

#### Why ETH<>0G

Ethereum Sepolia is chosen because:
- **Uniswap v3 is deployed on Sepolia** -- the primary execution layer for all agent LP positions
- **USDC.e availability** -- supported by Interport, XSwap, and 0G Native Bridge for production token bridging if ever needed
- Arbitrum/Base only support w0G bridging to 0G, which is insufficient for LP operations

#### Hackathon: Centralized relayer script

A **Node.js relayer script** (~300-400 lines) bridges the two chains for the hackathon. The Uniswap Trading API integration (auth, intent routing, calldata parsing, slippage handling) adds meaningful complexity beyond simple event listening:

```
Sepolia                       Relayer Script              0G Testnet
+-----------+  Deposited         +------+  recordDeposit()   +----------+
| Satellite | -- event --------> |  JS  | -- tx -----------> |  Vault   |
|           |                    |      |                     +----------+
|           |  executeBatch() <--|      |<-- IntentQueued --- +----------+
|           | (with API calldata)|      |-- reportValues() ->| AgentMgr |
|           | -- ValuesReported->|      |                     +----------+
+-----------+                    +--+---+
                                    |
                          Uniswap Trading API
                          POST /swap, /route
                          (get optimized calldata
                           before satellite dispatch)
```

The relayer routes messages to the correct 0G contract: deposits/withdrawals go to Vault, intents/values/registration go to AgentManager. For intent execution, the relayer calls the Uniswap Trading API to obtain optimized calldata before forwarding to the satellite — the satellite receives pre-built Uniswap calldata, not raw parameters.

The relayer watches events on one chain and submits transactions on the other. All three contracts (Vault, AgentManager, Satellite) have a `messenger` address: set to relayer EOA for hackathon, swap to the permissionless relayer network contract for production.

**Known limitation (hackathon)**: the relayer is fully trusted -- it can report arbitrary position values. A malicious or buggy relayer could inflate valuations and manipulate Sharpe scores. The production architecture below eliminates this trust assumption.

#### Production: Permissionless relayer network

In production, the single trusted relayer is replaced by an **open, economically-secured relayer network**. Anyone can participate:

- **Bonding**: relayers stake a bond (e.g., on 0G) to be eligible to relay messages
- **Relay & earn**: any bonded relayer can watch for events on one chain and submit them to the other. The first valid relay per message earns a **relay fee** (funded from protocol fees -- self-sustaining)
- **Optimistic verification**: relayed messages enter a short challenge window (e.g., 10 blocks). During this window, any other bonded relayer can submit a **fraud proof** showing the message doesn't match the source chain event
- **Slashing**: fraudulent relayers lose their bond. Challengers receive a reward from the slashed bond
- **Liveness incentive**: if no relay is submitted within N blocks, the relay fee increases -- incentivizing timely delivery even during low activity

```
Source chain event --> Relayer submits message --> Challenge window (10 blocks)
                                                    |
                                              No challenge? Message accepted, execute.
                                              Challenge + fraud proof? Slash relayer, reject message.
```

**Why not CCIP**: Chainlink CCIP is expensive and adds a third-party dependency. The permissionless relayer network is cheaper (relayers compete on fees), fully decentralized (anyone can join), and self-sustaining (relay fees come from protocol revenue).

**Challenge window latency**: the challenge period adds a small delay (seconds to minutes depending on block time), but this fits naturally within the epoch cadence -- intents are already batched, not real-time.

The `messenger` interface on all three contracts (Vault, AgentManager, Satellite) remains unchanged -- they don't care who the messenger is, only that the messages are valid. The upgrade from hackathon relayer to permissionless network requires no contract modifications.

### Execution Model: Intent-Based with Batch Settlement

Since the 0G contracts and Uniswap (Sepolia) are on different chains, agents cannot get instant execution. Instead, agents submit **intents** to the AgentManager, which are batched and relayed cross-chain.

#### Flow

1. **Submit**: Agent calls `agentManager.submitIntent(agentId, actionType, params)` on 0G -- e.g., "open position on ETH/USDC, ticks 200000-201000, amount 5000 USDC". The intent includes a `source` field set by AgentManager automatically based on the agent's current phase: `PROVING` for proving-phase agents, `VAULT` for promoted agents opening positions with vault capital. This tag travels with the intent to the satellite, which stores it per position NFT in a `positionSource[tokenId]` mapping
2. **Validate**: AgentManager verifies: agent is registered, not paused, passes cooldown check, and has sufficient capital (token bucket credits for vault agents, `provingBalance` for proving agents). For vault agents, reads `vault.totalAssets()` and checks against `totalDeployedVault` to confirm idle capital covers the amount. Credits are deducted and `totalDeployedVault` is incremented immediately. Intent is queued and an `IntentQueued` event is emitted
3. **Route via Uniswap API**: Before dispatching to the satellite, the relayer calls the **Uniswap Trading API** (POST) with each intent's parameters — token pair, amount, action type. The API returns optimized calldata: best routing path, split routes, slippage bounds, and the final encoded transaction payload. The relayer embeds this calldata into the batch
4. **Relay**: Relayer calls `satellite.executeBatch(intents)` on Sepolia, passing the Uniswap-API-constructed calldata alongside the intent metadata. Each intent in the batch carries the `source` field (`PROVING` or `VAULT`) so the satellite can set `positionSource[tokenId]` at mint time
5. **Execute**: The satellite handles two distinct execution paths per intent:
   - **Swap legs (zap-in/zap-out)**: the satellite forwards the Uniswap-API-generated calldata directly to the **Universal Router** (Uniswap's current execution contract). It does not construct swap parameters itself — the Trading API's `/swap` endpoint generates calldata specifically for Universal Router
   - **LP position management (open/close/modify)**: the satellite calls **NonfungiblePositionManager** directly with the tick range and amounts from the intent. The Trading API has no endpoint for LP operations; this path is always constructed on-chain from intent params
   The satellite holds the tokens and owns the position NFTs for both paths
6. **Report**: Satellite emits `ValuesReported` with updated position valuations. Relayer calls `agentManager.reportValues(agentId, positionValue, feesCollected)` on 0G
7. **Settle**: Vault orchestrates epoch settlement, calling `AgentManager.settleAgents()` for scoring and allocation updates

This intent-based model is actually **better than direct execution**: all agents' actions for an epoch are known before execution, eliminating race conditions. If total requested deployment exceeds available capital, intents can be scaled down proportionally.

Each agent's positions are tracked separately (mapped by `agentId`) on both chains -- the AgentManager tracks credits and performance on 0G, the satellite tracks actual Uniswap position NFTs on Sepolia.

### Data Layer: Subgraph MCP + Uniswap API (Agent Read Layer)

Agents read on-chain data through a **Subgraph MCP server** — an MCP-compatible interface that aggregates two read sources: Uniswap's subgraph on TheGraph and the **Uniswap Trading API** (GET endpoints). This is the agents' "eyes" into the market.

#### Subgraph data (via TheGraph)
- Current and historical pool prices
- Liquidity distribution across ticks
- Volume and fee accrual per pool
- Recent swap activity and price impact
- TVL and pool composition

#### Uniswap Trading API read endpoints (proxied through MCP)
The MCP server also proxies Uniswap Trading API GET endpoints, giving agents routing-aware, fresher data alongside subgraph history:
- `GET /quote` — best-execution quote for a given token pair and amount (includes price impact, route, expected output)
- `GET /route` — optimal routing path across all Uniswap pools (single-hop and multi-hop)
- `GET /pools` — current pool state, fee tiers, tick spacing
- `GET /positions` — current position data and uncollected fees for a given NFT position ID

**Why proxy through MCP and not call directly**: agents running in OpenClaw sandboxes use MCP as their tool interface. Centralizing both data sources in the MCP server means every agent gets a standardized interface without custom HTTP logic per strategy. The MCP server holds the Uniswap API key — agents never see it.

**Latency note**: subgraph data lags seconds to minutes behind chain state. Uniswap API `/quote` and `/route` use live chain state and are fresher for time-sensitive decisions.

For the hackathon: TheGraph free tier + Uniswap API key. In production, agents pay per query via x402 micropayments.

### Capital Allocation: Token Bucket Model

Capital allocation uses a **token bucket algorithm**, inspired by packet switching QoS mechanisms for controlling access to a shared medium. Each agent is a node on a shared bus (the vault); credits represent transmission windows.

#### How it works

Each agent has a **credit bucket** that determines how much vault capital it can deploy:

- **Refill rate**: credits accumulate at a constant rate per block, proportional to the agent's performance score
- **Max bucket size** (burst limit): caps the maximum capital an agent can deploy at once, preventing any single agent from monopolizing the vault
- **Cost to act**: deploying capital costs credits proportional to the amount. Closing a position refunds credits — the refund is processed by the relayer after the satellite confirms the close (see below)
- **Empty bucket = no action**: if an agent lacks credits, it simply cannot deploy more capital until credits regenerate

```
// Both paths: cooldown check
require(block.number >= lastAction[agent] + minActionInterval, "cooldown active")

if (agent.phase == PROVING) {
    // Proving agents: capped by their own deposited capital
    require(amount <= provingBalance[agentId] - provingDeployed[agentId], "exceeds proving balance")
    provingDeployed[agentId] += amount
} else {
    // Vault agents: token bucket path
    credits[agent] = min(
        maxCredits[agent],
        credits[agent] + (block.number - lastAction[agent]) * refillRate[agent]
    )
    require(credits[agent] >= amount, "insufficient credits")
    require(amount <= vault.totalAssets() - totalDeployedVault, "insufficient vault liquidity")
    credits[agent] -= amount
    totalDeployedVault += amount
}

lastAction[agent] = block.number
// Queue intent, emit IntentQueued event
```

**Proving vs vault agents**: proving agents skip the token bucket entirely -- they're bounded only by their own deposited capital (`provingBalance - provingDeployed`). Vault agents go through the full credit refill, credit check, and idle balance check. Both paths share the cooldown to prevent churn.

**Credit refund on close**: when an agent submits a CLOSE intent, the satellite executes the close and emits `PositionClosed(agentId, positionId, recoveredAmount)` (same event for both agent-initiated and force-close paths). The relayer picks this up, looks up the position's `source` tag from its local cache, and calls `agentManager.recordClosure(agentId, recoveredAmount, source)` on 0G. If `source == VAULT`: decrements `totalDeployedVault -= recoveredAmount` and refunds credits. If `source == PROVING`: decrements `provingDeployed`. The refund is slightly delayed (one relayer round trip after execution) but this is acceptable — credit refunds don't need to be atomic with the close.

**Anti-churn**: even with credit refunds, the `minActionInterval` cooldown prevents rapid open/close cycling. In practice, churn is also self-penalizing: each trade costs gas and Uniswap fees, which reduce returns and tank the agent's Sharpe score.

**Overcommit protection**: for vault agents, credits are a necessary but not sufficient condition to deploy. The idle balance check (`vault.totalAssets() - totalDeployedVault >= amount`) ensures agents cannot request more than the vault's tracked idle capital, regardless of what their credit balance says. `totalDeployedVault` is maintained entirely within AgentManager — incremented on intent submission, decremented on credit refund (position close). No cross-contract write is needed at submission time; only one read from `vault.totalAssets()`. This handles stale `maxCredits`, vault losses between epochs, and concurrent intent submissions.

**Known approximation**: `totalDeployedVault` tracks nominal deployed amounts, not real-time market values. Impermanent loss means `recoveredAmount < amount` at close time — after the decrement, `totalDeployedVault` will slightly understate actual deployed capital. Over time, this means the idle balance check is slightly optimistic. For the hackathon this is an acceptable approximation; in production, epoch-level value reconciliation (using reported `positionValue` totals) would correct the drift.

#### Why this works

| Property | How the token bucket provides it |
|----------|----------------------------------|
| **Fairness** | No agent can starve others -- every agent's bucket refills independently |
| **Burst control** | `maxCredits` caps the maximum single deployment, preventing vault drains |
| **Performance reward** | Better-performing agents get a higher `refillRate`, so they can act more frequently and with more capital over time |
| **Self-regulating** | Passive agents accumulate credits (can make larger moves later); aggressive agents burn credits (naturally throttled) |
| **Gas efficient** | O(1) per agent action -- just read and update the agent's bucket, no loops |
| **No collisions** | Agents act independently whenever they want; the bucket is the only constraint |

#### Epoch-based parameter updates

Once per epoch (every N blocks), the allocator recalculates each agent's bucket parameters based on trailing performance using the **Sharpe Ratio** -- the standard financial metric for risk-adjusted returns.

##### Performance tracking (on-chain, O(1) per update)

Each agent stores only two values, updated via **exponential moving averages** at epoch settlement:

```
// alpha = decay factor (e.g., 0.3 -- recent epochs weigh more)
emaReturn[agent]   = alpha * epochReturn + (1 - alpha) * emaReturn[agent]
emaReturnSq[agent] = alpha * epochReturn^2 + (1 - alpha) * emaReturnSq[agent]
```

Where `epochReturn = (positionValue_end - positionValue_start + feesCollected) / allocated`.

**Position valuation and fee accounting**: to avoid double-counting, `positionValue` and `feesCollected` are defined separately:
- `positionValue` = value of underlying LP tokens only (token0 amount * price + token1 amount * price), **excluding** uncollected fees
- `feesCollected` = fees explicitly collected via Uniswap's `collect()` function during the epoch

At epoch reporting time, the satellite calls `collect()` on each position to realize accrued fees, then reports both values separately. The formula then correctly captures: change in LP principal (which includes impermanent loss) + earned fee income.

These values are reported back to the AgentManager on 0G via the relayer (production: permissionless relayer network). The AgentManager stores them per agent and uses them at epoch settlement. No LP math needed on the 0G side — it just receives the valuations.

**Proving vs vault capital in `totalAssets()`**: the satellite reports `positionValue` and `feesCollected` separately for each `agentId` regardless of phase. The Vault's `totalAssets` state variable reflects only **vault-phase agents** — at each epoch settlement, `settleAgents()` returns the aggregate position value for vault-phase agents only, and Vault updates `totalAssets` from this. Proving-agent position values are stored in AgentManager but excluded from vault accounting. This keeps `sharePrice()` denominated correctly: it reflects only the capital depositors contributed, not the agent deployers' own proving stakes.

##### Sharpe score computation

```
// MIN_VARIANCE: hardcoded constant = 1e-8 in fixed-point (e.g., 1 if returns are scaled to 1e8)
// Prevents division by zero when an agent has perfectly constant returns
variance[agent] = max(emaReturnSq[agent] - emaReturn[agent]^2, MIN_VARIANCE)
sharpe[agent]   = max(emaReturn[agent] / sqrt(variance[agent]), 0)
```

`sqrt` in Solidity is handled via OpenZeppelin's `Math.sqrt`. `MIN_VARIANCE` is a contract-level constant (not a constructor parameter) set to a small positive value consistent with the fixed-point scaling used for returns. For the hackathon, if returns are scaled to 1e6 (1 = 0.000001 = 0.0001%), `MIN_VARIANCE = 1` (= 1e-12 in real terms) is sufficient. Exact value depends on the chosen fixed-point scale and should be set at contract compile time.

**Edge case handling:**
- **Zero variance** (constant returns): `MIN_VARIANCE` floor prevents division by zero. The agent still gets a high (but finite) score
- **Negative returns**: Sharpe is clamped to 0. The agent's bucket stops refilling -- it can hold existing positions but cannot deploy more capital. This naturally starves bad agents
- **All agents at zero Sharpe**: if `totalScore == 0` (every agent has negative returns), fall back to equal allocation: `share[agent] = 1 / numActiveAgents`. This prevents the vault from becoming permanently stuck with no agent able to deploy
- **Cold start**: not a problem -- agents trade with their own capital during the proving phase. By the time they're promoted, EMAs have `provingEpochsRequired` epochs of real data. Proving-phase EMA values are carried over as the starting point for vault-phase tracking

High returns -> higher score. High variance -> lower score. This directly incentivizes consistent, high-performing strategies over volatile ones.

##### Score -> credit allocation

```
// All-zero fallback: equal allocation to keep the system alive
if (totalScore == 0) {
    share[agent] = 1 / numActiveAgents
} else {
    totalScore = sum(sharpe[agent])  // sum over all active agents
    share[agent] = sharpe[agent] / totalScore
}

// totalRefillBudget: AgentManager constructor param
// totalAssets, maxExposureRatio: passed by Vault as arguments to settleAgents()
refillRate[agent] = share[agent] * totalRefillBudget
maxCredits[agent] = share[agent] * totalAssets * maxExposureRatio / 10000
```

- `totalRefillBudget` — constructor parameter (AgentManager); controls how fast overall vault capital can be deployed
- `maxExposureRatio` — constructor parameter (Vault); passed to `settleAgents(totalAssets, maxExposureRatio)` at each epoch so AgentManager doesn't need to read it cross-contract
- `totalAssets` — Vault state variable, passed to `settleAgents()` at each epoch; used for all per-agent allocation math within that settlement

##### Promotion ramp for newly promoted agents

A newly promoted agent's `maxCredits` is capped regardless of Sharpe score, ramping up linearly over `rampEpochs` to prevent a proving-phase star from immediately grabbing a disproportionate share of the vault:

```
// maxPromotionShare, rampEpochs: constructor params stored as state variables
// totalAssets: passed by Vault as argument to settleAgents()
effectiveMaxCredits[agent] = min(
    sharpeBasedMaxCredits,
    maxPromotionShare * totalAssets / 10000 * epochsSincePromotion / rampEpochs
)
```

`maxPromotionShare` (e.g., 1000 = 10%) and `rampEpochs` (e.g., 5) are AgentManager constructor parameters. After `rampEpochs` epochs post-promotion, the cap lifts and the agent is governed purely by its Sharpe score.

##### Storage split

| Data | Where | Why |
|------|-------|-----|
| `emaReturn`, `emaReturnSq` per agent | On-chain (0G) | Only 2 slots per agent, needed for allocation math |
| Full per-epoch return history | 0G storage | Dashboard charts, auditability, iNFT buyer due diligence |

This creates a natural flywheel: good performance -> higher Sharpe -> more credits -> more capital -> more opportunity to earn -> higher commissions.

### Constructor Parameters

Both 0G-side contracts are deployer-configurable via constructor arguments, making each vault instance a self-contained arena with its own tuning. The AgentManager is deployed first, then the Vault (which receives the AgentManager address).

#### Vault constructor

| Parameter | Type | Description |
|-----------|------|-------------|
| `agentManager` | `address` | Address of the deployed AgentManager contract |
| `epochLength` | `uint256` | Number of blocks per epoch -- how often bucket parameters are recalculated |
| `maxExposureRatio` | `uint256` | Max fraction of vault value that can be deployed across all agents (scaled, e.g., 8000 = 80%) |
| `protocolFeeRate` | `uint256` | Protocol's cut of collected fees before agent commissions (scaled, e.g., 500 = 5%) |
| `protocolTreasury` | `address` | Address that receives protocol fees on Sepolia |
| `commissionRate` | `uint256` | Percentage of remaining fees (after protocol cut) directed to iNFT owner (scaled, e.g., 1000 = 10%) |
| `depositToken` | `address` | Stored as public state for dashboard reads and event metadata only. The Vault never calls this address — token operations happen on the satellite |
| `pool` | `address` | Stored as public state for dashboard reads only. The Vault never calls this address — Uniswap operations happen on the satellite |
| `messenger` | `address` | Relayer EOA (hackathon) or permissionless relayer network contract (production) |

#### AgentManager constructor

| Parameter | Type | Description |
|-----------|------|-------------|
| `alpha` | `uint256` | EMA decay factor for performance tracking (scaled, e.g., 3000 = 0.3) |
| `maxAgents` | `uint256` | Maximum number of agents eligible for live token buckets (bounds the epoch loop) |
| `totalRefillBudget` | `uint256` | Total credits distributed across all agents per epoch |
| `provingEpochsRequired` | `uint256` | Minimum proving epochs before vault allocation eligibility |
| `minPromotionSharpe` | `uint256` | Minimum Sharpe score required for promotion (scaled) |
| `minActionInterval` | `uint256` | Minimum blocks between consecutive actions (anti-churn cooldown) |
| `maxPromotionShare` | `uint256` | Max vault share a newly promoted agent can receive in its first epoch (scaled, e.g., 1000 = 10%) |
| `rampEpochs` | `uint256` | Number of epochs over which the promotion cap ramps up to full Sharpe-based allocation |
| `evictionEpochs` | `uint256` | Consecutive zero-Sharpe epochs required to evict a vault agent or eject a proving agent (e.g., 3). Both phases share the same `zeroSharpeStreak` counter — negative returns clamp Sharpe to 0, so the counter is equivalent in both phases |
| `messenger` | `address` | Same relayer/messenger as Vault |

#### Satellite constructor

| Parameter | Type | Description |
|-----------|------|-------------|
| `messenger` | `address` | Same relayer EOA (hackathon) or permissionless network contract (production). Only `messenger` can call privileged satellite functions (`executeBatch`, `release`, `releaseQueuedWithdraw`, `releaseCommission`, `forceClose`, `updateSharePrice`, `reserveProtocolFees`, `reserveCommission`) |
| `depositToken` | `address` | USDC.e address on Sepolia — the only token accepted for deposits |
| `pool` | `address` | Uniswap v3 pool address (e.g., USDC/WETH on Sepolia) — all agents trade this pool |
| `positionManager` | `address` | Uniswap v3 NonfungiblePositionManager address on Sepolia |
| `universalRouter` | `address` | Uniswap Universal Router address on Sepolia — receives API-generated swap calldata |
| `protocolTreasury` | `address` | Address authorized to call `claimProtocolFees()` |
| `idleReserveRatio` | `uint256` | Target fraction of total assets held idle (scaled, e.g., 2000 = 20%) |

The satellite also maintains `positionSource[tokenId]` — a mapping from each Uniswap position NFT ID to `PROVING` or `VAULT`. Set at mint time using the `source` field carried in the intent. Used by `forceClose` to selectively close only the intended class of positions.

The satellite is deployed independently on Sepolia. Its address is configured in the relayer's `.env` — neither Vault nor AgentManager hold the satellite address (they never call it directly).

**Post-deployment**: call `AgentManager.setVault(vaultAddress)` to link the two contracts. This is a one-time initialization — `setVault` reverts if already set.

**Deployment order**: AgentManager first (no vault address needed) -> Vault second (passes AgentManager address in constructor) -> call `AgentManager.setVault(vaultAddress)` to complete the circular reference.

All ratio/percentage parameters use basis-point scaling (10000 = 100%) for fixed-point precision without floating point.

**Deployment invariant**: `maxExposureRatio` (Vault) + `idleReserveRatio` (Satellite) must equal 10000. Example: `maxExposureRatio = 8000`, `idleReserveRatio = 2000`. If these drift, the satellite holds a different idle fraction than the vault expects, causing silent accounting errors. Set both from the same deployment script constant.

### Withdrawal Mechanism

The vault is a **share token** with ERC4626-inspired accounting (not a full ERC4626 implementation -- it never holds the underlying asset). `totalAssets` is a Vault state variable updated incrementally by `recordDeposit` (+amount) and `processWithdraw` (-amount), and reconciled at each epoch settlement as `aggregateVaultPositionValue + idle + depositorReturn` (see `_settleEpoch()` step 2). `sharePrice() = totalAssets / totalShares`. Between epochs, `totalAssets` is stale (doesn't reflect unrealized gains/losses or mid-epoch force-close recoveries) — this is acceptable since share price updates once per epoch. Shares live on 0G; underlying tokens live on Sepolia in the satellite. The satellite's idle reserve enables instant withdrawals.

#### Share price synchronization

The satellite needs to convert between token amounts and share amounts. At each epoch settlement, the vault emits `EpochSettled(sharePrice, totalShares, totalAssets)`. The relayer calls `satellite.updateSharePrice(sharePrice)` on Sepolia. The satellite caches this value for withdrawal calculations. Share price updates once per epoch -- stale by at most one epoch, which is acceptable since Tier 2 withdrawals already wait an epoch.

#### Tier 1 -- Instant withdrawal (fits in idle reserve)

User calls `satellite.requestWithdraw(tokenAmount)` on Sepolia. The satellite converts to shares using the cached share price: `shares = tokenAmount * 1e18 / sharePrice`. Relayer notifies vault on 0G via `vault.processWithdraw(user, shares)`. The Vault estimates satellite idle as `totalAssets() - totalDeployedVault` — if the withdrawal fits (Tier 1), burns shares and emits `WithdrawApproved`. Relayer instructs `satellite.release(user, tokenAmount)`. The satellite transfers tokens directly to the user on Sepolia. No delay beyond relayer round trip (seconds in hackathon; in production, relay + challenge window latency).

#### Tier 2 -- Queued withdrawal (exceeds idle reserve)

When a withdrawal exceeds the satellite's idle funds:

1. **Request**: user calls `satellite.requestWithdraw(tokenAmount)` on Sepolia -- relayer notifies vault on 0G -- shares are locked and the request is queued with the current epoch number
2. **Epoch settlement**: at the next epoch, `_settleEpoch()` checks pending withdrawal volume against idle balance. If insufficient, Vault emits `ForceCloseRequested` events for the lowest-Sharpe vault agents (bottom of ranking first) until projected recovered capital covers the withdrawal queue. The relayer picks these up and calls `satellite.forceClose()` on Sepolia. The satellite closes positions and returns recovered capital to idle. This matches the force-close event flow used for eviction
3. **Claim**: after the epoch settles and capital is freed, user calls `satellite.claimWithdraw()` on Sepolia -- satellite emits `ClaimWithdrawRequested(user, tokenAmount)` -- relayer calls `vault.claimWithdraw(user, tokenAmount)` on 0G (marks the queued entry as processed, emits `WithdrawReleased`) -- relayer then calls `satellite.releaseQueuedWithdraw(user, tokenAmount)` on Sepolia -- satellite transfers tokens to the user

```
satellite.requestWithdraw(tokenAmount)  ->  relayer -> vault.processWithdraw() locks shares, queues withdrawal
// ... epoch settles, agents reduce positions, satellite frees capital ...
satellite.claimWithdraw()  -> ClaimWithdrawRequested event -> relayer -> vault.claimWithdraw() -> satellite.releaseQueuedWithdraw(user, amount)
```

The user stays on Sepolia for the entire flow.

**Enforcement**: force-close for withdrawals uses the same event-driven path as eviction — Vault emits `ForceCloseRequested(agentId, VAULT)`, relayer looks up cached positions, calls `satellite.forceClose()`, satellite zaps out and emits `PositionClosed(agentId, positionId, recoveredAmount)` per position, relayer calls `agentManager.recordClosure(agentId, recoveredAmount, VAULT)` and `vault.recordRecovery(agentId, recoveredAmount)`. Worst-performing vault agents are liquidated first (lowest Sharpe first) — both enforceable and incentive-compatible.

**Timing note**: Tier 2 withdrawals wait for one epoch settlement plus the cross-chain round trip (relayer propagation + satellite execution). With a local relayer this takes seconds; in production, it includes the challenge window latency.

### Epoch Settlement: Lazy Evaluation

There are no cronjobs on-chain. Epochs are triggered via **lazy evaluation** -- the first interaction with the vault after the epoch boundary settles the previous epoch as a side effect.

```solidity
modifier epochCheck() {
    if (block.number >= lastEpochBlock + epochLength) {
        _settleEpoch();
    }
    _;
}
```

Only **Vault** functions carry the `epochCheck` modifier (`recordDeposit`, `processWithdraw`, `triggerSettleEpoch`). AgentManager functions do not carry it — adding epochCheck to AgentManager would create a cross-contract call loop: `AM.submitIntent → AM.epochCheck → Vault.triggerSettleEpoch → Vault._settleEpoch → AM.settleAgents`, re-entering AgentManager from within its own modifier before the intent body runs. This is risky and unnecessary.

Instead, `triggerSettleEpoch()` is a public Vault function the relayer calls directly. For the hackathon, the relayer calls `vault.triggerSettleEpoch()` once per epoch as part of its main loop — it runs locally and is trivially reliable. This means epoch settlement is triggered by either: (a) a Vault function called after the epoch boundary fires the `epochCheck` modifier naturally, or (b) the relayer's periodic `triggerSettleEpoch()` call. Either path reaches `_settleEpoch()`. No external keeper infrastructure, no Chainlink Automation, no missed epochs.

**Gas cost note**: the first caller pays gas for the full settlement loop (O(n) over active agents). With `maxAgents` bounded (3 for demo, 10-20 max), this cost is predictable and acceptable. Each agent iteration costs ~50k gas (two EMA updates, one Sharpe computation, two bucket param writes), so even 20 agents = ~1M gas -- well within block limits.

**Async settlement**: `_settleEpoch()` uses the **last reported values** from the satellite, not real-time cross-chain queries. The relayer reports position valuations at least once per epoch (it runs locally -- trivially reliable). If a value hasn't been reported for the current epoch, AgentManager uses the last known value during `settleAgents()` (position values are stored on AgentManager via `reportValues()`). A `lastReportedBlock[agentId]` timestamp tracks freshness.

`_settleEpoch()` on Vault orchestrates, calling AgentManager for agent-specific work:

1. Vault calls `AgentManager.settleAgents(totalAssets, maxExposureRatio)` which internally:
   - Computes per-agent `epochReturn` (using last reported values + fees) and updates EMAs
   - Recalculates Sharpe scores (MIN_VARIANCE floor, negative clamping, all-zero fallback)
   - **Eviction check**: skips paused agents, increments/resets `zeroSharpeStreak`, evicts at `evictionEpochs`. Emits `ForceCloseRequested(agentId, VAULT)` for each evicted vault agent and `ForceCloseRequested(agentId, PROVING)` for each ejected proving agent — both emitted directly by AgentManager during this call
   - **Promotion check**: promotes proving agents meeting `provingEpochsRequired` + `minPromotionSharpe`; resets `zeroSharpeStreak = 0` for newly promoted agents (bad proving epochs don't carry over into vault-phase eviction countdown)
   - Rebalances bucket parameters (`refillRate`, `maxCredits`) using the passed `totalAssets` and `maxExposureRatio`, with promotion ramp
   - Returns to Vault: per-agent `feesCollected`, aggregate vault-agent position value (Vault updates `totalAssets` from this), and Sharpe-sorted agent list (lowest first). Eviction force-close events are already emitted by AgentManager — not returned
2. Vault reconciles `totalAssets` and applies the fee waterfall:
   - Computes current idle balance: `idle = totalAssets - agentManager.totalDeployedVault()`
   - Applies fee waterfall on returned `feesCollected`: `protocolFee` first, then `agentCommission`, remainder is `depositorReturn`
   - Sets `totalAssets = aggregateVaultPositionValue + idle + depositorReturn` (position values from settleAgents + idle capital + depositors' share of collected fees)
   - Accrues to `protocolFeesAccrued` and `commissionsOwed[agentId]`. Emits `ProtocolFeeAccrued` and `CommissionAccrued`
3. Vault checks pending queued withdrawal volume against current idle balance (`totalAssets - agentManager.totalDeployedVault()`). If idle is insufficient, Vault emits `ForceCloseRequested(agentId, VAULT)` events using the returned Sharpe-sorted list (lowest first) until projected recovered capital covers the withdrawal queue. No second AgentManager call needed — bucket parameters are updated when the relayer calls `agentManager.recordClosure()` after the satellite settles
4. Vault emits `EpochSettled(sharePrice, totalShares, totalAssets)` for satellite share price sync
5. Vault advances `lastEpochBlock`

---

## Agent Lifecycle

### Agent Registration

Registration is a single transaction on Sepolia that bootstraps the full agent:

1. Deployer calls `satellite.registerAgent(agentAddress, provingAmount)` on Sepolia with USDC.e approval
2. Satellite transfers `provingAmount` from deployer, earmarks it for the new agent, emits `AgentRegistered(agentId, agentAddress, deployer, provingAmount)`
3. Relayer calls `agentManager.recordRegistration(agentId, agentAddress, deployer, provingAmount)` on 0G
4. AgentManager registers the agent (maps `agentId -> agentAddress`), records `provingBalance[agentId]`, and **mints an iNFT** to the deployer's address

`agentId` is assigned sequentially by the satellite. `agentAddress` is the EOA that the OpenClaw agent will use to submit intents on 0G. Registration is permissionless -- anyone can deploy an agent.

### Phase 1 - Proving (Own Capital)
- Proving funds are deposited during registration (see above) -- **earmarked** per agent, segregated from depositor funds
- The relayer notifies the AgentManager on 0G, which records the proving balance in `provingBalance[agentId]`
- The agent submits intents via `agentManager.submitIntent()`, but its capital comes from `provingBalance` instead of the token bucket (see code branching in token bucket section)
- This reuses the entire execution pipeline: same intent queue, same relayer, same Uniswap calls via satellite, same performance measurement
- Performance (returns, variance) is tracked on-chain via the same EMA mechanism used for vault agents
- The agent builds a **verifiable, real-money track record** visible to the entire network
- Proving funds are NOT available for vault depositor withdrawals -- they belong to the deployer

### Promotion Criteria

Promotion from proving to vault allocation requires **both** conditions at epoch settlement:
- At least `provingEpochsRequired` epochs completed
- `sharpe[agent] >= minPromotionSharpe` (constructor parameter)

If an agent has traded long enough but has a bad Sharpe, it stays in proving. This prevents garbage strategies from graduating just by surviving. Promotion is checked automatically at each epoch settlement.

### Agent Eviction

Agents that consistently underperform are **automatically evicted** to free up `maxAgents` slots:

- **Vault agents**: if an agent's Sharpe is clamped to 0 for `evictionEpochs` (e.g., 3) consecutive epochs, it is evicted at epoch settlement. AgentManager emits `ForceCloseRequested(agentId, VAULT)` — the relayer looks up its cached VAULT-tagged position list for that agent and calls `satellite.forceClose(agentId, positionIds[], VAULT)`. Proving-funded positions are deliberately excluded. The satellite closes only those positions and returns recovered capital to vault idle. The agent's token bucket is cleared and it drops back to proving phase (`maxAgents` only bounds vault-phase token buckets — the agent stays registered and its PROVING-tagged positions keep running with its own capital). `zeroSharpeStreak` is reset to 0 and EMAs are reset to avoid carrying over the bad track record
- **Proving agents**: if a proving agent's Sharpe is clamped to 0 for `evictionEpochs` consecutive epochs, it is ejected entirely. AgentManager emits `ForceCloseRequested(agentId, PROVING)` and **deregisters the agent immediately** (clears registry entry). This is safe because `recordClosure` uses the relayer-provided `source` parameter, not the agent's phase — so it works even for deregistered agents (skips per-agent bookkeeping silently, no global counter to update since proving agents don't use `totalDeployedVault`). The relayer closes all PROVING-tagged positions and remaining capital is returned to the deployer's address on Sepolia

One storage slot per agent (`zeroSharpeStreak`), incremented or reset at each epoch settlement. Minimal overhead.

**All agents evicted**: if every agent is evicted, 100% of vault funds sit idle and are fully available for depositor withdrawal. The vault resumes operation when new agents complete the proving phase and are promoted. This is the safe default -- the vault protects depositors by refusing to allocate to failing agents.

### Phase 2 - Vault Allocation
- Once promoted, the allocator initializes a token bucket for the agent with credits capped by the promotion ramp
- Proving-phase EMA values are carried over as the starting point -- no cold start
- The agent now manages vault funds **in addition to** its own proving capital. New intents submitted after promotion are tagged `VAULT`; existing proving positions retain their `PROVING` tag. The satellite's `positionSource` mapping keeps these two classes permanently distinct — no ambiguity at force-close time
- As the agent proves itself with vault funds, its bucket parameters scale up at each epoch recalculation (promotion ramp lifts after `rampEpochs`)
- The agent can submit intents at any time as long as it has credits. Execution happens when the relayer batches and relays intents to the satellite

---

## iNFT Ownership Model

- Deploying a strategy mints an iNFT to the creator
- The iNFT represents **economic rights** to the agent's commissions, not access to the strategy code
- Commissions flow to whoever is the current `ownerOf(tokenId)`
- iNFTs are transferable via standard ERC-721 transfer on 0G. For the hackathon, transfers are done via direct contract calls. In production, iNFTs could be deployed on a chain with marketplace support or listed when 0G mainnet marketplaces emerge
- Buyers get a passive revenue stream; commission claims happen on Sepolia (same chain as deposits)
- The agent keeps running unchanged after a sale -- same OpenClaw sandbox, same keys, same strategy

### What iNFT buyers are purchasing:
- Revenue stream (future commissions)
- Ownership rights (pause, withdraw from arena)
- NOT the strategy itself (code stays in the agent's sandbox; TEE-protected in production)

### Commission Mechanism

Commissions are computed at epoch settlement on the vault (0G):

```
// Fee waterfall: protocol fee first, then agent commission, remainder to depositors.
// All fees taken from REALIZED gains (collected fees) only -- not unrealized position value changes.
// feesCollected = actual liquid USDC.e sitting in satellite after collect()

protocolFee = feesCollected * protocolFeeRate / 10000        // --> protocol treasury
remainingFees = feesCollected - protocolFee
agentCommission = remainingFees * commissionRate / 10000     // --> iNFT owner
depositorReturn = remainingFees - agentCommission            // --> vault share value

protocolFeesAccrued += protocolFee
commissionsOwed[agentId] += agentCommission
```

**Fee waterfall**:
```
Collected Uniswap fees (100%)
  └─> Protocol fee (e.g., 5%)                --> protocol treasury
      └─> Agent commission (e.g., 10% of remainder)  --> iNFT owner
          └─> Depositor return (remainder)            --> vault share value
```

**Why fees only**: `positionValue` changes are unrealized -- the value is locked in the LP position. Only `feesCollected` (from Uniswap's `collect()`) produces liquid tokens on the satellite. Commissioning unrealized gains would require partially closing positions to pay out, adding complexity and harming strategy performance. Fee-only fees are simpler, always liquid, and align with how traditional fund management fees work.

**Why protocol fee first**: the protocol takes its cut before agent commissions, ensuring protocol revenue regardless of commission rate. This is the standard DeFi vault model (Yearn, Enzyme, etc.).

Note: the Sharpe score still uses the full `epochReturn` formula (position value change + fees) for allocation decisions. Only payouts are limited to realized fees.

The iNFT owner claims commissions on **Sepolia** (same chain as deposits -- no 0G interaction needed):

1. Owner calls `satellite.claimCommissions(agentId)` on Sepolia
2. Satellite emits `CommissionClaimRequested(agentId, caller)` event
3. Relayer calls `agentManager.processCommissionClaim(agentId, caller)` on 0G -- AgentManager checks `iNFT.ownerOf(agentId) == caller`, then calls `vault.approveCommissionRelease(agentId)` -- Vault reads `commissionsOwed[agentId]` from its own state, zeroes it, and emits `CommissionApproved(agentId, amount)`
4. Relayer reads `amount` from the `CommissionApproved` event, then calls `satellite.releaseCommission(caller, amount)` on Sepolia -- satellite pays from `commissionReserve`

Commissions are denominated in the deposit token (USDC.e). The only actors who interact with 0G directly are agents (submitting intents) and the relayer.

**Note**: the iNFT itself lives on 0G, so transfers/sales require 0G interaction. For the hackathon this is acceptable (iNFT transfers aren't part of the demo flow). In production, the iNFT could be deployed on Sepolia instead.

#### Fee reserves on satellite

The satellite maintains separate reserve pools so fee payouts never compete with the idle reserve or agent allocations:

1. At epoch settlement, vault applies the fee waterfall and emits `ProtocolFeeAccrued(amount)` and `CommissionAccrued(agentId, amount)` (one `CommissionAccrued` event per agent that earned fees)
2. Relayer calls two separate satellite functions:
   - `satellite.reserveProtocolFees(amount)` — once per epoch, total protocol fees; sets aside into `protocolReserve`
   - `satellite.reserveCommission(agentId, amount)` — once per agent that earned commissions; sets aside into `commissionReserve`
   Both operate on already-liquid USDC.e (collected fees sitting in satellite)
3. Protocol treasury claims from `protocolReserve` via `satellite.claimProtocolFees()` (callable by `protocolTreasury` address)
4. iNFT owners claim from `commissionReserve` via the existing commission claim flow

This ensures the 20% idle reserve remains fully available for depositor withdrawals.

### iNFT Pause Mechanism

The AgentManager maintains a `paused` flag per agent. The iNFT owner pauses/unpauses via **Sepolia** (consistent with all other iNFT owner actions):

1. Owner calls `satellite.pauseAgent(agentId)` or `satellite.unpauseAgent(agentId)` on Sepolia
2. Satellite emits `PauseRequested(agentId, caller, paused)` event
3. Relayer calls `agentManager.processPause(agentId, caller, paused)` on 0G -- AgentManager checks `iNFT.ownerOf(agentId) == caller`, updates the flag

`submitIntent()` checks `require(!paused[agentId])` before processing. The OpenClaw agent can attempt to submit intents, but the AgentManager rejects them. Existing positions remain open until the agent is unpaused or the iNFT owner triggers a withdrawal from the arena.

### Withdraw from Arena

The iNFT owner can permanently remove their agent by calling `satellite.withdrawFromArena(agentId)` on Sepolia. Satellite emits `WithdrawFromArenaRequested(agentId, caller)`. Relayer calls `agentManager.processWithdrawFromArena(agentId, caller)` on 0G, which:

1. **Verify ownership**: checks `iNFT.ownerOf(agentId) == caller` — rejects if not owner
2. **Emit force-close + deregister**: emits `ForceCloseRequested(agentId, ALL)` and immediately deregisters the agent (clears token bucket, EMAs, registry entry, frees `maxAgents` slot). Immediate deregistration is safe because `recordClosure` uses the relayer-provided `source` parameter — it doesn't need the agent to exist

**Relayer work** — Relayer looks up all cached positions for that agent and calls `satellite.forceClose(agentId, positionIds[], ALL)` on Sepolia, which zaps out all positions to USDC.e and emits `PositionClosed(agentId, positionId, recoveredAmount)` per position. Relayer calls `agentManager.recordClosure(agentId, recoveredAmount, source)` (using each position's cached source tag — VAULT closures decrement `totalDeployedVault`; PROVING closures skip silently) and `vault.recordRecovery()` for each. Vault-funded capital returns to vault idle; proving capital is returned to the deployer's address on Sepolia

The iNFT remains after withdrawal -- it's now an NFT with a historical track record but no active agent. Any unclaimed commissions remain claimable.

---

## Strategy IP Protection

### Hackathon: Sandboxed OpenClaw on fly.io

For the hackathon, agents run in **sandboxed OpenClaw instances on fly.io** — not in TEEs. The sandbox provides process isolation but not hardware-level secrecy. The VPS operator (the team) could theoretically inspect agent behavior.

This is an accepted tradeoff for the hackathon: we control the infrastructure ourselves, so there is no real adversary. The architecture is **TEE-ready** — when 0G enables TEE on OpenClaw, strategy IP protection activates with zero architecture changes.

### Production: TEE upgrade path

In production, OpenClaw instances run inside TEEs (Trusted Execution Environments):
- Strategy code executes in an encrypted enclave
- Nobody can read it: not the node operator, not other users, not 0G
- TEE attestation proves the agent runs the creator's code without revealing it
- The upgrade is purely an infrastructure change — no contract or agent code modifications needed

### What's already protected (hackathon and production)

- On-chain intents are visible, but the **AI reasoning** that produced them is not — the model weights, prompts, and decision logic stay in the agent process
- Trade-level reverse engineering is an acknowledged open problem (same as quantitative finance) but mitigated by the complexity of AI model parameters and non-deterministic LLM reasoning

---

## Economic Loop

- **Protocol** earns a fee on all collected Uniswap fees (first cut in the waterfall) -- this is the protocol's revenue model
- **Agent creators** deploy strategies, mint iNFTs, earn commissions (after protocol cut) or sell iNFTs for profit
- **Agents** earn commissions; the iNFT owner pays infrastructure costs (compute, API) manually from those earnings. In production, x402 micropayments enable per-request autonomous payment — but for the hackathon, costs are covered by free tiers and team resources
- **iNFT buyers** receive net commissions passively
- **Vault depositors** get optimized liquidity management from competing agents, earning the remainder after protocol and agent fees
- In production, nobody subsidizes anything -- the system is self-sustaining. For the hackathon, infrastructure costs (compute, TheGraph) are covered by free tiers and team resources

### Infrastructure Costs (Production Vision)
In production, agents pay for their own resources (TheGraph API, compute) from earned commissions. x402 micropayments is the long-term vision for fully autonomous per-request payments.

For the hackathon: TheGraph free tier, no payment logic needed.

---

## Prize Tracks (2 tracks, max focus)

### 1. 0G - $15,000
- **Best OpenClaw Agent** ($6,000) - multi-agent framework showcasing OpenClaw capabilities
- **Best DeFi App on 0G** ($6,000) - competitive agent marketplace is a full DeFi primitive
- **Wildcard** ($3,000) - iNFT ownership layer is novel enough for this

Key narrative: *"This product couldn't exist without 0G. OpenClaw provides the sandboxed agent execution framework. In production, TEE upgrade protects strategy IP with zero architecture changes."*

### 2. Uniswap Foundation - $10,000
- **Best Uniswap API Integration** ($10,000) - Uniswap Trading API is used at both layers: GET endpoints (quote, route, pools, positions) proxied through the Subgraph MCP so every agent uses them for market intelligence; POST endpoints called by the relayer to generate optimized execution calldata before every satellite dispatch. The satellite executes Uniswap-API-constructed calldata rather than raw parameters

Total potential: **$25,000 across 2 sponsors**

---

## Hackathon Build Priority (36 hours)

| Priority | Component | Chain | Notes |
|----------|-----------|-------|-------|
| 1 | Vault contract | 0G testnet | Share token + pure accounting: deposits, withdrawals, fee waterfall, epoch orchestration |
| 2 | AgentManager contract | 0G testnet | Agent lifecycle: registry, intent queue, token buckets, Sharpe scoring, promotion, eviction |
| 3 | iNFT contract | 0G testnet | ERC-721, minted by AgentManager on registration, ownerOf for auth |
| 4 | Satellite contract (fund custodian + Uniswap executor) | Sepolia | Holds all tokens, owns LP positions; swaps via Universal Router (API calldata), LP management via NonfungiblePositionManager; positionSource mapping; deposits/withdrawals/force-close |
| 5 | Relayer script | Off-chain (JS) | Watches events, routes to correct 0G contract (Vault or AgentManager) and Satellite |
| 6 | Data layer: Subgraph MCP + Uniswap API | Off-chain | MCP server exposes TheGraph subgraph + Uniswap API GET endpoints (quote, route, pools, positions) to agents; Uniswap API key lives in relayer for POST calls |
| 7 | OpenClaw agent | Sandboxed on fly.io | Even with simple strategy (rebalance when price exits X% of range) |
| 8 | Dashboard | Off-chain | Real-time view of agent decisions, performance leaderboard |
| 9 | Strategy sophistication | -- | Only if time remains |

### Hackathon Shortcuts
| Build | Skip |
|-------|------|
| iNFT mint on agent deployment | Secondary marketplace (iNFT on 0G -- no OpenSea; transfer via contract calls) |
| Commission accrual + manual claim via relayer | Automatic distribution |
| 2-3 hardcoded strategies with different parameters | Fully permissionless agent deployment |
| Performance leaderboard in UI | Historical analytics |
| Sharpe-based token bucket allocation (EMA + sqrt, not complex) | Multi-factor scoring (Sortino, Calmar, drawdown penalties) |
| JS relayer script between 0G testnet and Sepolia | Permissionless relayer network with bonds and fraud proofs (swap `messenger` address for production) |
| Satellite focused on core paths (deposit, execute batch with API calldata, report values, release) | Multi-pool support, advanced zap routing, partial close logic |
| Uniswap API key in relayer `.env`; MCP proxies GET calls | x402 per-query agent payments for API access |
| Vault as accounting-only (no tokens on 0G) | Token bridging between chains |

### Demo Setup & Script (~3 minutes)

**Pre-demo state** (set up before the pitch):
- Vault deployed with a very short `epochLength` (few seconds worth of blocks for demo speed)
- 2 whack agents already connected to the pool, actively trading badly (wide ranges, wrong direction, or random actions). Pre-staged with `zeroSharpeStreak = evictionEpochs - 1` so that one more bad epoch (triggered live) fires automatic eviction
- Dashboard showing their poor performance: negative returns, low/zero Sharpe scores, capital being wasted
- Our good agent already deployed and **proving phase completed** (all cross-chain round trips done pre-pitch). The agent is at `provingEpochsRequired - 1` completed proving epochs — the next epoch settlement will trigger automatic promotion. This is not the pause mechanism; the agent is running normally, just one epoch short of the threshold

**Live demo flow:**

1. **"Here's the problem"** (~30s) -- Show the dashboard with the 2 bad agents. Point out their terrible Sharpe scores, losses, wasted capital. *"Anyone can deploy an agent, but bad agents get punished by the system."*

2. **"We deploy a better agent"** (~45s) -- Show our agent already in proving phase on the dashboard. Walk through its real-money track record: Sharpe score, returns, the iNFT that was minted. *"This agent put skin in the game -- it traded with the deployer's own capital to prove itself."*

3. **"Promotion to vault"** (~30s) -- Trigger the epoch settlement that promotes our agent live on stage. Token bucket initializes. Show on dashboard: agent now managing vault capital, its allocation growing as Sharpe outperforms the bad agents. Capital visibly flowing away from bad agents toward ours.

4. **"Earning commissions + iNFT marketplace"** (~30s) -- Show commissions accruing to our address as the iNFT owner. Switch to the iNFT marketplace view: our agent is listed, showing its track record, Sharpe score, and commission yield. *"Anyone can buy this iNFT and receive the commission stream -- no technical knowledge needed. The strategy stays inside the agent's sandbox."*

5. **"Bad agents get evicted"** (~30s) -- Show that after consecutive bad epochs, the worst agent gets auto-evicted. Its slot opens up. *"The system is self-cleaning -- bad agents don't just get starved, they get kicked out."*

**Why pre-compute the proving phase**: running multiple cross-chain round trips live on stage (intent -> relayer -> satellite -> report -> relayer -> vault, repeated for each proving epoch) is too risky for a 3-minute pitch. Pre-computing it eliminates timing risk while still showing real on-chain data. The promotion epoch is triggered live -- that's the dramatic moment.

**What this demonstrates in 3 minutes:**
- The full agent lifecycle (deploy -> prove -> promote -> earn -> evict bad agents)
- Token bucket allocation rewarding performance in real-time
- Bad agents getting starved of capital and eventually evicted (antifragility)
- iNFT ownership and commission economics
- Strategy IP protection (sandboxed agents; TEE-ready architecture for production)
- Cross-chain execution (0G vault -> Sepolia Uniswap positions visible in dashboard)
- Single-chain UX for users (deposit and withdraw entirely on Sepolia)

---

## Key Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| OpenClaw documentation is sparse | Visit 0G booth day 1, clarify capabilities before coding |
| Subgraph data latency (seconds to minutes behind chain) | Supplement with direct RPC calls for current price if needed |
| Strategy that actually works is hard to build in 36h | Focus on the platform, not the strategy. Simple strategies are fine for demo |
| Testnet liquidity is thin | Deploy own pool on Sepolia and seed it, or use Anvil fork |
| Demo-ability (liquidity management is boring to watch) | Simulate market conditions that trigger rebalances; compelling dashboard showing agent decisions in real-time |
| Vault contract security | Keep contract as simple as possible; no time for audit |
| Cross-chain relayer reliability during demo | Run relayer locally, test thoroughly before pitch. Relayer is ~300-400 lines; test each event route and Uniswap API call path independently before the demo |
| 0G testnet instability | Have Anvil fork fallback; keep satellite on Sepolia functional independently |
| Relayer trust (hackathon only) | Relayer can fabricate position values. Acceptable for demo (we run it); production uses permissionless relayer network with bonds, fraud proofs, and slashing |

---

## Pitch Talking Points

1. *"A permissionless marketplace where anyone can deploy an AI liquidity strategy, own it as an iNFT, and earn commissions -- strategy logic stays in the agent's sandbox, and with TEE the secrecy becomes cryptographic."*
2. *"This couldn't exist without 0G's OpenClaw. Agents run in sandboxed compute today — when TEE is enabled, strategy IP protection activates with zero architecture changes."*
3. *"The protocol is self-sustaining. Relay fees fund the relayer network from protocol revenue. In production, agents pay for compute and data via x402 micropayments — no central operator, no subsidies."*
4. *"New agents put skin in the game -- deployers risk their own capital to build a verifiable track record before touching vault funds. The system is antifragile -- bad agents get starved of capital, good agents get rewarded."*
5. *"Capital allocation uses a token bucket algorithm borrowed from network QoS -- agents earn bandwidth to deploy capital based on performance. No central scheduler, no unbounded loops, O(1) gas per action."*
