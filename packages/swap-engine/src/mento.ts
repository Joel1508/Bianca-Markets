import {
  concat,
  encodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import type { CeloNetwork } from '@bianca/config';

/**
 * Mento v2 broker adapter. Chosen over Ubeswap for Phase 3 because Mento is
 * the only DEX actually deployed on Celo Sepolia (verified live 2026-07-09:
 * 16 exchanges on the BiPoolManager, including USDm <-> native Circle USDC),
 * it is stablecoin-native, and one Broker contract covers quote + swap.
 */

// Sepolia addresses probed live + Blockscout-verified 2026-07-09; mainnet
// addresses Celoscan-verified 2026-07-09 (Broker "Mento Labs: Broker",
// cross-checked on-chain against BiPoolManager and docs.mento.org).
export const MENTO: Record<CeloNetwork, { broker: Address; biPoolManager: Address }> = {
  mainnet: {
    broker: '0x777A8255cA72412f0d706dc03C9D1987306B4CaD',
    biPoolManager: '0x22d9db95E6Ae61c104A7B6F6C78D7993B94ec901',
  },
  sepolia: {
    broker: '0xB9Ae2065142EB79b6c5EB1E8778F883fad6B07Ba',
    biPoolManager: '0xeCB3C656C131fCd9bB8D1d80898716bD684feb78',
  },
};

export const BROKER_ABI = parseAbi([
  'function getAmountOut(address exchangeProvider, bytes32 exchangeId, address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256)',
  'function swapIn(address exchangeProvider, bytes32 exchangeId, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin) returns (uint256)',
]);

export const BIPOOL_ABI = parseAbi([
  'struct Exchange { bytes32 exchangeId; address[] assets; }',
  'function getExchanges() view returns (Exchange[])',
]);

export const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
]);

/** Find the BiPoolManager exchange that trades exactly this token pair. */
export async function findExchangeId(
  client: PublicClient,
  network: CeloNetwork,
  tokenA: Address,
  tokenB: Address,
): Promise<Hex> {
  const exchanges = await client.readContract({
    address: MENTO[network].biPoolManager,
    abi: BIPOOL_ABI,
    functionName: 'getExchanges',
  });
  const a = tokenA.toLowerCase();
  const b = tokenB.toLowerCase();
  const match = exchanges.find((ex) => {
    const assets = ex.assets.map((x) => x.toLowerCase());
    return assets.includes(a) && assets.includes(b);
  });
  if (!match) {
    throw new Error(
      `No Mento exchange for ${tokenA}/${tokenB} on ${network} (${exchanges.length} exchanges checked)`,
    );
  }
  return match.exchangeId;
}

export async function getQuote(
  client: PublicClient,
  network: CeloNetwork,
  exchangeId: Hex,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
): Promise<bigint> {
  return client.readContract({
    address: MENTO[network].broker,
    abi: BROKER_ABI,
    functionName: 'getAmountOut',
    args: [MENTO[network].biPoolManager, exchangeId, tokenIn, tokenOut, amountIn],
  });
}

/** Broker.swapIn calldata with the ERC-8021 attribution tag appended. */
export function buildSwapCalldata(
  network: CeloNetwork,
  exchangeId: Hex,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  minAmountOut: bigint,
  attributionSuffix: Hex,
): Hex {
  const data = encodeFunctionData({
    abi: BROKER_ABI,
    functionName: 'swapIn',
    args: [MENTO[network].biPoolManager, exchangeId, tokenIn, tokenOut, amountIn, minAmountOut],
  });
  // Solidity ABI decoding ignores trailing calldata, so the suffix rides
  // along untouched; indexers recover it with fromDataSuffix/verifyTx.
  return concat([data, attributionSuffix]);
}
