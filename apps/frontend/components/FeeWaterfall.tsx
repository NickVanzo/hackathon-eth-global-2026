"use client";

import { useFeeData } from "@/lib/contracts";
import { useFeeEpochHistory } from "@/lib/useIndexedData";
import type { FeeEpoch } from "@/lib/indexer";
import { LoadingIndicator } from "@/components/LoadingSkeleton";

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatUsdc(raw: string): string {
  const units = Number(raw) / 1_000_000;
  return units.toFixed(6);
}

// ─── Stat Pill ───────────────────────────────────────────────────────────────

function StatPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: "10px",
        padding: "14px 20px",
        background: "#1a1a1a",
        borderBottom: `2px solid ${accent}`,
      }}
    >
      <span
        style={{
          fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
          fontSize: "22px",
          fontWeight: 700,
          color: "#e5e2e1",
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: "10px",
          fontWeight: 500,
          color: accent,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
        }}
      >
        USDC
      </span>
      <span
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: "9px",
          fontWeight: 400,
          color: "#6b7a7d",
          textTransform: "uppercase",
          letterSpacing: "0.15em",
          marginLeft: "auto",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ─── Epoch Row ───────────────────────────────────────────────────────────────

function EpochRow({ row, isCurrent }: { row: FeeEpoch; isCurrent: boolean }) {
  return (
    <tr
      style={{
        borderBottom: "1px solid rgba(59,73,76,0.12)",
        background: isCurrent ? "rgba(0,229,255,0.03)" : "transparent",
      }}
      className="hover:bg-[rgba(255,255,255,0.015)] transition-colors duration-100"
    >
      {/* Epoch # */}
      <td
        style={{
          padding: "8px 12px",
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: "12px",
          fontWeight: 700,
          color: isCurrent ? "#00daf3" : "#e5e2e1",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          {isCurrent && (
            <span
              style={{
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                background: "#00daf3",
                boxShadow: "0 0 6px rgba(0,218,243,0.6)",
                flexShrink: 0,
              }}
            />
          )}
          #{String(row.epoch).padStart(2, "0")}
        </span>
      </td>

      {/* Protocol Fee */}
      <td style={{ padding: "8px 12px", textAlign: "right" }}>
        <span style={{ fontFamily: "'JetBrains Mono', 'SF Mono', monospace", fontSize: "12px", color: "#c4adff" }}>
          {formatUsdc(row.protocolFee)}
        </span>
      </td>

      {/* Commission */}
      <td style={{ padding: "8px 12px", textAlign: "right" }}>
        <span style={{ fontFamily: "'JetBrains Mono', 'SF Mono', monospace", fontSize: "12px", color: "#ffb5a0" }}>
          {formatUsdc(row.commission)}
        </span>
      </td>

      {/* Depositor Yield */}
      <td style={{ padding: "8px 12px", textAlign: "right" }}>
        <span style={{ fontFamily: "'JetBrains Mono', 'SF Mono', monospace", fontSize: "12px", color: "#00daf3" }}>
          {formatUsdc(row.depositorYield)}
        </span>
      </td>

      {/* Share Price */}
      <td style={{ padding: "8px 12px", textAlign: "right" }}>
        <span style={{ fontFamily: "'JetBrains Mono', 'SF Mono', monospace", fontSize: "12px", color: "#e5e2e1" }}>
          {(Number(row.sharePrice) / 1_000_000).toFixed(6)}
        </span>
      </td>
    </tr>
  );
}

// ─── Epoch Table ─────────────────────────────────────────────────────────────

function EpochTable({ epochs: rawEpochs }: { epochs: FeeEpoch[] }) {
  // Deduplicate by blockTimestamp (keep first seen), sort ascending, number 1→N
  const seen = new Set<string>();
  const deduped = rawEpochs.filter((e) => {
    if (seen.has(e.blockTimestamp)) return false;
    seen.add(e.blockTimestamp);
    return true;
  });
  const sorted = [...deduped].sort((a, b) => Number(a.blockTimestamp) - Number(b.blockTimestamp));
  const epochs = sorted.map((e, i) => ({ ...e, epoch: i + 1 })).reverse();
  const currentEpoch = epochs.length > 0 ? epochs[0].epoch : 0;

  const headers = [
    { label: "EPOCH", align: "left" as const },
    { label: "PROTOCOL FEE", align: "right" as const, unit: "USDC" },
    { label: "COMMISSION", align: "right" as const, unit: "USDC" },
    { label: "DEPOSITOR YIELD", align: "right" as const, unit: "USDC" },
    { label: "SHARE PRICE", align: "right" as const, unit: "USDC" },
  ];

  return (
    <div
      style={{
        background: "#181818",
        border: "1px solid rgba(59,73,76,0.2)",
        overflow: "hidden",
      }}
    >
      {/* Table scroll container */}
      <div
        style={{ maxHeight: "520px", overflowY: "auto", overflowX: "auto" }}
        role="group"
        tabIndex={0}
        aria-label="Per-epoch fee breakdown"
      >
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "640px" }}>
          <caption className="sr-only">Per-epoch fee breakdown</caption>
          <thead>
            <tr
              style={{
                position: "sticky",
                top: 0,
                background: "#1e1e1e",
                zIndex: 1,
                borderBottom: "1px solid rgba(59,73,76,0.3)",
              }}
            >
              {headers.map((h) => (
                <th
                  key={h.label}
                  scope="col"
                  style={{
                    padding: "10px 12px",
                    textAlign: h.align,
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: "9px",
                    fontWeight: 600,
                    color: "#6b7a7d",
                    textTransform: "uppercase",
                    letterSpacing: "0.14em",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h.label}
                  {h.unit && (
                    <span style={{ color: "#4a5557", marginLeft: "4px", fontWeight: 400 }}>
                      ({h.unit})
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {epochs.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    padding: "40px 12px",
                    textAlign: "center",
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: "11px",
                    color: "#4a5557",
                    textTransform: "uppercase",
                    letterSpacing: "0.15em",
                  }}
                >
                  No epoch data yet
                </td>
              </tr>
            ) : (
              epochs.map((row) => (
                <EpochRow key={row.epoch} row={row} isCurrent={row.epoch === currentEpoch} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 12px",
          background: "#1e1e1e",
          borderTop: "1px solid rgba(59,73,76,0.2)",
        }}
      >
        <span
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: "9px",
            color: "#4a5557",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
          }}
        >
          {epochs.length} epoch{epochs.length !== 1 ? "s" : ""} indexed
        </span>
        <span
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: "9px",
            color: "#4a5557",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
          }}
        >
          All values in USDC (6 decimals)
        </span>
      </div>
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export default function FeeWaterfall() {
  const {
    protocolFeesAccrued: liveProtocolFees,
    commissionPool: liveCommissionPool,
    isLoading: isFeeLoading,
  } = useFeeData();
  const { epochs } = useFeeEpochHistory(30);

  const protocolFeesAccrued = liveProtocolFees ?? "0";
  const commissionPool = liveCommissionPool ?? "0";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {isFeeLoading && <LoadingIndicator label="LOADING FEE DATA" />}

      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: `@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');` }} />

      {/* ── Summary pills ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: "rgba(59,73,76,0.15)" }}>
        <StatPill label="Protocol Fees" value={formatUsdc(protocolFeesAccrued)} accent="#c4adff" />
        <StatPill label="Commission Pool" value={formatUsdc(commissionPool)} accent="#ffb5a0" />
      </div>

      {/* ── Epoch table ── */}
      <EpochTable epochs={epochs} />
    </div>
  );
}
