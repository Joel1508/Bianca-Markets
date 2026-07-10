import type {
  Candle,
  GoldPriceData,
  MacroEvent,
  MarketDataProvider,
  NewsSentimentData,
} from './types.js';

/** mulberry32 — tiny seedable PRNG so mock data is reproducible per seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BULLISH_HEADLINES = [
  'Central banks extend gold buying streak as reserves diversify',
  'Geopolitical tensions flare, safe-haven demand lifts bullion',
  'Real yields slip as rate-cut bets firm; gold bid',
];

const BEARISH_HEADLINES = [
  'Dollar rallies to multi-week high, pressuring commodities',
  'Hot inflation print revives higher-for-longer rate fears',
  'ETF outflows accelerate as risk appetite returns',
];

/**
 * Offline stand-in for the Phase 2 paid data proxy. Same seed → same data
 * (apart from wall-clock timestamps), so signals are reproducible in tests.
 */
export class MockMarketDataProvider implements MarketDataProvider {
  readonly name = 'mock';
  private readonly rng: () => number;

  constructor(seed: number = Date.now() % 2 ** 31) {
    this.rng = mulberry32(seed);
  }

  async getGoldPrice(): Promise<GoldPriceData> {
    const hours = 48;
    const now = Date.now();
    // per-hour drift up to ±0.12%, noise up to ±0.15%
    const drift = (this.rng() - 0.5) * 0.0024;
    let price = 3300 + (this.rng() - 0.5) * 200;
    const history: Candle[] = [];
    for (let i = hours - 1; i >= 0; i--) {
      const open = price;
      const close = open * (1 + drift + (this.rng() - 0.5) * 0.003);
      const high = Math.max(open, close) * (1 + this.rng() * 0.001);
      const low = Math.min(open, close) * (1 - this.rng() * 0.001);
      history.push({
        time: new Date(now - i * 3_600_000).toISOString(),
        open: round2(open),
        high: round2(high),
        low: round2(low),
        close: round2(close),
      });
      price = close;
    }
    return {
      spot: history[history.length - 1].close,
      currency: 'USD',
      unit: 'oz',
      timestamp: new Date(now).toISOString(),
      history,
      source: 'mock:gold',
    };
  }

  async getMacroCalendar(): Promise<MacroEvent[]> {
    const now = Date.now();
    const cpiForecast = 2.7;
    // released 6h ago, surprise up to ±0.4pp
    const cpiActual = round2(cpiForecast + (this.rng() - 0.5) * 0.8);
    // upcoming high-impact event 0–24h out (sometimes inside the risk window)
    const fomcInHours = this.rng() * 24;
    return [
      {
        id: 'us-cpi-yoy',
        title: 'US CPI YoY',
        currency: 'USD',
        time: new Date(now - 6 * 3_600_000).toISOString(),
        importance: 'high',
        actual: cpiActual,
        forecast: cpiForecast,
        previous: 2.8,
        unit: '%',
      },
      {
        id: 'ecb-rate',
        title: 'ECB Main Refinancing Rate',
        currency: 'EUR',
        time: new Date(now - 20 * 3_600_000).toISOString(),
        importance: 'high',
        actual: 2.15,
        forecast: 2.15,
        previous: 2.4,
        unit: '%',
      },
      {
        id: 'fomc-rate',
        title: 'FOMC Rate Decision',
        currency: 'USD',
        time: new Date(now + fomcInHours * 3_600_000).toISOString(),
        importance: 'high',
        forecast: 3.75,
        previous: 4.0,
        unit: '%',
      },
      {
        id: 'us-jobless-claims',
        title: 'US Initial Jobless Claims',
        currency: 'USD',
        time: new Date(now + 30 * 3_600_000).toISOString(),
        importance: 'medium',
        forecast: 224,
        previous: 231,
        unit: 'k',
      },
    ];
  }

  async getNewsSentiment(): Promise<NewsSentimentData> {
    const score = round2((this.rng() - 0.5) * 1.6);
    const pool = score >= 0 ? BULLISH_HEADLINES : BEARISH_HEADLINES;
    return {
      score,
      headlines: pool.map((title) => ({
        title,
        sentiment: round2(score + (this.rng() - 0.5) * 0.3),
      })),
      timestamp: new Date().toISOString(),
      source: 'mock:news',
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
