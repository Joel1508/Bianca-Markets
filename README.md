# Bianca Markets

Autonomous FX/macro trading agent on Celo — the on-chain execution module for
FinCare's AI assistant **Bianca**. Built for the Celo Agentic Payments & DeFAI
Hackathon (Jul 7–20, 2026).

- **Track 1 (Most Revenue Generated):** real stablecoin swaps on Celo driven by
  XAUUSD/macro signals, tagged with Attribution Codes (`@celo/attribution-tags`).
- **Track 2 (Most x402 Payments):** the agent pays for its own market data
  (gold price feed, macro calendar, news sentiment) via x402 micropayments
  through Celo's facilitator (x402.celo.org).

Agent is registered on-chain via ERC-8004 (see 8004scan.io).

## Structure

```
packages/config         chains (Celo 42220 / Celo Sepolia 11142220), viem clients, env, tokens
packages/signal-engine  XAUUSD price action + macro calendar + news sentiment
packages/market-data    Twelve Data / TradingView+ForexFactory calendar / NewsAPI upstreams + local sentiment scoring
packages/x402-payments  x402 v1 protocol (buyer + seller) for Celo's facilitator
packages/swap-engine    swap execution + attribution tags                      (Phase 3)
apps/data-proxy         paid data proxy — /gold /calendar /news behind HTTP 402
apps/agent              orchestrator entry point
```

## Setup

```sh
npm install
cp .env.example .env   # fill in locally; NEVER commit .env or paste keys into chat
npm run build
npm run agent          # or: npm run agent:dev (tsx, no build step)
```

Defaults are safe: `CELO_NETWORK=sepolia`, `DRY_RUN=true`, no private key
required until Phase 3.

> **Note:** the original plan targeted Alfajores (44787), but Alfajores was
> sunset after Celo's L2 migration — its Forno endpoint no longer resolves
> (verified 2026-07-08). Celo Sepolia (11142220) is the live testnet:
> RPC `https://forno.celo-sepolia.celo-testnet.org`, explorer
> `https://celo-sepolia.blockscout.com`.

## Build phases

- [x] Phase 0 — scaffolding (this)
- [x] Phase 1 — signal engine
- [x] Phase 2 — x402 payment integration (see PROGRESS.md for funding setup)
- [ ] Phase 3 — swap execution + attribution tags
- [ ] Phase 4 — Celo Sepolia testnet validation before mainnet funds
- [ ] Phase 5 — polish, activate 8004scan status, submit via Celo Builders skill

## Safety rules

- Private key lives only in the local `.env` (gitignored). Never in chat, never
  in code, never committed.
- `DRY_RUN=true` by default; real transactions require explicit opt-in and
  user approval.
- Mainnet token addresses in `packages/config/src/tokens.ts` must be verified
  on celoscan.io before any real swap (Phase 4 gate).
