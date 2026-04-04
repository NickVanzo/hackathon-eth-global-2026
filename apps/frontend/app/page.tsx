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
  { key: "arena", label: "Arena" },
  { key: "positions", label: "Positions" },
  { key: "vault", label: "Vault" },
  { key: "infts", label: "iNFTs" },
  { key: "fees", label: "Fees" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabKey>("arena");

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <nav className="flex w-56 shrink-0 flex-col border-r border-gray-800 bg-gray-950 p-4">
        <h1 className="mb-8 text-xl font-bold tracking-tight text-white">
          Agent Arena
        </h1>
        <div className="flex flex-col gap-1">
          {TABS.map((tab) => (
            <TabButton
              key={tab.key}
              label={tab.label}
              active={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
            />
          ))}
        </div>
      </nav>

      {/* Main content */}
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-100">
            {TABS.find((t) => t.key === activeTab)?.label}
          </h2>
          <ConnectButton />
        </header>

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
