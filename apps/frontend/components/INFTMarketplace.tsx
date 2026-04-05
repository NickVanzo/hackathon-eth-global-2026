"use client";

import { useState } from "react";
import { useAgentCount, useAgentInfo, useAgentTokenId, useINFTOwner, useCommissionsOwed, INFT_ADDRESS, type AgentInfo } from "@/lib/contracts";

// ─── Types ────────────────────────────────────────────────────────────────────

type INFTEntry = {
  tokenId: number;
  agentId: number;
  agentName: string;
  owner: string;
  sharpeScore: number;
  totalReturn: number;
  commissionYield: number;
  paused?: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

// ─── Radar / Strategy Fingerprint SVG ────────────────────────────────────────

interface RadarChartProps {
  sharpe: number;
  totalReturn: number;
  commission: number;
}

function RadarChart({ sharpe, totalReturn, commission }: RadarChartProps) {
  // Normalise each dimension to a 0–1 range and project onto the pentagon
  const s = Math.min(Math.max(sharpe / 4, 0.1), 1);
  const r = Math.min(Math.max((totalReturn + 0.1) / 0.4, 0.1), 1);
  const c = Math.min(Math.max(commission / 0.05, 0.1), 1);
  const avg = (s + r + c) / 3;
  const v4 = Math.max(avg - 0.1, 0.1);
  const v5 = Math.max(avg + 0.05, 0.1);

  // Pentagon vertices: top, top-right, bottom-right, bottom-left, top-left
  // Centre = 50,50; outer radius = 40
  const angles = [-90, -18, 54, 126, 198].map((d) => (d * Math.PI) / 180);
  const radii = [s, r, c, v4, v5];
  const outer = 40;

  const pts = radii
    .map((ratio, i) => {
      const ro = outer * ratio;
      return `${50 + ro * Math.cos(angles[i])},${50 + ro * Math.sin(angles[i])}`;
    })
    .join(" ");

  const outerPts = angles
    .map((a) => `${50 + outer * Math.cos(a)},${50 + outer * Math.sin(a)}`)
    .join(" ");

  return (
    <div className="aspect-square relative flex items-center justify-center">
      {/* Concentric rings */}
      <div className="absolute inset-0 border border-[#00daf3]/20 rounded-full" />
      <div className="absolute inset-4 border border-[#00daf3]/10 rounded-full" />
      <div className="absolute inset-8 border border-[#00daf3]/5 rounded-full" />

      <svg
        viewBox="0 0 100 100"
        className="w-full h-full drop-shadow-[0_0_8px_rgba(0,218,243,0.5)]"
        aria-hidden="true"
      >
        {/* Guide pentagon */}
        <polygon
          points={outerPts}
          fill="none"
          stroke="#3b494c"
          strokeWidth="0.5"
          opacity="0.4"
        />
        {/* Data polygon */}
        <polygon
          points={pts}
          fill="rgba(0,218,243,0.2)"
          stroke="#00daf3"
          strokeWidth="1"
        />
        {/* Vertex dots */}
        {pts.split(" ").map((pt, i) => {
          const [cx, cy] = pt.split(",");
          return (
            <circle key={i} cx={cx} cy={cy} r="1.5" fill="#00daf3" />
          );
        })}
      </svg>

      {/* Radar sweep decoration */}
      <div
        className="absolute w-[2px] h-1/2 bg-[#00e5ff] origin-bottom opacity-20 rotate-45"
        style={{ bottom: "50%", left: "calc(50% - 1px)" }}
      />
    </div>
  );
}

// ─── Performance Chart (SVG sparkline) ───────────────────────────────────────

interface PerformanceChartProps {
  totalReturn: number;
  epochs: number;
}

function PerformanceChart({ totalReturn, epochs }: PerformanceChartProps) {
  // Generate a realistic yield curve — monotonic trend with small noise
  const numPoints = 20;
  const coords: string[] = [];
  // Seeded noise based on totalReturn to be deterministic
  const seed = Math.abs(totalReturn * 1000) + epochs;
  for (let i = 0; i <= numPoints; i++) {
    const x = (i / numPoints) * 500;
    const trend = totalReturn * 300 * (i / numPoints); // main direction
    const noise = Math.sin(seed + i * 1.7) * 5 + Math.cos(seed * 0.3 + i * 2.3) * 3;
    const y = 50 - trend + noise; // 50 = baseline, subtract because SVG y-axis is inverted
    coords.push(`${x.toFixed(0)},${Math.max(5, Math.min(75, y)).toFixed(1)}`);
  }
  const pathD = `M${coords.join(" L")}`;

  return (
    <div
      className="h-48 relative p-4 flex items-end gap-1 overflow-hidden"
      style={{
        background: "#1c1b1b",
        border: "1px solid rgba(59,73,76,0.3)",
      }}
    >
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: "radial-gradient(circle, #3b494c 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Yield band */}
      <div
        className="w-full h-24 relative"
        style={{
          background: "rgba(0,229,255,0.08)",
          borderTop: "2px solid #00e5ff",
        }}
      >
        <div
          className="absolute -top-1.5 left-1/4 w-2 h-2 rounded-full"
          style={{
            background: "#c3f5ff",
            boxShadow: "0 0 10px #00e5ff",
          }}
        />
        <svg
          className="absolute bottom-0 left-0 w-full h-full overflow-visible"
          preserveAspectRatio="none"
          viewBox="0 0 500 80"
          aria-hidden="true"
        >
          <path d={pathD} fill="none" stroke="#00e5ff" strokeWidth="2" />
        </svg>
      </div>

      {/* X-axis epoch labels */}
      <div className="absolute -bottom-5 w-full flex justify-between px-4">
        {["Epoch 01", `Epoch ${Math.round(epochs * 0.25)}`, `Epoch ${Math.round(epochs * 0.5)}`, `Epoch ${Math.round(epochs * 0.75)}`, "Current"].map(
          (label) => (
            <span
              key={label}
              className="font-['Space_Grotesk'] uppercase tracking-widest"
              style={{ fontSize: "8px", color: "#bac9cc" }}
            >
              {label}
            </span>
          )
        )}
      </div>
    </div>
  );
}

// ─── Metric Bento Card ────────────────────────────────────────────────────────

interface MetricCardProps {
  icon: string;
  label: string;
  value: string;
  sub: string;
  subColor?: string;
  valueColor?: string;
}

function MetricCard({ icon, label, value, sub, subColor = "#00daf3", valueColor = "#e5e2e1" }: MetricCardProps) {
  return (
    <div
      className="p-5 flex flex-col gap-2"
      style={{
        background: "#2a2a2a",
        border: "1px solid rgba(59,73,76,0.3)",
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="material-symbols-outlined"
          style={{ fontSize: "18px", color: "#00daf3" }}
          aria-hidden="true"
        >
          {icon}
        </span>
        <span
          className="font-['Space_Grotesk'] uppercase tracking-widest"
          style={{ fontSize: "10px", color: "#bac9cc" }}
        >
          {label}
        </span>
      </div>
      <div
        className="font-['Space_Grotesk'] font-bold"
        style={{ fontSize: "24px", color: valueColor }}
      >
        {value}
      </div>
      <div style={{ fontSize: "10px", color: subColor }}>{sub}</div>
    </div>
  );
}

// ─── Deep Scan Modal ──────────────────────────────────────────────────────────

interface DeepScanModalProps {
  inft: INFTEntry;
  onClose: () => void;
}

function DeepScanModal({ inft, onClose }: DeepScanModalProps) {
  const { tokenId, agentId, agentName, owner, sharpeScore, totalReturn, commissionYield } = inft;
  const { agent } = useAgentInfo(agentId);
  const { commissionsOwed } = useCommissionsOwed(agentId);

  const epochs = agent?.epochsCompleted ?? 0;
  const cumCommissionUsdc = commissionsOwed ? (Number(commissionsOwed) / 1e6).toFixed(6) : "0.000000";
  const survivalPct = epochs > 0
    ? `${Math.min(100, Math.round((1 - (agent?.zeroSharpeStreak ?? 0) / Math.max(epochs, 1)) * 100))}%`
    : "N/A";
  const displayName = agentName.toUpperCase().replace(" ", "_");

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      style={{ backdropFilter: "blur(10px)", background: "rgba(10,10,10,0.75)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="deep-scan-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-y-auto"
        style={{
          background: "#1c1b1b",
          border: "1px solid rgba(59,73,76,0.3)",
          borderRadius: "0.75rem",
          maxHeight: "85vh",
        }}
      >
        {/* Header */}
        <div className="flex justify-between items-start p-6 pb-0">
          <div>
            <p
              className="font-['Space_Grotesk'] uppercase"
              style={{ fontSize: "10px", color: "#00daf3", letterSpacing: "0.2em" }}
            >
              iNFT #{String(tokenId).padStart(4, "0")}
            </p>
            <h2
              id="deep-scan-title"
              className="font-['Space_Grotesk'] font-black uppercase tracking-tight mt-1"
              style={{ fontSize: "24px", color: "#e5e2e1" }}
            >
              {displayName}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#6b7a7d] hover:text-white transition-colors p-1"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-3 gap-3 p-6">
          {[
            { label: "SHARPE", value: sharpeScore.toFixed(2), color: sharpeScore > 1 ? "#00E5FF" : "#bac9cc" },
            { label: "RETURN", value: `${totalReturn >= 0 ? "+" : ""}${(totalReturn * 100).toFixed(2)}%`, color: totalReturn >= 0 ? "#4ade80" : "#f87171" },
            { label: "EPOCHS", value: String(epochs), color: "#e5e2e1" },
          ].map((m) => (
            <div key={m.label} className="p-3" style={{ background: "#131313", borderRadius: "0.5rem" }}>
              <p className="font-['Space_Grotesk'] uppercase text-[9px] tracking-widest" style={{ color: "#6b7a7d" }}>{m.label}</p>
              <p className="font-['Space_Grotesk'] font-bold text-lg mt-1" style={{ color: m.color }}>{m.value}</p>
            </div>
          ))}
        </div>

        {/* Details */}
        <div className="px-6 pb-4 space-y-3">
          <div className="flex justify-between text-xs" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            <span style={{ color: "#6b7a7d" }}>COMMISSION ACCRUED</span>
            <span style={{ color: "#e5e2e1" }}>${cumCommissionUsdc} USDC</span>
          </div>
          <div className="flex justify-between text-xs" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            <span style={{ color: "#6b7a7d" }}>SURVIVAL RATE</span>
            <span style={{ color: "#e5e2e1" }}>{survivalPct}</span>
          </div>
          <div className="flex justify-between text-xs" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            <span style={{ color: "#6b7a7d" }}>CONTRACT (0G)</span>
            <a
              href={`https://chainscan-galileo.0g.ai/address/${INFT_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono hover:underline"
              style={{ color: "#00daf3" }}
            >
              {truncateAddress(INFT_ADDRESS)}
            </a>
          </div>
          <div className="flex justify-between text-xs" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            <span style={{ color: "#6b7a7d" }}>OWNER</span>
            <a
              href={`https://chainscan-galileo.0g.ai/address/${owner}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono hover:underline"
              style={{ color: "#e5e2e1" }}
            >
              {truncateAddress(owner)}
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 pt-3">
          <button
            className="w-full py-3 font-['Space_Grotesk'] font-black text-xs uppercase tracking-[0.2em] transition-all hover:opacity-90 active:scale-[0.98]"
            style={{
              background: "#00e5ff",
              color: "#00363d",
              borderRadius: "0.5rem",
            }}
          >
            PURCHASE iNFT OWNERSHIP
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── iNFT List Card ───────────────────────────────────────────────────────────

interface INFTCardProps {
  inft: INFTEntry;
  onDeepScan: () => void;
}

function INFTCard({ inft, onDeepScan }: INFTCardProps) {
  const { tokenId, agentName, sharpeScore, totalReturn, commissionYield } = inft;

  const isHighPerformer = sharpeScore > 1;
  const isNegative = sharpeScore < 0;

  const accentColor = isHighPerformer
    ? "#00daf3"
    : isNegative
    ? "#f87171"
    : "#bac9cc";

  const borderStyle = isHighPerformer
    ? "1px solid rgba(0,218,243,0.3)"
    : isNegative
    ? "1px solid rgba(248,113,113,0.2)"
    : "1px solid rgba(59,73,76,0.2)";

  const glowStyle = isHighPerformer
    ? "0 0 16px -4px rgba(0,218,243,0.5)"
    : isNegative
    ? "0 0 16px -4px rgba(248,113,113,0.3)"
    : "none";

  return (
    <div
      className="flex flex-col p-0 overflow-hidden"
      style={{
        background: "#1c1b1b",
        border: borderStyle,
        boxShadow: glowStyle,
      }}
    >
      {/* Card header */}
      <div
        className="px-5 py-4 flex justify-between items-start"
        style={{ borderBottom: "1px solid rgba(59,73,76,0.2)" }}
      >
        <div>
          <p
            className="font-['Space_Grotesk'] uppercase tracking-widest"
            style={{ fontSize: "10px", color: accentColor }}
          >
            STRATEGY FILE // {String(tokenId).padStart(4, "0")}
          </p>
          <h3
            className="font-['Space_Grotesk'] font-black uppercase leading-none tracking-tighter mt-1"
            style={{ fontSize: "20px", color: "#e5e2e1" }}
          >
            {agentName.toUpperCase().replace(" ", "_")}
          </h3>
        </div>
        {isHighPerformer && (
          <div
            className="inline-flex items-center gap-1.5 px-2 py-1 uppercase font-bold"
            style={{
              fontSize: "9px",
              letterSpacing: "0.15em",
              background: "rgba(0,218,243,0.1)",
              border: "1px solid rgba(0,218,243,0.4)",
              color: "#00daf3",
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: "#00daf3" }}
            />
            TOP AGENT
          </div>
        )}
      </div>

      {/* Radar fingerprint preview */}
      <div className="px-5 pt-4 pb-2">
        <div className="w-24 h-24 mx-auto">
          <RadarChart
            sharpe={sharpeScore}
            totalReturn={totalReturn}
            commission={commissionYield}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-px mx-5 mb-4 overflow-hidden">
        {[
          {
            label: "Sharpe EMA",
            value: sharpeScore.toFixed(2),
            color: sharpeScore > 1.5 ? "#00E5FF" : sharpeScore > 0.5 ? "#4ade80" : sharpeScore >= 0 ? "#bac9cc" : "#f87171",
            large: true,
          },
          {
            label: "Total Return",
            value: formatPercent(totalReturn),
            color: totalReturn >= 0 ? "#4ade80" : "#f87171",
            large: false,
          },
          {
            label: "Commission",
            value: formatPercent(commissionYield),
            color: "#bac9cc",
            large: false,
          },
        ].map(({ label, value, color, large }) => (
          <div
            key={label}
            className="flex flex-col items-center py-3"
            style={{ background: "rgba(32,31,31,0.8)" }}
          >
            <p
              className="font-['Space_Grotesk'] uppercase tracking-wider mb-1"
              style={{ fontSize: "9px", color: "#849396" }}
            >
              {label}
            </p>
            <span
              className="font-['Space_Grotesk'] font-bold tabular-nums"
              style={{ fontSize: large ? "20px" : "14px", color }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Deep scan CTA */}
      <div className="px-5 pb-5">
        <button
          onClick={onDeepScan}
          className="w-full py-3 font-['Space_Grotesk'] font-bold uppercase tracking-[0.2em] transition-all hover:brightness-110 active:scale-95"
          style={{
            fontSize: "11px",
            background: isHighPerformer
              ? "rgba(0,229,255,0.12)"
              : "rgba(53,53,52,0.6)",
            border: `1px solid ${isHighPerformer ? "rgba(0,229,255,0.4)" : "rgba(59,73,76,0.4)"}`,
            color: isHighPerformer ? "#00daf3" : "#bac9cc",
          }}
        >
          DEEP SCAN →
        </button>
      </div>
    </div>
  );
}

// ─── iNFT Strategy Market ─────────────────────────────────────────────────────

export default function INFTMarketplace() {
  const [activeINFT, setActiveINFT] = useState<INFTEntry | null>(null);

  // Real on-chain data (hooks must be called unconditionally at top level)
  const { count } = useAgentCount();
  const { agent: agent1 } = useAgentInfo(1);
  const { agent: agent2 } = useAgentInfo(2);
  const { agent: agent3 } = useAgentInfo(3);
  const { tokenId: tid1 } = useAgentTokenId(1);
  const { tokenId: tid2 } = useAgentTokenId(2);
  const { tokenId: tid3 } = useAgentTokenId(3);
  const { owner: owner1 } = useINFTOwner(tid1 ?? 0);
  const { owner: owner2 } = useINFTOwner(tid2 ?? 0);
  const { owner: owner3 } = useINFTOwner(tid3 ?? 0);

  const liveAgents = [agent1, agent2, agent3].filter((a): a is AgentInfo => a != null);
  const owners = [owner1, owner2, owner3];
  const tids = [tid1, tid2, tid3];

  const infts: INFTEntry[] = liveAgents.map((agent, i) => ({
    tokenId: tids[i] ?? agent.id,
    agentId: agent.id,
    agentName: agent.name,
    owner: owners[i] ?? "0x0000000000000000000000000000000000000000",
    sharpeScore: agent.sharpeScore,
    totalReturn: agent.totalReturn,
    commissionYield: agent.commissionYield,
    paused: false,
  }));

  void count;

  return (
    <section aria-label="iNFT Strategy Market">
      {/* Section header */}
      <div className="mb-8 flex justify-between items-end">
        <div>
          <h2
            className="font-['Space_Grotesk'] font-bold uppercase tracking-tighter"
            style={{ fontSize: "28px", color: "#e5e2e1" }}
          >
            iNFT Strategy Market
          </h2>
          <p
            className="mt-1 font-['Manrope']"
            style={{ fontSize: "14px", color: "#bac9cc" }}
          >
            Each iNFT encodes an on-chain agent strategy. Click DEEP SCAN to inspect the dossier.
          </p>
        </div>
        <div className="flex gap-4">
          <div
            className="px-4 py-2"
            style={{
              background: "#2a2a2a",
              borderLeft: "2px solid #00daf3",
            }}
          >
            <p
              className="font-['Space_Grotesk'] uppercase tracking-widest"
              style={{ fontSize: "10px", color: "#bac9cc" }}
            >
              Listed
            </p>
            <p
              className="font-['Space_Grotesk'] font-bold"
              style={{ fontSize: "20px", color: "#00daf3" }}
            >
              {infts.length}
            </p>
          </div>
        </div>
      </div>

      {/* Cards grid */}
      <ul
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 list-none p-0"
        aria-label={`${infts.length} iNFT strategies`}
      >
        {infts.map((inft) => (
          <li key={inft.tokenId}>
            <INFTCard inft={inft} onDeepScan={() => setActiveINFT(inft)} />
          </li>
        ))}
      </ul>

      {/* Deep scan modal */}
      {activeINFT && (
        <DeepScanModal inft={activeINFT} onClose={() => setActiveINFT(null)} />
      )}
    </section>
  );
}
