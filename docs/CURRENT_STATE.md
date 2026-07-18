# Estado atual — Pane&Salute ERP

**Data de referência:** 2026-07-18

**Base observada:** `origin/main` no commit `40bc25a`

**Natureza:** mapa operacional. Atualizar somente após mudança material
incorporada à `main`.

## Fase estratégica

O projeto concluiu o ciclo de estabilização operacional de Produção, Sobras e
Romaneio e continua na Sprint 0 de segurança.

Funcionalidades que adicionem dados financeiros devem esperar:

1. correção dos riscos residuais do Romaneio;
2. retirada das policies anônimas ainda permissivas;
3. smoke tests por perfil e loja após o hardening.

## Entregas concluídas na `main`

- [PR #129](https://github.com/Orodrigao/PaneProducao/pull/129) — estabilizou
  Produção, Romaneio e Sobras, corrigiu o contexto da Expedição JC, filtrou os
  romaneios por destino e encaminhou sobras antigas para a Central de
  Pendências.
- [PR #130](https://github.com/Orodrigao/PaneProducao/pull/130) — criou a base
  de permissões por usuário e a gestão administrativa mobile, sem alterar
  role, loja, status ou rotas existentes.
- [PR #131](https://github.com/Orodrigao/PaneProducao/pull/131) — tornou as
  permissões do Romaneio explícitas por ação e destino, adicionou RLS próprio
  e operações transacionais para saída, recebimento e divergências.

### Romaneio — ciclo concluído

O Romaneio não converte mais pessoa, cargo ou loja em identidade operacional.
As responsabilidades podem ser atribuídas por usuário e escopo `JC`, `JA`,
`EX` ou global. A saída e a movimentação de estoque passam pela mesma função
transacional, e o usuário autenticado fica registrado na operação.

Os riscos residuais conhecidos estão registrados abaixo e devem ser tratados
em PRs próprias, sem reabrir este ciclo como entrega pendente.

## Autenticação e permissões

Estado live confirmado em 2026-07-18:

- o acesso normal usa Supabase Auth por e-mail e senha;
- existem 13 perfis ativos em `app_profiles`, todos vinculados a usuários de
  `auth.users`;
- recuperação e definição de senha estão disponíveis;
- o login legado por PIN/localStorage foi removido da aplicação;
- `app_users` permanece com 14 registros para rollback controlado, mas não tem
  grants para `PUBLIC`, `anon` ou `authenticated`;
- o catálogo contém 25 permissões e 137 atribuições para os 13 usuários;
- 7 permissões e 45 atribuições são específicas do Romaneio.

O modelo ainda é híbrido:

- acesso às rotas continua vindo de `app_profiles.allowed_routes` e do role;
- o Romaneio já usa `app_user_permissions` para autorizar ações e destinos;
- os demais módulos ainda não consomem a nova matriz granular;
- a tela administrativa altera atribuições, mas não cria usuários no Auth nem
  muda role, loja, status ou `allowed_routes`.

## Migrations recentes aplicadas

O histórico remoto do Supabase confirma estas aplicações após o snapshot
anterior:

| Migration local | Registro remoto | Resultado |
| --- | --- | --- |
| `20260718093517_corrigir_rls_producao_autenticada.sql` | `20260718094452_corrigir_rls_producao_autenticada` | Produção liberada para perfis autenticados autorizados |
| `20260718095446_permitir_vendas_salvar_producao_da_loja.sql` | `20260718095446_permitir_vendas_salvar_producao_da_loja` | Atendimento pode salvar a produção da própria loja |
| `20260718181203_preparar_permissoes_usuarios.sql` | `20260718195818_preparar_permissoes_usuarios` | Catálogo e atribuições de permissões criados |
| `20260718203439_romaneio_permissoes_granulares.sql` | `20260718203439_romaneio_permissoes_granulares` | RLS e funções transacionais do Romaneio aplicados |
| `20260718203536_preservar_romaneio_cleo_ja.sql` | `20260718203536_preservar_romaneio_cleo_ja` | Acesso anterior da Cléo à JA preservado |

A PR #129 não adicionou migration. As diferenças de timestamp entre alguns
arquivos locais e o histórico remoto decorrem da aplicação via Supabase MCP;
não executar `db push` ou `migration up` sem reconciliar esse histórico.

## RLS e Supabase

O inventário live encontrou 50 tabelas no schema `public`, todas com RLS
habilitado. Isso não encerra o hardening: RLS habilitado com policy `true`
continua permitindo acesso amplo.

Proteções confirmadas:

- `app_users` sem acesso por `PUBLIC`, `anon` ou `authenticated`;
- `app_permissions` e `app_user_permissions` com RLS forçado;
- `anon` sem acesso às tabelas e RPCs de permissões;
- `romaneios` e `romaneio_items` autorizados por usuário, ação e destino.

Riscos ainda abertos:

1. Quinze tabelas operacionais ainda têm escrita anônima com policies
   permissivas: `bread_movements`, `breads`, `frozen_movements`, `orders`,
   `product_components`, `purchase_items`, `purchase_lists`,
   `quotation_items`, `quotation_responses`, `quotation_suppliers`,
   `quotations`, `shelf_counts`, `supplier_order_items`, `supplier_orders` e
   `supplier_products`.
2. `production_actuals` ainda mantém leitura anônima ampla.
3. A matriz granular ainda não é a fonte de autorização dos módulos fora do
   Romaneio; pode haver diferença entre o que a tela administrativa mostra e o
   que `allowed_routes` efetivamente libera.
4. `confirm_romaneio_receipt` não valida no banco se o payload contém todos os
   itens do romaneio antes de fechar o recebimento.
5. Uma permissão `romaneio.administrar` limitada a uma loja não abre o painel
   administrativo, porque a entrada atual reconhece apenas o escopo global.
6. O token do bot Telegram continua no frontend com prefixo `NEXT_PUBLIC_`.
7. Falta executar smoke test final por perfil e loja depois das migrations das
   PRs #130 e #131.

## Capacidades já presentes

- produção, forno e confirmação por lotes;
- sobras, reaproveitamento e pendências;
- Romaneio com permissões granulares e movimentação transacional;
- gestão administrativa de atribuições por usuário;
- compras, cotações e fornecedores;
- clientes, pedidos PJ e encomendas;
- tabelas e opções de preço;
- fechamento de caixa;
- catálogo unificado com `products.kind`;
- componentes de ficha técnica, rendimentos e cálculo de CMV;
- auditoria de cobertura/qualidade do CMV;
- relatórios operacionais.

## Capacidades parciais

### Permissões

O Romaneio usa a matriz granular. Os demais módulos continuam autorizados por
role e `allowed_routes`; a migração completa deve ser feita em lotes pequenos.

### Ficha técnica e CMV

Existem componentes, rendimentos, opções de venda e cálculo teórico. Ainda não
há ficha versionada completa nem cobertura suficiente para declarar CMV
confiável.

### CNM

Há trabalhos de leitura XLS e coleta autorizada por navegador. Isso não
equivale a uma importação consolidada, validada e integrada ao ERP.

### Sobras

O fluxo por lotes e reaproveitamento avançou. Custos, motivos padronizados,
rupturas e indicadores comparáveis ainda precisam ser consolidados.

## Próximas fases aprovadas

1. Corrigir os dois riscos residuais conhecidos do Romaneio.
2. Retirar a escrita anônima das 15 tabelas operacionais em migrations por
   módulo, com validação por perfil e loja.
3. Executar a reauditoria live e o smoke test final.
4. Migrar gradualmente os demais módulos para permissões explícitas.
5. Retomar o roadmap de CMV em [PLAN.md](PLAN.md).

## Governança documental

`AGENTS.md` é a única fonte de regras para agentes. `CLAUDE.md` e
`agent-rules.md` existem somente como arquivos de compatibilidade e encaminham
para `AGENTS.md`, sem regras concorrentes.

## Como atualizar este arquivo

Atualize somente quando um PR incorporado à `main`:

- concluiu ou iniciou uma fase;
- adicionou ou retirou capacidade relevante;
- abriu ou fechou risco operacional;
- mudou autenticação, RLS ou arquitetura;
- alterou o próximo bloqueio real.

Não adicionar lista de commits, arquivos tocados ou detalhes fáceis de
descobrir no código.
