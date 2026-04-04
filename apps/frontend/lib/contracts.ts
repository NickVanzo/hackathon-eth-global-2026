import { parseAbi, type Abi } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { ogGalileo, sepolia } from "@/lib/chains";
import AgentManagerABI from "../../../packages/shared/abis/AgentManager.json";
import VaultABI from "../../../packages/shared/abis/Vault.json";
import SatelliteABI from "../../../packages/shared/abis/Satellite.json";

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

export const USDC_E_ADDRESS =
  (process.env.NEXT_PUBLIC_USDC_E_ADDRESS as `0x${string}` | undefined) ??
  ZERO_ADDRESS;

export const INFT_ADDRESS =
  (process.env.NEXT_PUBLIC_INFT_ADDRESS as `0x${string}` | undefined) ??
  ZERO_ADDRESS;

export function isZeroAddress(addr: string): boolean {
  return addr === ZERO_ADDRESS;
}

// ---------------------------------------------------------------------------
// Minimal inline ABI for USDC.e (standard ERC-20 balanceOf + approve + allowance)
// ---------------------------------------------------------------------------

export const USDC_E_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

// ---------------------------------------------------------------------------
// Sharpe computation (replicates on-chain logic client-side)
// ---------------------------------------------------------------------------

const SCALE = 10n ** 18n;
const MIN_VARIANCE = 10n ** 12n;

export function computeSharpe(emaR: bigint, emaR2: bigint): number {
  if (emaR <= 0n) return 0;
  const emaRSq = (emaR * emaR) / SCALE;
  const varSigned = emaR2 - emaRSq;
  let variance = varSigned > 0n ? varSigned : 0n;
  if (variance < MIN_VARIANCE) variance = MIN_VARIANCE;
  // integer sqrt of (variance * SCALE)
  const x = variance * SCALE;
  if (x === 0n) return 0;
  let z = (x + 1n) / 2n;
  let y = x;
  while (z < y) {
    y = z;
    z = (x / z + z) / 2n;
  }
  const sqrtVal = y;
  if (sqrtVal === 0n) return 0;
  return Number((emaR * SCALE) / sqrtVal) / Number(SCALE);
}

// ---------------------------------------------------------------------------
// Typed return shape for agent info
// ---------------------------------------------------------------------------

export type AgentInfo = {
  id: number;
  address: string;
  phase: "vault" | "proving";
  sharpeScore: number;      // computed client-side
  emaReturn: number;        // Number(emaReturn) / 1e18
  emaReturnSq: number;      // Number(emaReturnSq) / 1e18
  credits: number;
  maxCredits: number;
  refillRate: number;
  epochsCompleted: number;
  zeroSharpeStreak: number;
  provingBalance: string;   // raw bigint as string
  provingDeployed: string;  // raw bigint as string
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
    abi: AgentManagerABI as Abi,
    functionName: "agentCount",
    chainId: ogGalileo.id,
    query: { enabled },
  });

  return {
    count: data !== undefined ? Number(data as bigint) : undefined,
    isLoading,
    error: error ?? null,
  };
}

/**
 * Reads getActiveAgentIds() from AgentManager on 0G Galileo.
 */
export function useActiveAgentIds(): {
  ids: number[] | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const enabled = !isZeroAddress(AGENT_MANAGER_ADDRESS);

  const { data, isLoading, error } = useReadContract({
    address: AGENT_MANAGER_ADDRESS,
    abi: AgentManagerABI as Abi,
    functionName: "getActiveAgentIds",
    chainId: ogGalileo.id,
    query: { enabled },
  });

  return {
    ids: data !== undefined ? (data as bigint[]).map(Number) : undefined,
    isLoading,
    error: error ?? null,
  };
}

/**
 * Batch reads agents(id), scores(id), buckets(id) from AgentManager on 0G Galileo.
 * Returns a typed AgentInfo object, or undefined if not yet loaded.
 */
