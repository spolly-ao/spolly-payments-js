// O dinheiro em JSON sem passar por um number: os campos amount, unit_amount e
// first_cycle_amount (o primeiro ciclo de uma subscrição) leem-se para bigint a
// partir do texto da resposta, e escrevem-se tal como são (regra o-dinheiro.md).
// Na subscrição, first_cycle_amount é um objeto {amount, currency}, e fica como
// objeto: só os números passam a bigint.

const CAMPOS_DE_DINHEIRO = new Set(["amount", "unit_amount", "first_cycle_amount"]);

/** Lê JSON com os valores de dinheiro em `bigint`, a partir do texto. */
export function parseJSON(texto) {
  return JSON.parse(texto, (k, v, ctx) => (CAMPOS_DE_DINHEIRO.has(k) && typeof v === "number" ? BigInt(ctx.source) : v));
}

export function paraJSON(valor) {
  return JSON.stringify(valor, (k, v) => {
    if (!CAMPOS_DE_DINHEIRO.has(k) || v === undefined) return v;
    if (typeof v === "bigint") return JSON.rawJSON(v.toString());
    if (typeof v === "number" && Number.isSafeInteger(v)) return v;
    if (typeof v === "string" && /^-?\d+$/.test(v)) return JSON.rawJSON(BigInt(v).toString());
    throw new TypeError(`spolly: ${k} tem de ser um inteiro em unidades menores (bigint, number inteiro, ou texto com algarismos), e veio ${JSON.stringify(String(v))}`);
  });
}

