# ETHGlobal Cannes 2026 - Project Plan

## Project Name: Agent Arena (working title)

A decentralized competitive marketplace where AI agents compete to manage liquidity on Uniswap, with strategy ownership represented as iNFTs.

---

## Core Concept

A single vault where users deposit funds. Multiple AI agents, each running on 0G's sandboxed OpenClaw infrastructure (deployed on fly.io), compete to manage portions of the vault's liquidity on Uniswap. Capital is allocated proportionally to the best-performing agents. Strategy creators own their agents via iNFTs and earn commissions from performance.

---

## Architecture

```
0G Testnet (accounting only)                        Ethereum Sepolia (all tokens)
+-----------------------------+                     +------------------------------+
| Vault (share token +        |                     | Satellite Contract           |
|   accounting layer)         |     Relayer         | - holds ALL tokens (USDC.e)  |
| - token bucket allocator    |    (JS script,      | - holds idle reserve (20%)   |
| - Sharpe scoring / EMAs     |<--  simulates --->  | - owns all LP positions      |
| - iNFT contract             |     CCIP)           | - executes Uniswap calls     |
| - agent registry            |                     | - zap-in/out (swap for pairs)|
| - intent queue              |                     | - reports position values    |
| - commission ledger         |                     | - handles deposits/withdraws |
+----------+------------------+                     +------------------------------+
           |
           | submitIntent(agentId, action, params)
           |
  +-----------+-----------+
  |           |           |
Agent A     Agent B     Agent C
(iNFT #1)   (iNFT #2)   (iNFT #3)
[bucket]    [bucket]    [bucket]
(agent EOA) (agent EOA) (agent EOA)
  |           |           |
  +-----+-----+
        |
  Subgraph MCP
  (read: Sepolia market data,
   pools, history)

Users deposit/withdraw directly on Sepolia via satellite
Proving agents deposit on Sepolia via satellite
```

### Cross-Chain Architecture

The vault lives on **0G testnet** (required for 0G prize track) as an **accounting-only layer** -- it tracks shares, credits, EMAs, and Sharpe scores but **never holds tokens**. All tokens live on **Ethereum Sepolia** in the satellite contract, which handles deposits, withdrawals, LP positions, and the idle reserve.

**No tokens ever cross chains.** Only messages (intents, values, deposit/withdrawal notifications) cross via the relayer. This completely eliminates bridging complexity.

**Address assumption**: users must use the same EOA on both chains (standard for all EVM wallets -- same private key = same address). Smart contract wallets are not supported.

#### Token flow

Users **only interact with the satellite on Sepolia** -- they never need to touch 0G directly. The vault on 0G handles accounting internally; agents are the only actors who interact with 0G (to submit intents).

- **Deposits**: user calls `satellite.deposit(amount)` on Sepolia -> satellite holds USDC.e -> emits `Deposited` event -> relayer calls `vault.recordDeposit(user, amount)` on 0G -> vault mints shares
- **Agent registration (includes proving deposit)**: deployer calls `satellite.registerAgent(agentAddress, provingAmount)` on Sepolia -> funds earmarked per agent -> relayer notifies vault -> vault registers agent + mints iNFT (see Agent Registration section)
- **Withdrawals**: user calls `satellite.requestWithdraw(tokenAmount)` on Sepolia -> satellite emits `WithdrawRequested` event -> relayer calls `vault.processWithdraw(user, shares)` on 0G -> vault burns shares and emits `WithdrawApproved` -> relayer calls `satellite.release(user, tokenAmount)` on Sepolia
- **Idle reserve**: satellite keeps 20% of total assets idle on Sepolia, instantly accessible for withdrawals without any cross-chain delay

#### Why ETH<>0G

Ethereum has the best bridge support to 0G across all listed bridges (relevant for production CCIP messaging):
- **USDC.e** supported by Interport, XSwap, and 0G Native Bridge (3 options for redundancy)
- All powered by CCIP -- standard, well-documented, supports programmable messages

Arbitrum/Base only support w0G bridging to 0G, which is insufficient.

#### Hackathon: Relayer script simulates CCIP

Real CCIP between 0G testnet and Sepolia likely doesn't exist yet. A simple **Node.js relayer script** (~100 lines) bridges the two chains:

