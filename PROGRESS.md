# Bianca Markets — Progress

Session-by-session log. Updated at the end of each phase so any session can
resume cleanly. See README.md for structure and setup.

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Scaffolding (monorepo, viem, Celo config) | ✅ done 2026-07-08 |
| 1 | Signal engine (XAUUSD price action, macro, sentiment) | ✅ done 2026-07-08 |
| 2 | x402 payment integration (paid data proxy) | ✅ done 2026-07-08; live-verified 2026-07-09 (3 settled Sepolia payments) |
| 3 | Swap execution + attribution tags | ✅ done 2026-07-09 — first REAL Sepolia swap executed + attribution verified on-chain |
| 4 | Celo Sepolia testnet validation | ✅ done 2026-07-09 — SHORT path, ledger accumulation, halt, clamp all verified (3 more real swaps) |
| 5 | Polish, 8004scan activation, Celo Builders submission | 🟨 mainnet address verification done 2026-07-09; execution pending next session |

## Decisions log

- **2026-07-08 — Alfajores is sunset.** Its Forno endpoint is NXDOMAIN
  (sunset after Celo's L2 migration). Testnet is **Celo Sepolia**: chain id
  11142220, RPC `https://forno.celo-sepolia.celo-testnet.org`, explorer
  `https://celo-sepolia.blockscout.com`. Config rejects `alfajores` with a
  helpful error. Sepolia test funds will be needed for Phase 4.
- **2026-07-08 — Own paid data proxy for x402 (Track 2).** No macro/XAUUSD
  provider supports x402 natively, so Phase 2 builds a thin internal service
  that fetches from free/cheap upstreams and re-exposes gold spot, macro
  calendar, and news headlines behind HTTP 402 via Celo's facilitator
  (x402.celo.org). Full pricing control; every data pull = one x402 payment.
  The `MarketDataProvider` interface (one method per data type) is the
  proxy's API contract: `getGoldPrice()`, `getMacroCalendar()`,
  `getNewsSentiment()` → one paid endpoint each.

- **2026-07-09 — Finnhub dropped for the macro calendar.** Its
  `/calendar/economic` endpoint is premium-only: 403 "You don't have access
  to this resource" on the free key (the key itself works — `/quote` returns
  200). Trading Economics' guest API is discontinued (HTTP 410). Replaced
  with two keyless feeds in `packages/market-data/src/calendar.ts`:
  **TradingView** (`economic-calendar.tradingview.com/events`, needs an
  `Origin: https://www.tradingview.com` header) as primary — has actuals,
  forecasts, numeric importance, currency; **Forex Factory** weekly JSON
  (`nfs.faireconomy.media/ff_calendar_thisweek.json`) as fallback — no
  actuals, so surprise scoring degrades to event-risk damping only. Both are
  unofficial feeds; if TradingView ever blocks, the fallback kicks in
  automatically. `FINNHUB_API_KEY` is now unused (removed from
  `.env.example`; harmless leftover in `.env`).

- **2026-07-09 — Mento over Ubeswap for Phase 3 swaps.** Mento is the only
  DEX actually deployed on Celo Sepolia (Ubeswap is mainnet-only). Probed
  live: BiPoolManager has 16 exchanges including **USDm ↔ native Circle
  USDC** (`0xacc98838…bcffd7`) — the exact USDC the wallet holds — with sane
  ~1:1 quotes. One Broker contract does quote (`getAmountOut`) + swap
  (`swapIn`). Sepolia addresses (docs.mento.org, Blockscout-verified
  proxies): Broker `0xB9Ae2065142EB79b6c5EB1E8778F883fad6B07Ba`,
  BiPoolManager `0xeCB3C656C131fCd9bB8D1d80898716bD684feb78`, USDm
  `0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b`.
- **2026-07-09 — Signal→trade mapping (documented simplification).** XAUUSD
  direction is expressed on the USDC/USDm stablecoin pair: LONG buys USDm,
  SHORT sells it back, size = confidence × MAX_POSITION_USD. The deliverable
  is signal-gated, risk-controlled, ERC-8021-attributed volume (Track 1),
  not synthetic gold exposure.
- **2026-07-09 — X402_PAY_TO moved to a separate user wallet**
  (`0x9864a892c37e240b1398d3c93d5bA8A530F118d2`) — no more self-payment
  loop. Verified: settled Transfer decoded on-chain, 0.005 USDC
  agent → new payTo. `.env.example` now warns to use a separate address.

## Phase 1 summary (signal engine)

