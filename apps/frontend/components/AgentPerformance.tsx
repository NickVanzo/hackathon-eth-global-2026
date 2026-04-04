"use client";

import { MOCK_AGENTS } from "@/lib/mock-data";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

// ─── Formatting helpers ───────────────────────────────────────────────────────

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatEmaReturn(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface TokenBucketBarProps {
  credits: number;
  maxCredits: number;
  refillRate: number;
}

function TokenBucketBar({ credits, maxCredits, refillRate }: TokenBucketBarProps) {
  const fillPct = maxCredits > 0 ? Math.min((credits / maxCredits) * 100, 100) : 0;

  const barColor =
    fillPct <= 10
      ? "bg-red-500"
      : fillPct >= 80
      ? "bg-emerald-500"
      : "bg-indigo-500";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>
          {credits}/{maxCredits}
        </span>
        <span className="text-gray-500">+{refillRate}/ep</span>
      </div>
      <div
        className="h-1.5 w-32 overflow-hidden rounded-full bg-gray-800"
        role="meter"
        aria-valuenow={credits}
        aria-valuemin={0}
        aria-valuemax={maxCredits}
        aria-label={`Token bucket: ${credits} of ${maxCredits} credits`}
      >
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${fillPct}%` }}
        />
      </div>
    </div>
  );
}

interface ZeroSharpeWarningProps {
  streak: number;
}

function ZeroSharpeWarning({ streak }: ZeroSharpeWarningProps) {
  if (streak === 0) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium text-amber-400"
      title={`Zero-Sharpe streak: ${streak} epoch${streak !== 1 ? "s" : ""}`}
      aria-label={`Warning: zero-Sharpe streak of ${streak}`}
    >
      {/* Warning triangle — decorative, aria-hidden */}
      <svg
        aria-hidden="true"
        focusable="false"
        className="h-3.5 w-3.5 shrink-0"
        viewBox="0 0 16 16"
        fill="currentColor"
      >
        <path d="M8 1.5a.5.5 0 0 1 .434.252l6.5 11A.5.5 0 0 1 14.5 13.5h-13a.5.5 0 0 1-.434-.748l6.5-11A.5.5 0 0 1 8 1.5ZM8 5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 1 0v-3A.5.5 0 0 0 8 5Zm0 6.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />
      </svg>
      {streak}
    </span>
  );
}

// ─── Row border logic ─────────────────────────────────────────────────────────

function rowBorderClass(credits: number, maxCredits: number): string {
  if (maxCredits === 0) return "border-transparent";
  const ratio = credits / maxCredits;
  if (ratio < 0.1) return "border-red-700";
  if (ratio > 0.8) return "border-emerald-700";
  return "border-transparent";
}

// ─── Main component ───────────────────────────────────────────────────────────

const sortedAgents = [...MOCK_AGENTS].sort((a, b) => b.sharpeScore - a.sharpeScore);

export default function AgentPerformance() {
  return (
    <Card className="p-0 overflow-hidden">
      {/* Table caption doubles as a visible heading */}
      <table className="w-full text-sm" aria-label="Agent performance leaderboard">
        <caption className="sr-only">
          Agents ranked by Sharpe score, highest first
        </caption>

        <thead>
          <tr className="border-b border-gray-800 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
            <th scope="col" className="px-6 py-3 w-8">
              #
            </th>
            <th scope="col" className="px-4 py-3">
              Agent
            </th>
            <th scope="col" className="px-4 py-3">
              Phase
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Sharpe
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              EMA Return
            </th>
            <th scope="col" className="px-4 py-3">
              Token Bucket
            </th>
            <th scope="col" className="px-4 py-3 text-center">
              Streak
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-gray-800/60">
          {sortedAgents.map((agent, index) => {
            const borderClass = rowBorderClass(agent.credits, agent.maxCredits);
            const isHighlighted = borderClass !== "border-transparent";
            const sharpePositive = agent.sharpeScore >= 0;

            return (
              <tr
                key={agent.id}
                className={`border-l-2 transition-colors hover:bg-gray-800/40 ${borderClass} ${
                  isHighlighted ? "bg-gray-800/20" : ""
                }`}
              >
                {/* Rank */}
                <td className="px-6 py-4 text-gray-500 font-mono text-xs">
                  {index + 1}
                </td>

                {/* Agent name + address */}
                <td className="px-4 py-4">
                  <p className="font-semibold text-gray-100">{agent.name}</p>
                  <p className="font-mono text-xs text-gray-500 mt-0.5">
                    {truncateAddress(agent.address)}
                  </p>
                </td>

                {/* Phase badge */}
                <td className="px-4 py-4">
                  {agent.phase === "vault" ? (
                    <Badge variant="positive">VAULT</Badge>
                  ) : (
                    <Badge variant="neutral">PROVING</Badge>
                  )}
                </td>

                {/* Sharpe score */}
                <td className="px-4 py-4 text-right">
                  <span
                    className={`text-lg font-bold tabular-nums ${
                      sharpePositive ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {sharpePositive ? "+" : ""}
                    {agent.sharpeScore.toFixed(2)}
                  </span>
                </td>

                {/* EMA return */}
                <td className="px-4 py-4 text-right">
                  <span
                    className={`tabular-nums font-medium ${
                      agent.emaReturn >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {formatEmaReturn(agent.emaReturn)}
                  </span>
                </td>

                {/* Token bucket */}
                <td className="px-4 py-4">
                  <TokenBucketBar
                    credits={agent.credits}
                    maxCredits={agent.maxCredits}
                    refillRate={agent.refillRate}
                  />
                </td>

                {/* Zero-Sharpe streak */}
                <td className="px-4 py-4 text-center">
                  <ZeroSharpeWarning streak={agent.zeroSharpeStreak} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
