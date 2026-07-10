import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CeloNetwork } from '@bianca/config';

/**
 * Pre-trade risk controls (Phase 3 hard rule): a per-trade position cap and
 * a daily realized-loss limit, both enforced BEFORE any swap fires. The
 * decision is computed — and logged by the caller — even in dry run; only
 * real fills are recorded in the ledger.
 */

export interface RiskConfig {
  /** hard cap per trade, USD */
  maxPositionUsd: number;
  /** once today's realized loss reaches this, no more trades until UTC midnight */
  dailyLossLimitUsd: number;
  /** JSON ledger path (per network) */
  stateFile: string;
}

export function loadRiskConfig(network: CeloNetwork): RiskConfig {
  return {
    maxPositionUsd: Number(process.env.MAX_POSITION_USD ?? 5),
    dailyLossLimitUsd: Number(process.env.DAILY_LOSS_LIMIT_USD ?? 10),
    stateFile: process.env.RISK_STATE_FILE ?? `.state/risk-${network}.json`,
  };
}

export interface RiskDecision {
  allowed: boolean;
  /** requested size after clamping to maxPositionUsd */
  sizeUsd: number;
  clamped: boolean;
  /** human-readable explanation of the decision */
  reasons: string[];
  dailyLossUsd: number;
}

interface Fill {
  time: string;
  txHash: string;
  amountInUsd: number;
  amountOutUsd: number;
  /** distinguishes non-organic fills (e.g. manual inventory seeding) from signal-driven trades */
  note?: string;
}

interface LedgerState {
  /** UTC day the ledger covers, YYYY-MM-DD */
  date: string;
  lossUsd: number;
  fills: Fill[];
}

export class RiskManager {
  constructor(
    readonly config: RiskConfig,
    /** injectable for tests */
    private readonly now: () => Date = () => new Date(),
  ) {}

  private today(): string {
    return this.now().toISOString().slice(0, 10);
  }

  private load(): LedgerState {
    const empty: LedgerState = { date: this.today(), lossUsd: 0, fills: [] };
    let state: LedgerState;
    try {
      state = JSON.parse(readFileSync(this.config.stateFile, 'utf8')) as LedgerState;
    } catch {
      return empty;
    }
    // New UTC day → losses reset
    return state.date === this.today() ? state : empty;
  }

  dailyLossUsd(): number {
    return this.load().lossUsd;
  }

  /** Clamp + gate a proposed trade. Never throws; the caller logs `reasons`. */
  evaluate(requestedUsd: number): RiskDecision {
    const { maxPositionUsd, dailyLossLimitUsd } = this.config;
    const dailyLossUsd = this.dailyLossUsd();
    const reasons: string[] = [];

    if (!Number.isFinite(requestedUsd) || requestedUsd <= 0) {
      return {
        allowed: false,
        sizeUsd: 0,
        clamped: false,
        dailyLossUsd,
        reasons: [`requested size $${requestedUsd} is not positive`],
      };
    }

    const clamped = requestedUsd > maxPositionUsd;
    const sizeUsd = clamped ? maxPositionUsd : requestedUsd;
    if (clamped) {
      reasons.push(`size clamped $${requestedUsd} → $${maxPositionUsd} (MAX_POSITION_USD)`);
    } else {
      reasons.push(`size $${sizeUsd} within per-trade cap $${maxPositionUsd}`);
    }

    if (dailyLossUsd >= dailyLossLimitUsd) {
      reasons.push(
        `daily loss $${dailyLossUsd.toFixed(4)} ≥ limit $${dailyLossLimitUsd} — trading halted until UTC midnight`,
      );
      return { allowed: false, sizeUsd, clamped, dailyLossUsd, reasons };
    }
    reasons.push(`daily loss $${dailyLossUsd.toFixed(4)} < limit $${dailyLossLimitUsd}`);
    return { allowed: true, sizeUsd, clamped, dailyLossUsd, reasons };
  }

  /**
   * Record a REAL fill (never called in dry run). Both sides valued in USD;
   * for stable/stable swaps out < in ⇒ the difference (fees/slippage) counts
   * toward the daily loss.
   */
  recordFill(fill: Fill): LedgerState {
    const state = this.load();
    state.fills.push(fill);
    state.lossUsd += Math.max(0, fill.amountInUsd - fill.amountOutUsd);
    mkdirSync(dirname(this.config.stateFile), { recursive: true });
    writeFileSync(this.config.stateFile, JSON.stringify(state, null, 2));
    return state;
  }
}
