import type { Address } from 'viem';
import type { FacilitatorClient } from './facilitator.js';
import {
  decodePaymentHeader,
  encodePaymentResponseHeader,
} from './protocol.js';
import type {
  PaymentRequiredBody,
  PaymentRequirements,
  X402Network,
} from './types.js';

export interface X402GateOptions {
  network: X402Network;
  payTo: Address;
  asset: { address: Address; decimals: number };
  /** EIP-712 domain of the asset, forwarded to buyers via `extra` */
  assetDomain: { name: string; version: string };
  priceUsd: number;
  facilitator: FacilitatorClient;
}

export type GateResult =
  | { ok: true; paymentResponseHeader?: string; settledTx?: string }
  | { ok: false; status: 402; body: PaymentRequiredBody };

export function requirementsFor(
  resource: string,
  description: string,
  opts: X402GateOptions,
): PaymentRequirements {
  const atomic = BigInt(
    Math.round(opts.priceUsd * 10 ** opts.asset.decimals),
  ).toString();
  return {
    scheme: 'exact',
    network: opts.network,
    maxAmountRequired: atomic,
    resource,
    description,
    mimeType: 'application/json',
    payTo: opts.payTo,
    maxTimeoutSeconds: 120,
    asset: opts.asset.address,
    extra: { ...opts.assetDomain },
  };
}

function paymentRequired(
  error: string,
  requirements: PaymentRequirements,
): GateResult {
  return {
    ok: false,
    status: 402,
    body: { x402Version: 1, error, accepts: [requirements] },
  };
}

/**
 * Seller-side x402 check for one request. Verifies the X-PAYMENT header via
 * the facilitator and settles it on-chain when the facilitator API key is
 * configured; without the key it verifies only (payment provably signed and
 * funded, but not settled — dev mode, doesn't count for Track 2).
 */
export async function gateRequest(
  paymentHeader: string | undefined,
  requirements: PaymentRequirements,
  opts: X402GateOptions,
): Promise<GateResult> {
  if (!paymentHeader) {
    return paymentRequired('Payment required', requirements);
  }

  let payload;
  try {
    payload = decodePaymentHeader(paymentHeader);
  } catch {
    return paymentRequired('Malformed X-PAYMENT header', requirements);
  }

  const verdict = await opts.facilitator.verify(payload, requirements);
  if (!verdict.isValid) {
    return paymentRequired(
      `Invalid payment: ${verdict.invalidReason ?? 'unknown'}${
        verdict.invalidReasonDetails ? ` (${verdict.invalidReasonDetails})` : ''
      }`,
      requirements,
    );
  }

  if (!opts.facilitator.canSettle) {
    return { ok: true }; // verify-only dev mode
  }

  const settlement = await opts.facilitator.settle(payload, requirements);
  if (!settlement.success) {
    return paymentRequired(
      `Settlement failed: ${settlement.errorReason ?? 'unknown'}`,
      requirements,
    );
  }
  return {
    ok: true,
    paymentResponseHeader: encodePaymentResponseHeader(settlement),
    settledTx: settlement.transaction,
  };
}
