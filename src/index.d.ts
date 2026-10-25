// Os tipos de ./index.js, escritos à mão para quem usa TypeScript. Seguem o
// contratos/openapi.yaml do super projeto.

export * from "./webhook.js";

export declare const VERSION: string;
export declare const DEFAULT_BASE_URL: "https://payments-api.spolly.ao";
export declare const DEFAULT_TIMEOUT_MS: number;
export declare const DEFAULT_MAX_RETRIES: number;
export declare const IDEMPOTENCY_KEY_HEADER: "Idempotency-Key";
export declare const IDEMPOTENT_REPLAYED_HEADER: "Idempotent-Replayed";

/** Um valor em unidades menores inteiras, à entrada: 15.000,00 Kz é `1500000n`. */
export type MinorUnits = bigint | number | string;

export type Currency = "AOA" | "USD" | "EUR" | "BRL";
/**
 * Os métodos de pagamento. `bank_transfer` e `direct_debit` existem só em AOA,
 * e só se oferecem quando a sessão os pede por nome em `payment_methods`.
 */
export type PaymentMethod = "mcx" | "reference" | "baipaga" | "card" | "pix" | "bank_transfer" | "direct_debit";
export declare const PaymentMethods: Readonly<{
  MCX: "mcx";
  REFERENCE: "reference";
  BAIPAGA: "baipaga";
  CARD: "card";
  PIX: "pix";
  BANK_TRANSFER: "bank_transfer";
  DIRECT_DEBIT: "direct_debit";
}>;
/** Como renova o ciclo seguinte: sozinho (cartão, débito direto) ou por aviso com o link. */
export type Renewal = "automatic" | "notice";
export declare const Renewals: Readonly<{ AUTOMATIC: "automatic"; NOTICE: "notice" }>;

/** Para onde foi o dinheiro de um pagamento: o saldo, ou a conta bancária do comerciante (a transferência). */
export type Settlement = "balance" | "merchant_account";
export declare const Settlements: Readonly<{ BALANCE: "balance"; MERCHANT_ACCOUNT: "merchant_account" }>;
export type Mode = "test" | "live";

/** Dinheiro como a API o devolve: `amount` em `bigint`, em unidades menores. */
export interface Money {
  amount: bigint;
  currency: Currency;
}

export interface LineItemParams {
  description: string;
  unit_amount: MinorUnits;
  quantity: number;
}

export interface LineItem {
  description: string;
  unit_amount: bigint;
  quantity: number;
}

export interface CustomerParams {
  email?: string;
  name?: string;
  /** Telemóvel angolano; a API guarda-o como 244XXXXXXXXX. */
  phone?: string;
}

export interface CheckoutSessionParams {
  /** Em unidades menores inteiras. Em AOA, múltiplo de 100. */
  amount: MinorUnits;
  currency: Currency;
  /** Obrigatória sem `line_items`. */
  description?: string;
  line_items?: LineItemParams[];
  /** Vazio aceita todos os que têm gateway na moeda e no modo. */
  payment_methods?: PaymentMethod[];
  /** O regresso não prova pagamento: confirma-se pelo webhook ou por `getCheckoutSession`. */
  success_url?: string;
  cancel_url?: string;
  metadata?: Record<string, string>;
  customer?: CustomerParams;
  /** A vida da sessão em segundos, de 900 a 86400. 24 horas por omissão. */
  expires_in?: number;
  /** "payment" por omissão, ou "subscription". */
  kind?: "payment" | "subscription";
  /** O plano de uma sessão "subscription": obrigatório nela, e recusado nas outras. */
  subscription?: SubscriptionPlan;
  /**
   * A comissão de uma plataforma que vende em nome do comerciante da chave: o
   * comerciante tem de a ter autorizado no painel, e o valor nunca passa o
   * máximo dele. Numa sessão "subscription", repete-se em cada renovação.
   */
  platform_fee?: PlatformFeeParams;
}

export interface PlatformFeeParams {
  /** O identificador de comerciante da plataforma (mer_...). */
  platform: string;
  /** Em unidades menores da moeda da sessão (em AOA, múltiplo de 100). */
  amount: MinorUnits;
}

/** A comissão de uma plataforma, como a API a devolve. */
export interface PlatformFee {
  platform: string;
  amount: bigint;
}

/** O objeto de um pagamento nos eventos `payment.succeeded` e `payment.failed`. */
export interface Payment {
  id: string;
  object: "payment";
  checkout_session_id: string;
  status: "succeeded" | "failed";
  amount: Money;
  /** A taxa do Spolly Payments. */
  fee: Money;
  /**
   * O que fica ao comerciante: `amount` menos `fee` e menos a comissão da plataforma, quando a há.
   * Com `settlement` `merchant_account`, o `amount` entrou na conta bancária dele e a `fee` sai do saldo.
   */
  net: Money;
  /** Para onde foi o dinheiro. */
  settlement: Settlement;
  method: PaymentMethod;
  failure_reason?: string;
  created_at: string;
  metadata: Record<string, string>;
  paid_after_expiry?: true;
  /** A comissão que a plataforma recebeu neste pagamento, ou null. */
  platform_fee: PlatformFee | null;
  /** Porque uma comissão pedida não se aplicou: o pagamento entrou sem ela. */
  platform_fee_skipped?: "authorization_revoked" | "above_maximum" | "exceeds_net";
  /**
   * A parte do `amount` que o comprador pagou por cima, quando o comerciante lhe passa a taxa
   * (no painel, em Aplicações): é igual à `fee`, e o `net` é o valor da cobrança. null quando a taxa sai do valor.
   */
  fee_on_top: Money | null;
}

