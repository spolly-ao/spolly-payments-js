# spolly-payments-js

O SDK em JavaScript do [Spolly Payments](https://github.com/spolly-ao/spolly-payments),
para clientes externos em Node: criar e consultar sessões de checkout, estornar,
e verificar a assinatura dos webhooks.

> **Já tem a verificação dos webhooks.** O cliente da API (sessões, estornos) é o
> resto do cartão 10.2.

## Verificar um webhook

```js
import { constructEvent } from "@spolly-ao/spolly-payments/webhook";

// Com o corpo bruto (Buffer ou texto), nunca um objeto já lido.
const evento = constructEvent(corpoBruto, req.headers["spolly-signature"], process.env.SPOLLY_WEBHOOK_SECRET);
// Lança WebhookVerificationError (code: no_header, malformed_header, no_signature,
// signature_mismatch, timestamp_outside_tolerance, invalid_payload, no_secret).
// Deduplicar por evento.id: as retentativas e o reenvio do painel repetem-no.
```

A tolerância é de 300 segundos por omissão (`{ toleranceSeconds }`); na rotação
do segredo passa-se uma lista com os dois. `examples/receber-webhooks.js` é um
servidor completo, só com `node:http`.

## O que vai ser

- ESM, Node 22 ou mais recente, **sem dependências**.
- As mesmas operações e a mesma verificação de assinatura do SDK em Go.
- Os tipos seguem os contratos do super projeto (`contratos/`).
- Dinheiro em unidades menores inteiras, transportado sem passar por vírgula
  flutuante.
