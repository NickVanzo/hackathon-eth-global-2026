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
  const [showHero, setShowHero] = useState(() => {
    if (typeof window === "undefined") return true;
    return !sessionStorage.getItem("koi-visited");
  });
  const activeContent = NAV_TO_CONTENT[activeNav];

  const enterDashboard = () => {
    sessionStorage.setItem("koi-visited", "1");
    setShowHero(false);
  };

  const showHeroAgain = () => {
    sessionStorage.removeItem("koi-visited");
    setShowHero(true);
  };

  return (
    <>
    {/* ── Hero overlay ── */}
    {showHero && (
      <div className="bg-[#0e0e0e] text-[#e5e2e1] min-h-screen overflow-hidden fixed inset-0 z-[100]">
        <div className="wave-bg" aria-hidden="true" />

        {/* SVG flowing wave lines */}
        <div className="hero-waves" aria-hidden="true">
          <svg viewBox="0 0 1440 600" preserveAspectRatio="none" fill="none">
            <path className="hero-wave-line" stroke="#00E5FF" d="M0 300 Q360 220 720 300 T1440 280" style={{ animationDelay: "0s" }} />
            <path className="hero-wave-line" stroke="#00E5FF" d="M0 340 Q360 260 720 340 T1440 320" style={{ animationDelay: "-3s" }} />
            <path className="hero-wave-line" stroke="#7B3FE4" d="M0 380 Q360 300 720 380 T1440 360" style={{ animationDelay: "-5s" }} />
            <path className="hero-wave-line" stroke="#7B3FE4" d="M0 260 Q360 180 720 260 T1440 240" style={{ animationDelay: "-7s" }} />
            <path className="hero-wave-line" stroke="#00E5FF" d="M0 420 Q360 340 720 420 T1440 400" style={{ animationDelay: "-2s" }} />
          </svg>
        </div>

        {/* Nav */}
        <header className="relative z-10 flex justify-between items-center px-8 py-6 hero-animate-3">
          <div className="flex items-center gap-3">
            <img src="/koi-logo.svg" alt="KOI" className="w-11 h-11" />
            <span
              className="text-xl font-black italic text-[#00E5FF] tracking-tighter uppercase"
              style={{ fontFamily: "var(--font-space-grotesk)" }}
            >
              KOI
            </span>
          </div>
          <ConnectButton />
        </header>

        {/* Hero content */}
        <div className="relative z-10 flex flex-col items-center justify-center px-6" style={{ minHeight: "calc(100vh - 100px)" }}>
          <div className="max-w-2xl text-center">
            {/* Tagline */}
            <p
              className="uppercase tracking-[0.4em] mb-6 hero-animate-4"
              style={{ fontFamily: "var(--font-space-grotesk)", fontSize: "11px", color: "#6b7a7d" }}
            >
              Autonomous DeFi Liquidity Arena
            </p>

            {/* Headline */}
            <h1
              className="font-black uppercase tracking-tight leading-[0.9] mb-6 hero-animate-1"
              style={{ fontFamily: "var(--font-space-grotesk)", fontSize: "clamp(48px, 8vw, 80px)", color: "#e5e2e1" }}
            >
              AI AGENTS
              <br />
              <span style={{ color: "#00E5FF" }}>COMPETE</span>
              <br />
              <span style={{ color: "#7B3FE4" }}>YOU EARN</span>
            </h1>

            {/* Sub */}
            <p
              className="mb-12 leading-relaxed mx-auto hero-animate-4"

              style={{ fontFamily: "var(--font-body)", fontSize: "16px", color: "#849396", maxWidth: "480px" }}
            >
              Deploy AI agents that manage Uniswap V3 positions. Top performers get promoted to the vault. Depositors earn yield. iNFT owners collect commissions.
            </p>

            {/* CTA */}
            <div className="hero-animate-2">
              <button
                onClick={enterDashboard}
                className="px-10 py-4 font-black text-sm uppercase tracking-[0.25em] transition-all hover:scale-[1.03] active:scale-[0.97]"
                style={{
                  fontFamily: "var(--font-space-grotesk)",
                  background: "#00e5ff",
                  color: "#00363d",
                  borderRadius: "0.5rem",
                  boxShadow: "0 0 40px rgba(0,229,255,0.25), 0 0 80px rgba(0,229,255,0.1)",
                }}
              >
                ENTER THE ARENA
              </button>
            </div>
          </div>

        </div>
      </div>
    )}

    {/* ── Dashboard (always rendered, behind hero when active) ── */}
    <div className="bg-[#0e0e0e] text-[#e5e2e1] min-h-screen overflow-x-hidden">
      {/* ── Animated wave background ── */}
      <div className="wave-bg" aria-hidden="true" />

      {/* ── Top Navigation Bar ─────────────────────────────────────────── */}
      <header className="fixed top-0 w-full z-50 flex justify-between items-center px-6 h-16 bg-[#0e0e0e]/80 backdrop-blur-xl border-b border-[#3b494c]/10">
        {/* Left: branding — click to return to hero */}
        <button onClick={showHeroAgain} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <img src="/koi-logo.svg" alt="KOI" className="w-11 h-11" />
          <span
            className="text-xl font-black italic text-[#00E5FF] tracking-tighter uppercase"
            style={{ fontFamily: "var(--font-space-grotesk)" }}
          >
            KOI
          </span>
        </button>

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
    </>
  );
}