- `packages/signal-engine`: `MarketDataProvider` interface + payload types
  (`GoldPriceData` w/ hourly candles, `MacroEvent`, `NewsSentimentData`).
- `MockMarketDataProvider`: seedable (mulberry32) offline provider —
  reproducible data per seed; used until the Phase 2 proxy exists.
- `generateSignal(provider, config?)` combines three scored components in
  [-1, 1]: price action (SMA5/SMA20 divergence, damped at RSI(14) extremes),
  macro surprise (USD releases vs forecast, hot USD ⇒ bearish gold —
  documented simplification), news sentiment. Weighted 0.5/0.3/0.2 →
  composite; confidence < 0.25 ⇒ flat. High-impact USD event within 2h damps
  confidence ×0.3 (don't trade into FOMC/CPI). All knobs in `SignalConfig`.
- Tests: `npm test` (node:test via tsx) — indicators, direction cases, event
  damping, macro surprise sign, seed reproducibility.
- `apps/agent` now runs the real engine on mock data and prints the
  component breakdown.

## Pre-existing setup (do not redo)

- Wallet funded (CELO gas + USDT) on Celo Mainnet.
- Agent registered on-chain via ERC-8004 (8004scan.io); registration tweet up.
- Celo Builders submission skill installed.

## Phase 2 summary (x402 paid data proxy)

Facilitator facts (probed live 2026-07-08):
- API hosts: `api.x402.celo.org` (mainnet) / `api.x402.sepolia.celo.org`
  (Sepolia). Standard x402 v1 interface; networks `celo` / `celo-sepolia`.
- `/verify` is open; `/settle` requires `X-API-Key` + prepaid credits
  ($0.001/settlement, topped up in USDC). API key is created at
  x402.celo.org by connecting a wallet and signing a message (browser,
  one-time — no private key in this repo).
- Supported assets: mainnet USDC + USDT, Sepolia USDC only. USDC EIP-712
  domain `{name:"USDC",version:"2"}` verified on-chain both networks; USDT
  is `{name:"Tether USD"}` with no version() — default asset is USDC.
- **The official x402 npm packages (v1.2.0) do NOT support Celo networks**
  — protocol is hand-rolled in `packages/x402-payments` (x402 v1 "exact"
  scheme, EIP-3009 transferWithAuthorization via viem).

Wallet-sides answer: the SELLER needs no private key (public `X402_PAY_TO`
address + facilitator API key). The BUYER (agent) signs each payment with
`PRIVATE_KEY` — that is a gasless stablecoin spend, so real paid pulls only
happen once the user sets the key + funds USDC.

Built:
- `packages/market-data`: Twelve Data (XAU/USD 1h), Finnhub (economic
  calendar — replaced 2026-07-09 with keyless TradingView/Forex Factory, see
  decisions log), NewsAPI + local AFINN sentiment with gold-domain term
  corrections; `DirectMarketDataProvider` with per-source mock fallback.
- `packages/x402-payments`: protocol types/codecs, `FacilitatorClient`,
  `X402Client` (buyer), `gateRequest` (seller), `X402MarketDataProvider`
  (accumulates receipts for Track 2 counting).
- `apps/data-proxy`: `/gold` `/calendar` `/news` behind the x402 gate;
  modes free / verify-only / settle depending on env. `npm run proxy`.
- Agent picks provider: proxy+key → x402-paid; else direct upstreams; else
  mock. Prints payment receipts + settled tx hashes.
- Verified live with zero funds: `scripts/x402-smoke.ts` — throwaway key's
  payment passed facilitator schema+signature checks, rejected only
  `insufficient_funds`. 15/15 tests pass.

## 2026-07-09 — first real run debugged; x402 settlement LIVE on Sepolia

User's first proxy+agent run hit two issues; both diagnosed and fixed:

1. **Finnhub 403 on the macro calendar** — premium-only endpoint; replaced
   with keyless TradingView/Forex Factory feeds (see decisions log).
2. **Proxy in "free" mode, agent bypassing it (zero x402 payments).**
   Root cause: `.env` was created from an older template that predates the
   x402 section — `X402_PAY_TO` and `DATA_PROXY_URL` were entirely absent
   (only `X402_FACILITATOR_API_KEY` had been added), so the proxy saw no
   pay-to (→ free mode) and the agent saw no proxy URL (→ direct upstreams).
   Two more latent blockers found on the way:
   - `PRIVATE_KEY` lacked the `0x` prefix — `requirePrivateKey()` would have
     thrown the moment the proxy path activated. Prefixed in place.
   - A stale proxy process from the earlier (free-mode) run still held port
     4021; it had to be killed or the fixed proxy exits with EADDRINUSE and
     the old free-mode one keeps answering.

   Fixes applied to `.env`: `PRIVATE_KEY` 0x-prefixed;
   `X402_PAY_TO=0xd16f066D8789C4D5d29e61ec63bD26d01A6c7D7E` (the agent's own
   wallet — buyer pays seller = self-transfer, net cost ≈ facilitator fees;
   change if revenue should land elsewhere); `DATA_PROXY_URL=http://localhost:4021`;
   `X402_PRICE_USD=0.005`.

Verified live (2026-07-09):
- Facilitator key accepted by the **Sepolia** host (`/settle` with the key →
  schema error not 401; bogus key → 401), so keys from x402.celo.org work on
  both networks.
- Wallet `0xd16f...7D7E` on Sepolia: 0.3 CELO, 20 USDC.
- Proxy `/info` → `paymentMode: "settle"`; unpaid `/gold` → proper 402.
- Full agent cycle: **3/3 payments settled on-chain** (USDC
  `transferWithAuthorization`, receipt status 0x1, e.g. tx
  `0xc829191c...db68a18` block 30332074). Track 2 counting works.
- 15/15 tests still pass.

Routine run: `npm run proxy` in one terminal, `npm run agent` in another —
each agent cycle = 3 settled x402 payments. If the proxy logs a port error,
check for a stale listener: `lsof -nP -iTCP:4021 -sTCP:LISTEN`.

## Phase 3 summary (swap execution + attribution + risk controls)

Built 2026-07-09 in `packages/swap-engine` (23/23 tests pass, 8 new):

- `mento.ts` — Mento v2 Broker adapter (viem): `findExchangeId` via
  BiPoolManager, `getQuote`, `buildSwapCalldata` = `swapIn` calldata with the
  ERC-8021 attribution suffix concat'd on (Solidity ignores trailing
  calldata; indexers recover it with `fromDataSuffix`).
