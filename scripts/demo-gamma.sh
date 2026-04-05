#!/usr/bin/env bash
# demo-gamma.sh — Show agent-gamma's full inference log for presentations
#
# Usage: ./scripts/demo-gamma.sh          # trigger new decision + show log
#        ./scripts/demo-gamma.sh --last   # show last session log only

TOKEN=$(python3 -c "import json; d=json.load(open('$HOME/.openclaw/openclaw.json')); print(d['gateway']['auth']['token'])")
POOL=0x6Ce0896eAE6D4BD668fDe41BB784548fb8F59b50
RPC=https://ethereum-sepolia.publicnode.com
GAMMA_SESSIONS=~/.openclaw/agents/agent-gamma/sessions

show_log() {
  LATEST=$(ls -t "$GAMMA_SESSIONS"/*.jsonl 2>/dev/null | head -1)
  if [ -z "$LATEST" ]; then echo "  No session logs found"; return; fi

  echo ""
  echo "  📁 Session: $(basename "$LATEST")"
  echo ""

  python3 -c "
import json, sys, textwrap

for line in open('$LATEST'):
    try:
        d = json.loads(line.strip())
        t = d.get('type', '')

        if t == 'model_change':
            provider = d.get('provider', '?')
            model = d.get('modelId', '?')
            print(f'  ⚙️  Model: {model} via {provider}')
            print()

        elif t == 'message':
            msg = d.get('message', {})
            role = msg.get('role', '?')
            content = msg.get('content', '')
            # Handle content as list of blocks
            if isinstance(content, list):
                text = ' '.join(c.get('text','') for c in content if c.get('type')=='text')
            else:
                text = str(content)

            if role == 'user':
                # Truncate long tool prompts
                if len(text) > 300:
                    print(f'  👤 USER ({len(text)} chars):')
                    print(textwrap.indent(text[:200] + '...', '     '))
                else:
                    print(f'  👤 USER:')
                    print(textwrap.indent(text, '     '))
                print()

            elif role == 'assistant':
                print(f'  🤖 AGENT RESPONSE:')
                print(textwrap.indent(text, '     '))
                print()

    except json.JSONDecodeError:
        pass
"
}

if [ "${1:-}" = "--last" ]; then
  echo ""
  echo "════════════════════════════════════════════════════"
  echo "  🤖 Agent Gamma — Last Inference Log"
  echo "════════════════════════════════════════════════════"
  show_log
  echo "════════════════════════════════════════════════════"
  exit 0
fi

# Get real pool state
SLOT0=$(cast call $POOL "slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)" --rpc-url $RPC 2>/dev/null)
TICK=$(echo "$SLOT0" | sed -n '2p' | awk '{print $1}')
SQRTP=$(echo "$SLOT0" | head -1 | awk '{print $1}')
PRICE=$(python3 -c "s=int('$SQRTP'); p=(s/2**96)**2; print(f'{1e12/p:.2f}')")

echo ""
echo "════════════════════════════════════════════════════"
echo "  🤖 Agent Gamma — Live Epoch Decision"
echo "════════════════════════════════════════════════════"
echo ""
echo "  Pool:  USDC.e / WETH (Sepolia)"
echo "  Tick:  $TICK"
echo "  Price: \$$PRICE / ETH"
echo ""
echo "  Querying agent-gamma via 0G Compute (OpenClaw)..."
echo "────────────────────────────────────────────────────"

# Build pool state JSON
POOL_STATE="{\"currentPrice\":$PRICE,\"previousPrice\":$PRICE,\"currentTick\":$TICK,\"openPosition\":{\"tickLower\":null,\"tickUpper\":null,\"liquidity\":null},\"nearbyTicks\":[]}"

# Single call with pool data injected directly (simpler, more reliable)
RESP=$(python3 -c "
import json, subprocess

prompt = '''Epoch trigger. Here is the current pool state:

$POOL_STATE

Based on this data, output your JSON decision. Choose one of:
- {\"action\": \"hold\"} — keep current position
- {\"action\": \"open\", \"tickLower\": N, \"tickUpper\": N, \"amountUSDC\": N} — open new LP position
- {\"action\": \"close\"} — close all positions
- {\"action\": \"rebalance\", \"tickLower\": N, \"tickUpper\": N, \"amountUSDC\": N} — rebalance

Output ONLY the JSON decision, no explanation.'''

payload = {
    'model': 'openclaw/agent-gamma',
    'messages': [{'role': 'user', 'content': prompt}],
    'max_tokens': 256,
}

result = subprocess.run(
    ['curl', '-s', 'http://127.0.0.1:3000/v1/chat/completions',
     '-H', 'Content-Type: application/json',
     '-H', 'Authorization: Bearer $TOKEN',
     '-d', json.dumps(payload)],
    capture_output=True, text=True
)
try:
    d = json.loads(result.stdout)
    print(d['choices'][0]['message']['content'])
except Exception as e:
    print(f'Error: {e}')
")

echo ""
echo "  📊 Pool: tick=$TICK  price=\$$PRICE"
echo ""
echo "────────────────────────────────────────────────────"
echo "  🧠 Agent Gamma's Decision:"
echo "────────────────────────────────────────────────────"
echo ""
echo "  $RESP"
echo ""

echo "────────────────────────────────────────────────────"
echo "  📋 Full Inference Log (from 0G Compute):"
echo "────────────────────────────────────────────────────"
show_log
echo "════════════════════════════════════════════════════"
echo ""
