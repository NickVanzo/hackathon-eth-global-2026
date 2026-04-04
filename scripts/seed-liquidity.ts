// Seed initial liquidity into the Uniswap v3 USDC.e/WETH pool on Sepolia.
// Run with: npx tsx scripts/seed-liquidity.ts
// Do NOT run until UNISWAP_V3_POOL_ADDRESS is confirmed in .env.
import 'dotenv/config';
import { ethers } from 'ethers';

// ─── Config ──────────────────────────────────────────────────────────────────

const RPC_URL =
  process.env.SEPOLIA_RPC_URL ?? 'https://sepolia.drpc.org';

const PRIVATE_KEY = process.env.PRIVATE_KEY_DEPLOYER;
if (!PRIVATE_KEY) throw new Error('PRIVATE_KEY_DEPLOYER not set in .env');

const USDC_E_ADDRESS = process.env.USDC_E_ADDRESS;
if (!USDC_E_ADDRESS) throw new Error('USDC_E_ADDRESS not set in .env');

const WETH_ADDRESS = process.env.WETH_ADDRESS;
if (!WETH_ADDRESS) throw new Error('WETH_ADDRESS not set in .env');

const POOL_ADDRESS = process.env.UNISWAP_V3_POOL_ADDRESS;
if (!POOL_ADDRESS) throw new Error('UNISWAP_V3_POOL_ADDRESS not set in .env');

const POSITION_MANAGER_ADDRESS =
  process.env.UNISWAP_POSITION_MANAGER ??
  '0x1238536071E1c677A632429e3655c799b22cDA52';

// ─── Amounts ─────────────────────────────────────────────────────────────────

const USDC_E_AMOUNT = ethers.parseUnits('10000', 6);   // 10,000 USDC.e (6 decimals)
const WETH_AMOUNT   = ethers.parseUnits('0.01',  18);  // 0.01 WETH   (18 decimals)

// Full-range ticks for fee tier 3000 (tickSpacing 60)
const TICK_LOWER = -887220;
const TICK_UPPER =  887220;

// ─── ABIs ─────────────────────────────────────────────────────────────────────

// Minimal ERC-20 + optional mock mint
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  // Present on mock tokens only — existence is checked at runtime
  'function mint(address to, uint256 amount) external',
];

// WETH deposit (wrap ETH)
const WETH_ABI = [
  ...ERC20_ABI,
  'function deposit() external payable',
];

