interface TabButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}

export function TabButton({ label, active, onClick, icon }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all border-l-2 ${
        active
          ? "border-[#00E5FF] text-[#00E5FF] bg-[#00E5FF]/5 shadow-[0_0_12px_rgba(0,229,255,0.1)]"
          : "border-transparent text-[#787776] hover:bg-[#1c1b1b] hover:text-[#E5E2E1]"
      }`}
      aria-current={active ? "page" : undefined}
    >
      {icon}
      {label}
    </button>
  );
}
