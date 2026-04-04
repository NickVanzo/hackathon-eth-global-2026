"use client";

import { useEffect, useRef } from "react";
import { createChart, AreaSeries, ColorType, type IChartApi } from "lightweight-charts";

export interface ChartDataPoint {
  time: string;
  value: number;
}

interface LightweightChartProps {
  data: ChartDataPoint[];
  height?: number;
  lineColor?: string;
  areaTopColor?: string;
  areaBottomColor?: string;
  showGrid?: boolean;
  yAxisLabel?: string;
}

export default function LightweightChart({
  data,
  height = 300,
  lineColor = "#00E5FF",
  areaTopColor = "rgba(0, 229, 255, 0.25)",
  areaBottomColor = "rgba(0, 229, 255, 0)",
  showGrid = true,
  yAxisLabel,
}: LightweightChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#6b7a7d",
        fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: showGrid ? "rgba(59,73,76,0.12)" : "transparent" },
        horzLines: { color: showGrid ? "rgba(59,73,76,0.12)" : "transparent" },
      },
      crosshair: {
        vertLine: { color: "rgba(0,229,255,0.3)", width: 1, style: 2, labelBackgroundColor: "#2a2a2a" },
        horzLine: { color: "rgba(0,229,255,0.3)", width: 1, style: 2, labelBackgroundColor: "#2a2a2a" },
      },
      rightPriceScale: {
        borderColor: "rgba(59,73,76,0.2)",
      },
      timeScale: {
        borderColor: "rgba(59,73,76,0.2)",
        timeVisible: false,
        rightOffset: 2,
        barSpacing: 12,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor,
      topColor: areaTopColor,
      bottomColor: areaBottomColor,
      lineWidth: 2,
      crosshairMarkerRadius: 4,
      crosshairMarkerBackgroundColor: lineColor,
      crosshairMarkerBorderColor: "#131313",
      crosshairMarkerBorderWidth: 2,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    if (data.length > 0) {
      series.setData(data as any);
      chart.timeScale().fitContent();
    }

    const observer = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (seriesRef.current && data.length > 0) {
      seriesRef.current.setData(data as any);
      chartRef.current?.timeScale().fitContent();
    }
  }, [data]);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      {yAxisLabel && (
        <div
          style={{
            position: "absolute",
            left: "-6px",
            top: "50%",
            transform: "translateY(-50%) rotate(-90deg)",
            transformOrigin: "center center",
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: "9px",
            fontWeight: 500,
            color: "#6b7a7d",
            textTransform: "uppercase",
            letterSpacing: "0.15em",
            whiteSpace: "nowrap",
            zIndex: 2,
            pointerEvents: "none",
          }}
        >
          {yAxisLabel}
        </div>
      )}
      <div ref={containerRef} style={{ width: "100%" }} />
    </div>
  );
}
