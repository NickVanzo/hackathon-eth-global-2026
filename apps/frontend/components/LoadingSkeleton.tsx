"use client";

export function LoadingPulse({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded ${className}`}
      style={{ backgroundColor: "rgba(0,229,255,0.08)" }}
    />
  );
}

export function LoadingIndicator({ label = "SYNCING" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 p-4">
      <div
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: "#00E5FF", animation: "pulse 1.5s infinite" }}
      />
      <span
        className="text-[10px] font-bold tracking-[0.2em] uppercase"
        style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#bac9cc" }}
      >
        {label}...
      </span>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="flex items-center gap-3 p-4 rounded border-l-2"
      style={{
        backgroundColor: "rgba(248,113,113,0.08)",
        borderLeftColor: "#f87171",
      }}
    >
      <span className="material-symbols-outlined" style={{ color: "#f87171", fontSize: 18 }}>
        error
      </span>
      <span
        className="text-xs font-bold uppercase tracking-widest"
        style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#fca5a5" }}
      >
        {message}
      </span>
    </div>
  );
}
