import { ethers } from "ethers";
import { CONFIG, AGENT_MANAGER_ABI } from "./config.mjs";

/**
 * Read AGENT_PRIVATE_KEY from env and return wallet, address, provider.
 * @returns {{ wallet: ethers.Wallet, address: string, provider: ethers.JsonRpcProvider }}
 */
export function getWallet() {
  const privateKey = process.env.AGENT_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("AGENT_PRIVATE_KEY environment variable is not set");
  }
  const provider = new ethers.JsonRpcProvider(CONFIG.OG_RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);
  const address = wallet.address;
  return { wallet, address, provider };
}

/**
 * Query AgentManager.addressToAgentId(address).
 * @param {string} address
 * @returns {Promise<number>} agentId, or 0 if not registered
 */
export async function getAgentId(address) {
  const provider = new ethers.JsonRpcProvider(CONFIG.OG_RPC_URL);
  const contract = new ethers.Contract(
    CONFIG.AGENT_MANAGER_ADDRESS,
    AGENT_MANAGER_ABI,
    provider
  );
  try {
    const id = await contract.addressToAgentId(address);
    return Number(id);
  } catch {
    return 0;
  }
}

/**
 * Return full agent info for the given address.
 * @param {string} address
 * @returns {Promise<{ agentId: number, address: string, phase: number, provingBalance: string, provingDeployed: string, paused: boolean } | null>}
 *   Returns null if the agent is not registered (agentId === 0).
 */
export async function getAgentInfo(address) {
  const provider = new ethers.JsonRpcProvider(CONFIG.OG_RPC_URL);
  const contract = new ethers.Contract(
    CONFIG.AGENT_MANAGER_ADDRESS,
    AGENT_MANAGER_ABI,
    provider
  );

  const agentId = await getAgentId(address);
  if (agentId === 0) {
    return null;
  }

  const [phase, provingBalanceRaw, provingDeployedRaw, paused] =
    await Promise.all([
      contract.agentPhase(agentId),
      contract.provingBalance(agentId),
      contract.provingDeployed(agentId),
      contract.isPaused(),
    ]);

  return {
    agentId,
    address,
    phase: Number(phase),
    provingBalance: ethers.formatUnits(provingBalanceRaw, 6),
    provingDeployed: ethers.formatUnits(provingDeployedRaw, 6),
    paused: Boolean(paused),
  };
}

/**
 * Return the 0G native token balance for the given address.
 * @param {string} address
 * @returns {Promise<string>} balance in ETH-unit string
 */
export async function getBalance(address) {
  const provider = new ethers.JsonRpcProvider(CONFIG.OG_RPC_URL);
  const raw = await provider.getBalance(address);
  return ethers.formatEther(raw);
}
