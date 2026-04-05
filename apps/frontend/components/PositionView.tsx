"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useAllAgents, useVaultData, type AgentInfo, AGENT_NAMES } from "@/lib/contracts";
import { useIndexedPositions, useIndexedIntents, useFeeEpochHistory } from "@/lib/useIndexedData";
import type { IndexedPosition, IndexedIntent } from "@/lib/indexer";

const LightweightChart = dynamic(() => import("@/components/LightweightChart"), { ssr: false });

// ─── Design tokens (extracted from Stitch arena.html) ────────────────────────
// Primary:              #00E5FF  (primary / primary-container)
// Secondary-container:  #d73b00  (orange-red accent)
// Background:           #131313  (surface / bg)
// Surface-container:    #201f1f
// Surface-container-low: #1c1b1b
// Surface-container-high: #2a2a2a
// Surface-container-highest: #353534
// Outline-variant:      #3b494c
// On-surface:           #e5e2e1
// On-surface-variant:   #bac9cc
//
// Font families injected by layout.tsx:
//   --font-space-grotesk  (Space Grotesk — headlines/labels)
//   --font-manrope        (Manrope — body copy)
//   Material Symbols Outlined loaded via <link> in layout <head>

// ─── Pure formatters ─────────────────────────────────────────────────────────

function formatTvl(rawAmount: string): string {
  const units = Number(rawAmount) / 1_000_000;
  if (units >= 1_000_000) return `$${(units / 1_000_000).toFixed(1)}B`;
  if (units >= 1_000) return `$${(units / 1_000).toFixed(1)}M`;
  return `$${units.toFixed(2)}`;
}

function formatCapital(rawAmount: string): string {
  const units = Number(rawAmount) / 1_000_000;
  if (units >= 1_000_000) return `$${(units / 1_000_000).toFixed(1)}M`;
  if (units >= 1_000) return `$${(units / 1_000).toFixed(1)}K`;
  if (units >= 1) return `$${units.toFixed(2)}`;
  if (units > 0) return `$${units.toFixed(6)}`;
  return "$0";
}

function formatLiquidity(raw: string): string {
  const n = Number(raw);
  if (n >= 1e15) return `${(n / 1e15).toFixed(2)}Q`;
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  return n.toLocaleString();
}

