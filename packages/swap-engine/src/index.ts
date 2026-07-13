import { toDataSuffix, fromDataSuffix } from '@celo/attribution-tags';
import {
  formatUnits,
  parseEventLogs,
  parseAbi,
  parseUnits,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import type { CeloNetwork } from '@bianca/config';
import type { Signal } from '@bianca/signal-engine';
import { MENTO, ERC20_ABI, findExchangeId, getQuote, buildSwapCalldata } from './mento.js';

export { MENTO, ERC20_ABI, findExchangeId, getQuote, buildSwapCalldata } from './mento.js';
export { RiskManager, loadRiskConfig, type RiskConfig, type RiskDecision } from './risk.js';
export { fromDataSuffix };

/**
 * Stablecoin swap execution on Celo (Track 1: attributed on-chain volume).
 * Routing via the Mento v2 Broker; every swap carries an ERC-8021
 * attribution tag (@celo/attribution-tags) so it counts on the Track 1
 * leaderboard.
 */

/**
 * ERC-8021 codes for this project (regex per code: /^[a-z0-9_]{1,32}$/).
 * ATTRIBUTION_CODE env accepts a comma-separated list: leaderboards only
 * credit the Celo Builders-assigned tag, so our own code rides alongside it
 * in the same suffix (ERC-8021 carries multiple codes).
 */
export const ATTRIBUTION_CODES: readonly string[] = (
  process.env.ATTRIBUTION_CODE ?? 'bianca_markets'
)
  .split(',')
  .map((code) => code.trim())
  .filter(Boolean);

/** display form for logs */
export const ATTRIBUTION_CODE = ATTRIBUTION_CODES.join(',');

export interface TokenRef {
  symbol: string;
  address: Address;
  decimals: number;
}

export interface SwapIntent {
  network: CeloNetwork;
  tokenIn: TokenRef;
  tokenOut: TokenRef;
  /** in tokenIn's smallest unit */
  amountIn: bigint;
}

export interface SwapExecution {
  status: 'dry-run' | 'executed';
  exchangeId: Hex;
  quote: bigint;
  /** slippage floor actually enforced on-chain */
  minAmountOut: bigint;
  attributionTag: Hex;
  /** only when status === 'executed' */
  txHash?: Hex;
  amountOut?: bigint;
}

export interface SwapOptions {
  /** must be explicitly false to send a real transaction */
  dryRun: boolean;
  publicClient: PublicClient;
  /** required only when dryRun === false */
  walletClient?: WalletClient<any, Chain, Account>;
  /** default 50 (0.5%) */
  slippageBps?: number;
  attributionCodes?: readonly string[];
}

/**
 * Map a signal to a trade. XAUUSD direction is expressed on the USDC/USDm
 * stablecoin pair (documented simplification: the deliverable is
 * signal-gated, risk-controlled, attributed volume — not synthetic gold
 * exposure): LONG buys USDm with USDC, SHORT sells USDm back, size scales
 * with confidence up to the per-trade cap.
 */
export function tradeFromSignal(
  signal: Signal,
  maxPositionUsd: number,
): { side: 'buy' | 'sell' | 'none'; sizeUsd: number } {
  if (signal.direction === 'flat') return { side: 'none', sizeUsd: 0 };
  const sizeUsd = Math.round(signal.confidence * maxPositionUsd * 100) / 100;
  return { side: signal.direction === 'long' ? 'buy' : 'sell', sizeUsd };
}

export function usdToAtomic(usd: number, decimals: number): bigint {
  return parseUnits(usd.toFixed(decimals > 6 ? 6 : decimals), decimals);
}

const TRANSFER_ABI = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

export async function executeSwap(intent: SwapIntent, opts: SwapOptions): Promise<SwapExecution> {
  const { network, tokenIn, tokenOut, amountIn } = intent;
  const { dryRun, publicClient } = opts;
  const slippageBps = opts.slippageBps ?? Number(process.env.SWAP_SLIPPAGE_BPS ?? 50);
  const attributionTag = toDataSuffix(opts.attributionCodes ?? ATTRIBUTION_CODES);

  const exchangeId = await findExchangeId(publicClient, network, tokenIn.address, tokenOut.address);
  const quote = await getQuote(
    publicClient,
    network,
    exchangeId,
    tokenIn.address,
    tokenOut.address,
    amountIn,
  );
  const minAmountOut = (quote * BigInt(10_000 - slippageBps)) / 10_000n;

  if (dryRun) {
    return { status: 'dry-run', exchangeId, quote, minAmountOut, attributionTag };
  }

  const walletClient = opts.walletClient;
  if (!walletClient) throw new Error('walletClient is required when dryRun is false');
  const trader = walletClient.account.address;
  const broker = MENTO[network].broker;

  const balance = await publicClient.readContract({
    address: tokenIn.address,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [trader],
  });
  if (balance < amountIn) {
    throw new Error(
      `Insufficient ${tokenIn.symbol}: have ${formatUnits(balance, tokenIn.decimals)}, need ${formatUnits(amountIn, tokenIn.decimals)}`,
    );
  }

  const allowance = await publicClient.readContract({
    address: tokenIn.address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [trader, broker],
  });
  if (allowance < amountIn) {
    const approveHash = await walletClient.writeContract({
      address: tokenIn.address,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [broker, amountIn],
    });
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
    if (approveReceipt.status !== 'success') {
      throw new Error(`approve reverted: ${approveHash}`);
    }
  }

  const txHash = await walletClient.sendTransaction({
    to: broker,
    data: buildSwapCalldata(
      network,
      exchangeId,
      tokenIn.address,
      tokenOut.address,
      amountIn,
      minAmountOut,
      attributionTag,
    ),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new Error(`swap reverted: ${txHash}`);
  }

  // amountOut = the tokenOut Transfer that landed on the trader
  const transfers = parseEventLogs({ abi: TRANSFER_ABI, logs: receipt.logs });
  const received = transfers.find(
    (t) =>
      t.address.toLowerCase() === tokenOut.address.toLowerCase() &&
      t.args.to.toLowerCase() === trader.toLowerCase(),
  );
  return {
    status: 'executed',
    exchangeId,
    quote,
    minAmountOut,
    attributionTag,
    txHash,
    amountOut: received?.args.value,
  };
}