- Attribution: `@celo/attribution-tags@0.3.0`, code **`bianca_markets`**
  (env `ATTRIBUTION_CODE`; codes must match `/^[a-z0-9_]{1,32}$/`, no
  registration needed). Round-trip covered by tests.
- `risk.ts` — `RiskManager`, enforced BEFORE any swap and logged even in dry
  run: per-trade cap `MAX_POSITION_USD` (default $5, oversized trades are
  clamped) + daily realized-loss limit `DAILY_LOSS_LIMIT_USD` (default $10,
  halts trading until UTC midnight). Ledger in `.state/risk-<network>.json`
  (gitignored); only REAL fills are recorded, loss = amountInUsd −
  amountOutUsd on stable/stable.
- `executeSwap` — quote → slippage floor (`SWAP_SLIPPAGE_BPS`, default 50)
  → dry-run report OR balance/allowance check, approve if needed, tagged
  `swapIn`, receipt check, amountOut decoded from the tokenOut Transfer log.
  **Hard gates:** `dryRun` must be explicitly false; mainnet swaps throw
  until the Phase 4/5 verification pass regardless of dryRun=false.
- Agent: signal → `tradeFromSignal` (flat ⇒ no trade) → risk decision
  (always printed) → dry-run prints the exact would-be swap with a live
  on-chain quote. Verified full cycle on Sepolia 2026-07-09: 3 settled x402
  payments, then `DRY RUN — would buy $3.01: 3.01 USDC → 3.0087 USDm
  (floor 2.9937)` via the USDm/USDC exchange, attribution bianca_markets.

## First real Sepolia swap — executed + verified 2026-07-09

User-approved in chat (per the transaction-by-transaction rule; DRY_RUN=false
was set on the command line only — `.env` keeps DRY_RUN=true):

- Cycle: 3 settled x402 payments → XAUUSD LONG 0.601 → risk pass →
  **EXECUTED buy 3.01 USDC → 3.0087 USDm**, tx
  `0x9e31a3314a5f2692ed932ed4a6f107028ec4b1a5670068ab2c37cab612b2c4ee`
  (block 30334075, to = Mento Broker, status success).
- Attribution verified via the indexer path (`verifyTx`):
  `{"codes":["bianca_markets"],"schemaId":0}` — Track 1 counting works.
- Transfers decoded: 3.01 USDC trader → Mento Reserve; 3.0087 USDm → agent.
- Risk ledger recorded the $0.0013 spread as realized loss ($10 daily limit).
- Wallet now holds USDm, so the SHORT path is testable next.

