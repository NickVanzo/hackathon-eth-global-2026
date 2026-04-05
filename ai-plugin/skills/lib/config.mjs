// Shared constants for Agent Arena plugin

export const CONFIG = {
  OG_RPC_URL: "https://evmrpc-testnet.0g.ai",
  AGENT_MANAGER_ADDRESS: "0x9571BDFB6a767Da89Fe5365016Ec72FB55d0244a",
  MCP_SERVER_URL: "https://us-central1-subgraph-mcp.cloudfunctions.net/mcp",
  POOL_ADDRESS: "0x6Ce0896eAE6D4BD668fDe41BB784548fb8F59b50",
  CHAIN_ID: 16602,
  SEPOLIA_CHAIN_ID: 11155111,
  DEFAULT_INTERVAL_MS: 120_000,
  FAUCET_URL: "https://faucet.0g.ai",
};

export const AGENT_MANAGER_ABI = [
  // submitIntent(agentId, intentData)
  "function submitIntent(uint256 agentId, bytes calldata intentData) external",

  // addressToAgentId(address) → agentId
  "function addressToAgentId(address agent) external view returns (uint256)",

  // agentAddress(agentId) → address
  "function agentAddress(uint256 agentId) external view returns (address)",

  // agentPhase(agentId) → phase (0=Pending, 1=Active, 2=Suspended, 3=Eliminated)
  "function agentPhase(uint256 agentId) external view returns (uint8)",

  // provingBalance(agentId) → balance in 6-decimal units
  "function provingBalance(uint256 agentId) external view returns (uint256)",

  // provingDeployed(agentId) → deployed capital in 6-decimal units
  "function provingDeployed(uint256 agentId) external view returns (uint256)",

  // isPaused() → bool
  "function isPaused(uint256 agentId) external view returns (bool)",

  // credits(agentId) → credit balance
  "function credits(uint256 agentId) external view returns (uint256)",
];