export function useAgentInfo(agentId: number): {
  agent: AgentInfo | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const enabled = !isZeroAddress(AGENT_MANAGER_ADDRESS);

  const { data, isLoading, error } = useReadContracts({
    contracts: [
      {
        address: AGENT_MANAGER_ADDRESS,
        abi: AgentManagerABI as Abi,
        functionName: "agents",
        args: [BigInt(agentId)],
        chainId: ogGalileo.id,
      },
      {
        address: AGENT_MANAGER_ADDRESS,
        abi: AgentManagerABI as Abi,
        functionName: "scores",
        args: [BigInt(agentId)],
        chainId: ogGalileo.id,
      },
      {
        address: AGENT_MANAGER_ADDRESS,
        abi: AgentManagerABI as Abi,
        functionName: "buckets",
        args: [BigInt(agentId)],
        chainId: ogGalileo.id,
      },
    ],
    query: { enabled },
  });

  if (!data) {
    return { agent: undefined, isLoading, error: error ?? null };
  }

  const agentsResult = data[0]?.status === "success" ? data[0].result : undefined;
  const scoresResult = data[1]?.status === "success" ? data[1].result : undefined;
  const bucketsResult = data[2]?.status === "success" ? data[2].result : undefined;

  if (!agentsResult || !scoresResult || !bucketsResult) {
    return { agent: undefined, isLoading, error: error ?? null };
  }

  // agents(id) -> (address agentAddress, uint8 phase, uint256 provingBalance,
  //                uint256 provingDeployed, uint256 epochsCompleted,
  //                uint256 zeroSharpeStreak, bool paused, bool registered)
  const [agentAddress, phaseRaw, provingBalance, provingDeployed, epochsCompleted, zeroSharpeStreak] =
    agentsResult as [string, number, bigint, bigint, bigint, bigint, boolean, boolean];

  // scores(id) -> (int256 emaReturn, int256 emaReturnSq, uint256 positionValue,
  //               uint256 feesCollected, uint256 lastReportedBlock)
  const [emaReturnRaw, emaReturnSqRaw] = scoresResult as [bigint, bigint, bigint, bigint, bigint];

  // buckets(id) -> (uint256 credits, uint256 maxCredits, uint256 refillRate, uint256 lastActionBlock)
  const [credits, maxCredits, refillRate] = bucketsResult as [bigint, bigint, bigint, bigint];

  const agent: AgentInfo = {
    id: agentId,
    address: agentAddress,
    // phase: 0 = PROVING, 1 = VAULT
    phase: phaseRaw === 0 ? "proving" : "vault",
    sharpeScore: computeSharpe(emaReturnRaw, emaReturnSqRaw),
    emaReturn: Number(emaReturnRaw) / 1e18,
    emaReturnSq: Number(emaReturnSqRaw) / 1e18,
    credits: Number(credits),
    maxCredits: Number(maxCredits),
    refillRate: Number(refillRate),
    epochsCompleted: Number(epochsCompleted),
    zeroSharpeStreak: Number(zeroSharpeStreak),
    provingBalance: provingBalance.toString(),
    provingDeployed: provingDeployed.toString(),
  };

  return { agent, isLoading, error: error ?? null };
}

/**
 * Batch reads sharePrice, totalAssets, totalSupply from Vault on 0G Galileo.
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
        abi: VaultABI as Abi,
        functionName: "sharePrice",
        chainId: ogGalileo.id,
      },
      {
        address: VAULT_ADDRESS,
        abi: VaultABI as Abi,
        functionName: "totalAssets",
        chainId: ogGalileo.id,
      },
      {
        address: VAULT_ADDRESS,
        abi: VaultABI as Abi,
        functionName: "totalSupply",
        chainId: ogGalileo.id,
      },
    ],
    query: { enabled },
  });

  return {
    sharePrice:
      data?.[0]?.status === "success" && data[0].result !== undefined
        ? ((data[0].result as bigint) / 10n ** 12n).toString()  // WAD (1e18) → 6 decimals
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
 * Returns the user's vault share balance as a string.
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
    abi: VaultABI as Abi,
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
 * Reads pendingWithdrawal(userAddress) from Vault on 0G Galileo.
 * Returns the user's pending withdrawal amount as a string.
 */
export function useUserPendingWithdrawal(userAddress: string | undefined): {
  pendingWithdrawal: string | undefined;
  isLoading: boolean;
} {
  const enabled =
    !isZeroAddress(VAULT_ADDRESS) &&
    userAddress !== undefined &&
    !isZeroAddress(userAddress);

  const { data, isLoading } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VaultABI as Abi,
    functionName: "pendingWithdrawal",
    args: [userAddress as `0x${string}`],
    chainId: ogGalileo.id,
    query: { enabled },
  });

  return {
    pendingWithdrawal: data !== undefined ? (data as bigint).toString() : undefined,
    isLoading,
  };
}

/**
 * Reads balanceOf(userAddress) from USDC.e ERC-20 on Sepolia.
 * Returns USDC.e balance (6 decimals) as a string.
 */
