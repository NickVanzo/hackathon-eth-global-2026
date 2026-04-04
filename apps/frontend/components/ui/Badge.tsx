import type { ReactNode } from "react";

type BadgeVariant = "positive" | "negative" | "neutral";

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  positive: "bg-emerald-900/50 text-emerald-400 border-emerald-800",
  negative: "bg-red-900/50 text-red-400 border-red-800",
  neutral: "bg-yellow-900/50 text-yellow-400 border-yellow-800",
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
