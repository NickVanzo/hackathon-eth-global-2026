"use client";

import { useState, useEffect, useMemo } from "react";
import {
  fetchAgentPerformanceHistory,
  type PerformanceSnapshot,
} from "./indexer";

export interface ChartPoint {
  x: number; // 0-100 normalized for SVG viewBox
  y: number; // 0-100 normalized (inverted: 0=top, 100=bottom)
  label: string; // date label for x-axis
  returnBps: number; // raw return in basis points
  timestamp: number; // unix seconds
}

export function useAgentPerformanceHistory(agentId: number) {
  const [snapshots, setSnapshots] = useState<PerformanceSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await fetchAgentPerformanceHistory(agentId, 200);
        if (!cancelled) setSnapshots(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    // Poll every 30s for new epoch data
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [agentId]);

  const chartPoints = useMemo(() => snapshotsToChartPoints(snapshots), [snapshots]);

  return { snapshots, chartPoints, isLoading, error };
}

function snapshotsToChartPoints(snapshots: PerformanceSnapshot[]): ChartPoint[] {
  if (snapshots.length === 0) return [];

  // Find min/max returnBps for y-axis normalization
  const returns = snapshots.map((s) => s.returnBps);
  const minReturn = Math.min(...returns);
  const maxReturn = Math.max(...returns);
  const range = maxReturn - minReturn || 1; // avoid division by zero

  return snapshots.map((s, i) => {
    const ts = Number(s.blockTimestamp);
    const date = new Date(ts * 1000);
    const label =
      i === snapshots.length - 1
        ? "NOW"
        : date.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();

    return {
      x: snapshots.length === 1 ? 50 : (i / (snapshots.length - 1)) * 100,
      // Invert y: high return = low y value (top of chart)
      y: 100 - ((s.returnBps - minReturn) / range) * 80 - 10, // 10-90 range
      label,
      returnBps: s.returnBps,
      timestamp: ts,
    };
  });
}