export function useUSDCBalance(userAddress: string | undefined): {
  balance: string | undefined;
  isLoading: boolean;
} {
  const enabled =
    !isZeroAddress(USDC_E_ADDRESS) &&
    userAddress !== undefined &&
    !isZeroAddress(userAddress);

  const { data, isLoading } = useReadContract({
    address: USDC_E_ADDRESS,
    abi: USDC_E_ABI,
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
 * Reads allowance(owner, spender) from USDC.e ERC-20 on Sepolia.
 * Returns the current allowance as a bigint.
 */
export function useUSDCAllowance(
  owner: string | undefined,
  spender: string
): {
  allowance: bigint | undefined;
  isLoading: boolean;
  refetch: () => void;
} {
  const enabled =
    !isZeroAddress(USDC_E_ADDRESS) &&
    owner !== undefined &&
    !isZeroAddress(owner);

  const { data, isLoading, refetch } = useReadContract({
    address: USDC_E_ADDRESS,
    abi: USDC_E_ABI,
    functionName: "allowance",
    args: [owner as `0x${string}`, spender as `0x${string}`],
    chainId: sepolia.id,
    query: { enabled },
  });

  return {
    allowance: data !== undefined ? (data as bigint) : undefined,
    isLoading,
    refetch,
  };
}

/**
 * Backwards-compatible alias for useUSDCBalance.
 * Previously read from Satellite.balanceOf — now reads USDC.e directly on Sepolia.
 */
export function useSatelliteBalance(userAddress: string | undefined): {
  balance: string | undefined;
  isLoading: boolean;
} {
  return useUSDCBalance(userAddress);
}

/**
 * Batch reads protocolFeesAccrued, currentEpoch, totalAssets from Vault on 0G Galileo.
 * commissionPool is not directly available on-chain — returns undefined (components fall back to mock).
 */
export function useFeeData(): {
  protocolFeesAccrued: string | undefined;
  currentEpoch: string | undefined;
  totalAssets: string | undefined;
  commissionPool: string | undefined;
  isLoading: boolean;
} {
  const enabled = !isZeroAddress(VAULT_ADDRESS);

  const { data, isLoading } = useReadContracts({
    contracts: [
      {
        address: VAULT_ADDRESS,
        abi: VaultABI as Abi,
        functionName: "protocolFeesAccrued",
        chainId: ogGalileo.id,
      },
      {
        address: VAULT_ADDRESS,
        abi: VaultABI as Abi,
        functionName: "currentEpoch",
        chainId: ogGalileo.id,
      },
      {
        address: VAULT_ADDRESS,
        abi: VaultABI as Abi,
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
    currentEpoch:
      data?.[1]?.status === "success" && data[1].result !== undefined
        ? (data[1].result as bigint).toString()
        : undefined,
    totalAssets:
      data?.[2]?.status === "success" && data[2].result !== undefined
        ? (data[2].result as bigint).toString()
        : undefined,
    // No direct commissionPool getter on Vault — per-agent commissionsOwed(agentId) exists instead
    commissionPool: undefined,
    isLoading,
  };
}

// ---------------------------------------------------------------------------
// Re-exported ABIs for use in write hooks (deposit, withdraw, etc.)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// iNFT (ERC-721) ABI and hooks
// ---------------------------------------------------------------------------

const INFT_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

/**
 * Reads ownerOf(tokenId) from iNFT ERC-721 on 0G Galileo.
 */
export function useINFTOwner(tokenId: number): {
  owner: string | undefined;
  isLoading: boolean;
} {
  const enabled = !isZeroAddress(INFT_ADDRESS) && tokenId > 0;

  const { data, isLoading } = useReadContract({
    address: INFT_ADDRESS,
    abi: INFT_ABI,
    functionName: "ownerOf",
    args: [BigInt(tokenId)],
    chainId: ogGalileo.id,
    query: { enabled },
  });

  return {
    owner: data !== undefined ? (data as string) : undefined,
    isLoading,
  };
}

/**
 * Reads agentToTokenId(agentId) from AgentManager on 0G Galileo.
 */
export function useAgentTokenId(agentId: number): {
  tokenId: number | undefined;
  isLoading: boolean;
} {
  const enabled = !isZeroAddress(AGENT_MANAGER_ADDRESS);

  const { data, isLoading } = useReadContract({
    address: AGENT_MANAGER_ADDRESS,
    abi: AgentManagerABI as Abi,
    functionName: "agentToTokenId",
    args: [BigInt(agentId)],
    chainId: ogGalileo.id,
    query: { enabled },
  });

  return {
    tokenId: data !== undefined ? Number(data as bigint) : undefined,
    isLoading,
  };
}

export { AgentManagerABI, VaultABI, SatelliteABI };
