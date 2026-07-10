export type SignalDirection = 'long' | 'short' | 'flat';

export interface SignalComponents {
  /** price-action score in [-1, 1] (positive = bullish gold) */
  priceAction: number;
  /** macro-surprise score in [-1, 1] */
  macro: number;
  /** news-sentiment score in [-1, 1] */
  sentiment: number;
  /** weighted combination of the three, in [-1, 1] */
  composite: number;
  /** confidence multiplier applied when a high-impact event is imminent (1 = no damping) */
  eventRiskDamping: number;
}

export interface Signal {
  /** e.g. "XAUUSD" */
  pair: string;
  direction: SignalDirection;
  /** 0..1 — below the configured threshold the agent stays flat */
  confidence: number;
  components: SignalComponents;
  rationale: string;
  /** which data sources fed this signal */
  sources: string[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Market data — these types define the payloads of the paid data proxy that
// Phase 2 puts behind HTTP 402 (one endpoint per MarketDataProvider method,
// one x402 micropayment per call).
// ---------------------------------------------------------------------------

export interface Candle {
  /** ISO timestamp of candle open */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface GoldPriceData {
  /** current spot price, USD per troy oz */
  spot: number;
  currency: 'USD';
  unit: 'oz';
  timestamp: string;
  /** recent hourly candles, oldest first */
  history: Candle[];
  source: string;
}

export type MacroImportance = 'low' | 'medium' | 'high';

export interface MacroEvent {
  id: string;
  title: string;
  /** currency the release concerns, e.g. "USD" */
  currency: string;
  /** ISO timestamp of the release (past events have `actual` set) */
  time: string;
  importance: MacroImportance;
  actual?: number;
  forecast?: number;
  previous?: number;
  unit?: string;
}

export interface Headline {
  title: string;
  /** per-headline sentiment toward gold in [-1, 1] */
  sentiment: number;
}

export interface NewsSentimentData {
  /** aggregate sentiment toward gold in [-1, 1] (positive = bullish) */
  score: number;
  headlines: Headline[];
  timestamp: string;
  source: string;
}

/**
 * One method per data type; in Phase 2 each call maps to one x402-paid HTTP
 * request against our own data proxy. MockMarketDataProvider implements this
 * for offline development.
 */
export interface MarketDataProvider {
  name: string;
  getGoldPrice(): Promise<GoldPriceData>;
  getMacroCalendar(): Promise<MacroEvent[]>;
  getNewsSentiment(): Promise<NewsSentimentData>;
}
