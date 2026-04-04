import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  /** Adds a left accent border in the primary (cyan) color */
  accent?: boolean;
  /** Adds a subtle cyan glow */
  glow?: boolean;
}

export function Card({
  children,
  className = "",
  accent = false,
  glow = false,
}: CardProps) {
  return (
    <div
      className={[
        "bg-[#201f1f] border border-[#3b494c]/10 p-6",
        accent ? "border-l-2 border-l-[#00e5ff]" : "",
        glow ? "shadow-[0_0_20px_rgba(0,229,255,0.12)]" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
