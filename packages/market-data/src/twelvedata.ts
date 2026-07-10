import type { Candle, GoldPriceData } from '@bianca/signal-engine';

interface TwelveDataRow {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

interface TwelveDataResponse {
  status?: string;
  message?: string;
  values?: TwelveDataRow[];
}

/** Twelve Data time_series for XAU/USD, hourly, newest-first → our oldest-first candles. */
export async function fetchGoldPrice(apiKey: string): Promise<GoldPriceData> {
  const url = new URL('https://api.twelvedata.com/time_series');
  url.searchParams.set('symbol', 'XAU/USD');
  url.searchParams.set('interval', '1h');
  url.searchParams.set('outputsize', '48');
  url.searchParams.set('timezone', 'UTC');
  url.searchParams.set('apikey', apiKey);

  const res = await fetch(url);
  const body = (await res.json()) as TwelveDataResponse;
  if (!res.ok || body.status === 'error' || !body.values) {
    throw new Error(`Twelve Data error: ${body.message ?? res.status}`);
  }

  const history: Candle[] = body.values
    .map(
      (row): Candle => ({
        time: `${row.datetime.replace(' ', 'T')}Z`,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
      }),
    )
    .reverse();

  return {
    spot: history[history.length - 1].close,
    currency: 'USD',
    unit: 'oz',
    timestamp: new Date().toISOString(),
    history,
    source: 'twelvedata:XAU/USD',
  };
}
