"use client";

import { useFeeData } from "@/lib/contracts";
import { MOCK_FEES } from "@/lib/mock-data";

// ─── Formatting ───────────────────────────────────────────────────────────────

/** Convert a 6-decimal USDC string (e.g. "75000000000") to "$75,000.00" */
function formatUsdc(raw: string): string {
  const units = Number(raw) / 1_000_000;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(units);
}

/** Format share-price string (6-decimal) as decimal ratio, e.g. "1052000" → "1.052000" */
function formatSharePrice(raw: string): string {
  return (Number(raw) / 1_000_000).toFixed(6);
}

// ─── Tier Breakdown Cards (vault-exit.html: Tier 1 + Tier 2 pattern) ─────────

interface TierCardProps {
  tier: "liquid" | "staked";
  label: string;
  amount: string;
  subtitle: string;
}

function TierCard({ tier, label, amount, subtitle }: TierCardProps) {
  const isLiquid = tier === "liquid";
  const accentColor = isLiquid ? "#00daf3" : "#ffb5a0";

  return (
    <div
      className="p-4"
      style={{
        background: "#1c1b1b",
        borderLeft: `2px solid ${accentColor}`,
      }}
    >
      <div
        className="font-['Space_Grotesk'] uppercase tracking-widest mb-1"
        style={{ fontSize: "10px", color: accentColor }}
      >
        {label}
      </div>
      <div
        className="font-['Space_Grotesk'] font-bold"
        style={{
          fontSize: "24px",
          color: isLiquid ? "#e5e2e1" : "#ffb5a0",
        }}
      >
        {amount}{" "}
        <span
          className="font-normal"
          style={{ fontSize: "14px", color: "#bac9cc" }}
        >
          USDC
        </span>
      </div>
      <div
        className="font-['Manrope'] mt-2"
        style={{
          fontSize: "10px",
          color: isLiquid ? "#bac9cc" : "rgba(255,181,160,0.7)",
        }}
      >
        {subtitle}
      </div>
    </div>
  );
}

// ─── Withdrawal Protocol Status Bar (vault-exit.html step track) ──────────────

const WITHDRAWAL_STEPS = [
  { icon: "rocket_launch", label: "REQUEST" },
  { icon: "schedule", label: "EPOCH_SETTLE" },
  { icon: "gavel", label: "FORCE_CLOSE" },
  { icon: "payments", label: "PAYOUT" },
] as const;

interface ProtocolStepBarProps {
  activeStep?: number; // 0-based
}

