# spolly-payments-js: instruções

O SDK em JavaScript do Spolly Payments. É o submódulo `sdk-js/` do super projeto
`spolly-payments`; as regras da raiz (`../CLAUDE.md`, `../.claude/rules/`) valem
aqui.

## Estado

Sem código ainda. O trabalho é o **cartão 10.2** do `TASKS-PROGRESS.md` da raiz e
do quadro no Notion, e vem depois do SDK em Go (10.1), com o mesmo contrato.

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
