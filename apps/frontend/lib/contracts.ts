import { parseAbi } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { ogGalileo, sepolia } from "@/lib/chains";

// ---------------------------------------------------------------------------
// Contract address constants
// ---------------------------------------------------------------------------

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const AGENT_MANAGER_ADDRESS =
  (process.env.NEXT_PUBLIC_AGENT_MANAGER_ADDRESS as `0x${string}` | undefined) ??
  ZERO_ADDRESS;

export const VAULT_ADDRESS =
  (process.env.NEXT_PUBLIC_VAULT_ADDRESS as `0x${string}` | undefined) ??
  ZERO_ADDRESS;

export const SATELLITE_ADDRESS =
  (process.env.NEXT_PUBLIC_SATELLITE_ADDRESS as `0x${string}` | undefined) ??
  ZERO_ADDRESS;

export function isZeroAddress(addr: string): boolean {
  return addr === ZERO_ADDRESS;
}

// ---------------------------------------------------------------------------
// Placeholder ABIs
// TODO: replace with import from packages/shared/abis/ when deployed
// ---------------------------------------------------------------------------

export const AGENT_MANAGER_ABI = parseAbi([
  "function agentCount() view returns (uint256)",
  "function getAgentInfo(uint256 agentId) view returns (address agentAddress, uint8 phase, int256 emaReturn, int256 emaReturnSq, int256 sharpeScore, uint256 credits, uint256 maxCredits, uint256 refillRate, uint256 epochsCompleted, uint256 zeroSharpeStreak)",
]);

export const VAULT_ABI = parseAbi([
  "function sharePrice() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function protocolFeesAccrued() view returns (uint256)",
  "function commissionPool() view returns (uint256)",
  "function currentEpoch() view returns (uint256)",
]);

export const SATELLITE_ABI = parseAbi([
  "function deposit(uint256 amount) returns (uint256 shares)",
  "function requestWithdraw(uint256 shares, uint8 tier) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
]);

// ---------------------------------------------------------------------------
// Typed return shape for agent info
// ---------------------------------------------------------------------------

export type AgentInfo = {
  id: number;
  address: string;
  phase: "vault" | "proving";
  emaReturn: number;
  emaReturnSq: number;
  sharpeScore: number;
  credits: number;
  maxCredits: number;
  refillRate: number;
  epochsCompleted: number;
  zeroSharpeStreak: number;
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Reads agentCount() from AgentManager on 0G Galileo.
 */
export function useAgentCount(): {
  count: number | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const enabled = !isZeroAddress(AGENT_MANAGER_ADDRESS);

  const { data, isLoading, error } = useReadContract({
    address: AGENT_MANAGER_ADDRESS,
    abi: AGENT_MANAGER_ABI,
    functionName: "agentCount",
    chainId: ogGalileo.id,
    query: { enabled },
  });

  return {
    count: data !== undefined ? Number(data) : undefined,
    isLoading,
    error: error ?? null,
  };
}

/**
 * Reads getAgentInfo(agentId) from AgentManager on 0G Galileo.
 * Returns a typed AgentInfo object, or undefined if not yet loaded.
 */
export function useAgentInfo(agentId: number): {
  agent: AgentInfo | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const enabled = !isZeroAddress(AGENT_MANAGER_ADDRESS);

  const { data, isLoading, error } = useReadContract({
    address: AGENT_MANAGER_ADDRESS,
    abi: AGENT_MANAGER_ABI,
    functionName: "getAgentInfo",
    args: [BigInt(agentId)],
    chainId: ogGalileo.id,
    query: { enabled },
  });

  if (!data) {
    return { agent: undefined, isLoading, error: error ?? null };
  }

  // data is a tuple: [agentAddress, phase, emaReturn, emaReturnSq, sharpeScore,
  //                   credits, maxCredits, refillRate, epochsCompleted, zeroSharpeStreak]
  const [
    agentAddress,
    phase,
    emaReturn,
    emaReturnSq,
    sharpeScore,
    credits,
    maxCredits,
    refillRate,
    epochsCompleted,
    zeroSharpeStreak,
  ] = data as [
    `0x${string}`,
    number,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ];

  const agent: AgentInfo = {
    id: agentId,
    address: agentAddress,
    // phase 0 = vault, 1 = proving (contract convention)
    phase: phase === 0 ? "vault" : "proving",
    emaReturn: Number(emaReturn) / 1e18,
    emaReturnSq: Number(emaReturnSq) / 1e18,
    sharpeScore: Number(sharpeScore) / 1e18,
    credits: Number(credits),
    maxCredits: Number(maxCredits),
    refillRate: Number(refillRate),
    epochsCompleted: Number(epochsCompleted),
    zeroSharpeStreak: Number(zeroSharpeStreak),
  };

  return { agent, isLoading, error: error ?? null };
}

/**
 * Batch reads sharePrice, totalAssets, totalShares from Vault on 0G Galileo.
 * Returns BigInt results as strings for compatibility with existing formatters.
 */
export function useVaultData(): {
  sharePrice: string | undefined;
  totalAssets: string | undefined;
  totalShares: string | undefined;
  isLoading: boolean;
} {
  const enabled = !isZeroAddress(VAULT_ADDRESS);

  const { data, isLoading } = useReadContracts({
    contracts: [
      {
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "sharePrice",
        chainId: ogGalileo.id,
      },
      {
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "totalAssets",
        chainId: ogGalileo.id,
      },
      {
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "totalShares",
        chainId: ogGalileo.id,
      },
    ],
    query: { enabled },
  });

  return {
    sharePrice:
      data?.[0]?.status === "success" && data[0].result !== undefined
        ? (data[0].result as bigint).toString()
        : undefined,
    totalAssets:
      data?.[1]?.status === "success" && data[1].result !== undefined
        ? (data[1].result as bigint).toString()
        : undefined,
    totalShares:
      data?.[2]?.status === "success" && data[2].result !== undefined
        ? (data[2].result as bigint).toString()
        : undefined,
    isLoading,
  };
}

/**
 * Reads balanceOf(userAddress) from Vault on 0G Galileo.
 * Returns the user's vault shares as a string.
 */
export function useUserVaultShares(userAddress: string | undefined): {
  shares: string | undefined;
  isLoading: boolean;
} {
  const enabled =
    !isZeroAddress(VAULT_ADDRESS) &&
    userAddress !== undefined &&
    !isZeroAddress(userAddress);

  const { data, isLoading } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "balanceOf",
    args: [userAddress as `0x${string}`],
    chainId: ogGalileo.id,
    query: { enabled },
  });

  return {
    shares: data !== undefined ? (data as bigint).toString() : undefined,
    isLoading,
  };
}

