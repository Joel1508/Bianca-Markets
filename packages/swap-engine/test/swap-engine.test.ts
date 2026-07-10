import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { concat, size, toFunctionSelector } from 'viem';
import type { Signal } from '@bianca/signal-engine';
import {
  RiskManager,
  tradeFromSignal,
  usdToAtomic,
  buildSwapCalldata,
  fromDataSuffix,
} from '../src/index.js';
import { toDataSuffix } from '@celo/attribution-tags';

const signal = (direction: Signal['direction'], confidence: number): Signal => ({
  pair: 'XAUUSD',
  direction,
  confidence,
  components: { priceAction: 0, macro: 0, sentiment: 0, composite: 0, eventRiskDamping: 1 },
  rationale: 'test',
  sources: [],
  generatedAt: new Date().toISOString(),
});

const riskConfig = (stateFile: string, overrides = {}) => ({
  maxPositionUsd: 5,
  dailyLossLimitUsd: 10,
  stateFile,
  ...overrides,
});

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'bianca-risk-')), 'risk.json');

test('tradeFromSignal maps direction and scales size by confidence', () => {
  assert.deepEqual(tradeFromSignal(signal('long', 0.6), 5), { side: 'buy', sizeUsd: 3 });
  assert.deepEqual(tradeFromSignal(signal('short', 1), 5), { side: 'sell', sizeUsd: 5 });
  assert.deepEqual(tradeFromSignal(signal('flat', 0), 5), { side: 'none', sizeUsd: 0 });
});

test('risk: clamps oversized trades to maxPositionUsd', () => {
  const risk = new RiskManager(riskConfig(tmpFile()));
  const d = risk.evaluate(50);
  assert.equal(d.allowed, true);
  assert.equal(d.sizeUsd, 5);
  assert.equal(d.clamped, true);
});

test('risk: rejects non-positive sizes', () => {
  const risk = new RiskManager(riskConfig(tmpFile()));
  assert.equal(risk.evaluate(0).allowed, false);
  assert.equal(risk.evaluate(NaN).allowed, false);
});

test('risk: blocks once daily loss reaches the limit, resets next UTC day', () => {
  const file = tmpFile();
  let today = new Date('2026-07-09T12:00:00Z');
  const risk = new RiskManager(riskConfig(file, { dailyLossLimitUsd: 0.01 }), () => today);

  assert.equal(risk.evaluate(1).allowed, true);
  // a $5 in / $4.98 out fill realizes a $0.02 loss > $0.01 limit
  risk.recordFill({ time: today.toISOString(), txHash: '0xabc', amountInUsd: 5, amountOutUsd: 4.98 });
  const blocked = risk.evaluate(1);
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reasons.join(' '), /halted/);

  today = new Date('2026-07-10T00:00:01Z');
  assert.equal(risk.evaluate(1).allowed, true, 'new UTC day resets the ledger');
});

test('risk: profitable fills do not add to daily loss', () => {
  const risk = new RiskManager(riskConfig(tmpFile()));
  const state = risk.recordFill({ time: 't', txHash: '0x1', amountInUsd: 5, amountOutUsd: 5.01 });
  assert.equal(state.lossUsd, 0);
});

test('usdToAtomic converts USD to token units', () => {
  assert.equal(usdToAtomic(2.96, 6), 2_960_000n);
  assert.equal(usdToAtomic(2.96, 18), 2_960_000_000_000_000_000n);
});

test('attribution tag survives the calldata round-trip', () => {
  const data = buildSwapCalldata(
    'sepolia',
    '0xacc988382b66ee5456086643dcfd9a5ca43dd8f428f6ef22503d8b8013bcffd7',
    '0x01C5C0122039549AD1493B8220cABEdD739BC44E',
    '0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b',
    1_000_000n,
    990_000_000_000_000_000n,
    toDataSuffix('bianca_markets'),
  );
  // decoder parses tags from the END of calldata, exactly like an indexer
  const decoded = fromDataSuffix(data);
  assert.ok(decoded, 'tag must be recoverable from full calldata');
  assert.deepEqual(decoded.codes, ['bianca_markets']);

  // and the underlying swapIn selector is untouched at the front
  const selector = toFunctionSelector(
    'function swapIn(address,bytes32,address,address,uint256,uint256)',
  );
  assert.equal(data.slice(0, 10).toLowerCase(), selector.toLowerCase());
});

test('swapIn calldata grows by exactly the suffix size', () => {
  const suffix = toDataSuffix('bianca_markets');
  const bare = buildSwapCalldata(
    'sepolia',
    '0xacc988382b66ee5456086643dcfd9a5ca43dd8f428f6ef22503d8b8013bcffd7',
    '0x01C5C0122039549AD1493B8220cABEdD739BC44E',
    '0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b',
    1_000_000n,
    0n,
    '0x',
  );
  const tagged = concat([bare, suffix]);
  assert.equal(size(tagged), size(bare) + size(suffix));
});
