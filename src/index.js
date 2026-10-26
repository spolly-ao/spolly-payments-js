// O cliente em JavaScript da API do Spolly Payments: criar e ler sessões de
// checkout, estornar, confirmar a conta da chave, e, numa plataforma com as
// contas ligadas habilitadas, criar e gerir os vendedores que vendem por ela.
// As mesmas operações e os mesmos nomes do SDK em Go (spolly-payments-go). A
// verificação da assinatura dos webhooks está em ./webhook.js, e reexporta-se
// aqui.
//
// O que o cliente faz sozinho:
//
// - Idempotência: todos os POST levam Idempotency-Key. Sem `idempotencyKey`,
//   gera-se uma (crypto.randomUUID) por chamada, e usa-se a mesma em todas as
//   retentativas dessa chamada.
// - Retentativas: com falha de rede, tempo esgotado, 429, 500, 502, 503 ou 504,
//   volta a tentar até `maxRetries` vezes (2 por omissão), com espera
//   exponencial e aleatória, e respeita o Retry-After. Um 4xx nunca se repete.
// - Tempo limite: 30 segundos por tentativa (`timeoutMs`); o `signal` de quem
//   chama manda sobre tudo.
// - Contas ligadas: `withAccount("mer_...")` devolve um cliente que manda o
//   cabeçalho Spolly-Account em cada pedido, e age em nome dessa conta. As
//   rotas /v1/accounts nunca o levam: a conta vai no caminho.
//
// Dinheiro: os campos `amount` e `unit_amount` chegam como `bigint`, lidos do
// texto da resposta sem passar por um `number`, e aceitam-se como `bigint`,
// como `number` inteiro seguro, ou como texto só com algarismos.

import { randomUUID } from "node:crypto";

import { paraJSON, parseJSON } from "./json.js";

export { parseJSON } from "./json.js";
export { constructEvent, verifySignature, sign, WebhookVerificationError, Reasons, SIGNATURE_HEADER, EVENT_ID_HEADER, EVENT_TYPE_HEADER, DEFAULT_TOLERANCE_SECONDS } from "./webhook.js";

/** A versão deste SDK, que vai no User-Agent. */
export const VERSION = "0.8.0";

/** A API de produção. As chaves sk_test_ também a usam: o modo é o da chave. */
export const DEFAULT_BASE_URL = "https://payments-api.spolly.ao";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 2;
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
export const IDEMPOTENT_REPLAYED_HEADER = "Idempotent-Replayed";
/** O cabeçalho com que uma plataforma age em nome de uma conta ligada dela. */
export const ACCOUNT_HEADER = "Spolly-Account";

const ESPERA_BASE_MS = 500;
const ESPERA_MAXIMA_MS = 8_000;
const RETRY_AFTER_MAXIMO_MS = 30_000;
const REPETIVEIS = new Set([429, 500, 502, 503, 504]);

/**
 * Os métodos de pagamento. A transferência bancária e o débito direto existem
 * só em AOA, e só se oferecem quando a sessão os pede por nome em
 * `payment_methods`: uma lista vazia não os inclui.
 */
export const PaymentMethods = Object.freeze({
  MCX: "mcx",
  REFERENCE: "reference",
  BAIPAGA: "baipaga",
  CARD: "card",
  PIX: "pix",
  BANK_TRANSFER: "bank_transfer",
  DIRECT_DEBIT: "direct_debit",
});

/**
 * Como renova o ciclo seguinte de uma subscrição: `automatic` cobra-se sozinho
 * (o cartão e o débito direto); `notice` manda o aviso com o link do ciclo.
 */
export const Renewals = Object.freeze({
  AUTOMATIC: "automatic",
  NOTICE: "notice",
});

/**
 * Para onde foi o dinheiro de um pagamento (o `settlement` do objeto `payment`
 * dos eventos): `balance`, o saldo do comerciante no Spolly Payments;
 * `merchant_account`, a conta bancária do comerciante (a transferência
 * bancária, que ele confirma no painel; a taxa sai do saldo dele).
 */
export const Settlements = Object.freeze({
  BALANCE: "balance",
  MERCHANT_ACCOUNT: "merchant_account",
});

/** Os documentos que uma plataforma entrega para a verificação de uma conta ligada. */
export const DocumentTypes = Object.freeze({
  /** O documento de identificação do titular: bilhete de identidade ou passaporte. */
  IDENTITY_DOCUMENT: "identity_document",
  /** O comprovativo do IBAN, emitido pelo banco. */
  BANK_ACCOUNT_PROOF: "bank_account_proof",
});

