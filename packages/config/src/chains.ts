import { celo, celoSepolia } from 'viem/chains';
import type { Chain } from 'viem';
import type { CeloNetwork } from './env.js';

// Celo Mainnet: chain id 42220 | Celo Sepolia testnet: chain id 11142220
export const CHAINS: Record<CeloNetwork, Chain> = {
  mainnet: celo,
  sepolia: celoSepolia,
};

const DEFAULT_RPC: Record<CeloNetwork, string> = {
  mainnet: 'https://forno.celo.org',
  sepolia: 'https://forno.celo-sepolia.celo-testnet.org',
};

export function getRpcUrl(network: CeloNetwork): string {
  const override =
    network === 'mainnet'
      ? process.env.CELO_MAINNET_RPC
      : process.env.CELO_SEPOLIA_RPC;
  return override ?? DEFAULT_RPC[network];
}