export type SubscriptionInterval = "week" | "month" | "quarter" | "half_year" | "year";

export interface SubscriptionPlan {
  interval: SubscriptionInterval;
  /** Quantas vezes se cobra (até 1000). Sem ele, até alguém cancelar. */
  cycles?: number;
  /**
   * O valor do primeiro ciclo, quando é mais barato do que o `amount` da sessão
   * (um cupão que vale só no primeiro mês): o primeiro pagamento cobra-o, e as
   * renovações cobram o `amount`. Em AOA, múltiplo de 100.
   */
  first_cycle_amount?: MinorUnits;
}

export interface SessionSubscription {
  /** A subscrição (sub_...), ou null numa sessão ainda por pagar. */
  id: string | null;
  interval: SubscriptionInterval;
  cycles: number | null;
  /** O ciclo que uma sessão de renovação paga; null nas outras. */
  cycle: number | null;
  /** O valor do primeiro ciclo, quando é mais barato do que o `amount`, ou null. */
  first_cycle_amount: bigint | null;
}

export interface CheckoutSession {
  id: string;
  object: "checkout_session";
  mode: Mode;
  status: "open" | "complete" | "expired";
  /** O checkout alojado, para onde se manda o comprador. */
  url: string;
  amount: Money;
  description: string;
  line_items: LineItem[];
  payment_methods: PaymentMethod[];
  success_url: string | null;
  cancel_url: string | null;
  metadata: Record<string, string>;
  customer: { email: string; name: string; phone: string };
  expires_at: string;
  created_at: string;
  completed_at: string | null;
  /** O pagamento que completou a sessão: o `amount` que o comprador pagou, e a parte que foi a taxa por cima, ou null. */
  payment: { id: string; status: "succeeded"; method: PaymentMethod; amount: Money; fee_on_top: Money | null } | null;
  kind: "payment" | "subscription" | "renewal";
  /** O plano e a subscrição, numa sessão de subscrição ou de renovação; null numa de pagamento. */
  subscription: SessionSubscription | null;
  /** A aplicação do comerciante de onde a sessão vem (app_...), ou null. Os eventos dela levam-na em `application`. */
  application: string | null;
  /** A comissão da plataforma que a sessão pede, ou null. */
  platform_fee: PlatformFee | null;
  /**
   * O comprador paga a taxa do Spolly Payments por cima do `amount`: a escolha da aplicação da chave,
   * ou a global do comerciante, congelada quando a sessão nasceu. O comerciante fica com o `amount`.
   */
  fee_on_top: boolean;
}

export interface RefundParams {
  payment_id: string;
  /** Sem ele, estorna-se o que resta. */
  amount?: MinorUnits;
  reason?: string;
}

export interface Refund {
  id: string;
  object: "refund";
  payment_id: string;
  amount: Money;
  status: "processing" | "pending" | "succeeded" | "failed";
  reason: string;
  failure_reason?: string;
  created_at: string;
}

export interface Account {
  merchant_id: string;
  nome_comercial: string;
  modo: Mode;
}

export interface Subscription {
  id: string;
  object: "subscription";
  status: "active" | "past_due" | "cancelled" | "expired";
  /** O preço de cada ciclo; as renovações cobram-no sempre. */
  amount: Money;
  /** O que o primeiro ciclo custou, quando foi mais barato do que `amount`, ou null. */
  first_cycle_amount: Money | null;
  interval: SubscriptionInterval;
  /** Os ciclos contratados; null renova até ser cancelada. */
  cycles: number | null;
  /** O ciclo em vigor. O primeiro é o 1. */
  cycle: number;
  current_period_start: string;
  /** Até quando o ciclo em vigor está pago. */
  current_period_end: string;
  /** O método do próximo ciclo. */
  method: PaymentMethod;
  /** Como renova o ciclo seguinte: `automatic` (cartão, débito direto) ou `notice` (aviso com o link). */
  renewal: Renewal;
  cancel_at_period_end: boolean;
  cancelled_at?: string;
  cancelled_by?: "customer" | "merchant";
  ended_at?: string;
  end_reason?: "requested" | "unpaid" | "completed";
  checkout_session_id: string;
  latest_payment_id?: string;
  customer: { email: string; name: string; phone: string };
  metadata: Record<string, string>;
}

export interface CancelSubscriptionParams {
  /** true (por omissão) cancela no fim do ciclo pago; false cancela já. */
  at_period_end?: boolean;
}

