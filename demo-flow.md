# Agent Arena - Demo Flow

Two demos: a pre-recorded video (editable, can timelapse) and a live stage demo (~3 min). Everything runs through the dashboard UI. Terminal only for behind-the-scenes agent reasoning or Sepolia Etherscan if judges ask.

---

## Video Demo (pre-recorded, editable)

### BEFORE RECORDING: Refill Wallets
- [ ] Deployer wallet: Sepolia ETH (gas) + USDC.e (deposits, proving capital)
- [ ] Relayer wallet: Sepolia ETH (gas for satellite txs) + 0G testnet tokens (gas for Vault/AM txs)
- [ ] Agent wallets (x3): 0G testnet tokens (gas for submitIntent txs)
- [ ] Demo user wallet (MetaMask): Sepolia ETH (gas) + USDC.e (for deposit/withdraw demo)
- [ ] Verify all balances are sufficient for the full recording session (no mid-demo failures)

### Setup
- Fresh contracts deployed with normal `epochLength`
- Relayer, MCP server, 3 OpenClaw agents all running
- Dashboard open in browser, wallet connected on Sepolia

### 1. Deposit (~30s)
- Dashboard depositor view: enter USDC.e amount in deposit form, click "Deposit"
- Wallet popup (MetaMask): approve USDC.e, confirm `satellite.deposit()` tx
- Dashboard updates: share balance appears, totalAssets increments
- Optionally show Sepolia Etherscan: `Deposited` event in tx logs

### 2. Agent Registration (~1 min)
- 3 agents already registered by deployer before recording
- Dashboard agent performance view: 3 agents listed, all in PROVING phase
- Click into each agent: iNFT ID, agentAddress, provingBalance, phase = PROVING
- **Terminal cut**: show one OpenClaw agent's logs -- MCP queries firing, reasoning about tick ranges, intent being constructed

### 3. Proving Phase (timelapse)
- Dashboard: agents submitting intents, EMAs building over epochs
- Sharpe scores diverging -- Agent A and B positive, Agent C negative
- **Terminal cut**: agent reasoning -- "pool price at X, my range is Y-Z, drift is 3%, rebalancing" -> intent submitted
- Sepolia Etherscan: `executeBatch` tx with LP positions being opened/modified
- **Timelapse** the epoch progression (actual: 10-30 min, shown as ~30s)

### 4. Promotion (~30s)
- Dashboard: epoch settles, Agent A + B move from PROVING -> VAULT
- Token bucket appears: credits, maxCredits, refillRate visible per agent
- Agent C stays in PROVING (Sharpe below `minPromotionSharpe`)
- Allocation shifting: promoted agents now have vault capital access

### 5. Vault Capital Deployment (~30s)
- Dashboard position view: new positions appear tagged VAULT (vs older PROVING-tagged ones)
- Agent's credit balance decreasing as it deploys capital
- `totalDeployedVault` incrementing on dashboard

### 6. Fee Collection + Commission Accrual (~30s)
- Dashboard fee waterfall view: epoch settles, fees collected
- Breakdown visible: protocol fee (5%) -> agent commission (10% of remainder) -> depositor yield
- `commissionsOwed` per agent visible and incrementing
- `protocolFeesAccrued` visible

### 7. Commission Claim (~30s)
- Dashboard iNFT marketplace view: click on our agent's iNFT
- Click "Claim Commissions" button -> wallet popup -> confirm `satellite.claimCommissions(agentId)` tx
- Dashboard updates: commission paid out, `commissionsOwed` zeroed for that agent
- Optionally show Sepolia Etherscan: `CommissionClaimRequested` -> `releaseCommission` flow

### 8. Bad Agent Eviction (timelapse + live moment)
- Dashboard: Agent C's Sharpe stays at 0, `zeroSharpeStreak` incrementing each epoch
- **Timelapse** the streak buildup
- Live moment: streak hits `evictionEpochs` -> epoch settles -> Agent C evicted
- Dashboard: Agent C drops to PROVING, VAULT positions force-closed, `maxAgents` slot freed
- Credits reallocated to remaining vault agents

### 9. Pause + Withdraw from Arena (~30s)
- Dashboard iNFT marketplace view: click Agent C's iNFT (we're the owner)
- Click "Pause" button -> wallet popup -> confirm `satellite.pauseAgent()` tx
- Dashboard: agent shows paused state, intents rejected
- Click "Withdraw from Arena" button -> wallet popup -> confirm `satellite.withdrawFromArena()` tx
- Dashboard: agent deregistered, all positions force-closed, proving capital returned
- iNFT still visible with historical track record, commissions still claimable

