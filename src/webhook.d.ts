// Os tipos de ./webhook.js, escritos à mão para quem usa TypeScript.

export declare const SIGNATURE_HEADER: "Spolly-Signature";
export declare const EVENT_ID_HEADER: "Spolly-Event-Id";
export declare const EVENT_TYPE_HEADER: "Spolly-Event-Type";
export declare const DEFAULT_TOLERANCE_SECONDS: 300;

export declare const Reasons: Readonly<{
  NO_SECRET: "no_secret";
  NO_HEADER: "no_header";
  MALFORMED_HEADER: "malformed_header";
  NO_SIGNATURE: "no_signature";
  SIGNATURE_MISMATCH: "signature_mismatch";
  TIMESTAMP_OUTSIDE_TOLERANCE: "timestamp_outside_tolerance";
  INVALID_PAYLOAD: "invalid_payload";
}>;

export type Reason = (typeof Reasons)[keyof typeof Reasons];

export declare class WebhookVerificationError extends Error {
  constructor(code: Reason, detail?: string);
  readonly name: "WebhookVerificationError";
  readonly code: Reason;
  readonly detail: string;
}

export type EventType =
  | "checkout.session.expired"
  | "payment.failed"
  | "payment.succeeded"
  | "payout.failed"
  | "payout.paid"
  | "refund.created"
  | "subscription.cancelled"
  | "subscription.created"
  | "subscription.past_due"
  | "subscription.renewed";

/**
 * O envelope de um evento (contratos/eventos/envelope.schema.json). Os valores
 * de dinheiro dentro de `data.object` (`amount`, `unit_amount`) vêm em
 * `bigint`.
 */
export interface Event<T = Record<string, unknown>> {
  id: string;
  type: EventType | (string & {});
  created_at: string;
  mode: "test" | "live";
  merchant_id: string;
  /**
   * A aplicação do comerciante de onde o evento vem (a da chave de API ou do
   * link que criou a sessão), ou `null`. Só chega aos endpoints dessa aplicação.
   */
  application: string | null;
  api_version: string;
  data: { object: T };
}

export interface VerifyOptions {
  /** A diferença máxima entre o t e o relógio, em segundos. 300 por omissão. */
  toleranceSeconds?: number;
  /** O relógio, em milissegundos, como `Date.now`. */
  now?: () => number;
}

/** O corpo bruto: o texto ou os bytes tal como chegaram, nunca um objeto já lido. */
export type RawBody = string | Uint8Array;

export declare function verifySignature(payload: RawBody, header: string | null | undefined, secrets: string | string[], options?: VerifyOptions): void;

export declare function constructEvent<T = Record<string, unknown>>(
  payload: RawBody,
  header: string | null | undefined,
  secrets: string | string[],
  options?: VerifyOptions,
): Event<T>;

export declare function sign(payload: RawBody, secrets: string | string[], timestampSeconds?: number): string;