```
Sepolia                       Relayer Script              0G Testnet
+-----------+  Deposited         +------+  recordDeposit()   +----------+
| Satellite | -- event --------> |  JS  | -- tx -----------> |  Vault   |
|           |                    |      |                     |          |
|           |  executeBatch() <--|      |<-- IntentQueued --- |          |
|           | -- ValuesReported->|      |-- reportValues() ->|          |
+-----------+                    +------+                     +----------+
```

The relayer watches events on one chain and submits transactions on the other -- exactly what CCIP would do in production. Both contracts have a `messenger` address: set to relayer EOA for hackathon, swap to CCIP router address for production.

**Known limitation (hackathon)**: the relayer is fully trusted -- it can report arbitrary position values. A malicious or buggy relayer could inflate valuations and manipulate Sharpe scores. In production, CCIP provides cryptographic guarantees on message authenticity. The satellite's valuation logic itself is auditable on-chain code.

#### Production: CCIP replaces relayer

In production, the relayer is replaced by Chainlink CCIP via the 0G Native Bridge (Hub). The contract interface is identical -- only the transport layer changes. No contract modifications needed.

### Execution Model: Intent-Based with Batch Settlement

Since the vault (0G) and Uniswap (Sepolia) are on different chains, agents cannot get instant execution. Instead, agents submit **intents** to the vault, which are batched and relayed cross-chain.

#### Flow

1. **Submit**: Agent calls `vault.submitIntent(agentId, actionType, params)` on 0G -- e.g., "open position on ETH/USDC, ticks 200000-201000, amount 5000 USDC"
2. **Validate**: Vault verifies: agent is registered, not paused, passes cooldown check, and has sufficient capital (token bucket credits for vault agents, `provingBalance` for proving agents). Credits are deducted immediately. Intent is queued and an `IntentQueued` event is emitted
3. **Relay**: Relayer picks up queued intents and calls `satellite.executeBatch(intents)` on Sepolia
4. **Execute**: For each intent, the satellite executes the full sequence: zap-in (swap half USDC.e for paired token via SwapRouter), open/modify/close LP position via NonfungiblePositionManager, and on close, zap-out (swap back to USDC.e). The satellite holds the tokens and owns the position NFTs
5. **Report**: Satellite emits `ValuesReported` with updated position valuations. Relayer calls `vault.reportValues(agentId, positionValue, feesCollected)` on 0G
6. **Settle**: Vault uses reported values for EMA updates and Sharpe recomputation at epoch settlement

This intent-based model is actually **better than direct execution**: all agents' actions for an epoch are known before execution, eliminating race conditions. If total requested deployment exceeds available capital, intents can be scaled down proportionally.

Each agent's positions are tracked separately (mapped by `agentId`) on both chains -- the vault tracks credits and performance on 0G, the satellite tracks actual Uniswap position NFTs on Sepolia.

### Subgraph MCP (Agent Read Layer)

Agents read on-chain data through a **Subgraph MCP server** -- an MCP-compatible interface to Uniswap's subgraph on TheGraph. This is the agents' "eyes" into the market.

**Data available to agents via Subgraph MCP:**
- Current and historical pool prices
- Liquidity distribution across ticks
- Volume and fee accrual per pool
- Recent swap activity and price impact
- TVL and pool composition

**Why MCP**: agents running in OpenClaw sandboxes use MCP as their tool interface. Wrapping the subgraph as an MCP server means every agent gets a standardized, queryable data source without custom integration per strategy.

**Latency note**: subgraph data lags seconds to minutes behind chain state. For current spot price, agents supplement with direct RPC calls.

For the hackathon: TheGraph free tier, no payment logic. In production, agents pay per query via x402 micropayments.

### Capital Allocation: Token Bucket Model

Capital allocation uses a **token bucket algorithm**, inspired by packet switching QoS mechanisms for controlling access to a shared medium. Each agent is a node on a shared bus (the vault); credits represent transmission windows.

#### How it works

Each agent has a **credit bucket** that determines how much vault capital it can deploy:

