# Koi Protocol - Demo Flow

Two demos: a pre-recorded video (editable, can timelapse) and a live stage demo (~3 min). Everything runs through the dashboard UI. Terminal only for behind-the-scenes agent reasoning or Sepolia Etherscan if judges ask.

---

## Video Demo (pre-recorded, editable)

### Video Structure

**First half:** Intro, problem statement, solution overview, architecture walkthrough, deep-dives into key mechanisms (token bucket, Sharpe scoring, epoch settlement, iNFT commissions).

**Second half:** Live demo recording with technical drops (explain what's happening under the hood as each action plays out).

### BEFORE RECORDING: Refill Wallets
- [ ] Deployer wallet: Sepolia ETH (gas) + USDC.e (deposits, proving capital)
- [ ] Relayer wallet: Sepolia ETH (gas for satellite txs) + 0G testnet tokens (gas for Vault/AM txs)
- [ ] Agent wallets (x3): 0G testnet tokens (gas for submitIntent txs)
- [ ] Demo user wallet (MetaMask): Sepolia ETH (gas) + USDC.e (for deposit/withdraw demo)
- [ ] Verify all balances are sufficient for the full recording session (no mid-demo failures)

### Setup
- Fresh contracts deployed with normal `epochLength`
- `maxAgents = 2` (only 2 out of 3 agents can be promoted to vault phase)
- Relayer, MCP server, 3 OpenClaw agents all running
- Dashboard open in browser, wallet connected on Sepolia
- **Vault starts empty** — no prior deposits

### 1. Deposit (~30s)
- Dashboard depositor view: vault is empty, no capital under management
- Enter USDC.e amount in deposit form, click "Deposit"
- Wallet popup (MetaMask): approve USDC.e, confirm `satellite.deposit()` tx
- Dashboard updates: **shares minted** and visible, share balance appears, totalAssets increments
- *Technical drop: explain share token mechanics — ERC-20 shares represent proportional vault ownership*
- Optionally show Sepolia Etherscan: `Deposited` event in tx logs

### 2. Agent Registration (~1 min)
- 3 agents already registered by deployer before recording
- Dashboard agent performance view: 3 agents listed, all in PROVING phase
- Click into each agent: iNFT ID, agentAddress, provingBalance, phase = PROVING
- *Technical drop: explain that `maxAgents = 2`, so only the best 2 can graduate — there's real competition*
- **Terminal cut**: show one OpenClaw agent's logs — MCP queries firing, reasoning about tick ranges, intent being constructed

### 3. Proving Phase (timelapse)
- Dashboard: agents submitting intents, EMAs building over epochs
- Sharpe scores diverging — Agent A and B positive, Agent C lagging
- **Terminal cut**: agent reasoning — "pool price at X, my range is Y-Z, drift is 3%, rebalancing" -> intent submitted
- Sepolia Etherscan: `executeBatch` tx with LP positions being opened/modified
- **Timelapse** the epoch progression (actual: 10-30 min, shown as ~30s)

### 4. Promotion (~30s)
- Dashboard: epoch settles, **2 out of 3 agents** move from PROVING -> VAULT
- Token bucket appears: credits, maxCredits, refillRate visible per agent
- Agent C stays in PROVING (Sharpe below `minPromotionSharpe` or `maxAgents` full)
- *Technical drop: explain token bucket QoS — each agent gets independent credit bucket, refill proportional to Sharpe*
- Allocation shifting: promoted agents now have vault capital access

### 5. Vault Capital Deployment (~30s)
- Dashboard position view: new positions appear tagged VAULT (vs older PROVING-tagged ones)
- Agent's credit balance decreasing as it deploys capital
- `totalDeployedVault` incrementing on dashboard
- *Technical drop: Satellite owns all positions, positionSource mapping tracks proving vs vault capital*

### 6. Fee Collection + Commission Accrual (~30s)
- Dashboard fee waterfall view: epoch settles, fees collected
- Breakdown visible: protocol fee (5%) -> agent commission (10% of remainder) -> depositor yield
- `commissionsOwed` per agent visible and incrementing
- `protocolFeesAccrued` visible
- *Technical drop: commissions accrue to the iNFT, not the agent address — iNFT owner captures the yield*

### 7. Commission Claim (~30s)
- Dashboard iNFT marketplace view: click on our agent's iNFT
- Click "Claim Commissions" button -> wallet popup -> confirm `satellite.claimCommissions(agentId)` tx
- Dashboard updates: commission paid out, `commissionsOwed` zeroed for that agent
- Optionally show Sepolia Etherscan: `CommissionClaimRequested` -> `releaseCommission` flow

### 8. Withdrawal (~30s)
- Dashboard depositor view: enter amount in withdraw form, click "Withdraw"
- Wallet popup -> confirm `satellite.requestWithdraw()` tx
- Tier 1 (fits idle): tokens arrive immediately, share balance decreases
- *Technical drop: Tier 1 uses idle capital; Tier 2 queues and force-closes positions at next epoch*
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
- `maxAgents = 2` — only 2 out of 3 agents can be promoted
- Vault has deposited funds (done via dashboard deposit form beforehand)
- 3 agents registered, all have traded through several proving epochs
- 2 agents have strong Sharpe, 1 agent has weak/zero Sharpe
- Best 2 agents are at `provingEpochsRequired - 1` epochs (one epoch away from promotion eligibility)
- Dashboard open, wallet connected, all state visible

### Step 1 -- "The problem" (~30s)
**No transactions. Talk and point.**

- Dashboard agent performance view is on screen
- Point at 3 agents all in PROVING phase, competing for 2 vault slots
- Point at diverging Sharpe scores: 2 strong, 1 weak
- *"Anyone can deploy an agent. But should everyone manage your money? These three are competing — only two can make it."*

### Step 2 -- "Verifiable track records" (~30s)
**No transactions. Talk and point.**

- Click into the best agent on dashboard
- Show: positive Sharpe, positive returns over proving epochs, iNFT minted
- Show provingBalance, epochs completed (one away from threshold)
- *"This agent put real capital at risk. It built a verifiable track record — all on-chain, no trust required."*

### Step 3 -- "Promotion" (~45s)
**LIVE: epoch ticks over** (short `epochLength` — happens naturally or relayer triggers it).

- Dashboard updates in real-time: **2 out of 3 agents** move PROVING -> VAULT
- Token bucket appears with initial credits (capped by promotion ramp)
- Third agent stays in PROVING — not good enough, or no room
- Allocation bar shifts: capital flowing toward the promoted agents
- *"Promoted automatically. Now managing real depositor capital. The third agent? Still has to prove itself — or get replaced."*

### Step 4 -- "Commissions + iNFT ownership" (~30s)
**No transactions. Talk and point.**

- Dashboard: commissions accruing to iNFT owners from the promoted agents' fee waterfall
- Switch to iNFT marketplace view: show the iNFTs with Sharpe, returns, commission yield
- Point at pause/withdraw/claim buttons
- *"Anyone can buy this NFT for passive commission income. The strategy stays secret — sandboxed now, TEE-protected in production."*

### Step 5 -- "The system self-regulates" (~30s)
**LIVE: next epoch ticks over.**

- Dashboard: show capital allocation updating based on latest Sharpe scores
- Token buckets refilling at different rates — better agent gets more capital access
- If weak agent's Sharpe stays zero, `zeroSharpeStreak` incrementing
- *"Better agents get more capital. Bad agents get starved — and eventually evicted. The system is antifragile."*

### Step 6 -- "Roadmap & next steps" (~30s)
**No transactions. Talk (slide or dashboard backdrop).**

- **0G Storage for agent history** — Store full agent track records (intents, positions, PnL snapshots) on 0G decentralized storage, making historical data permanently verifiable and tamper-proof
- **TEE on 0G** — Once 0G ships Trusted Execution Environments, agent strategies run fully encrypted on-chain — no one, not even the protocol, can see the logic. This is a must for real institutional adoption
- **Agent plugin SDK** — Ship a lightweight plugin so any agent framework (OpenClaw, AutoGPT, CrewAI) can integrate with Koi in a few lines — lower the barrier for strategy developers
- **Decentralized relayer network** — Replace the single relayer with a multi-counterparty system (or leverage cross-chain messaging protocols like LayerZero) to remove the last centralized bottleneck
- **Smart contract audit** — Full professional audit before mainnet — the contracts handle real depositor capital, security is non-negotiable

*"This is a hackathon prototype. The path to production is clear — decentralize the relayer, encrypt strategies with TEE, open the plugin ecosystem, and audit everything."*

---

## What's on screen

| Moment | Screen |
|--------|--------|
| Entire demo | Dashboard UI — real contract state from both chains updating live |
| If judges ask | Terminal: OpenClaw agent logs showing MCP queries + reasoning |
| If judges ask | Sepolia Etherscan: tx receipts, event logs, LP position NFTs |

---

## Failure contingency

- If epoch doesn't tick during step 3 or 5: presenter clicks a "Trigger Epoch" button on dashboard (calls `vault.triggerSettleEpoch()` via wallet tx)
- If relayer is down: show the pre-recorded video demo instead
- If 0G testnet is down: switch to Anvil fork fallback (contracts pre-deployed)
- Fallback demo video is always recorded before the pitch as insurance
