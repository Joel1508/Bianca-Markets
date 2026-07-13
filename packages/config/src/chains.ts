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

// Keyless fallbacks tried when the primary fails (probed 2026-07-11:
// 1rpc.io serves chain id 42220 in ~0.5s). No known keyless Sepolia backup.
const DEFAULT_BACKUP_RPC: Record<CeloNetwork, string | undefined> = {
  mainnet: 'https://1rpc.io/celo',
  sepolia: undefined,
};

export function getRpcUrl(network: CeloNetwork): string {
  const override =
    network === 'mainnet'
      ? process.env.CELO_MAINNET_RPC
      : process.env.CELO_SEPOLIA_RPC;
  return override ?? DEFAULT_RPC[network];
}

/** Primary RPC first, then any backup — feed to viem's fallback() transport. */
export function getRpcUrls(network: CeloNetwork): string[] {
  const backupOverride =
    network === 'mainnet'
      ? process.env.CELO_MAINNET_RPC_BACKUP
      : process.env.CELO_SEPOLIA_RPC_BACKUP;
  const backup = backupOverride ?? DEFAULT_BACKUP_RPC[network];
  const urls = [getRpcUrl(network)];
  if (backup && backup !== urls[0]) urls.push(backup);
  return urls;
}
