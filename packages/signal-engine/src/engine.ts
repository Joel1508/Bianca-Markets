import { clamp, rsi, sma } from './indicators.js';
import type {
  MacroEvent,
  MarketDataProvider,
  Signal,
  SignalComponents,
} from './types.js';

export interface SignalConfig {
  weights: { priceAction: number; macro: number; sentiment: number };
  /** confidence below this → stay flat */
  minConfidence: number;
  /** high-impact release within this many hours ahead counts as event risk */
  eventRiskWindowHours: number;
  /** confidence multiplier while inside the event-risk window */
  eventRiskDamping: number;
  /** macro releases older than this are ignored */
  macroLookbackHours: number;
  smaFastPeriod: number;
  smaSlowPeriod: number;
  rsiPeriod: number;
}

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  weights: { priceAction: 0.5, macro: 0.3, sentiment: 0.2 },
  minConfidence: 0.25,
  eventRiskWindowHours: 2,
  eventRiskDamping: 0.3,
  macroLookbackHours: 24,
  smaFastPeriod: 5,
  smaSlowPeriod: 20,
  rsiPeriod: 14,
};

/**
 * XAUUSD signal from three components:
 *  - price action: fast/slow SMA divergence, damped at RSI extremes
 *  - macro: surprise vs forecast on recent USD releases (hot USD data ⇒
 *    stronger dollar ⇒ bearish gold — a deliberate simplification)
 *  - sentiment: aggregate news score toward gold
 * A high-impact release inside the risk window damps confidence so the agent
 * doesn't trade into an event.
 */
export async function generateSignal(
  provider: MarketDataProvider,
  overrides: Partial<SignalConfig> = {},
): Promise<Signal> {
  const cfg: SignalConfig = {
    ...DEFAULT_SIGNAL_CONFIG,
    ...overrides,
    weights: { ...DEFAULT_SIGNAL_CONFIG.weights, ...overrides.weights },
  };

  const [gold, calendar, news] = await Promise.all([
    provider.getGoldPrice(),
    provider.getMacroCalendar(),
    provider.getNewsSentiment(),
  ]);

  const closes = gold.history.map((c) => c.close);
  const priceAction = priceActionScore(closes, cfg);
  const macro = macroSurpriseScore(calendar, cfg);
  const sentiment = clamp(news.score, -1, 1);

  const { weights } = cfg;
  const composite = clamp(
    weights.priceAction * priceAction +
      weights.macro * macro +
      weights.sentiment * sentiment,
    -1,
    1,
  );

  const imminent = imminentHighImpactEvents(calendar, cfg);
  const eventRiskDamping = imminent.length > 0 ? cfg.eventRiskDamping : 1;
  const confidence = clamp(Math.abs(composite) * eventRiskDamping, 0, 1);
  const direction =
    confidence >= cfg.minConfidence ? (composite > 0 ? 'long' : 'short') : 'flat';

  const components: SignalComponents = {
    priceAction: round3(priceAction),
    macro: round3(macro),
    sentiment: round3(sentiment),
    composite: round3(composite),
    eventRiskDamping,
  };

  const parts = [
    `price action ${fmt(priceAction)}`,
    `macro ${fmt(macro)}`,
    `sentiment ${fmt(sentiment)}`,
    `→ composite ${fmt(composite)}`,
  ];
  if (imminent.length > 0) {
    parts.push(
      `confidence damped ×${cfg.eventRiskDamping} (${imminent
        .map((e) => e.title)
        .join(', ')} within ${cfg.eventRiskWindowHours}h)`,
    );
  }

  return {
    pair: 'XAUUSD',
    direction,
    confidence: round3(confidence),
    components,
    rationale: parts.join(', '),
    sources: [gold.source, `${provider.name}:calendar`, news.source],
    generatedAt: new Date().toISOString(),
  };
}

/** SMA divergence scaled so ±0.5% fast/slow gap saturates at ±1; damped at RSI extremes. */
function priceActionScore(closes: number[], cfg: SignalConfig): number {
  const fast = sma(closes, cfg.smaFastPeriod);
  const slow = sma(closes, cfg.smaSlowPeriod);
  if (fast === undefined || slow === undefined || slow === 0) return 0;
  let score = clamp((fast - slow) / slow / 0.005, -1, 1);
  const r = rsi(closes, cfg.rsiPeriod);
  if (r !== undefined) {
    if (score > 0 && r > 70) score *= 0.4; // overbought: distrust longs
    if (score < 0 && r < 30) score *= 0.4; // oversold: distrust shorts
  }
  return score;
}

/**
 * Sum of surprise (actual vs forecast) on recent USD releases, sign-flipped:
 * a hotter-than-forecast USD print is treated as bearish gold. A 10% relative
 * surprise saturates a single event's contribution.
 */
function macroSurpriseScore(events: MacroEvent[], cfg: SignalConfig): number {
  const cutoff = Date.now() - cfg.macroLookbackHours * 3_600_000;
  const importanceWeight = { high: 1, medium: 0.5, low: 0.2 } as const;
  let score = 0;
  for (const e of events) {
    if (e.currency !== 'USD') continue;
    if (e.actual === undefined || e.forecast === undefined) continue;
    const t = Date.parse(e.time);
    if (Number.isNaN(t) || t < cutoff || t > Date.now()) continue;
    const surprise = (e.actual - e.forecast) / Math.max(Math.abs(e.forecast), 1e-9);
    score -= clamp(surprise / 0.1, -1, 1) * importanceWeight[e.importance];
  }
  return clamp(score, -1, 1);
}

function imminentHighImpactEvents(
  events: MacroEvent[],
  cfg: SignalConfig,
): MacroEvent[] {
  const now = Date.now();
  const horizon = now + cfg.eventRiskWindowHours * 3_600_000;
  return events.filter((e) => {
    if (e.importance !== 'high') return false;
    const t = Date.parse(e.time);
    return !Number.isNaN(t) && t > now && t <= horizon;
  });
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function fmt(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2);
}
