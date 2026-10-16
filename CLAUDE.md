# spolly-payments-js: instruções

O SDK em JavaScript do Spolly Payments. É o submódulo `sdk-js/` do super projeto
`spolly-payments`; as regras da raiz (`../CLAUDE.md`, `../.claude/rules/`) valem
aqui.

## Estado

O SDK é o **cartão 10.2** do `TASKS-PROGRESS.md` da raiz e do quadro no Notion.
**Já existe** a verificação dos webhooks (`src/webhook.js`, exportado como
`@spolly-ao/spolly-payments/webhook`: `constructEvent`, `verifySignature`,
`sign`, `WebhookVerificationError` com `code` um dos `Reasons`), com a mesma
semântica do pacote `webhook` do SDK em Go, testes em `test/` (`node:test`, 100%
de cobertura de linhas, ramos e funções) e um servidor de exemplo em
`examples/receber-webhooks.js`. O cliente da API (sessões, estornos) ainda não.

## Comandos

```bash
node --run test                                              # testes e cobertura (falha abaixo de 100%)
SPOLLY_WEBHOOK_SECRETS=whsec_... node examples/receber-webhooks.js 8099
```

## Regras que valem aqui

- **Zero dependências de execução.** ESM, Node 22 ou mais recente.
- **O contrato é o da raiz**: `contratos/openapi.yaml` e `contratos/eventos/`.
- **Dinheiro em unidades menores inteiras**, nunca um `number` com casas
  decimais a meio de uma conta.
- **A verificação da assinatura** usa `crypto.timingSafeEqual` sobre o corpo
  bruto, e recusa um `t` fora da tolerância.
- Documentação, comentários e mensagens de erro em português europeu, sem
  travessão.
- Commits só pelos scripts da raiz (`../scripts/commit.sh`).
