# Tarefa: corrigir duplicidade nas tabelas de preço

## Entendimento

- A busca de `/tabelas-preco` misturava o catálogo legado de `breads` com os
  produtos unificados em `products`, exibindo o mesmo item mais de uma vez.
- As chaves únicas de preços e de preços especiais não incluíam
  `sale_option_id`, apesar da tela diferenciar unidade e quilo.
- Itens removidos não eram carregados; uma nova inclusão tentava duplicar a
  linha já existente e inativa.

## Plano executado

- [x] Auditar código, dados e constraints sem alterar preços ou cadastros.
- [x] Priorizar o produto unificado e ocultar o pão legado no seletor quando
  ambos representam o mesmo item.
- [x] Reativar o preço inativo em vez de inserir uma segunda linha.
- [x] Aplicar migration que inclui `sale_option_id` nas chaves únicas de
  tabelas e overrides, preservando a unicidade de itens legados.
- [x] Adicionar testes de identidade do catálogo e validar TypeScript, testes,
  lint, build e as constraints aplicadas no banco.

## Fora desta entrega

- Não alterar preços, clientes, produtos ou itens existentes.
- Não alterar autenticação, PINs, roles, RLS ou telas fora de `/tabelas-preco`.
- Não fazer deploy ou push direto na `main`.