// NonfungiblePositionManager.mint
const POSITION_MANAGER_ABI = [
  `function mint(
    (
      address token0,
      address token1,
      uint24  fee,
      int24   tickLower,
      int24   tickUpper,
      uint256 amount0Desired,
      uint256 amount1Desired,
      uint256 amount0Min,
      uint256 amount1Min,
      address recipient,
      uint256 deadline
    ) params
  ) external payable returns (
    uint256 tokenId,
    uint128 liquidity,
    uint256 amount0,
    uint256 amount1
  )`,
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns true when a contract exposes a public `mint(address,uint256)` function. */
async function hasMintFunction(
  address: string,
  provider: ethers.JsonRpcProvider,
): Promise<boolean> {
  // The function selector for mint(address,uint256) is 0x40c10f19
  const MINT_SELECTOR = '0x40c10f19';
  const code = await provider.getCode(address);
  return code.includes(MINT_SELECTOR.slice(2)); // strip 0x for inclusion check
}

/** Orders token0/token1 to satisfy Uniswap's requirement that token0 < token1. */
function sortTokens(
  addrA: string,
  addrB: string,
): [string, string] {
  return addrA.toLowerCase() < addrB.toLowerCase()
    ? [addrA, addrB]
    : [addrB, addrA];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(PRIVATE_KEY!, provider);
  const deployer = wallet.address;

  console.log('Deployer:', deployer);
  console.log('RPC:     ', RPC_URL);
  console.log('');

  // ── 1. Mint mock USDC.e if the token supports it ────────────────────────────
  const usdcE = new ethers.Contract(USDC_E_ADDRESS!, ERC20_ABI, wallet);

  if (await hasMintFunction(USDC_E_ADDRESS!, provider)) {
    console.log('Mock USDC.e detected — minting 10,000 USDC.e to deployer…');
    const mintTx = await usdcE.mint(deployer, USDC_E_AMOUNT);
    await mintTx.wait();
    console.log('  Mint tx:', mintTx.hash);
  } else {
    console.log('USDC.e does not expose mint() — skipping mint step.');
  }

  // ── 2. Wrap 0.01 ETH → WETH ─────────────────────────────────────────────────
  console.log('\nWrapping 0.01 ETH → WETH…');
  const weth = new ethers.Contract(WETH_ADDRESS!, WETH_ABI, wallet);
  const wrapTx = await weth.deposit({ value: WETH_AMOUNT });
  await wrapTx.wait();
  console.log('  Wrap tx:', wrapTx.hash);

  // ── 3. Approve both tokens to the NonfungiblePositionManager ────────────────
  console.log('\nApproving tokens to NonfungiblePositionManager…');

  const approveTx1 = await usdcE.approve(
    POSITION_MANAGER_ADDRESS,
    ethers.MaxUint256,
  );
  await approveTx1.wait();
  console.log('  USDC.e approval tx:', approveTx1.hash);

  const approveTx2 = await weth.approve(
    POSITION_MANAGER_ADDRESS,
    ethers.MaxUint256,
  );
  await approveTx2.wait();
  console.log('  WETH approval tx:  ', approveTx2.hash);

  // ── 4. Determine canonical token0 / token1 ordering ─────────────────────────
  const [token0, token1] = sortTokens(USDC_E_ADDRESS!, WETH_ADDRESS!);
  const isUsdcToken0     = token0.toLowerCase() === USDC_E_ADDRESS!.toLowerCase();

  // Map desired amounts to the correct ordering
  const amount0Desired = isUsdcToken0 ? USDC_E_AMOUNT : WETH_AMOUNT;
  const amount1Desired = isUsdcToken0 ? WETH_AMOUNT   : USDC_E_AMOUNT;

  console.log('\nToken ordering:');
  console.log('  token0:', token0, isUsdcToken0 ? '(USDC.e)' : '(WETH)');
  console.log('  token1:', token1, isUsdcToken0 ? '(WETH)'   : '(USDC.e)');

  // ── 5. Add full-range liquidity via NonfungiblePositionManager.mint ──────────
  const deadline = Math.floor(Date.now() / 1000) + 600; // now + 10 min

  const mintParams = {
    token0,
    token1,
    fee:            3000,
    tickLower:      TICK_LOWER,
    tickUpper:      TICK_UPPER,
    amount0Desired,
    amount1Desired,
    amount0Min:     0n,
    amount1Min:     0n,
    recipient:      deployer,
    deadline,
  };

  console.log('\nAdding full-range liquidity position…');

  const positionManager = new ethers.Contract(
    POSITION_MANAGER_ADDRESS,
    POSITION_MANAGER_ABI,
    wallet,
  );

  const mintTx = await positionManager.mint(mintParams);
  const receipt = await mintTx.wait();
  console.log('  Mint tx:', mintTx.hash);

  // ── 6. Parse and log results ─────────────────────────────────────────────────
  // The IncreaseLiquidity event emitted by the NonfungiblePositionManager
  // carries (tokenId, liquidity, amount0, amount1).
  // Selector: IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
  const INCREASE_LIQUIDITY_TOPIC =
    ethers.id('IncreaseLiquidity(uint256,uint128,uint256,uint256)');

  let tokenId: bigint | undefined;
  let amount0: bigint | undefined;
  let amount1: bigint | undefined;

  for (const log of receipt.logs) {
    if (log.topics[0] === INCREASE_LIQUIDITY_TOPIC) {
      tokenId = BigInt(log.topics[1]);
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ['uint128', 'uint256', 'uint256'],
        log.data,
      );
      [, amount0, amount1] = decoded as [bigint, bigint, bigint];
      break;
    }
  }

  console.log('\n── Liquidity position seeded ──────────────────────────────────');
  if (tokenId !== undefined) {
    console.log('  tokenId: ', tokenId.toString());
  } else {
    console.log('  tokenId:  (could not parse — check tx on Etherscan)');
  }

  if (amount0 !== undefined && amount1 !== undefined) {
    const [usdcDeposited, wethDeposited] = isUsdcToken0
      ? [amount0, amount1]
      : [amount1, amount0];

    console.log(
      '  USDC.e deposited:',
      ethers.formatUnits(usdcDeposited, 6),
      'USDC.e',
    );
    console.log(
      '  WETH deposited:  ',
      ethers.formatUnits(wethDeposited, 18),
      'WETH',
    );
  } else {
    console.log('  amounts: (could not parse — check tx on Etherscan)');
  }

  console.log('');
  console.log('Done. Record UNISWAP_V3_POOL_ADDRESS in .env if not already set.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
