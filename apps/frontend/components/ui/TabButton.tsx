interface TabButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
  /** Optional Material Symbols icon name (e.g. "swords", "leaderboard") */
  icon?: string;
  /** Optional arbitrary ReactNode icon override */
  iconNode?: React.ReactNode;
}

export function TabButton({
  label,
  active,
  onClick,
  icon,
  iconNode,
}: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={[
        "flex items-center gap-4 py-3 px-6 text-xs font-bold tracking-widest uppercase transition-colors duration-200",
        active
          ? "bg-gradient-to-r from-[#00E5FF]/10 via-[#7B3FE4]/5 to-transparent text-[#00E5FF] border-l-4 border-[#00E5FF]"
          : "text-[#bac9cc] border-l-4 border-transparent hover:bg-[#1c1b1b] hover:text-white",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ fontFamily: "var(--font-space-grotesk)" }}
    >
      {icon && (
        <span className="material-symbols-outlined text-[18px]">{icon}</span>
      )}
      {iconNode}
      {label}
    </button>
  );
}
