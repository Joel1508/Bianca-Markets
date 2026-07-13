/**
 * Retry an async operation with fixed backoff. Built for the agent's
 * startup RPC probe: launchd fires coalesced cycles seconds after the Mac
 * wakes, before the network is back — one failed fetch must not kill the
 * whole cycle (each lost cycle = 3 uncounted x402 payments).
 */
export interface RetryOptions {
  /** total attempts including the first (default 5) */
  attempts?: number;
  /** wait between attempts in ms (default 15_000) */
  delayMs?: number;
  /** called after each failed attempt that will be retried */
  onRetry?: (error: unknown, attempt: number, attempts: number) => void;
  /** injectable for tests */
  sleep?: (ms: number) => Promise<void>;
}

export async function withRetries<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const delayMs = opts.delayMs ?? 15_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        opts.onRetry?.(error, attempt, attempts);
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}
