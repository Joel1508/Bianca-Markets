import type { Headline, NewsSentimentData } from '@bianca/signal-engine';
import { clamp } from '@bianca/signal-engine';
import { scoreHeadline } from './sentiment.js';

interface NewsApiArticle {
  title: string | null;
  description: string | null;
}

interface NewsApiResponse {
  status: string;
  message?: string;
  articles?: NewsApiArticle[];
}

/** NewsAPI.org headlines about gold/XAUUSD/Fed, scored locally with AFINN + domain terms. */
export async function fetchNewsSentiment(
  apiKey: string,
): Promise<NewsSentimentData> {
  const url = new URL('https://newsapi.org/v2/everything');
  url.searchParams.set('q', 'gold OR XAUUSD OR "Federal Reserve"');
  url.searchParams.set('language', 'en');
  url.searchParams.set('sortBy', 'publishedAt');
  url.searchParams.set('pageSize', '20');

  const res = await fetch(url, { headers: { 'X-Api-Key': apiKey } });
  const body = (await res.json()) as NewsApiResponse;
  if (!res.ok || body.status !== 'ok' || !body.articles) {
    throw new Error(`NewsAPI error: ${body.message ?? res.status}`);
  }

  const headlines: Headline[] = body.articles
    .filter((a): a is NewsApiArticle & { title: string } => Boolean(a.title))
    .map((a) => ({
      title: a.title,
      sentiment: scoreHeadline(`${a.title}. ${a.description ?? ''}`),
    }));

  const score =
    headlines.length === 0
      ? 0
      : clamp(
          headlines.reduce((sum, h) => sum + h.sentiment, 0) / headlines.length,
          -1,
          1,
        );

  return {
    score: Math.round(score * 100) / 100,
    headlines,
    timestamp: new Date().toISOString(),
    source: 'newsapi:everything',
  };
}
