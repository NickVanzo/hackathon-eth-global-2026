"use client";

import { useState } from "react";
import { MOCK_INFTS } from "@/lib/mock-data";

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
  const { tokenId, agentName, owner, sharpeScore, totalReturn, commissionYield } = inft;
  const epochs = 114;
  const marketPrice = (sharpeScore * 7 + 8).toFixed(2);
  const dailyRoyalty = (commissionYield * 0.5).toFixed(3);
  const cumCommission = (commissionYield * 200 + 10).toFixed(1);
  const survivalPct = sharpeScore > 1 ? "98.2%" : sharpeScore > 0 ? "84.5%" : "61.0%";

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backdropFilter: "blur(12px)", background: "rgba(19,19,19,0.6)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="deep-scan-title"
    >
      {/* Modal shell */}
      <div
        className="w-full max-w-5xl relative overflow-hidden flex flex-col md:flex-row"
        style={{
          background: "#0e0e0e",
          border: "1px solid rgba(0,229,255,0.2)",
          boxShadow: "0 0 50px rgba(0,229,255,0.15)",
        }}
      >
        {/* Top glow line */}
        <div
          className="absolute top-0 left-0 w-full h-px opacity-50"
          style={{
            background:
              "linear-gradient(to right, transparent, #00e5ff, transparent)",
          }}
          aria-hidden="true"
        />
        {/* Decorative circle */}
        <div
          className="absolute -right-12 -top-12 w-48 h-48 rounded-full pointer-events-none"
          style={{ border: "1px solid rgba(0,229,255,0.1)" }}
          aria-hidden="true"
        />

        {/* ── Left column: Strategy Identity ── */}
        <div
          className="w-full md:w-80 p-8 flex flex-col"
          style={{
            background: "#1c1b1b",
            borderRight: "1px solid rgba(59,73,76,0.2)",
          }}
        >
          {/* Header */}
          <div className="mb-8">
            <p
              className="font-['Space_Grotesk'] uppercase mb-2"
              style={{
                fontSize: "10px",
                color: "#00daf3",
                letterSpacing: "0.3em",
              }}
            >
              STRATEGY_FILE // 0X-{String(tokenId).padStart(4, "0")}
            </p>
            <h2
              id="deep-scan-title"
              className="font-['Space_Grotesk'] font-black uppercase leading-none tracking-tighter mb-4"
              style={{ fontSize: "30px", color: "#e5e2e1" }}
            >
              {agentName.toUpperCase().replace(" ", "_")}
            </h2>
            <div
              className="inline-flex items-center gap-2 px-3 py-1 uppercase font-bold"
              style={{
                fontSize: "10px",
                letterSpacing: "0.2em",
                background: "rgba(215,59,0,0.1)",
                border: "1px solid #d73b00",
                color: "#ffb5a0",
              }}
            >
              <span
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ background: "#ffb5a0" }}
              />
              ACTIVE EMITTER
            </div>
          </div>

          {/* Contract info */}
          <div className="flex-1 space-y-6">
            <div
              className="p-4"
              style={{
                background: "rgba(53,53,52,0.3)",
                border: "1px solid rgba(59,73,76,0.3)",
              }}
            >
              <p
                className="font-['Space_Grotesk'] uppercase mb-1"
                style={{ fontSize: "10px", color: "#bac9cc" }}
              >
                Contract ID (0G)
              </p>
              <p
                className="font-mono truncate"
                style={{ fontSize: "12px", color: "#c3f5ff" }}
              >
                0x9fA...42dB8c
              </p>
              <div className="mt-4">
                <p
                  className="font-['Space_Grotesk'] uppercase mb-1"
                  style={{ fontSize: "10px", color: "#bac9cc" }}
                >
                  Current Owner
                </p>
                <p
                  className="font-mono truncate"
                  style={{ fontSize: "12px", color: "#e5e2e1" }}
                >
                  {truncateAddress(owner)}
                </p>
              </div>
            </div>

            {/* Radar fingerprint */}
            <div>
              <p
                className="font-['Space_Grotesk'] uppercase mb-4 tracking-widest"
                style={{ fontSize: "10px", color: "#c3f5ff" }}
              >
                Strategy Fingerprint
              </p>
              <RadarChart
                sharpe={sharpeScore}
                totalReturn={totalReturn}
                commission={commissionYield}
              />
            </div>
          </div>

          {/* Risk level */}
          <div
            className="mt-8 pt-6 flex justify-between items-center"
            style={{ borderTop: "1px solid rgba(59,73,76,0.2)" }}
          >
            <span
              className="font-['Space_Grotesk'] uppercase tracking-widest"
              style={{ fontSize: "12px", color: "#bac9cc" }}
            >
              Risk Level
            </span>
            <span
              className="uppercase font-['Space_Grotesk']"
              style={{
                fontSize: "12px",
                color: sharpeScore < 0 ? "#ffb5a0" : sharpeScore > 2 ? "#ffb5a0" : "#bac9cc",
              }}
            >
              {sharpeScore < 0 ? "Extreme" : sharpeScore > 2 ? "High" : "Moderate"}
            </span>
          </div>
        </div>

        {/* ── Right column: Performance & Metrics ── */}
        <div className="flex-1 p-8" style={{ background: "#0e0e0e" }}>
          {/* Header row */}
          <div className="flex justify-between items-start mb-10">
            <div>
              <p
                className="font-['Space_Grotesk'] uppercase mb-1"
                style={{
                  fontSize: "10px",
                  color: "#bac9cc",
                  letterSpacing: "0.4em",
                }}
              >
                Dossier Access
              </p>
              <h3
                className="font-['Space_Grotesk'] font-bold uppercase tracking-tight"
                style={{ fontSize: "20px", color: "#e5e2e1" }}
              >
                Strategy Performance Analysis
              </h3>
            </div>
            <button
              onClick={onClose}
              className="p-2 transition-colors"
              style={{ color: "#bac9cc" }}
              aria-label="Close deep scan"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                close
              </span>
            </button>
          </div>

          {/* Metrics bento */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            <MetricCard
              icon="radar"
              label="Sharpe EMA"
              value={sharpeScore.toFixed(2)}
              sub={`${sharpeScore > 0 ? "+" : ""}${Math.round(sharpeScore * 4)}% vs Epoch-${epochs - 1}`}
              valueColor={sharpeScore > 1.5 ? "#00E5FF" : sharpeScore > 0.5 ? "#4ade80" : sharpeScore >= 0 ? "#bac9cc" : "#FF5722"}
            />
            <MetricCard
              icon="payments"
              label="Cum. Commission"
              value={`${cumCommission} ETH`}
              sub="Total Fee Capture"
              subColor="#bac9cc"
            />
            <MetricCard
              icon="history"
              label="Arena Tenure"
              value={`${epochs} Epochs`}
              sub={`${survivalPct} Survival Rate`}
              subColor="#ffb5a0"
            />
          </div>

          {/* Performance chart */}
          <div className="mb-10">
            <div className="flex justify-between items-center mb-4">
              <h4
                className="font-['Space_Grotesk'] uppercase tracking-[0.2em]"
                style={{ fontSize: "12px", color: "#c3f5ff" }}
              >
                Historical Performance Yield
              </h4>
              <div className="flex gap-2 items-center">
                <span
                  className="w-3 h-3 inline-block"
                  style={{ background: "#00e5ff" }}
                  aria-hidden="true"
                />
                <span
                  className="font-['Space_Grotesk'] uppercase"
                  style={{ fontSize: "10px", color: "#bac9cc" }}
                >
                  Agent-X Yield Curve
                </span>
              </div>
            </div>
            <PerformanceChart totalReturn={totalReturn} epochs={epochs} />
          </div>

          {/* Action area */}
          <div
            className="flex items-center justify-between mt-12 p-6"
            style={{
              background: "rgba(42,42,42,0.5)",
              borderTop: "1px solid rgba(0,229,255,0.3)",
            }}
          >
            <div className="flex items-center gap-6">
              <div>
                <p
                  className="font-['Space_Grotesk'] uppercase"
                  style={{ fontSize: "10px", color: "#bac9cc" }}
                >
                  Market Price
                </p>
                <p
                  className="font-['Space_Grotesk'] font-black"
                  style={{ fontSize: "24px", color: "#e5e2e1" }}
                >
                  {marketPrice} ETH
                </p>
              </div>
              <div
                className="h-8 w-px"
                style={{ background: "rgba(59,73,76,0.4)" }}
              />
              <div>
                <p
                  className="font-['Space_Grotesk'] uppercase"
                  style={{ fontSize: "10px", color: "#bac9cc" }}
                >
                  Daily Royalty
                </p>
                <p
                  className="font-['Space_Grotesk'] font-bold"
                  style={{ fontSize: "18px", color: "#00daf3" }}
                >
                  {dailyRoyalty} ETH
                </p>
              </div>
            </div>

            <button
              className="px-10 py-4 font-['Space_Grotesk'] font-black uppercase transition-all transform hover:scale-[1.02] active:scale-95"
              style={{
                background: "#00e5ff",
                color: "#00363d",
                letterSpacing: "0.25em",
                boxShadow: "0 0 30px rgba(0,229,255,0.3)",
                fontSize: "12px",
              }}
            >
              PURCHASE_iNFT_OWNERSHIP
            </button>
          </div>

          <p
            className="text-center font-['Space_Grotesk'] uppercase tracking-widest mt-4"
            style={{ fontSize: "9px", color: "rgba(186,201,204,0.4)" }}
          >
            Ownership transfer is instantaneous via 0G Layer-1 Settlement Protocol
          </p>
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
    ? "#ffb5a0"
    : "#bac9cc";

  const borderStyle = isHighPerformer
    ? "1px solid rgba(0,218,243,0.3)"
    : isNegative
    ? "1px solid rgba(255,181,160,0.2)"
    : "1px solid rgba(59,73,76,0.2)";

  const glowStyle = isHighPerformer
    ? "0 0 16px -4px rgba(0,218,243,0.5)"
    : isNegative
    ? "0 0 16px -4px rgba(255,181,160,0.3)"
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
            STRATEGY_FILE // {String(tokenId).padStart(4, "0")}
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
            color: sharpeScore > 1.5 ? "#00E5FF" : sharpeScore > 0.5 ? "#4ade80" : sharpeScore >= 0 ? "#bac9cc" : "#FF5722",
            large: true,
          },
          {
            label: "Total Return",
            value: formatPercent(totalReturn),
            color: totalReturn >= 0 ? "#00daf3" : "#ffb5a0",
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
          DEEP_SCAN →
        </button>
      </div>
    </div>
  );
}

// ─── iNFT Strategy Market ─────────────────────────────────────────────────────

export default function INFTMarketplace() {
  const [activeINFT, setActiveINFT] = useState<INFTEntry | null>(null);

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
            Each iNFT encodes an on-chain agent strategy. Click DEEP_SCAN to inspect the dossier.
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
              {MOCK_INFTS.length}
            </p>
          </div>
        </div>
      </div>

      {/* Cards grid */}
      <ul
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 list-none p-0"
        aria-label={`${MOCK_INFTS.length} iNFT strategies`}
      >
        {MOCK_INFTS.map((inft) => (
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
