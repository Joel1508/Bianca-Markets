import type { MacroEvent, MacroImportance } from '@bianca/signal-engine';

// Finnhub's /calendar/economic is premium-only (403 on free keys, verified
// 2026-07-09), so the macro calendar comes from two keyless public feeds:
//  - TradingView's calendar API (primary): actual + forecast + previous,
//    numeric importance, per-event currency — everything the surprise score
//    needs. Unofficial endpoint; requires an Origin header.
//  - Forex Factory's weekly widget feed (fallback): impact/forecast/previous
//    but NO actuals, so surprise scoring degrades to event-risk damping only.

const WINDOW_PAST_MS = 86_400_000; // -1 day
const WINDOW_FUTURE_MS = 2 * 86_400_000; // +2 days

// ── TradingView ─────────────────────────────────────────────────────────────

interface TradingViewEvent {
  id: string;
  title: string;
  currency: string;
  date: string;
  /** -1 low, 0 medium, 1 high */
  importance?: number;
  actual?: number | null;
  forecast?: number | null;
  previous?: number | null;
  unit?: string;
}

interface TradingViewResponse {
  status?: string;
  result?: TradingViewEvent[];
}

const TV_COUNTRIES = ['US', 'EU', 'GB', 'JP', 'CN', 'CH', 'CA', 'AU'];

function tvImportance(value: number | undefined): MacroImportance {
  if (value === 1) return 'high';
  if (value === 0) return 'medium';
  return 'low';
}

export async function fetchMacroCalendarTradingView(): Promise<MacroEvent[]> {
  const now = Date.now();
  const url = new URL('https://economic-calendar.tradingview.com/events');
  url.searchParams.set('from', new Date(now - WINDOW_PAST_MS).toISOString());
  url.searchParams.set('to', new Date(now + WINDOW_FUTURE_MS).toISOString());
  url.searchParams.set('countries', TV_COUNTRIES.join(','));

  const res = await fetch(url, {
    headers: { Origin: 'https://www.tradingview.com' },
  });
  const body = (await res.json()) as TradingViewResponse;
  if (!res.ok || body.status !== 'ok' || !Array.isArray(body.result)) {
    throw new Error(`TradingView calendar error: ${body.status ?? res.status}`);
  }

  return body.result.map(
    (e): MacroEvent => ({
      id: `tradingview-${e.id}`,
      title: e.title,
      currency: e.currency,
      time: new Date(e.date).toISOString(),
      importance: tvImportance(e.importance),
      actual: e.actual ?? undefined,
      forecast: e.forecast ?? undefined,
      previous: e.previous ?? undefined,
      unit: e.unit,
    }),
  );
}

// ── Forex Factory (fallback) ────────────────────────────────────────────────

interface ForexFactoryEvent {
  title: string;
  /** already a currency code ("USD", "EUR", ...) */
  country: string;
  /** ISO date with UTC offset */
  date: string;
  impact?: string;
  forecast?: string;
  previous?: string;
}

/** "54.2", "0.3%", "-33", "215K" → number (unit suffix dropped), else undefined */
function ffNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = parseFloat(value.replace(/[%KMBT]$/i, ''));
  return Number.isFinite(n) ? n : undefined;
}

function ffImportance(impact: string | undefined): MacroImportance {
  const v = (impact ?? '').toLowerCase();
  return v === 'high' || v === 'medium' || v === 'low' ? v : 'low';
}

export async function fetchMacroCalendarForexFactory(): Promise<MacroEvent[]> {
  const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
  if (!res.ok) throw new Error(`Forex Factory calendar error: ${res.status}`);
  const body = (await res.json()) as ForexFactoryEvent[];
  if (!Array.isArray(body)) throw new Error('Forex Factory calendar error: unexpected shape');

  const now = Date.now();
  return body
    .filter((e) => {
      const t = new Date(e.date).getTime();
      return t >= now - WINDOW_PAST_MS && t <= now + WINDOW_FUTURE_MS;
    })
    .map(
      (e, i): MacroEvent => ({
        id: `forexfactory-${i}-${e.date}`,
        title: e.title,
        currency: e.country,
        time: new Date(e.date).toISOString(),
        importance: ffImportance(e.impact),
        // The feed has no actuals — surprise scoring is unavailable on this
        // source; event-risk damping (time/importance/currency) still works.
        forecast: ffNumber(e.forecast),
        previous: ffNumber(e.previous),
      }),
    );
}

/** Macro calendar, windowed to yesterday..+2 days: TradingView, then Forex Factory. */
export async function fetchMacroCalendar(): Promise<MacroEvent[]> {
  try {
    return await fetchMacroCalendarTradingView();
  } catch (err) {
    console.warn(
      `[market-data] TradingView calendar failed (${err instanceof Error ? err.message : err}); falling back to Forex Factory`,
    );
    return fetchMacroCalendarForexFactory();
  }
}
