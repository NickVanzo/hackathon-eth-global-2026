import type { ReactNode } from "react";

type BadgeVariant = "positive" | "negative" | "neutral" | "tier" | "warning";

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

// Exact token values from the Stitch design system
const variantStyles: Record<BadgeVariant, string> = {
  // Positive / S-Tier — primary cyan
  positive: "bg-[#00e5ff] text-[#00363d]",
  // Negative / eviction — secondary orange-red
  negative:
    "bg-[#353534] border border-[#3b494c]/30 text-[#e5e2e1]",
  // Neutral — surface container variant
  neutral:
    "bg-[#353534] border border-[#3b494c]/30 text-[#e5e2e1]",
  // Tier classification badge (e.g. VAULT_TIER, PROVING_GROUNDS)
  tier: "bg-[#00e5ff]/10 text-[#c3f5ff] border border-[#00e5ff]/20",
  // Warning / alert state — purple accent
  warning: "bg-[#7B3FE4]/10 text-[#c4b5ff] border border-[#7B3FE4]/20",
};

export function Badge({
  children,
  variant = "neutral",
  className = "",
}: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center px-2 py-0.5 text-[10px] font-black tracking-widest uppercase",
        variantStyles[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ fontFamily: "var(--font-space-grotesk)" }}
    >
      {children}
    </span>
  );
}
