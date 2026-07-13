import { encodeFunctionData, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { requirePrivateKey, getPublicClient } from '@bianca/config';

/**
 * Prepares the ERC-8004 setAgentWallet(9660, <trading wallet>) transaction
 * for the OWNER wallet to send: the registry requires an EIP-712 signature
 * from the NEW wallet (proof of control) with a deadline at most 5 minutes
 * in the future, so the calldata must be generated right before sending.
 *
 * Signs with PRIVATE_KEY from .env (the trading wallet — this is an
 * off-chain signature only; the on-chain tx is sent by the owner wallet).
 *
 * Usage: tsx scripts/set-agent-wallet.ts
 */

const REGISTRY = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432' as const;
const AGENT_ID = 9660n;
const OWNER = '0x9bFBf2530683ca15a6F54c907e0A35c92A7d09e9' as const;
const EXPECTED_WALLET = '0xd16f066D8789C4D5d29e61ec63bD26d01A6c7D7E' as const;

const account = privateKeyToAccount(requirePrivateKey());
if (account.address.toLowerCase() !== EXPECTED_WALLET.toLowerCase()) {
  throw new Error(`PRIVATE_KEY is ${account.address}, expected trading wallet ${EXPECTED_WALLET}`);
}

// Deadline from the CHAIN clock, not local time (contract: block.timestamp
// <= deadline <= block.timestamp + 5 minutes at execution).
const client = getPublicClient('mainnet');
const block = await client.getBlock();
const deadline = block.timestamp + 270n; // ~4.5 min window to land the tx

const signature = await account.signTypedData({
  domain: {
    name: 'ERC8004IdentityRegistry',
    version: '1',
    chainId: 42220,
    verifyingContract: REGISTRY,
  },
  types: {
    AgentWalletSet: [
      { name: 'agentId', type: 'uint256' },
      { name: 'newWallet', type: 'address' },
      { name: 'owner', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
  },
  primaryType: 'AgentWalletSet',
  message: { agentId: AGENT_ID, newWallet: account.address, owner: OWNER, deadline },
});

const abi = parseAbi([
  'function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature)',
  'function getAgentWallet(uint256 agentId) view returns (address)',
]);
const data = encodeFunctionData({
  abi,
  functionName: 'setAgentWallet',
  args: [AGENT_ID, account.address, deadline, signature],
});

// Simulate from the owner so a bad signature/deadline fails HERE, not on-chain.
await client.call({ account: OWNER, to: REGISTRY, data });

console.log('setAgentWallet tx prepared and simulation from owner PASSED.');
console.log('');
console.log('Celoscan "Write as Proxy" — connect the OWNER wallet, then:');
console.log(`  https://celoscan.io/address/${REGISTRY}#writeProxyContract`);
console.log('  function: setAgentWallet — paste each field:');
console.log(`    agentId   (uint256): ${AGENT_ID}`);
console.log(`    newWallet (address): ${account.address}`);
console.log(`    deadline  (uint256): ${deadline}`);
console.log(`    signature (bytes):   ${signature}`);
console.log('');
console.log('Or raw calldata (dApp/contract-interaction flows):');
console.log(`  from ${OWNER} | to ${REGISTRY} | value 0`);
console.log(`  data ${data}`);
console.log('');
console.log(`deadline ${deadline} = ${new Date(Number(deadline) * 1000).toISOString()}`);
console.log('SUBMIT WITHIN ~4 MINUTES or re-run this script for fresh values');
console.log('(deadline AND signature change together — never mix runs).');
console.log(`verify after: getAgentWallet(${AGENT_ID}) should return ${account.address}`);
