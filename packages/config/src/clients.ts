import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  type PublicClient,
  type WalletClient,
  type Account,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAINS, getRpcUrls } from './chains.js';
import { requirePrivateKey, type CeloNetwork } from './env.js';

// Primary + backup RPCs behind viem's fallback(): a request that fails on
// the primary (after its own retries) is transparently retried on the backup.
function transportFor(network: CeloNetwork) {
  return fallback(
    getRpcUrls(network).map((url) => http(url, { retryCount: 3, timeout: 15_000 })),
  );
}

export function getPublicClient(network: CeloNetwork): PublicClient {
  return createPublicClient({
    chain: CHAINS[network],
    transport: transportFor(network),
  });
}

/**
 * Wallet client for signing/sending transactions. Requires PRIVATE_KEY in .env.
 * Not used before Phase 3, and every real transaction path must respect DRY_RUN
 * and explicit user approval.
 */
export function getWalletClient(
  network: CeloNetwork,
): WalletClient<ReturnType<typeof fallback>, Chain, Account> {
  const account = privateKeyToAccount(requirePrivateKey());
  return createWalletClient({
    account,
    chain: CHAINS[network],
    transport: transportFor(network),
  });
}
