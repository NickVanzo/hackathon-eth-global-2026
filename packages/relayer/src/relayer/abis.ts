// ---------------------------------------------------------------------------
// Minimal ABIs — only the functions and events the relayer needs to call.
// Full ABIs live in packages/contracts; these are just the relay surfaces.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Vault (0G) — functions called by the relayer (all onlyMessenger)
// ---------------------------------------------------------------------------

export const VAULT_ABI = [
  // Messenger-only writes
  {
    name: "recordDeposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "processWithdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "shares", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "claimWithdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "tokenAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "recordRecovery",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "recoveredAmount", type: "uint256" },
    ],
    outputs: [],
  },
  // Epoch trigger (callable by anyone)
  {
    name: "triggerSettleEpoch",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  // Views
  {
    name: "sharePrice",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalAssets",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "epochLength",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "lastEpochBlock",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ---------------------------------------------------------------------------
// AgentManager (0G) — functions called by the relayer (all onlyMessenger)
// Note: recordClosure and processWithdrawFromArena are spec'd but may not be
//       in the deployed interface yet; handlers wrap calls in try/catch.
// ---------------------------------------------------------------------------

export const AGENT_MANAGER_ABI = [
  {
    name: "recordRegistration",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "agentAddress", type: "address" },
      { name: "deployer", type: "address" },
      { name: "provingAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "reportValues",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "positionValue", type: "uint256" },
      { name: "feesCollected", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "processPause",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "caller", type: "address" },
      { name: "paused", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "processCommissionClaim",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "caller", type: "address" },
    ],
    outputs: [],
  },
  // Spec-defined but may not be in deployed ABI yet
  {
    name: "recordClosure",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "recoveredAmount", type: "uint256" },
      { name: "source", type: "uint8" }, // ForceCloseSource enum
    ],
    outputs: [],
  },
  {
    name: "processWithdrawFromArena",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "caller", type: "address" },
    ],
    outputs: [],
  },
  // Views
  {
    name: "agentPhase",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "uint8" }], // AgentPhase enum: 0=PROVING, 1=VAULT
  },
] as const;

// ---------------------------------------------------------------------------
// Satellite (Sepolia) — functions called by the relayer (all onlyMessenger)
// ---------------------------------------------------------------------------

export const SATELLITE_ABI = [
  // Relayer writes
  {
    name: "release",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "tokenAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "releaseQueuedWithdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "tokenAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "updateSharePrice",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "sharePrice", type: "uint256" }],
    outputs: [],
  },
  {
    name: "reserveProtocolFees",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "reserveCommission",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "approveQueuedWithdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "tokenAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "releaseCommission",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "caller", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "forceClose",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "positionIds", type: "uint256[]" },
      { name: "source", type: "uint8" }, // ForceCloseSource enum
      { name: "swapCalldata", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    // Intent struct: { agentId: uint256, actionType: uint8, params: bytes, blockNumber: uint256 }
    name: "executeBatch",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "intents",
        type: "tuple[]",
        components: [
          { name: "agentId", type: "uint256" },
          { name: "actionType", type: "uint8" },
          { name: "params", type: "bytes" },
          { name: "blockNumber", type: "uint256" },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: "collectAndReport",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "positionValue", type: "uint256" },
    ],
    outputs: [],
  },
  // Views
  {
    name: "cachedSharePrice",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getAgentPositions",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    name: "positionSource",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint8" }], // ForceCloseSource enum
  },
  {
    name: "idleBalance",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