/**
 * Reads balanceOf(userAddress) from Satellite on Sepolia.
 * Returns USDC.e share balance as a string.
 */
export function useSatelliteBalance(userAddress: string | undefined): {
  balance: string | undefined;
  isLoading: boolean;
} {
  const enabled =
    !isZeroAddress(SATELLITE_ADDRESS) &&
    userAddress !== undefined &&
    !isZeroAddress(userAddress);

  const { data, isLoading } = useReadContract({
    address: SATELLITE_ADDRESS,
    abi: SATELLITE_ABI,
    functionName: "balanceOf",
    args: [userAddress as `0x${string}`],
    chainId: sepolia.id,
    query: { enabled },
  });

  return {
    balance: data !== undefined ? (data as bigint).toString() : undefined,
    isLoading,
  };
}

/**
 * Batch reads protocolFeesAccrued, commissionPool, totalAssets from Vault on 0G Galileo.
 * Returns fee totals as strings for compatibility with MOCK_FEES shape.
 */
export function useFeeData(): {
  protocolFeesAccrued: string | undefined;
  commissionPool: string | undefined;
  totalAssets: string | undefined;
  isLoading: boolean;
} {
  const enabled = !isZeroAddress(VAULT_ADDRESS);

  const { data, isLoading } = useReadContracts({
    contracts: [
      {
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "protocolFeesAccrued",
        chainId: ogGalileo.id,
      },
      {
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "commissionPool",
        chainId: ogGalileo.id,
      },
      {
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "totalAssets",
        chainId: ogGalileo.id,
      },
    ],
    query: { enabled },
  });

  return {
    protocolFeesAccrued:
      data?.[0]?.status === "success" && data[0].result !== undefined
        ? (data[0].result as bigint).toString()
        : undefined,
    commissionPool:
      data?.[1]?.status === "success" && data[1].result !== undefined
        ? (data[1].result as bigint).toString()
        : undefined,
    totalAssets:
      data?.[2]?.status === "success" && data[2].result !== undefined
        ? (data[2].result as bigint).toString()
        : undefined,
    isLoading,
  };
}
