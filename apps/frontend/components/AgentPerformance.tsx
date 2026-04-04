"use client";

import type { ReactNode } from "react";
import { useAllAgents, type AgentInfo } from "@/lib/contracts";
import { LoadingPulse } from "@/components/LoadingSkeleton";

// ─── Design tokens extracted from Stitch leaderboard.html ────────────────────

const COLORS = {
  background: "#131313",
  surfaceContainerLowest: "#0e0e0e",
  surfaceContainer: "#201f1f",
  surfaceContainerLow: "#1c1b1b",
  surfaceContainerHigh: "#2a2a2a",
  surfaceContainerHighest: "#353534",
  onSurface: "#e5e2e1",
  onSurfaceVariant: "#bac9cc",
  primary: "#c3f5ff",
  primaryContainer: "#00e5ff",
  onPrimary: "#00363d",
  secondary: "#ffb5a0",
  secondaryContainer: "#d73b00",
  outlineVariant: "#3b494c",
  outline: "#849396",
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatPerf(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

// ─── Tier badge derived from mock data ────────────────────────────────────────

type TierClass = "S-TIER GLADIATOR" | "VAULT ELITE" | "PROVING GROUNDS";

function resolveTierClass(
  phase: "vault" | "proving",
  sharpeScore: number,
  rank: number
): TierClass {
  if (rank === 1 && sharpeScore > 2) return "S-TIER GLADIATOR";
  if (phase === "vault") return "VAULT ELITE";
  return "PROVING GROUNDS";
}

interface TierBadgeProps {
  tier: TierClass;
}

function TierBadge({ tier }: TierBadgeProps) {
  if (tier === "S-TIER GLADIATOR") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "2px 8px",
          backgroundColor: COLORS.primaryContainer,
          color: COLORS.onPrimary,
          fontSize: "10px",
          fontWeight: 900,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          borderRadius: "2px",
          fontFamily: "'Space Grotesk', sans-serif",
        }}
      >
        S-TIER GLADIATOR
      </span>
    );
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        backgroundColor: COLORS.surfaceContainerHighest,
        border: `1px solid rgba(59,73,76,0.3)`,
        color: COLORS.onSurface,
        fontSize: "10px",
        fontWeight: 900,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        borderRadius: "2px",
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      {tier}
    </span>
  );
}

// ─── Status dot ───────────────────────────────────────────────────────────────

interface StatusDotProps {
  active?: boolean;
  dimmed?: boolean;
}

function StatusDot({ active = true, dimmed = false }: StatusDotProps) {
  const color = active ? COLORS.primaryContainer : `${COLORS.primaryContainer}66`;
  const shadow = active
    ? `0 0 8px rgba(0,229,255,0.8)`
    : undefined;
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        backgroundColor: dimmed ? COLORS.secondary : color,
        boxShadow: dimmed ? `0 0 8px rgba(255,87,34,0.8)` : shadow,
        flexShrink: 0,
      }}
    />
  );
}

// ─── Sidebar navigation ───────────────────────────────────────────────────────