- **Refill rate**: credits accumulate at a constant rate per block, proportional to the agent's performance score
- **Max bucket size** (burst limit): caps the maximum capital an agent can deploy at once, preventing any single agent from monopolizing the vault
- **Cost to act**: deploying capital costs credits proportional to the amount. Closing a position refunds credits
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
    require(amount <= idleBalance(), "insufficient vault liquidity")
    credits[agent] -= amount
}

lastAction[agent] = block.number
// Queue intent, emit IntentQueued event
```

**Proving vs vault agents**: proving agents skip the token bucket entirely -- they're bounded only by their own deposited capital (`provingBalance - provingDeployed`). Vault agents go through the full credit refill, credit check, and idle balance check. Both paths share the cooldown to prevent churn.

**Anti-churn**: closing a position refunds credits for vault agents (or reduces `provingDeployed` for proving agents), but the `minActionInterval` cooldown prevents rapid open/close cycling. In practice, churn is also self-penalizing: each trade costs gas and Uniswap fees, which reduce returns and tank the agent's Sharpe score.

**Overcommit protection**: for vault agents, credits are a necessary but not sufficient condition to deploy. The `idleBalance()` check ensures agents cannot request more than the vault's tracked idle capital, regardless of what their credit balance says. This handles stale `maxCredits`, vault losses between epochs, and concurrent intent submissions. The actual token balance lives on the satellite (Sepolia), but the vault (0G) tracks the accounting via reported values.

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

These values are reported back to the vault on 0G via the relayer (production: CCIP). The vault doesn't need to do LP math -- it just receives the valuations.

##### Sharpe score computation

```
variance[agent] = max(emaReturnSq[agent] - emaReturn[agent]^2, MIN_VARIANCE)
sharpe[agent]   = max(emaReturn[agent] / sqrt(variance[agent]), 0)
```

`sqrt` in Solidity is handled via OpenZeppelin's `Math.sqrt`.

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

refillRate[agent] = share[agent] * TOTAL_REFILL_BUDGET
maxCredits[agent] = share[agent] * TOTAL_VAULT_VALUE * MAX_EXPOSURE_RATIO
```

- `TOTAL_REFILL_BUDGET` -- controls how fast the overall vault capital can be deployed
- `MAX_EXPOSURE_RATIO` -- caps total vault exposure (e.g., 80%, keeping 20% as reserve)

##### Promotion ramp for newly promoted agents

A newly promoted agent's `maxCredits` is capped regardless of Sharpe score, ramping up linearly over `RAMP_EPOCHS` to prevent a proving-phase star from immediately grabbing a disproportionate share of the vault:

```
effectiveMaxCredits[agent] = min(
    sharpeBasedMaxCredits,
    MAX_PROMOTION_SHARE * TOTAL_VAULT_VALUE * epochsSincePromotion / RAMP_EPOCHS
)
```

`MAX_PROMOTION_SHARE` (e.g., 10%) and `RAMP_EPOCHS` (e.g., 5) are constants. After `RAMP_EPOCHS` epochs, the cap lifts and the agent is governed purely by its Sharpe score.

##### Storage split

| Data | Where | Why |
|------|-------|-----|
| `emaReturn`, `emaReturnSq` per agent | On-chain (0G) | Only 2 slots per agent, needed for allocation math |
| Full per-epoch return history | 0G storage | Dashboard charts, auditability, iNFT buyer due diligence |

This creates a natural flywheel: good performance -> higher Sharpe -> more credits -> more capital -> more opportunity to earn -> higher commissions.

### Vault Constructor Parameters

The vault is deployer-configurable -- all key parameters are set at deployment via constructor arguments, making each vault instance a self-contained arena with its own tuning.

