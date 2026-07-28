# Auditoria live Supabase RLS — 2026-07-28

**Projeto:** `PanePedidosLojas` (`gohluceldchoitihrimw`)

**Modo:** somente leitura via `supabase db query --linked` e
`supabase db advisors --linked`. Nenhuma tabela de negócio foi lida linha a
linha; a auditoria consultou metadados de Postgres, grants, policies, funções e
advisors.

## Objetivo

Atualizar o mapa real de segurança depois do baseline de migrations e dos PRs
de hardening incorporados em julho. O inventário antigo de 2026-06-13 dizia que
havia tabelas públicas do ERP com RLS desligado e policies anônimas amplas. Esta
auditoria verificou o estado real após a PR 182.

## Fontes

- `supabase projects list --output json`;
- `supabase/.temp/project-ref`;
- `supabase/config.toml`;
- catálogos Postgres: `pg_class`, `pg_namespace`, `pg_policies`, `pg_proc` e
  privilégios efetivos com `has_table_privilege`, `has_function_privilege` e
  `has_schema_privilege`;
- `supabase db advisors --linked --type security --level info --fail-on none`;
- código local para localizar uso das tabelas e RPCs.

## Resultado executivo

- O CLI está linkado ao projeto correto de produção:
  `PanePedidosLojas` (`gohluceldchoitihrimw`).
- O schema exposto segue sendo `public` e `graphql_public`.
- Todas as tabelas públicas auditadas estão com RLS ligado.
- Não foram encontradas policies para `anon`.
- Não foram encontradas policies com `USING true` ou `WITH CHECK true`.
- Não foram encontradas views ou materialized views em `public` ou
  `graphql_public`.
- Nenhuma função `SECURITY DEFINER` em `public` está executável por `anon` ou
  `PUBLIC`.
- As funções `SECURITY DEFINER` expostas a `authenticated` têm `search_path`
  configurado como vazio.

## Riscos ainda abertos

1. **ControlePizza ainda tem grant para `anon`.**
   As tabelas `pizza_categorias`, `pizza_despesas`, `pizza_usuarios` e
   `pizza_vendas` têm `SELECT`, `INSERT`, `UPDATE` e `DELETE` concedidos a
   `anon`. O repositório já registra que isso foi mantido por decisão do sistema
   legado ControlePizza. O efeito prático precisa ser decidido antes de qualquer
   revogação, porque pode quebrar o app de pizza.

2. **GraphQL expõe objetos demais.**
   O advisor aponta quatro objetos visíveis para `anon` via GraphQL, todos
   `pizza_*`, e 44 objetos visíveis para `authenticated`. Isso é
   descoberta/enumeração de superfície. A correção provável é desabilitar ou
   restringir GraphQL para estes objetos, mas deve ser feita em lote próprio,
   testando ERP e ControlePizza.

3. **Funções `SECURITY DEFINER` chamáveis por usuários logados.**
   O advisor aponta 15 funções. Elas não estão públicas para `anon` e várias
   são intencionais porque o frontend estático precisa chamar RPCs protegidas.
   Mesmo assim, cada função precisa manter validação interna de perfil, escopo
   e entrada. O primeiro lote de correção deve tratar somente funções cujo
   contrato já está claro, para não quebrar fluxo diário.

4. **Compras e cotações estão bloqueadas por ausência de policies.**
   Dez tabelas têm RLS ligado e nenhum policy:
   `purchase_items`, `purchase_lists`, `quotation_items`,
   `quotation_responses`, `quotation_suppliers`, `quotations`,
   `supplier_order_items`, `supplier_orders`, `supplier_products` e
   `app_users`. Para `app_users`, isso é desejável no estado atual. Para compras
   e cotações, combina com a pausa registrada no projeto; reativar esse fluxo
   exige PR própria de acesso e navegador.

5. **Proteção contra senha vazada está desligada no Supabase Auth.**
   O advisor recomenda ativar leaked-password protection. Isso é configuração
   externa do Auth, não migration, portanto exige decisão explícita antes de
   mexer.

## Diferença contra o inventário de 2026-06-13

O risco crítico de `anon` amplo no ERP foi reduzido. Em 2026-06-13 havia 13
tabelas com RLS desligado e muitas policies anônimas permissivas. Em
2026-07-28, o estado real mostra RLS ligado nas tabelas públicas do ERP e sem
policies `anon`.

O projeto ainda não deve declarar Sprint 0 concluída, porque restam decisões e
hardening em lotes: ControlePizza/anon, GraphQL, funções privilegiadas e
compras/cotações pausadas.

## Próximo lote recomendado

O próximo PR seguro não deve começar revogando `anon` do ControlePizza, porque
isso pode derrubar outro sistema. A ordem recomendada é:

1. revisar e testar as funções `SECURITY DEFINER` já usadas pelo ERP, uma área
   por vez, começando por Sobras ou Produção da Cozinha;
2. em paralelo, decidir com Rodrigo o futuro do acesso anônimo do ControlePizza;
3. só depois mexer em GraphQL/anon das tabelas `pizza_*`.
