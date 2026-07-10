import type { Address } from 'viem';
import type { CeloNetwork } from './env.js';

export interface TokenInfo {
  symbol: string;
  address: Address;
  decimals: number;
}

// IMPORTANT: verify every mainnet address on celoscan.io before any real swap
// (Phase 4 gate). Do not trust these constants blindly with real funds.
export const TOKENS: Record<CeloNetwork, Record<string, TokenInfo>> = {
  mainnet: {
    CELO: {
      symbol: 'CELO',
      address: '0x471EcE3750Da237f93B8E339c536989b8978a438',
      decimals: 18,
    },
    cUSD: {
      symbol: 'cUSD',
      address: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
      decimals: 18,
    },
    USDT: {
      symbol: 'USDT',
      address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
      decimals: 6,
    },
    // Listed by Celo's x402 facilitator (/api/config) and name() verified
    // on-chain 2026-07-08. EIP-712 domain: { name: "USDC", version: "2" }.
    USDC: {
      symbol: 'USDC',
      address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
      decimals: 6,
    },
  },
  sepolia: {
    // Same provenance as mainnet USDC above.
    USDC: {
      symbol: 'USDC',
      address: '0x01C5C0122039549AD1493B8220cABEdD739BC44E',
      decimals: 6,
    },
    // Mento's Sepolia cUSD equivalent; docs.mento.org + probed live in the
    // BiPoolManager's USDm/USDC exchange + Blockscout-verified 2026-07-09.
    USDm: {
      symbol: 'USDm',
      address: '0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b',
      decimals: 18,
    },
  },
};
