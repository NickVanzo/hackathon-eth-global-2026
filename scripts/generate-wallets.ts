// Run once, copy output to .env — never commit .env
import { ethers } from 'ethers';

const deployer = ethers.Wallet.createRandom();
const relayer = ethers.Wallet.createRandom();

console.log('DEPLOYER');
console.log(`  Address:     ${deployer.address}`);
console.log(`  Private Key: ${deployer.privateKey}`);
console.log('');
console.log('RELAYER');
console.log(`  Address:     ${relayer.address}`);
console.log(`  Private Key: ${relayer.privateKey}`);
