"use client";

import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { TabButton } from "@/components/ui/TabButton";
import AgentPerformance from "@/components/AgentPerformance";
import PositionView from "@/components/PositionView";
import DepositorView from "@/components/DepositorView";
import INFTMarketplace from "@/components/INFTMarketplace";
import FeeWaterfall from "@/components/FeeWaterfall";

const TABS = [
  { key: "arena", label: "Arena", icon: "⚔" },
  { key: "positions", label: "Positions", icon: "◈" },
  { key: "vault", label: "Vault", icon: "◎" },
  { key: "infts", label: "iNFTs", icon: "◆" },
  { key: "fees", label: "Fees", icon: "◐" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const TAB_LABELS: Record<TabKey, string> = {
  arena: "LEADERBOARD",
  positions: "POSITIONS",
  vault: "VAULT",
  infts: "iNFT STRATEGIES",
  fees: "FEE WATERFALL",
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabKey>("arena");

  return (
    <div className="flex min-h-screen bg-[#0D0D0D]">
      {/* Sidebar */}
      <nav
        className="flex w-60 shrink-0 flex-col border-r border-[#1c1b1b] bg-[#111111] p-4"
        aria-label="Main navigation"
      >
        {/* Brand */}
        <div className="mb-8 px-1">
          <p className="text-[10px] font-medium tracking-[0.25em] uppercase text-[#787776] mb-0.5">
            on-chain
          </p>
          <h1 className="text-lg font-bold tracking-widest uppercase text-[#00E5FF]">
            Agent Arena
          </h1>
          <div className="mt-2 h-px bg-gradient-to-r from-[#00E5FF]/40 to-transparent" />
        </div>

        {/* Navigation */}
        <div className="flex flex-col gap-1">
          {TABS.map((tab) => (
            <TabButton
              key={tab.key}
              label={tab.label}
              active={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              icon={
                <span className="text-base leading-none" aria-hidden="true">
                  {tab.icon}
                </span>
              }
            />
          ))}
        </div>

        {/* Footer decoration */}
        <div className="mt-auto pt-6">
          <div className="h-px bg-gradient-to-r from-transparent via-[#1c1b1b] to-transparent mb-3" />
          <p className="text-[10px] text-[#787776] text-center tracking-wider">
            ETH GLOBAL 2026
          </p>
        </div>
      </nav>

      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[#1c1b1b] bg-[#111111] px-6 py-3">
          <div>
            <h2 className="text-xs font-medium tracking-[0.2em] uppercase text-[#787776]">
              Agent Arena
            </h2>
            <p className="text-base font-bold tracking-widest uppercase text-[#E5E2E1]">
              {TAB_LABELS[activeTab]}
            </p>
          </div>
          <ConnectButton />
        </header>

        {/* Page body */}
        <main className="flex-1 p-6">
          {activeTab === "arena" && <AgentPerformance />}
          {activeTab === "positions" && <PositionView />}
          {activeTab === "vault" && <DepositorView />}
          {activeTab === "infts" && <INFTMarketplace />}
          {activeTab === "fees" && <FeeWaterfall />}
        </main>
      </div>
    </div>
  );
}
