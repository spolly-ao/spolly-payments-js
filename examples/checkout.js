// O percurso inteiro de uma integração em Node, com o SDK: confirma a chave,
// cria uma sessão de checkout, espera pelo webhook payment.succeeded dessa
// sessão (verificado com constructEvent), e lê a sessão no fim para a dar por
// paga. Sem dependências: só node:http e o fetch do Node.
//
//   SPOLLY_SECRET_KEY=sk_test_... SPOLLY_WEBHOOK_SECRETS=whsec_... \
//   SPOLLY_API_URL=http://localhost:8084 node examples/checkout.js [porta]
//
// O endpoint do webhook, no painel, aponta para http://127.0.0.1:<porta>/webhooks/spolly
// (7400 por omissão) e subscreve payment.succeeded. O programa escreve o URL
// do checkout: abre-se e paga-se (em modo teste, "Aprovar"). Sai com 0 quando o
// webhook chegou com a assinatura válida e a sessão está paga, e com 1 em
// qualquer outro caso.

import { createServer } from "node:http";

import { constructEvent, isPaid, SIGNATURE_HEADER, SpollyPayments, WebhookVerificationError } from "../src/index.js";

const chave = process.env.SPOLLY_SECRET_KEY ?? "";
const segredos = (process.env.SPOLLY_WEBHOOK_SECRETS ?? "").split(/[,\s]+/).filter(Boolean);
const porta = Number(process.argv[2] ?? 7400);
const esperaMs = Number(process.env.SPOLLY_ESPERA_S ?? 600) * 1000;

if (!chave || segredos.length === 0) {
  console.error("checkout: faltam SPOLLY_SECRET_KEY (a sk_test_) e SPOLLY_WEBHOOK_SECRETS (o whsec_ do endpoint)");
  process.exit(1);
}

const spolly = new SpollyPayments(chave, { baseURL: process.env.SPOLLY_API_URL, userAgent: "exemplo-checkout" });

// 1. A chave é de quem, e em que modo?
const conta = await spolly.getAccount();
console.log(`chave de ${conta.nome_comercial} (${conta.merchant_id}), modo ${conta.modo}`);

// 2. Quem recebe os webhooks, já à escuta antes de haver sessão.
let aEspera = null; // a função que resolve quando o webhook da sessão chega
const servidor = createServer((req, res) => {
  const partes = [];
  req.on("data", (p) => partes.push(p));
  req.on("end", () => {
    let evento;
    try {
      // O corpo bruto, tal como chegou: é sobre ele que a assinatura se calcula.
      evento = constructEvent(Buffer.concat(partes), req.headers[SIGNATURE_HEADER.toLowerCase()], segredos);
    } catch (e) {
      if (!(e instanceof WebhookVerificationError)) throw e;
      console.log(`webhook recusado pelo SDK: ${e.message}`);
      res.writeHead(400).end();
      return;
    }
    res.writeHead(200).end();
    if (evento.type === "payment.succeeded") aEspera?.(evento);
  });
});
await new Promise((r) => servidor.listen(porta, "127.0.0.1", r));
console.log(`a receber webhooks em http://127.0.0.1:${servidor.address().port}/webhooks/spolly`);

try {
  // 3. A sessão. A Idempotency-Key vai sozinha.
  const sessao = await spolly.createCheckoutSession({
    amount: 250000n, // 2.500,00 Kz
    currency: "AOA",
    description: "Ensaio do SDK em JavaScript",
    metadata: { order_id: `sdk-js-${Date.now()}` },
  });
  console.log(`sessão ${sessao.id} criada, ${sessao.amount.amount} ${sessao.amount.currency}, ${sessao.status}`);
  console.log(`abre e paga: ${sessao.url}`);

  // 4. O webhook é a fonte da verdade.
  const evento = await new Promise((resolve, reject) => {
    const limite = setTimeout(() => reject(new Error(`o webhook payment.succeeded da sessão ${sessao.id} não chegou`)), esperaMs);
    aEspera = (e) => {
      if (e.data.object.checkout_session_id !== sessao.id) return;
      clearTimeout(limite);
      resolve(e);
    };
  });
  const pago = evento.data.object;
  console.log(`webhook ${evento.id}: pagamento ${pago.id} de ${pago.amount.amount} ${pago.amount.currency}, assinatura válida pelo SDK`);

  // 5. E a sessão diz o mesmo.
  const lida = await spolly.getCheckoutSession(sessao.id);
  if (!isPaid(lida) || lida.payment.id !== pago.id) {
    throw new Error(`a sessão ${lida.id} está ${lida.status}, e o webhook dizia paga por ${pago.id}`);
  }
  console.log(`sessão ${lida.id} ${lida.status}, paga por ${lida.payment.id} (${lida.payment.method})`);
} catch (e) {
  console.error(`checkout: ${e.message}`);
  process.exitCode = 1;
} finally {
  servidor.close();
}
