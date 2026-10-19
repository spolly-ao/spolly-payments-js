import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import {
  constructEvent,
  DEFAULT_BASE_URL,
  ErrorCodes,
  IDEMPOTENCY_KEY_HEADER,
  isPaid,
  newIdempotencyKey,
  parseJSON,
  sign,
  SpollyConnectionError,
  SpollyError,
  SpollyInvalidResponseError,
  SpollyPayments,
  VERSION,
  PaymentMethods,
  Renewals,
  Settlements,
} from "../src/index.js";

const SESSAO = `{"id":"cs_test_4f8Gk2LmQ9rT1vXz7bN3cH6sW0pY5aDe","object":"checkout_session","mode":"test","status":"complete",
"url":"https://checkout.payments.spolly.ao/cs_test_4f8Gk2LmQ9rT1vXz7bN3cH6sW0pY5aDe","amount":{"amount":1500000,"currency":"AOA"},
"description":"Vestido de capulana","line_items":[{"description":"Vestido","unit_amount":1500000,"quantity":1}],"payment_methods":["mcx","card"],
"success_url":"https://kiala.ao/obrigado","cancel_url":null,"metadata":{"order_id":"1042"},"customer":{"email":"","name":"","phone":""},
"expires_at":"2026-11-30T10:15:00Z","created_at":"2026-11-29T10:15:00Z","completed_at":"2026-11-29T10:17:12Z",
"payment":{"id":"pay_9Hq2Lm4Rt8Vx1Zb6Nc3Kd0","status":"succeeded","method":"mcx"}}`;
const ESTORNO = `{"id":"re_7Tq3Mn5Wx9Yz2Ab4Cd6Ef8","object":"refund","payment_id":"pay_9Hq2Lm4Rt8Vx1Zb6Nc3Kd0",
"amount":{"amount":500000,"currency":"AOA"},"status":"pending","reason":"Devolução parcial","created_at":"2026-12-02T09:00:00Z"}`;
const CONTA = `{"merchant_id":"mer_01JA9SALUTO000000","nome_comercial":"Saluto","modo":"test"}`;
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Um servidor HTTP a sério, que responde pela função `responder` de cada teste
// e grava os pedidos.
let servidor;
let base;
let pedidos = [];
let responder = () => [200, {}, CONTA];