function ProtocolStepBar({ activeStep = 0 }: ProtocolStepBarProps) {
  const progressPercent = (activeStep / (WITHDRAWAL_STEPS.length - 1)) * 100;

  return (
    <div className="space-y-4">
      <div
        className="flex justify-between font-['Space_Grotesk'] uppercase tracking-widest"
        style={{ fontSize: "10px", color: "#bac9cc" }}
      >
        <span>Withdrawal Protocol Status</span>
        <span style={{ color: "#9cf0ff" }}>
          Phase {activeStep + 1}/{WITHDRAWAL_STEPS.length}:{" "}
          {WITHDRAWAL_STEPS[activeStep].label}
        </span>
      </div>

      <div className="relative flex items-center justify-between">
        {/* Track */}
        <div
          className="absolute left-0 w-full h-0.5"
          style={{
            top: "50%",
            transform: "translateY(-50%)",
            background: "rgba(59,73,76,0.3)",
          }}
          aria-hidden="true"
        />
        {/* Active track */}
        <div
          className="absolute left-0 h-0.5 transition-all duration-500"
          style={{
            top: "50%",
            transform: "translateY(-50%)",
            width: `${progressPercent}%`,
            background: "#00e5ff",
            boxShadow: "0 0 10px #00e5ff",
          }}
          aria-hidden="true"
        />

        {WITHDRAWAL_STEPS.map(({ icon, label }, i) => {
          const isDone = i < activeStep;
          const isCurrent = i === activeStep;

          return (
            <div
              key={label}
              className="relative z-10 flex flex-col items-center"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{
                  background: isCurrent || isDone ? "#00e5ff" : "#353534",
                  color: isCurrent || isDone ? "#00363d" : "#bac9cc",
                  border: `4px solid #201f1f`,
                  boxShadow:
                    isCurrent
                      ? "0 0 15px rgba(0,229,255,0.4)"
                      : "none",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: "16px" }}
                  aria-hidden="true"
                >
                  {icon}
                </span>
              </div>
              <span
                className="font-['Space_Grotesk'] mt-2 tracking-tighter"
                style={{
                  fontSize: "9px",
                  color: isCurrent ? "#00e5ff" : "#bac9cc",
                  fontWeight: isCurrent ? "700" : "400",
                }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tactical Warning Banner ──────────────────────────────────────────────────

function TacticalWarning() {
  return (
    <div
      className="p-4"
      style={{
        background: "rgba(215,59,0,0.07)",
        border: "1px solid rgba(255,181,160,0.3)",
      }}
    >
      <div className="flex items-start gap-4">
        <span
          className="material-symbols-outlined mt-0.5"
          style={{ color: "#ffb5a0" }}
          aria-hidden="true"
        >
          error
        </span>
        <div className="space-y-2">
          <h4
            className="font-['Space_Grotesk'] font-bold uppercase tracking-widest"
            style={{ fontSize: "12px", color: "#ffb5a0" }}
          >
            Withdrawal-Driven Force-Close May Be Required
          </h4>
          <p
            className="font-['Manrope'] leading-relaxed"
            style={{ fontSize: "12px", color: "#bac9cc" }}
          >
            Commission and protocol fees are deducted at each epoch boundary
            before yield reaches depositors. A{" "}
            <span className="text-white font-bold">Force-Close</span> on
            under-performing agents may be triggered to optimise vault health.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Metrics Bento (vault-exit 3-col bento) ───────────────────────────────────

interface MetricBentoItemProps {
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
}

function MetricBentoItem({
  label,
  value,
  sub,
  valueColor = "#c3f5ff",
}: MetricBentoItemProps) {
  return (
    <div
      className="p-3"
      style={{
        background: "rgba(53,53,52,0.3)",
        border: "1px solid rgba(59,73,76,0.2)",
      }}
    >
      <div
        className="font-['Space_Grotesk'] uppercase mb-1"
        style={{ fontSize: "9px", color: "#bac9cc" }}
      >
        {label}
      </div>
      <div
        className="font-['Space_Grotesk'] font-bold tracking-tight"
        style={{ fontSize: "14px", color: valueColor }}
      >
        {value}
      </div>
      <div
        className="font-['Space_Grotesk'] mt-1"
        style={{ fontSize: "9px", color: "#52595a" }}
      >
        {sub}
      </div>
    </div>
  );
}

// ─── Fee Waterfall Bars (styled like vault-exit.html tier rows) ───────────────

interface WaterfallRowProps {
  label: string;
  pct: number;
  fillColor: string;
  description: string;
}

function WaterfallRow({ label, pct, fillColor, description }: WaterfallRowProps) {
  return (
    <div className="flex items-center gap-4">
      <span
        className="w-36 shrink-0 text-right font-['Space_Grotesk'] uppercase tracking-wider"
        style={{ fontSize: "11px", color: "#849396" }}
      >
        {label}
      </span>
      <div
        className="relative h-8 flex-1 overflow-hidden"
        style={{ background: "#1c1b1b" }}
        role="img"
        aria-label={`${label}: ${pct}%`}
      >
        <div
          className="flex h-full items-center justify-end pr-3 transition-all duration-500"
          style={{ width: `${pct}%`, background: fillColor }}
        >
          <span
            className="font-['Space_Grotesk'] font-bold"
            style={{ fontSize: "12px", color: "#fff" }}
          >
            {pct}%
          </span>
        </div>
      </div>
      <span
        className="w-40 shrink-0 font-['Manrope']"
        style={{ fontSize: "12px", color: "#849396" }}
      >
        {description}
      </span>
    </div>
  );
}

function FeeWaterfallDiagram() {
  return (
    <div className="flex flex-col gap-3">
      <WaterfallRow
        label="Gross Yield"
        pct={100}
        fillColor="#353534"
        description="Total vault earnings"
      />
      <WaterfallRow
        label="Protocol Fee"
        pct={5}
        fillColor="#5700c9"
        description="5% → protocol treasury"
      />
      <WaterfallRow
        label="Commission"
        pct={10}
        fillColor="#d73b00"
        description="10% → agent operators"
      />
      <WaterfallRow
        label="Net Depositor"
        pct={85}
        fillColor="#00daf3"
        description="85% → depositors"
      />
    </div>
  );
}

// ─── Stacked proportion bar ───────────────────────────────────────────────────

function StackedBar() {
  return (
    <div
      className="mt-4 flex h-6 w-full overflow-hidden"
      role="img"
      aria-label="Fee split: 5% protocol, 10% commission, 85% depositor"
    >
      <div
        className="flex items-center justify-center font-['Space_Grotesk'] font-bold text-white"
        style={{ width: "5%", background: "#5700c9", fontSize: "11px" }}
        title="Protocol fee 5%"
      >
        5%
      </div>
      <div
        className="flex items-center justify-center font-['Space_Grotesk'] font-bold text-white"
        style={{ width: "10%", background: "#d73b00", fontSize: "11px" }}
        title="Commission 10%"
      >
        10%
      </div>
      <div
        className="flex flex-1 items-center justify-center font-['Space_Grotesk'] font-bold text-white"
        style={{ background: "#00daf3", color: "#001f24", fontSize: "11px" }}
        title="Depositor yield 85%"
      >
        85%
      </div>
    </div>
  );
}

function ColorLegend() {
  const items = [
    { color: "#5700c9", label: "Protocol Fee" },
    { color: "#d73b00", label: "Commission" },
    { color: "#00daf3", label: "Depositor Yield" },
  ];

  return (
    <div className="mt-3 flex flex-wrap gap-4">
      {items.map(({ color, label }) => (
        <div key={label} className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3"
            style={{ background: color }}
            aria-hidden="true"
          />
          <span
            className="font-['Manrope']"
            style={{ fontSize: "12px", color: "#849396" }}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Share-price trend indicator ──────────────────────────────────────────────

function SharePriceTrend({
  current,
  previous,
}: {
  current: string;
  previous: string | undefined;
}) {
  if (previous === undefined) {
    return <span style={{ color: "#849396" }}>—</span>;
  }

  const isUp = Number(current) >= Number(previous);

  return (
    <span
      className="inline-flex items-center gap-1"
      style={{ color: isUp ? "#00daf3" : "#ffb5a0" }}
      aria-label={isUp ? "trending up" : "trending down"}
    >
      {isUp ? "↑" : "↓"}
    </span>
  );
}

// ─── Per-epoch table ──────────────────────────────────────────────────────────

function EpochTable() {
  const { epochs } = MOCK_FEES;
  const currentEpoch = epochs[0].epoch;

  return (
    <div
      className="overflow-x-auto"
      role="group"
      tabIndex={0}
      aria-label="Per-epoch fee breakdown"
    >
      <table className="w-full border-collapse" style={{ fontSize: "14px" }}>
        <caption className="sr-only">Per-epoch fee breakdown</caption>
        <thead>
          <tr
            className="text-left"
            style={{ borderBottom: "1px solid #1c1b1b" }}
          >
            {["Epoch", "Protocol Fee", "Commission", "Depositor Yield", "Share Price"].map(
              (col) => (
                <th
                  key={col}
                  scope="col"
                  className="pb-3 pr-4 font-['Space_Grotesk'] uppercase tracking-wider"
                  style={{ fontSize: "10px", color: "#849396", fontWeight: 500 }}
                >
                  {col}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {epochs.map((row, index) => {
            const previousEpoch = epochs[index + 1];
            const isCurrent = row.epoch === currentEpoch;

            return (
              <tr
                key={row.epoch}
                style={{
                  borderBottom: "1px solid #1c1b1b",
                  background: "#131313",
                  borderLeft: isCurrent ? "2px solid #00daf3" : "2px solid transparent",
                  fontWeight: isCurrent ? 600 : 400,
                  transition: "background 0.15s",
                }}
                className={isCurrent ? "" : "hover:bg-[#1c1b1b]"}
              >
                <td className="py-3 pr-4" style={{ color: "#e5e2e1" }}>
                  <span className="flex items-center gap-2">
                    {row.epoch}
                    {isCurrent && (
                      <span
                        className="font-['Space_Grotesk'] font-bold px-2 py-0.5"
                        style={{
                          fontSize: "9px",
                          color: "#00daf3",
                          background: "rgba(0,218,243,0.1)",
                          border: "1px solid rgba(0,218,243,0.4)",
                        }}
                      >
                        current
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-3 pr-4" style={{ color: "#d1bcff" }}>
                  {formatUsdc(row.protocolFee)}
                </td>
                <td className="py-3 pr-4" style={{ color: "#ffb5a0" }}>
                  {formatUsdc(row.commission)}
                </td>
                <td className="py-3 pr-4" style={{ color: "#00daf3" }}>
                  {formatUsdc(row.depositorYield)}
                </td>
                <td className="py-3">
                  <span
                    className="flex items-center gap-2"
                    style={{ color: "#e5e2e1" }}
                  >
                    {formatSharePrice(row.sharePrice)}
                    <SharePriceTrend
                      current={row.sharePrice}
                      previous={previousEpoch?.sharePrice}
                    />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Modal Footer: payout summary + actions ───────────────────────────────────

function PayoutSummaryFooter({ protocolFeesAccrued, commissionPool, depositorYield }: { protocolFeesAccrued: string; commissionPool: string; depositorYield: string }) {
  const totalRaw =
    Number(protocolFeesAccrued) + Number(commissionPool) + Number(depositorYield);
  const total = (totalRaw / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <div
      className="flex items-center justify-between gap-6 px-6 py-5"
      style={{
        background: "rgba(53,53,52,0.5)",
        borderTop: "1px solid rgba(59,73,76,0.3)",
      }}
    >
      <div className="flex-1">
        <div
          className="font-['Space_Grotesk'] uppercase tracking-widest mb-1"
          style={{ fontSize: "10px", color: "#52595a" }}
        >
          Total Accrued Amount
        </div>
        <div
          className="font-['Space_Grotesk'] font-bold tracking-tighter"
          style={{ fontSize: "20px", color: "#e5e2e1" }}
        >
          ${total} USDC
        </div>
      </div>
      <div className="flex gap-4">
        <button
          className="px-6 py-3 font-['Space_Grotesk'] text-xs font-bold uppercase tracking-widest transition-colors"
          style={{ color: "#849396" }}
        >
          ABORT_CMD
        </button>
        <button
          className="px-8 py-3 font-['Space_Grotesk'] text-xs font-extrabold uppercase tracking-widest transition-all hover:brightness-125 active:scale-95"
          style={{
            background: "#d73b00",
            color: "#fffbff",
            boxShadow: "0 0 20px rgba(215,59,0,0.3)",
          }}
        >
          CONFIRM_LIQUIDATION
        </button>
      </div>
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export default function FeeWaterfall() {
  const { protocolFeesAccrued: liveProtocolFees, commissionPool: liveCommissionPool, totalAssets: liveTotalAssets } = useFeeData();

  const fees = {
    protocolFeesAccrued: liveProtocolFees ?? MOCK_FEES.protocolFeesAccrued,
    commissionPool: liveCommissionPool ?? MOCK_FEES.commissionPool,
    depositorYield: liveTotalAssets ?? MOCK_FEES.depositorYield,
    epochs: MOCK_FEES.epochs,
  };

  const { protocolFeesAccrued, commissionPool, depositorYield } = fees;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Section heading ── */}
      <div>
        <h2
          id="fee-waterfall-heading"
          className="font-['Space_Grotesk'] uppercase tracking-widest mb-1"
          style={{ fontSize: "28px", fontWeight: 700, color: "#e5e2e1" }}
        >
          Fee Waterfall
        </h2>
        <p
          className="font-['Manrope']"
          style={{ fontSize: "14px", color: "#bac9cc" }}
        >
          Gross yield flows through protocol fees and operator commissions before reaching depositors.
        </p>
      </div>

      {/* ── Tier breakdown cards (vault-exit pattern) ── */}
      <section aria-labelledby="tier-heading">
        <h3
          id="tier-heading"
          className="font-['Space_Grotesk'] uppercase tracking-widest mb-3"
          style={{ fontSize: "10px", color: "#849396" }}
        >
          Accrual Tiers
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <TierCard
            tier="liquid"
            label="PROTOCOL FEES (TIER 1)"
            amount={(Number(protocolFeesAccrued) / 1_000_000).toLocaleString("en-US", {
              minimumFractionDigits: 2,
            })}
            subtitle="Available for immediate settlement post-epoch."
          />
          <TierCard
            tier="staked"
            label="COMMISSION POOL (TIER 2)"
            amount={(Number(commissionPool) / 1_000_000).toLocaleString("en-US", {
              minimumFractionDigits: 2,
            })}
            subtitle="Requires tactical agent liquidation."
          />
          <TierCard
            tier="liquid"
            label="DEPOSITOR YIELD (TIER 3)"
            amount={(Number(depositorYield) / 1_000_000).toLocaleString("en-US", {
              minimumFractionDigits: 2,
            })}
            subtitle="Net yield distributed to vault shares."
          />
        </div>
      </section>

      {/* ── Withdrawal protocol status track ── */}
      <section
        aria-labelledby="protocol-status-heading"
        className="p-6"
        style={{
          background: "#201f1f",
          border: "1px solid rgba(59,73,76,0.2)",
        }}
      >
        <h3
          id="protocol-status-heading"
          className="font-['Space_Grotesk'] uppercase tracking-widest mb-6"
          style={{ fontSize: "10px", color: "#849396" }}
        >
          Distribution Protocol
        </h3>
        <ProtocolStepBar activeStep={0} />
      </section>

      {/* ── Tactical warning ── */}
      <TacticalWarning />

      {/* ── Metrics bento ── */}
      <div className="grid grid-cols-3 gap-3" aria-label="Fee metrics">
        <MetricBentoItem
          label="Next Distribution"
          value="~ 14h 22m"
          sub="Next Epoch: #4,291"
          valueColor="#c3f5ff"
        />
        <MetricBentoItem
          label="Network Impact"
          value="-0.0042%"
          sub="Global TVL Delta"
          valueColor="#ffb5a0"
        />
        <MetricBentoItem
          label="Arena Fee"
          value="4.50 USDC"
          sub="Gas + Gas-Less Relay"
          valueColor="#e5e2e1"
        />
      </div>

      {/* ── Waterfall diagram card ── */}
      <section
        aria-labelledby="waterfall-diagram-heading"
        className="p-6"
        style={{
          background: "#201f1f",
          border: "1px solid rgba(59,73,76,0.2)",
        }}
      >
        <h3
          id="waterfall-diagram-heading"
          className="font-['Space_Grotesk'] font-bold uppercase tracking-widest mb-6"
          style={{ fontSize: "14px", color: "#e5e2e1" }}
        >
          Fee Distribution Waterfall
        </h3>
        <FeeWaterfallDiagram />
        <StackedBar />
        <ColorLegend />
      </section>

      {/* ── Per-epoch table ── */}
      <section
        aria-labelledby="epoch-table-heading"
        className="overflow-hidden relative"
        style={{
          background: "#201f1f",
          border: "1px solid rgba(59,73,76,0.2)",
        }}
      >
        {/* Table header band (vault-exit modal header pattern) */}
        <div
          className="px-6 py-5 flex justify-between items-center"
          style={{
            background: "#2a2a2a",
            borderBottom: "1px solid rgba(59,73,76,0.3)",
          }}
        >
          <div>
            <h3
              id="epoch-table-heading"
              className="font-['Space_Grotesk'] font-bold uppercase tracking-widest flex items-center gap-3"
              style={{ fontSize: "18px", color: "#c3f5ff" }}
            >
              <span
                className="material-symbols-outlined"
                style={{ color: "#ffb5a0", fontSize: "20px" }}
                aria-hidden="true"
              >
                history
              </span>
              PER-EPOCH BREAKDOWN
            </h3>
            <p
              className="font-['Space_Grotesk'] uppercase tracking-wider mt-1"
              style={{ fontSize: "10px", color: "#bac9cc" }}
            >
              Transaction ID:{" "}
              <span style={{ color: "#9cf0ff" }}>FEE-EPOCH-ARENA</span>
            </p>
          </div>
        </div>

        <div className="p-6">
          <EpochTable />
        </div>

        {/* Payout footer (vault-exit modal footer pattern) */}
        <PayoutSummaryFooter protocolFeesAccrued={protocolFeesAccrued} commissionPool={commissionPool} depositorYield={depositorYield} />

        {/* Decorative top line */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-0.5 pointer-events-none"
          style={{
            background: "#00daf3",
            boxShadow: "0 0 10px #00e5ff",
          }}
          aria-hidden="true"
        />
      </section>
    </div>
  );
}
