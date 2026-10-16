# spolly-payments-js

O SDK em JavaScript do [Spolly Payments](https://github.com/spolly-ao/spolly-payments),
para clientes externos em Node: criar e consultar sessões de checkout, estornar,
e verificar a assinatura dos webhooks.

> **Ainda sem código.** O SDK é o cartão 10.2 do quadro, e nasce depois do SDK em
> Go (cartão 10.1), com o mesmo contrato. Até lá este repositório guarda o lugar
> e as regras.

## O que vai ser

- ESM, Node 22 ou mais recente, **sem dependências**.
- As mesmas operações e a mesma verificação de assinatura do SDK em Go.
- Os tipos seguem os contratos do super projeto (`contratos/`).
- Dinheiro em unidades menores inteiras, transportado sem passar por vírgula
  flutuante.
