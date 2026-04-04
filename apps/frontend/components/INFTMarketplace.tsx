"use client";

import { useState } from "react";
import { MOCK_INFTS } from "@/lib/mock-data";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

// ─── Types ────────────────────────────────────────────────────────────────────

type INFTEntry = (typeof MOCK_INFTS)[number] & { paused?: boolean };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function sharpeColorClass(score: number): string {
  if (score > 1) return "text-emerald-400";
  if (score >= 0) return "text-yellow-400";
  return "text-red-400";
}

function borderGlowClass(score: number): string {
  // Subtle green glow for high-performers (Sharpe > 1)
  if (score > 1) return "border-emerald-700/60 shadow-[0_0_16px_-4px_theme(colors.emerald.700)]";
  return "border-gray-800";
}

// ─── Disabled Button with Tooltip ────────────────────────────────────────────

interface ActionButtonProps {
  label: string;
  tooltip: string;
  variant?: "default" | "destructive";
}

function ActionButton({ label, tooltip, variant = "default" }: ActionButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  const baseClasses =
    "relative w-full rounded-md px-3 py-1.5 text-xs font-medium transition-opacity cursor-not-allowed opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

  const variantClasses =
    variant === "destructive"
      ? "bg-red-900/40 text-red-400 border border-red-800 focus-visible:outline-red-600"
      : "bg-gray-800 text-gray-300 border border-gray-700 focus-visible:outline-indigo-500";

  return (
    <div className="relative">
      <button
        type="button"
        disabled
        aria-disabled="true"
        aria-label={`${label} — ${tooltip}`}
        className={`${baseClasses} ${variantClasses}`}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
      >
        {label}
      </button>

      {showTooltip && (
        <div
          role="tooltip"
          className="absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-950 border border-gray-700 px-2.5 py-1.5 text-[11px] font-mono text-gray-300 shadow-lg"
        >
          {tooltip}
          {/* Arrow */}
          <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-gray-700" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

// ─── Single iNFT Card ─────────────────────────────────────────────────────────

interface INFTCardProps {
  inft: INFTEntry;
}

function INFTCard({ inft }: INFTCardProps) {
  const { tokenId, agentName, owner, sharpeScore, totalReturn, commissionYield, paused } = inft;
  const isPaused = paused === true;

  return (
    <Card className={`flex flex-col gap-4 border ${borderGlowClass(sharpeScore)}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            iNFT #{tokenId}
          </p>
          <h3 className="mt-0.5 text-base font-semibold text-gray-100 leading-tight">
            {agentName}
          </h3>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          {isPaused && (
            <Badge variant="neutral">Paused</Badge>
          )}
          {sharpeScore > 1 && !isPaused && (
            <Badge variant="positive">High Performer</Badge>
          )}
        </div>
      </div>

      {/* Owner */}
      <div className="rounded-lg bg-gray-800/50 px-3 py-2">
        <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-0.5">Owner</p>
        <p className="font-mono text-xs text-gray-300">{truncateAddress(owner)}</p>
      </div>

      {/* Track Record Stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatCell label="Sharpe">
          <span className={`text-sm font-bold tabular-nums ${sharpeColorClass(sharpeScore)}`}>
            {sharpeScore.toFixed(2)}
          </span>
        </StatCell>

        <StatCell label="Total Return">
          <span className={`text-sm font-bold tabular-nums ${totalReturn >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {formatPercent(totalReturn)}
          </span>
        </StatCell>

        <StatCell label="Commission">
          <span className="text-sm font-bold tabular-nums text-indigo-400">
            {formatPercent(commissionYield)}
          </span>
        </StatCell>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-2 pt-1 border-t border-gray-800/80">
        <ActionButton
          label="Claim Commission"
          tooltip="satellite.claimCommissions()"
        />

        <ActionButton
          label={isPaused ? "Unpause Agent" : "Pause Agent"}
          tooltip={isPaused ? "satellite.unpauseAgent()" : "satellite.pauseAgent()"}
        />

        <ActionButton
          label="Withdraw from Arena"
          tooltip="satellite.withdrawFromArena()"
          variant="destructive"
        />
      </div>
    </Card>
  );
}

// ─── Stat Cell ────────────────────────────────────────────────────────────────

interface StatCellProps {
  label: string;
  children: React.ReactNode;
}

function StatCell({ label, children }: StatCellProps) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-gray-800/40 px-2 py-2.5 text-center">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      {children}
    </div>
  );
}

// ─── iNFT Marketplace ────────────────────────────────────────────────────────

export default function INFTMarketplace() {
  return (
    <section aria-label="iNFT Marketplace">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-100">iNFT Strategy Tokens</h2>
        <p className="mt-1 text-sm text-gray-500">
          Each iNFT represents an on-chain agent strategy. Manage commissions, pause state, and arena participation below.
        </p>
      </div>

      <ul
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 list-none p-0"
        aria-label={`${MOCK_INFTS.length} iNFT strategies`}
      >
        {MOCK_INFTS.map((inft) => (
          <li key={inft.tokenId}>
            <INFTCard inft={inft} />
          </li>
        ))}
      </ul>
    </section>
  );
}