/** Os códigos de erro da API (o campo `erro` do corpo), estáveis. */
export const ErrorCodes = Object.freeze({
  INVALID_REQUEST: "pedido_invalido",
  IDEMPOTENCY_MISSING: "idempotencia_em_falta",
  IDEMPOTENCY_INVALID: "idempotencia_invalida",
  NO_KEY: "sem_chave",
  INVALID_KEY: "chave_invalida",
  SESSION_NOT_FOUND: "sessao_nao_existe",
  PAYMENT_NOT_FOUND: "pagamento_nao_existe",
  REFUND_NOT_FOUND: "estorno_nao_existe",
  SUBSCRIPTION_NOT_FOUND: "subscricao_nao_existe",
  PAYMENT_NOT_PAID: "pagamento_nao_pago",
  PAYMENT_ALREADY_REFUNDED: "pagamento_ja_estornado",
  /** O pagamento foi uma transferência direta para a conta do comerciante: não se estorna pela API (409). */
  PAID_TO_MERCHANT_ACCOUNT: "pago_na_conta_do_comerciante",
  SUBSCRIPTION_ENDED: "subscricao_terminada",
  INVALID_DATA: "dados_invalidos",
  IDEMPOTENCY_REUSED: "idempotencia_reutilizada",
  CURRENCY_WITHOUT_GATEWAY: "moeda_sem_gateway",
  METHOD_WITHOUT_GATEWAY: "metodo_sem_gateway",
  REFUND_EXCEEDS_CHARGED: "estorno_acima_do_cobrado",
  /** A sessão pede `platform_fee`, e o comerciante da chave não autorizou essa plataforma (403). */
  PLATFORM_NOT_AUTHORIZED: "plataforma_nao_autorizada",
  /** A comissão da plataforma passa o máximo que o comerciante autorizou (422). */
  PLATFORM_FEE_ABOVE_MAXIMUM: "comissao_acima_do_maximo",
  /** A comissão é zero, negativa, da própria plataforma, deixava o comerciante sem líquido, ou vinha com `bank_transfer` (422). */
  PLATFORM_FEE_INVALID: "comissao_invalida",
  /** A conta da chave não tem as contas ligadas habilitadas (403). */
  CONNECTED_ACCOUNTS_NOT_ENABLED: "contas_ligadas_nao_habilitadas",
  /** O cabeçalho Spolly-Account numa rota de /v1/accounts, onde a conta vai no caminho (400). */
  ACCOUNT_HEADER_NOT_ALLOWED: "spolly_account_nao_serve_aqui",
  /** A conta do Spolly-Account foi criada com uma chave do outro modo (403). */
  ACCOUNT_OTHER_MODE: "conta_de_outro_modo",
  /** A conta ligada não existe nesta plataforma, neste modo (404). */
  ACCOUNT_NOT_FOUND: "conta_nao_existe",
  /** O saque não existe nesta conta ligada (404). */
  PAYOUT_NOT_FOUND: "saque_nao_existe",
  /** Já há uma conta ligada desta plataforma, neste modo, com esta referência (409). */
  REFERENCE_TAKEN: "referencia_repetida",
  /** A verificação da conta não deixa mudar isto agora: está em análise, ou já aprovada (409). */
  VERIFICATION_LOCKED: "verificacao_nao_deixa",
  /** A conta ligada já tem o máximo de documentos (409). */
  TOO_MANY_DOCUMENTS: "documentos_demais",
  /** A conta ligada ainda não está verificada: não saca, e em produção não se cobra em nome dela (409, 403). */
  ACCOUNT_NOT_VERIFIED: "conta_por_verificar",
  /** A conta bancária da conta ligada ainda não está verificada (409). */
  BANK_ACCOUNT_NOT_VERIFIED: "conta_bancaria_por_verificar",
  /** A conta tem saldo negativo, e não saca até o cobrir (409). */
  NEGATIVE_BALANCE: "saldo_negativo",
  /** O valor do saque passa o saldo disponível (409). */
  INSUFFICIENT_BALANCE: "saldo_insuficiente",
  /** O saque não pode ser feito (403). */
  PAYOUT_REFUSED: "saque_recusado",
  INTERNAL: "erro_interno",
  UNAVAILABLE: "indisponivel",
  /** Posto pelo SDK: a API respondeu com um erro cujo corpo não se lê. */
  UNREADABLE_ERROR: "resposta_ilegivel",
});

