import type { CeloNetwork } from '@bianca/config';
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
  ) {}

  get canSettle(): boolean {
    return Boolean(this.apiKey);
  }

  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    return this.post<VerifyResponse>('/verify', {
      x402Version: 1,
      paymentPayload,
      paymentRequirements,
    });
  }

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
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
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