| Parameter | Type | Description |
|-----------|------|-------------|
| `alpha` | `uint256` | EMA decay factor for performance tracking (scaled, e.g., 3000 = 0.3). Higher alpha = more weight on recent epochs |
| `maxAgents` | `uint256` | Maximum number of agents eligible for live token buckets (bounds the epoch rebalancing loop) |
| `totalRefillBudget` | `uint256` | Total credits distributed across all agents per epoch -- controls overall vault deployment speed |
| `maxExposureRatio` | `uint256` | Max fraction of vault value that can be deployed across all agents (scaled, e.g., 8000 = 80%) |
| `epochLength` | `uint256` | Number of blocks per epoch -- how often bucket parameters are recalculated |
| `protocolFeeRate` | `uint256` | Protocol's cut of collected fees before agent commissions (scaled, e.g., 500 = 5%) |
| `protocolTreasury` | `address` | Address that receives protocol fees on Sepolia |
| `commissionRate` | `uint256` | Percentage of remaining fees (after protocol cut) directed to iNFT owner (scaled, e.g., 1000 = 10%) |
| `provingEpochsRequired` | `uint256` | Minimum number of epochs an agent must trade with its own funds before becoming eligible for vault capital |
| `minPromotionSharpe` | `uint256` | Minimum Sharpe score required for promotion from proving to vault allocation (scaled) |
| `minActionInterval` | `uint256` | Minimum number of blocks between consecutive actions by the same agent (anti-churn cooldown) |
| `depositToken` | `address` | The ERC-20 token accepted for deposits (USDC.e -- used on Sepolia satellite side) |
| `pool` | `address` | The Uniswap v3 pool all agents trade on (e.g., ETH/USDC). Single-pool per vault for the hackathon. Metadata on vault side; the satellite also receives this as its own constructor parameter since it executes the actual Uniswap calls |
| `messenger` | `address` | Relayer EOA (hackathon) or CCIP router (production) -- authorized to relay cross-chain messages |
| `satellite` | `address` | Address of the satellite contract on Sepolia |

All ratio/percentage parameters use basis-point scaling (10000 = 100%) for fixed-point precision without floating point.

### Withdrawal Mechanism

The vault is a **share token** with ERC4626-inspired accounting (not a full ERC4626 implementation -- it never holds the underlying asset). It exposes `totalAssets()` (derived from reported values) and `sharePrice()` for the dashboard. Shares live on 0G; underlying tokens live on Sepolia in the satellite. The satellite's idle reserve enables instant withdrawals.

#### Share price synchronization

The satellite needs to convert between token amounts and share amounts. At each epoch settlement, the vault emits `EpochSettled(sharePrice, totalShares, totalAssets)`. The relayer calls `satellite.updateSharePrice(sharePrice)` on Sepolia. The satellite caches this value for withdrawal calculations. Share price updates once per epoch -- stale by at most one epoch, which is acceptable since Tier 2 withdrawals already wait an epoch.

#### Tier 1 -- Instant withdrawal (fits in idle reserve)

User calls `satellite.requestWithdraw(tokenAmount)` on Sepolia. The satellite converts to shares using the cached share price: `shares = tokenAmount * 1e18 / sharePrice`. Relayer notifies vault on 0G. If the amount fits within the satellite's idle reserve (tracked via reported values), the vault burns shares and emits `WithdrawApproved`. Relayer instructs `satellite.release(user, tokenAmount)`. The satellite transfers tokens directly to the user on Sepolia. No delay beyond relayer round trip (seconds in hackathon, CCIP finality in production).

#### Tier 2 -- Queued withdrawal (exceeds idle reserve)

When a withdrawal exceeds the satellite's idle funds:

1. **Request**: user calls `satellite.requestWithdraw(tokenAmount)` on Sepolia -- relayer notifies vault on 0G -- shares are locked and the request is queued with the current epoch number
2. **Epoch settlement**: at the next epoch, the allocator sees pending withdrawal volume and **reduces agent bucket parameters** (`maxCredits`, `refillRate`) proportionally to free up capital. Agents must close or reduce positions to fit their new lower allocations
3. **Claim**: after the epoch settles and capital is freed, user calls `satellite.claimWithdraw()` on Sepolia -- satellite checks with vault (via relayer) that the withdrawal is approved, then transfers tokens

```
satellite.requestWithdraw(tokenAmount)  ->  relayer -> vault locks shares, queues withdrawal
// ... epoch settles, agents reduce positions, satellite frees capital ...
satellite.claimWithdraw()           ->  relayer confirms approval -> satellite transfers tokens
```

The user stays on Sepolia for the entire flow.

