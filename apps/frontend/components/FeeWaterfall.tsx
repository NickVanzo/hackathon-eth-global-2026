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
    <Card>
      <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-bold ${accentClass}`}>{value}</p>
    </Card>
  );
}

// ─── Waterfall diagram ────────────────────────────────────────────────────────

interface WaterfallBarProps {
  label: string;
  percentage: number;
  colorClass: string;
  description: string;
}

function WaterfallBar({
  label,
  percentage,
  colorClass,
  description,
}: WaterfallBarProps) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-36 shrink-0 text-right text-sm text-gray-400">
        {label}
      </span>
      <div className="relative h-8 flex-1 overflow-hidden rounded-md bg-gray-800">
        <div
          className={`flex h-full items-center justify-end pr-3 ${colorClass} transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        >
          <span className="text-xs font-semibold text-white">
            {percentage}%
          </span>
        </div>
      </div>
      <span className="w-40 shrink-0 text-sm text-gray-400">{description}</span>
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
      {/* Connecting arrows expressed via border-left dashed line in the gap area */}
      <WaterfallBar
        label="Gross Yield"
        percentage={GROSS_PCT}
        colorClass="bg-gray-600"
        description="Total vault earnings"
      />
      <WaterfallBar
        label="Protocol Fee"
        percentage={PROTOCOL_PCT}
        colorClass="bg-indigo-600"
        description="5% → protocol treasury"
      />
      <WaterfallBar
        label="Commission"
        percentage={COMMISSION_PCT}
        colorClass="bg-amber-500"
        description="10% → agent operators"
      />
      <WaterfallBar
        label="Net Depositor"
        percentage={DEPOSITOR_PCT}
        colorClass="bg-emerald-600"
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
        className="flex items-center justify-center bg-indigo-600 text-xs font-semibold text-white"
        style={{ width: `${PROTOCOL_WIDTH}%` }}
        title="Protocol fee 5%"
      >
        5%
      </div>
      <div
        className="flex items-center justify-center bg-amber-500 text-xs font-semibold text-white"
        style={{ width: `${COMMISSION_WIDTH}%` }}
        title="Commission 10%"
      >
        10%
      </div>
      <div
        className="flex flex-1 items-center justify-center bg-emerald-600 text-xs font-semibold text-white"
        style={{ width: `${DEPOSITOR_WIDTH}%` }}
        title="Depositor yield 85%"
      >
        85%
      </div>
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function ColorLegend() {
  const items = [
    { colorClass: "bg-indigo-600", label: "Protocol Fee" },
    { colorClass: "bg-amber-500", label: "Commission" },
    { colorClass: "bg-emerald-600", label: "Depositor Yield" },
  ];

  return (
    <div className="mt-3 flex flex-wrap gap-4">
      {items.map(({ colorClass, label }) => (
        <div key={label} className="flex items-center gap-2">
          <span className={`inline-block h-3 w-3 rounded-sm ${colorClass}`} />
          <span className="text-xs text-gray-400">{label}</span>
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
    return <span className="text-gray-500">—</span>;
  }

  const isUp = Number(current) >= Number(previous);

  return (
    <span
      className={`inline-flex items-center gap-1 ${
        isUp ? "text-emerald-400" : "text-red-400"
      }`}
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
          <tr className="border-b border-gray-800 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
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
                className={`border-b border-gray-800 transition-colors ${
                  isCurrent
                    ? "bg-indigo-950/40 font-medium"
                    : "hover:bg-gray-800/40"
                }`}
              >
                <td className="py-3 pr-4 text-gray-100">
                  <span className="flex items-center gap-2">
                    {row.epoch}
                    {isCurrent && (
                      <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                        current
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-3 pr-4 text-indigo-300">
                  {formatUsdc(row.protocolFee)}
                </td>
                <td className="py-3 pr-4 text-amber-300">
                  {formatUsdc(row.commission)}
                </td>
                <td className="py-3 pr-4 text-emerald-300">
                  {formatUsdc(row.depositorYield)}
                </td>
                <td className="py-3">
                  <span className="flex items-center gap-2 text-gray-100">
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
          className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400"
        >
          Cumulative Totals
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard
            label="Protocol Fees Accrued"
            value={formatUsdc(protocolFeesAccrued)}
            accentClass="text-indigo-400"
          />
          <SummaryCard
            label="Commission Pool"
            value={formatUsdc(commissionPool)}
            accentClass="text-amber-400"
          />
          <SummaryCard
            label="Depositor Yield"
            value={formatUsdc(depositorYield)}
            accentClass="text-emerald-400"
          />
        </div>
      </section>

      {/* Fee waterfall diagram */}
      <section aria-labelledby="fee-waterfall-heading">
        <Card>
          <h2
            id="fee-waterfall-heading"
            className="mb-4 text-base font-semibold text-gray-100"
          >
            Fee Waterfall
          </h2>
          <p className="mb-6 text-sm text-gray-400">
            Gross yield flows through protocol fees and operator commissions
            before reaching depositors.
          </p>
          <FeeWaterfallDiagram />
          <StackedBar />
          <ColorLegend />
        </Card>
      </section>

      {/* Per-epoch breakdown */}
      <section aria-labelledby="epoch-breakdown-heading">
        <Card>
          <h2
            id="epoch-breakdown-heading"
            className="mb-4 text-base font-semibold text-gray-100"
          >
            Per-Epoch Breakdown
          </h2>
          <EpochTable />
        </Card>
      </section>
    </div>
  );
}
