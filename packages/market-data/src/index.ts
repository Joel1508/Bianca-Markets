import 'dotenv/config';
import {
  MockMarketDataProvider,
  type GoldPriceData,
  type MacroEvent,
  type MarketDataProvider,
  type NewsSentimentData,
} from '@bianca/signal-engine';
import { fetchGoldPrice } from './twelvedata.js';
import { fetchMacroCalendar } from './calendar.js';
import { fetchNewsSentiment } from './newsapi.js';

export { fetchGoldPrice } from './twelvedata.js';
export {
  fetchMacroCalendar,
  fetchMacroCalendarTradingView,
  fetchMacroCalendarForexFactory,
} from './calendar.js';
export { fetchNewsSentiment } from './newsapi.js';
export { scoreHeadline } from './sentiment.js';

export interface UpstreamKeys {
  twelveData?: string;
  newsApi?: string;
}

export function loadUpstreamKeys(): UpstreamKeys {
  return {
    twelveData: process.env.TWELVEDATA_API_KEY || undefined,
    newsApi: process.env.NEWSAPI_API_KEY || undefined,
  };
}

/**
 * Calls the real upstreams; any source whose API key is missing falls back
 * to mock data for that source (the `source` field on each payload shows
 * which is which, and `missingKeys()` lists what isn't configured).
 */
export class DirectMarketDataProvider implements MarketDataProvider {
  readonly name = 'direct';
  private readonly mock = new MockMarketDataProvider();

  constructor(private readonly keys: UpstreamKeys = loadUpstreamKeys()) {}

  missingKeys(): string[] {
    const missing: string[] = [];
    if (!this.keys.twelveData) missing.push('TWELVEDATA_API_KEY');
    if (!this.keys.newsApi) missing.push('NEWSAPI_API_KEY');
    return missing;
  }

  getGoldPrice(): Promise<GoldPriceData> {
    return this.keys.twelveData
      ? fetchGoldPrice(this.keys.twelveData)
      : this.mock.getGoldPrice();
  }

  // Keyless (TradingView → Forex Factory) since Finnhub's calendar endpoint
  // turned out to be premium-only.
  getMacroCalendar(): Promise<MacroEvent[]> {
    return fetchMacroCalendar();
  }

  getNewsSentiment(): Promise<NewsSentimentData> {
    return this.keys.newsApi
      ? fetchNewsSentiment(this.keys.newsApi)
      : this.mock.getNewsSentiment();
  }
}
