# spolly-payments-js: instruções

O SDK em JavaScript do Spolly Payments. É o submódulo `sdk-js/` do super projeto
`spolly-payments`; as regras da raiz (`../CLAUDE.md`, `../.claude/rules/`) valem
aqui.

## Estado

O SDK é o **cartão 10.2** do `TASKS-PROGRESS.md` da raiz e do quadro no Notion.

| Ficheiro | O que é |
|---|---|
| `src/index.js` | O cliente: `SpollyPayments` com `createCheckoutSession`, `getCheckoutSession`, `createRefund`, `getRefund`, `getAccount`, `getSubscription`, `cancelSubscription`, `createSubscriptionPortalLink`; `Idempotency-Key` automática (a mesma nas retentativas), retentativas em rede, tempo esgotado, 429 e 5xx com `Retry-After`; `SpollyError`, `SpollyConnectionError`, `SpollyInvalidResponseError`, `ErrorCodes`; reexporta o `webhook.js` |
| `src/json.js` | O dinheiro em JSON: `amount` e `unit_amount` leem-se para `bigint` a partir do texto (`JSON.parse` com a fonte) e escrevem-se com `JSON.rawJSON` |
| `src/webhook.js` | A verificação dos webhooks (`constructEvent`, `verifySignature`, `sign`, `WebhookVerificationError` com `code` um dos `Reasons`), com a mesma semântica do pacote `webhook` do SDK em Go |
| `src/index.d.ts`, `src/webhook.d.ts` | Os tipos, escritos à mão |
| `examples/checkout.js` | O percurso inteiro contra a API e o worker: foi assim que o cartão 10.2 se verificou |
| `examples/receber-webhooks.js` | Só o servidor que recebe e verifica |

Testes em `test/` (`node:test`, 100% de linhas, ramos e funções, e o mesmo em
Node 22). **Os nomes exportados são estáveis** (a documentação em
`payments.spolly.ao/docs` cita-os), e são os do SDK em Go em `camelCase`.

## Comandos

```bash
node --run test                                              # testes e cobertura (falha abaixo de 100%)
SPOLLY_WEBHOOK_SECRETS=whsec_... node examples/receber-webhooks.js 8099
SPOLLY_SECRET_KEY=sk_test_... SPOLLY_WEBHOOK_SECRETS=whsec_... SPOLLY_API_URL=http://localhost:8084 node examples/checkout.js 7400
npx -y node@22 --run test                                    # o mesmo, no Node mais antigo que se aceita
```

Os tipos verificam-se com o `tsc` de outra peça, sem o trazer como dependência:
um ficheiro `.ts` fora do repositório que importa `src/index.js` e usa cada
operação, com `tsc --strict --noEmit --module nodenext`.

## Regras que valem aqui

- **Zero dependências de execução.** ESM, Node 22 ou mais recente.
- **O contrato é o da raiz**: `contratos/openapi.yaml` e `contratos/eventos/`.
- **Dinheiro em unidades menores inteiras**, e em `bigint` à saída (regra
  `o-dinheiro.md`): nunca um `number` com casas decimais a meio de uma conta.
- **A verificação da assinatura** usa `crypto.timingSafeEqual` sobre o corpo
  bruto, e recusa um `t` fora da tolerância.
- Documentação, comentários e mensagens de erro em português europeu, sem
  travessão.
- Commits só pelos scripts da raiz (`../scripts/commit.sh`).
