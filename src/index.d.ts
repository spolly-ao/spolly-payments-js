// Os tipos de ./index.js, escritos à mão para quem usa TypeScript. Seguem o
// contratos/openapi.yaml do super projeto.

export * from "./webhook.js";

export declare const VERSION: string;
export declare const DEFAULT_BASE_URL: "https://payments-api.spolly.ao";
export declare const DEFAULT_TIMEOUT_MS: number;
export declare const DEFAULT_MAX_RETRIES: number;
export declare const IDEMPOTENCY_KEY_HEADER: "Idempotency-Key";
export declare const IDEMPOTENT_REPLAYED_HEADER: "Idempotent-Replayed";
/** O cabeçalho com que uma plataforma age em nome de uma conta ligada dela. */
export declare const ACCOUNT_HEADER: "Spolly-Account";

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
  /**
   * O código (ou o cpn_...) de um cupão a aplicar já. Um que não se aplica é
   * `cupao_invalido` (422). Não vai com `allow_promotion_codes`, nem com o
   * `first_cycle_amount` de uma subscrição.
   */
  coupon?: string;
  /** O comprador pode escrever um código de desconto no checkout. */
  allow_promotion_codes?: boolean;
}

export type CouponDuration = "once" | "repeating" | "forever";

/** O cupão como estava quando se aplicou a uma sessão ou a um pagamento. */
export interface SessionCoupon {
  id: string;
  code: string;
  name: string;
  percent_off: number | null;
  amount_off: Money | null;
  duration: CouponDuration;
  duration_cycles: number | null;
}

/**
 * O desconto de um cupão: o cupão e quanto desconta. Numa sessão, o `amount`
 * dela é o preço antes do desconto; o `amount` de um pagamento é já o valor
 * depois dele, e a taxa é sobre esse.
 */
export interface Discount {
  coupon: SessionCoupon;
  amount: Money;
}

/**
 * O cupão de uma subscrição: o ciclo n paga `amount` menos `discount.amount`
 * enquanto n for menor ou igual a `cycles`; `cycles` null quer dizer todos.
 */
export interface SubscriptionDiscount {
  coupon: { id: string; code: string };
  amount: Money;
  cycles: number | null;
}

export interface CouponParams {
  /** Letras, números, - e _, de 3 a 40; guarda-se em maiúsculas, único por comerciante e modo. */
  code: string;
  name?: string;
  /** De 1 a 99. Ou isto, ou `amount_off` com `currency`. */
  percent_off?: number;
  /** Em unidades menores. Em AOA, múltiplo de 100. Só vale na `currency`. */
  amount_off?: MinorUnits;
  currency?: Currency;
  /** Numa subscrição: o primeiro ciclo, os primeiros `duration_cycles`, ou todos. */
  duration: CouponDuration;
  /** Obrigatório no `repeating`, e só nele: de 2 a 1000. */
  duration_cycles?: number;
  max_redemptions?: number;
  /** No futuro. */
  expires_at?: string;
  metadata?: Record<string, string>;
}

export interface CouponUpdateParams {
  name?: string;
  /** null tira o limite; nunca abaixo de `times_redeemed`. */
  max_redemptions?: number | null;
  /** null tira a data de fim. */
  expires_at?: string | null;
  /** false desativa: deixa de se aplicar, e quem já o tem fica com ele. */
  active?: boolean;
  metadata?: Record<string, string>;
}

export interface ListCouponsParams {
  /** De 1 a 100; 20 por omissão. */
  limit?: number;
  /** O `id` do último cupão da página anterior. */
  starting_after?: string;
  /** Só o cupão com este código (sem distinguir maiúsculas). */
  code?: string;
}

