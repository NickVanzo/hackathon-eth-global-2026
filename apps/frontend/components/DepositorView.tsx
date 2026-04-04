"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { MOCK_VAULT } from "@/lib/mock-data";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

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
      {/* Vault Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <p className="text-sm text-gray-400">Share Price</p>
          <p className="mt-1 text-2xl font-semibold text-gray-100">
            {formatSharePrice(vault.sharePrice)}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-gray-400">Total Assets</p>
          <p className="mt-1 text-2xl font-semibold text-gray-100">
            {formatTotalAssets(vault.totalAssets)}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-gray-400">Your Shares</p>
          <p className="mt-1 text-2xl font-semibold text-gray-100">
            {formatShares(vault.userShares)}
          </p>
        </Card>
      </div>

      {/* Deposit / Withdraw Forms Side by Side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Deposit Form */}
        <Card>
          <h3 className="text-lg font-semibold text-gray-100 mb-4">
            Deposit USDC
          </h3>
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm text-gray-400">Amount (USDC)</span>
              <input
                type="number"
                min="0"
                placeholder="0.00"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="mt-1 block w-full bg-gray-800 border border-gray-700 text-gray-100 rounded-lg px-4 py-2 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </label>
            <button
              type="button"
              disabled
              title="satellite.deposit()"
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white opacity-50 cursor-not-allowed"
            >
              Deposit
            </button>
            <p className="text-xs text-gray-500">
              Deposits are made on Sepolia via the Satellite contract
            </p>
          </div>
        </Card>

        {/* Withdraw Form */}
        <Card>
          <h3 className="text-lg font-semibold text-gray-100 mb-4">
            Withdraw Shares
          </h3>
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm text-gray-400">Amount (shares)</span>
              <input
                type="number"
                min="0"
                placeholder="0.00"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                className="mt-1 block w-full bg-gray-800 border border-gray-700 text-gray-100 rounded-lg px-4 py-2 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </label>
            <button
              type="button"
              disabled
              title="satellite.requestWithdraw()"
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white opacity-50 cursor-not-allowed"
            >
              Request Withdrawal
            </button>
            <p className="text-xs text-gray-500">
              Tier 1: instant if idle reserve allows. Tier 2: queued for next
              epoch.
            </p>
          </div>
        </Card>
      </div>

      {/* Pending Withdrawals */}
      <Card>
        <h3 className="text-lg font-semibold text-gray-100 mb-4">
          Pending Withdrawals
        </h3>
        {vault.pendingWithdrawals.length === 0 ? (
          <p className="text-sm text-gray-500">No pending withdrawals</p>
        ) : (
          <div className="space-y-3">
            {vault.pendingWithdrawals.map((w) => (
              <div
                key={w.epoch}
                className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-800/50 px-4 py-3"
              >
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-200">
                      Epoch {w.epoch}
                    </p>
                    <p className="text-xs text-gray-400">
                      {formatShares(w.shares)} shares
                    </p>
                  </div>
                  <Badge
                    variant={
                      w.status === "claimable" ? "positive" : "neutral"
                    }
                  >
                    {w.status}
                  </Badge>
                </div>
                {w.status === "claimable" && (
                  <button
                    type="button"
                    disabled
                    title="satellite.claim()"
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white opacity-50 cursor-not-allowed"
                  >
                    Claim
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
