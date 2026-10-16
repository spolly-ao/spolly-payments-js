// Um servidor de comerciante em Node que recebe os webhooks do Spolly Payments
// e verifica cada um com o SDK. Sem dependências: só node:http.
//
//   SPOLLY_WEBHOOK_SECRETS=whsec_... node examples/receber-webhooks.js [porta]
//
// Responde 200 a um evento com assinatura válida e 400 a qualquer outro, e
// conta as receções de cada id (as retentativas e o reenvio do painel trazem o
// mesmo id; um servidor a sério deduplica por ele).

import { createServer } from "node:http";

import { constructEvent, SIGNATURE_HEADER, WebhookVerificationError } from "../src/webhook.js";

const segredos = (process.env.SPOLLY_WEBHOOK_SECRETS ?? "").split(/[,\s]+/).filter(Boolean);
if (segredos.length === 0) {
  console.error("receber-webhooks: falta SPOLLY_WEBHOOK_SECRETS, o whsec_ do endpoint");
  process.exit(2);
}
const porta = Number(process.argv[2] ?? 8099);
const vistos = new Map();

const responder = (res, codigo, corpo) => {
  res.writeHead(codigo, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(corpo));
};

createServer((req, res) => {
  if (req.method !== "POST") return responder(res, 405, { erro: "só POST" });
  const partes = [];
  req.on("data", (p) => partes.push(p));
  req.on("end", () => {
    // O corpo bruto, tal como chegou: é sobre ele que a assinatura se calcula.
    const corpo = Buffer.concat(partes);
    try {
      const evento = constructEvent(corpo, req.headers[SIGNATURE_HEADER.toLowerCase()], segredos);
      const n = (vistos.get(evento.id) ?? 0) + 1;
      vistos.set(evento.id, n);
      console.log(`RECEBIDO ${evento.id} ${evento.type} ${evento.mode} ${evento.merchant_id}, assinatura válida pelo SDK, receção n.º ${n}`);
      responder(res, 200, { recebido: true, evento: evento.id, rececao: n });
    } catch (e) {
      if (!(e instanceof WebhookVerificationError)) throw e;
      console.log(`RECUSADO pelo SDK: ${e.message}`);
      responder(res, 400, { erro: "assinatura_invalida", motivo: e.code });
    }
  });
}).listen(porta, "127.0.0.1", () => console.log(`a escutar em 127.0.0.1:${porta}, a verificar com o SDK spolly-payments-js`));