before(async () => {
  servidor = createServer((req, res) => {
    const partes = [];
    req.on("data", (p) => partes.push(p));
    req.on("end", () => {
      const p = { metodo: req.method, caminho: req.url, cab: req.headers, corpo: Buffer.concat(partes).toString("utf8") };
      pedidos.push(p);
      const [estado, cab, corpo] = responder(pedidos.length, p);
      res.writeHead(estado, { "content-type": "application/json", ...cab });
      res.end(corpo);
    });
  });
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${servidor.address().port}/`;
});
after(() => servidor.close());

const esperas = [];
const cliente = (opcoes = {}) => {
  pedidos = [];
  esperas.length = 0;
  return new SpollyPayments("sk_test_abc", {
    baseURL: base,
    _dormir: async (ms) => {
      esperas.push(ms);
    },
    _aleatorio: () => 0.999999,
    ...opcoes,
  });
};

test("criar uma sessão manda o pedido certo, com a chave gerada e o dinheiro sem passar por number", async () => {
  responder = () => [201, {}, SESSAO];
  const c = cliente({ userAgent: "loja/1.4" });
  const s = await c.createCheckoutSession({
    amount: 1500000n,
    currency: "AOA",
    description: "Vestido de capulana",
    line_items: [{ description: "Vestido", unit_amount: "1500000", quantity: 1 }],
    payment_methods: ["mcx", "card"],
    metadata: { order_id: "1042" },
  });
  assert.equal(s.id, "cs_test_4f8Gk2LmQ9rT1vXz7bN3cH6sW0pY5aDe");
  assert.equal(s.amount.amount, 1500000n);
  assert.equal(s.line_items[0].unit_amount, 1500000n);
  assert.equal(s.line_items[0].quantity, 1);
  assert.ok(isPaid(s));
  const p = pedidos[0];
  assert.equal(p.metodo, "POST");
  assert.equal(p.caminho, "/v1/checkout/sessions");
  assert.equal(p.cab.authorization, "Bearer sk_test_abc");
  assert.equal(p.cab["content-type"], "application/json");
  assert.equal(p.cab["user-agent"], `loja/1.4 spolly-payments-js/${VERSION}`);
  assert.match(p.cab["idempotency-key"], UUID4);
  assert.equal(
    p.corpo,
    `{"amount":1500000,"currency":"AOA","description":"Vestido de capulana","line_items":[{"description":"Vestido","unit_amount":1500000,"quantity":1}],"payment_methods":["mcx","card"],"metadata":{"order_id":"1042"}}`,
  );
});

test("a comissão da plataforma viaja em bigint, e as recusas têm o seu código", async () => {
  responder = () => [201, {}, SESSAO.replace('"payment":{', '"application":"app_7Kq2Lm4Rt8Vx1Zb6Nc3Kd0","platform_fee":{"platform":"mer_38IAs7qmknSwC1F9XYtR1b","amount":150000},"payment":{')];
  const c = cliente();
  const s = await c.createCheckoutSession({
    amount: 1500000n,
    currency: "AOA",
    description: "Duas noites",
    platform_fee: { platform: "mer_38IAs7qmknSwC1F9XYtR1b", amount: 150000n },
  });
  assert.deepEqual(s.platform_fee, { platform: "mer_38IAs7qmknSwC1F9XYtR1b", amount: 150000n });
  assert.equal(s.application, "app_7Kq2Lm4Rt8Vx1Zb6Nc3Kd0");
  assert.equal(
    pedidos[0].corpo,
    `{"amount":1500000,"currency":"AOA","description":"Duas noites","platform_fee":{"platform":"mer_38IAs7qmknSwC1F9XYtR1b","amount":150000}}`,
  );
  for (const [estado, codigo] of [
    [403, ErrorCodes.PLATFORM_NOT_AUTHORIZED],
    [422, ErrorCodes.PLATFORM_FEE_ABOVE_MAXIMUM],
    [422, ErrorCodes.PLATFORM_FEE_INVALID],
  ]) {
    responder = () => [estado, {}, JSON.stringify({ erro: codigo, mensagem: "recusada" })];
    await assert.rejects(
      c.createCheckoutSession({ amount: 1500000n, currency: "AOA", description: "x", platform_fee: { platform: "mer_x", amount: 1n } }),
      (e) => e instanceof SpollyError && e.status === estado && e.code === codigo,
    );
  }
  assert.equal(ErrorCodes.PLATFORM_NOT_AUTHORIZED, "plataforma_nao_autorizada");
  assert.equal(ErrorCodes.PLATFORM_FEE_ABOVE_MAXIMUM, "comissao_acima_do_maximo");
  assert.equal(ErrorCodes.PLATFORM_FEE_INVALID, "comissao_invalida");
});

test("o primeiro ciclo de uma subscrição viaja em bigint, nos dois sentidos", async () => {
  responder = () => [201, {}, SESSAO.replace('"payment":{', '"subscription":{"id":null,"interval":"month","cycles":null,"cycle":null,"first_cycle_amount":250000},"payment":{')];
  const c = cliente();
  const s = await c.createCheckoutSession({
    amount: 500000n,
    currency: "AOA",
    description: "Plano mensal",
    kind: "subscription",
    subscription: { interval: "month", first_cycle_amount: 250000n },
  });
  assert.equal(s.subscription.first_cycle_amount, 250000n);
  assert.equal(
    pedidos[0].corpo,
    `{"amount":500000,"currency":"AOA","description":"Plano mensal","kind":"subscription","subscription":{"interval":"month","first_cycle_amount":250000}}`,
  );
  // Na subscrição, é dinheiro com a moeda, e o valor lá dentro é bigint.
  const sub = parseJSON(`{"amount":{"amount":500000,"currency":"AOA"},"first_cycle_amount":{"amount":250000,"currency":"AOA"}}`);
  assert.deepEqual(sub.first_cycle_amount, { amount: 250000n, currency: "AOA" });
});

test("o dinheiro grande viaja inteiro, nos dois sentidos", async () => {
  responder = () => [201, {}, SESSAO.replace('"amount":1500000', '"amount":90071992547409930')];
  const c = cliente();
  const s = await c.createCheckoutSession({ amount: 90071992547409930n, currency: "AOA", description: "x" });
  assert.equal(s.amount.amount, 90071992547409930n);
  assert.equal(pedidos[0].corpo, `{"amount":90071992547409930,"currency":"AOA","description":"x"}`);
  await assert.rejects(c.createCheckoutSession({ amount: 1.5, currency: "AOA" }), /amount tem de ser um inteiro/);
  await assert.rejects(c.createCheckoutSession({ amount: "15,00", currency: "AOA" }), TypeError);
  await assert.rejects(c.createRefund({ payment_id: "pay_1", amount: null }), TypeError);
  assert.equal(pedidos.length, 1, "um valor errado não chega à API");
  // Sem amount (estornar o que resta), o campo não viaja.
  responder = () => [201, {}, ESTORNO];
  await c.createRefund({ payment_id: "pay_1", amount: undefined });
  assert.equal(pedidos[1].corpo, `{"payment_id":"pay_1"}`);
});

test("as retentativas usam a mesma chave e o mesmo corpo, e respeitam o Retry-After", async () => {
  responder = (n) => {
    if (n === 1) return [503, { "retry-after": "3" }, `{"erro":"indisponivel","mensagem":"Tenta de novo."}`];
    if (n === 2) return [500, {}, `{"erro":"erro_interno","mensagem":"x"}`];
    return [201, { "idempotent-replayed": "true" }, ESTORNO];
  };
  const c = cliente();
  const r = await c.createRefund({ payment_id: "pay_1", amount: 500000, reason: "Devolução parcial" }, { idempotencyKey: "pedido-1042-estorno-1" });
  assert.equal(r.status, "pending");
  assert.equal(r.amount.amount, 500000n);
  assert.equal(pedidos.length, 3);
  for (const p of pedidos) {
    assert.equal(p.cab["idempotency-key"], "pedido-1042-estorno-1");
    assert.equal(p.corpo, `{"payment_id":"pay_1","amount":500000,"reason":"Devolução parcial"}`);
  }
  // 3 s do Retry-After; depois 1 s exponencial (metade fixa, e a outra pelo aleatório).
  assert.deepEqual(esperas, [3000, 999]);
});

test("a chave gerada é a mesma nas tentativas, e outra na chamada seguinte", async () => {
  responder = (n) => (n < 3 ? [502, {}, "<html>proxy</html>"] : [201, {}, SESSAO]);
  const c = cliente();
  await c.createCheckoutSession({ amount: 100, currency: "AOA", description: "x" });
  assert.equal(pedidos.length, 3);
  assert.equal(new Set(pedidos.map((p) => p.cab["idempotency-key"])).size, 1);
  await c.createCheckoutSession({ amount: 100, currency: "AOA", description: "x" });
  assert.notEqual(pedidos[3].cab["idempotency-key"], pedidos[0].cab["idempotency-key"]);
});

test("esgotar as retentativas devolve o último erro", async () => {
  responder = () => [503, {}, `{"erro":"indisponivel","mensagem":"Não foi possível validar a chave."}`];
  const c = cliente();
  await assert.rejects(c.getCheckoutSession("cs_test_1"), (e) => e instanceof SpollyError && e.status === 503 && e.code === ErrorCodes.UNAVAILABLE && e.idempotencyKey === "");
  assert.equal(pedidos.length, 3);
  assert.deepEqual(esperas, [499, 999]);
  assert.equal(pedidos[0].metodo, "GET");
  assert.equal(pedidos[0].cab["idempotency-key"], undefined);
  assert.equal(pedidos[0].cab["content-type"], undefined);
  assert.equal(pedidos[0].corpo, "");
});

test("os 4xx não se repetem, e trazem os campos", async () => {
  responder = () => [422, {}, `{"erro":"dados_invalidos","mensagem":"Há campos por corrigir.","campos":{"currency":"Falta a moeda.","amount":"Falta o valor."}}`];
  const c = cliente();
  const e = await c.createCheckoutSession({}).catch((e) => e);
  assert.equal(pedidos.length, 1);
  assert.ok(e instanceof SpollyError);
  assert.equal(e.code, ErrorCodes.INVALID_DATA);
  assert.equal(e.userMessage, "Há campos por corrigir.");
  assert.equal(e.fields.currency, "Falta a moeda.");
  assert.match(e.idempotencyKey, UUID4);
  assert.equal(e.message, "spolly: 422 dados_invalidos: Há campos por corrigir.; amount: Falta o valor.; currency: Falta a moeda.");
});

test("um erro ilegível não vira outra coisa", async () => {
  responder = () => [404, {}, "x".repeat(300)];
  const c = cliente({ maxRetries: -1 });
  let e = await c.getRefund("re_1").catch((e) => e);
  assert.equal(e.status, 404);
  assert.equal(e.code, ErrorCodes.UNREADABLE_ERROR);
  assert.ok(e.userMessage.includes(`${"x".repeat(200)}...`));
  assert.deepEqual(e.fields, {});
  responder = () => [403, {}, `{"mensagem":"sem código"}`];
  e = await c.getAccount().catch((e) => e);
  assert.equal(e.code, ErrorCodes.UNREADABLE_ERROR);
  assert.ok(e.userMessage.endsWith(`"{\\"mensagem\\":\\"sem código\\"}"`));
  responder = () => [409, {}, `{"erro":"pagamento_ja_estornado"}`];
  e = await c.createRefund({ payment_id: "pay_1" }).catch((e) => e);
  assert.equal(e.code, ErrorCodes.PAYMENT_ALREADY_REFUNDED);
  assert.equal(e.userMessage, "");
});

test("uma resposta ilegível nunca é um objeto vazio", async () => {
  const c = cliente();
  for (const corpo of ["{}", "não é json", `{"id":"pay_1","object":"payment"}`, "[]", "null"]) {
    responder = () => [200, {}, corpo];
    for (const chamada of [() => c.getCheckoutSession("cs_test_1"), () => c.getRefund("re_1"), () => c.getAccount()]) {
      await assert.rejects(chamada(), SpollyInvalidResponseError);
    }
  }
  responder = () => [200, {}, `{"merchant_id":"mer_1","nome_comercial":"Kiala","modo":"producao"}`];
  await assert.rejects(c.getAccount(), SpollyInvalidResponseError);
  responder = () => [200, {}, `{"merchant_id":7,"modo":"test"}`];
  await assert.rejects(c.getAccount(), SpollyInvalidResponseError);
});

test("as operações", async () => {
  responder = (_, p) => {
    if (p.caminho === "/v1/conta") return [200, {}, CONTA];
    if (p.caminho.startsWith("/v1/refunds/")) return [200, {}, ESTORNO];
    return [200, {}, SESSAO];
  };
  const c = cliente();
  const a = await c.getAccount();
  assert.equal(a.nome_comercial, "Saluto");
  assert.equal(a.modo, "test");
  const r = await c.getRefund("re_7Tq3Mn5Wx9Yz2Ab4Cd6Ef8");
  assert.equal(r.payment_id, "pay_9Hq2Lm4Rt8Vx1Zb6Nc3Kd0");
  await c.getCheckoutSession("cs_test_a/b?c");
  assert.equal(pedidos[2].caminho, "/v1/checkout/sessions/cs_test_a%2Fb%3Fc");
});

test("sem chave não se chama nada", async () => {
  await assert.rejects(new SpollyPayments().getAccount(), /falta a chave secreta/);
  await assert.rejects(new SpollyPayments("").getAccount(), TypeError);
});

test("a falha de rede repete com o mesmo corpo, e no fim é SpollyConnectionError", async () => {
  const corpos = [];
  const chaves = [];
  let n = 0;
  const falso = async (url, init) => {
    corpos.push(init.body);
    chaves.push(init.headers[IDEMPOTENCY_KEY_HEADER]);
    n++;
    if (n === 1) throw new TypeError("fetch failed");
    return new Response(SESSAO, { status: 201 });
  };
  const c = cliente({ fetch: falso, baseURL: undefined });
  await c.createCheckoutSession({ amount: 100, currency: "AOA", description: "x" });
  assert.equal(corpos.length, 2);
  assert.equal(corpos[0], corpos[1]);
  assert.equal(chaves[0], chaves[1]);
  assert.deepEqual(esperas, [499]);

  const sempreFalha = async (url) => {
    assert.ok(url.startsWith(DEFAULT_BASE_URL));
    throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
  };
  const e = await cliente({ fetch: sempreFalha, baseURL: undefined, maxRetries: 0 })
    .getAccount()
    .catch((e) => e);
  assert.ok(e instanceof SpollyConnectionError);
  assert.match(e.message, /GET \/v1\/conta: fetch failed/);
  assert.ok(e.cause instanceof TypeError);
});

test("o tempo limite de cada tentativa", async () => {
  // Um servidor que nunca responde.
  const mudo = createServer(() => {});
  await new Promise((r) => mudo.listen(0, "127.0.0.1", r));
  const c = new SpollyPayments("sk_test_1", { baseURL: `http://127.0.0.1:${mudo.address().port}`, timeoutMs: 50, maxRetries: 1, _dormir: async () => {} });
  const inicio = Date.now();
  const e = await c.getAccount().catch((e) => e);
  mudo.closeAllConnections();
  mudo.close();
  assert.ok(e instanceof SpollyConnectionError, String(e));
  assert.equal(e.cause.name, "TimeoutError");
  assert.ok(Date.now() - inicio < 5000);
});

