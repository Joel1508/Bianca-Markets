import type { Address, Hex } from 'viem';

/** x402 v1 network identifiers used by Celo's facilitator. */
export type X402Network = 'celo' | 'celo-sepolia';

/** One entry of a 402 response's `accepts` array (x402 v1, "exact" scheme). */
export interface PaymentRequirements {
  scheme: 'exact';
  network: X402Network;
  /** price in the asset's atomic units, as a decimal string */
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: Address;
  maxTimeoutSeconds: number;
  asset: Address;
  /** EIP-712 domain of the asset (needed to sign the EIP-3009 authorization) */
  extra?: { name: string; version: string };
}

export interface ExactEvmAuthorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export interface ExactEvmPayload {
  signature: Hex;
  authorization: ExactEvmAuthorization;
}

/** Decoded X-PAYMENT header. */
export interface PaymentPayload {
  x402Version: 1;
  scheme: 'exact';
  network: X402Network;
  payload: ExactEvmPayload;
}

/** Body of a 402 Payment Required response. */
export interface PaymentRequiredBody {
  x402Version: 1;
  error: string;
  accepts: PaymentRequirements[];
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  invalidReasonDetails?: string;
  payer?: string;
}

export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  transaction?: Hex;
  network?: string;
  payer?: string;
}

/** Our record of one settled (or verified) x402 payment. */
export interface X402Receipt {
  url: string;
  /** atomic units of `asset` */
  amount: string;
  asset: Address;
  network: X402Network;
  /** present when the facilitator settled on-chain */
  txHash?: Hex;
  settledAt: string;
}

export interface PaidFetchResult<T> {
  data: T;
  /** undefined when the endpoint served the resource without payment (free/dev mode) */
  receipt?: X402Receipt;
}
