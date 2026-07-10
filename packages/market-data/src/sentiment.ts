import Sentiment from 'sentiment';
import { clamp } from '@bianca/signal-engine';

const analyzer = new Sentiment();

/**
 * AFINN scores tone, not gold-directionality — "dollar rallies" reads
 * positive but is bearish gold, and "war fears" reads negative but is
 * bullish. Domain terms therefore carry more weight (±0.4 per match) than
 * the generic tone score.
 */
const GOLD_BULLISH_TERMS = [
  'safe-haven',
  'safe haven',
  'central bank buying',
  'central banks buy',
  'rate cut',
  'rate-cut',
  'geopolitical',
  'inflation hedge',
  'yields slip',
  'yields fall',
  'dollar weakens',
  'dollar slips',
  'etf inflow',
];

const GOLD_BEARISH_TERMS = [
  'dollar rallies',
  'dollar strengthens',
  'dollar surges',
  'rate hike',
  'rate-hike',
  'higher-for-longer',
  'yields rise',
  'yields climb',
  'etf outflow',
  'risk appetite',
  'risk-on',
];

/** Score a headline's sentiment toward gold in [-1, 1]. */
export function scoreHeadline(text: string): number {
  const lower = text.toLowerCase();
  // comparative is score per token, typically within ±0.5 for headlines
  let score = clamp(analyzer.analyze(text).comparative, -0.6, 0.6);
  for (const term of GOLD_BULLISH_TERMS) {
    if (lower.includes(term)) score += 0.4;
  }
  for (const term of GOLD_BEARISH_TERMS) {
    if (lower.includes(term)) score -= 0.4;
  }
  return clamp(score, -1, 1);
}
