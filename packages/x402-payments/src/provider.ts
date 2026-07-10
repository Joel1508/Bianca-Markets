import type {
  GoldPriceData,
  MacroEvent,
  MarketDataProvider,
  NewsSentimentData,
} from '@bianca/signal-engine';
import type { X402Client } from './client.js';
import type { X402Receipt } from './types.js';

/**
 * MarketDataProvider backed by our paid data proxy — every method call is
 * one x402 micropayment (Track 2). Receipts accumulate in `payments`.
 */
export class X402MarketDataProvider implements MarketDataProvider {
  readonly name = 'x402-proxy';
  readonly payments: X402Receipt[] = [];

  constructor(
    private readonly baseUrl: string,
    private readonly client: X402Client,
  ) {}

  private async pull<T>(path: string): Promise<T> {
    const { data, receipt } = await this.client.paidFetch<T>(
      `${this.baseUrl}${path}`,
    );
    if (receipt) this.payments.push(receipt);
    return data;
  }

  getGoldPrice(): Promise<GoldPriceData> {
    return this.pull<GoldPriceData>('/gold');
  }

  getMacroCalendar(): Promise<MacroEvent[]> {
    return this.pull<MacroEvent[]>('/calendar');
  }

  getNewsSentiment(): Promise<NewsSentimentData> {
    return this.pull<NewsSentimentData>('/news');
  }
}
