"use client";

import { MOCK_AGENTS, MOCK_INTENTS, MOCK_POSITIONS, MOCK_VAULT } from "@/lib/mock-data";
import { Card } from "@/components/ui/Card";

// ─── Pure formatters ────────────────────────────────────────────────────────

function formatUsdc(rawAmount: string): string {
  const units = Number(rawAmount) / 1_000_000;
  return units.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatTvl(rawAmount: string): string {
  const units = Number(rawAmount) / 1_000_000;
  if (units >= 1_000_000) return `$${(units / 1_000_000).toFixed(2)}M`;
  if (units >= 1_000) return `$${(units / 1_000).toFixed(2)}K`;
  return `$${units.toFixed(2)}`;
}

function formatLiquidity(raw: string): string {
  const n = Number(raw);
  if (n >= 1_000_000_000_000_000) return `${(n / 1e15).toFixed(2)}Q`;
  if (n >= 1_000_000_000_000) return `${(n / 1e12).toFixed(2)}T`;
  return n.toLocaleString();
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  return `${diffHours}h ago`;
}

function truncateTxHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

function isTickInRange(
  currentTick: number,
  tickLower: number,
  tickUpper: number
): boolean {
  return currentTick >= tickLower && currentTick <= tickUpper;
}

// Derive a rough APY from the best-performing vault agent's totalReturn
function deriveApy(): string {
  const best = MOCK_AGENTS.reduce((top, a) =>
    a.totalReturn > top.totalReturn ? a : top
  );
  return `${(best.totalReturn * 100).toFixed(1)}%`;
}

// ─── Action type label + inline badge classes ────────────────────────────────

type ActionType = "OPEN_POSITION" | "MODIFY_POSITION" | "CLOSE_POSITION";
type IntentStatus = "executed" | "pending" | "failed";

const ACTION_LABEL: Record<ActionType, string> = {
  OPEN_POSITION: "OPEN",
  MODIFY_POSITION: "MODIFY",
  CLOSE_POSITION: "CLOSE",
};

// OPEN=cyan, MODIFY=purple, CLOSE=orange
const ACTION_BADGE_CLASS: Record<ActionType, string> = {
  OPEN_POSITION:
    "text-cyan-400 bg-cyan-500/10 border border-cyan-500/30",
  MODIFY_POSITION:
    "text-purple-400 bg-purple-500/10 border border-purple-500/30",
  CLOSE_POSITION:
    "text-orange-400 bg-orange-500/10 border border-orange-500/30",
};

// executed=cyan, pending=purple, failed=orange
const STATUS_BADGE_CLASS: Record<IntentStatus, string> = {
  executed: "text-cyan-400 bg-cyan-500/10 border border-cyan-500/30",
  pending: "text-purple-400 bg-purple-500/10 border border-purple-500/30",
  failed: "text-orange-400 bg-orange-500/10 border border-orange-500/30",
};

// ─── Shared chip element ─────────────────────────────────────────────────────

function Chip({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

// ─── Vault performance summary ───────────────────────────────────────────────

function VaultSummary() {
  const tvl = formatTvl(MOCK_VAULT.totalAssets);
  const apy = deriveApy();

  return (
    <div className="flex items-center gap-8">
      <div className="flex flex-col gap-0.5">
        <span className="text-3xl font-bold tracking-tight text-[#00E5FF]">
          {tvl}
        </span>
        <span className="text-xs uppercase tracking-widest text-[#787776]">
          Total Value Locked
        </span>
      </div>
      <div className="h-10 w-px bg-[#1c1b1b]" aria-hidden="true" />
      <div className="flex flex-col gap-0.5">
        <span className="text-3xl font-bold tracking-tight text-[#00E5FF]">
          {apy}
        </span>
        <span className="text-xs uppercase tracking-widest text-[#787776]">
          Best Agent APY
        </span>
      </div>
    </div>
  );
}

// ─── Position row ────────────────────────────────────────────────────────────

interface PositionRowProps {
  tokenId: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  currentTick: number;
  feesCollected: string;
}

function PositionRow({
  tokenId,
  tickLower,
  tickUpper,
  liquidity,
  currentTick,
  feesCollected,
}: PositionRowProps) {
  const inRange = isTickInRange(currentTick, tickLower, tickUpper);

  return (
    <div className="flex items-center justify-between rounded-lg border border-[#1c1b1b] bg-[#111111] px-4 py-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-[#E5E2E1]">
          #{tokenId}
        </span>
        <span className="font-mono text-xs text-[#787776]">
          {tickLower.toLocaleString()} → {tickUpper.toLocaleString()}
        </span>
      </div>

      <div className="flex flex-col items-end gap-0.5">
        <span className="text-sm text-[#E5E2E1]">
          {formatLiquidity(liquidity)}
        </span>
        <span className="text-xs text-[#787776]">liquidity</span>
      </div>

      <div className="flex flex-col items-end gap-0.5">
        <span className="text-sm text-[#00E5FF]">
          {formatUsdc(feesCollected)} USDC
        </span>
        <span className="text-xs text-[#787776]">fees</span>
      </div>

      {inRange ? (
        <Chip
          label="In Range"
          className="text-cyan-400 bg-cyan-500/10 border border-cyan-500/30"
        />
      ) : (
        <Chip
          label="Out of Range"
          className="text-orange-400 bg-orange-500/10 border border-orange-500/30"
        />
      )}
    </div>
  );
}

// ─── Agent gladiator card ─────────────────────────────────────────────────────

interface GladiatorCardProps {
  agent: (typeof MOCK_AGENTS)[number];
  positions: typeof MOCK_POSITIONS;
}

function GladiatorCard({ agent, positions }: GladiatorCardProps) {
  const agentPositions = positions.filter((p) => p.agentId === agent.id);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[#1c1b1b] bg-[#111111] p-6">
      {/* Agent header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#00E5FF]/30 bg-[#00E5FF]/10">
            <span className="text-xs font-bold text-[#00E5FF]">
              {agent.name.charAt(0)}
            </span>
          </div>
          <h3 className="text-base font-semibold text-[#E5E2E1]">
            {agent.name}
          </h3>
        </div>
        <span className="font-mono text-xs text-[#787776]">
          {agent.address.slice(0, 6)}…{agent.address.slice(-4)}
        </span>
      </div>

      {/* Agent stats row */}
      <div className="grid grid-cols-3 gap-4 rounded-lg border border-[#1c1b1b] bg-black/20 px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span
            className={`text-sm font-semibold ${
              agent.sharpeScore >= 1
                ? "text-[#00E5FF]"
                : agent.sharpeScore >= 0
                  ? "text-[#E5E2E1]"
                  : "text-[#FF5722]"
            }`}
          >
            {agent.sharpeScore.toFixed(2)}
          </span>
          <span className="text-xs text-[#787776]">Sharpe</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span
            className={`text-sm font-semibold ${
              agent.totalReturn >= 0 ? "text-[#00E5FF]" : "text-[#FF5722]"
            }`}
          >
            {agent.totalReturn >= 0 ? "+" : ""}
            {(agent.totalReturn * 100).toFixed(1)}%
          </span>
          <span className="text-xs text-[#787776]">Return</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-[#7000FF]">
            {agent.credits}/{agent.maxCredits}
          </span>
          <span className="text-xs text-[#787776]">Credits</span>
        </div>
      </div>

      {/* Positions */}
      {agentPositions.length === 0 ? (
        <p className="text-sm text-[#787776]">No active positions.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {agentPositions.map((position) => (
            <PositionRow
              key={position.tokenId}
              tokenId={position.tokenId}
              tickLower={position.tickLower}
              tickUpper={position.tickUpper}
              liquidity={position.liquidity}
              currentTick={position.currentTick}
              feesCollected={position.feesCollected}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Intent feed item ────────────────────────────────────────────────────────

interface IntentFeedItemProps {
  agentName: string;
  actionType: ActionType;
  status: IntentStatus;
  timestamp: number;
  txHash: string | null;
}

function IntentFeedItem({
  agentName,
  actionType,
  status,
  timestamp,
  txHash,
}: IntentFeedItemProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[#1c1b1b] bg-[#111111] px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Chip
            label={ACTION_LABEL[actionType]}
            className={ACTION_BADGE_CLASS[actionType]}
          />
          <Chip label={status} className={STATUS_BADGE_CLASS[status]} />
        </div>
        <span className="text-xs text-[#787776]">
          {formatRelativeTime(timestamp)}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-[#787776]">{agentName}</span>
        {txHash !== null ? (
          <span className="font-mono text-xs text-[#787776]">
            {truncateTxHash(txHash)}
          </span>
        ) : (
          <span className="text-xs text-[#787776]/40">—</span>
        )}
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function PositionView() {
  return (
    <div className="flex flex-col gap-6">
      {/* THE ARENA header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold uppercase tracking-[0.2em] text-[#E5E2E1]">
            The Arena
          </h2>
          <VaultSummary />
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-[#00E5FF]/20 bg-[#00E5FF]/5 px-3 py-1.5 text-xs font-medium text-[#00E5FF]">
          <span
            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#00E5FF]"
            aria-hidden="true"
          />
          LIVE
        </span>
      </div>

      {/* Two-column grid: gladiator cards + intent feed */}
      <div className="grid grid-cols-[1fr_360px] gap-6">
        {/* Left — Agent Gladiator Cards */}
        <div className="flex flex-col gap-6">
          {MOCK_AGENTS.map((agent) => (
            <GladiatorCard
              key={agent.id}
              agent={agent}
              positions={MOCK_POSITIONS}
            />
          ))}
        </div>

        {/* Right — Live Intent Feed */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 rounded-xl border border-[#1c1b1b] bg-[#111111] p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold uppercase tracking-widest text-[#E5E2E1]">
                Intent Feed
              </h3>
              <span className="inline-flex items-center gap-1.5 text-xs text-[#787776]">
                <span
                  className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#00E5FF]"
                  aria-hidden="true"
                />
                Live
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {[...MOCK_INTENTS]
                .sort((a, b) => b.timestamp - a.timestamp)
                .map((intent, index) => {
                  const agent = MOCK_AGENTS.find(
                    (a) => a.id === intent.agentId
                  );
                  return (
                    <IntentFeedItem
                      key={index}
                      agentName={agent?.name ?? `Agent ${intent.agentId}`}
                      actionType={intent.actionType as ActionType}
                      status={intent.status as IntentStatus}
                      timestamp={intent.timestamp}
                      txHash={intent.txHash}
                    />
                  );
                })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