test("o signal de quem chama manda sobre as retentativas", async () => {
  responder = () => [503, {}, `{"erro":"indisponivel","mensagem":"x"}`];
  // Cancelado durante a espera: a espera de verdade, sem _dormir.
  const ctl = new AbortController();
  pedidos = [];
  const c = new SpollyPayments("sk_test_1", { baseURL: base, _aleatorio: () => 0 });
  const prometida = c.getAccount({ signal: ctl.signal });
  setTimeout(() => ctl.abort(new Error("desisti")), 100);
  await assert.rejects(prometida, /desisti/);
  assert.equal(pedidos.length, 1);

  // Cancelado antes de começar: nem chega à API.
  pedidos = [];
  await assert.rejects(c.getAccount({ signal: AbortSignal.abort(new Error("já cancelado")) }), /já cancelado/);
  assert.equal(pedidos.length, 0);

  // Com signal e sem cancelar, a espera de verdade acaba e tenta outra vez.
  responder = (n) => (n === 1 ? [429, { "retry-after": "0" }, `{"erro":"limite","mensagem":"x"}`] : [200, {}, CONTA]);
  pedidos = [];
  const a = await c.getAccount({ signal: new AbortController().signal });
  assert.equal(a.merchant_id, "mer_01JA9SALUTO000000");
  assert.equal(pedidos.length, 2);

  // E sem signal nenhum, a espera de verdade também.
  responder = (n) => (n === 1 ? [429, { "retry-after": "lixo" }, `{"erro":"limite","mensagem":"x"}`] : [200, {}, CONTA]);
  pedidos = [];
  const lento = new SpollyPayments("sk_test_1", { baseURL: base, timeoutMs: 0, maxRetries: 1.5, _aleatorio: () => 0 });
  await lento.getAccount();
  assert.equal(pedidos.length, 2);
});

