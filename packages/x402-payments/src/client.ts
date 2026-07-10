import { toHex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { CHAINS, type CeloNetwork } from '@bianca/config';
import { X402_NETWORK_NAMES } from './facilitator.js';
import {
  decodePaymentResponseHeader,
  encodePaymentHeader,
  selectRequirement,
} from './protocol.js';
import type {
  PaidFetchResult,
  PaymentPayload,
  PaymentRequiredBody,
  PaymentRequirements,
  X402Receipt,
} from './types.js';

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/**
 * x402 buyer: fetch, and on 402 sign an EIP-3009 transferWithAuthorization
 * for the quoted price and retry with the X-PAYMENT header. Signing spends
 * the stablecoin (gaslessly — the facilitator submits the transfer), so this
 * client only ever runs when the user has configured PRIVATE_KEY.
 */
export class X402Client {
  constructor(
    private readonly account: PrivateKeyAccount,
    private readonly network: CeloNetwork,
  ) {}

  get address(): string {
    return this.account.address;
  }

  async paidFetch<T>(url: string): Promise<PaidFetchResult<T>> {
    const first = await fetch(url, { headers: { Accept: 'application/json' } });
    if (first.ok) {
      // endpoint is running in free mode
      return { data: (await first.json()) as T };
    }
    if (first.status !== 402) {
      throw new Error(`${url} → HTTP ${first.status}: ${await safeText(first)}`);
    }

    const body = (await first.json()) as PaymentRequiredBody;
    const wanted = X402_NETWORK_NAMES[this.network];
    const req = selectRequirement(body.accepts ?? [], wanted);
    if (!req) {
      throw new Error(
        `${url} offers no exact/${wanted} payment option (accepts: ${JSON.stringify(body.accepts)})`,
      );
    }

    const payment = await this.signPayment(req);
    const second = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-PAYMENT': encodePaymentHeader(payment),
      },
    });
    if (!second.ok) {
      throw new Error(
        `${url} rejected payment (HTTP ${second.status}): ${await safeText(second)}`,
      );
    }

    const receipt: X402Receipt = {
      url,
      amount: req.maxAmountRequired,
      asset: req.asset,
      network: req.network,
      settledAt: new Date().toISOString(),
    };
    const respHeader = second.headers.get('X-PAYMENT-RESPONSE');
    if (respHeader) {
      try {
        receipt.txHash = decodePaymentResponseHeader(respHeader).transaction;
      } catch {
        // header present but unparseable — keep receipt without txHash
      }
    }
    return { data: (await second.json()) as T, receipt };
  }

  private async signPayment(
    req: PaymentRequirements,
  ): Promise<PaymentPayload> {
    if (!req.extra?.name || !req.extra?.version) {
      throw new Error(
        'Payment requirements missing EIP-712 domain (extra.name/version)',
      );
    }
    const now = Math.floor(Date.now() / 1000);
    const validAfter = BigInt(now - 300);
    const validBefore = BigInt(now + Math.max(req.maxTimeoutSeconds, 120));
    const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const value = BigInt(req.maxAmountRequired);

    const signature = await this.account.signTypedData({
      domain: {
        name: req.extra.name,
        version: req.extra.version,
        chainId: CHAINS[this.network].id,
        verifyingContract: req.asset,
      },
      types: EIP3009_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: {
        from: this.account.address,
        to: req.payTo,
        value,
        validAfter,
        validBefore,
        nonce,
      },
    });

    return {
      x402Version: 1,
      scheme: 'exact',
      network: req.network,
      payload: {
        signature,
        authorization: {
          from: this.account.address,
          to: req.payTo,
          value: value.toString(),
          validAfter: validAfter.toString(),
          validBefore: validBefore.toString(),
          nonce,
        },
      },
    };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '(no body)';
  }
}
