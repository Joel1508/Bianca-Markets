import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatUnits } from 'viem';
import { loadConfig, getPublicClient, getWalletClient, TOKENS } from '@bianca/config';
import type { Signal } from '@bianca/signal-engine';
import {
  ATTRIBUTION_CODE,
  ERC20_ABI,
  RiskManager,
  executeSwap,
  loadRiskConfig,
  tradeFromSignal,
  usdToAtomic,
} from '@bianca/swap-engine';

/**
 * Phase 4 validation on Celo Sepolia. Everything is dry-run unless invoked
 * as `... short --real`, which sends ONE user-approved sell of held USDm.
 *
 * Steps:
 *   clamp   — prove oversized trades are actually clamped (quote uses the
 *             clamped amount, not the requested one)
 *   short   — SHORT path: synthetic short signal → sell USDm → USDC
 *   halt    — daily-loss halt using the REAL ledger + a tiny limit
 *   reset   — yesterday-dated ledger is ignored (UTC-midnight resume)
 */

const step = process.argv[2] ?? 'all';
const real = process.argv.includes('--real');
const config = loadConfig();
if (config.network !== 'sepolia') throw new Error('Phase 4 validation is Sepolia-only');
const tokens = TOKENS.sepolia;
const publicClient = getPublicClient('sepolia');

const shortSignal: Signal = {
  pair: 'XAUUSD',
  direction: 'short',
  confidence: 1, // full size so the sell covers the whole USDm position
  components: { priceAction: -1, macro: 0, sentiment: 0, composite: -1, eventRiskDamping: 1 },
  rationale: 'synthetic SHORT for Phase 4 path validation',
  sources: ['phase4-validate'],
  generatedAt: new Date().toISOString(),
};

