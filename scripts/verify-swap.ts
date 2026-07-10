import { formatUnits, parseAbi, parseEventLogs } from 'viem';
import { fromDataSuffix } from '@celo/attribution-tags';
import { loadConfig, getPublicClient, TOKENS } from '@bianca/config';

/**
 * Post-trade verification for a swap tx: receipt status, ERC-8021
 * attribution tag decoded from calldata, and token Transfer legs.
 *
 * Usage: CELO_NETWORK=<net> tsx scripts/verify-swap.ts <txHash>
 */

const hash = process.argv[2] as `0x${string}`;
if (!hash?.startsWith('0x')) throw new Error('usage: tsx scripts/verify-swap.ts <txHash>');

const { network } = loadConfig();
const client = getPublicClient(network);
const [tx, receipt] = await Promise.all([
  client.getTransaction({ hash }),
  client.getTransactionReceipt({ hash }),
]);
console.log(`tx ${hash} on ${network}`);
console.log(`  status: ${receipt.status} | block ${receipt.blockNumber} | to ${tx.to}`);
console.log(`  attribution: ${JSON.stringify(fromDataSuffix(tx.input))}`);

const byAddress = new Map(
  Object.values(TOKENS[network]).map((t) => [t.address.toLowerCase(), t]),
);
const transfers = parseEventLogs({
  abi: parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']),
  logs: receipt.logs,
});
for (const t of transfers) {
  const token = byAddress.get(t.address.toLowerCase());
  const amount = token ? `${formatUnits(t.args.value, token.decimals)} ${token.symbol}` : `${t.args.value} (raw, ${t.address})`;
  console.log(`  transfer: ${amount}  ${t.args.from} -> ${t.args.to}`);
}
