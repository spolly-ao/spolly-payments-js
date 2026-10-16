// A verificação da assinatura dos webhooks do Spolly Payments, e a leitura do
// envelope de cada evento. A mesma semântica do pacote webhook do SDK em Go
// (spolly-payments-go).
//
// Cada webhook chega com o cabeçalho Spolly-Signature:
//
//   Spolly-Signature: t=<unix>,v1=<hex(hmac_sha256(segredo, "<t>.<corpo>"))>[,v1=<...>]
//
// A chave do HMAC são os bytes do segredo inteiro, com o prefixo whsec_.
// Durante a rotação de um segredo o cabeçalho leva duas assinaturas v1, e basta
// uma bater. Por omissão, aceita-se até 5 minutos de diferença entre o t e o
// relógio de quem recebe, contra a repetição de um pedido gravado.
//
// A verificação faz-se sobre o corpo bruto (Buffer ou texto), tal como chegou:
// um JSON lido e escrito outra vez muda e a assinatura deixa de bater. A mesma
// entrega pode chegar mais de uma vez: deduplica-se pelo id do evento.

import { createHmac, timingSafeEqual } from "node:crypto";

import { parseJSON } from "./json.js";

export const SIGNATURE_HEADER = "Spolly-Signature";
export const EVENT_ID_HEADER = "Spolly-Event-Id";
export const EVENT_TYPE_HEADER = "Spolly-Event-Type";

/** A tolerância por omissão, em segundos. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** As razões de uma recusa, em `WebhookVerificationError.code`. */
export const Reasons = Object.freeze({
  NO_SECRET: "no_secret",
  NO_HEADER: "no_header",
  MALFORMED_HEADER: "malformed_header",
  NO_SIGNATURE: "no_signature",
  SIGNATURE_MISMATCH: "signature_mismatch",
  TIMESTAMP_OUTSIDE_TOLERANCE: "timestamp_outside_tolerance",
  INVALID_PAYLOAD: "invalid_payload",
});

const MENSAGENS = {
  no_secret: "nenhum segredo com que verificar",
  no_header: "falta o cabeçalho Spolly-Signature",
  malformed_header: "o cabeçalho Spolly-Signature está mal formado",
  no_signature: "o cabeçalho Spolly-Signature não traz nenhuma assinatura v1",
  signature_mismatch: "nenhuma assinatura bate com os segredos dados",
  timestamp_outside_tolerance: "o tempo da assinatura está fora da tolerância",
  invalid_payload: "o corpo não é um envelope de evento",
};

/** O erro de todas as recusas: `code` é um dos `Reasons`, `detail` o pormenor. */
export class WebhookVerificationError extends Error {
  /**
   * @param {string} code
   * @param {string} [detail]
   */
  constructor(code, detail = "") {
    super(`webhook: ${MENSAGENS[code]}${detail ? `: ${detail}` : ""}`);
    this.name = "WebhookVerificationError";
    this.code = code;
    this.detail = detail;
  }
}

const HEX_SHA256 = /^[0-9a-f]{64}$/i;

/** @param {string|Uint8Array} corpo */
function bytes(corpo) {
  if (typeof corpo === "string") return Buffer.from(corpo, "utf8");
  if (corpo instanceof Uint8Array) return Buffer.from(corpo.buffer, corpo.byteOffset, corpo.byteLength);
  throw new TypeError("webhook: o corpo tem de ser o texto bruto ou um Buffer, e não um objeto já lido");
}

/** @param {string} segredo @param {number} t @param {Buffer} corpo */
function calcular(segredo, t, corpo) {
  return createHmac("sha256", segredo).update(`${t}.`).update(corpo).digest();
}

/** @param {string} header */
function lerCabecalho(header) {
  let t;
  const assinaturas = [];
  for (const parte of header.split(",")) {
    const limpa = parte.trim();
    const i = limpa.indexOf("=");
    if (i < 0) throw new WebhookVerificationError(Reasons.MALFORMED_HEADER, `a parte "${parte}" não é chave=valor`);
    const k = limpa.slice(0, i);
    const v = limpa.slice(i + 1);
    if (k === "t") {
      if (t !== undefined || !/^-?\d+$/.test(v)) {
        throw new WebhookVerificationError(Reasons.MALFORMED_HEADER, "o t tem de aparecer uma vez, em segundos desde 1970");
      }
      t = Number(v);
    } else if (k === "v1") {
      if (!HEX_SHA256.test(v)) {
        throw new WebhookVerificationError(Reasons.MALFORMED_HEADER, "uma assinatura v1 não é um HMAC-SHA256 em hexadecimal");
      }
      assinaturas.push(Buffer.from(v, "hex"));
    }
  }
  if (t === undefined) throw new WebhookVerificationError(Reasons.MALFORMED_HEADER, "falta o t");
  if (assinaturas.length === 0) throw new WebhookVerificationError(Reasons.NO_SIGNATURE);
  return { t, assinaturas };
}

