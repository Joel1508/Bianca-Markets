import { withRetries, type CeloNetwork, type RetryOptions } from '@bianca/config';
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
  X402Network,
} from './types.js';

/** Celo's hosted x402 facilitator (verified live 2026-07-08). */
export const FACILITATOR_URLS: Record<CeloNetwork, string> = {
  mainnet: 'https://api.x402.celo.org',
  sepolia: 'https://api.x402.sepolia.celo.org',
};

export const X402_NETWORK_NAMES: Record<CeloNetwork, X402Network> = {
  mainnet: 'celo',
  sepolia: 'celo-sepolia',
};

export class FacilitatorClient {
  constructor(
    private readonly baseUrl: string,
    /** required for /settle; /verify is open */
    private readonly apiKey?: string,
    /** retry knobs for /verify (tests inject a no-op sleep) */
    private readonly verifyRetry: RetryOptions = {},
  ) {}

  get canSettle(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * /verify is read-only, so it retries on transient failures (the hosted
   * facilitator intermittently hangs/drops connections under concurrent
   * load — observed 2026-07-11).
   */
  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    return withRetries(
      () =>
        this.post<VerifyResponse>('/verify', {
          x402Version: 1,
          paymentPayload,
          paymentRequirements,
        }),
      { attempts: 3, delayMs: 2_000, ...this.verifyRetry },
    );
  }

  /**
   * /settle moves money and is NEVER retried: after an ambiguous failure
   * (timeout, dropped connection) the settlement may have landed, and a
   * blind retry risks paying twice. Losing the cycle is the cheaper error.
   */
  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    if (!this.apiKey) {
      throw new Error(
        'Facilitator API key required to settle (X402_FACILITATOR_API_KEY)',
      );
    }
    return this.post<SettleResponse>(
      '/settle',
      { x402Version: 1, paymentPayload, paymentRequirements },
      { 'X-API-Key': this.apiKey },
    );
  }

  private async post<T>(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    // Bound hung connections (observed 12s+ hangs) so verify can retry and
    // settle fails fast instead of stalling the request forever.
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(
        `Facilitator ${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`,
      );
    }
  }
}
