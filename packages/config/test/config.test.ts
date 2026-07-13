import test from 'node:test';
import assert from 'node:assert/strict';
import { withRetries } from '../src/retry.js';
import { getRpcUrls } from '../src/chains.js';

const noSleep = () => Promise.resolve();

test('withRetries returns first success without retrying', async () => {
  let calls = 0;
  const result = await withRetries(
    async () => {
      calls++;
      return 42;
    },
    { sleep: noSleep },
  );
  assert.equal(result, 42);
  assert.equal(calls, 1);
});

test('withRetries recovers after transient failures', async () => {
  let calls = 0;
  const retriesSeen: number[] = [];
  const result = await withRetries(
    async () => {
      calls++;
      if (calls < 3) throw new Error('fetch failed');
      return 'ok';
    },
    { attempts: 5, sleep: noSleep, onRetry: (_e, attempt) => retriesSeen.push(attempt) },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(retriesSeen, [1, 2]);
});

test('withRetries throws the last error after exhausting attempts', async () => {
  let calls = 0;
  await assert.rejects(
    withRetries(
      async () => {
        calls++;
        throw new Error(`fail ${calls}`);
      },
      { attempts: 5, sleep: noSleep },
    ),
    /fail 5/,
  );
  assert.equal(calls, 5);
});

test('withRetries waits the configured delay between attempts', async () => {
  const delays: number[] = [];
  await assert.rejects(
    withRetries(
      async () => {
        throw new Error('down');
      },
      {
        attempts: 3,
        delayMs: 15_000,
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    ),
  );
  // no sleep after the final attempt
  assert.deepEqual(delays, [15_000, 15_000]);
});

test('getRpcUrls: mainnet is Forno primary + 1rpc backup by default', () => {
  delete process.env.CELO_MAINNET_RPC;
  delete process.env.CELO_MAINNET_RPC_BACKUP;
  assert.deepEqual(getRpcUrls('mainnet'), ['https://forno.celo.org', 'https://1rpc.io/celo']);
});

test('getRpcUrls: env overrides replace primary and backup', () => {
  process.env.CELO_MAINNET_RPC = 'https://primary.example';
  process.env.CELO_MAINNET_RPC_BACKUP = 'https://backup.example';
  try {
    assert.deepEqual(getRpcUrls('mainnet'), ['https://primary.example', 'https://backup.example']);
  } finally {
    delete process.env.CELO_MAINNET_RPC;
    delete process.env.CELO_MAINNET_RPC_BACKUP;
  }
});

test('getRpcUrls: duplicate backup is dropped; sepolia has no default backup', () => {
  process.env.CELO_MAINNET_RPC_BACKUP = 'https://forno.celo.org';
  try {
    assert.deepEqual(getRpcUrls('mainnet'), ['https://forno.celo.org']);
  } finally {
    delete process.env.CELO_MAINNET_RPC_BACKUP;
  }
  delete process.env.CELO_SEPOLIA_RPC;
  delete process.env.CELO_SEPOLIA_RPC_BACKUP;
  assert.deepEqual(getRpcUrls('sepolia'), ['https://forno.celo-sepolia.celo-testnet.org']);
});