function SideNav() {
  return (
    <aside
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        height: "100%",
        width: "256px",
        display: "flex",
        flexDirection: "column",
        paddingTop: "80px",
        paddingBottom: "32px",
        backgroundColor: COLORS.surfaceContainerLowest,
        borderRight: `1px solid rgba(59,73,76,0.15)`,
        zIndex: 40,
      }}
    >
      {/* Operator profile */}
      <div style={{ padding: "0 24px", marginBottom: "40px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "12px",
            backgroundColor: COLORS.surfaceContainer,
            borderRadius: "4px",
            border: `1px solid rgba(59,73,76,0.1)`,
          }}
        >
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "2px",
              overflow: "hidden",
              backgroundColor: "rgba(0,229,255,0.2)",
              flexShrink: 0,
            }}
          >
            {/* Placeholder avatar */}
            <div
              style={{
                width: "100%",
                height: "100%",
                background:
                  "linear-gradient(135deg, rgba(0,229,255,0.3) 0%, rgba(0,54,61,0.8) 100%)",
              }}
            />
          </div>
          <div>
            <p
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: "10px",
                fontWeight: 900,
                color: COLORS.primary,
                letterSpacing: "0.15em",
                textTransform: "uppercase",
              }}
            >
              OPERATOR 01
            </p>
            <p
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: "8px",
                color: COLORS.onSurfaceVariant,
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              RANK: ELITE
            </p>
          </div>
        </div>
      </div>

      {/* Nav links */}
      <nav
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: "4px",
        }}
        aria-label="Main navigation"
      >
        <NavLink icon="swords" label="ARENA" active={false} />
        <NavLink icon="leaderboard" label="LEADERBOARD" active={true} />
        <NavLink icon="smart_toy" label="MY_AGENTS" active={false} />
        <NavLink icon="account_balance_wallet" label="VAULT" active={false} />
      </nav>

      {/* Bottom actions */}
      <div
        style={{
          padding: "0 24px",
          marginTop: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "24px",
        }}
      >
        <button
          style={{
            backgroundColor: COLORS.primaryContainer,
            color: COLORS.onPrimary,
            width: "100%",
            padding: "12px",
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 700,
            fontSize: "12px",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            border: "none",
            cursor: "pointer",
            transition: "opacity 150ms",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.opacity = "0.9";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.opacity = "1";
          }}
        >
          DEPLOY AGENT
        </button>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <FooterLink icon="terminal" label="TERMINAL" />
          <FooterLink icon="help_center" label="SUPPORT" />
        </div>
      </div>
    </aside>
  );
}

interface NavLinkProps {
  icon: string;
  label: string;
  active: boolean;
}

function NavLink({ icon, label, active }: NavLinkProps) {
  return (
    <a
      href="#"
      aria-current={active ? "page" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "16px",
        padding: "12px 24px",
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: "12px",
        fontWeight: 700,
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        textDecoration: "none",
        transition: "all 200ms",
        ...(active
          ? {
              background:
                "linear-gradient(to right, rgba(0,229,255,0.1), transparent)",
              color: COLORS.primaryContainer,
              borderLeft: `4px solid ${COLORS.primaryContainer}`,
            }
          : {
              color: COLORS.onSurfaceVariant,
              borderLeft: "4px solid transparent",
            }),
      }}
      onMouseEnter={(e) => {
        if (!active) {
          const el = e.currentTarget as HTMLAnchorElement;
          el.style.backgroundColor = COLORS.surfaceContainerLow;
          el.style.color = "#ffffff";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          const el = e.currentTarget as HTMLAnchorElement;
          el.style.backgroundColor = "transparent";
          el.style.color = COLORS.onSurfaceVariant;
        }
      }}
    >
      <span
        className="material-symbols-outlined"
        aria-hidden="true"
        style={{ fontSize: "18px" }}
      >
        {icon}
      </span>
      {label}
    </a>
  );
}

interface FooterLinkProps {
  icon: string;
  label: string;
}

function FooterLink({ icon, label }: FooterLinkProps) {
  return (
    <a
      href="#"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        textDecoration: "none",
        color: COLORS.onSurfaceVariant,
        transition: "color 200ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.color = "#ffffff";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.color =
          COLORS.onSurfaceVariant;
      }}
    >
      <span
        className="material-symbols-outlined"
        aria-hidden="true"
        style={{ fontSize: "14px" }}
      >
        {icon}
      </span>
      {label}
    </a>
  );
}

// ─── Top nav bar ──────────────────────────────────────────────────────────────

