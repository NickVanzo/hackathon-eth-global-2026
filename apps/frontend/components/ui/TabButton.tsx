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
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-indigo-600 text-white"
          : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
      }`}
      aria-current={active ? "page" : undefined}
    >
      {icon}
      {label}
    </button>
  );
}
