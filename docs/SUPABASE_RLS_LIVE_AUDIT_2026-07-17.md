# Supabase Auth/RLS — auditoria live somente leitura

**Data:** 2026-07-17
**Projeto auditado:** PanePedidosLojas (`gohluceldchoitihrimw`, `sa-east-1`)
**Escopo:** configuração live, catálogo PostgreSQL, migrations, policies, grants, funções e Edge Functions. Nenhum dado de negócio, e-mail, PIN ou segredo foi lido.

## Resultado executivo

A base de Auth já está funcional para a transição: há 13 `app_profiles` ativos, distribuídos entre os perfis operacionais esperados; `app_profiles` está com RLS e FORCE RLS ligados e permite a cada usuário autenticado ler apenas o próprio perfil.

Isso não conclui a Sprint 0 de segurança. A auditoria confirmou duas exposições P0 no caminho legado anônimo:

1. `app_users` permite leitura anônima irrestrita e contém a coluna `pin`.
2. Há 35 policies de escrita anônima irrestrita, em 16 tabelas operacionais.

Também há desvio entre o histórico de migrations live e o repositório. Portanto, não é seguro supor que migrations locais representem a autorização ativa.

## Método e limites

Foram usadas somente consultas `SELECT` de catálogo e agregados, além de inventário read-only via Supabase. Não houve `INSERT`, `UPDATE`, `DELETE`, DDL, migração, alteração de Auth, execução de função de negócio ou chamada a Edge Function.

As contagens de perfis foram coletadas apenas por `role`, loja e status. A auditoria não acessou registros individuais de `app_users`, PINs, clientes, pedidos, preços ou dados financeiros.

## Controles confirmados

- As 49 tabelas listadas em `public` têm RLS habilitado.
- `app_profiles` tem RLS e FORCE RLS; sua única policy para `authenticated` é `SELECT` do próprio `user_id` via `auth.uid()`.
- O inventário agregado encontrou 13 profiles ativos: 2 administração global, 1 financeiro global, 3 produção JC, 2 expedição JC, 2 vendas EX, 1 vendas JA e 2 vendas JC.
- As funções transacionais de forno/sobras `SECURITY DEFINER` não concedem `EXECUTE` a `anon` e fixam `search_path` vazio.
- `cash_closings` tem RLS e FORCE RLS, com policies vinculadas a perfil ativo, papel e loja.

## Achados P0 — corrigir antes de novos dados financeiros

### P0-1 — `app_users` expõe PIN por leitura anônima

**Evidência:** a policy `anon_select_for_login` de `public.app_users` usa `USING (true)` para `anon`. O catálogo confirma que a tabela contém a coluna `pin`.

**Impacto:** qualquer pessoa com a chave pública do aplicativo pode consultar a fonte do login legado, incluindo PINs, roles, rotas e lojas. RLS estar ligado não mitiga uma policy explicitamente permissiva.

**Decisão de correção:** não remover esta policy isoladamente. Primeiro concluir a validação do login Auth por perfil/loja e substituir o fallback por PIN; então remover a dependência cliente de `app_users`, revogar seus grants anônimos e eliminar a policy em uma PR dedicada.

### P0-2 — escrita anônima irrestrita em operação

**Evidência:** 35 policies `anon` permitem `INSERT`, `UPDATE` ou `DELETE` com `USING (true)` e/ou `WITH CHECK (true)`, distribuídas por 16 tabelas. Há ainda leitura anônima irrestrita em 18 tabelas.

**Tabelas com escrita anônima irrestrita:**

- `bread_movements`, `breads`, `frozen_movements`, `orders`;
- `product_components`, `product_production`;
- `purchase_lists`, `purchase_items`;
- `quotations`, `quotation_items`, `quotation_suppliers`, `quotation_responses`;
- `shelf_counts`;
- `supplier_products`, `supplier_orders`, `supplier_order_items`.

**Impacto:** um cliente não autenticado pode alterar, inserir ou excluir registros operacionais nessas superfícies quando o grant correspondente está presente. Isso inclui pedidos, produção, compras e cotações.

**Decisão de correção:** fechar por módulo, não em lote global. Cada PR deve substituir somente as policies anônimas do módulo por policies de `authenticated` baseadas em `app_profiles`, role e loja, com teste visual de regressão antes de seguir ao módulo seguinte.

## Achados P1

### P1-1 — função de análise de desconto sem JWT

`analisar-desconto` está ativa com `verify_jwt: false`, aceita CORS de qualquer origem e chama um provedor de IA com segredo do servidor. Embora não grave no banco, permite uso externo sem autenticação, consumo de custo e envio de dados fornecidos pelo chamador ao provedor.

**Próxima PR sugerida:** exigir sessão válida, limitar origem/uso e revisar quais campos de cliente/produto podem sair do ERP. Não alterar a função nesta auditoria.

### P1-2 — função auxiliar da Pizza com superfície pública

`pizza_is_allowed` é `SECURITY DEFINER`, concede `EXECUTE` a `anon` e usa `search_path=public`. A função precisa ser revisada junto com o módulo Pizza para confirmar necessidade de exposição pública e fixar um caminho seguro se ela permanecer `SECURITY DEFINER`.

### P1-3 — configuração e rastreabilidade de migrations divergentes

O Supabase live registra cinco migrations que não existem com o mesmo identificador no repositório desta auditoria:

- `20260711184227_controle_pizza_schema`;
- `20260711194210_harden_erp_rls_authorization`;
- `20260711194522_preserve_sobras_store_scope`;
- `20260714013120_permitir_sobras_antes_do_forno`;
- `20260714185611_align_price_item_sale_options`.

O repositório contém migrations de intenção semelhante para as duas últimas, mas com identificadores diferentes; equivalência de conteúdo não foi presumida.

**Impacto:** uma restauração, ambiente novo ou revisão de PR pode não reproduzir a autorização que está em produção. Antes de qualquer hardening, recuperar e revisar as migrations ausentes como trabalho de rastreabilidade separado.

## Observações adicionais

- Os grants de tabela para `anon` e `authenticated` são amplos em várias tabelas. Com RLS habilitado eles dependem das policies, mas ampliam o impacto de qualquer policy permissiva ou tabela futura sem policy correta.
- O advisor reporta também questões de desempenho de policies e índices. Elas não foram tratadas nesta rodada para não misturar segurança e performance.
- A proteção contra senhas vazadas continua aparecendo como alerta de configuração; sua disponibilidade depende do plano Supabase e não foi alterada.

## Ordem recomendada de remediação

1. Recuperar o desvio de migrations live para o repositório, sem alterar o banco.
2. Concluir a migração operacional do login Auth e testar os perfis que ainda usam fallback legado.
3. Em PR isolada, proteger `app_users` e retirar a leitura anônima que expõe PINs.
4. Em PRs pequenas, fechar escrita/leitura anônima por módulo, começando por pedidos, compras/cotações e movimentos de produção.
5. Proteger `analisar-desconto` e revisar a função auxiliar do módulo Pizza.
6. Reexecutar esta auditoria e só então declarar a Sprint 0 de Auth/RLS concluída.

## Referências

- [Row Level Security — Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Securing your data/API — Supabase](https://supabase.com/docs/guides/database/secure-data)
- [Data API and grants — Supabase changelog](https://supabase.com/changelog/2026-04-22-data-api-tables-no-longer-auto-exposed)
