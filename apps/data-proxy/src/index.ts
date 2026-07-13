import http from 'node:http';
import type { Address } from 'viem';
import { isAddress } from 'viem';
import { loadConfig, TOKENS, withRetries } from '@bianca/config';
import { DirectMarketDataProvider } from '@bianca/market-data';
import {
  FACILITATOR_URLS,
  FacilitatorClient,
  X402_NETWORK_NAMES,
  gateRequest,
  requirementsFor,
  type X402GateOptions,
} from '@bianca/x402-payments';

/**
 * Bianca Markets paid data proxy: re-exposes upstream market data behind
 * HTTP 402 via Celo's x402 facilitator. Each endpoint hit = one x402
 * micropayment (Track 2).
 *
 * Modes (decided by env):
 *  - free:        X402_PAY_TO unset — no payment gate (dev only)
 *  - verify-only: X402_PAY_TO set, no facilitator API key — payments are
 *                 verified but not settled on-chain (dev; not Track 2)
 *  - settle:      X402_PAY_TO + X402_FACILITATOR_API_KEY — real payments
 */
const config = loadConfig();
const port = Number(process.env.DATA_PROXY_PORT ?? 4021);
const publicUrl = process.env.DATA_PROXY_PUBLIC_URL ?? `http://localhost:${port}`;
const priceUsd = Number(process.env.X402_PRICE_USD ?? 0.005);

const payTo = process.env.X402_PAY_TO;
if (payTo && !isAddress(payTo)) {
  throw new Error(`X402_PAY_TO is not a valid address: ${payTo}`);
}

const assetSymbol = process.env.X402_ASSET ?? 'USDC';
const asset = TOKENS[config.network][assetSymbol];
if (payTo && !asset) {
  throw new Error(
    `X402_ASSET=${assetSymbol} not known for ${config.network} (see packages/config/src/tokens.ts)`,
  );
}
// USDC's EIP-712 domain verified on-chain 2026-07-08 (both networks).
// Other assets (e.g. USDT, name "Tether USD") need env overrides.
const assetDomain = {
  name: process.env.X402_ASSET_EIP712_NAME ?? (assetSymbol === 'USDC' ? 'USDC' : assetSymbol),
  version: process.env.X402_ASSET_EIP712_VERSION ?? '2',
};

const facilitator = new FacilitatorClient(
  process.env.X402_FACILITATOR_URL ?? FACILITATOR_URLS[config.network],
  process.env.X402_FACILITATOR_API_KEY,
);

const gateOpts: X402GateOptions | undefined = payTo
  ? {
      network: X402_NETWORK_NAMES[config.network],
      payTo: payTo as Address,
      asset: { address: asset.address, decimals: asset.decimals },
      assetDomain,
      priceUsd,
      facilitator,
    }
  : undefined;

const provider = new DirectMarketDataProvider();

const ROUTES: Record<string, { description: string; fetch: () => Promise<unknown> }> = {
  '/gold': {
    description: 'XAU/USD spot + 48 hourly candles',
    fetch: () => provider.getGoldPrice(),
  },
  '/calendar': {
    description: 'Macro economic calendar (-1d..+2d)',
    fetch: () => provider.getMacroCalendar(),
  },
  '/news': {
    description: 'Gold/macro news headlines with sentiment scores',
    fetch: () => provider.getNewsSentiment(),
  },
};

const mode = !gateOpts ? 'free' : facilitator.canSettle ? 'settle' : 'verify-only';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', publicUrl);
  const route = ROUTES[url.pathname];

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };

  try {
    if (url.pathname === '/' || url.pathname === '/info') {
      return json(200, {
        service: 'bianca-markets data proxy',
        network: config.network,
        paymentMode: mode,
        priceUsd: gateOpts ? priceUsd : 0,
        asset: gateOpts ? { symbol: assetSymbol, ...gateOpts.asset } : null,
        endpoints: Object.fromEntries(
          Object.entries(ROUTES).map(([p, r]) => [p, r.description]),
        ),
        upstreamKeysMissing: provider.missingKeys(),
      });
    }
    if (!route) return json(404, { error: 'not found' });
    if (req.method !== 'GET') return json(405, { error: 'method not allowed' });

    const extraHeaders: Record<string, string> = {};
    if (gateOpts) {
      const requirements = requirementsFor(
        `${publicUrl}${url.pathname}`,
        route.description,
        gateOpts,
      );
      const header = req.headers['x-payment'];
      const result = await gateRequest(
        Array.isArray(header) ? header[0] : header,
        requirements,
        gateOpts,
      );
      if (!result.ok) return json(result.status, result.body);
      if (result.paymentResponseHeader) {
        extraHeaders['X-PAYMENT-RESPONSE'] = result.paymentResponseHeader;
      }
      console.log(
        `[paid] ${url.pathname} ${
          result.settledTx ? `settled tx=${result.settledTx}` : 'verified (not settled)'
        }`,
      );
    }

    // Upstream data fetches are read-only — retry transient failures so a
    // blip doesn't waste the payment that was just settled above.
    const payload = await withRetries(route.fetch, { attempts: 3, delayMs: 2_000 });
    return json(200, payload, extraHeaders);
  } catch (err) {
    console.error(`[error] ${url.pathname}:`, err instanceof Error ? err.message : err);
    return json(502, { error: err instanceof Error ? err.message : 'upstream failure' });
  }
});

server.listen(port, () => {
  console.log(`Bianca data proxy on ${publicUrl} (network ${config.network})`);
  console.log(`  payment mode: ${mode}${gateOpts ? ` — $${priceUsd} ${assetSymbol}/call → ${payTo}` : ''}`);
  if (mode === 'verify-only') {
    console.log('  set X402_FACILITATOR_API_KEY to settle payments on-chain (Track 2)');
  }
  const missing = provider.missingKeys();
  if (missing.length > 0) {
    console.log(`  upstream keys missing (serving mock data for those): ${missing.join(', ')}`);
  }
});
