import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Account,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAINS, getRpcUrl } from './chains.js';
import { requirePrivateKey, type CeloNetwork } from './env.js';

export function getPublicClient(network: CeloNetwork): PublicClient {
  return createPublicClient({
    chain: CHAINS[network],
    transport: http(getRpcUrl(network)),
  });
}

/**
 * Wallet client for signing/sending transactions. Requires PRIVATE_KEY in .env.
 * Not used before Phase 3, and every real transaction path must respect DRY_RUN
 * and explicit user approval.
 */
export function getWalletClient(
  network: CeloNetwork,
): WalletClient<ReturnType<typeof http>, Chain, Account> {
  const account = privateKeyToAccount(requirePrivateKey());
  return createWalletClient({
    account,
    chain: CHAINS[network],
    transport: http(getRpcUrl(network)),
  });
}