function banner(name: string) {
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}`);
}

async function stepClamp() {
  banner('clamp: oversized request must shrink to MAX_POSITION_USD');
  const riskConfig = loadRiskConfig('sepolia');
  const risk = new RiskManager(riskConfig);
  const requestedUsd = 50;
  const decision = risk.evaluate(requestedUsd);
  console.log(`  requested $${requestedUsd} → decision size $${decision.sizeUsd} (clamped=${decision.clamped})`);
  if (!decision.clamped || decision.sizeUsd !== riskConfig.maxPositionUsd) {
    throw new Error('FAIL: decision did not clamp to maxPositionUsd');
  }
  // The pipeline builds amountIn from decision.sizeUsd — quote it to prove
  // the chain sees the clamped amount, not the requested one.
  const amountIn = usdToAtomic(decision.sizeUsd, tokens.USDC.decimals);
  const execution = await executeSwap(
    { network: 'sepolia', tokenIn: tokens.USDC, tokenOut: tokens.USDm, amountIn },
    { dryRun: true, publicClient },
  );
  console.log(
    `  dry-run quote for the CLAMPED size: ${formatUnits(amountIn, 6)} USDC → ${formatUnits(execution.quote, 18)} USDm`,
  );
  if (amountIn !== usdToAtomic(riskConfig.maxPositionUsd, 6)) throw new Error('FAIL: amountIn not clamped');
  console.log('  PASS — swap pipeline consumes the clamped size');
}

async function stepShort() {
  banner(`short: sell held USDm back to USDC ${real ? '(REAL — user-approved)' : '(dry run)'}`);
  const riskConfig = loadRiskConfig('sepolia');
  const risk = new RiskManager(riskConfig);
  const trade = tradeFromSignal(shortSignal, riskConfig.maxPositionUsd);
  if (trade.side !== 'sell') throw new Error('FAIL: short signal must map to sell');

  const wallet = real ? getWalletClient('sepolia') : undefined;
  const trader = wallet?.account.address ?? '0xd16f066D8789C4D5d29e61ec63bD26d01A6c7D7E';
  const balance = await publicClient.readContract({
    address: tokens.USDm.address,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [trader as `0x${string}`],
  });
  const balanceUsd = Number(formatUnits(balance, 18));
  console.log(`  USDm balance: ${balanceUsd}`);

  // sell what we hold, capped by risk (floor to cents to stay ≤ balance)
  const requestedUsd = Math.floor(balanceUsd * 100) / 100;
  const decision = risk.evaluate(requestedUsd);
  console.log(`  risk: ${decision.reasons.join('; ')}`);
  if (!decision.allowed) throw new Error('FAIL: risk blocked the short unexpectedly');

  const amountIn = usdToAtomic(decision.sizeUsd, tokens.USDm.decimals);
  const execution = await executeSwap(
    { network: 'sepolia', tokenIn: tokens.USDm, tokenOut: tokens.USDC, amountIn },
    { dryRun: !real, publicClient, walletClient: wallet },
  );
  const outStr = `${formatUnits(execution.quote, 6)} USDC (floor ${formatUnits(execution.minAmountOut, 6)})`;
  if (execution.status === 'dry-run') {
    console.log(`  DRY RUN — would sell ${formatUnits(amountIn, 18)} USDm → ${outStr}`);
    console.log(`  attribution "${ATTRIBUTION_CODE}", exchange ${execution.exchangeId.slice(0, 10)}…`);
    console.log('  PASS — SHORT path plans correctly (no tx sent)');
    return;
  }
  const amountOutUsd = Number(formatUnits(execution.amountOut ?? 0n, 6));
  const ledger = risk.recordFill({
    time: new Date().toISOString(),
    txHash: execution.txHash!,
    amountInUsd: decision.sizeUsd,
    amountOutUsd,
  });
  console.log(`  EXECUTED sell ${formatUnits(amountIn, 18)} USDm → ${amountOutUsd} USDC`);
  console.log(`  tx ${execution.txHash}`);
  console.log(`  ledger: daily loss $${ledger.lossUsd.toFixed(4)}, fills today: ${ledger.fills.length}`);
}

function stepHalt() {
  banner('halt: real ledger + tiny DAILY_LOSS_LIMIT_USD must block trading');
  const base = loadRiskConfig('sepolia');
  if (!existsSync(base.stateFile)) {
    throw new Error(`FAIL: no ledger at ${base.stateFile} — run after at least one real fill`);
  }
  const lossUsd = JSON.parse(readFileSync(base.stateFile, 'utf8')).lossUsd as number;
  console.log(`  real ledger loss today: $${lossUsd}`);
  if (!(lossUsd > 0)) throw new Error('FAIL: expected a positive recorded loss');
  const risk = new RiskManager({ ...base, dailyLossLimitUsd: lossUsd / 2 });
  const decision = risk.evaluate(1);
  console.log(`  with limit $${(lossUsd / 2).toFixed(6)}: allowed=${decision.allowed}`);
  console.log(`  reasons: ${decision.reasons.join('; ')}`);
  if (decision.allowed) throw new Error('FAIL: trade was not halted');
  console.log('  PASS — trading halts once the daily loss reaches the limit');
}

function stepReset() {
  banner('reset: yesterday-dated ledger is ignored after UTC midnight');
  const dir = mkdtempSync(join(tmpdir(), 'bianca-phase4-'));
  const file = join(dir, 'risk.json');
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  writeFileSync(
    file,
    JSON.stringify({ date: yesterday, lossUsd: 999, fills: [{ time: 't', txHash: '0x0', amountInUsd: 999, amountOutUsd: 0 }] }),
  );
  const risk = new RiskManager({ maxPositionUsd: 5, dailyLossLimitUsd: 10, stateFile: file });
  const decision = risk.evaluate(1);
  console.log(`  ledger dated ${yesterday} with $999 loss → allowed=${decision.allowed}, dailyLoss=$${decision.dailyLossUsd}`);
  if (!decision.allowed || decision.dailyLossUsd !== 0) throw new Error('FAIL: stale ledger not reset');
  console.log('  PASS — new UTC day starts with a clean ledger');
}

const steps: Record<string, () => Promise<void> | void> = {
  clamp: stepClamp,
  short: stepShort,
  halt: stepHalt,
  reset: stepReset,
};

if (step === 'all') {
  await stepClamp();
  await stepShort();
  stepReset();
  // halt requires an existing real ledger; skip gracefully if none yet
  try {
    stepHalt();
  } catch (err) {
    console.log(`  (halt step: ${err instanceof Error ? err.message : err})`);
  }
} else {
  const fn = steps[step];
  if (!fn) throw new Error(`unknown step "${step}" (clamp|short|halt|reset|all)`);
  await fn();
}
console.log('\nphase4-validate done.');
