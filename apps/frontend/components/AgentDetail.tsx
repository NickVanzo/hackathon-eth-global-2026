"use client";

import { useState } from "react";
import { MOCK_AGENTS, MOCK_POSITIONS, MOCK_INTENTS } from "@/lib/mock-data";

// Chart data for the historical performance line chart (7 days)
const CHART_POINTS = [
  { x: 0, y: 80, label: "AUG 12" },
  { x: 10, y: 75, label: "AUG 13" },
  { x: 20, y: 85, label: "AUG 14" },
  { x: 30, y: 60, label: "AUG 15" },
  { x: 40, y: 65, label: "AUG 16" },
  { x: 50, y: 45, label: "AUG 17" },
  { x: 60, y: 55, label: "AUG 18" },
  { x: 70, y: 30, label: "AUG 19" },
  { x: 80, y: 35, label: "AUG 20" },
  { x: 90, y: 20, label: "AUG 21" },
  { x: 100, y: 25, label: "TODAY" },
];

function buildSvgPath(points: typeof CHART_POINTS): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`)
    .join(" ");
}

function buildFillPath(points: typeof CHART_POINTS): string {
  const line = buildSvgPath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L${last.x},100 L${first.x},100 Z`;
}

type TimeRange = "1D" | "1W" | "1M";

interface AgentDetailProps {
  agentId?: number;
}

