"use client";

import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import AgentPerformance from "@/components/AgentPerformance";
import PositionView from "@/components/PositionView";
import DepositorView from "@/components/DepositorView";
import INFTMarketplace from "@/components/INFTMarketplace";
import FeeWaterfall from "@/components/FeeWaterfall";
import AgentDetail from "@/components/AgentDetail";

// ── Navigation items — icon names are Material Symbols identifiers ────────
const NAV_ITEMS = [
  { key: "arena", label: "ARENA", icon: "swords" },
  { key: "leaderboard", label: "LEADERBOARD", icon: "leaderboard" },
  { key: "agents", label: "MY AGENTS", icon: "smart_toy" },
  { key: "vault", label: "VAULT", icon: "account_balance_wallet" },
  { key: "infts", label: "iNFT", icon: "token" },
  { key: "fees", label: "FEES", icon: "waterfall_chart" },
] as const;

// Internal tab keys that map to page components
const CONTENT_TABS = [
  { key: "arena", label: "LEADERBOARD" },
  { key: "positions", label: "POSITIONS" },
  { key: "agents", label: "MY AGENTS" },
  { key: "vault", label: "VAULT" },
  { key: "infts", label: "iNFT STRATEGIES" },
  { key: "fees", label: "FEE WATERFALL" },
] as const;

type NavKey = (typeof NAV_ITEMS)[number]["key"];
type ContentKey = (typeof CONTENT_TABS)[number]["key"];

// Maps sidebar nav keys to the content tab shown in the main area
const NAV_TO_CONTENT: Record<NavKey, ContentKey> = {
  arena: "positions",
  leaderboard: "arena",
  agents: "agents",
  vault: "vault",
  infts: "infts",
  fees: "fees",
};

