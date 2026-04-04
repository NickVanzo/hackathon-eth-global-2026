import type { ReactNode } from "react";

type BadgeVariant = "positive" | "negative" | "neutral";

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  positive: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  negative: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  neutral: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

export function Badge({
  children,
  variant = "neutral",
  className = "",
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