export interface Coupon {
  id: string;
  object: "coupon";
  mode: Mode;
  code: string;
  name: string;
  percent_off: number | null;
  amount_off: Money | null;
  duration: CouponDuration;
  duration_cycles: number | null;
  max_redemptions: number | null;
  /** As sessões pagas com o cupão. O limite conta também as abertas que ainda se podem pagar. */
  times_redeemed: number;
  expires_at: string | null;
  active: boolean;
  /** Ativo, dentro da data, e com usos por gastar. */
  valid: boolean;
  metadata: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface PlatformFeeParams {
  /**
   * O identificador de comerciante da plataforma (mer_...). Num cliente de
   * `withAccount`, pode ficar de fora: a plataforma é a da chave.
   */
  platform?: string;
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
  /** O cupão com que se pagou e quanto descontou, ou null. O `amount` é já o valor depois dele. */
  discount: Discount | null;
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
  /**
   * O cupão aplicado e quanto desconta, ou null. O `amount` da sessão é sempre o preço antes dele:
   * o checkout cobra `amount` menos `discount.amount`. Numa renovação, é o desconto deste ciclo.
   */
  discount: Discount | null;
  /** O comprador pode escrever um código de desconto no checkout. */
  allow_promotion_codes: boolean;
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
  /** O cupão da subscrição, ou null: o desconto de cada ciclo que cobre, e quantos. */
  discount: SubscriptionDiscount | null;
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

/** Uma lista da API: uma página de objetos, e se há mais depois dela. */
export interface List<T> {
  object: "list";
  data: T[];
  has_more: boolean;
}

/** Os dados de uma conta ligada: no `createAccount` o `name` é obrigatório, no `updateAccount` nenhum é. */
export interface ConnectedAccountParams {
  /** O nome que o comprador vê no checkout, até 120 carateres. */
  name?: string;
  /** O nome legal do titular, tal como no documento de identificação. */
  legal_name?: string;
  /** O NIF, se o houver (9 a 14 letras e dígitos). */
  tax_id?: string;
  email?: string;
  phone?: string;
  /** O id do vendedor do lado da plataforma, único por plataforma e modo. */
  reference?: string;
  /** Até 20 chaves; no `updateAccount`, substitui os metadados todos. */
  metadata?: Record<string, string>;
}

export interface CreateConnectedAccountParams extends ConnectedAccountParams {
  name: string;
}

export interface ListConnectedAccountsParams {
  /** De 1 a 100; 20 por omissão. */
  limit?: number;
  /** O `id` da última conta da página anterior. */
  starting_after?: string;
  /** Só a conta com esta referência. */
  reference?: string;
}

export type DocumentType = "identity_document" | "bank_account_proof";
export declare const DocumentTypes: Readonly<{ IDENTITY_DOCUMENT: "identity_document"; BANK_ACCOUNT_PROOF: "bank_account_proof" }>;

export interface UploadDocumentParams {
  type: DocumentType;
  /** O ficheiro, em PDF, JPEG ou PNG, até 10 MiB. O tipo reconhece-se pelo conteúdo. */
  file: Blob | Uint8Array | ArrayBuffer;
  /** O nome do ficheiro; sem ele, o de um `File`, ou "documento". */
  filename?: string;
}

/** Um documento da verificação de uma conta ligada. */
export interface AccountDocument {
  id: string;
  object: "account_document";
  type: DocumentType | "other";
  file_name: string;
  content_type: string;
  size: number;
  created_at: string;
}

export interface BankAccountParams {
  /** O IBAN angolano (AO06...), com ou sem espaços. */
  iban: string;
  /** O titular, tal como no comprovativo do banco. */
  holder: string;
  /** O NIF do titular, quando o nome não bate letra a letra com o `legal_name`. */
  holder_tax_id?: string;
  /** Um documento `bank_account_proof` desta conta (doc_...). */
  proof_document: string;
}

export type VerificationStatus = "pending" | "in_review" | "verified" | "rejected" | "more_documents";

/** Uma conta ligada: um vendedor da plataforma, criado e gerido por ela pela API. */
export interface ConnectedAccount {
  id: string;
  object: "account";
  /** O modo da chave que a criou. Uma conta ligada vive num modo só. */
  mode: Mode;
  name: string;
  legal_name: string;
  tax_id: string;
  email: string;
  phone: string;
  reference: string;
  metadata: Record<string, string>;
  verification: {
    status: VerificationStatus;
    /** O motivo da equipa, em `rejected` e `more_documents`. */
    reason: string;
    /** O que falta entregar para a verificação seguir sozinha para análise. */
    missing: Array<"legal_name" | "identity_document" | "bank_account">;
  };
  bank_account: {
    id: string;
    iban_last4: string;
    holder: string;
    /** Um IBAN mudado depois da verificação fica `pending_verification`, e a conta não saca até lá. */
    status: "verified" | "pending_verification";
    created_at: string;
  } | null;
  documents: AccountDocument[];
  /** Se a plataforma pode cobrar em nome da conta. */
  charges_enabled: boolean;
  /** Se a conta pode sacar: verificada, com a conta bancária verificada. */
  payouts_enabled: boolean;
  created_at: string;
}

/** Dinheiro com sinal: um saldo pode ser negativo. `amount` em `bigint`, em unidades menores. */
export interface SignedMoney {
  amount: bigint;
  currency: Currency;
}

/** O saldo de uma conta, por moeda, lido do livro. */
export interface Balance {
  object: "balance";
  account: string;
  /** O que se pode sacar. */
  available: SignedMoney[];
  /** O que ainda não foi libertado. */
  pending: SignedMoney[];
  /** A reserva. */
  reserved: SignedMoney[];
}

export interface PayoutParams {
  /** Em unidades menores; em AOA, kwanzas inteiros (múltiplo de 100). Mínimo 5.000 Kz. */
  amount: MinorUnits;
  currency?: "AOA";
  metadata?: Record<string, string>;
}

export type PayoutStatus = "pending" | "processing" | "paid" | "failed";

/** Um saque do saldo disponível para a conta bancária verificada. */
export interface Payout {
  id: string;
  object: "payout";
  amount: Money;
  /** `pending` (pedido), `processing` (aprovado, à espera da transferência), `paid` ou `failed`. */
  status: PayoutStatus;
  /** Só num saque recusado: o motivo da equipa. */
  failure_reason?: string;
  paid_at?: string;
  created_at: string;
  metadata?: Record<string, string>;
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
  createCoupon(params: CouponParams, options?: PostOptions): Promise<Coupon>;
  listCoupons(params?: ListCouponsParams, options?: RequestOptions): Promise<List<Coupon>>;
  getCoupon(id: string, options?: RequestOptions): Promise<Coupon>;
  updateCoupon(id: string, params: CouponUpdateParams, options?: RequestOptions): Promise<Coupon>;
  getAccount(options?: RequestOptions): Promise<Account>;
  getSubscription(id: string, options?: RequestOptions): Promise<Subscription>;
  cancelSubscription(id: string, params?: CancelSubscriptionParams, options?: PostOptions): Promise<Subscription>;
  createSubscriptionPortalLink(id: string, options?: PostOptions): Promise<SubscriptionPortalLink>;

  /**
   * Um cliente igual a este que manda `Spolly-Account` em cada pedido, e age em
   * nome dessa conta ligada. As operações de `/v1/accounts` nunca o mandam.
   */
  withAccount(accountId: string): SpollyPayments;
  /** A conta ligada em nome de quem este cliente age, ou `null`. */
  readonly account: string | null;

  createAccount(params: CreateConnectedAccountParams, options?: PostOptions): Promise<ConnectedAccount>;
  listAccounts(params?: ListConnectedAccountsParams, options?: RequestOptions): Promise<List<ConnectedAccount>>;
  getConnectedAccount(id: string, options?: RequestOptions): Promise<ConnectedAccount>;
  updateAccount(id: string, params: ConnectedAccountParams, options?: RequestOptions): Promise<ConnectedAccount>;
  uploadAccountDocument(id: string, params: UploadDocumentParams, options?: PostOptions): Promise<AccountDocument>;
  setAccountBankAccount(id: string, params: BankAccountParams, options?: RequestOptions): Promise<ConnectedAccount>;
  getAccountBalance(id: string, options?: RequestOptions): Promise<Balance>;
  createAccountPayout(id: string, params: PayoutParams, options?: PostOptions): Promise<Payout>;
  listAccountPayouts(id: string, options?: RequestOptions): Promise<List<Payout>>;
  getAccountPayout(id: string, payoutId: string, options?: RequestOptions): Promise<Payout>;
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
  CONNECTED_ACCOUNTS_NOT_ENABLED: "contas_ligadas_nao_habilitadas";
  ACCOUNT_HEADER_NOT_ALLOWED: "spolly_account_nao_serve_aqui";
  ACCOUNT_OTHER_MODE: "conta_de_outro_modo";
  ACCOUNT_NOT_FOUND: "conta_nao_existe";
  PAYOUT_NOT_FOUND: "saque_nao_existe";
  REFERENCE_TAKEN: "referencia_repetida";
  VERIFICATION_LOCKED: "verificacao_nao_deixa";
  TOO_MANY_DOCUMENTS: "documentos_demais";
  ACCOUNT_NOT_VERIFIED: "conta_por_verificar";
  BANK_ACCOUNT_NOT_VERIFIED: "conta_bancaria_por_verificar";
  NEGATIVE_BALANCE: "saldo_negativo";
  INSUFFICIENT_BALANCE: "saldo_insuficiente";
  PAYOUT_REFUSED: "saque_recusado";
  COUPON_NOT_FOUND: "cupao_nao_existe";
  COUPON_CODE_TAKEN: "codigo_repetido";
  COUPON_INVALID: "cupao_invalido";
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