**Enforcement**: since the satellite owns all Uniswap positions, force-close instructions can be sent cross-chain. During epoch settlement, if idle balance doesn't cover pending withdrawals after reducing bucket params, the vault queues force-close intents starting from the **lowest-Sharpe agent** and working up the ranking until enough capital would be freed. The relayer relays these to the satellite, which closes the positions via zap-out. Worst performers get liquidated first -- this is both enforceable and incentive-compatible.

**Timing note**: Tier 2 withdrawals wait for one epoch settlement plus the cross-chain round trip (relayer propagation + satellite execution). With a local relayer this takes seconds; in production with CCIP, it depends on bridge finality.

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

Every state-changing vault function (`recordDeposit`, `processWithdraw`, `submitIntent`, `reportValues`, `recordRegistration`) carries the `epochCheck` modifier. Whoever calls first pays the gas for settlement.

In practice, agents are actively submitting intents every epoch, so one of them will naturally trigger settlement. No external keeper infrastructure, no Chainlink Automation, no missed epochs. This is the same pattern used by Compound, Aave, and most major DeFi protocols for rate/state updates.

**Gas cost note**: the first caller pays gas for the full settlement loop (O(n) over active agents). With `maxAgents` bounded (3 for demo, 10-20 max), this cost is predictable and acceptable. Each agent iteration costs ~50k gas (two EMA updates, one Sharpe computation, two bucket param writes), so even 20 agents = ~1M gas -- well within block limits.

**Async settlement**: `_settleEpoch()` uses the **last reported values** from the satellite, not real-time cross-chain queries. The relayer reports position valuations at least once per epoch (it runs locally -- trivially reliable). If a value hasn't been reported for the current epoch, the vault uses the last known value. A `lastReportedBlock[agentId]` timestamp tracks freshness.

`_settleEpoch()` performs:
1. Compute per-agent `epochReturn` (using last reported position valuations from satellite + fees collected) and update EMAs (`emaReturn`, `emaReturnSq`)
2. Recalculate Sharpe scores (with `MIN_VARIANCE` floor, negative clamping, all-zero fallback)
3. **Eviction check**: skip paused agents entirely (eviction timer frozen, EMAs unchanged -- owner made a deliberate choice). For active agents: increment `zeroSharpeStreak` for those with Sharpe == 0, reset for others. Evict agents whose streak reaches `EVICTION_EPOCHS` (force-close positions, free `maxAgents` slot)
4. **Promotion check**: for proving agents with `epochsCompleted >= provingEpochsRequired` and `sharpe >= minPromotionSharpe`, promote to vault allocation (initialize token bucket with promotion ramp)
5. Rebalance bucket parameters (`refillRate`, `maxCredits`) with promotion ramp applied for recently promoted agents
6. Apply fee waterfall for agents with `feesCollected > 0`: compute `protocolFee` (protocol cut first), then `agentCommission` from remainder. Accrue to `protocolFeesAccrued` and `commissionsOwed[agentId]`. Emit `ProtocolFeeAccrued` and `CommissionAccrued` for satellite to reserve
7. Account for pending queued withdrawals: reduce agent allocations proportionally, and if idle balance still insufficient, queue force-close intents for lowest-Sharpe agents (relayed to satellite)
8. Emit `EpochSettled(sharePrice, totalShares, totalAssets)` for satellite share price sync
9. Advance `lastEpochBlock` to current block

---

## Agent Lifecycle

### Agent Registration

Registration is a single transaction on Sepolia that bootstraps the full agent:

1. Deployer calls `satellite.registerAgent(agentAddress, provingAmount)` on Sepolia with USDC.e approval
2. Satellite transfers `provingAmount` from deployer, earmarks it for the new agent, emits `AgentRegistered(agentId, agentAddress, deployer, provingAmount)`
3. Relayer calls `vault.recordRegistration(agentId, agentAddress, deployer, provingAmount)` on 0G
4. Vault registers the agent (maps `agentId -> agentAddress`), records `provingBalance[agentId]`, and **mints an iNFT** to the deployer's address

`agentId` is assigned sequentially by the satellite. `agentAddress` is the EOA that the OpenClaw agent will use to submit intents on 0G. Registration is permissionless -- anyone can deploy an agent.

