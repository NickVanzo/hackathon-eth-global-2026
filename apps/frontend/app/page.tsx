"use client";

import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import AgentPerformance from "@/components/AgentPerformance";
import PositionView from "@/components/PositionView";
import DepositorView from "@/components/DepositorView";
import INFTMarketplace from "@/components/INFTMarketplace";
import FeeWaterfall from "@/components/FeeWaterfall";

// ── Navigation items — icon names are Material Symbols identifiers ────────
const NAV_ITEMS = [
  { key: "arena", label: "ARENA", icon: "swords" },
  { key: "leaderboard", label: "LEADERBOARD", icon: "leaderboard" },
  { key: "agents", label: "MY_AGENTS", icon: "smart_toy" },
  { key: "vault", label: "VAULT", icon: "account_balance_wallet" },
] as const;

// Internal tab keys that map to page components
const CONTENT_TABS = [
  { key: "arena", label: "LEADERBOARD" },
  { key: "positions", label: "POSITIONS" },
  { key: "vault", label: "VAULT" },
  { key: "infts", label: "iNFT STRATEGIES" },
  { key: "fees", label: "FEE WATERFALL" },
] as const;

type NavKey = (typeof NAV_ITEMS)[number]["key"];
type ContentKey = (typeof CONTENT_TABS)[number]["key"];

// Maps sidebar nav keys to the content tab shown in the main area
const NAV_TO_CONTENT: Record<NavKey, ContentKey> = {
  arena: "arena",
  leaderboard: "arena",
  agents: "positions",
  vault: "vault",
};

export default function Home() {
  const [activeNav, setActiveNav] = useState<NavKey>("arena");

  const activeContent = NAV_TO_CONTENT[activeNav];

  return (
    <div className="bg-[#0e0e0e] text-[#e5e2e1] min-h-screen">
      {/* ── Top Navigation Bar ─────────────────────────────────────────── */}
      <header className="fixed top-0 w-full z-50 flex justify-between items-center px-6 h-16 bg-[#131313]/80 backdrop-blur-md shadow-[0_0_20px_rgba(0,229,255,0.08)]">
        {/* Left: branding + stats */}
        <div className="flex items-center gap-8">
          <span
            className="text-xl font-black italic text-[#00E5FF] tracking-tighter uppercase"
            style={{ fontFamily: "var(--font-space-grotesk)" }}
          >
            ARENA_OS
          </span>
          <nav
            className="hidden md:flex items-center gap-6"
            aria-label="Market stats"
          >
            <span
              className="text-[#bac9cc] text-xs font-bold tracking-tighter uppercase hover:text-[#00E5FF] transition-colors cursor-default"
              style={{ fontFamily: "var(--font-space-grotesk)" }}
            >
              TVL: $1.2B
            </span>
            <span
              className="text-[#bac9cc] text-xs font-bold tracking-tighter uppercase hover:text-[#00E5FF] transition-colors cursor-default"
              style={{ fontFamily: "var(--font-space-grotesk)" }}
            >
              APY: 24.5%
            </span>
          </nav>
        </div>

        {/* Right: utilities + connect */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-4 px-4 py-1.5 bg-[#2a2a2a] border border-[#3b494c]/10">
            <span className="material-symbols-outlined text-[#00E5FF] text-[18px]">
              notifications
            </span>
            <span className="material-symbols-outlined text-[#bac9cc] text-[18px] cursor-pointer hover:text-[#00E5FF] transition-colors">
              settings
            </span>
          </div>
          <ConnectButton />
        </div>
      </header>

      {/* ── Sidebar Navigation ─────────────────────────────────────────── */}
      <aside
        className="fixed left-0 top-0 h-full w-64 flex flex-col pt-20 pb-8 bg-[#0e0e0e] border-r border-[#3b494c]/15 z-40"
        aria-label="Main navigation"
      >
        {/* Operator profile block */}
        <div className="px-6 mb-10">
          <div className="flex items-center gap-3 p-3 bg-[#201f1f] border border-[#3b494c]/10">
            <div className="w-10 h-10 overflow-hidden bg-[#00e5ff]/20 flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-[#00E5FF] text-2xl">
                person
              </span>
            </div>
            <div>
              <p
                className="text-[10px] font-black text-[#c3f5ff] tracking-widest uppercase"
                style={{ fontFamily: "var(--font-space-grotesk)" }}
              >
                OPERATOR_01
              </p>
              <p
                className="text-[8px] text-[#bac9cc] font-bold"
                style={{ fontFamily: "var(--font-space-grotesk)" }}
              >
                RANK: ELITE
              </p>
            </div>
          </div>
        </div>

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
                  "flex items-center gap-4 py-3 px-6 text-xs font-bold tracking-widest uppercase transition-colors duration-200",
                  isActive
                    ? "bg-gradient-to-r from-[#00E5FF]/10 to-transparent text-[#00E5FF] border-l-4 border-[#00E5FF]"
                    : "text-[#bac9cc] border-l-4 border-transparent hover:bg-[#1c1b1b] hover:text-white",
                ].join(" ")}
                style={{ fontFamily: "var(--font-space-grotesk)" }}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {item.icon}
                </span>
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Bottom section: CTA + utility links */}
        <div className="px-6 mt-auto flex flex-col gap-6">
          <button
            type="button"
            className="bg-[#00e5ff] text-[#00363d] w-full py-3 text-xs font-black tracking-widest uppercase hover:opacity-90 transition-all"
            style={{ fontFamily: "var(--font-space-grotesk)" }}
          >
            DEPLOY_AGENT
          </button>

          <div className="flex flex-col gap-2">
            <a
              href="#"
              className="text-[#bac9cc] flex items-center gap-3 text-[10px] font-bold tracking-widest uppercase hover:text-white transition-colors"
              style={{ fontFamily: "var(--font-space-grotesk)" }}
            >
              <span className="material-symbols-outlined text-[14px]">
                terminal
              </span>
              TERMINAL
            </a>
            <a
              href="#"
              className="text-[#bac9cc] flex items-center gap-3 text-[10px] font-bold tracking-widest uppercase hover:text-white transition-colors"
              style={{ fontFamily: "var(--font-space-grotesk)" }}
            >
              <span className="material-symbols-outlined text-[14px]">
                help_center
              </span>
              SUPPORT
            </a>
          </div>
        </div>
      </aside>

      {/* ── Main Content Canvas ─────────────────────────────────────────── */}
      <main className="ml-64 pt-16 min-h-screen bg-grid">
        <div className="p-8 max-w-[1600px] mx-auto">
          {activeContent === "arena" && <AgentPerformance />}
          {activeContent === "positions" && <PositionView />}
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