/**
 * Verifica a assinatura. Lança `WebhookVerificationError` se não bater.
 *
 * @param {string|Uint8Array} payload o corpo bruto
 * @param {string|null|undefined} header o valor de Spolly-Signature
 * @param {string|string[]} secrets o segredo whsec_, ou vários durante uma rotação
 * @param {{ toleranceSeconds?: number, now?: () => number }} [options] `now` em milissegundos, como `Date.now`
 */
export function verifySignature(payload, header, secrets, options = {}) {
  const segredos = (Array.isArray(secrets) ? secrets : [secrets]).filter((s) => typeof s === "string" && s !== "");
  if (segredos.length === 0) throw new WebhookVerificationError(Reasons.NO_SECRET);
  if (typeof header !== "string" || header.trim() === "") throw new WebhookVerificationError(Reasons.NO_HEADER);
  const corpo = bytes(payload);
  const { t, assinaturas } = lerCabecalho(header);
  // Todas as combinações, sem parar na primeira: o tempo não diz qual bateu.
  let bate = false;
  for (const s of segredos) {
    const esperada = calcular(s, t, corpo);
    for (const a of assinaturas) {
      if (timingSafeEqual(a, esperada)) bate = true;
    }
  }
  if (!bate) {
    throw new WebhookVerificationError(Reasons.SIGNATURE_MISMATCH, `${assinaturas.length} assinatura(s) v1 e ${segredos.length} segredo(s)`);
  }
  const tolerancia = options.toleranceSeconds > 0 ? options.toleranceSeconds : DEFAULT_TOLERANCE_SECONDS;
  const agora = Math.floor((options.now ?? Date.now)() / 1000);
  if (Math.abs(agora - t) > tolerancia) {
    throw new WebhookVerificationError(
      Reasons.TIMESTAMP_OUTSIDE_TOLERANCE,
      `assinado a ${new Date(t * 1000).toISOString()}, ${agora - t} s de diferença, e a tolerância é ${tolerancia} s`,
    );
  }
}

/**
 * Verifica a assinatura e devolve o envelope do evento. Os valores de dinheiro
 * (`amount`, `unit_amount`) vêm em `bigint`, como no cliente da API.
 *
 * @param {string|Uint8Array} payload
 * @param {string|null|undefined} header
 * @param {string|string[]} secrets
 * @param {{ toleranceSeconds?: number, now?: () => number }} [options]
 * @returns {{ id: string, type: string, created_at: string, mode: "test"|"live", merchant_id: string, api_version: string, data: { object: Record<string, unknown> } }}
 */
export function constructEvent(payload, header, secrets, options = {}) {
  verifySignature(payload, header, secrets, options);
  let e;
  try {
    e = parseJSON(bytes(payload).toString("utf8"));
  } catch (erro) {
    throw new WebhookVerificationError(Reasons.INVALID_PAYLOAD, String(erro.message));
  }
  if (!e || typeof e !== "object" || typeof e.id !== "string" || !e.id.startsWith("evt_") || typeof e.type !== "string" || !e.type) {
    throw new WebhookVerificationError(Reasons.INVALID_PAYLOAD, "sem id evt_ ou sem type");
  }
  return e;
}

/**
 * O valor do cabeçalho Spolly-Signature para o corpo, com uma assinatura v1
 * por segredo, como o Spolly Payments o envia. Para os testes de quem integra.
 *
 * @param {string|Uint8Array} payload
 * @param {string|string[]} secrets
 * @param {number} [timestampSeconds]
 */
export function sign(payload, secrets, timestampSeconds = Math.floor(Date.now() / 1000)) {
  const corpo = bytes(payload);
  const partes = [`t=${timestampSeconds}`];
  for (const s of Array.isArray(secrets) ? secrets : [secrets]) {
    partes.push(`v1=${calcular(s, timestampSeconds, corpo).toString("hex")}`);
  }
  return partes.join(",");
}
