import 'dotenv/config';
import type { Hex } from 'viem';

// NOTE: the plan originally targeted Alfajores (44787), but Alfajores was
// sunset after Celo's L2 migration — its Forno endpoint no longer resolves
// (verified 2026-07-08). Celo Sepolia (11142220) is the live testnet.
export type CeloNetwork = 'mainnet' | 'sepolia';

export interface AppConfig {
  network: CeloNetwork;
  /** When true (default), the agent never signs or sends transactions. */
  dryRun: boolean;
  /** True if PRIVATE_KEY is set in .env. The key itself is only read lazily by getWalletClient. */
  hasWallet: boolean;
}

export function loadConfig(): AppConfig {
  const network = process.env.CELO_NETWORK ?? 'sepolia';
  if (network === 'alfajores') {
    throw new Error(
      'Alfajores has been sunset (RPC no longer exists). Use CELO_NETWORK=sepolia (Celo Sepolia, chain id 11142220).',
    );
  }
  if (network !== 'mainnet' && network !== 'sepolia') {
    throw new Error(
      `CELO_NETWORK must be "mainnet" or "sepolia", got "${network}"`,
    );
  }
  return {
    network,
    dryRun: (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false',
    hasWallet: Boolean(process.env.PRIVATE_KEY),
  };
}

/**
 * Reads PRIVATE_KEY from .env. Never log or serialize the returned value.
 * Throws if unset or malformed rather than proceeding with a bad key.
 */
export function requirePrivateKey(): Hex {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    throw new Error(
      'PRIVATE_KEY is not set. Add it to .env (see .env.example) — it is only needed from Phase 3 onward.',
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error('PRIVATE_KEY must be a 0x-prefixed 64-hex-char string.');
  }
  return pk as Hex;
}