test("o Retry-After não se espera inteiro acima de 30 segundos, e as esperas não passam o máximo", async () => {
  responder = (n) => (n === 1 ? [503, { "retry-after": "3600" }, `{"erro":"indisponivel","mensagem":"x"}`] : [200, {}, CONTA]);
  const c = cliente();
  await c.getAccount();
  assert.deepEqual(esperas, [30000]);
  responder = () => [500, {}, `{"erro":"erro_interno","mensagem":"x"}`];
  const muitas = cliente({ maxRetries: 6 });
  await assert.rejects(muitas.getAccount(), SpollyError);
  assert.deepEqual(esperas, [499, 999, 1999, 3999, 7999, 7999]);
});

test("as peças soltas", () => {
  assert.match(newIdempotencyKey(), UUID4);
  assert.equal(isPaid(null), false);
  assert.equal(isPaid({ status: "open", payment: null }), false);
  assert.equal(isPaid({ status: "complete", payment: { status: "failed" } }), false);
  assert.equal(isPaid({ status: "complete" }), false);
  const e = new SpollyError({ status: 500, code: "erro_interno", message: "x" });
  assert.deepEqual(e.fields, {});
  assert.equal(e.idempotencyKey, "");
  assert.deepEqual(parseJSON(`{"amount":{"amount":12,"currency":"AOA"},"quantity":3,"unit_amount":"7"}`), {
    amount: { amount: 12n, currency: "AOA" },
    quantity: 3,
    unit_amount: "7",
  });
});