## Phase 4 summary (Sepolia validation) — all four checks PASS 2026-07-09

Tooling: `scripts/phase4-validate.ts` (steps: clamp | short | halt | reset |
all; dry by default, `short --real` sends the one approved sell).

1. **SHORT path** — real user-approved sell: 3 USDm → 3.000093 USDC, tx
   `0x282118c1…d51b9e` (block 30335133), attribution decoded
   `{"codes":["bianca_markets"],"schemaId":0}`, fill recorded (tiny profit ⇒
   no loss added).
2. **Ledger accumulates across separate processes** — 4 fills in
   `.state/risk-sepolia.json` from 4 different runs (Phase 3 buy, Phase 4
   sell, 2 real agent cycles); cycle 1 started from the prior $0.0013 and
   ended $0.0026, cycle 2 started $0.0026 → $0.0040. Buy txs
   `0x57a62831…783e76`, `0x4f90e67e…b41cc0` — both attribution-verified.
3. **Daily-limit halt** — with the real ledger and a tiny
   `DAILY_LOSS_LIMIT_USD`, `evaluate()` blocks AND the full agent prints
   `BLOCKED by risk controls — no trade`; a yesterday-dated ledger is
   ignored (fresh $0 after UTC midnight; also unit-tested with an injected
   clock).
4. **Clamp is real** — $50 request → $5 decision and the dry-run quote is
   built from the clamped 5 USDC, not the requested amount.

## Mainnet diff (Phase 5 readiness — review together BEFORE flipping)

What changes Sepolia → mainnet when `CELO_NETWORK=mainnet`:

- **Chain/RPC**: chain id 11142220 → 42220, RPC forno.celo-sepolia →
  `https://forno.celo.org` (both already in `packages/config/src/chains.ts`).
- **x402**: facilitator host `api.x402.sepolia.celo.org` →
  `api.x402.celo.org`, network name `celo-sepolia` → `celo`; the SAME
  facilitator API key works on both hosts (verified 2026-07-09).
  Settlement asset becomes mainnet USDC
  `0xcebA9300f2b948710d2653dD7B07f33A8B32118C`; buyer wallet needs mainnet
  USDC (currently holds CELO + USDT — swap or bridge some to USDC),
  facilitator credits stay topped in USDC.
- **Swap pair**: USDm → **cUSD** `0x765DE816845861e75A25fCA122bb6898B8B1282a`
  (agent already maps this per network). Mainnet BiPoolManager
  (`0x22d9db95E6Ae61c104A7B6F6C78D7993B94ec901`) has 16 exchanges and the
  cUSD/USDC exchange EXISTS — probed live 2026-07-09, exchangeId
  `0xacc98838…bcffd7`. Broker `0x777A8255cA72412f0d706dc03C9D1987306B4CaD`.
- **Code gate to remove deliberately**: `executeSwap` currently THROWS on
  any real mainnet swap. Flipping mainnet on = (a) celoscan.io verification
  of Broker/BiPoolManager/cUSD/USDC addresses (Phase 4 gate rule), then
  (b) removing/flag-gating that throw in `packages/swap-engine/src/index.ts`
  — an explicit code change reviewed in chat, never an env flip.
