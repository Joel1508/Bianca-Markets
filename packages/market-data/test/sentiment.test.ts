import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreHeadline } from '../src/sentiment.js';

test('domain terms override generic tone toward gold', () => {
  // positive tone but bearish for gold
  const bearish = scoreHeadline('Dollar rallies to a great multi-week high as risk appetite improves');
  assert.ok(bearish < 0, `expected bearish, got ${bearish}`);
  // fear-toned but bullish for gold
  const bullish = scoreHeadline('War fears drive safe-haven demand; central bank buying accelerates');
  assert.ok(bullish > 0, `expected bullish, got ${bullish}`);
});

test('scores stay within [-1, 1]', () => {
  const extreme = scoreHeadline(
    'rate cut rate-cut safe haven safe-haven geopolitical inflation hedge yields slip dollar weakens etf inflow wonderful amazing great',
  );
  assert.ok(extreme <= 1 && extreme >= -1);
  assert.equal(typeof scoreHeadline(''), 'number');
});
