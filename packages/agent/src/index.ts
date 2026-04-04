// @agent-arena/agent entry point
import { ethers } from 'ethers';
import { createZGComputeNetworkBroker } from '@0glabs/0g-serving-broker';
import 'dotenv/config';

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.OG_RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY_AGENT_A!, provider);
  const broker = await createZGComputeNetworkBroker(wallet);

  console.log('0G Compute broker initialized');
  console.log('Wallet:', wallet.address);

  const services = await broker.inference.listService();
  console.log(`Available services: ${services.length}`);
}

main().catch(console.error);

