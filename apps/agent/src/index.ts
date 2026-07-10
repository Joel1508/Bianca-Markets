import { formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  loadConfig,
  getPublicClient,
  getWalletClient,
  requirePrivateKey,
  CHAINS,
  TOKENS,
  type AppConfig,
} from '@bianca/config';
import {
  ATTRIBUTION_CODE,
  RiskManager,
  executeSwap,
  loadRiskConfig,
  tradeFromSignal,
  usdToAtomic,
} from '@bianca/swap-engine';
import {
  generateSignal,
  MockMarketDataProvider,
  type MarketDataProvider,
} from '@bianca/signal-engine';
import { DirectMarketDataProvider } from '@bianca/market-data';
import { X402Client, X402MarketDataProvider } from '@bianca/x402-payments';

/**
 * Provider selection:
 *  1. DATA_PROXY_URL + PRIVATE_KEY → x402-paid proxy (real micropayments)
 *  2. upstream API keys           → direct upstream calls (free, no x402)
 *  3. nothing configured          → mock data
 * Missing pieces degrade gracefully so the agent always runs.
 */
function chooseProvider(config: AppConfig): { provider: MarketDataProvider; note: string } {
  const proxyUrl = process.env.DATA_PROXY_URL;
  if (proxyUrl && config.hasWallet) {
    const client = new X402Client(privateKeyToAccount(requirePrivateKey()), config.network);
    return {
      provider: new X402MarketDataProvider(proxyUrl, client),
      note: `x402-paid proxy at ${proxyUrl} (buyer ${client.address})`,
    };
  }
  if (proxyUrl && !config.hasWallet) {
    console.log('  note:     DATA_PROXY_URL set but PRIVATE_KEY missing — using direct upstreams instead');
  }
  const direct = new DirectMarketDataProvider();
  const missing = direct.missingKeys();
  if (missing.length === 3) {
    return { provider: new MockMarketDataProvider(), note: 'mock data (no API keys configured)' };
  }
  return {
    provider: direct,
    note: `direct upstreams, unpaid${missing.length > 0 ? ` (mock for: ${missing.join(', ')})` : ''}`,
  };
}

async function main() {
  const config = loadConfig();
  const chain = CHAINS[config.network];

  console.log('Bianca Markets — autonomous FX/macro trading agent on Celo');
  console.log(`  network:  ${config.network} (chain id ${chain.id})`);
  console.log(`  dry run:  ${config.dryRun}`);
  console.log(`  wallet:   ${config.hasWallet ? 'configured' : 'not configured'}`);

  const client = getPublicClient(config.network);
  const block = await client.getBlockNumber();
  console.log(`  rpc ok:   latest ${chain.name} block ${block}`);

  const { provider, note } = chooseProvider(config);
  console.log(`  data:     ${note}`);

  const signal = await generateSignal(provider);
  console.log(
    `  signal:   ${signal.pair} ${signal.direction.toUpperCase()} (confidence ${signal.confidence})`,
  );
  console.log(`            ${signal.rationale}`);
  console.log(`            sources: ${signal.sources.join(', ')}`);

  if (provider instanceof X402MarketDataProvider) {
    const settled = provider.payments.filter((p) => p.txHash);
    console.log(
      `  x402:     ${provider.payments.length} payment(s) made, ${settled.length} settled on-chain`,
    );
    for (const p of settled) {
      console.log(`            ${p.url} → tx ${p.txHash}`);
    }
  }

  await runSwapPhase(config, signal);
}

/**
 * Phase 3: signal → risk-checked, ERC-8021-attributed Mento swap.
 * DRY_RUN=true (the default) quotes on-chain and logs exactly what would
 * have happened, but never signs or sends. Real swaps additionally require
 * explicit per-transaction user approval (see PROGRESS.md standing rules).
 */
async function runSwapPhase(
  config: AppConfig,
  signal: Awaited<ReturnType<typeof generateSignal>>,
) {
  const riskConfig = loadRiskConfig(config.network);
  const risk = new RiskManager(riskConfig);
  const trade = tradeFromSignal(signal, riskConfig.maxPositionUsd);

  if (trade.side === 'none') {
    console.log('  swap:     flat signal — no trade');
    return;
  }

  const decision = risk.evaluate(trade.sizeUsd);
  console.log(`  risk:     ${decision.reasons.join('; ')}`);
  if (!decision.allowed) {
    console.log('  swap:     BLOCKED by risk controls — no trade (dry run or not)');
    return;
  }

  const tokens = TOKENS[config.network];
  const base = tokens.USDC;
  const position = config.network === 'sepolia' ? tokens.USDm : tokens.cUSD;
  const [tokenIn, tokenOut] = trade.side === 'buy' ? [base, position] : [position, base];
  const amountIn = usdToAtomic(decision.sizeUsd, tokenIn.decimals);

  const publicClient = getPublicClient(config.network);
  const execution = await executeSwap(
    { network: config.network, tokenIn, tokenOut, amountIn },
    {
      dryRun: config.dryRun,
      publicClient,
      walletClient: config.dryRun ? undefined : getWalletClient(config.network),
    },
  );

  const inStr = `${formatUnits(amountIn, tokenIn.decimals)} ${tokenIn.symbol}`;
  const quoteStr = `${formatUnits(execution.quote, tokenOut.decimals)} ${tokenOut.symbol}`;
  const minStr = `${formatUnits(execution.minAmountOut, tokenOut.decimals)} ${tokenOut.symbol}`;

  if (execution.status === 'dry-run') {
    console.log(
      `  swap:     DRY RUN — would ${trade.side} $${decision.sizeUsd}: ${inStr} → ${quoteStr} (floor ${minStr})`,
    );
    console.log(
      `            via Mento exchange ${execution.exchangeId.slice(0, 10)}…, attribution "${ATTRIBUTION_CODE}"`,
    );
    console.log('            set DRY_RUN=false ONLY with explicit approval to send for real.');
    return;
  }

  const amountOutUsd = execution.amountOut
    ? Number(formatUnits(execution.amountOut, tokenOut.decimals))
    : 0;
  const ledger = risk.recordFill({
    time: new Date().toISOString(),
    txHash: execution.txHash!,
    amountInUsd: decision.sizeUsd,
    amountOutUsd,
  });
  console.log(
    `  swap:     EXECUTED ${trade.side} ${inStr} → ${formatUnits(execution.amountOut ?? 0n, tokenOut.decimals)} ${tokenOut.symbol}`,
  );
  console.log(`            tx ${execution.txHash} (attribution "${ATTRIBUTION_CODE}")`);
  console.log(
    `            daily loss now $${ledger.lossUsd.toFixed(4)} of $${riskConfig.dailyLossLimitUsd} limit`,
  );
}

main().catch((err) => {
  console.error('agent failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