- **Unchanged**: DRY_RUN=true default, per-tx approval rule, risk limits
  (fresh ledger file `.state/risk-mainnet.json`), attribution code
  `bianca_markets`, X402_PAY_TO (user's separate wallet).

## Mainnet address verification — PASSED 2026-07-09 (read-only)

Per the Phase 4 gate rule, all three mainnet addresses verified through
three independent lanes (Celoscan + on-chain cross-consistency + official
docs). No code or config touched; the mainnet gate in `executeSwap` stays.

1. **Broker `0x777A8255cA72412f0d706dc03C9D1987306B4CaD`** ✅
   - Celoscan: verified source, contract `BrokerProxy`, public name tag
     **"Mento Labs: Broker"**.
   - History: deployed 2023-03-07 (Mento v2 era), ~2.25M transactions — an
     established contract, not a fresh lookalike. Owner is a verified
     governance `TransparentUpgradeableProxy`, not an EOA.
   - On-chain: `getExchangeProviders()` returns exactly the documented
     BiPoolManager `0x22d9db95…ec901`; same Broker interface we exercised on
     Sepolia (and the cUSD/USDC exchangeId is identical to Sepolia's
     `0xacc98838…bcffd7`).
   - docs.mento.org lists this address as Broker (v2), Celo Mainnet.
2. **cUSD `0x765DE816845861e75A25fCA122bb6898B8B1282a`** ✅
   - Celoscan: verified `StableTokenProxy`, public name tag **"Celo: cUSD
     Token"**, token tracker "Mento Dollar (USDm)".
   - History: deployed 2020-04-22 (Celo genesis era), ~285M transactions —
     THE canonical StableToken, impossible to fake.
   - On-chain: referenced verbatim as an asset of the BiPoolManager's
     cUSD/USDC exchange; 18 decimals, ~14.2M supply.
   - **Note:** on-chain identity is now `name="Mento Dollar"`,
     `symbol="USDm"` — Mento rebranded cUSD to USDm on mainnet (matches the
     Sepolia token). Same canonical contract; our config's `cUSD` label is
     cosmetic and can be renamed during Phase 5 execution.
3. **USDC `0xcebA9300f2b948710d2653dD7B07f33A8B32118C`** ✅
   - Celoscan: verified `FiatTokenProxy`, public name tag **"Circle: USDC
     Token"**.
   - Circle's official developer docs list exactly this address as native
     USDC on Celo mainnet.
   - History: deployed 2024-01-08 (Circle's native-USDC-on-Celo launch),
     ~489k transactions; 6 decimals.
   - On-chain: referenced verbatim in the same Mento cUSD/USDC exchange the
     agent would trade.

Remaining for Phase 5 execution (next session, in order): fund mainnet
USDC for x402 buys, remove the mainnet gate in
`packages/swap-engine/src/index.ts` as a reviewed code change, first
mainnet swap with explicit per-tx approval, 8004scan activation, Celo
Builders submission.

## 2026-07-10 — mainnet live: gate removed, x402 settled, seed swap executed

1. **Funding corrected.** The "pre-existing mainnet CELO+USDT" from the
   setup notes was NOT on the agent wallet — `0xd16f…7D7E` had zero balance
   and zero history on mainnet (both lanes: Forno `eth_call` + Blockscout).
   User funded it fresh: 42.46 CELO + ~5 USDC (less than the recommended 20
   — a full-size $5 trade is tight; top-up suggested). Facilitator credits
   confirmed on the mainnet host by the user.
2. **Mainnet gate removed** (user-reviewed diff, approved in chat): the
   Phase 3 `throw` on `!dryRun && network === 'mainnet'` deleted from
   `executeSwap`; stale "mainnet is GATED" comment in `mento.ts` updated.
   Remaining guards: DRY_RUN=true default, explicit `dryRun:false`
   required, risk clamp/halt, per-tx approval rule. 23/23 tests pass.
3. **First mainnet agent cycle (dry-run swap): 3/3 x402 payments settled
   on-chain** — the agent's first real mainnet txs (gold
   `0x5fb7949f…87ca05`, news `0xff48aaab…4ae16a`, calendar
   `0x627fe5eb…fc7e144`). Signal came out SHORT 0.266 →
   sell $1.33 USDm, **unexecutable: wallet held zero USDm** (dry run
   doesn't balance-check; the SHORT path needs inventory from a prior
   LONG — on Sepolia the first signal happened to be LONG).
4. **SEED SWAP (manual, NOT signal-driven) — first real mainnet swap.**
   User chose seeding over waiting for a LONG; $1.5 approved per-tx.
   `scripts/seed-swap.ts` (new; dry-run default, `--real` flag):
   **1.5 USDC → 1.499220530913 USDm**, tx
   `0x96b8d4f90996eee9d3c70d8d2f0f529e1acb2241ff0d15c48ed5c1a66bf2c776`
   (block 71798356, to = mainnet Broker, status success). Attribution
   decoded `{"codes":["bianca_markets"],"schemaId":0}` via new
   `scripts/verify-swap.ts`. Ledger `.state/risk-mainnet.json` fill carries
   `note: "manual seed (inventory for SHORT path), not signal-driven"` —
   risk.ts `Fill` gained an optional `note` field for exactly this.
   **Do not count this seed as organic signal-driven volume** in any
   Track 1 reporting; organic mainnet volume starts with the NEXT swap.
   Post-swap wallet: ~3.48 USDC + ~1.499 USDm + gas CELO.

Remaining for Phase 5: first ORGANIC (signal-driven) mainnet swap with
per-tx approval — both LONG and SHORT now executable; 8004scan activation;
Celo Builders submission.

## 2026-07-10 — 8004scan ACTIVATED (active + x402 support on-chain)

The agent is **Bianca Markets #9660** on the ERC-8004 Identity Registry
`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (Celo mainnet, verified
`IdentityRegistryUpgradeable` behind an ERC1967 proxy). Key findings:

- The "Agent is Active" / "x402 Payment Support" fields are NOT site
  toggles — 8004scan renders the registration JSON from `tokenURI(9660)`,
  which for this agent is a fully on-chain base64 `data:` URI. Updating it
  = `setAgentURI(uint256,string)` (selector `0x0af28bd3`) signed by the
  OWNER wallet `0x9bfb…09e9` (a third wallet — not the trading wallet, not
  the payTo wallet; it was empty and needed a CELO dust top-up first).
- Spec vs wizard casing: EIP-8004 says `x402Support`/`supportedTrust`;
  8004scan's own wizard emits `x402support`/`supportedTrusts` (verified by
  decoding neighbor agent #9661). The updated JSON carries BOTH x402
  casings deliberately.
- JSON changes (user-reviewed diff, approved): `active:true`,
  `x402support:true` + `x402Support:true`, `registrations[]` self-entry
  `eip155:42220:<registry>`, new `services[]` entry `{name:"wallet",
  endpoint:"eip155:42220:0xd16f…7D7E"}` (spec puts wallets in services or
  the on-chain `agentWallet` metadata key — the latter skipped for now),
  `supportedTrusts` renamed to spec `supportedTrust` (empty either way).
- Update tx (sent by user from the owner wallet):
  `0xc62d7cae268c67ac4041108478befe1749a7903fc9bb342edfc19a4f601d0230`
  — status success, block 71801569. Verified after: `tokenURI(9660)`
  decodes with all flags true; 8004scan's indexer re-indexed within
  minutes (`x402_supported: true`, list API
  `api.8004scan.io/api/v1/agents?chain=celo&search=bianca`). The list API
  has no `active` field — the profile badge renders from the JSON (now
  true); visually confirm at 8004scan.io/agents/celo/9660 (JS-rendered).

Also running: session-local hourly signal watch (cron at :07, dry-run
only, push-notifies on a tradeable signal ≥0.25 confidence — real sends
still require per-tx approval in chat).

Remaining for Phase 5: first ORGANIC signal-driven mainnet swap; Celo
Builders submission.

## 2026-07-10 — Celo Builders skill installed; ATTRIBUTION TAG discovery

`npx skills add https://celobuilders.xyz` (Vercel Labs skills CLI) installed
`.agents/skills/celo-builders/SKILL.md` (symlinked into `.claude/skills/`);
reviewed line-by-line, clean; installed copy sha256-matches the live
`celobuilders.xyz/skill.md`. Live hackathon: slug `agentic-payments-defai`,
ends **2026-07-20 09:00 UTC**, network restricted to `celo-mainnet`. Tracks:
`most-revenue-generated` ($2k/$1k), `most-x402-payments` ($700/$300, raw
count), plus optional partner tracks (askbots, aigora).

**CRITICAL:** registering (project name + GitHub repo + Telegram) assigns an
`attributionTag` (`celo_`+12hex, derived from the GitHub owner/repo slug,
LOCKED to the first saved repo URL). **The Dune leaderboard credits ONLY the
assigned tag — our self-chosen `bianca_markets` is NOT counted on its own.**
ERC-8021 suffixes carry multiple codes: after registration the swap engine
must emit `toDataSuffix(['bianca_markets', '<assignedTag>'])`. Counting
window is Jul 1–20 — every untagged day is uncounted volume, so register
EARLY. x402 settlements are facilitator-submitted (payer can't suffix them);
tracking there appears wallet-based via the `agentWalletAddress` submission
field (0xd16f…7D7E).

Submission fields (live API): `telegram` (registration-stage, required),
`socialLink` (X post URL, required), `erc8004Url`
(https://8004scan.io/agents/celo/9660), `agentWalletAddress`,
`celoNetwork` = `celo-mainnet` (only option), `appDomain` (optional),
aigora fields (optional, Track 4 only). Publish flow: connect via Google
sign-in + claim code → PUT /submissions/me (draft) → POST publish after
explicit approval.

Pre-registration blockers: public GitHub repo (repo has ZERO commits —
initial commit + push needed; repo slug determines the tag, choose once).

## 2026-07-11 — agentWallet fix prepped; launchd LIVE; multi-code engine

1. **8004scan "AGENT WALLET" mystery solved.** The field renders the
   registry's on-chain metadata key `agentWallet`, which `register()`
   auto-sets to the registering (owner) wallet — NOT the registration JSON
   (our `services[]` wallet entry is ignored for it). It is a RESERVED key:
   plain `setMetadata` reverts "reserved key"; the fix is
   `setAgentWallet(agentId, newWallet, deadline, signature)` sent by the
   OWNER, where `signature` is an EIP-712 `AgentWalletSet` proof from the
   NEW wallet (domain `ERC8004IdentityRegistry` v1, chain 42220, verifying
   contract = proxy) and `deadline` ≤ now+5min. Hackathon tracking does NOT
   use this field (leaderboard = assigned attributionTag + the submission's
   own `agentWalletAddress`); fixing is for correctness/8004scan score.
   `scripts/set-agent-wallet.ts` signs with the trading wallet key from
   `.env`, simulates from the owner, prints Celoscan Write-as-Proxy params
   AND raw calldata — re-run at send time (expires in ~4.5 min).
   **LANDED**: user sent via Celoscan, tx `0xa4cea3bb…fe5f53` (block
   71879903, success); `getAgentWallet(9660)` returns 0xd16f…7D7E and
   8004scan re-indexed within minutes.
2. **Hourly loop moved to launchd** (survives chat sessions/terminals).
   `ops/launchd/` plists installed to `~/Library/LaunchAgents/`:
   data-proxy (KeepAlive, RunAtLoad) + agent-cycle (:07 hourly). Both run
   prebuilt `dist/` directly (no unattended builds), WorkingDirectory =
   repo root (dotenv), logs `~/Library/Logs/bianca-markets/*.log`.
   Plist env pins CELO_NETWORK=mainnet (overrides `.env`'s sepolia) and
   DRY_RUN=true (agent job — hard pin; real swaps stay per-tx in chat).
   Verified: proxy settle-mode on 4021; kickstarted cycle settled 3/3
   mainnet x402 payments (FLAT signal, no trade). After code changes:
   `npm run build` + `launchctl kickstart -k gui/$UID/<label>`.
   Cost: ~0.36 USDC/day agent→payTo + ~$0.072/day facilitator credits;
   agent USDC (~3.4) ≈ 9 days runway — top-up pending.
3. **Swap engine emits multiple ERC-8021 codes** (24/24 tests):
   `ATTRIBUTION_CODE` env is now comma-separated → `ATTRIBUTION_CODES`;
   suffix = `toDataSuffix(codes)`.
4. **Celo Builders REGISTERED — assigned tag `celo_2f10863ce6f7`** (locked
   to repo slug Joel1508/Bianca-Markets). Draft saved: project "Bianca
   Markets", tracks most-revenue-generated + most-x402-payments, telegram
   @Joel28041. Connection credential in `.state/celobuilders-connection.json`
   (gitignored). `.env` now has
   `ATTRIBUTION_CODE=bianca_markets,celo_2f10863ce6f7`; verified the
   launchd-run dist picks it up at process start (config/dotenv imports
   before swap-engine — no rebuild/kickstart needed for .env changes; the
   long-running data-proxy doesn't use it). All swaps from now on carry
   BOTH codes. Publish still pending (needs X post link, 8004scan URL,
   agentWalletAddress = 0xd16f…7D7E per user decision, celo-mainnet) —
   only after explicit user approval, before 2026-07-20 09:00 UTC.

## 2026-07-11 (later) — RPC resilience after sleep/wake failures

The 15:07 and 16:07 UTC launchd cycles died on the startup `eth_blockNumber`
probe (timeout, then `fetch failed`) with zero x402 payments made. NOT Forno
rate limiting — `pmset -g log` showed the Mac was on battery, lid closed,
sleeping through both fire times; launchd coalesced the missed job and ran
it seconds after lid-open, before Wi-Fi was back. Fixes (31/31 tests):

- `packages/config/src/retry.ts` — `withRetries` (default 5 attempts /
  15s fixed backoff, injectable sleep for tests); agent wraps the startup
  RPC probe with it and logs each retry.
- `getRpcUrls()` + viem `fallback()` transport in both clients: Forno
  primary → `https://1rpc.io/celo` backup (probed: chain 42220, ~0.5s;
  dRPC was slow, publicnode dead). Overrides: `CELO_MAINNET_RPC_BACKUP` /
  `CELO_SEPOLIA_RPC_BACKUP` (sepolia has no default backup). Per-transport
  retryCount 3, timeout 15s.
- Rebuilt; both launchd jobs kickstarted on the new build — verified cycle:
  3/3 payments settled, FLAT, no trade.
- User accepts the residual risk: fully-asleep hours still skip (launchd
  can't wake the Mac); they run `sudo pmset -c sleep 0` and keep the Mac
  plugged in + lid open when the loop should run continuously.

## 2026-07-11 (evening) — x402 cycle failures: flapping local network; hardening shipped

From ~17:00 UTC, agent cycles began dying with proxy 502 `fetch failed`.
Investigation trail (each step disproving the previous theory): not launchd
(shell proxy failed identically), not the facilitator being down (settles
succeeded seconds before failures; /supported 200), not IPv6 ordering, not
config. Decisive evidence: interleaved sequential probes saw
api.x402.celo.org (DigitalOcean) AND forno.celo.org (Cloudflare) hang
SIMULTANEOUSLY while TradingView succeeded; hangs never complete (45s+);
failure rate oscillates 0%↔50% in waves. **Root cause: the local network
intermittently drops new outbound connections in bursts.** Parallel
request bursts made it look concurrency-related early on.

Hardening shipped (user-approved, 33/33 tests):
- `generateSignal` pulls the three sources SEQUENTIALLY (was Promise.all)
  — one paid request in flight at a time; test asserts max-in-flight = 1.
- `FacilitatorClient.verify` retries (3×, 2s) — read-only, safe.
  **`settle` is NEVER retried** (ambiguous failure + blind retry = possible
  double-charge; losing a cycle is the cheaper error). Both calls now have
  a 15s AbortSignal timeout so dead connections fail instead of hanging.
- Proxy retries `route.fetch()` upstream pulls (3×, 2s) so a blip doesn't
  waste an already-settled payment.

Verified during a bad wave: cycle settled gold + calendar (txs
0xd212c9b4…, 0x0ee971fe… — calendar also rode the TradingView→ForexFactory
fallback) before dying on /news — vs all-or-nothing before. Settled
payments still count on-chain for Track 2 even when the cycle dies; only
the signal is lost. Known gap (needs approval if wanted): the agent aborts
the cycle on the first failed endpoint — per-source fallback to direct
upstreams would let cycles complete through waves. Real fix is the
network itself (flapping started ~17:00 UTC; suggest router/Wi-Fi check,
ethernet, or different network to confirm).

## 2026-07-13 — facilitator relayer out of gas (external, no code fix)

Resumed after ~2 days away. 42 hourly cycles had fired: network flapping
from the prior incident continued a while then cleared (RPC/most endpoints
fine since); but for the last ~13 cycles EVERY one died identically on the
first paid pull (`/gold`, first in sequential order) with `HTTP 402:
Settlement failed: unexpected_error`. No LONG/SHORT signal ever appeared in
any of the 42 cycles — nothing was waiting on a trade approval.

Diagnosis (bypassed the proxy, called the facilitator directly): `/verify`
returns `isValid:true` (our signed EIP-3009 authorization is fully valid —
not our bug), but `/settle` returns `errorReason:"unexpected_error"` with
the real cause in `errorMessage`: **`insufficient funds for gas * price +
value: balance 17734755326363902, tx cost 34711295454932220`** — the
FACILITATOR's own relayer wallet is out of CELO gas (needs ~0.035 CELO,
has ~0.018). Confirmed sustained, not transient (identical balance 15s
later). Tested standalone: right now ALL THREE endpoints fail this way,
not just gold — the "always gold" pattern in the log is an artifact of
gold firing first and the cycle aborting on first failure.

**Nothing to fix in this repo** — our wallet is healthy (3.12 USDC, 22.4
CELO gas), our payloads are valid, the outage is 100% on
`api.x402.celo.org`'s infrastructure. Confirms the earlier no-retry-on-
settle decision was correct: retrying here would just burn attempts
against a permanently-empty relayer, never succeed. No public status page
or hackathon FAQ mentions this (checked). Recovery requires the
facilitator ops team to top up their relayer — cycles will resume
settling automatically once that happens, no changes needed on our side.
Worth flagging in the hackathon Telegram since every team routing x402
through this shared facilitator likely hits the same wall.

**Diagnostic signature for next time:** `/verify` succeeds + `/settle`
`errorMessage` contains "insufficient funds for gas" = facilitator-side
gas outage, not ours — check directly against `api.x402.celo.org` instead
of re-debugging the local stack.

## Standing rules

- Never ask for the private key in chat — local `.env` only (gitignored).
- Ask before any real on-chain transaction or wallet-touching install.
- `DRY_RUN=true` default; mainnet token addresses must be verified on
  celoscan.io before real swaps (Phase 4 gate).