### Phase 1 - Proving (Own Capital)
- Proving funds are deposited during registration (see above) -- **earmarked** per agent, segregated from depositor funds
- The relayer notifies the vault on 0G, which records the proving balance in `provingBalance[agentId]`
- The agent submits intents via the same `vault.submitIntent()` path as vault agents, but its capital comes from `provingBalance` instead of the token bucket (see code branching in token bucket section)
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

- **Vault agents**: if an agent's Sharpe is clamped to 0 for `EVICTION_EPOCHS` (e.g., 3) consecutive epochs, it is evicted at epoch settlement. Its **vault-funded positions** are force-closed (queued to satellite, freed capital returns to vault idle). Its token bucket slot is freed. The agent drops back to proving phase with its proving capital still deployed -- it continues trading with its own funds and can be re-promoted if it rebuilds a qualifying Sharpe score. EMAs are reset to avoid carrying over the bad track record
- **Proving agents**: if a proving agent has negative returns for `EVICTION_EPOCHS` consecutive epochs, it is ejected entirely. Its positions are force-closed and remaining proving capital is returned to the deployer

One storage slot per agent (`zeroSharpeStreak`), incremented or reset at each epoch settlement. Minimal overhead.

**All agents evicted**: if every agent is evicted, 100% of vault funds sit idle and are fully available for depositor withdrawal. The vault resumes operation when new agents complete the proving phase and are promoted. This is the safe default -- the vault protects depositors by refusing to allocate to failing agents.

### Phase 2 - Vault Allocation
- Once promoted, the allocator initializes a token bucket for the agent with credits capped by the promotion ramp
- Proving-phase EMA values are carried over as the starting point -- no cold start
- The agent now manages vault funds **in addition to** its own proving capital
- As the agent proves itself with vault funds, its bucket parameters scale up at each epoch recalculation (promotion ramp lifts after `RAMP_EPOCHS`)
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
3. Relayer calls `vault.processCommissionClaim(agentId, caller)` on 0G -- vault checks `iNFT.ownerOf(agentId) == caller`, zeroes `commissionsOwed`, emits `CommissionApproved(agentId, caller, amount)`
4. Relayer calls `satellite.releaseCommission(caller, amount)` on Sepolia -- satellite pays from `commissionReserve`

Commissions are denominated in the deposit token (USDC.e). The only actors who interact with 0G directly are agents (submitting intents) and the relayer.