function TopNav() {
  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        width: "100%",
        zIndex: 50,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "0 24px",
        height: "64px",
        backgroundColor: "rgba(19,19,19,0.8)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 0 20px rgba(0,229,255,0.08)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "32px" }}>
        <span
          style={{
            fontSize: "20px",
            fontWeight: 900,
            fontStyle: "italic",
            color: COLORS.primaryContainer,
            fontFamily: "'Space Grotesk', sans-serif",
            letterSpacing: "-0.05em",
            textTransform: "uppercase",
          }}
        >
          ARENA_OS
        </span>
        <nav
          style={{ display: "flex", alignItems: "center", gap: "24px" }}
          aria-label="Stats"
        >
          <span
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              letterSpacing: "-0.05em",
              textTransform: "uppercase",
              fontSize: "12px",
              fontWeight: 700,
              color: COLORS.onSurfaceVariant,
              cursor: "pointer",
            }}
          >
            TVL: $1.2B
          </span>
          <span
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              letterSpacing: "-0.05em",
              textTransform: "uppercase",
              fontSize: "12px",
              fontWeight: 700,
              color: COLORS.onSurfaceVariant,
              cursor: "pointer",
            }}
          >
            APY: 24.5%
          </span>
        </nav>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            padding: "6px 16px",
            borderRadius: "4px",
            backgroundColor: COLORS.surfaceContainerHigh,
            border: `1px solid rgba(59,73,76,0.1)`,
          }}
        >
          <span
            className="material-symbols-outlined"
            aria-label="Notifications"
            style={{ color: COLORS.primaryContainer, fontSize: "14px" }}
          >
            notifications
          </span>
          <span
            className="material-symbols-outlined"
            aria-label="Settings"
            style={{ color: COLORS.onSurfaceVariant, fontSize: "14px" }}
          >
            settings
          </span>
        </div>
        <button
          style={{
            backgroundColor: COLORS.primaryContainer,
            color: COLORS.onPrimary,
            padding: "6px 16px",
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 700,
            fontSize: "12px",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            border: "none",
            cursor: "pointer",
            transition: "transform 150ms",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.95)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
          }}
        >
          CONNECT VOICE
        </button>
      </div>
    </header>
  );
}

// ─── Leaderboard row ──────────────────────────────────────────────────────────

interface AgentRowProps {
  agent: AgentInfo;
  rank: number;
  isAlt: boolean;
}

