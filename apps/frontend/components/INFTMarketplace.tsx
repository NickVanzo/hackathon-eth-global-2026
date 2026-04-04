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
  if (score > 1) return "text-[#00E5FF]";
  if (score >= 0) return "text-[#00E5FF]/60";
  return "text-[#FF5722]";
}

function borderGlowClass(score: number): string {
  if (score > 1)
    return "border-[#00E5FF]/40 shadow-[0_0_16px_-4px_#00E5FF]";
  if (score < 0)
    return "border-[#FF5722]/40 shadow-[0_0_16px_-4px_#FF5722]";
  return "border-[#1c1b1b]";
}

// ─── Action Button with Tooltip ───────────────────────────────────────────────

type ButtonVariant = "cyan" | "purple" | "destructive";

interface ActionButtonProps {
  label: string;
  tooltip: string;
  variant?: ButtonVariant;
}

function ActionButton({ label, tooltip, variant = "cyan" }: ActionButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  const baseClasses =
    "relative w-full rounded-md px-3 py-1.5 text-xs font-medium transition-opacity cursor-not-allowed opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

  const variantClasses: Record<ButtonVariant, string> = {
    cyan: "bg-[#00E5FF]/10 text-[#00E5FF] border border-[#00E5FF]/40 focus-visible:outline-[#00E5FF]",
    purple:
      "bg-[#7000FF]/10 text-[#7000FF] border border-[#7000FF]/40 focus-visible:outline-[#7000FF]",
    destructive:
      "bg-[#FF5722]/10 text-[#FF5722] border border-[#FF5722] focus-visible:outline-[#FF5722]",
  };

  return (
    <div className="relative">
      <button
        type="button"
        disabled
        aria-disabled="true"
        aria-label={`${label} — ${tooltip}`}
        className={`${baseClasses} ${variantClasses[variant]}`}
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
          className="absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#111111] border border-[#1c1b1b] px-2.5 py-1.5 text-[11px] font-mono text-[#787776] shadow-lg"
        >
          {tooltip}
          {/* Arrow */}
          <span
            className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-[#1c1b1b]"
            aria-hidden="true"
          />
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
    <Card className={`flex flex-col gap-4 border ${borderGlowClass(sharpeScore)} bg-[#111111]`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-[#787776] uppercase tracking-wider">
            iNFT #{tokenId}
          </p>
          <h3 className="mt-0.5 text-base font-semibold text-[#E5E2E1] leading-tight">
            {agentName}
          </h3>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          {isPaused && <Badge variant="neutral">Paused</Badge>}
          {sharpeScore > 1 && !isPaused && (
            <Badge variant="positive">High Performer</Badge>
          )}
        </div>
      </div>

      {/* Owner */}
      <div className="rounded-lg bg-[#1c1b1b]/60 px-3 py-2">
        <p className="text-[11px] text-[#787776] uppercase tracking-wider mb-0.5">Owner</p>
        <p className="font-mono text-xs text-[#E5E2E1]">{truncateAddress(owner)}</p>
      </div>

      {/* Track Record Stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatCell label="Sharpe">
          <span className={`text-lg font-bold tabular-nums ${sharpeColorClass(sharpeScore)}`}>
            {sharpeScore.toFixed(2)}
          </span>
        </StatCell>

        <StatCell label="Total Return">
          <span
            className={`text-sm font-bold tabular-nums ${
              totalReturn >= 0 ? "text-[#00E5FF]" : "text-[#FF5722]"
            }`}
          >
            {formatPercent(totalReturn)}
          </span>
        </StatCell>

        <StatCell label="Commission">
          <span className="text-sm font-bold tabular-nums text-[#00E5FF]/80">
            {formatPercent(commissionYield)}
          </span>
        </StatCell>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-2 pt-1 border-t border-[#1c1b1b]">
        <ActionButton
          label="Claim Commission"
          tooltip="satellite.claimCommissions()"
          variant="cyan"
        />

        <ActionButton
          label={isPaused ? "Unpause Agent" : "Pause Agent"}
          tooltip={isPaused ? "satellite.unpauseAgent()" : "satellite.pauseAgent()"}
          variant="purple"
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
    <div className="flex flex-col items-center rounded-lg bg-[#1c1b1b]/40 px-2 py-2.5 text-center">
      <p className="text-[10px] text-[#787776] uppercase tracking-wider mb-1">{label}</p>
      {children}
    </div>
  );
}

// ─── iNFT Strategy Market ─────────────────────────────────────────────────────

export default function INFTMarketplace() {
  return (
    <section aria-label="iNFT Strategy Market">
      <div className="mb-6">
        <h2 className="text-lg font-semibold uppercase tracking-widest text-[#E5E2E1]">
          iNFT STRATEGY MARKET
        </h2>
        <p className="mt-1 text-sm text-[#787776]">
          Each iNFT represents an on-chain agent strategy. Manage commissions, pause state, and
          arena participation below.
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
