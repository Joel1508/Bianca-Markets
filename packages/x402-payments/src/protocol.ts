import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  X402Network,
} from './types.js';

export function encodeBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

export function decodeBase64Json<T>(header: string): T {
  return JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as T;
}

export const encodePaymentHeader = (p: PaymentPayload): string =>
  encodeBase64Json(p);
export const decodePaymentHeader = (h: string): PaymentPayload =>
  decodeBase64Json<PaymentPayload>(h);
export const encodePaymentResponseHeader = (s: SettleResponse): string =>
  encodeBase64Json(s);
export const decodePaymentResponseHeader = (h: string): SettleResponse =>
  decodeBase64Json<SettleResponse>(h);

/** Pick the requirement we can satisfy: exact scheme on the expected network. */
export function selectRequirement(
  accepts: PaymentRequirements[],
  network: X402Network,
): PaymentRequirements | undefined {
  return accepts.find((a) => a.scheme === 'exact' && a.network === network);
}
