/**
 * End-to-end x402 plumbing test with NO real funds: a throwaway key signs a
 * payment for the local proxy, which forwards it to the live facilitator for
 * verification. Expected outcome: rejection for insufficient funds/balance —
 * that proves the whole pipe (402 → sign → X-PAYMENT → /verify) is wired
 * correctly. A schema-level error (unsupported_scheme, malformed) would mean
 * the protocol implementation is wrong.
 *
 * Usage: proxy must be running with X402_PAY_TO set, then:
 *   npx tsx scripts/x402-smoke.ts [proxy-url]
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { X402Client } from '@bianca/x402-payments';

const proxyUrl = process.argv[2] ?? 'http://localhost:4021';
const account = privateKeyToAccount(generatePrivateKey());
console.log(`throwaway buyer: ${account.address} (zero funds, discarded after run)`);

const client = new X402Client(account, 'sepolia');
try {
  const { data, receipt } = await client.paidFetch(`${proxyUrl}/gold`);
  console.log('UNEXPECTED: payment accepted', { receipt, data });
  process.exit(1);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`rejection: ${msg}`);
  if (/insufficient|balance|funds/i.test(msg)) {
    console.log('PASS — protocol accepted, rejected only for missing funds.');
  } else {
    console.log('CHECK — rejected for a non-funds reason; inspect the message above.');
    process.exit(1);
  }
}