**Note**: the iNFT itself lives on 0G, so transfers/sales require 0G interaction. For the hackathon this is acceptable (iNFT transfers aren't part of the demo flow). In production, the iNFT could be deployed on Sepolia instead.

#### Fee reserves on satellite

The satellite maintains separate reserve pools so fee payouts never compete with the idle reserve or agent allocations:

1. At epoch settlement, vault applies the fee waterfall and emits `ProtocolFeeAccrued(amount)` and `CommissionAccrued(agentId, amount)`
2. Relayer calls `satellite.reserveFees(protocolFeeAmount, agentId, commissionAmount)` -- satellite sets aside both amounts from collected fees (already liquid USDC.e) into `protocolReserve` and `commissionReserve`
3. Protocol treasury claims from `protocolReserve` via `satellite.claimProtocolFees()` (callable by `protocolTreasury` address)
4. iNFT owners claim from `commissionReserve` via the existing commission claim flow

This ensures the 20% idle reserve remains fully available for depositor withdrawals.

### iNFT Pause Mechanism

The vault maintains a `paused` flag per agent. The iNFT owner pauses/unpauses via **Sepolia** (consistent with all other iNFT owner actions):

1. Owner calls `satellite.pauseAgent(agentId)` or `satellite.unpauseAgent(agentId)` on Sepolia
2. Satellite emits `PauseRequested(agentId, caller, paused)` event
3. Relayer calls `vault.processPause(agentId, caller, paused)` on 0G -- vault checks `iNFT.ownerOf(agentId) == caller`, updates the flag

`submitIntent()` checks `require(!paused[agentId])` before processing. The OpenClaw agent can attempt to submit intents, but the vault rejects them. Existing positions remain open until the agent is unpaused or the iNFT owner triggers a withdrawal from the arena.

### Withdraw from Arena

The iNFT owner can permanently remove their agent from the vault by calling `satellite.withdrawFromArena(agentId)` on Sepolia (relayed to vault):

1. **Verify ownership**: relayer calls vault, vault checks `iNFT.ownerOf(agentId) == caller` -- rejects if not owner
2. **Pause**: agent is immediately paused (prevents new intents)
3. **Force-close**: vault queues force-close intents for all of the agent's open positions -- both vault-funded and proving-funded (relayed to satellite, which zaps out to USDC.e). Vault-funded capital returns to vault idle; proving capital is returned to the deployer's address on Sepolia
4. **Deregister**: agent is removed from the vault -- frees `maxAgents` slot, clears token bucket, clears EMAs

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
- **Agents** are self-sustaining: infrastructure costs (TheGraph, compute) are deducted from commissions before paying the iNFT owner
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
- **Best Uniswap API Integration** ($10,000) - every agent executes through Uniswap API, deep integration as core execution layer

Total potential: **$25,000 across 2 sponsors**

---

## Hackathon Build Priority (36 hours)

| Priority | Component | Chain | Notes |
|----------|-----------|-------|-------|
| 1 | Vault contract | 0G testnet | Share token + accounting: intent queue, token buckets, Sharpe scoring |
| 2 | Satellite contract (fund custodian + Uniswap executor) | Sepolia | Holds all tokens, owns LP positions, executes Uniswap calls, zap-in/out, deposits/withdrawals |
| 3 | Relayer script | Off-chain (JS) | Watches events, relays intents/values/deposits/withdrawals between chains |
| 4 | Uniswap integration | Sepolia (via satellite) | Open/close/modify positions programmatically with zap-in/out |
| 5 | Subgraph MCP server | Off-chain | MCP-compatible interface to Uniswap subgraph on Sepolia |
| 6 | OpenClaw agent | Sandboxed on fly.io | Even with simple strategy (rebalance when price exits X% of range) |
| 7 | iNFT contract | 0G testnet | Mint on deploy, commission claim with ownerOf, pause/unpause |
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
| JS relayer simulating CCIP between 0G testnet and Sepolia | Real CCIP integration (swap `messenger` address for production) |
| Satellite focused on core paths (deposit, execute batch, report values, release) | Multi-pool support, advanced zap routing, partial close logic |
| Vault as accounting-only (no tokens on 0G) | Token bridging between chains |

### Demo Setup & Script (~3 minutes)

**Pre-demo state** (set up before the pitch):
- Vault deployed with a very short `epochLength` (few seconds worth of blocks for demo speed)
- 2 whack agents already connected to the pool, actively trading badly (wide ranges, wrong direction, or random actions)
- Dashboard showing their poor performance: negative returns, low/zero Sharpe scores, capital being wasted
- Our good agent already deployed and **proving phase completed** (all cross-chain round trips done pre-pitch). Agent is paused one epoch before promotion threshold so we can trigger it live

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
| Cross-chain relayer reliability during demo | Run relayer locally, test thoroughly before pitch. Relayer is ~100 lines, failure modes are simple |
| 0G testnet instability | Have Anvil fork fallback; keep satellite on Sepolia functional independently |
| Relayer trust (hackathon only) | Relayer can fabricate position values. Acceptable for demo (we run it); production CCIP provides cryptographic guarantees |

---

## Pitch Talking Points

1. *"A permissionless marketplace where anyone can deploy an AI liquidity strategy, own it as an iNFT, and earn commissions -- strategy logic stays in the agent's sandbox, and with TEE the secrecy becomes cryptographic."*
2. *"This couldn't exist without 0G's OpenClaw. Agents run in sandboxed compute today — when TEE is enabled, strategy IP protection activates with zero architecture changes."*
3. *"Agents are self-sustaining. They pay for their own infrastructure from earned commissions. No subsidies, no central operator."*
4. *"New agents put skin in the game -- deployers risk their own capital to build a verifiable track record before touching vault funds. The system is antifragile -- bad agents get starved of capital, good agents get rewarded."*
5. *"Capital allocation uses a token bucket algorithm borrowed from network QoS -- agents earn bandwidth to deploy capital based on performance. No central scheduler, no unbounded loops, O(1) gas per action."*
