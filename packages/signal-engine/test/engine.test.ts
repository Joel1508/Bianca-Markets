import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, rsi } from '../src/indicators.js';
import { generateSignal } from '../src/engine.js';
import { MockMarketDataProvider } from '../src/mock-provider.js';
import type {
  Candle,
  GoldPriceData,
  MacroEvent,
  MarketDataProvider,
  NewsSentimentData,
} from '../src/types.js';

test('sma averages the trailing window', () => {
  assert.equal(sma([1, 2, 3, 4, 5], 5), 3);
  assert.equal(sma([1, 2, 3, 4, 5], 2), 4.5);
  assert.equal(sma([1, 2], 5), undefined);
});

test('rsi is high for a monotonic uptrend and low for a downtrend', () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  const down = Array.from({ length: 30 }, (_, i) => 100 - i);
  assert.ok(rsi(up)! > 70);
  assert.ok(rsi(down)! < 30);
  assert.equal(rsi([1, 2, 3]), undefined);
});

/** Stub provider with fully controlled data — no randomness. */
function stubProvider(opts: {
  hourlyDriftPct: number;
  sentiment: number;
  events?: MacroEvent[];
}): MarketDataProvider {
  return {
    name: 'stub',
    async getGoldPrice(): Promise<GoldPriceData> {
      const now = Date.now();
      const history: Candle[] = [];
      let price = 3300;
      for (let i = 47; i >= 0; i--) {
        const open = price;
        const close = open * (1 + opts.hourlyDriftPct / 100);
        history.push({
          time: new Date(now - i * 3_600_000).toISOString(),
          open,
          high: Math.max(open, close),
          low: Math.min(open, close),
          close,
        });
        price = close;
      }
      return {
        spot: price,
        currency: 'USD',
        unit: 'oz',
        timestamp: new Date(now).toISOString(),
        history,
        source: 'stub:gold',
      };
    },
    async getMacroCalendar() {
      return opts.events ?? [];
    },
    async getNewsSentiment(): Promise<NewsSentimentData> {
      return {
        score: opts.sentiment,
        headlines: [],
        timestamp: new Date().toISOString(),
        source: 'stub:news',
      };
    },
  };
}

test('strong uptrend + bullish sentiment → long', async () => {
  const signal = await generateSignal(
    stubProvider({ hourlyDriftPct: 0.3, sentiment: 0.8 }),
  );
  assert.equal(signal.direction, 'long');
  assert.ok(signal.confidence >= 0.25);
});

test('strong downtrend + bearish sentiment → short', async () => {
  const signal = await generateSignal(
    stubProvider({ hourlyDriftPct: -0.3, sentiment: -0.8 }),
  );
  assert.equal(signal.direction, 'short');
});

test('flat market → flat signal', async () => {
  const signal = await generateSignal(
    stubProvider({ hourlyDriftPct: 0, sentiment: 0 }),
  );
  assert.equal(signal.direction, 'flat');
});

test('imminent high-impact event damps confidence to flat', async () => {
  const fomc: MacroEvent = {
    id: 'fomc',
    title: 'FOMC Rate Decision',
    currency: 'USD',
    time: new Date(Date.now() + 30 * 60_000).toISOString(),
    importance: 'high',
    forecast: 3.75,
  };
  const withEvent = await generateSignal(
    stubProvider({ hourlyDriftPct: 0.3, sentiment: 0.8, events: [fomc] }),
  );
  const without = await generateSignal(
    stubProvider({ hourlyDriftPct: 0.3, sentiment: 0.8 }),
  );
  assert.ok(withEvent.confidence < without.confidence);
  assert.equal(withEvent.components.eventRiskDamping, 0.3);
  assert.equal(withEvent.direction, 'flat');
});

test('hot USD CPI surprise pushes macro component bearish', async () => {
  const hotCpi: MacroEvent = {
    id: 'cpi',
    title: 'US CPI YoY',
    currency: 'USD',
    time: new Date(Date.now() - 3_600_000).toISOString(),
    importance: 'high',
    actual: 3.1,
    forecast: 2.7,
  };
  const signal = await generateSignal(
    stubProvider({ hourlyDriftPct: 0, sentiment: 0, events: [hotCpi] }),
  );
  assert.ok(signal.components.macro < 0);
});

test('mock provider is reproducible per seed and signal is well-formed', async () => {
  const a = await generateSignal(new MockMarketDataProvider(42));
  const b = await generateSignal(new MockMarketDataProvider(42));
  assert.equal(a.direction, b.direction);
  assert.equal(a.confidence, b.confidence);
  assert.deepEqual(a.components, b.components);
  assert.ok(a.confidence >= 0 && a.confidence <= 1);
  assert.ok(['long', 'short', 'flat'].includes(a.direction));
  assert.equal(a.pair, 'XAUUSD');
});

test('generateSignal pulls data sequentially — never more than one in flight', async () => {
  const mock = new MockMarketDataProvider(7);
  let inFlight = 0;
  let maxInFlight = 0;
  const track = <T>(fn: () => Promise<T>) => async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    const result = await fn();
    inFlight--;
    return result;
  };
  const provider: MarketDataProvider = {
    getGoldPrice: track(() => mock.getGoldPrice()),
    getMacroCalendar: track(() => mock.getMacroCalendar()),
    getNewsSentiment: track(() => mock.getNewsSentiment()),
  };
  await generateSignal(provider);
  assert.equal(maxInFlight, 1);
});