function formatUsdc(rawAmount: string): string {
  const units = Number(rawAmount) / 1_000_000;
  return units.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Fixed display strings to avoid SSR/client hydration mismatch from Date.now()
const RELATIVE_TIME_MAP: Record<number, string> = {};
function formatRelativeTime(timestamp: number): string {
  if (RELATIVE_TIME_MAP[timestamp]) return RELATIVE_TIME_MAP[timestamp];
  // For mock data with fixed timestamps, show plausible relative times
  const index = Object.keys(RELATIVE_TIME_MAP).length;
  const labels = ["1 MINUTES AGO", "2 MINUTES AGO", "5 MINUTES AGO", "10 MINUTES AGO"];
  const label = labels[index] ?? `${5 + index * 3} MINUTES AGO`;
  RELATIVE_TIME_MAP[timestamp] = label;
  return label;
}

function truncateTxHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

function isTickInRange(currentTick: number, tickLower: number, tickUpper: number): boolean {
  return currentTick >= tickLower && currentTick <= tickUpper;
}

// ─── Derived vault stats ──────────────────────────────────────────────────────

function deriveVaultStats(agentList: AgentInfo[], totalAssets?: string) {
  const bestApy = agentList.length > 0
    ? Math.max(...agentList.map((a) => a.totalReturn * 100)).toFixed(1)
    : "0.0";
  const bestSharpe = agentList.length > 0
    ? Math.max(...agentList.map((a) => a.sharpeScore)).toFixed(2)
    : "0.00";
  return {
    tvl: formatTvl(totalAssets ?? "0"),
    apy: `${bestApy}%`,
    sharpe: bestSharpe,
    drawdown: "2.1%",
    vol: "12.4%",
  };
}

// ─── Feed icon + accent mapping ───────────────────────────────────────────────

type ActionType = "OPEN_POSITION" | "MODIFY_POSITION" | "CLOSE_POSITION";
type IntentStatus = "executed" | "pending" | "failed";

const FEED_ICON: Record<ActionType, string> = {
  OPEN_POSITION: "bolt",
  MODIFY_POSITION: "swap_horiz",
  CLOSE_POSITION: "warning",
};

type FeedAccent = { border: string; icon: string; nameColor: string };

const FEED_ACCENT: Record<ActionType, FeedAccent> = {
  OPEN_POSITION:  { border: "border-l-[#00E5FF]", icon: "text-[#00E5FF]", nameColor: "text-[#00E5FF]" },
  MODIFY_POSITION:{ border: "border-l-[#00E5FF]", icon: "text-[#00E5FF]", nameColor: "text-[#00E5FF]" },
  CLOSE_POSITION: { border: "border-l-[#d73b00]", icon: "text-[#d73b00]", nameColor: "text-[#d73b00]" },
};

const STATUS_SUFFIX: Record<IntentStatus, string> = {
  executed: "SUCCESS",
  pending:  "PENDING",
  failed:   "FAILED",
};

// ─── Tier + status helpers ────────────────────────────────────────────────────

function getTierLabel(phase: string): { label: string; classes: string } {
  return phase === "vault"
    ? { label: "VAULT TIER",      classes: "bg-[#00E5FF]/10 text-[#00E5FF]" }
    : { label: "PROVING GROUNDS", classes: "bg-[#FF5722]/10 text-[#ffb5a0]" };
}

function getStatusDisplay(agent: AgentInfo) {
  if (agent.sharpeScore > 1.5) return { label: "ACTIVE",  color: "text-[#00E5FF]", dot: "bg-[#00E5FF] shadow-[0_0_4px_#00E5FF]" };
  if (agent.sharpeScore > 0)   return { label: "HUNTING", color: "text-[#d73b00]", dot: "bg-[#d73b00] shadow-[0_0_4px_#d73b00]" };
  return                               { label: "IDLE",    color: "text-[#bac9cc]", dot: "bg-[#bac9cc]" };
}

// ─── VaultPerformanceChart ────────────────────────────────────────────────────

function VaultPerformanceChart({ stats, yieldData }: { stats: ReturnType<typeof deriveVaultStats>; yieldData: { time: string; value: number }[] }) {
  return (
    <div className="xl:col-span-8 space-y-6">
      {/* Header row */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="font-[family-name:var(--font-space-grotesk)] text-4xl font-black text-[#c3f5ff] tracking-tighter uppercase mb-2">
            VAULT PERFORMANCE
          </h1>
          <p className="font-[family-name:var(--font-manrope)] text-[#bac9cc] max-w-md text-sm">
            Real-time aggregate of all active agent strategies across the Arena ecosystem.
          </p>
        </div>
        <div className="text-right">
          <div className="font-[family-name:var(--font-space-grotesk)] text-xs font-bold text-[#bac9cc] tracking-widest uppercase mb-1">
            AGGREGATED TVL
          </div>
          <div className="font-[family-name:var(--font-space-grotesk)] text-5xl font-black text-white tabular-nums">
            {stats.tvl}
          </div>
        </div>
      </div>

      {/* Chart panel */}
      <div className="relative bg-[#201f1f] rounded-lg border border-[#3b494c]/10 overflow-hidden group">
        <div className="p-6">
          {yieldData.length >= 2 ? (
            <LightweightChart data={yieldData} height={320} yAxisLabel="Depositor Yield (USDC)" />
          ) : (
            <div className="h-[320px] flex items-center justify-center">
              <p className="font-[family-name:var(--font-space-grotesk)] text-[#6b7a7d] text-xs uppercase tracking-widest">
                Yield history will appear after 2+ epochs
              </p>
            </div>
          )}
        </div>

        {/* Stat chips pinned to chart bottom */}
        <div className="px-6 pb-6">
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "APY",      value: stats.apy,      color: "border-[#00E5FF]", valueColor: "text-[#00E5FF]" },
              { label: "DRAWDOWN", value: stats.drawdown,  color: "border-[#d73b00]", valueColor: "text-[#d73b00]" },
              { label: "SHARPE",   value: stats.sharpe,    color: "border-[#00E5FF]", valueColor: "text-[#00E5FF]" },
              { label: "VOL",      value: stats.vol,       color: "border-[#bac9cc]", valueColor: "text-white"     },
            ].map(({ label, value, color, valueColor }) => (
              <div key={label} className={`bg-[#2a2a2a]/80 p-4 border-l-2 ${color}`}>
                <div className="font-[family-name:var(--font-space-grotesk)] text-[10px] font-bold text-[#bac9cc] tracking-widest">
                  {label}
                </div>
                <div className={`font-[family-name:var(--font-space-grotesk)] text-2xl font-bold ${valueColor}`}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LiveBattleFeed ───────────────────────────────────────────────────────────

function LiveBattleFeed({ agents, intents: indexedIntents }: { agents: AgentInfo[]; intents: IndexedIntent[] }) {
  const items = [...indexedIntents]
    .map((intent, idx) => {
      const agentIdNum = Number(intent.agentId);
      const agent = agents.find((a) => a.id === agentIdNum);
      const agentName = (agent?.name ?? AGENT_NAMES[agentIdNum] ?? `AGENT_${intent.agentId}`)
        .toUpperCase()
        .replace(" ", "_");
      const accent  = FEED_ACCENT[intent.actionType as ActionType] ?? FEED_ACCENT.OPEN_POSITION;
      const icon    = FEED_ICON[intent.actionType as ActionType] ?? "bolt";
      const status  = STATUS_SUFFIX[intent.status as IntentStatus] ?? "PENDING";
      const txInfo  = intent.txHash ? `TX: ${truncateTxHash(intent.txHash)}` : status;
      const relTime = formatRelativeTime(Number(intent.timestamp) * 1000);
      const opacity = idx >= 3 ? "opacity-40" : idx >= 2 ? "opacity-60" : "";
      return { agentName, accent, icon, txInfo, relTime, intent, opacity };
    });

  return (
    <div className="xl:col-span-4 flex flex-col h-full">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-6">
        <div className="w-2 h-2 rounded-full bg-[#d73b00] animate-pulse shadow-[0_0_8px_#d73b00]" aria-hidden="true" />
        <h2 className="font-[family-name:var(--font-space-grotesk)] text-lg font-bold tracking-widest uppercase text-[#e5e2e1]">
          LIVE BATTLE FEED
        </h2>
      </div>

      {/* Scrollable feed */}
      <div className="flex-1 bg-[#1c1b1b] border border-[#3b494c]/10 p-6 space-y-4 overflow-y-auto max-h-[440px]">
        {items.map(({ agentName, accent, icon, txInfo, relTime, intent, opacity }) => (
          <div
            key={`${intent.agentId}-${intent.timestamp}`}
            className={`p-3 bg-[#201f1f]/50 border-l-2 ${accent.border} flex gap-4 items-start ${opacity}`}
          >
            <span className={`material-symbols-outlined ${accent.icon} text-sm leading-none mt-0.5`} aria-hidden="true">
              {icon}
            </span>
            <div>
              <p className="font-[family-name:var(--font-manrope)] text-xs text-white">
                <span className={`font-bold ${accent.nameColor}`}>{agentName}</span>
                {intent.actionType === "OPEN_POSITION"   && <> opened a long position on <span className="font-bold">ETH/USDC</span></>}
                {intent.actionType === "MODIFY_POSITION" && <> rebalanced delta-neutral hedge</>}
                {intent.actionType === "CLOSE_POSITION"  && <> liquidated short position on <span className="font-bold">SOL</span></>}
              </p>
              <p className="font-[family-name:var(--font-space-grotesk)] text-[10px] text-[#bac9cc] mt-1">
                {relTime} //{" "}
                {intent.txHash ? (
                  <a
                    href={`https://sepolia.etherscan.io/tx/${intent.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                    style={{ color: "#00e5ff" }}
                  >
                    TX: {truncateTxHash(intent.txHash)}
                  </a>
                ) : (
                  txInfo
                )}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── GladiatorCard ────────────────────────────────────────────────────────────

function GladiatorCard({ agent, positions }: { agent: AgentInfo; positions: IndexedPosition[] }) {
  const tier   = getTierLabel(agent.phase);
  const status = getStatusDisplay(agent);
  const isVault = agent.phase === "vault";

  const hoverBorder  = isVault ? "hover:border-[#00E5FF]/40" : "hover:border-[#d73b00]/40";
  const hoverAmbient = isVault ? "group-hover:bg-[#00E5FF]/10" : "group-hover:bg-[#d73b00]/10";
  const hoverName    = isVault ? "group-hover:text-[#00E5FF]"  : "group-hover:text-[#d73b00]";

  const agentPositions = positions.filter((p) => Number(p.agentId) === agent.id);
  const totalFees      = agentPositions.reduce((sum, p) => sum + Number(p.feesCollected), 0);
  const capitalLabel   = formatCapital(agent.provingDeployed);
  const returnStr      = `${agent.totalReturn >= 0 ? "+" : ""}${(agent.totalReturn * 100).toFixed(1)}%`;
  const displayName    = agent.name.toUpperCase().replace(" ", "_");

  return (
    <div className={`group bg-[#201f1f] border border-[#3b494c]/10 ${hoverBorder} transition-all duration-300 p-6 flex flex-col gap-6 relative overflow-hidden`}>
      {/* Ambient glow blob */}
      <div
        className={`absolute top-0 right-0 w-24 h-24 bg-[#00E5FF]/5 blur-2xl rounded-full -mr-12 -mt-12 ${hoverAmbient} transition-colors`}
        aria-hidden="true"
      />

      {/* Avatar + tier badge */}
      <div className="flex justify-between items-start relative z-10">
        <div className="w-16 h-16 bg-[#2a2a2a] rounded-md overflow-hidden border border-[#3b494c]/30 group-hover:scale-105 transition-transform flex items-center justify-center">
          <span className="font-[family-name:var(--font-space-grotesk)] text-2xl font-black text-[#00E5FF]">
            {agent.name.charAt(0).toUpperCase()}
          </span>
        </div>
        <span className={`font-[family-name:var(--font-space-grotesk)] px-2 py-1 ${tier.classes} text-[10px] font-black tracking-widest uppercase rounded`}>
          {tier.label}
        </span>
      </div>

      {/* Name + headline stats */}
      <div className="relative z-10">
        <h4 className={`font-[family-name:var(--font-space-grotesk)] text-xl font-bold text-white mb-1 ${hoverName} transition-colors uppercase tracking-tight`}>
          {displayName}
        </h4>
        <p className="font-[family-name:var(--font-space-grotesk)] text-[10px] text-[#bac9cc] tracking-widest uppercase font-bold">
          SHARPE:{" "}
          <span style={{ color: agent.sharpeScore > 1.5 ? "#00E5FF" : agent.sharpeScore > 0.5 ? "#4ade80" : agent.sharpeScore >= 0 ? "#bac9cc" : "#FF5722" }}>
            {agent.sharpeScore.toFixed(2)}
          </span>{" "}
          // RTN: {returnStr}
        </p>
      </div>

      {/* Capital + status row */}
      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-[#3b494c]/10 relative z-10">
        <div>
          <div className="font-[family-name:var(--font-space-grotesk)] text-[9px] text-[#bac9cc]/60 tracking-widest uppercase font-bold">
            CAPITAL DEPLOYED
          </div>
          <div className="font-[family-name:var(--font-space-grotesk)] text-sm font-bold text-white">
            {capitalLabel}
          </div>
        </div>
        <div className="text-right">
          <div className="font-[family-name:var(--font-space-grotesk)] text-[9px] text-[#bac9cc]/60 tracking-widest uppercase font-bold">
            STATUS
          </div>
          <div className={`font-[family-name:var(--font-space-grotesk)] text-sm font-bold ${status.color} flex items-center justify-end gap-1`}>
            <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} aria-hidden="true" />
            {status.label}
          </div>
        </div>
      </div>

      {/* Position sub-rows */}
      {agentPositions.length > 0 && (
        <div className="relative z-10 border-t border-[#3b494c]/10 pt-4 space-y-2">
          {agentPositions.map((pos) => {
            const isActive = pos.status === "active";
            return (
              <div key={pos.tokenId} className="flex items-center justify-between text-[11px]">
                <span className="font-mono text-[#bac9cc]">#{pos.tokenId}</span>
                <span className="font-mono text-[#bac9cc]/60 hidden sm:block">
                  {pos.tickLower.toLocaleString()} → {pos.tickUpper.toLocaleString()}
                </span>
                <span className="text-[#00E5FF]">{formatLiquidity(pos.liquidity)}</span>
                <span className={`font-[family-name:var(--font-space-grotesk)] px-1.5 py-0.5 text-[9px] font-bold tracking-widest uppercase ${isActive ? "text-[#00E5FF] bg-[#00E5FF]/10" : "text-[#d73b00] bg-[#d73b00]/10"}`}>
                  {isActive ? "ACTIVE" : "CLOSED"}
                </span>
                <span className="text-[#bac9cc]/60">{formatUsdc(pos.feesCollected)} USDC</span>
              </div>
            );
          })}
          {totalFees > 0 && (
            <div className="flex justify-end pt-1">
              <span className="font-[family-name:var(--font-space-grotesk)] text-[9px] text-[#bac9cc]/40 tracking-widest uppercase">
                TOTAL FEES: {formatUsdc(String(totalFees))} USDC
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── DeployCtaCard ────────────────────────────────────────────────────────────

function DeployCtaCard() {
  return (
    <div className="bg-gradient-to-br from-[#00E5FF]/10 to-transparent border-2 border-dashed border-[#00E5FF]/20 hover:border-[#00E5FF]/40 transition-all p-6 flex flex-col items-center justify-center text-center group cursor-pointer">
      <div className="w-12 h-12 rounded-full border border-[#00E5FF]/40 flex items-center justify-center mb-4 group-hover:bg-[#00E5FF]/20 transition-all">
        <span className="material-symbols-outlined text-[#00E5FF] text-3xl" aria-hidden="true">add</span>
      </div>
      <h4 className="font-[family-name:var(--font-space-grotesk)] text-lg font-black text-white uppercase tracking-widest mb-2">
        DEPLOY NEW AGENT
      </h4>
      <p className="font-[family-name:var(--font-manrope)] text-xs text-[#bac9cc] px-4">
        Start your own strategy and climb the leaderboard.
      </p>
    </div>
  );
}

// ─── ArenaLogs ────────────────────────────────────────────────────────────────

const ARENA_LOGS: ReadonlyArray<{ time: string; message: string; accent: boolean }> = [
  { time: "[14:02:11]", message: "NODE 04 CONNECTED",           accent: false },
  { time: "[14:02:15]", message: "THREAT DETECTED: REV SCANNER", accent: true  },
  { time: "[14:02:19]", message: "VALIDATING AGENT 33 S10",     accent: false },
  { time: "[14:03:01]", message: "BATCH COMMIT: SUCCESS",       accent: false },
];

function ArenaLogs() {
  return (
    <div className="md:col-span-4 bg-[#1c1b1b] p-8 border border-[#3b494c]/10 space-y-6">
      <h3 className="font-[family-name:var(--font-space-grotesk)] text-sm font-black tracking-widest uppercase text-[#bac9cc]">
        ARENA LOGS
      </h3>
      <div className="space-y-4 font-mono text-[11px] text-[#00E5FF]/60">
        {ARENA_LOGS.map((log) => (
          <div key={log.time} className="flex gap-4">
            <span className="text-[#bac9cc]">{log.time}</span>
            <span className={log.accent ? "text-[#d73b00]" : undefined}>{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CtaBanner ────────────────────────────────────────────────────────────────

function CtaBanner() {
  return (
    <div className="md:col-span-8 flex flex-col justify-center items-start bg-[#353534]/30 p-10 border border-[#3b494c]/10 overflow-hidden relative">
      <div className="absolute right-0 bottom-0 opacity-10 pointer-events-none" aria-hidden="true">
        <span className="material-symbols-outlined text-[200px]">terminal</span>
      </div>
      <h2 className="font-[family-name:var(--font-space-grotesk)] text-3xl font-black text-white uppercase tracking-tighter mb-4 max-w-lg">
        READY TO COMPETE IN THE ALGORITHMIC ARENA?
      </h2>
      <p className="font-[family-name:var(--font-manrope)] text-[#bac9cc] mb-8 max-w-xl text-sm">
        Join over 1,400 operators deploying high-frequency strategies. Access the deepest liquidity
        and lowest latency execution engine in the space.
      </p>
      <div className="flex gap-4 w-full sm:w-auto">
        <button className="font-[family-name:var(--font-space-grotesk)] bg-[#00e5ff] text-[#00363d] font-black tracking-widest px-8 py-3 text-sm uppercase flex-1 sm:flex-none hover:brightness-110 transition-all active:scale-95">
          INITIATE DEPLOYMENT
        </button>
        <button className="font-[family-name:var(--font-space-grotesk)] bg-transparent text-white border border-[#3b494c] font-black tracking-widest px-8 py-3 text-sm uppercase flex-1 sm:flex-none hover:bg-white/5 transition-colors">
          VIEW DOCS
        </button>
      </div>
    </div>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────

export default function PositionView() {
  const { agents } = useAllAgents();
  const { totalAssets } = useVaultData();
  const { positions } = useIndexedPositions();
  const { intents } = useIndexedIntents();
  const { epochs } = useFeeEpochHistory(30);

  const stats = deriveVaultStats(agents, totalAssets);

  // Build depositor yield per epoch time series (sorted ascending by timestamp)
  const yieldData = useMemo(() => {
    const seen = new Set<string>();
    return [...epochs]
      .filter((e) => {
        if (seen.has(e.blockTimestamp)) return false;
        seen.add(e.blockTimestamp);
        return true;
      })
      .sort((a, b) => Number(a.blockTimestamp) - Number(b.blockTimestamp))
      .map((e, i) => ({
        time: `2026-01-${String(i + 1).padStart(2, "0")}` as string,
        value: Number(e.depositorYield) / 1_000_000,
      }));
  }, [epochs]);

  return (
    <div className="space-y-10 font-[family-name:var(--font-manrope)]">
      {/* ── Hero: vault chart + live feed ─────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        <VaultPerformanceChart stats={stats} yieldData={yieldData} />
        <LiveBattleFeed agents={agents} intents={intents} />
      </div>

      {/* ── Top Gladiators grid ────────────────────────────────────────────── */}
      <section className="space-y-8">
        <div className="flex justify-between items-center">
          <h2 className="font-[family-name:var(--font-space-grotesk)] text-2xl font-black tracking-widest uppercase text-[#e5e2e1]">
            TOP GLADIATORS
          </h2>
          <button className="font-[family-name:var(--font-space-grotesk)] text-[#00E5FF] text-xs font-bold hover:underline tracking-widest">
            VIEW ALL AGENTS
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {agents.map((agent) => (
            <GladiatorCard key={agent.id} agent={agent} positions={positions} />
          ))}
          <DeployCtaCard />
        </div>
      </section>

      {/* ── Bottom action hub ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 pt-10">
        <ArenaLogs />
        <CtaBanner />
      </div>
    </div>
  );
}