test("o webhook lê o dinheiro em bigint, como o cliente", () => {
  const corpo = `{"id":"evt_1","type":"payment.succeeded","created_at":"2026-10-16T10:00:00Z","mode":"test","merchant_id":"mer_1","api_version":"2026-10-16","data":{"object":{"id":"pay_1","amount":{"amount":1500000,"currency":"AOA"},"fee":{"amount":37500,"currency":"AOA"}}}}`;
  const e = constructEvent(corpo, sign(corpo, "whsec_1"), "whsec_1");
  assert.equal(e.data.object.amount.amount, 1500000n);
  assert.equal(e.data.object.fee.amount, 37500n);
});

test("cancelado entre a resposta e a espera: não espera, nem tenta outra vez", async () => {
  const ctl = new AbortController();
  let n = 0;
  const falso = async () => {
    n++;
    ctl.abort(new Error("cancelado a meio"));
    return new Response(`{"erro":"indisponivel","mensagem":"x"}`, { status: 503 });
  };
  const c = new SpollyPayments("sk_test_1", { fetch: falso });
  await assert.rejects(c.getAccount({ signal: ctl.signal }), /cancelado a meio/);
  assert.equal(n, 1);
});

const SUBSCRICAO = `{"id":"sub_8Kq2Lm4Rt8Vx1Zb6Nc3Kd0","object":"subscription","status":"active","amount":{"amount":500000,"currency":"AOA"},
"interval":"month","cycles":null,"cycle":2,"current_period_start":"2026-11-29T10:15:00Z","current_period_end":"2026-12-29T10:15:00Z",
"method":"mcx","renewal":"notice","cancel_at_period_end":true,"checkout_session_id":"cs_test_1","customer":{"email":"","name":"","phone":""},"metadata":{}}`;

