// @agent-arena/relayer entry point
import { ethers } from 'ethers';
import 'dotenv/config';

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.OG_RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY_RELAYER!, provider);

  console.log('Relayer initialized');
  console.log('Wallet:', wallet.address);
}

main().catch(console.error);