export default function AgentDetail({ agentId = 1 }: AgentDetailProps) {
  const [activeRange, setActiveRange] = useState<TimeRange>("1W");

  const agent = MOCK_AGENTS.find((a) => a.id === agentId) ?? MOCK_AGENTS[0];
  const positions = MOCK_POSITIONS.filter((p) => p.agentId === agent.id);
  const intents = MOCK_INTENTS.filter((i) => i.agentId === agent.id);

  const creditsPercent = Math.round((agent.credits / agent.maxCredits) * 100);
  const sharpePercent = Math.min(100, Math.round((agent.sharpeScore / 4) * 100));
  const commissions = (agent.commissionYield * 1_000_000).toFixed(2);

  return (
    <div className="space-y-8">
      {/* Header Status Bar */}
      <section
        className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-l-4 pl-6 py-2"
        style={{ borderLeftColor: "#00e5ff" }}
      >
        <div>
          <span
            className="text-xs uppercase tracking-[0.3em]"
            style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
          >
            Tactical Overview
          </span>
          <h1
            className="text-5xl font-black tracking-tighter mt-1"
            style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#e5e2e1" }}
          >
            AGENT ID:{" "}
            <span style={{ color: "#00e5ff" }}>X-{String(agent.id).padStart(2, "0")}</span>
          </h1>
          <div className="flex items-center gap-4 mt-4">
            <span
              className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold tracking-widest border"
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                backgroundColor: "#2a2a2a",
                color: "#00daf3",
                borderColor: "rgba(0,218,243,0.2)",
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ backgroundColor: "#00e5ff", boxShadow: "0 0 8px #00E5FF" }}
              />
              PHASE: {agent.phase.toUpperCase()}
            </span>
            <span
              className="text-xs"
              style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
            >
              EMA SHARPE:{" "}
              <span
                className="font-black"
                style={{ color: "#e5e2e1" }}
              >
                {agent.sharpeScore.toFixed(2)}
              </span>
            </span>
          </div>
        </div>

        <div className="flex gap-4">
          <button
            type="button"
            className="px-6 py-3 border text-xs tracking-widest uppercase transition-all"
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              borderColor: "rgba(215,59,0,0.3)",
              color: "#ffb5a0",
            }}
          >
            Pause Agent
          </button>
          <button
            type="button"
            className="px-6 py-3 text-xs font-black tracking-widest rounded-md uppercase transition-all"
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              backgroundColor: "#00e5ff",
              color: "#00363d",
              boxShadow: "0 0 30px rgba(0,229,255,0.2)",
            }}
          >
            Claim Commissions
          </button>
        </div>
      </section>

      {/* Metrics Bento Grid */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Sharpe Ratio EMA */}
        <div
          className="md:col-span-1 p-6 rounded-lg relative overflow-hidden group"
          style={{ backgroundColor: "#1c1b1b" }}
        >
          <div className="absolute top-0 right-0 p-3 pointer-events-none">
            <span
              className="material-symbols-outlined transition-colors"
              style={{ fontSize: 36, color: "rgba(0,229,255,0.2)" }}
            >
              monitoring
            </span>
          </div>
          <p
            className="text-xs uppercase tracking-widest mb-4"
            style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
          >
            Sharpe Ratio EMA
          </p>
          <div className="flex items-baseline gap-2">
            <span
              className="text-4xl font-bold"
              style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#e5e2e1" }}
            >
              {agent.sharpeScore.toFixed(2)}
            </span>
            <span
              className="text-xs"
              style={{ color: agent.sharpeScore > 0 ? "#4ade80" : "#f87171" }}
            >
              {agent.sharpeScore > 0 ? "+" : ""}
              {(agent.sharpeScore * 0.04).toFixed(2)}
            </span>
          </div>
          <div className="mt-6 space-y-2">
            <div
              className="flex justify-between text-[10px] uppercase"
              style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
            >
              <span>Threshold</span>
              <span>Target</span>
            </div>
            <div
              className="w-full h-1 rounded-full overflow-hidden"
              style={{ backgroundColor: "#353534" }}
            >
              <div
                className="h-full"
                style={{
                  width: `${sharpePercent}%`,
                  backgroundColor: "#00e5ff",
                  boxShadow: "0 0 8px #00E5FF",
                }}
              />
            </div>
          </div>
        </div>

        {/* Token Buckets */}
        <div
          className="md:col-span-1 p-6 rounded-lg border"
          style={{ backgroundColor: "#1c1b1b", borderColor: "rgba(59,73,76,0.1)" }}
        >
          <p
            className="text-xs uppercase tracking-widest mb-4"
            style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
          >
            Token Buckets
          </p>
          <div className="space-y-6">
            <div>
              <div className="flex justify-between mb-1.5">
                <span
                  className="text-[10px]"
                  style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#e5e2e1" }}
                >
                  CREDITS
                </span>
                <span
                  className="text-[10px]"
                  style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#00e5ff" }}
                >
                  {agent.credits} / {agent.maxCredits}
                </span>
              </div>
              <div
                className="w-full h-1 rounded-full"
                style={{ backgroundColor: "#353534" }}
              >
                <div
                  className="h-full"
                  style={{
                    width: `${creditsPercent}%`,
                    backgroundColor: "#00e5ff",
                  }}
                />
              </div>
            </div>
            <div
              className="pt-2 border-t"
              style={{ borderColor: "rgba(59,73,76,0.1)" }}
            >
              <div className="flex justify-between items-center">
                <span
                  className="text-[10px] uppercase"
                  style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
                >
                  Refill Rate
                </span>
                <span
                  className="text-xs font-bold"
                  style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#e5e2e1" }}
                >
                  {agent.refillRate} C/HR
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Accrued Commissions */}
        <div
          className="md:col-span-2 p-6 rounded-lg border-t"
          style={{
            background: "linear-gradient(to bottom right, #2a2a2a, #1c1b1b)",
            borderTopColor: "rgba(0,229,255,0.2)",
          }}
        >
          <div className="flex justify-between items-start">
            <div>
              <p
                className="text-xs uppercase tracking-widest mb-1"
                style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
              >
                Accrued Commissions
              </p>
              <h2
                className="text-5xl font-black tracking-tighter"
                style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#e5e2e1" }}
              >
                {Number(commissions).toLocaleString("en-US", { minimumFractionDigits: 2 })}{" "}
                <span className="text-xl" style={{ color: "#00e5ff" }}>
                  USDC
                </span>
              </h2>
            </div>
            <div className="text-right">
              <p
                className="text-xs uppercase tracking-widest mb-1"
                style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
              >
                Elite Multiplier
              </p>
              <span
                className="text-lg font-bold"
                style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#ffb5a0" }}
              >
                x1.25
              </span>
            </div>
          </div>
          <div className="mt-8 flex gap-4 overflow-x-auto pb-2">
            {[
              { label: "Last 24h", value: "+$412.00", color: "#00e5ff" },
              { label: "Average Fee", value: "0.12%", color: "#e5e2e1" },
              { label: "Network Load", value: "LOW", color: "#e5e2e1" },
            ].map((item) => (
              <div
                key={item.label}
                className="flex-shrink-0 px-4 py-2 rounded border"
                style={{
                  backgroundColor: "rgba(53,53,52,0.4)",
                  borderColor: "rgba(59,73,76,0.2)",
                }}
              >
                <p
                  className="text-[10px] uppercase mb-1"
                  style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
                >
                  {item.label}
                </p>
                <p
                  className="text-sm font-bold"
                  style={{ fontFamily: "'Space Grotesk', sans-serif", color: item.color }}
                >
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Main Interactive Area */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Historical Returns Chart */}
        <div className="lg:col-span-2 space-y-6">
          <div
            className="p-6 rounded-lg border h-[400px] flex flex-col relative overflow-hidden"
            style={{ backgroundColor: "#201f1f", borderColor: "rgba(59,73,76,0.05)" }}
          >
            <div className="flex justify-between items-center mb-8 relative z-10">
              <div>
                <h3
                  className="text-lg font-bold tracking-tight"
                  style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#e5e2e1" }}
                >
                  HISTORICAL PERFORMANCE
                </h3>
                <p
                  className="text-xs uppercase tracking-widest"
                  style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
                >
                  Aggregate return on capital since deployment
                </p>
              </div>
              <div className="flex gap-2">
                {(["1D", "1W", "1M"] as TimeRange[]).map((range) => (
                  <button
                    key={range}
                    type="button"
                    onClick={() => setActiveRange(range)}
                    className="px-3 py-1 text-[10px] tracking-widest rounded border cursor-pointer transition-all"
                    style={{
                      fontFamily: "'Space Grotesk', sans-serif",
                      backgroundColor:
                        activeRange === range ? "#00e5ff" : "#353534",
                      color: activeRange === range ? "#00363d" : "#e5e2e1",
                      borderColor:
                        activeRange === range ? "#00e5ff" : "rgba(59,73,76,0.3)",
                    }}
                  >
                    {range}
                  </button>
                ))}
              </div>
            </div>

            {/* SVG Chart */}
            <div className="flex-1 relative">
              <svg
                className="absolute inset-0 w-full h-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="agentChartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#00E5FF" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#00E5FF" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {/* Fill area */}
                <path
                  d={buildFillPath(CHART_POINTS)}
                  fill="url(#agentChartGradient)"
                />
                {/* Line */}
                <path
                  d={buildSvgPath(CHART_POINTS)}
                  fill="none"
                  stroke="#00E5FF"
                  strokeWidth="1.5"
                />
              </svg>

              {/* Horizontal grid lines */}
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-20">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="w-full border-t"
                    style={{ borderColor: "rgba(59,73,76,0.3)" }}
                  />
                ))}
              </div>
            </div>

            {/* X-axis labels */}
            <div
              className="mt-4 flex justify-between text-[10px] uppercase tracking-widest"
              style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
            >
              {["AUG 12", "AUG 13", "AUG 14", "AUG 15", "AUG 16", "AUG 17", "TODAY"].map(
                (label) => (
                  <span key={label}>{label}</span>
                )
              )}
            </div>
          </div>
        </div>

        {/* Agent Status & Details */}
        <div className="lg:col-span-1 space-y-6">
          {/* iNFT Ownership Card */}
          <div
            className="p-6 rounded-lg border"
            style={{
              backgroundColor: "#2a2a2a",
              borderColor: "rgba(0,229,255,0.1)",
            }}
          >
            <h4
              className="text-xs uppercase tracking-widest mb-6 flex items-center gap-2"
              style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                database
              </span>
              iNFT Core Protocol
            </h4>
            <div className="space-y-4">
              {[
                { label: "TOKEN TYPE", value: "ERC-721i", color: "#e5e2e1" },
                { label: "CONTRACT", value: "0x9a...f42c", color: "#00e5ff" },
                { label: "RARITY", value: "LEGENDARY", color: "#ffb5a0" },
              ].map((row) => (
                <div key={row.label} className="flex justify-between items-center">
                  <span
                    className="text-[10px]"
                    style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
                  >
                    {row.label}
                  </span>
                  <span
                    className="text-xs font-bold"
                    style={{ fontFamily: "'Space Grotesk', sans-serif", color: row.color }}
                  >
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
            <div
              className="mt-8 pt-6 border-t"
              style={{ borderColor: "rgba(59,73,76,0.1)" }}
            >
              <div className="flex items-center gap-4">
                <div
                  className="w-12 h-12 rounded flex items-center justify-center border"
                  style={{
                    backgroundColor: "#353534",
                    borderColor: "rgba(59,73,76,0.3)",
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 20, color: "#00e5ff" }}
                  >
                    security
                  </span>
                </div>
                <div>
                  <p
                    className="text-[10px] uppercase"
                    style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
                  >
                    Phase Transition
                  </p>
                  <p
                    className="text-xs font-bold"
                    style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#e5e2e1" }}
                  >
                    VAULT LOCK in 42h
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Live Event Log */}
          <div
            className="p-5 rounded-lg border font-mono text-[10px]"
            style={{
              backgroundColor: "#0e0e0e",
              borderColor: "rgba(59,73,76,0.1)",
            }}
          >
            <div className="flex items-center gap-2 mb-4" style={{ color: "#bac9cc" }}>
              <span
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ backgroundColor: "#d73b00" }}
              />
              LIVE EVENT LOG
            </div>
            <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
              {[
                {
                  time: "14:20:11",
                  msg: "EXECUTE ORDER: BUY 0.42 ETH @ 2452.1",
                  type: "primary",
                },
                {
                  time: "14:18:05",
                  msg: "REBALANCING: VECTOR DELTA adjusted to 0.82",
                  type: "primary",
                },
                {
                  time: "14:15:32",
                  msg: "BUCKET LOW: Triggering refill protocol...",
                  type: "warning",
                },
                {
                  time: "14:12:44",
                  msg: "DATA SYNC: Global sentiment calibrated",
                  type: "primary",
                },
                {
                  time: "14:10:01",
                  msg: "HEARTBEAT: All systems operational",
                  type: "primary",
                },
                ...(intents.map((intent) => ({
                  time: new Date(intent.timestamp).toLocaleTimeString("en-US", {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  }),
                  msg: `${intent.actionType}: ${intent.status.toUpperCase()}`,
                  type: intent.status === "failed" ? "warning" : "primary",
                }))),
              ].map((entry, i) => (
                <p
                  key={i}
                  className="opacity-70"
                  style={{
                    color: entry.type === "warning" ? "#ffb5a0" : "#bac9cc",
                  }}
                >
                  <span
                    style={{
                      color:
                        entry.type === "warning"
                          ? "rgba(255,181,160,0.6)"
                          : "rgba(0,229,255,0.6)",
                    }}
                  >
                    [{entry.time}]
                  </span>{" "}
                  {entry.msg}
                </p>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Positions Table */}
      {positions.length > 0 && (
        <section
          className="p-6 rounded-lg border"
          style={{ backgroundColor: "#201f1f", borderColor: "rgba(59,73,76,0.1)" }}
        >
          <h3
            className="text-xs font-black mb-6 tracking-[0.25em] uppercase border-b pb-4"
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              color: "#9cf0ff",
              borderColor: "rgba(59,73,76,0.2)",
            }}
          >
            ACTIVE POSITIONS
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] font-mono">
              <thead>
                <tr
                  className="border-b"
                  style={{ borderColor: "rgba(59,73,76,0.2)" }}
                >
                  {["TOKEN ID", "TICK LOWER", "TICK UPPER", "LIQUIDITY", "FEES COLLECTED", "STATUS"].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left pb-3 pr-6 uppercase tracking-widest"
                        style={{
                          fontFamily: "'Space Grotesk', sans-serif",
                          color: "#bac9cc",
                        }}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => (
                  <tr
                    key={pos.tokenId}
                    className="border-b"
                    style={{ borderColor: "rgba(59,73,76,0.1)" }}
                  >
                    <td className="py-3 pr-6" style={{ color: "#00e5ff" }}>
                      #{pos.tokenId}
                    </td>
                    <td className="py-3 pr-6" style={{ color: "#e5e2e1" }}>
                      {pos.tickLower.toLocaleString()}
                    </td>
                    <td className="py-3 pr-6" style={{ color: "#e5e2e1" }}>
                      {pos.tickUpper.toLocaleString()}
                    </td>
                    <td className="py-3 pr-6" style={{ color: "#e5e2e1" }}>
                      {(Number(BigInt(pos.liquidity)) / 1e15).toFixed(2)}e15
                    </td>
                    <td className="py-3 pr-6" style={{ color: "#9cf0ff" }}>
                      {(Number(pos.feesCollected) / 1e6).toFixed(2)} USDC
                    </td>
                    <td className="py-3 pr-6">
                      <span
                        className="px-2 py-0.5 rounded border text-[9px] font-bold uppercase tracking-widest"
                        style={{
                          backgroundColor: "rgba(0,229,255,0.1)",
                          borderColor: "rgba(0,229,255,0.2)",
                          color: "#00e5ff",
                        }}
                      >
                        {pos.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
