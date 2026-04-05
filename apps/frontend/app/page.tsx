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
  const activeContent = NAV_TO_CONTENT[activeNav];

  return (
    <div className="bg-[#0e0e0e] text-[#e5e2e1] min-h-screen overflow-x-hidden">
      {/* ── Animated wave background ── */}
      <div className="wave-bg" aria-hidden="true" />

      {/* ── Top Navigation Bar ─────────────────────────────────────────── */}
      <header className="fixed top-0 w-full z-50 flex justify-between items-center px-6 h-16 bg-[#0e0e0e]/80 backdrop-blur-xl border-b border-[#3b494c]/10">
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
        className="fixed left-0 top-0 h-full w-16 lg:w-64 flex flex-col pt-20 pb-8 bg-[#0e0e0e]/80 backdrop-blur-xl border-r border-[#3b494c]/10 z-40"
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

      </aside>

      {/* ── Main Content Canvas ─────────────────────────────────────────── */}
      <main className="ml-16 lg:ml-64 pt-16 min-h-screen bg-grid overflow-hidden">
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