test("as subscrições", async () => {
  responder = (_, p) =>
    p.caminho.endsWith("/portal")
      ? [201, {}, `{"object":"subscription_portal","subscription":"sub_8Kq2Lm4Rt8Vx1Zb6Nc3Kd0","url":"https://checkout.payments.spolly.ao/subscricao/l_abc","expires_at":"2026-12-02T09:00:00Z"}`]
      : [200, {}, SUBSCRICAO];
  const c = cliente();
  const s = await c.getSubscription("sub_8Kq2Lm4Rt8Vx1Zb6Nc3Kd0");
  assert.equal(s.status, "active");
  assert.equal(s.amount.amount, 500000n);
  assert.equal(s.cycles, null);
  assert.equal(s.renewal, Renewals.NOTICE);
  assert.equal(Renewals.AUTOMATIC, "automatic");
  assert.equal(Settlements.MERCHANT_ACCOUNT, "merchant_account");
  assert.equal(Settlements.BALANCE, "balance");
  assert.ok(Object.isFrozen(Settlements));
  assert.equal(ErrorCodes.PAID_TO_MERCHANT_ACCOUNT, "pago_na_conta_do_comerciante");
  assert.equal(PaymentMethods.BANK_TRANSFER, "bank_transfer");
  assert.equal(PaymentMethods.DIRECT_DEBIT, "direct_debit");
  await c.cancelSubscription("sub_8Kq2Lm4Rt8Vx1Zb6Nc3Kd0");
  await c.cancelSubscription("sub_8Kq2Lm4Rt8Vx1Zb6Nc3Kd0", { at_period_end: false }, { idempotencyKey: "cancelar-1" });
  const l = await c.createSubscriptionPortalLink("sub_8Kq2Lm4Rt8Vx1Zb6Nc3Kd0");
  assert.equal(l.url, "https://checkout.payments.spolly.ao/subscricao/l_abc");
  assert.deepEqual(
    pedidos.map((p) => [p.metodo, p.caminho, p.corpo]),
    [
      ["GET", "/v1/subscriptions/sub_8Kq2Lm4Rt8Vx1Zb6Nc3Kd0", ""],
      ["POST", "/v1/subscriptions/sub_8Kq2Lm4Rt8Vx1Zb6Nc3Kd0/cancel", "{}"],
      ["POST", "/v1/subscriptions/sub_8Kq2Lm4Rt8Vx1Zb6Nc3Kd0/cancel", `{"at_period_end":false}`],
      ["POST", "/v1/subscriptions/sub_8Kq2Lm4Rt8Vx1Zb6Nc3Kd0/portal", ""],
    ],
  );
  assert.equal(pedidos[2].cab["idempotency-key"], "cancelar-1");
  assert.match(pedidos[3].cab["idempotency-key"], UUID4);
  assert.equal(pedidos[3].cab["content-type"], undefined);

  responder = () => [409, {}, `{"erro":"subscricao_terminada","mensagem":"Já terminou."}`];
  await assert.rejects(c.createSubscriptionPortalLink("sub_1"), (e) => e.code === ErrorCodes.SUBSCRIPTION_ENDED);
  responder = () => [404, {}, `{"erro":"subscricao_nao_existe","mensagem":"Não há."}`];
  await assert.rejects(c.getSubscription("sub_1"), (e) => e.code === ErrorCodes.SUBSCRIPTION_NOT_FOUND);
  responder = () => [201, {}, `{"object":"subscription_portal","url":""}`];
  await assert.rejects(c.createSubscriptionPortalLink("sub_1"), SpollyInvalidResponseError);
  responder = () => [201, {}, `{"object":"outra","url":"x"}`];
  await assert.rejects(c.createSubscriptionPortalLink("sub_1"), SpollyInvalidResponseError);
  responder = () => [201, {}, `{"object":"subscription_portal"}`];
  await assert.rejects(c.createSubscriptionPortalLink("sub_1"), SpollyInvalidResponseError);
});
