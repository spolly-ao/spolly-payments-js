# spolly-payments-js

O SDK em JavaScript do [Spolly Payments](https://github.com/spolly-ao/spolly-payments),
para servidores em Node: criar e ler sessões de checkout, estornar, confirmar a
conta da chave, gerir as contas ligadas de uma plataforma, e verificar a
assinatura dos webhooks. ESM, Node 22 ou mais
recente, **sem dependências**, com os tipos para TypeScript (`src/index.d.ts`,
`src/webhook.d.ts`).

```bash
npm install github:spolly-ao/spolly-payments-js#v0.9.0
```

O repositório é público: instala-se diretamente do GitHub, sem credenciais. O
pacote fica com o nome `@spolly-ao/spolly-payments`, que é o que se importa.

## Os nomes, que não mudam

| Módulo | Nome | O que é |
|---|---|---|
| `@spolly-ao/spolly-payments` | `new SpollyPayments(chave, { baseURL, timeoutMs, maxRetries, fetch, userAgent })` | O cliente |
| | `createCheckoutSession(params, { idempotencyKey, signal })` | `POST /v1/checkout/sessions` |
| | `getCheckoutSession(id, { signal })` | `GET /v1/checkout/sessions/{id}` |
| | `createRefund(params, { idempotencyKey, signal })` | `POST /v1/refunds` |
| | `getRefund(id, { signal })` | `GET /v1/refunds/{id}` |
| | `getAccount({ signal })` | `GET /v1/conta` |
| | `getSubscription(id, { signal })` | `GET /v1/subscriptions/{id}` |
| | `cancelSubscription(id, { at_period_end }, { idempotencyKey, signal })` | `POST /v1/subscriptions/{id}/cancel` (no fim do ciclo, por omissão) |
| | `createSubscriptionPortalLink(id, { idempotencyKey, signal })` | `POST /v1/subscriptions/{id}/portal`: o link de uso único da página do cliente |
| | `createCoupon(params, { idempotencyKey, signal })` | `POST /v1/coupons` |
| | `listCoupons({ limit, starting_after, code }, { signal })` | `GET /v1/coupons` |
| | `getCoupon(id, { signal })` | `GET /v1/coupons/{id}` |
| | `updateCoupon(id, { name, max_redemptions, expires_at, active, metadata }, { signal })` | `PATCH /v1/coupons/{id}` (`null` tira o limite ou a data) |
| | `withAccount(mer_)`, `account` | Um cliente que age em nome de uma conta ligada (cabeçalho `Spolly-Account`) |
| | `createAccount(params, { idempotencyKey, signal })` | `POST /v1/accounts` |
| | `listAccounts({ limit, starting_after, reference }, { signal })` | `GET /v1/accounts` |
| | `getConnectedAccount(id, { signal })` | `GET /v1/accounts/{id}` |
| | `updateAccount(id, params, { signal })` | `PATCH /v1/accounts/{id}` |
| | `uploadAccountDocument(id, { type, file, filename }, { idempotencyKey, signal })` | `POST /v1/accounts/{id}/documents`, em multipart |
| | `setAccountBankAccount(id, { iban, holder, holder_tax_id, proof_document }, { signal })` | `PUT /v1/accounts/{id}/bank_account` |
| | `getAccountBalance(id, { signal })` | `GET /v1/accounts/{id}/balance` |
| | `createAccountPayout(id, { amount, currency, metadata }, { idempotencyKey, signal })` | `POST /v1/accounts/{id}/payouts` |
| | `listAccountPayouts(id, { signal })` | `GET /v1/accounts/{id}/payouts` |
| | `getAccountPayout(id, payoutId, { signal })` | `GET /v1/accounts/{id}/payouts/{payout_id}` |
| | `SpollyError` (`status`, `code`, `userMessage`, `fields`, `idempotencyKey`), `ErrorCodes` | As recusas da API |
| | `SpollyConnectionError`, `SpollyInvalidResponseError` | A API não respondeu; uma resposta que não se lê |
| | `PaymentMethods` (com `BANK_TRANSFER` e `DIRECT_DEBIT`, só em AOA e só quando pedidos por nome), `Renewals` (`AUTOMATIC`, `NOTICE`: o `renewal` da subscrição), `Settlements` (`BALANCE`, `MERCHANT_ACCOUNT`: o `settlement` de um pagamento; na transferência bancária, o dinheiro entra direto na conta do comerciante, que o confirma no painel, e a taxa sai do saldo dele; uma transferência não se estorna pela API, `PAID_TO_MERCHANT_ACCOUNT`) | Os valores do contrato |
| | `DocumentTypes` (`IDENTITY_DOCUMENT`, `BANK_ACCOUNT_PROOF`), `ACCOUNT_HEADER` | Os documentos da verificação de uma conta ligada; o nome do cabeçalho |
| | `isPaid(sessao)`, `newIdempotencyKey()`, `parseJSON(texto)` | Ajudas |
| `@spolly-ao/spolly-payments/webhook` (e reexportados na raiz) | `constructEvent`, `verifySignature`, `sign`, `WebhookVerificationError`, `Reasons`, `SIGNATURE_HEADER` | A assinatura dos webhooks |

São os mesmos do SDK em Go (`CreateCheckoutSession` é `createCheckoutSession`),
e os parâmetros e as respostas têm os nomes da API (`payment_methods`,
`success_url`), tal como estão no `contratos/openapi.yaml`.

## Início rápido

```js
import { SpollyPayments, constructEvent, isPaid } from "@spolly-ao/spolly-payments";

const spolly = new SpollyPayments(process.env.SPOLLY_SECRET_KEY); // sk_test_... ou sk_live_...

// 1. Criar a sessão e mandar o comprador para o checkout alojado.
const sessao = await spolly.createCheckoutSession({
  amount: 1500000n, // 15.000,00 Kz, em unidades menores
  currency: "AOA",
  description: "Vestido de capulana",
  success_url: "https://kiala.ao/obrigado?pedido=1042",
  metadata: { order_id: "1042" },
});
res.redirect(303, sessao.url);

// 2. O webhook é a fonte da verdade: só ele dá a encomenda por paga.
app.post("/webhooks/spolly", express.raw({ type: "application/json" }), (req, res) => {
  const evento = constructEvent(req.body, req.get("Spolly-Signature"), process.env.SPOLLY_WEBHOOK_SECRET); // lança se não bater
  if (evento.type === "payment.succeeded") {
    marcarPaga(evento.data.object.checkout_session_id); // idempotente: deduplicar por evento.id
  }
  res.sendStatus(200);
});

// 3. No regresso, ler a sessão só para mostrar o estado certo.
const lida = await spolly.getCheckoutSession(req.query.session_id);
res.render(isPaid(lida) ? "pago" : "a-confirmar");
```

Em desenvolvimento, contra a API local:
`new SpollyPayments(chave, { baseURL: "http://localhost:8084" })`.

## Dinheiro em `bigint`

Os valores (`amount`, `unit_amount`, e o `amount_off` de um cupão) **chegam em `bigint`**, lidos do texto da
resposta sem passar por um `number`: `sessao.amount.amount` é `1500000n`. À
entrada aceitam-se em `bigint`, em `number` inteiro, ou em texto só com
algarismos; um valor com casas decimais é recusado antes de sair. O
`constructEvent` dos webhooks lê-os da mesma forma. Para mostrar, formata-se no
fim; nunca se divide por 100 num `number`.

## Estornar

```js
import { SpollyError, ErrorCodes } from "@spolly-ao/spolly-payments";

try {
  const estorno = await spolly.createRefund(
    { payment_id: "pay_9Hq2Lm4Rt8Vx1Zb6Nc3Kd0", amount: 500000n, reason: "Devolução parcial." }, // sem amount, estorna o que resta
    { idempotencyKey: "pedido-1042-estorno-1" },
  );
} catch (e) {
  if (e instanceof SpollyError && e.code === ErrorCodes.REFUND_EXCEEDS_CHARGED) {
    // nunca mais do que o que resta do pagamento
  }
}
```

## Subscrições

```js
await spolly.createCheckoutSession({
  amount: 500000n, currency: "AOA", description: "Plano mensal",
  kind: "subscription",
  subscription: { interval: "month", cycles: 12 }, // sem cycles: até cancelar
});

// Depois do primeiro pagamento, a sessão tem o id da subscrição.
const sub = await spolly.getSubscription(lida.subscription.id);
const { url } = await spolly.createSubscriptionPortalLink(sub.id); // mandar ao cliente
await spolly.cancelSubscription(sub.id); // no fim do ciclo pago; { at_period_end: false } termina já
```

Um cupão que vale só no primeiro ciclo: `subscription: { interval: "month",
first_cycle_amount: 250000n }`. O primeiro pagamento cobra-o, e as renovações
cobram o `amount` (no cartão, o Stripe renova sozinho pelo preço cheio). Um
cancelamento no fim do ciclo dá dois `subscription.cancelled`: o do pedido, com a
subscrição ainda `active`, e o do fim, com `status` `cancelled`; corta-se o
acesso pelo segundo.

## Cupões

Um cupão é de percentagem (`percent_off`) ou de valor fixo (`amount_off` com
`currency`, e só vale nessa moeda). Numa subscrição vale no primeiro ciclo
(`once`), nos primeiros N (`repeating` com `duration_cycles`) ou em todos
(`forever`). O desconto não muda depois de criado.

```js
const cupao = await spolly.createCoupon({
  code: "BEMVINDO10", percent_off: 10, duration: "repeating", duration_cycles: 3, max_redemptions: 100,
});

// Aplicado já pela loja (recusa: ErrorCodes.COUPON_INVALID, 422):
const sessao = await spolly.createCheckoutSession({
  amount: 1500000n, currency: "AOA", description: "Plano mensal", coupon: cupao.code,
});
// sessao.discount.amount.amount é quanto desconta; sessao.amount continua a ser o preço.

// Ou escrito pelo comprador no checkout:
await spolly.createCheckoutSession({ amount: 1500000n, currency: "AOA", description: "Vestido", allow_promotion_codes: true });

// Desativar: deixa de se aplicar, e quem já o tem fica com ele.
await spolly.updateCoupon(cupao.id, { active: false });
```

O `payment` do `payment.succeeded` traz o `amount` já descontado, a `fee` sobre
ele e o `discount`; a subscrição traz o `discount` com os `cycles` que cobre.
Um cupão não vai com o `first_cycle_amount` de um plano.

## Comissão de plataforma

Uma plataforma que vende em nome de um comerciante cria a sessão com a chave
dele e fica com uma comissão no próprio pagamento. O comerciante tem de a ter
autorizado no painel, com um máximo.

```js
const hotel = new SpollyPayments(process.env.CHAVE_DO_HOTEL);
const sessao = await hotel.createCheckoutSession({
  amount: 1500000n, currency: "AOA", description: "Duas noites",
  platform_fee: { platform: "mer_38IAs7qmknSwC1F9XYtR1b", amount: 150000n },
});
// Recusas: ErrorCodes.PLATFORM_NOT_AUTHORIZED (403),
// PLATFORM_FEE_ABOVE_MAXIMUM e PLATFORM_FEE_INVALID (422).
// No payment.succeeded, data.object.platform_fee diz o que a plataforma
// recebeu, e o net é o que fica ao comerciante.
```

## Contas ligadas

Uma plataforma com as contas ligadas habilitadas pela equipa do Spolly Payments
cria e gere pela API os vendedores que vendem por ela, e o vendedor nunca fala
connosco. Sem habilitação, estas operações dão 403
`ErrorCodes.CONNECTED_ACCOUNTS_NOT_ENABLED`.

```js
import { readFile } from "node:fs/promises";
import { DocumentTypes } from "@spolly-ao/spolly-payments";

const spolly = new SpollyPayments(process.env.SPOLLY_SECRET_KEY); // a chave da plataforma

// 1. O vendedor, no modo da chave. Só o name é obrigatório.
const conta = await spolly.createAccount({
  name: "Kizomba Eventos", legal_name: "Joana Manuel",
  email: "joana@kizomba.ao", reference: "vendedor_481",
});

// 2. A verificação: o documento de identificação, o comprovativo do IBAN, e a conta bancária.
await spolly.uploadAccountDocument(conta.id, {
  type: DocumentTypes.IDENTITY_DOCUMENT,
  file: new Blob([await readFile("bi.pdf")]), filename: "bi.pdf", // ou um File, um Buffer, um Uint8Array
});
const comprovativo = await spolly.uploadAccountDocument(conta.id, {
  type: DocumentTypes.BANK_ACCOUNT_PROOF, file: await readFile("iban.pdf"), filename: "iban.pdf",
});
await spolly.setAccountBankAccount(conta.id, {
  iban: "AO06004000010123456789012", holder: "Joana Manuel", proof_document: comprovativo.id,
});
// conta.verification.status e conta.verification.missing dizem o que falta;
// o account.updated avisa quando muda. Em teste, aprova-se sozinha.

// 3. Cobrar em nome da conta: withAccount manda o cabeçalho Spolly-Account.
const vendedor = spolly.withAccount(conta.id);
const sessao = await vendedor.createCheckoutSession({
  amount: 1500000n, currency: "AOA", description: "Bilhete",
  platform_fee: { amount: 150000n }, // a plataforma da comissão é a da chave
});

// 4. O saldo e os saques.
const saldo = await spolly.getAccountBalance(conta.id);
// saldo.available, pending e reserved: listas de { amount: bigint, currency }, e podem ser negativos.
const saque = await spolly.createAccountPayout(conta.id, { amount: 2500000n }); // só AOA, e pelo menos o mínimo da conta (5.000 Kz por omissão)
```

- `withAccount` devolve um cliente novo, com a mesma chave e a mesma
  configuração; o original continua a ser da plataforma. Serve para as sessões,
  os estornos, as subscrições e o `getAccount`. As operações de `/v1/accounts`
  nunca mandam o cabeçalho (a API recusa-o nelas), porque a conta vai no
  caminho.
- `listAccounts` devolve `{ object: "list", data, has_more }`; a página
  seguinte pede-se com `starting_after` igual ao `id` da última.
- O documento vai em `multipart/form-data`, com a `Idempotency-Key` como os
  outros `POST` (a mesma nas retentativas). O `PATCH` e o `PUT` não a levam.
- Os saques passam por `pending`, `processing` e `paid`, ou `failed` (o valor
  volta ao disponível), e cada passo chega como evento.
- Recusas próprias: `ACCOUNT_NOT_FOUND`, `PAYOUT_NOT_FOUND`, `REFERENCE_TAKEN`,
  `VERIFICATION_LOCKED`, `TOO_MANY_DOCUMENTS`, `ACCOUNT_NOT_VERIFIED`,
  `BANK_ACCOUNT_NOT_VERIFIED`, `NEGATIVE_BALANCE`, `INSUFFICIENT_BALANCE`,
  `PAYOUT_REFUSED`.

Os eventos de uma conta ligada chegam aos webhooks da plataforma (o
`merchant_id` é a plataforma), com a conta em `evento.account`; sem esse campo,
o evento é do próprio comerciante. Há quatro tipos novos: `account.updated` (o
objeto é a conta), `balance.available` (o saldo), `payout.created` e
`payout.processing`, além do `payout.paid` e do `payout.failed`.

```js
if (evento.account && evento.type === "payout.paid") {
  marcarSaquePago(evento.account, evento.data.object.id);
}
```

## Um pagamento em análise

O antifraude da Spolly pode reter um pagamento depois de confirmado: o
`payment.succeeded` chega na mesma, mas o dinheiro fica no pendente até a
equipa o libertar. Chegam mais dois eventos, com o mesmo pagamento no objeto:

```js
if (evento.type === "payment.held") {
  // Retido: entrega a encomenda se quiseres, mas o dinheiro ainda não sai.
}
if (evento.type === "payment.released") {
  // Libertado: segue para o disponível na libertação seguinte.
}
```

Se a equipa confirmar a fraude, o pagamento é estornado ao comprador e chega o
`refund.created`.

## O que o cliente faz sozinho

- **Idempotência.** Todos os `POST` levam `Idempotency-Key`. Sem
  `idempotencyKey`, gera-se um UUID por chamada, o mesmo em todas as
  retentativas dessa chamada.
- **Retentativas.** Falha de rede, tempo esgotado, 429, 500, 502, 503 e 504
  repetem-se até `maxRetries` vezes (2 por omissão), com espera exponencial e
  aleatória, e com o `Retry-After` quando vem (até 30 s). Um 4xx nunca se repete.
- **Tempo limite.** 30 segundos por tentativa (`timeoutMs`); o `signal` de quem
  chama manda sobre tudo.
- **Uma resposta que não se lê** lança `SpollyInvalidResponseError`, e nunca
  devolve um objeto vazio.

## Verificar um webhook, só

```js
import { constructEvent } from "@spolly-ao/spolly-payments/webhook";

// Com o corpo bruto (Buffer ou texto), nunca um objeto já lido.
const evento = constructEvent(corpoBruto, req.headers["spolly-signature"], process.env.SPOLLY_WEBHOOK_SECRET);
// Lança WebhookVerificationError (code: no_header, malformed_header, no_signature,
// signature_mismatch, timestamp_outside_tolerance, invalid_payload, no_secret).
```

A tolerância é de 300 segundos por omissão (`{ toleranceSeconds }`); na rotação
do segredo passa-se uma lista com os dois.

## Exemplos

- `examples/checkout.js`: o percurso inteiro. Confirma a chave, cria uma
  sessão, espera pelo webhook `payment.succeeded` dessa sessão (verificado com o
  SDK) e lê a sessão no fim.

  ```bash
  SPOLLY_SECRET_KEY=sk_test_... SPOLLY_WEBHOOK_SECRETS=whsec_... \
  SPOLLY_API_URL=http://localhost:8084 node examples/checkout.js 7400
  ```

- `examples/receber-webhooks.js`: só o servidor que recebe e verifica, com
  `node:http`.
