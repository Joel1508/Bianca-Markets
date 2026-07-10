export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Simple moving average of the last `period` values; undefined if not enough data. */
export function sma(values: number[], period: number): number | undefined {
  if (period <= 0 || values.length < period) return undefined;
  const window = values.slice(-period);
  return window.reduce((sum, v) => sum + v, 0) / period;
}

/** Wilder's RSI over the last `period` deltas; undefined if not enough data. */
export function rsi(values: number[], period = 14): number | undefined {
  if (values.length < period + 1) return undefined;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = values[i] - values[i - 1];
    if (delta > 0) avgGain += delta;
    else avgLoss -= delta;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}