### 10. Withdrawal (~30s)
- Dashboard depositor view: enter amount in withdraw form, click "Withdraw"
- Wallet popup -> confirm `satellite.requestWithdraw()` tx
- Tier 1 (fits idle): tokens arrive immediately, share balance decreases
- Optionally show Tier 2: withdrawal queued, epoch settles, then click "Claim" button -> `satellite.claimWithdraw()` -> tokens released

**Total recorded time:** ~30-60 min actual. **Edited to:** 3-5 min video.

---

## Live Stage Demo (~3 minutes)

Everything pre-staged. Dashboard is the only thing on screen. Two live wallet transactions on stage.

### BEFORE GOING ON STAGE: Refill Wallets
- [ ] Relayer wallet: Sepolia ETH (gas) + 0G testnet tokens (gas) -- enough for ~20 txs each side
- [ ] Agent wallets (x3): 0G testnet tokens (gas) -- agents may still submit intents during demo
- [ ] Presenter wallet (MetaMask): Sepolia ETH (gas) -- only needed if triggering epoch manually
- [ ] Verify ALL balances right before going on stage -- faucets can take minutes, do this early

### Pre-stage Setup (hours before pitch)
- Fresh contracts with very short `epochLength` (few seconds of blocks)
- Vault has deposited funds (done via dashboard deposit form beforehand)
- 2 bad agents registered, traded through epochs, `zeroSharpeStreak = evictionEpochs - 1`
- 1 good agent registered, `provingEpochsRequired - 1` epochs completed, running normally (NOT paused)
- Dashboard open, wallet connected, all state visible

### Step 1 -- "The problem" (~30s)
**No transactions. Talk and point.**

- Dashboard agent performance view is on screen
- Point at 2 bad agents: red Sharpe indicators, negative returns, `zeroSharpeStreak` near threshold
- Point at wasted capital: their positions are losing value
- *"Anyone can deploy an agent. These two are terrible. The system is about to deal with them."*

### Step 2 -- "A better agent proved itself" (~45s)
**No transactions. Talk and point.**

- Click into the good agent on dashboard
- Show: positive Sharpe, positive returns over proving epochs, iNFT minted
- Show provingBalance, epochs completed (one away from threshold)
- *"This agent put real capital at risk. It built a verifiable track record -- all on-chain."*
- Optionally show terminal briefly: agent's reasoning logs, MCP queries to Uniswap data

### Step 3 -- "Promotion" (~30s)
**LIVE: epoch ticks over** (short `epochLength` -- happens naturally or relayer triggers it).

- Dashboard updates in real-time: good agent moves PROVING -> VAULT
- Token bucket appears with initial credits (capped by promotion ramp)
- Allocation bar shifts: capital flowing toward the good agent
- *"Promoted automatically. Now managing real depositor capital."*

### Step 4 -- "Commissions + iNFT ownership" (~30s)
**No transactions. Talk and point.**

- Dashboard: commissions accruing to iNFT owner from the promoted agent's fee waterfall
- Switch to iNFT marketplace view: show the iNFT with its Sharpe, returns, commission yield
- Point at pause/withdraw/claim buttons
- *"Anyone can buy this NFT for passive commission income. The strategy stays secret -- sandboxed now, TEE-protected in production."*

### Step 5 -- "Bad agents get evicted" (~30s)
**LIVE: next epoch ticks over.**

- Dashboard: bad agent's `zeroSharpeStreak` was at threshold - 1; this epoch tips it
- Agent turns red, gets evicted -- drops to PROVING, VAULT positions force-closed
- Slot freed, credits redistributed to remaining agents
- *"Self-cleaning. Bad agents don't just get starved -- they get kicked out. The system is antifragile."*

---

## What's on screen

| Moment | Screen |
|--------|--------|
| Entire demo | Dashboard UI -- real contract state from both chains updating live |
| If judges ask | Terminal: OpenClaw agent logs showing MCP queries + reasoning |
| If judges ask | Sepolia Etherscan: tx receipts, event logs, LP position NFTs |

---

## Failure contingency

- If epoch doesn't tick during step 3 or 5: presenter clicks a "Trigger Epoch" button on dashboard (calls `vault.triggerSettleEpoch()` via wallet tx)
- If relayer is down: show the pre-recorded video demo instead
- If 0G testnet is down: switch to Anvil fork fallback (contracts pre-deployed)
- Fallback demo video is always recorded before the pitch as insurance