export interface SubscriptionPortalLink {
  object: "subscription_portal";
  subscription: string;
  /** Abre uma vez, e expira. */
  url: string;
  expires_at: string;
}

export interface ClientOptions {
  /** O endereço da API. https://payments-api.spolly.ao por omissão. */
  baseURL?: string;
  /** O tempo limite de cada tentativa, em milissegundos. 30000 por omissão. */
  timeoutMs?: number;
  /** Quantas vezes se repete um pedido que falhou por uma razão passageira. 2 por omissão. */
  maxRetries?: number;
  /** Outro `fetch` (um proxy, um registo). */
  fetch?: typeof fetch;
  /** Um nome a acrescentar ao User-Agent, por exemplo "loja/1.4". */
  userAgent?: string;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface PostOptions extends RequestOptions {
  /** A Idempotency-Key deste POST. Sem ela, gera-se uma por chamada. */
  idempotencyKey?: string;
}

export declare class SpollyPayments {
  constructor(secretKey: string, options?: ClientOptions);
  createCheckoutSession(params: CheckoutSessionParams, options?: PostOptions): Promise<CheckoutSession>;
  getCheckoutSession(id: string, options?: RequestOptions): Promise<CheckoutSession>;
  createRefund(params: RefundParams, options?: PostOptions): Promise<Refund>;
  getRefund(id: string, options?: RequestOptions): Promise<Refund>;
  getAccount(options?: RequestOptions): Promise<Account>;
  getSubscription(id: string, options?: RequestOptions): Promise<Subscription>;
  cancelSubscription(id: string, params?: CancelSubscriptionParams, options?: PostOptions): Promise<Subscription>;
  createSubscriptionPortalLink(id: string, options?: PostOptions): Promise<SubscriptionPortalLink>;
}

export declare const ErrorCodes: Readonly<{
  INVALID_REQUEST: "pedido_invalido";
  IDEMPOTENCY_MISSING: "idempotencia_em_falta";
  IDEMPOTENCY_INVALID: "idempotencia_invalida";
  NO_KEY: "sem_chave";
  INVALID_KEY: "chave_invalida";
  SESSION_NOT_FOUND: "sessao_nao_existe";
  PAYMENT_NOT_FOUND: "pagamento_nao_existe";
  REFUND_NOT_FOUND: "estorno_nao_existe";
  SUBSCRIPTION_NOT_FOUND: "subscricao_nao_existe";
  PAYMENT_NOT_PAID: "pagamento_nao_pago";
  PAYMENT_ALREADY_REFUNDED: "pagamento_ja_estornado";
  PAID_TO_MERCHANT_ACCOUNT: "pago_na_conta_do_comerciante";
  SUBSCRIPTION_ENDED: "subscricao_terminada";
  INVALID_DATA: "dados_invalidos";
  IDEMPOTENCY_REUSED: "idempotencia_reutilizada";
  CURRENCY_WITHOUT_GATEWAY: "moeda_sem_gateway";
  METHOD_WITHOUT_GATEWAY: "metodo_sem_gateway";
  REFUND_EXCEEDS_CHARGED: "estorno_acima_do_cobrado";
  PLATFORM_NOT_AUTHORIZED: "plataforma_nao_autorizada";
  PLATFORM_FEE_ABOVE_MAXIMUM: "comissao_acima_do_maximo";
  PLATFORM_FEE_INVALID: "comissao_invalida";
  INTERNAL: "erro_interno";
  UNAVAILABLE: "indisponivel";
  UNREADABLE_ERROR: "resposta_ilegivel";
}>;

/** Uma recusa da API. */
export declare class SpollyError extends Error {
  readonly name: "SpollyError";
  /** O estado HTTP. */
  readonly status: number;
  /** O código estável, para o programa decidir (um dos `ErrorCodes`, ou outro mais novo). */
  readonly code: string;
  /** A explicação em português, para mostrar a uma pessoa. */
  readonly userMessage: string;
  /** Uma mensagem por campo, no 422 `dados_invalidos`. */
  readonly fields: Record<string, string>;
  /** A chave com que o POST foi feito; repetir com ela é seguro. */
  readonly idempotencyKey: string;
}

/** A API não respondeu depois de todas as tentativas. `cause` tem a falha da última. */
export declare class SpollyConnectionError extends Error {
  readonly name: "SpollyConnectionError";
}

/** Uma resposta de sucesso que não se conseguiu ler. */
export declare class SpollyInvalidResponseError extends Error {
  readonly name: "SpollyInvalidResponseError";
}

/** Lê JSON com `amount` e `unit_amount` em `bigint`, a partir do texto. */
export declare function parseJSON(text: string): unknown;

/** Uma Idempotency-Key nova (UUID v4). */
export declare function newIdempotencyKey(): string;

/** Diz se uma sessão está paga: completa, e com um pagamento confirmado. */
export declare function isPaid(session: CheckoutSession | null | undefined): boolean;
