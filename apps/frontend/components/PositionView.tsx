"use client";

import { MOCK_AGENTS, MOCK_INTENTS, MOCK_POSITIONS } from "@/lib/mock-data";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";

// ─── Pure formatters ────────────────────────────────────────────────────────

function formatUsdc(rawAmount: string): string {
  const units = Number(rawAmount) / 1_000_000;
  return units.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatLiquidity(raw: string): string {
  const n = Number(raw);
  if (n >= 1_000_000_000_000_000) {
    return (n / 1e15).toFixed(2) + "Q";
  }
  if (n >= 1_000_000_000_000) {
    return (n / 1e12).toFixed(2) + "T";
  }
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

// ─── Action type label + badge color ────────────────────────────────────────

type ActionType = "OPEN_POSITION" | "MODIFY_POSITION" | "CLOSE_POSITION";
type IntentStatus = "executed" | "pending" | "failed";
type BadgeVariant = "positive" | "negative" | "neutral";

const ACTION_LABEL: Record<ActionType, string> = {
  OPEN_POSITION: "OPEN",
  MODIFY_POSITION: "MODIFY",
  CLOSE_POSITION: "CLOSE",
};

const ACTION_VARIANT: Record<ActionType, BadgeVariant> = {
  OPEN_POSITION: "positive",
  MODIFY_POSITION: "neutral",
  CLOSE_POSITION: "negative",
};

const STATUS_VARIANT: Record<IntentStatus, BadgeVariant> = {
  executed: "positive",
  pending: "neutral",
  failed: "negative",
};

// ─── Sub-components ─────────────────────────────────────────────────────────

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
    <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-4 py-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-gray-100">
          #{tokenId}
        </span>
        <span className="font-mono text-xs text-gray-500">
          {tickLower.toLocaleString()} → {tickUpper.toLocaleString()}
        </span>
      </div>

      <div className="flex flex-col items-end gap-0.5">
        <span className="text-sm text-gray-300">
          {formatLiquidity(liquidity)}
        </span>
        <span className="text-xs text-gray-500">liquidity</span>
      </div>

      <div className="flex flex-col items-end gap-0.5">
        <span className="text-sm text-gray-300">
          {formatUsdc(feesCollected)} USDC
        </span>
        <span className="text-xs text-gray-500">fees</span>
      </div>

      <Badge variant={inRange ? "positive" : "negative"}>
        {inRange ? "In Range" : "Out of Range"}
      </Badge>
    </div>
  );
}

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
    <div className="flex flex-col gap-2 rounded-lg border border-gray-800 bg-gray-950 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant={ACTION_VARIANT[actionType]}>
            {ACTION_LABEL[actionType]}
          </Badge>
          <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>
        </div>
        <span className="text-xs text-gray-500">
          {formatRelativeTime(timestamp)}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">{agentName}</span>
        {txHash !== null ? (
          <span className="font-mono text-xs text-gray-500">
            {truncateTxHash(txHash)}
          </span>
        ) : (
          <span className="text-xs text-gray-700">—</span>
        )}
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function PositionView() {
  return (
    <div className="grid grid-cols-[1fr_360px] gap-6">
      {/* Left column — positions grouped by agent */}
      <div className="flex flex-col gap-6">
        {MOCK_AGENTS.map((agent) => {
          const agentPositions = MOCK_POSITIONS.filter(
            (p) => p.agentId === agent.id
          );

          return (
            <Card key={agent.id} className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-gray-100">
                  {agent.name}
                </h3>
                <span className="font-mono text-xs text-gray-500">
                  {agent.address.slice(0, 6)}…{agent.address.slice(-4)}
                </span>
              </div>

              {agentPositions.length === 0 ? (
                <p className="text-sm text-gray-600">No active positions.</p>
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
            </Card>
          );
        })}
      </div>

      {/* Right column — intent live feed */}
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-100">
              Intent Feed
            </h3>
            <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
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
        </Card>
      </div>
    </div>
  );
}
