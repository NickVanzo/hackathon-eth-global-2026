# Agent Arena — Demo Commands

## Show Agent Gamma's Live Decision

Triggers a real inference on 0G Compute (Qwen 2.5 7B) and shows the full log.

```bash
./scripts/demo-gamma.sh
```

## Advance One Epoch

Each agent makes a live LLM decision, submits intents on 0G, reports values, settles the epoch. Shows updated Sharpe scores and promotion status.

```bash
./scripts/demo-epoch.sh
```

## Auto-Run Epochs (background)

Settles epochs automatically in a loop — reports values, waits for epoch boundary, settles.

```bash
./scripts/epoch-cron.sh &
```

Settle just one epoch (no loop):

```bash
./scripts/epoch-cron.sh --once
```