function AgentRow({ agent, rank, isAlt }: AgentRowProps) {
  const tier = resolveTierClass(agent.phase, agent.sharpeScore, rank);
  const isTopRank = rank === 1;
  const perfPositive = agent.emaReturn >= 0;
  const rankStr = String(rank).padStart(2, "0");

  const rowBg = isAlt ? COLORS.surfaceContainer : COLORS.surfaceContainerLow;
  const borderColor = isTopRank
    ? COLORS.primary
    : "rgba(59,73,76,0.3)";

  // Subtitle label derived from tier
  const subtitleMap: Record<TierClass, string> = {
    "S-TIER GLADIATOR": "PROBABILITY ENGINE V4",
    "VAULT ELITE": "QUANT REACTION NODE",
    "PROVING GROUNDS": "HFT ARBITRAGE CORE",
  };

  // Controller org label
  const orgLabels = ["VALOR HOLDINGS", "ANONYMOUS", "ZENITH LABS"];
  const orgLabel = orgLabels[rank - 1] ?? "ANONYMOUS";

  return (
    <div
      role="row"
      style={{
        display: "grid",
        gridTemplateColumns:
          "50px 200px 140px 80px 80px 100px 150px",
        padding: "20px 24px",
        backgroundColor: rowBg,
        borderLeft: `4px solid ${borderColor}`,
        position: "relative",
        overflow: "hidden",
        transition: "background-color 300ms",
        cursor: "default",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.backgroundColor =
          COLORS.surfaceContainerHighest;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.backgroundColor = rowBg;
      }}
    >
      {/* Hover overlay */}
      {isTopRank && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(195,245,255,0.05)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* RK */}
      <div
        role="cell"
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: "18px",
          fontWeight: 900,
          fontStyle: "italic",
          color: isTopRank ? COLORS.primary : COLORS.onSurfaceVariant,
          alignSelf: "center",
        }}
      >
        {rankStr}
      </div>

      {/* AGENT_IDENTIFIER */}
      <div
        role="cell"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <StatusDot dimmed={!perfPositive || agent.sharpeScore < 0} />
        <div>
          <p
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: "14px",
              fontWeight: 900,
              letterSpacing: "-0.02em",
              color: "#ffffff",
              textTransform: "uppercase",
              lineHeight: 1.2,
            }}
          >
            {agent.name.replace(" ", "-").toUpperCase()}
          </p>
          <p
            style={{
              fontSize: "10px",
              color: COLORS.onSurfaceVariant,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            {subtitleMap[tier]}
          </p>
        </div>
      </div>

      {/* TIER_CLASS */}
      <div
        role="cell"
        style={{ display: "flex", alignItems: "center" }}
      >
        <TierBadge tier={tier} />
      </div>

      {/* SHARPE */}
      <div
        role="cell"
        style={{
          display: "flex",
          alignItems: "center",
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: "14px",
          color: agent.sharpeScore > 1.5 ? "#00E5FF" : agent.sharpeScore > 0.5 ? "#4ade80" : agent.sharpeScore >= 0 ? "#bac9cc" : "#FF5722",
        }}
      >
        {agent.sharpeScore.toFixed(2)}
      </div>

      {/* CREDITS */}
      <div
        role="cell"
        style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "4px" }}
      >
        <span
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 700,
            fontSize: "13px",
            color: agent.credits > 0 ? COLORS.primary : COLORS.secondary,
          }}
        >
          {agent.credits}
        </span>
        {/* credit bar showing credits/maxCredits */}
        <div
          style={{
            width: "40px",
            height: "3px",
            backgroundColor: "rgba(59,73,76,0.4)",
            borderRadius: "2px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${agent.maxCredits > 0 ? Math.min(100, (agent.credits / agent.maxCredits) * 100) : 0}%`,
              height: "100%",
              backgroundColor: agent.credits > agent.maxCredits * 0.5 ? COLORS.primaryContainer : COLORS.secondary,
              transition: "width 500ms",
            }}
          />
        </div>
      </div>

      {/* PER_EPOCH */}
      <div
        role="cell"
        style={{
          display: "flex",
          alignItems: "center",
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: "14px",
          color: perfPositive ? COLORS.primary : COLORS.secondary,
        }}
      >
        {formatPerf(agent.totalReturn)}
      </div>

      {/* CONTROLLER */}
      <div
        role="cell"
        style={{ textAlign: "right", alignSelf: "center" }}
      >
        <p
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: "10px",
            fontWeight: 700,
            color: COLORS.onSurfaceVariant,
            letterSpacing: "-0.03em",
          }}
        >
          {truncateAddress(agent.address)}
        </p>
        <p
          style={{
            fontSize: "8px",
            fontWeight: 700,
            textTransform: "uppercase",
            color: isTopRank
              ? `rgba(195,245,255,0.5)`
              : `rgba(186,201,204,0.5)`,
          }}
        >
          {orgLabel}
        </p>
      </div>
    </div>
  );
}

// ─── Intelligence side panel ──────────────────────────────────────────────────

