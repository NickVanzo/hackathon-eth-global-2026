"use client";

import { MOCK_FEES } from "@/lib/mock-data";
import { Card } from "@/components/ui/Card";

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

/** Format a share-price string (6-decimal) as a decimal ratio, e.g. "1052000" → "1.052000" */
function formatSharePrice(raw: string): string {
  const value = Number(raw) / 1_000_000;
  return value.toFixed(6);
}

// ─── Summary cards ────────────────────────────────────────────────────────────

interface SummaryCardProps {
  label: string;
  value: string;
  accentClass: string;
}

function SummaryCard({ label, value, accentClass }: SummaryCardProps) {
  return (
    <Card className="bg-[#111111] border border-[#1c1b1b]">
      <p className="text-xs font-medium uppercase tracking-wider text-[#787776]">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${accentClass}`}>{value}</p>
    </Card>
  );
}

// ─── Waterfall diagram ────────────────────────────────────────────────────────

interface WaterfallBarProps {
  label: string;
  percentage: number;
  barColor: string;
  description: string;
}

function WaterfallBar({ label, percentage, barColor, description }: WaterfallBarProps) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-36 shrink-0 text-right text-sm text-[#787776]">{label}</span>
      <div className="relative h-8 flex-1 overflow-hidden rounded-md bg-[#1c1b1b]">
        <div
          className="flex h-full items-center justify-end pr-3 transition-all duration-500"
          style={{ width: `${percentage}%`, backgroundColor: barColor }}
        >
          <span className="text-xs font-semibold text-white">{percentage}%</span>
        </div>
      </div>
      <span className="w-40 shrink-0 text-sm text-[#787776]">{description}</span>
    </div>
  );
}

function FeeWaterfallDiagram() {
  const PROTOCOL_PCT = 5;
  const COMMISSION_PCT = 10;
  const DEPOSITOR_PCT = 85;
  const GROSS_PCT = 100;

  return (
    <div className="flex flex-col gap-3">
      <WaterfallBar
        label="Gross Yield"
        percentage={GROSS_PCT}
        barColor="#1c1b1b"
        description="Total vault earnings"
      />
      <WaterfallBar
        label="Protocol Fee"
        percentage={PROTOCOL_PCT}
        barColor="#7000FF"
        description="5% → protocol treasury"
      />
      <WaterfallBar
        label="Commission"
        percentage={COMMISSION_PCT}
        barColor="#FF5722"
        description="10% → agent operators"
      />
      <WaterfallBar
        label="Net Depositor"
        percentage={DEPOSITOR_PCT}
        barColor="#00E5FF"
        description="85% → depositors"
      />
    </div>
  );
}

// ─── Stacked bar (visual proportion of a single epoch) ───────────────────────

function StackedBar() {
  const PROTOCOL_WIDTH = 5;
  const COMMISSION_WIDTH = 10;
  const DEPOSITOR_WIDTH = 85;

  return (
    <div className="mt-4 flex h-6 w-full overflow-hidden rounded-full">
      <div
        className="flex items-center justify-center text-xs font-semibold text-white"
        style={{ width: `${PROTOCOL_WIDTH}%`, backgroundColor: "#7000FF" }}
        title="Protocol fee 5%"
      >
        5%
      </div>
      <div
        className="flex items-center justify-center text-xs font-semibold text-white"
        style={{ width: `${COMMISSION_WIDTH}%`, backgroundColor: "#FF5722" }}
        title="Commission 10%"
      >
        10%
      </div>
      <div
        className="flex flex-1 items-center justify-center text-xs font-semibold text-white"
        style={{ width: `${DEPOSITOR_WIDTH}%`, backgroundColor: "#00E5FF" }}
        title="Depositor yield 85%"
      >
        85%
      </div>
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function ColorLegend() {
  const items: { color: string; label: string }[] = [
    { color: "#7000FF", label: "Protocol Fee" },
    { color: "#FF5722", label: "Commission" },
    { color: "#00E5FF", label: "Depositor Yield" },
  ];

  return (
    <div className="mt-3 flex flex-wrap gap-4">
      {items.map(({ color, label }) => (
        <div key={label} className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ backgroundColor: color }}
          />
          <span className="text-xs text-[#787776]">{label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Per-epoch table ──────────────────────────────────────────────────────────

function SharePriceTrend({
  current,
  previous,
}: {
  current: string;
  previous: string | undefined;
}) {
  if (previous === undefined) {
    return <span className="text-[#787776]">—</span>;
  }

  const isUp = Number(current) >= Number(previous);

  return (
    <span
      className={`inline-flex items-center gap-1 ${isUp ? "text-[#00E5FF]" : "text-[#FF5722]"}`}
      aria-label={isUp ? "trending up" : "trending down"}
    >
      {isUp ? "↑" : "↓"}
    </span>
  );
}

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
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Per-epoch fee breakdown</caption>
        <thead>
          <tr className="border-b border-[#1c1b1b] text-left text-xs font-medium uppercase tracking-wider text-[#787776]">
            <th scope="col" className="pb-3 pr-4">
              Epoch
            </th>
            <th scope="col" className="pb-3 pr-4">
              Protocol Fee
            </th>
            <th scope="col" className="pb-3 pr-4">
              Commission
            </th>
            <th scope="col" className="pb-3 pr-4">
              Depositor Yield
            </th>
            <th scope="col" className="pb-3">
              Share Price
            </th>
          </tr>
        </thead>
        <tbody>
          {epochs.map((row, index) => {
            const previousEpoch = epochs[index + 1];
            const isCurrent = row.epoch === currentEpoch;

            return (
              <tr
                key={row.epoch}
                className={`border-b border-[#1c1b1b] transition-colors bg-[#111111] ${
                  isCurrent
                    ? "border-l-2 border-l-[#00E5FF] font-medium"
                    : "hover:bg-[#1c1b1b]/60"
                }`}
              >
                <td className="py-3 pr-4 text-[#E5E2E1]">
                  <span className="flex items-center gap-2">
                    {row.epoch}
                    {isCurrent && (
                      <span className="rounded-full bg-[#00E5FF]/10 border border-[#00E5FF]/40 px-2 py-0.5 text-[10px] font-semibold text-[#00E5FF]">
                        current
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-3 pr-4" style={{ color: "#7000FF" }}>
                  {formatUsdc(row.protocolFee)}
                </td>
                <td className="py-3 pr-4" style={{ color: "#FF5722" }}>
                  {formatUsdc(row.commission)}
                </td>
                <td className="py-3 pr-4 text-[#00E5FF]">
                  {formatUsdc(row.depositorYield)}
                </td>
                <td className="py-3">
                  <span className="flex items-center gap-2 text-[#E5E2E1]">
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

// ─── Root component ───────────────────────────────────────────────────────────

export default function FeeWaterfall() {
  const { protocolFeesAccrued, commissionPool, depositorYield } = MOCK_FEES;

  return (
    <div className="flex flex-col gap-6">
      {/* Summary cards */}
      <section aria-labelledby="fee-summary-heading">
        <h2
          id="fee-summary-heading"
          className="mb-3 text-sm font-semibold uppercase tracking-widest text-[#787776]"
        >
          FEE WATERFALL
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard
            label="Protocol Fees Accrued"
            value={formatUsdc(protocolFeesAccrued)}
            accentClass="text-[#00E5FF]"
          />
          <SummaryCard
            label="Commission Pool"
            value={formatUsdc(commissionPool)}
            accentClass="text-[#00E5FF]"
          />
          <SummaryCard
            label="Depositor Yield"
            value={formatUsdc(depositorYield)}
            accentClass="text-[#00E5FF]"
          />
        </div>
      </section>

      {/* Fee waterfall diagram */}
      <section aria-labelledby="fee-waterfall-heading">
        <Card className="bg-[#111111] border border-[#1c1b1b]">
          <h2
            id="fee-waterfall-heading"
            className="mb-4 text-base font-semibold uppercase tracking-widest text-[#E5E2E1]"
          >
            FEE WATERFALL
          </h2>
          <p className="mb-6 text-sm text-[#787776]">
            Gross yield flows through protocol fees and operator commissions before reaching
            depositors.
          </p>
          <FeeWaterfallDiagram />
          <StackedBar />
          <ColorLegend />
        </Card>
      </section>

      {/* Per-epoch breakdown */}
      <section aria-labelledby="epoch-breakdown-heading">
        <Card className="bg-[#111111] border border-[#1c1b1b]">
          <h2
            id="epoch-breakdown-heading"
            className="mb-4 text-base font-semibold uppercase tracking-widest text-[#E5E2E1]"
          >
            Per-Epoch Breakdown
          </h2>
          <EpochTable />
        </Card>
      </section>
    </div>
  );
}