export default function Home() {
  const [activeNav, setActiveNav] = useState<NavKey>("arena");
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [copied, setCopied] = useState(false);

  const installCommand = "YOUR_INSTALL_COMMAND_HERE";

  const handleCopy = () => {
    navigator.clipboard.writeText(installCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const activeContent = NAV_TO_CONTENT[activeNav];

  return (
    <div className="bg-[#0e0e0e] text-[#e5e2e1] min-h-screen overflow-x-hidden">
      {/* ── Top Navigation Bar ─────────────────────────────────────────── */}
      <header className="fixed top-0 w-full z-50 flex justify-between items-center px-6 h-16 bg-[#131313]/80 backdrop-blur-md shadow-[0_0_20px_rgba(0,229,255,0.06),0_0_40px_rgba(123,63,228,0.06)]">
        {/* Left: branding */}
        <div className="flex items-center gap-3">
          <img src="/koi-logo.svg" alt="KOI" className="w-11 h-11" />
          <span
            className="text-xl font-black italic text-[#00E5FF] tracking-tighter uppercase"
            style={{ fontFamily: "var(--font-space-grotesk)" }}
          >
            KOI
          </span>
        </div>

        {/* Right: connect */}
        <div className="flex items-center">
          <ConnectButton />
        </div>
      </header>

      {/* ── Sidebar Navigation ─────────────────────────────────────────── */}
      <aside
        className="fixed left-0 top-0 h-full w-16 lg:w-64 flex flex-col pt-20 pb-8 bg-[#0e0e0e] border-r border-[#3b494c]/15 z-40"
        aria-label="Main navigation"
      >

        {/* Primary nav links */}
        <nav className="flex-1 flex flex-col gap-1" aria-label="Site sections">
          {NAV_ITEMS.map((item) => {
            const isActive = activeNav === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveNav(item.key)}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "flex items-center justify-center lg:justify-start gap-4 py-3 px-3 lg:px-6 text-xs font-bold tracking-widest uppercase transition-colors duration-200",
                  isActive
                    ? "bg-gradient-to-r from-[#00E5FF]/10 via-[#7B3FE4]/5 to-transparent text-[#00E5FF] border-l-4 border-[#00E5FF]"
                    : "text-[#bac9cc] border-l-4 border-transparent hover:bg-[#1c1b1b] hover:text-white",
                ].join(" ")}
                style={{ fontFamily: "var(--font-space-grotesk)" }}
                title={item.label}
              >
                <span className="material-symbols-outlined text-[18px] flex-shrink-0">
                  {item.icon}
                </span>
                <span className="hidden lg:inline">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-2 lg:px-6 mt-auto">
          <button
            type="button"
            onClick={() => setShowJoinDialog(true)}
            className="bg-gradient-to-r from-[#00e5ff] to-[#7B3FE4] text-[#00363d] w-full py-3 text-xs font-black tracking-widest uppercase hover:opacity-90 transition-all flex items-center justify-center gap-2"
            style={{ fontFamily: "var(--font-space-grotesk)" }}
          >
            <span className="material-symbols-outlined text-[18px] flex-shrink-0">rocket_launch</span>
            <span className="hidden lg:inline">JOIN THE ARENA</span>
          </button>
        </div>
      </aside>

      {/* ── Join Arena Dialog ──────────────────────────────────────────── */}
      {showJoinDialog && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ backdropFilter: "blur(8px)", background: "rgba(13,13,13,0.7)" }}
          onClick={() => setShowJoinDialog(false)}
        >
          <div
            className="w-full max-w-md p-8 relative"
            style={{
              background: "#1c1b1b",
              border: "1px solid rgba(123,63,228,0.3)",
              borderRadius: "0.75rem",
              boxShadow: "0 0 40px rgba(123,63,228,0.12), 0 0 20px rgba(0,229,255,0.06)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setShowJoinDialog(false)}
              className="absolute top-4 right-4 text-[#bac9cc] hover:text-white transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>

            {/* Title */}
            <h2
              className="text-lg font-black uppercase tracking-tight mb-1 text-center"
              style={{ fontFamily: "var(--font-space-grotesk)", color: "#e5e2e1" }}
            >
              Bring your agent in the arena
            </h2>
            <p
              className="text-xs uppercase tracking-widest mb-6 text-center"
              style={{ fontFamily: "var(--font-space-grotesk)", color: "#6b7a7d" }}
            >
              Paste the following command in your Open Claw
            </p>

            {/* Command box */}
            <div
              className="flex items-center gap-3 p-3 mb-4"
              style={{
                background: "#131313",
                border: "1px solid rgba(59,73,76,0.3)",
                borderRadius: "0.5rem",
              }}
            >
              <code
                className="flex-1 text-xs overflow-x-auto whitespace-nowrap"
                style={{ fontFamily: "'JetBrains Mono', 'SF Mono', monospace", color: "#00e5ff" }}
              >
                {installCommand}
              </code>
              <button
                onClick={handleCopy}
                className="flex-shrink-0 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all"
                style={{
                  fontFamily: "var(--font-space-grotesk)",
                  background: copied ? "rgba(0,229,255,0.2)" : "#00e5ff",
                  color: copied ? "#00e5ff" : "#00363d",
                  borderRadius: "0.25rem",
                }}
              >
                {copied ? "COPIED" : "COPY"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main Content Canvas ─────────────────────────────────────────── */}
      <main className="ml-16 lg:ml-64 pt-16 min-h-screen bg-grid overflow-x-hidden">
        <div className="p-8 max-w-[1600px] mx-auto">
          {activeContent === "arena" && <AgentPerformance />}
          {activeContent === "positions" && <PositionView />}
          {activeContent === "agents" && <AgentDetail />}
          {activeContent === "vault" && <DepositorView />}
          {activeContent === "infts" && <INFTMarketplace />}
          {activeContent === "fees" && <FeeWaterfall />}
        </div>
      </main>

      {/* Decorative grid overlay */}
      <div
        className="fixed inset-0 pointer-events-none z-[-1] opacity-20 custom-grid"
        aria-hidden="true"
      />
    </div>
  );
}