function RecentPromotions() {
  const promotions = [
    { name: "GLITCH_RUNNER_8", tier: "S-TIER", time: "2m ago" },
    { name: "CYBER_HAWK", tier: "VAULT ELITE", time: "14m ago" },
  ];

  return (
    <section
      style={{
        backgroundColor: COLORS.surfaceContainer,
        border: `1px solid rgba(59,73,76,0.1)`,
        borderRadius: "4px",
        overflow: "hidden",
      }}
      aria-labelledby="promotions-heading"
    >
      <div
        style={{
          padding: "12px 16px",
          backgroundColor: COLORS.surfaceContainerHigh,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          id="promotions-heading"
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.2em",
            color: COLORS.primary,
            textTransform: "uppercase",
          }}
        >
          RECENT PROMOTIONS
        </span>
        <span
          className="material-symbols-outlined"
          aria-hidden="true"
          style={{ color: COLORS.primary, fontSize: "14px" }}
        >
          trending_up
        </span>
      </div>
      <div
        style={{
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        {promotions.map((p) => (
          <div
            key={p.name}
            style={{ display: "flex", gap: "12px", alignItems: "center" }}
          >
            <div
              aria-hidden="true"
              style={{
                width: "4px",
                height: "32px",
                backgroundColor: COLORS.primaryContainer,
                borderRadius: "999px",
                flexShrink: 0,
              }}
            />
            <div>
              <p
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: "11px",
                  fontWeight: 900,
                  color: "#ffffff",
                }}
              >
                {p.name}
              </p>
              <p style={{ fontSize: "9px", color: COLORS.onSurfaceVariant }}>
                Moved to{" "}
                <span
                  style={{
                    color: COLORS.primaryContainer,
                    fontWeight: 700,
                    textTransform: "uppercase",
                  }}
                >
                  {p.tier}
                </span>
              </p>
            </div>
            <span
              style={{
                marginLeft: "auto",
                fontSize: "9px",
                color: COLORS.onSurfaceVariant,
                fontFamily: "monospace",
              }}
            >
              {p.time}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentEvictions() {
  const evictions = [
    { name: "ERROR_FOUND_0", from: "ARENA", time: "5h ago" },
    { name: "STALE_NODE_X", from: "PROVING", time: "8h ago" },
  ];

  return (
    <section
      style={{
        backgroundColor: COLORS.surfaceContainer,
        border: `1px solid rgba(59,73,76,0.1)`,
        borderRadius: "4px",
        overflow: "hidden",
      }}
      aria-labelledby="evictions-heading"
    >
      <div
        style={{
          padding: "12px 16px",
          backgroundColor: COLORS.surfaceContainerHigh,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          id="evictions-heading"
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.2em",
            color: COLORS.secondary,
            textTransform: "uppercase",
          }}
        >
          RECENT EVICTIONS
        </span>
        <span
          className="material-symbols-outlined"
          aria-hidden="true"
          style={{ color: COLORS.secondary, fontSize: "14px" }}
        >
          trending_down
        </span>
      </div>
      <div
        style={{
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        {evictions.map((e) => (
          <div
            key={e.name}
            style={{
              display: "flex",
              gap: "12px",
              alignItems: "center",
              opacity: 0.6,
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: "4px",
                height: "32px",
                backgroundColor: COLORS.secondary,
                borderRadius: "999px",
                flexShrink: 0,
              }}
            />
            <div>
              <p
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: "11px",
                  fontWeight: 900,
                  color: "#ffffff",
                }}
              >
                {e.name}
              </p>
              <p style={{ fontSize: "9px", color: COLORS.onSurfaceVariant }}>
                Evicted from{" "}
                <span
                  style={{
                    color: COLORS.secondary,
                    fontWeight: 700,
                    textTransform: "uppercase",
                  }}
                >
                  {e.from}
                </span>
              </p>
            </div>
            <span
              style={{
                marginLeft: "auto",
                fontSize: "9px",
                color: COLORS.onSurfaceVariant,
                fontFamily: "monospace",
              }}
            >
              {e.time}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function PromoCard() {
  return (
    <div
      style={{
        position: "relative",
        borderRadius: "4px",
        overflow: "hidden",
        height: "192px",
      }}
      role="img"
      aria-label="Stake Agent NFT — Earn Passive Rewards"
    >
      {/* Gradient background in place of image */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(135deg, #0e0e0e 0%, #1a2a2b 40%, #0e1a1c 100%)",
        }}
      />
      {/* Decorative grid overlay */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "radial-gradient(circle at 2px 2px, rgba(0,229,255,0.08) 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      />
      {/* Gradient fade to bottom */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to top, #131313 0%, rgba(19,19,19,0.4) 50%, transparent 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "16px",
          left: "16px",
          right: "16px",
        }}
      >
        <h3
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: "18px",
            fontWeight: 900,
            color: "#ffffff",
            fontStyle: "italic",
            lineHeight: 1.2,
            marginBottom: "4px",
          }}
        >
          STAKE AGENT NFT
        </h3>
        <p
          style={{
            fontSize: "10px",
            color: COLORS.primaryContainer,
            fontWeight: 700,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
          }}
        >
          EARN PASSIVE REWARDS
        </p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AgentPerformance() {
  const { agents, isLoading: isLoadingAgents } = useAllAgents();

  const sortedAgents = [...agents].sort(
    (a, b) => b.sharpeScore - a.sharpeScore
  );

  return (
    <>
      {isLoadingAgents && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            height: "2px",
            backgroundColor: "#00e5ff",
            opacity: 0.8,
            zIndex: 100,
            animation: "arena-pulse 1s infinite",
          }}
        />
      )}
      {/* Google Fonts + global overrides */}
      {/* eslint-disable-next-line react/no-danger */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700;900&family=Manrope:wght@300;400;500;600;700;800&display=swap');
            @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,300,0,0&display=swap');
            .material-symbols-outlined {
              font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24;
              vertical-align: middle;
            }
            @keyframes arena-pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
          `,
        }}
      />

      <div
        style={{
          color: COLORS.onSurface,
          fontFamily: "'Manrope', sans-serif",
        }}
      >
          {/* Dashboard header */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "32px",
              marginBottom: "48px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-end",
                gap: "32px",
                flexWrap: "wrap",
              }}
            >
              {/* Title block */}
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    marginBottom: "8px",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      backgroundColor: COLORS.primary,
                      animation: "arena-pulse 2s cubic-bezier(0.4,0,0.6,1) infinite",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontSize: "10px",
                      fontWeight: 700,
                      letterSpacing: "0.3em",
                      color: COLORS.primary,
                      textTransform: "uppercase",
                    }}
                  >
                    LIVE SIMULATION ACTIVE
                  </span>
                  {agents.length > 0 && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "3px 8px",
                        backgroundColor: "rgba(0,229,255,0.1)",
                        border: "1px solid rgba(0,229,255,0.3)",
                        borderRadius: "2px",
                        fontFamily: "'Space Grotesk', sans-serif",
                        fontSize: "9px",
                        fontWeight: 700,
                        letterSpacing: "0.15em",
                        color: "#00e5ff",
                        textTransform: "uppercase",
                      }}
                    >
                      <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#00e5ff", display: "inline-block" }} />
                      LIVE DATA
                    </span>
                  )}
                </div>
                <h1
                  id="leaderboard-heading"
                  style={{
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: "48px",
                    fontWeight: 900,
                    fontStyle: "italic",
                    color: COLORS.onSurface,
                    letterSpacing: "-0.05em",
                    textTransform: "uppercase",
                    lineHeight: 1,
                    margin: 0,
                  }}
                >
                  LEADERBOARD
                </h1>
                <p
                  style={{
                    color: COLORS.onSurfaceVariant,
                    maxWidth: "448px",
                    marginTop: "8px",
                    fontWeight: 500,
                    fontSize: "14px",
                  }}
                >
                  Rankings updated every block. Top S-Tier Gladiators are
                  eligible for monthly yield distribution.
                </p>
              </div>

              {/* Stats cards */}
              <div style={{ display: "flex", gap: "16px" }}>
                <StatCard
                  label="TOTAL REWARDS"
                  value="842.05 ETH"
                  valueColor={COLORS.primary}
                />
                <StatCard
                  label="ARENA TIME"
                  value="14:02:55:09"
                  valueColor={COLORS.secondary}
                />
              </div>
            </div>
          </div>

          {/* Main grid: table + sidebar */}
          <div
            style={{
              display: "flex",
              gap: "48px",
              alignItems: "flex-start",
              overflow: "hidden",
            }}
          >
            {/* Ranking table */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 }}>
              <div style={{ overflowX: "auto" }}>
                {/* Table header */}
                <div
                  role="row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "50px 200px 140px 80px 80px 100px 150px",
                    minWidth: "850px",
                    padding: "16px 24px",
                    backgroundColor: COLORS.surfaceContainerLow,
                    borderBottom: `1px solid rgba(59,73,76,0.2)`,
                    alignItems: "center",
                  }}
                >
                  <ColHeader>RK</ColHeader>
                  <ColHeader>AGENT IDENTIFIER</ColHeader>
                  <ColHeader>TIER CLASS</ColHeader>
                  <ColHeader>SHARPE</ColHeader>
                  <ColHeader>CREDITS</ColHeader>
                  <ColHeader>PER EPOCH</ColHeader>
                  <ColHeader right>CONTROLLER</ColHeader>
                </div>


                {/* Rows */}
                <div
                  role="table"
                  aria-labelledby="leaderboard-heading"
                  style={{ display: "flex", flexDirection: "column", gap: "12px", minWidth: "850px", marginTop: "12px" }}
                >
                  {isLoadingAgents
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <div
                          key={i}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "50px 200px 140px 80px 80px 100px 150px",
                            padding: "20px 24px",
                            backgroundColor: i % 2 === 0 ? COLORS.surfaceContainer : COLORS.surfaceContainerLow,
                            gap: "16px",
                            alignItems: "center",
                          }}
                        >
                          <LoadingPulse className="h-6 w-8" />
                          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                            <LoadingPulse className="h-2 w-2 rounded-full" />
                            <LoadingPulse className="h-5 w-32" />
                          </div>
                          <LoadingPulse className="h-5 w-24" />
                          <LoadingPulse className="h-5 w-12" />
                          <LoadingPulse className="h-5 w-10" />
                          <LoadingPulse className="h-5 w-14" />
                          <LoadingPulse className="h-5 w-20 ml-auto" />
                        </div>
                      ))
                    : sortedAgents.map((agent, index) => (
                        <AgentRow
                          key={agent.id}
                          agent={agent}
                          rank={index + 1}
                          isAlt={index % 2 === 0}
                        />
                      ))}
                </div>
              </div>
            </div>

            {/* Intelligence panel */}
            <aside
              style={{
                width: "320px",
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                gap: "24px",
              }}
              aria-label="Intelligence panel"
            >
              <RecentPromotions />
              <RecentEvictions />
              <PromoCard />
            </aside>
          </div>
      </div>
    </>
  );
}

// ─── Tiny presentational components ──────────────────────────────────────────

interface ColHeaderProps {
  children: ReactNode;
  right?: boolean;
}

function ColHeader({ children, right = false }: ColHeaderProps) {
  return (
    <div
      role="columnheader"
      style={{
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.1em",
        color: COLORS.onSurfaceVariant,
        textTransform: "uppercase",
        textAlign: right ? "right" : "left",
      }}
    >
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  valueColor: string;
}

function StatCard({ label, value, valueColor }: StatCardProps) {
  return (
    <div
      style={{
        backgroundColor: COLORS.surfaceContainerHigh,
        border: `1px solid rgba(59,73,76,0.1)`,
        padding: "16px",
        borderRadius: "4px",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
      }}
    >
      <span
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: "10px",
          color: COLORS.onSurfaceVariant,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: "4px",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: "24px",
          fontWeight: 900,
          color: valueColor,
          letterSpacing: "-0.05em",
        }}
      >
        {value}
      </span>
    </div>
  );
}
