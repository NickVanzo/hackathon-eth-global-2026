import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  /** Adds a subtle cyan glow to highlight important cards */
  glow?: boolean;
}

export function Card({ children, className = "", glow = false }: CardProps) {
  return (
    <div
      className={`bg-[#111111] border border-[#1c1b1b] rounded-xl p-6 ${
        glow ? "glow-cyan border-[rgba(0,229,255,0.3)]" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}
