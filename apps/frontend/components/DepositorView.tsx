"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { MOCK_VAULT } from "@/lib/mock-data";

function formatSharePrice(raw: string): string {
  const value = formatUnits(BigInt(raw), 6);
  return `${value} USDC`;
}

function formatTotalAssets(raw: string): string {
  const num = Number(formatUnits(BigInt(raw), 6));
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toFixed(2)}`;
}

function formatShares(raw: string): string {
  return formatUnits(BigInt(raw), 6);
}

export default function DepositorView() {
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");

  const vault = MOCK_VAULT;

  return (
    <div className="space-y-6">
      {/* Vault Title */}
      <h2 className="text-xl font-bold uppercase tracking-[0.2em] text-[#E5E2E1]">
        Sepolia Vault Cluster
      </h2>

      {/* Vault Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-[#1c1b1b] bg-[#111111] p-6">
          <p className="text-sm uppercase tracking-wider text-[#787776]">
            Share Price
          </p>
          <p className="mt-2 text-3xl font-bold text-[#00E5FF]">
            {formatSharePrice(vault.sharePrice)}
          </p>
        </div>
        <div className="rounded-xl border border-[#1c1b1b] bg-[#111111] p-6">
          <p className="text-sm uppercase tracking-wider text-[#787776]">
            Total Assets
          </p>
          <p className="mt-2 text-3xl font-bold text-[#00E5FF]">
            {formatTotalAssets(vault.totalAssets)}
          </p>
        </div>
        <div className="rounded-xl border border-[#1c1b1b] bg-[#111111] p-6">
          <p className="text-sm uppercase tracking-wider text-[#787776]">
            Your Shares
          </p>
          <p className="mt-2 text-3xl font-bold text-[#00E5FF]">
            {formatShares(vault.userShares)}
          </p>
        </div>
      </div>

      {/* Deposit / Withdraw Forms Side by Side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Deposit Form */}
        <div className="rounded-xl border border-[#1c1b1b] bg-[#111111] p-6">
          <h3 className="text-lg font-bold uppercase tracking-wider text-[#E5E2E1] mb-4">
            Deposit USDC
          </h3>
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm text-[#787776]">Amount (USDC)</span>
              <input
                type="number"
                min="0"
                placeholder="0.00"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="mt-1 block w-full bg-[#1c1b1b] border border-[#313030] text-[#E5E2E1] rounded-lg px-4 py-2.5 placeholder-[#787776] focus:outline-none focus:ring-2 focus:ring-[#00E5FF]/50 focus:border-[#00E5FF]/50"
              />
            </label>
            <button
              type="button"
              disabled
              title="satellite.deposit()"
              className="w-full rounded-lg bg-[#00E5FF]/30 px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-[#00E5FF] cursor-not-allowed"
            >
              Deposit
            </button>
            <p className="text-xs text-[#787776]">
              Deposits are made on Sepolia via the Satellite contract
            </p>
          </div>
        </div>

        {/* Withdraw Form */}
        <div className="rounded-xl border border-[#1c1b1b] bg-[#111111] p-6">
          <h3 className="text-lg font-bold uppercase tracking-wider text-[#E5E2E1] mb-4">
            Withdraw Shares
          </h3>
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm text-[#787776]">Amount (shares)</span>
              <input
                type="number"
                min="0"
                placeholder="0.00"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                className="mt-1 block w-full bg-[#1c1b1b] border border-[#313030] text-[#E5E2E1] rounded-lg px-4 py-2.5 placeholder-[#787776] focus:outline-none focus:ring-2 focus:ring-[#00E5FF]/50 focus:border-[#00E5FF]/50"
              />
            </label>
            <button
              type="button"
              disabled
              title="satellite.requestWithdraw()"
              className="w-full rounded-lg bg-[#00E5FF]/30 px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-[#00E5FF] cursor-not-allowed"
            >
              Request Withdrawal
            </button>
            <p className="text-xs text-[#787776]">
              Tier 1: instant if idle reserve allows. Tier 2: queued for next
              epoch.
            </p>
          </div>
        </div>
      </div>

      {/* Pending Withdrawals */}
      <div className="rounded-xl border border-[#1c1b1b] bg-[#111111] p-6">
        <h3 className="text-lg font-bold uppercase tracking-wider text-[#E5E2E1] mb-4">
          Pending Withdrawals
        </h3>
        {vault.pendingWithdrawals.length === 0 ? (
          <p className="text-sm text-[#787776]">No pending withdrawals</p>
        ) : (
          <div className="space-y-3">
            {vault.pendingWithdrawals.map((w) => (
              <div
                key={w.epoch}
                className="flex items-center justify-between rounded-lg border border-[#1c1b1b] bg-[#0D0D0D] px-4 py-3"
              >
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-sm font-medium text-[#E5E2E1]">
                      Epoch {w.epoch}
                    </p>
                    <p className="text-xs text-[#787776]">
                      {formatShares(w.shares)} shares
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
                      w.status === "claimable"
                        ? "border-[#00E5FF]/30 bg-[#00E5FF]/10 text-[#00E5FF]"
                        : "border-[#7000FF]/30 bg-[#7000FF]/10 text-[#7000FF]"
                    }`}
                  >
                    {w.status}
                  </span>
                </div>
                {w.status === "claimable" && (
                  <button
                    type="button"
                    disabled
                    title="satellite.claim()"
                    className="rounded-lg bg-[#00E5FF]/30 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[#00E5FF] cursor-not-allowed"
                  >
                    Claim
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
