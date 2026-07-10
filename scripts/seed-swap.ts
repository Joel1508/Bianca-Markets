import { formatUnits } from 'viem';
import { loadConfig, getPublicClient, getWalletClient, TOKENS } from '@bianca/config';
import {
  ATTRIBUTION_CODE,
  RiskManager,
  executeSwap,
  loadRiskConfig,
  usdToAtomic,
} from '@bianca/swap-engine';

/**
 * Manual inventory seed: buy USDm (cUSD) with USDC so the SHORT path has
 * something to sell. This is NOT a signal-driven trade — the fill is tagged
 * `note: "manual seed"` in the risk ledger so it is never confused with
 * organic signal-driven volume.
 *
 * Usage: CELO_NETWORK=<net> tsx scripts/seed-swap.ts <usd> [--real]
 * Dry-run by default; --real sends ONE user-approved swap.
 */

const usd = Number(process.argv[2]);
const real = process.argv.includes('--real');
if (!Number.isFinite(usd) || usd <= 0) {
  throw new Error('usage: tsx scripts/seed-swap.ts <usd> [--real]');
}

const config = loadConfig();
const network = config.network;
const tokens = TOKENS[network];
const tokenIn = tokens.USDC;
const tokenOut = tokens.cUSD ?? tokens.USDm; // mainnet keys it cUSD, Sepolia USDm — same Mento stable
const publicClient = getPublicClient(network);

console.log(`seed-swap on ${network}: buy ${tokenOut.symbol} with $${usd} USDC ${real ? '(REAL — user-approved)' : '(dry run)'}`);
console.log('  purpose: manual inventory seed, NOT signal-driven');

const riskConfig = loadRiskConfig(network);
const risk = new RiskManager(riskConfig);
const decision = risk.evaluate(usd);
console.log(`  risk: ${decision.reasons.join('; ')}`);
if (!decision.allowed) throw new Error('risk controls block this seed');

const amountIn = usdToAtomic(decision.sizeUsd, tokenIn.decimals);
const wallet = real ? getWalletClient(network) : undefined;
const execution = await executeSwap(
  { network, tokenIn, tokenOut, amountIn },
  { dryRun: !real, publicClient, walletClient: wallet },
);

const outStr = `${formatUnits(execution.quote, tokenOut.decimals)} ${tokenOut.symbol} (floor ${formatUnits(execution.minAmountOut, tokenOut.decimals)})`;
if (execution.status === 'dry-run') {
  console.log(`  DRY RUN — would buy: ${formatUnits(amountIn, tokenIn.decimals)} USDC → ${outStr}`);
  console.log(`  attribution "${ATTRIBUTION_CODE}", exchange ${execution.exchangeId.slice(0, 10)}…`);
  console.log('  no tx sent. Re-run with --real after explicit approval.');
} else {
  const amountOutUsd = Number(formatUnits(execution.amountOut ?? 0n, tokenOut.decimals));
  const ledger = risk.recordFill({
    time: new Date().toISOString(),
    txHash: execution.txHash!,
    amountInUsd: decision.sizeUsd,
    amountOutUsd,
    note: 'manual seed (inventory for SHORT path), not signal-driven',
  });
  console.log(`  EXECUTED buy ${formatUnits(amountIn, tokenIn.decimals)} USDC → ${amountOutUsd} ${tokenOut.symbol}`);
  console.log(`  tx ${execution.txHash}`);
  console.log(`  ledger: daily loss $${ledger.lossUsd.toFixed(4)}, fills today: ${ledger.fills.length}`);
}
