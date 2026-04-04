"use client";

import type { CSSProperties } from "react";
import { MOCK_AGENTS } from "@/lib/mock-data";

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

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span style={{ color: "#787776" }}>
          {credits}/{maxCredits}
        </span>
        <span style={{ color: "#787776" }}>+{refillRate}/ep</span>
      </div>
      <div
        className="h-1.5 w-32 overflow-hidden rounded-full"
        style={{ backgroundColor: "#1c1b1b" }}
        role="meter"
        aria-valuenow={credits}
        aria-valuemin={0}
        aria-valuemax={maxCredits}
        aria-label={`Token bucket: ${credits} of ${maxCredits} credits`}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${fillPct}%`,
            backgroundColor: fillPct <= 10 ? "#FF5722" : "#00E5FF",
            boxShadow: fillPct > 10 ? "0 0 6px rgba(0,229,255,0.5)" : undefined,
          }}
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
      className="inline-flex items-center gap-1 text-xs font-medium"
      style={{ color: "#FF5722" }}
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

// ─── Phase badge ──────────────────────────────────────────────────────────────

interface PhaseBadgeProps {
  phase: "vault" | "proving";
}

function PhaseBadge({ phase }: PhaseBadgeProps) {
  if (phase === "vault") {
    return (
      <span
        className="inline-flex items-center rounded px-2 py-0.5 text-xs font-bold tracking-widest uppercase border"
        style={{
          color: "#00E5FF",
          borderColor: "rgba(0,229,255,0.35)",
          backgroundColor: "rgba(0,229,255,0.08)",
        }}
      >
        VAULT
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded px-2 py-0.5 text-xs font-bold tracking-widest uppercase border"
      style={{
        color: "#a78bfa",
        borderColor: "rgba(112,0,255,0.4)",
        backgroundColor: "rgba(112,0,255,0.1)",
      }}
    >
      PROVING
    </span>
  );
}

// ─── Rank badge ───────────────────────────────────────────────────────────────

function RankDisplay({ rank }: { rank: number }) {
  const isTop3 = rank <= 3;
  return (
    <span
      className="font-mono font-bold tabular-nums"
      style={{
        fontSize: isTop3 ? "1.1rem" : "0.875rem",
        color: isTop3 ? "#00E5FF" : "#787776",
        textShadow: isTop3 ? "0 0 10px rgba(0,229,255,0.5)" : undefined,
      }}
    >
      #{rank}
    </span>
  );
}

// ─── Row glow logic ────────────────────────────────────────────────────────────

function rowGlowStyle(credits: number, maxCredits: number): CSSProperties {
  if (maxCredits === 0) return {};
  const ratio = credits / maxCredits;
  if (ratio < 0.1) {
    return {
      boxShadow: "0 0 20px rgba(255,87,34,0.15)",
      borderLeft: "2px solid #FF5722",
    };
  }
  if (ratio > 0.8) {
    return {
      boxShadow: "0 0 20px rgba(0,229,255,0.15)",
      borderLeft: "2px solid rgba(0,229,255,0.5)",
    };
  }
  return { borderLeft: "2px solid transparent" };
}

// ─── Main component ───────────────────────────────────────────────────────────

const sortedAgents = [...MOCK_AGENTS].sort((a, b) => b.sharpeScore - a.sharpeScore);

export default function AgentPerformance() {
  return (
    <section
      aria-labelledby="leaderboard-heading"
      style={{ backgroundColor: "#0D0D0D" }}
      className="rounded-xl overflow-hidden"
    >
      {/* Header */}
      <div
        className="px-6 py-5 border-b"
        style={{ borderColor: "#1c1b1b" }}
      >
        <h2
          id="leaderboard-heading"
          className="text-2xl font-black uppercase tracking-[0.2em]"
          style={{
            color: "#E5E2E1",
            letterSpacing: "0.2em",
            textShadow: "0 0 30px rgba(0,229,255,0.1)",
          }}
        >
          LEADERBOARD
        </h2>
        <p className="text-xs mt-1 tracking-widest uppercase" style={{ color: "#787776" }}>
          Ranked by Sharpe Score
        </p>
      </div>

      {/* Table */}
      <table
        className="w-full text-sm"
        aria-label="Agent performance leaderboard"
        style={{ backgroundColor: "#0D0D0D" }}
      >
        <caption className="sr-only">
          Agents ranked by Sharpe score, highest first
        </caption>

        <thead>
          <tr
            className="text-left border-b"
            style={{ borderColor: "#1c1b1b" }}
          >
            <th
              scope="col"
              className="px-6 py-3 w-12 text-xs font-bold uppercase tracking-widest"
              style={{ color: "#787776" }}
            >
              Rank
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-xs font-bold uppercase tracking-widest"
              style={{ color: "#787776" }}
            >
              Agent
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-xs font-bold uppercase tracking-widest"
              style={{ color: "#787776" }}
            >
              Phase
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right text-xs font-bold uppercase tracking-widest"
              style={{ color: "#787776" }}
            >
              Sharpe
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right text-xs font-bold uppercase tracking-widest"
              style={{ color: "#787776" }}
            >
              EMA Return
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-xs font-bold uppercase tracking-widest"
              style={{ color: "#787776" }}
            >
              Token Bucket
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-center"
              style={{ color: "#787776" }}
            >
              Streak
            </th>
          </tr>
        </thead>

        <tbody>
          {sortedAgents.map((agent, index) => {
            const rank = index + 1;
            const glowStyle = rowGlowStyle(agent.credits, agent.maxCredits);
            const sharpePositive = agent.sharpeScore >= 0;

            return (
              <tr
                key={agent.id}
                className="border-b transition-colors"
                style={{
                  borderColor: "#1c1b1b",
                  ...glowStyle,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                    "rgba(255,255,255,0.03)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                    "transparent";
                }}
              >
                {/* Rank */}
                <td className="px-6 py-4">
                  <RankDisplay rank={rank} />
                </td>

                {/* Agent name + address */}
                <td className="px-4 py-4">
                  <p
                    className="font-semibold tracking-wide"
                    style={{ color: "#E5E2E1" }}
                  >
                    {agent.name}
                  </p>
                  <p
                    className="font-mono text-xs mt-0.5"
                    style={{ color: "#787776" }}
                  >
                    {truncateAddress(agent.address)}
                  </p>
                </td>

                {/* Phase badge */}
                <td className="px-4 py-4">
                  <PhaseBadge phase={agent.phase} />
                </td>

                {/* Sharpe score */}
                <td className="px-4 py-4 text-right">
                  <span
                    className="text-lg font-black tabular-nums"
                    style={{
                      color: sharpePositive ? "#00E5FF" : "#FF5722",
                      textShadow: sharpePositive
                        ? "0 0 12px rgba(0,229,255,0.4)"
                        : "0 0 12px rgba(255,87,34,0.4)",
                    }}
                  >
                    {sharpePositive ? "+" : ""}
                    {agent.sharpeScore.toFixed(2)}
                  </span>
                </td>

                {/* EMA return */}
                <td className="px-4 py-4 text-right">
                  <span
                    className="tabular-nums font-medium text-sm"
                    style={{
                      color: agent.emaReturn >= 0 ? "#00E5FF" : "#FF5722",
                    }}
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
    </section>
  );
}