/** Uma recusa da API: o estado HTTP, o código estável e a mensagem em português. */
export class SpollyError extends Error {
  /**
   * @param {{ status: number, code: string, message: string, fields?: Record<string, string>, idempotencyKey?: string }} d
   */
  constructor({ status, code, message, fields = {}, idempotencyKey = "" }) {
    const porCampo = Object.keys(fields)
      .sort()
      .map((k) => `; ${k}: ${fields[k]}`)
      .join("");
    super(`spolly: ${status} ${code}: ${message}${porCampo}`);
    this.name = "SpollyError";
    this.status = status;
    this.code = code;
    /** A explicação em português, para mostrar a uma pessoa. */
    this.userMessage = message;
    this.fields = fields;
    this.idempotencyKey = idempotencyKey;
  }
}

/** A API não respondeu (rede, tempo esgotado) depois de todas as tentativas. */
export class SpollyConnectionError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "SpollyConnectionError";
  }
}

/** Uma resposta de sucesso que não se conseguiu ler. Nunca vira um objeto vazio. */
export class SpollyInvalidResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = "SpollyInvalidResponseError";
  }
}

const dormir = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", aoAbortar);
      resolve();
    }, ms);
    const aoAbortar = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal?.addEventListener("abort", aoAbortar, { once: true });
  });

const valido = {
  sessao: (o) => typeof o?.id === "string" && o.id.startsWith("cs_") && o.object === "checkout_session",
  estorno: (o) => typeof o?.id === "string" && o.id.startsWith("re_") && o.object === "refund",
  subscricao: (o) => typeof o?.id === "string" && o.id.startsWith("sub_") && o.object === "subscription",
  portal: (o) => o?.object === "subscription_portal" && typeof o.url === "string" && o.url !== "",
  conta: (o) => typeof o?.merchant_id === "string" && o.merchant_id.startsWith("mer_") && (o.modo === "test" || o.modo === "live"),
  contaLigada: (o) => typeof o?.id === "string" && o.id.startsWith("mer_") && o.object === "account",
  documento: (o) => typeof o?.id === "string" && o.id.startsWith("doc_") && o.object === "account_document",
  saldo: (o) =>
    o?.object === "balance" && typeof o.account === "string" && ["available", "pending", "reserved"].every((k) => Array.isArray(o[k]) && o[k].every((d) => typeof d?.amount === "bigint")),
  saque: (o) => typeof o?.id === "string" && o.id.startsWith("po_") && o.object === "payout",
};

// Uma lista da API ({object: "list", data, has_more}), com cada item conferido.
const lista = (item) => (o) => o?.object === "list" && Array.isArray(o.data) && typeof o.has_more === "boolean" && o.data.every(item);
const contasLigadas = lista(valido.contaLigada);
const saques = lista(valido.saque);

const caminhoDaConta = (id) => `/v1/accounts/${encodeURIComponent(id)}`;

/** O cliente da API. Cria-se um e reutiliza-se. */
export class SpollyPayments {
  #chave;
  #base;
  #fetch;
  #timeout;
  #maxRetries;
  #agente;
  #dormir;
  #aleatorio;
  #opcoes;
  #conta = null;

  /**
   * @param {string} secretKey a chave secreta (sk_test_... ou sk_live_...)
   * @param {{ baseURL?: string, timeoutMs?: number, maxRetries?: number, fetch?: typeof fetch, userAgent?: string }} [options]
   */
  constructor(secretKey, options = {}) {
    this.#chave = secretKey ?? "";
    this.#base = (options.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeout = options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.#maxRetries = Number.isInteger(options.maxRetries) ? Math.max(options.maxRetries, 0) : DEFAULT_MAX_RETRIES;
    this.#agente = `${options.userAgent ? `${options.userAgent} ` : ""}spolly-payments-js/${VERSION}`;
    // Só para os testes não esperarem de verdade.
    this.#dormir = options._dormir ?? dormir;
    this.#aleatorio = options._aleatorio ?? Math.random;
    this.#opcoes = options;
  }

