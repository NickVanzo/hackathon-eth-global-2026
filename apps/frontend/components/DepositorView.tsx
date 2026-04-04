"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { useVaultData, useUserVaultShares, useSatelliteBalance } from "@/lib/contracts";
import { MOCK_VAULT } from "@/lib/mock-data";

function formatSharePrice(raw: string): string {
  const value = Number(formatUnits(BigInt(raw), 6));
  return `$${value.toFixed(4)}`;
}

function formatTotalAssets(raw: string): string {
  const num = Number(formatUnits(BigInt(raw), 6));
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatIdleReserve(raw: string): string {
  const num = Number(formatUnits(BigInt(raw), 6));
  const idle = num * 0.2;
  return idle.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatShares(raw: string): string {
  const num = Number(formatUnits(BigInt(raw), 6));
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatShareValue(sharesRaw: string, priceRaw: string): string {
  const shares = Number(formatUnits(BigInt(sharesRaw), 6));
  const price = Number(formatUnits(BigInt(priceRaw), 6));
  const value = shares * price;
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DepositorView() {
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawTier, setWithdrawTier] = useState<"tier1" | "tier2" | null>(null);

  const { address } = useAccount();
  const { sharePrice, totalAssets, totalShares, isLoading } = useVaultData();
  const { shares: liveUserShares } = useUserVaultShares(address);
  const liveUsdcBalance = useSatelliteBalance(address);

  const vault = {
    sharePrice: sharePrice ?? MOCK_VAULT.sharePrice,
    totalAssets: totalAssets ?? MOCK_VAULT.totalAssets,
    totalShares: totalShares ?? MOCK_VAULT.totalShares,
    userShares: liveUserShares ?? MOCK_VAULT.userShares,
    pendingWithdrawals: MOCK_VAULT.pendingWithdrawals,
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1
            className="text-4xl font-extrabold tracking-tighter uppercase mb-2"
            style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#9cf0ff" }}
          >
            Sepolia Vault Cluster
          </h1>
          <p
            className="max-w-xl leading-relaxed text-sm"
            style={{ fontFamily: "'Manrope', sans-serif", color: "#bac9cc" }}
          >
            High-efficiency algorithmic liquidity management. Securely deposit{" "}
            <span style={{ color: "#c3f5ff" }}>USDC.e</span> into the ARENA_OS core.
            Governance-managed 20% idle reserve maintained for immediate Tier 1 liquidity.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <span
              className="px-3 py-1 rounded text-[10px] font-bold uppercase border"
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                backgroundColor: "#2a2a2a",
                color: "#bac9cc",
                borderColor: "rgba(59,73,76,0.1)",
              }}
            >
              v2.0.4-beta
            </span>
            <span
              className="px-3 py-1 rounded text-[10px] font-bold uppercase border"
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                backgroundColor: "rgba(0,229,255,0.1)",
                color: "#00e5ff",
                borderColor: "rgba(0,229,255,0.2)",
              }}
            >
              DEPOSITS_OPEN
            </span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        {/* Left Column */}
        <div className="md:col-span-8 flex flex-col gap-8">

          {/* Stat Cards */}
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {/* Share Price */}
            <div
              className="p-6 rounded-lg shadow-lg border-l-2"
              style={{
                backgroundColor: "#1c1b1b",
                borderLeftColor: "rgba(0,229,255,0.5)",
              }}
            >
              <div
                className="text-[10px] font-bold tracking-[0.2em] mb-4 uppercase"
                style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
              >
                VAULT_SHARE_PRICE
              </div>
              <div
                className="text-3xl font-bold tracking-tighter"
                style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#c3f5ff" }}
              >
                {formatSharePrice(vault.sharePrice)}
              </div>
              <div className="text-[10px] mt-1 font-mono" style={{ color: "#00E5FF" }}>
                +4.2% ALL_TIME
              </div>
            </div>

            {/* Total Assets */}
            <div
              className="p-6 rounded-lg shadow-lg border-l-2"
              style={{
                backgroundColor: "#1c1b1b",
                borderLeftColor: "rgba(0,229,255,0.2)",
              }}
            >
              <div
                className="text-[10px] font-bold tracking-[0.2em] mb-4 uppercase"
                style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
              >
                TOTAL_ASSETS
              </div>
              <div
                className="text-3xl font-bold tracking-tighter"
                style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#e5e2e1" }}
              >
                {formatTotalAssets(vault.totalAssets)}
              </div>
              <div className="text-[10px] mt-1 font-mono uppercase" style={{ color: "#bac9cc" }}>
                USDC.e (SEPOLIA)
              </div>
            </div>

            {/* Idle Reserve */}
            <div
              className="p-6 rounded-lg shadow-lg border-l-2"
              style={{
                backgroundColor: "#1c1b1b",
                borderLeftColor: "rgba(215,59,0,0.5)",
              }}
            >
              <div
                className="text-[10px] font-bold tracking-[0.2em] mb-4 uppercase"
                style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
              >
                IDLE_RESERVE
              </div>
              <div
                className="text-3xl font-bold tracking-tighter"
                style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#ffb5a0" }}
              >
                {formatIdleReserve(vault.totalAssets)}
              </div>
              <div
                className="text-[10px] mt-1 font-mono uppercase"
                style={{ color: "rgba(255,181,160,0.6)" }}
              >
                20.00% UTILIZATION
              </div>
            </div>
          </section>

          {/* Deposit / Withdraw Panel */}
          <section
            className="p-1 rounded-lg border"
            style={{ backgroundColor: "#201f1f", borderColor: "rgba(59,73,76,0.1)" }}
          >
            <div className="grid grid-cols-1 md:grid-cols-2">
              {/* Deposit Interface */}
              <div className="p-8 border-r" style={{ borderColor: "rgba(59,73,76,0.1)" }}>
                <h3
                  className="text-lg font-bold mb-6 tracking-widest uppercase flex items-center gap-2"
                  style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#9cf0ff" }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>input</span>
                  DEPOSIT_INTERFACE
                </h3>
                <div className="space-y-6">
                  <div>
                    <div
                      className="flex justify-between text-[10px] font-bold tracking-widest uppercase mb-2"
                      style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
                    >
                      <span>ASSET_INPUT</span>
                      <span>BALANCE: 5,000.00 USDC.e</span>
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="0.00"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        className="w-full border-b-2 text-2xl font-bold py-4 px-4 outline-none transition-all placeholder:opacity-20"
                        style={{
                          fontFamily: "'Space Grotesk', sans-serif",
                          backgroundColor: "#353534",
                          borderBottomColor: "#3b494c",
                          color: "#e5e2e1",
                        }}
                        onFocus={(e) => (e.currentTarget.style.borderBottomColor = "#9cf0ff")}
                        onBlur={(e) => (e.currentTarget.style.borderBottomColor = "#3b494c")}
                      />
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (liveUsdcBalance) {
                              const balanceNum = Number(liveUsdcBalance) / 1_000_000;
                              setDepositAmount(balanceNum.toFixed(2));
                            } else {
                              setDepositAmount("5000");
                            }
                          }}
                          className="text-[10px] font-bold px-2 py-1 rounded uppercase transition-all"
                          style={{
                            fontFamily: "'Space Grotesk', sans-serif",
                            color: "#00e5ff",
                            backgroundColor: "rgba(0,229,255,0.1)",
                          }}
                        >
                          MAX
                        </button>
                        <span
                          className="text-sm font-bold"
                          style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                        >
                          USDC.e
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isLoading}
                    className="w-full py-4 font-extrabold tracking-[0.2em] rounded uppercase transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      fontFamily: "'Space Grotesk', sans-serif",
                      backgroundColor: "#00e5ff",
                      color: "#00363d",
                      boxShadow: "0 0 20px rgba(0,229,255,0.2)",
                    }}
                    onMouseEnter={(e) => {
                      if (!isLoading) e.currentTarget.style.boxShadow = "0 0 30px rgba(0,229,255,0.4)";
                    }}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.boxShadow = "0 0 20px rgba(0,229,255,0.2)")
                    }
                  >
                    {isLoading ? "LOADING..." : "EXECUTE_DEPOSIT"}
                  </button>
                  <p
                    className="text-[10px] leading-relaxed text-center italic"
                    style={{ fontFamily: "'Manrope', sans-serif", color: "rgba(186,201,204,0.6)" }}
                  >
                    Deposits are processed by the{" "}
                    <span style={{ color: "#9cf0ff" }}>Satellite</span> custodian. Accounting is
                    reflected on the <span style={{ color: "#9cf0ff" }}>Vault</span> ledger.
                  </p>
                </div>
              </div>

              {/* Withdraw Interface */}
              <div className="p-8" style={{ backgroundColor: "rgba(28,27,27,0.5)" }}>
                <h3
                  className="text-lg font-bold mb-6 tracking-widest uppercase flex items-center gap-2"
                  style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#ffb5a0" }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>output</span>
                  WITHDRAW_INTERFACE
                </h3>
                <div className="space-y-6">
                  <div className="flex flex-col gap-4">
                    {/* Tier 1 */}
                    <button
                      type="button"
                      onClick={() => setWithdrawTier("tier1")}
                      className="flex flex-col items-start p-4 rounded border-2 transition-all group text-left"
                      style={{
                        backgroundColor: "#2a2a2a",
                        borderColor:
                          withdrawTier === "tier1"
                            ? "rgba(0,229,255,0.5)"
                            : "rgba(59,73,76,0.3)",
                      }}
                    >
                      <div className="flex justify-between w-full mb-1">
                        <span
                          className="text-xs font-black tracking-widest uppercase"
                          style={{
                            fontFamily: "'Space Grotesk', sans-serif",
                            color: "#e5e2e1",
                          }}
                        >
                          TIER 1 (INSTANT)
                        </span>
                        <span
                          className="material-symbols-outlined"
                          style={{
                            fontSize: 20,
                            color:
                              withdrawTier === "tier1" ? "#00e5ff" : "#bac9cc",
                          }}
                        >
                          bolt
                        </span>
                      </div>
                      <p
                        className="text-[10px] leading-tight text-left"
                        style={{ color: "#bac9cc" }}
                      >
                        Access the 20% idle reserve. Settlement occurs within 1 transaction block.
                      </p>
                    </button>

                    {/* Tier 2 */}
                    <button
                      type="button"
                      onClick={() => setWithdrawTier("tier2")}
                      className="flex flex-col items-start p-4 rounded border-2 transition-all group text-left"
                      style={{
                        backgroundColor: "#2a2a2a",
                        borderColor:
                          withdrawTier === "tier2"
                            ? "rgba(215,59,0,0.5)"
                            : "rgba(59,73,76,0.3)",
                      }}
                    >
                      <div className="flex justify-between w-full mb-1">
                        <span
                          className="text-xs font-black tracking-widest uppercase"
                          style={{
                            fontFamily: "'Space Grotesk', sans-serif",
                            color: "#e5e2e1",
                          }}
                        >
                          TIER 2 (QUEUE)
                        </span>
                        <span
                          className="material-symbols-outlined"
                          style={{
                            fontSize: 20,
                            color:
                              withdrawTier === "tier2" ? "#d73b00" : "#bac9cc",
                          }}
                        >
                          hourglass_top
                        </span>
                      </div>
                      <p
                        className="text-[10px] leading-tight text-left"
                        style={{ color: "#bac9cc" }}
                      >
                        Withdrawal-driven force-close of active agent positions. Queue depth: 12.4H.
                      </p>
                    </button>
                  </div>

                  {/* Share Info */}
                  <div
                    className="pt-4 border-t"
                    style={{ borderColor: "rgba(59,73,76,0.1)" }}
                  >
                    <div
                      className="flex justify-between text-[10px] font-bold tracking-widest uppercase mb-2"
                      style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
                    >
                      <span>USER_SHARES</span>
                      <span>{formatShares(vault.userShares)} SHARES</span>
                    </div>
                    <div
                      className="text-xs flex justify-between"
                      style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
                    >
                      <span>EQUIVALENT_VALUE</span>
                      <span style={{ color: "#9cf0ff" }}>
                        ~ {formatShareValue(vault.userShares, vault.sharePrice)} USDC.e
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column */}
        <div className="md:col-span-4 flex flex-col gap-8">

          {/* System Arch */}
          <section
            className="p-6 rounded-lg border"
            style={{ backgroundColor: "#201f1f", borderColor: "rgba(59,73,76,0.1)" }}
          >
            <h3
              className="text-xs font-black mb-6 tracking-[0.25em] uppercase border-b pb-4"
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                color: "#9cf0ff",
                borderColor: "rgba(59,73,76,0.2)",
              }}
            >
              SYSTEM_ARCH
            </h3>
            <div className="space-y-6">
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 20, color: "#00e5ff" }}
                  >
                    account_balance
                  </span>
                </div>
                <div>
                  <h4
                    className="text-xs font-bold mb-1"
                    style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#e5e2e1" }}
                  >
                    VAULT (PURE_ACCOUNTING)
                  </h4>
                  <p
                    className="text-[10px] leading-relaxed"
                    style={{ fontFamily: "'Manrope', sans-serif", color: "#bac9cc" }}
                  >
                    The core mathematical engine. It tracks liabilities, share pricing, and profit
                    distributions without ever holding actual tokens.
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 20, color: "#00e5ff" }}
                  >
                    satellite_alt
                  </span>
                </div>
                <div>
                  <h4
                    className="text-xs font-bold mb-1"
                    style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#e5e2e1" }}
                  >
                    SATELLITE (TOKEN_CUSTODIAN)
                  </h4>
                  <p
                    className="text-[10px] leading-relaxed"
                    style={{ fontFamily: "'Manrope', sans-serif", color: "#bac9cc" }}
                  >
                    The hard-asset silo. Responsible for holding underlying USDC.e and managing the
                    primary liquidity pool for external protocols.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Tier 2 Technical Spec */}
          <section
            className="p-6 rounded-lg border relative overflow-hidden"
            style={{ backgroundColor: "#201f1f", borderColor: "rgba(59,73,76,0.1)" }}
          >
            <div className="absolute -right-8 -bottom-8 opacity-10 pointer-events-none">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 160, color: "#ffb5a0" }}
              >
                warning
              </span>
            </div>
            <h3
              className="text-xs font-black mb-6 tracking-[0.25em] uppercase border-b pb-4 relative z-10"
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                color: "#ffb5a0",
                borderColor: "rgba(59,73,76,0.2)",
              }}
            >
              TIER_2_TECHNICAL_SPEC
            </h3>
            <div className="space-y-4 relative z-10">
              <p
                className="text-[11px] leading-relaxed font-medium"
                style={{ fontFamily: "'Manrope', sans-serif", color: "#bac9cc" }}
              >
                Tier 2 withdrawals trigger a{" "}
                <span style={{ color: "#ffb5a0" }}>
                  Withdrawal-Driven Force-Close (WDFC)
                </span>{" "}
                sequence.
              </p>
              <div
                className="p-4 border-l"
                style={{
                  backgroundColor: "rgba(53,53,52,0.5)",
                  borderLeftColor: "rgba(255,181,160,0.3)",
                }}
              >
                <ol
                  className="text-[10px] space-y-3 font-mono"
                  style={{ color: "#bac9cc" }}
                >
                  <li>1. Request enters global exit queue.</li>
                  <li>2. ARENA_OS identifies over-leveraged agents.</li>
                  <li>3. Automated de-leveraging of riskier clusters.</li>
                  <li>4. Realized PnL flows to Satellite custodian.</li>
                  <li>5. Queue fills until withdrawal amount is met.</li>
                </ol>
              </div>
              <p
                className="text-[10px] leading-relaxed italic"
                style={{ fontFamily: "'Manrope', sans-serif", color: "#bac9cc" }}
              >
                *Note: WDFC may cause minor slippage for remaining depositors to ensure system
                stability.
              </p>
            </div>
          </section>

          {/* Network Fees */}
          <section
            className="p-6 rounded-lg border"
            style={{ backgroundColor: "#1c1b1b", borderColor: "rgba(59,73,76,0.1)" }}
          >
            <div className="flex justify-between items-center mb-4">
              <h3
                className="text-[10px] font-black tracking-widest uppercase"
                style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
              >
                NETWORK_FEES
              </h3>
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14, color: "#bac9cc" }}
              >
                info
              </span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] font-mono">
                <span style={{ color: "#bac9cc" }}>DEPOSIT_FEE:</span>
                <span style={{ color: "#9cf0ff" }}>0.00%</span>
              </div>
              <div className="flex justify-between text-[10px] font-mono">
                <span style={{ color: "#bac9cc" }}>PERFORMANCE_FEE:</span>
                <span style={{ color: "#9cf0ff" }}>15.00%</span>
              </div>
              <div className="flex justify-between text-[10px] font-mono">
                <span style={{ color: "#bac9cc" }}>EXIT_FEE (TIER 1):</span>
                <span style={{ color: "#ffb5a0" }}>0.10%</span>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Footer */}
      <footer
        className="mt-20 pt-8 border-t flex flex-col md:flex-row justify-between items-center gap-6"
        style={{ borderColor: "rgba(59,73,76,0.1)" }}
      >
        <div className="flex items-center gap-6">
          <span
            className="text-[10px] font-bold tracking-[0.2em] uppercase opacity-40"
            style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
          >
            © 2024 ARENA_OS_PROTOCOLS
          </span>
          <div className="flex gap-4">
            <span
              className="material-symbols-outlined cursor-pointer transition-colors"
              style={{ color: "#bac9cc", fontSize: 20 }}
            >
              data_object
            </span>
            <span
              className="material-symbols-outlined cursor-pointer transition-colors"
              style={{ color: "#bac9cc", fontSize: 20 }}
            >
              description
            </span>
            <span
              className="material-symbols-outlined cursor-pointer transition-colors"
              style={{ color: "#bac9cc", fontSize: 20 }}
            >
              terminal
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div
            className="px-3 py-1 rounded border text-[10px] font-mono"
            style={{
              backgroundColor: "#2a2a2a",
              borderColor: "rgba(59,73,76,0.1)",
              color: "#bac9cc",
            }}
          >
            CONTRACT:{" "}
            <span style={{ color: "#9cf0ff" }}>0x71C...4f2E</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: "#00e5ff" }}
            />
            <span
              className="text-[10px] font-bold uppercase tracking-widest"
              style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
            >
              SYNCHRONIZED
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
