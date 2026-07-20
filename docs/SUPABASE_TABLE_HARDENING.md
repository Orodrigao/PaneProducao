# Hardening das tabelas operacionais

## Nota de curadoria — 2026-07-20

Este pacote foi recuperado de trabalho não commitado (18/07) e recortado para
o que ainda falta na `main`. Ficaram apenas as migrations **1
(`prepare_authenticated_operational_calls`)**, **4
(`harden_operational_table_access`)** e **5
(`assert_anon_hardening_and_revoke_defaults`)**, mais as telas emparelhadas
(`sobras`, `simulador-desconto`, `cotacoes/detalhe`), o teste e a auditoria.

As migrations 2 (`harden_purchase_tables`) e 3 (`harden_procurement_tables`)
foram **removidas**: a `freeze_legacy_compras_cotacoes`, já aplicada na `main`,
revogou todo o acesso a essas tabelas de compras/cotações. Reaplicar as antigas
**reabriria** o que o freeze fechou. A proteção dessas tabelas hoje é o freeze,
não este pacote. As seções abaixo descrevem o desenho original das 5 migrations
e devem ser lidas com essa ressalva.

Nada aqui está aplicado no banco. Aplicar é a fase formal de hardening, com
aprovação própria por fase.

## Estado auditado em 18/07/2026

- 50 tabelas no schema `public`.
- RLS habilitada nas 50.
- 15 tabelas com pelo menos uma policy de escrita aplicável a `anon`.
- 19 tabelas com grant de escrita para `anon`.
- As quatro tabelas extras nos grants são `pizza_categorias`, `pizza_despesas`,
  `pizza_usuarios` e `pizza_vendas`.
- A cobertura de permissões tinha uma lacuna em três rotas: um perfil em
  `/compras`, um em `/sobras` e um em `/estoque-congelado`. A migration de
  compatibilidade deriva essas permissões das rotas já aprovadas.

RLS ligada não substitui grants corretos nem compensa uma policy permissiva.
O critério de saída desta entrega é zero policy e zero grant de escrita para
`anon` no schema `public`.

## Escopo da mudança

O rollout foi separado para manter compatibilidade entre banco e frontend:

1. `20260718214305_prepare_authenticated_operational_calls.sql` reconcilia
   permissões ausentes a partir das rotas já aprovadas e cria
   `mark_bread_for_shelf(text)`, uma RPC autenticada que altera somente
   `breads.is_shelf`.
2. `20260718214309_harden_purchase_tables.sql` protege `purchase_lists` e
   `purchase_items` com a permissão `compras.acessar`.
3. `20260718214313_harden_procurement_tables.sql` protege cotações, respostas,
   vínculos de fornecedores e pedidos derivados.
4. `20260718214827_harden_operational_table_access.sql` protege `orders`,
   `breads`, `bread_movements`, `frozen_movements`, `shelf_counts` e
   `product_components`.
5. `20260718214909_assert_anon_hardening_and_revoke_defaults.sql` remove os
   quatro grants residuais `pizza_*`, fecha os privilégios padrão futuros e
   aborta se ainda houver escrita anônima.

As policies autenticadas já válidas de `orders` e `product_components` são
preservadas. Os grants de `authenticated` passam a conter somente os verbos
usados pelo frontend.

## Sequência de rollout

Nenhuma etapa abaixo está autorizada automaticamente por este documento. Toda
escrita no Supabase de produção e todo deploy continuam exigindo aprovação
explícita do Rodrigo.

### Fase 0 — preflight somente leitura

1. Confirmar que a produção contém todas as migrations até
   `20260718203536_preservar_romaneio_cleo_ja.sql`.
2. Executar `supabase/audits/operational_table_hardening.sql`.
3. Confirmar os números de base: 50/50 RLS, 15 tabelas com policy de escrita
   anônima e 19 tabelas com grant de escrita anônima.
4. Confirmar que não há migration ou deploy concorrente.

### Fase 1 — compatibilidade

1. Aplicar somente
   `20260718214305_prepare_authenticated_operational_calls.sql`.
   A migration preenche apenas permissões equivalentes a rotas já existentes,
   sem alterar `app_profiles`, roles, lojas ou autenticação.
2. Publicar o frontend que:
   - usa `mark_bread_for_shelf` em `/sobras`;
   - envia o JWT da sessão nas Edge Functions com
     `supabase.functions.invoke`;
   - trata erros de RLS nos movimentos de descarte.
3. Fazer smoke test autenticado de inclusão de pão na Prateleira.

Neste ponto ainda não houve revogação das policies anônimas antigas. A fase
existe apenas para evitar quebra durante a troca de versão.

### Fase 2 — corte de segurança

Aplicar, na ordem, as quatro migrations restantes. Cada migration deve concluir
sem erro antes da próxima. A última contém pós-condições que abortam a transação
se sobrar qualquer policy ou grant de escrita aplicável a `anon`.

### Fase 3 — smoke tests

Validar com perfis reais e escopos já aprovados:

- Produção, Forno, Encomendas e Pedidos PJ continuam lendo/salvando `orders`.
- Sobras inclui pão na Prateleira, salva contagem e registra descarte direto e
  descarte de kit.
- Estoque Congelado registra entrada, saída e inventário.
- Compras edita lista, inclui/remove item e muda o estado do ciclo.
- Cotações cria cotação, fornecedores, respostas e pedido final.
- Fornecedores inclui e remove vínculo produto-fornecedor.
- Um request com chave anônima não consegue escrever nas 19 tabelas auditadas.

### Fase 4 — reauditoria

Executar novamente `supabase/audits/operational_table_hardening.sql`. Resultado
esperado:

- total de tabelas públicas igual ao total com RLS;
- `anon_write_policies = 0`;
- `anon_write_grants = 0`;
- ACL padrão de `postgres` sem grants automáticos para `anon` ou
  `authenticated`.

## Rollback seguro

- Se a Fase 1 falhar, reverter o deploy do frontend. A RPC estreita pode
  permanecer: ela exige usuário ativo e `sobras.acessar`.
- Se uma migration da Fase 2 falhar, a própria transação não deve ser marcada
  como aplicada. Corrigir a migration antes de repetir.
- Se surgir uma quebra funcional depois do corte, não restaurar `anon`. Criar
  uma migration de hotfix que conceda somente o verbo necessário a
  `authenticated` e adicione uma policy com permissão/escopo explícitos.
- Qualquer rollback que reabra policy ou grant anônimo é uma exceção de
  segurança e exige nova aprovação explícita do Rodrigo.

## Riscos residuais fora deste corte

- As Edge Functions passam a receber o JWT do usuário, mas a autorização
  server-side de cada endpoint deve continuar sendo auditada separadamente.
- Esta entrega não revisa todas as funções `security definer` existentes.
- A ACL padrão de `supabase_admin` é gerenciada pela plataforma. O papel
  `postgres` das migrations não é membro dele e não pode alterá-la; objetos da
  aplicação devem continuar sendo criados por migrations, como `postgres`.
  Na auditoria, as 50 tabelas públicas atuais pertencem a `postgres`.
- As quatro tabelas `pizza_*` perdem acesso de `anon`, mas as regras de negócio
  para eventuais usuários autenticados desse módulo não são redesenhadas aqui.