  /**
   * Um cliente igual a este que age em nome de uma conta ligada da plataforma:
   * manda `Spolly-Account: <accountId>` em cada pedido (sessões, estornos,
   * subscrições, `getAccount`). As operações de `/v1/accounts` nunca o mandam,
   * porque a conta já vai no caminho. Este cliente não muda.
   * @param {string} accountId o `mer_...` da conta ligada
   */
  withAccount(accountId) {
    if (typeof accountId !== "string" || !/^mer_[0-9A-Za-z]+$/.test(accountId)) {
      throw new TypeError(`spolly: a conta ligada tem de ser um identificador mer_..., e veio ${JSON.stringify(String(accountId))}`);
    }
    const outro = new SpollyPayments(this.#chave, this.#opcoes);
    outro.#conta = accountId;
    return outro;
  }

  /** A conta ligada em nome de quem este cliente age (`withAccount`), ou `null`. */
  get account() {
    return this.#conta;
  }

  /**
   * Cria uma sessão de checkout (POST /v1/checkout/sessions).
   * @param {object} params
   * @param {{ idempotencyKey?: string, signal?: AbortSignal }} [options]
   */
  createCheckoutSession(params, options) {
    return this.#pedir("POST", "/v1/checkout/sessions", params, valido.sessao, options);
  }

  /**
   * Lê uma sessão (GET /v1/checkout/sessions/{id}): o que se chama, do lado
   * do servidor, no regresso do comprador.
   * @param {string} id
   * @param {{ signal?: AbortSignal }} [options]
   */
  getCheckoutSession(id, options) {
    return this.#pedir("GET", `/v1/checkout/sessions/${encodeURIComponent(id)}`, undefined, valido.sessao, options);
  }

  /**
   * Estorna um pagamento, todo ou em parte (POST /v1/refunds).
   * @param {{ payment_id: string, amount?: bigint|number|string, reason?: string }} params
   * @param {{ idempotencyKey?: string, signal?: AbortSignal }} [options]
   */
  createRefund(params, options) {
    return this.#pedir("POST", "/v1/refunds", params, valido.estorno, options);
  }

  /**
   * Lê um estorno (GET /v1/refunds/{id}).
   * @param {string} id
   * @param {{ signal?: AbortSignal }} [options]
   */
  getRefund(id, options) {
    return this.#pedir("GET", `/v1/refunds/${encodeURIComponent(id)}`, undefined, valido.estorno, options);
  }

  /**
   * De que comerciante e de que modo é a chave (GET /v1/conta).
   * @param {{ signal?: AbortSignal }} [options]
   */
  getAccount(options) {
    return this.#pedir("GET", "/v1/conta", undefined, valido.conta, options);
  }

  /**
   * Lê uma subscrição (GET /v1/subscriptions/{id}).
   * @param {string} id
   * @param {{ signal?: AbortSignal }} [options]
   */
  getSubscription(id, options) {
    return this.#pedir("GET", `/v1/subscriptions/${encodeURIComponent(id)}`, undefined, valido.subscricao, options);
  }

  /**
   * Cancela uma subscrição (POST /v1/subscriptions/{id}/cancel), no fim do
   * ciclo pago por omissão; `{ at_period_end: false }` cancela já.
   * @param {string} id
   * @param {{ at_period_end?: boolean }} [params]
   * @param {{ idempotencyKey?: string, signal?: AbortSignal }} [options]
   */
  cancelSubscription(id, params = {}, options) {
    return this.#pedir("POST", `/v1/subscriptions/${encodeURIComponent(id)}/cancel`, params, valido.subscricao, options);
  }

  /**
   * Um link de uso único para a página do cliente desta subscrição (POST
   * /v1/subscriptions/{id}/portal). Manda-se ao cliente; não se guarda.
   * @param {string} id
   * @param {{ idempotencyKey?: string, signal?: AbortSignal }} [options]
   */
  createSubscriptionPortalLink(id, options) {
    return this.#pedir("POST", `/v1/subscriptions/${encodeURIComponent(id)}/portal`, undefined, valido.portal, options);
  }

  /**
   * Cria uma conta ligada, um vendedor da plataforma, no modo da chave (POST
   * /v1/accounts). Só o `name` é obrigatório.
   * @param {object} params
   * @param {{ idempotencyKey?: string, signal?: AbortSignal }} [options]
   */
  createAccount(params, options) {
    return this.#pedir("POST", "/v1/accounts", params, valido.contaLigada, options);
  }

  /**
   * Uma página das contas ligadas, da mais recente para a mais antiga (GET
   * /v1/accounts). A página seguinte pede-se com `starting_after` igual ao `id`
   * da última, enquanto `has_more` for `true`.
   * @param {{ limit?: number, starting_after?: string, reference?: string }} [params]
   * @param {{ signal?: AbortSignal }} [options]
   */
  listAccounts(params = {}, options) {
    const q = new URLSearchParams();
    for (const k of ["limit", "starting_after", "reference"]) {
      if (params[k] !== undefined && params[k] !== null) q.set(k, String(params[k]));
    }
    const texto = q.toString();
    return this.#pedir("GET", `/v1/accounts${texto ? `?${texto}` : ""}`, undefined, contasLigadas, options);
  }

  /**
   * Lê uma conta ligada (GET /v1/accounts/{id}).
   * @param {string} id
   * @param {{ signal?: AbortSignal }} [options]
   */
  getConnectedAccount(id, options) {
    return this.#pedir("GET", caminhoDaConta(id), undefined, valido.contaLigada, options);
  }

  /**
   * Altera uma conta ligada (PATCH /v1/accounts/{id}): só muda o que vier, e
   * `metadata` substitui os metadados todos.
   * @param {string} id
   * @param {object} params
   * @param {{ signal?: AbortSignal }} [options]
   */
  updateAccount(id, params, options) {
    return this.#pedir("PATCH", caminhoDaConta(id), params, valido.contaLigada, options);
  }

  /**
   * Entrega um documento da verificação de uma conta ligada (POST
   * /v1/accounts/{id}/documents, em multipart/form-data): `identity_document`
   * ou `bank_account_proof`, em PDF, JPEG ou PNG, até 10 MiB.
   * @param {string} id
   * @param {{ type: string, file: Blob|Uint8Array|ArrayBuffer, filename?: string }} params
   * @param {{ idempotencyKey?: string, signal?: AbortSignal }} [options]
   */
  uploadAccountDocument(id, params, options) {
    const { type, file, filename } = params ?? {};
    let ficheiro;
    if (file instanceof Blob) ficheiro = file;
    else if (file instanceof Uint8Array || file instanceof ArrayBuffer) ficheiro = new Blob([file]);
    else return Promise.reject(new TypeError("spolly: o file tem de ser um Blob, um File, um Uint8Array (Buffer) ou um ArrayBuffer"));
    if (typeof type !== "string" || type === "") {
      return Promise.reject(new TypeError("spolly: falta o type do documento (identity_document ou bank_account_proof)"));
    }
    const formulario = new FormData();
    formulario.append("type", type);
    formulario.append("file", ficheiro, filename || (typeof file.name === "string" && file.name) || "documento");
    return this.#pedir("POST", `${caminhoDaConta(id)}/documents`, formulario, valido.documento, options);
  }

  /**
   * Define a conta bancária dos saques de uma conta ligada (PUT
   * /v1/accounts/{id}/bank_account), com o comprovativo já entregue.
   * @param {string} id
   * @param {{ iban: string, holder: string, holder_tax_id?: string, proof_document: string }} params
   * @param {{ signal?: AbortSignal }} [options]
   */
  setAccountBankAccount(id, params, options) {
    return this.#pedir("PUT", `${caminhoDaConta(id)}/bank_account`, params, valido.contaLigada, options);
  }

  /**
   * O saldo de uma conta ligada, por moeda, lido do livro (GET
   * /v1/accounts/{id}/balance). Os valores vêm em `bigint`, e podem ser
   * negativos.
   * @param {string} id
   * @param {{ signal?: AbortSignal }} [options]
   */
  getAccountBalance(id, options) {
    return this.#pedir("GET", `${caminhoDaConta(id)}/balance`, undefined, valido.saldo, options);
  }

  /**
   * Pede um saque do disponível de uma conta ligada para a conta bancária
   * verificada (POST /v1/accounts/{id}/payouts). Mínimo de 5.000 Kz, só em AOA.
   * @param {string} id
   * @param {{ amount: bigint|number|string, currency?: "AOA", metadata?: Record<string, string> }} params
   * @param {{ idempotencyKey?: string, signal?: AbortSignal }} [options]
   */
  createAccountPayout(id, params, options) {
    return this.#pedir("POST", `${caminhoDaConta(id)}/payouts`, params, valido.saque, options);
  }

  /**
   * Os saques de uma conta ligada, os 100 mais recentes (GET
   * /v1/accounts/{id}/payouts).
   * @param {string} id
   * @param {{ signal?: AbortSignal }} [options]
   */
  listAccountPayouts(id, options) {
    return this.#pedir("GET", `${caminhoDaConta(id)}/payouts`, undefined, saques, options);
  }

  /**
   * Lê um saque de uma conta ligada (GET /v1/accounts/{id}/payouts/{payout_id}).
   * @param {string} id
   * @param {string} payoutId
   * @param {{ signal?: AbortSignal }} [options]
   */
  getAccountPayout(id, payoutId, options) {
    return this.#pedir("GET", `${caminhoDaConta(id)}/payouts/${encodeURIComponent(payoutId)}`, undefined, valido.saque, options);
  }

  async #pedir(metodo, caminho, corpo, ehValido, options = {}) {
    if (!this.#chave) throw new TypeError("spolly: falta a chave secreta (sk_test_... ou sk_live_...)");
    // O multipart vai tal como está: o fetch escreve-o, com a fronteira no
    // Content-Type, em cada tentativa.
    const multipart = corpo instanceof FormData;
    const dados = corpo === undefined || multipart ? corpo : paraJSON(corpo);
    const chave = metodo === "POST" ? options.idempotencyKey || randomUUID() : "";
    const cabecalhos = {
      Authorization: `Bearer ${this.#chave}`,
      Accept: "application/json",
      "User-Agent": this.#agente,
    };
    if (dados !== undefined && !multipart) cabecalhos["Content-Type"] = "application/json";
    if (chave) cabecalhos[IDEMPOTENCY_KEY_HEADER] = chave;
    // As rotas /v1/accounts são da plataforma, e a API recusa-lhes o cabeçalho.
    if (this.#conta && !/^\/v1\/accounts(?:[/?]|$)/.test(caminho)) cabecalhos[ACCOUNT_HEADER] = this.#conta;
    const sinal = options.signal;

    // Uma tentativa; a seguinte chama-se no fim, com a mesma chave e o mesmo corpo.
    const tentar = async (tentativa) => {
      let res;
      let texto;
      let falha;
      try {
        const s = sinal ? AbortSignal.any([sinal, AbortSignal.timeout(this.#timeout)]) : AbortSignal.timeout(this.#timeout);
        res = await this.#fetch(`${this.#base}${caminho}`, { method: metodo, headers: cabecalhos, body: dados, signal: s });
        texto = await res.text();
      } catch (e) {
        if (sinal?.aborted) throw sinal.reason;
        falha = e;
      }
      if (!falha && res.status < 300) {
        let objeto;
        try {
          objeto = parseJSON(texto);
        } catch {
          // fica undefined, e recusa-se abaixo
        }
        if (!ehValido(objeto)) {
          throw new SpollyInvalidResponseError(`spolly: ${metodo} ${caminho} deu ${res.status} com um corpo que não é o esperado`);
        }
        return objeto;
      }
      if (!falha && !REPETIVEIS.has(res.status)) throw lerErro(res.status, texto, chave);
      if (tentativa >= this.#maxRetries) {
        if (falha) throw new SpollyConnectionError(`spolly: ${metodo} ${caminho}: ${falha.message}`, falha);
        throw lerErro(res.status, texto, chave);
      }
      await this.#dormir(this.#espera(tentativa, falha ? null : res.headers.get("retry-after")), sinal);
      return tentar(tentativa + 1);
    };
    return tentar(0);
  }

  #espera(tentativa, retryAfter) {
    if (retryAfter !== null && /^\d+$/.test(retryAfter.trim())) {
      return Math.min(Number(retryAfter.trim()) * 1000, RETRY_AFTER_MAXIMO_MS);
    }
    const d = Math.min(ESPERA_BASE_MS * 2 ** tentativa, ESPERA_MAXIMA_MS);
    return d / 2 + Math.floor(this.#aleatorio() * (d / 2));
  }
}

function lerErro(status, texto, chave) {
  let c;
  try {
    c = JSON.parse(texto);
  } catch {
    // fica undefined
  }
  if (typeof c?.erro !== "string" || c.erro === "") {
    const resumo = texto.trim().length > 200 ? `${texto.trim().slice(0, 200)}...` : texto.trim();
    return new SpollyError({
      status,
      code: ErrorCodes.UNREADABLE_ERROR,
      message: `a API respondeu ${status} com um corpo que não é um erro dela: ${JSON.stringify(resumo)}`,
      idempotencyKey: chave,
    });
  }
  return new SpollyError({ status, code: c.erro, message: String(c.mensagem ?? ""), fields: c.campos ?? {}, idempotencyKey: chave });
}

/** Uma Idempotency-Key nova, como a que o cliente gera sozinho. */
export const newIdempotencyKey = () => randomUUID();

/** Diz se uma sessão está paga: completa, e com um pagamento confirmado. */
export const isPaid = (sessao) => sessao?.status === "complete" && sessao?.payment?.status === "succeeded";
