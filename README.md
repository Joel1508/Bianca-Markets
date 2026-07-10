# Bianca Markets

Autonomous FX/macro trading agent on Celo — the on-chain execution module for
FinCare's AI assistant **Bianca**. Built for the **Celo Agentic Payments &
DeFAI Hackathon** (Jul 7–20, 2026).

The agent is a paying customer of its own economy: it buys every market-data
pull (gold spot, macro calendar, news sentiment) with a real x402 micropayment
settled on-chain, generates XAUUSD trading signals from that data, and
expresses them as risk-controlled stablecoin swaps on Celo mainnet — every
swap carrying an ERC-8021 attribution tag.

**Live:** ERC-8004 agent [#9660 on 8004scan](https://8004scan.io/agents/celo/9660)
(active, x402 support declared on-chain) · first attributed mainnet swap
[`0x96b8d4f9…c776`](https://celoscan.io/tx/0x96b8d4f90996eee9d3c70d8d2f0f529e1acb2241ff0d15c48ed5c1a66bf2c776)
· x402 payments settling on mainnet via [x402.celo.org](https://x402.celo.org)

## Tracks

- **Most Revenue Generated:** signal-gated Mento swaps (USDC ↔ USDm), tagged
  with ERC-8021 attribution codes, counted on the live Dune leaderboard.
- **Most x402 Payments:** the agent's own paid data proxy re-exposes upstream
  feeds behind HTTP 402; every agent cycle settles 3 x402 payments through
  Celo's facilitator. The official x402 npm packages don't support Celo, so
  the protocol (x402 v1 "exact" scheme, EIP-3009 transferWithAuthorization)
  is implemented from scratch in `packages/x402-payments`.

## Architecture

```
packages/config         chains (Celo 42220 / Celo Sepolia 11142220), viem clients, env, tokens
packages/signal-engine  signal = price action (SMA/RSI) + macro surprise + news sentiment
packages/market-data    Twelve Data / TradingView+ForexFactory / NewsAPI upstreams + AFINN sentiment
packages/x402-payments  x402 v1 protocol, buyer + seller sides, hand-rolled for Celo's facilitator
packages/swap-engine    Mento v2 Broker swaps + ERC-8021 attribution + risk manager
apps/data-proxy         paid data proxy — /gold /calendar /news behind HTTP 402
apps/agent              orchestrator: pay for data → signal → risk check → swap
scripts/                validation, seeding, and on-chain verification tooling
```

## Risk controls

Enforced before any swap, logged even in dry-run: $5 per-trade cap (oversized
trades clamped), $10 daily realized-loss halt (resets at UTC midnight),
slippage floor on every quote, dry-run by default, and per-transaction human
approval for every real send. Non-organic fills (inventory seeding) are tagged
in the trade ledger and excluded from organic volume claims.

## Setup

```sh
npm install
cp .env.example .env   # fill in locally; NEVER commit .env
npm run build
npm test               # 23 tests
npm run proxy          # terminal 1: x402 data proxy
npm run agent          # terminal 2: one agent cycle (dry-run by default)
```

Defaults are safe: `DRY_RUN=true`, testnet (`CELO_NETWORK=sepolia`), no
private key required until you opt into real payments/swaps.

## Safety rules

- Private key lives only in the local `.env` (gitignored) — never in chat,
  never in code, never committed.
- `DRY_RUN=true` by default; real transactions require explicit opt-in and
  per-transaction approval.
- Mainnet contract addresses were verified on Celoscan (source + history +
  cross-checked on-chain against docs.mento.org) before the mainnet gate was
  removed. See PROGRESS.md for the full audit trail.
