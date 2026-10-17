// O cliente em JavaScript da API do Spolly Payments: criar e ler sessões de
// checkout, estornar, e confirmar a conta da chave. As mesmas operações e os
// mesmos nomes do SDK em Go (spolly-payments-go). A verificação da assinatura
// dos webhooks está em ./webhook.js, e reexporta-se aqui.
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
//
// Dinheiro: os campos `amount` e `unit_amount` chegam como `bigint`, lidos do
// texto da resposta sem passar por um `number`, e aceitam-se como `bigint`,
// como `number` inteiro seguro, ou como texto só com algarismos.

import { randomUUID } from "node:crypto";

import { paraJSON, parseJSON } from "./json.js";

export { parseJSON } from "./json.js";
export { constructEvent, verifySignature, sign, WebhookVerificationError, Reasons, SIGNATURE_HEADER, EVENT_ID_HEADER, EVENT_TYPE_HEADER, DEFAULT_TOLERANCE_SECONDS } from "./webhook.js";

/** A versão deste SDK, que vai no User-Agent. */
export const VERSION = "0.2.0";

/** A API de produção. As chaves sk_test_ também a usam: o modo é o da chave. */
export const DEFAULT_BASE_URL = "https://payments-api.spolly.ao";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 2;
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
export const IDEMPOTENT_REPLAYED_HEADER = "Idempotent-Replayed";

const ESPERA_BASE_MS = 500;
const ESPERA_MAXIMA_MS = 8_000;
const RETRY_AFTER_MAXIMO_MS = 30_000;
const REPETIVEIS = new Set([429, 500, 502, 503, 504]);

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
  SUBSCRIPTION_ENDED: "subscricao_terminada",
  INVALID_DATA: "dados_invalidos",
  IDEMPOTENCY_REUSED: "idempotencia_reutilizada",
  CURRENCY_WITHOUT_GATEWAY: "moeda_sem_gateway",
  METHOD_WITHOUT_GATEWAY: "metodo_sem_gateway",
  REFUND_EXCEEDS_CHARGED: "estorno_acima_do_cobrado",
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
};

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

  async #pedir(metodo, caminho, corpo, ehValido, options = {}) {
    if (!this.#chave) throw new TypeError("spolly: falta a chave secreta (sk_test_... ou sk_live_...)");
    const dados = corpo === undefined ? undefined : paraJSON(corpo);
    const chave = metodo === "POST" ? options.idempotencyKey || randomUUID() : "";
    const cabecalhos = {
      Authorization: `Bearer ${this.#chave}`,
      Accept: "application/json",
      "User-Agent": this.#agente,
    };
    if (dados !== undefined) cabecalhos["Content-Type"] = "application/json";
    if (chave) cabecalhos[IDEMPOTENCY_KEY_HEADER] = chave;
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
