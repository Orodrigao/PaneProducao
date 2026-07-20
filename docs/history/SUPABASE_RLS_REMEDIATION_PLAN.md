# SUPABASE_RLS_REMEDIATION_PLAN.md - Plano tecnico Auth/RLS

**Data:** 2026-06-14
**Sprint:** 0C - migracao segura de Auth/RLS
**Projeto:** PaneProducao / Pane&Salute ERP
**Status histórico:** este plano foi escrito antes das correções parciais de
Auth/RLS aplicadas a partir de 2026-06-14. Não representa o estado atual.

Consulte primeiro [CURRENT_STATE.md](CURRENT_STATE.md) e os registros
`SUPABASE_*_RESULT.md`. Reaudite o estado live antes de reutilizar qualquer SQL
ou sequência deste documento.

## 1. Objetivo do plano

Definir o caminho tecnico para migrar o ERP do modelo atual de autenticacao custom por PIN/localStorage para uma base segura com Supabase Auth, perfis de usuario e RLS por role/loja.

Este documento nao aplica nenhuma mudanca. Ele serve para orientar os proximos PRs de correcao sem quebrar a operacao em producao.

Objetivos praticos:

- manter producao, lojas, compras, estoque e romaneio funcionando durante a transicao;
- criar identidade real no Supabase para que o banco consiga autorizar acesso;
- proteger `app_users`, custos, estoque, clientes, precos, fornecedores, sobras e descartes;
- reduzir exposicao de Edge Functions com custo de IA;
- impedir entrada de novos dados financeiros sensiveis antes da seguranca minima;
- deixar ordem, riscos, validacao e rollback claros antes de qualquer SQL futuro.

## 2. Estado atual resumido

Baseado em `AGENTS.md`, `docs/SUPABASE_SECURITY_AUDIT.md` e `docs/SUPABASE_LIVE_INVENTORY.md`.

| Area | Estado atual | Risco |
| --- | --- | --- |
| App | Next.js estatico com `output: 'export'`, sem API routes, middleware ou SSR | Todo acesso ao Supabase acontece direto do navegador |
| Chave Supabase | Chave publica/anon no frontend | Esperado para app estatico, mas exige RLS forte |
| Auth | Login custom por usuario + PIN, sessao em `localStorage` | Identidade nao e confiavel para proteger banco |
| `app_users` | RLS ligado, mas policy `anon_select_for_login` com `USING true` | Exposicao de usuarios, roles, rotas, lojas e possiveis PINs |
| Fallback | Usuarios/PINs de fallback existem no codigo | Aumenta risco se bundle/repo for acessado |
| Tabelas publicas | 36 tabelas no schema `public` | Superficie ampla exposta pela Data API |
| RLS desligado | 13 tabelas com RLS OFF | Acesso anonimo efetivo quando grants permitem |
| Grants | Todas as 36 tabelas com grants amplos para `anon` e `authenticated` | Permissoes de leitura/escrita ficam perigosas com RLS OFF ou policy permissiva |
| Policies | Muitas policies `anon` com `USING true` e/ou `WITH CHECK true` | UI vira a unica barreira pratica |
| `force_rls` | Nenhuma tabela publica com `force_rls` | Donos/servicos podem contornar RLS conforme contexto |
| Edge Function `analisar-desconto` | Ativa, `verify_jwt=false`, usa `ANTHROPIC_API_KEY`, nao versionada localmente | Custo de IA e abuso externo |
| Edge Function `parse-cotacao` | Ativa, `verify_jwt=true`, usa `GEMINI_API_KEY`, versionada localmente | Melhor que `analisar-desconto`, mas ainda sem identidade operacional forte |

Tabelas com RLS desligado confirmadas no inventario live:

- `products`
- `sobras`
- `descartes`
- `destinations`
- `romaneios`
- `romaneio_items`
- `product_prices`
- `frozen_products`
- `frozen_stock`
- `suppliers`
- `stock_entries`
- `stock_entry_items`
- `stock_balance`

Conclusao: o ERP funciona operacionalmente, mas ainda nao esta seguro para receber XML de compras, vendas CNM, contas financeiras, ficha tecnica versionada ou CMV com dados sensiveis.

## 3. Principios de correcao

| Principio | Aplicacao pratica |
| --- | --- |
| Nao quebrar producao | Migrar em paralelo e validar por perfil antes de desligar o modelo antigo |
| PRs pequenos | Separar fundacao Auth, login, `app_users`, RLS P0, RLS P1 e Edge Functions |
| Deny-by-default | Toda tabela sensivel deve negar por padrao e liberar apenas o necessario |
| Banco protege dado | Controle de rota no frontend ajuda UX, mas RLS deve bloquear acesso direto |
| Sem dado financeiro novo antes da base segura | XML, CNM, contas a pagar, CMV e DRE ficam bloqueados ate P0 estar protegido |
| Validacao por modulo | Cada lote precisa testar login, tela, operacao e chamada direta negada |
| Rollback antes de aplicar | Toda migration futura precisa ter retorno documentado antes de rodar |
| Service role nunca no frontend | Nenhuma chave privilegiada em `NEXT_PUBLIC_*`, bundle, repo ou log |
| Secrets fora do repo | Secrets de IA e Supabase ficam em provedores/cofre, nunca versionados |
| Perfil controlado pelo app | Roles e lojas devem vir de tabela controlada, nao de `user_metadata` editavel |

Decisao recomendada:

- adotar Supabase Auth como identidade real;
- criar `app_profiles` como fonte de role, loja e status operacional;
- manter transicao gradual para nao travar loja/producao;
- remover dependencias de `anon` permissivo por fases.

Alternativas e riscos:

| Alternativa | Vantagem | Risco | Decisao |
| --- | --- | --- | --- |
| Manter PIN/localStorage e apenas apertar policies | Menor mudanca inicial | Nao cria identidade confiavel para RLS por usuario/loja | Nao recomendado como solucao final |
| Supabase Auth para todos de uma vez | Simplifica arquitetura final | Alto risco de bloquear operacao no celular | Nao recomendado como primeiro passo |
| Supabase Auth em paralelo com login antigo | Menor risco operacional | Duplicidade temporaria de usuario/perfil | Recomendado |
| PIN como segundo fator local | Preserva habito operacional | PIN nao pode autorizar banco | Aceitavel apenas como transicao/UX |

## 4. Arquitetura-alvo

Arquitetura recomendada:

- Supabase Auth identifica o usuario real.
- `app_profiles` guarda perfil operacional do ERP.
- Roles reais controlam acesso por modulo.
- Loja vinculada ao usuario limita dados por escopo quando aplicavel.
- RLS usa role/loja do profile, nao dados manipulaveis no cliente.
- Acoes criticas migram para RPC/Edge Functions com validacao e log.
- Edge Functions com custo exigem JWT, rate/cost guard e limite de payload.
- `service_role` e segredos continuam fora do frontend.

### Componentes

| Componente | Decisao alvo | Risco mitigado |
| --- | --- | --- |
| Supabase Auth | Fonte unica de sessao autenticada | Usuario anonimo deixa de parecer usuario interno |
| `app_profiles` | Tabela de perfil ligada ao usuario Auth | Roles/lojas deixam de vir de `localStorage` |
| Roles | `admin`, `financeiro`, `producao`, `compras`, `estoque`, `romaneio`, `expedicao`, `vendas` | Policies passam a refletir o trabalho real |
| Loja | `jc`, `ja`, `ex`, `pj` ou vazio para perfis globais | Limita leitura/escrita por unidade quando fizer sentido |
| RLS | Policies por role/loja/comando | Bloqueia REST direto fora da UI |
| RPC/Functions | Usadas para operacoes atomicas e criticas | Evita gravacoes parciais e regras espalhadas no frontend |
| Logs | Usuario, perfil, acao, entidade e resultado | Permite auditoria de custo, saldo, preco e pedido |

### Perfil conceitual

Modelo conceitual, nao aplicado:

| Campo | Uso |
| --- | --- |
| `user_id` | Vinculo com usuario do Supabase Auth |
| `display_name` | Nome operacional exibido no ERP |
| `role` | Papel real do usuario |
| `store` | Loja principal ou escopo operacional |
| `active` | Bloqueio sem apagar historico |
| `allowed_routes` | Apoio para UI e navegacao, nao fonte principal de RLS |
| `created_at` / `updated_at` | Auditoria basica |

Regras:

- PIN nao deve ser salvo em claro em `app_profiles`.
- `allowed_routes` nao substitui policy de banco.
- Roles administrativas devem ser poucas e revisadas.
- Perfil inativo deve bloquear acesso sem apagar historico.

## 5. Estrategia de migracao sem quebrar producao

| Fase | Objetivo | Entregas futuras | Gate para avancar | Risco principal |
| --- | --- | --- | --- | --- |
| 0 - Preparacao | Manter app atual funcionando | Mapa usuario-role-loja, matriz tabela/modulo, UX de login decidida | Rodrigo aprova fluxo alvo | Risco atual continua aberto |
| 1 - Auth em paralelo | Criar identidade real sem trocar login operacional | Usuarios Supabase Auth, `app_profiles`, RLS basico do profile | Admin de teste autentica e le proprio profile | Duplicidade temporaria |
| 2 - Migrar login | App passa a obter sessao real | Login Auth, leitura de profile, logout correto | Rodrigo/Suelen validam primeiro | Bloquear operadores se feito de uma vez |
| 3 - Proteger `app_users` | Tirar credencial antiga da exposicao anonima | Remover leitura anonima ampla e reduzir dependencia do legado | Login novo validado | Quebrar login se removido cedo |
| 4 - Proteger P0 | Fechar dados mais sensiveis | RLS/grants/policies para auth, estoque, clientes, precos, produtos, fornecedores, perdas | Smoke test P0 por role | Telas antigas dependem de anon |
| 5 - Proteger P1 | Fechar operacao principal | RLS para producao, compras, cotacoes, romaneio, congelados e BOM | Fluxos diarios funcionando | Regras por loja mal definidas |
| 6 - Remover anon permissivo | Consolidar deny-by-default | Remover `anon_*` com `true`, reduzir grants desnecessarios | Chamada direta anon negada | Algum modulo esquecido |
| 7 - Validar CMV/financeiro | Liberar proximas sprints | Validacao de estoque, preco, compra, perda e Edge Functions | Rodrigo aceita riscos residuais | Avancar CMV sobre base ainda fraca |

Ordem operacional recomendada:

1. Nao mexer no app atual ate a fundacao Auth/profile existir.
2. Criar Auth/profile em paralelo.
3. Migrar primeiro Rodrigo/admin e financeiro.
4. Migrar operadores por grupo.
5. Proteger `app_users` depois que login novo estiver validado.
6. Corrigir P0 em lotes pequenos.
7. Corrigir P1 por modulo.
8. Remover policies anon permissivas restantes.

## 6. Tabelas por prioridade P0/P1/P2

### P0 - Corrigir antes de qualquer dado financeiro novo

| Tabela/grupo | Motivo | Acao futura |
| --- | --- | --- |
| `app_users` | Auth legado, roles, lojas, rotas e possiveis PINs | Substituir por `app_profiles` e remover leitura anonima |
| `stock_entries` | Compra de insumos e base futura de XML | RLS por estoque/compras/financeiro |
| `stock_entry_items` | Itens de compra e custo unitario | RLS por estoque/compras/financeiro |
| `stock_balance` | Saldo e custo medio de insumos | RLS forte e escrita controlada |
| `stock_movements` | Movimentos que formam CMV | Escrita por role e operacoes atomicas |
| `customers` | Clientes PJ e dados comerciais | Acesso restrito a admin/financeiro |
| `price_tiers` | Tabelas comerciais | Acesso restrito a admin/financeiro |
| `price_tier_items` | Precos por tabela | Acesso restrito a admin/financeiro |
| `customer_price_overrides` | Descontos/precos negociados | Acesso restrito a admin/financeiro |
| `products` | Catalogo, custos, flags de CMV e especiais | Leitura controlada, escrita restrita |
| `suppliers` | Fornecedores | Leitura por compras/financeiro, escrita restrita |
| `sobras` | Perdas por produto/data/responsavel | RLS por role/loja |
| `descartes` | Descartes e custo futuro de perda | RLS por role/loja |

### P1 - Corrigir logo apos P0

| Tabela/grupo | Modulo | Motivo |
| --- | --- | --- |
| `orders` | Producao/PJ/encomendas | Base de producao e pedidos |
| `production_actuals` | Forno/producao | Producao real |
| `product_production` | Producao nao-paes | Planejamento por loja/data |
| `bread_movements` | Estoque de paes | Movimentos e baixas por kit/romaneio/descarte |
| `purchase_lists` / `purchase_items` | Compras | Pedido de compra e historico |
| `quotations` / `quotation_*` | Cotacoes | Precificacao de fornecedores |
| `supplier_products` | Fornecedores/produtos | Mapa fornecedor-produto |
| `supplier_orders` / `supplier_order_items` | Compras | Pedidos gerados a fornecedores |
| `romaneios` / `romaneio_items` | Romaneio | Transferencias entre lojas |
| `frozen_stock` / `frozen_products` / `frozen_movements` | Estoque congelado | Saldos e movimentos |
| `product_components` | BOM/kits | Base futura de CMV correto |
| `product_prices` | Precos legados/apoio | Pode expor precos/custo comercial |

### P2 - Corrigir depois dos fluxos sensiveis

| Tabela/grupo | Motivo |
| --- | --- |
| `destinations` | Baixa sensibilidade isolada, mas ainda deve seguir padrao seguro |
| `shelf_counts` | Dado operacional de prateleira, risco medio |
| Catalogos auxiliares futuros | Devem nascer com RLS antes de receber dados |

## 7. Plano de policies por perfil

As policies futuras devem combinar:

- usuario autenticado;
- profile ativo;
- role permitida;
- loja permitida quando houver campo de loja/origem/destino;
- comando permitido: `select`, `insert`, `update`, `delete`;
- `WITH CHECK` equivalente para impedir escrita fora do escopo.

| Perfil | Pode ler | Pode escrever | Nao deve acessar |
| --- | --- | --- | --- |
| `admin` / Rodrigo | Todos os modulos operacionais e financeiros | Configuracao, perfis, catalogos, compras, estoque, precos, producao | Nada operacional, mas acoes destrutivas devem ser auditadas |
| `financeiro` | Clientes, pedidos PJ, precos, estoque financeiro, compras, cotacoes, relatorios | Clientes, tabelas de preco, overrides, dados financeiros autorizados | Gestao ampla de perfis, se Rodrigo nao aprovar |
| `producao` | Catalogos necessarios, pedidos do dia, forno, sobras/descartes operacionais | Producao real, pedidos/sobras do escopo | Custos detalhados, clientes/precos, fornecedores sensiveis |
| `compras` | Produtos/insumos, fornecedores, listas, cotacoes | Listas, cotacoes, respostas, pedidos a fornecedor conforme papel | Clientes PJ, precos de venda, admin de usuarios |
| `estoque` | Saldos, entradas, movimentos, produtos/insumos | Entradas, baixas e inventario conforme modulo | Clientes, precos comerciais, gestao de usuarios |
| `romaneio` / `expedicao` | Destinos, romaneios, produtos necessarios, congelados | Romaneios, itens e movimentos relacionados | Financeiro, precos, admin de usuarios |
| `vendas` / lojas | Dados operacionais da propria loja | Registros operacionais da loja, se aplicavel | Custos, CMV, clientes PJ sensiveis, fornecedores, usuarios |

Regras especificas:

- `delete` deve ser raro e preferencialmente substituido por cancelamento/status.
- Alteracao de preco, custo medio, saldo e role deve gerar log.
- Escrita em tabelas de estoque deve migrar para operacao transacional.
- Leitura ampla de catalogo pode ser aceita para roles internas, mas escrita deve ser restrita.
- Policies nao devem depender de `localStorage`, query string ou `user_metadata` editavel.

## 8. Plano especifico para `app_users`

### Riscos atuais

- Leitura anonima por `anon_select_for_login`.
- Possivel exposicao de PINs e dados de acesso.
- Role, loja e rotas sao consumidas pelo cliente.
- Sessao usa id em `localStorage`.
- Existem usuarios/PINs de fallback no codigo.
- O frontend contem funcoes para criar/atualizar usuarios usando chave publica.

### Decisao recomendada

Migrar autorizacao para `app_profiles` ligada ao Supabase Auth e aposentar `app_users` como fonte de login/autorizacao.

### Como nao expor PIN

- Nao copiar PIN em claro para `app_profiles`.
- Nao criar endpoint anonimo que retorne segredo de login.
- Se PIN continuar por UX, ele nao pode decidir RLS.
- Remover fallback hardcoded somente depois que Auth real estiver validado.

### Como manter usuarios atuais

| Passo | Acao futura | Cuidado |
| --- | --- | --- |
| 1 | Inventariar usuarios atuais sem expor PIN em docs | Nao versionar segredo |
| 2 | Criar usuarios correspondentes no Supabase Auth | Comecar por Rodrigo/Suelen |
| 3 | Criar `app_profiles` com role, loja e rotas equivalentes | Validar nomes e lojas |
| 4 | Migrar login admin/financeiro | Menor risco operacional |
| 5 | Migrar operadores por grupo | Evitar travar loja/producao |
| 6 | Reduzir dependencia de `app_users` | Manter fallback temporario |
| 7 | Remover leitura anonima e neutralizar PIN legado | So depois de validacao completa |

### Fallback

Fallback aceitavel durante transicao:

- login antigo permanece ativo por janela curta;
- `app_users` nao recebe novos dados sensiveis;
- qualquer excecao temporaria fica documentada com prazo.

Fallback nao aceitavel como estado final:

- PIN em claro;
- role confiada ao cliente;
- escrita anonima em usuario;
- policy anon ampla para login.

## 9. Plano para Edge Functions

| Function | Estado atual | Risco | Plano futuro |
| --- | --- | --- | --- |
| `analisar-desconto` | Ativa, `verify_jwt=false`, usa `ANTHROPIC_API_KEY`, nao versionada localmente | Critico: custo de IA e chamada externa sem identidade | Versionar, exigir Auth/JWT, limitar payload, criar rate/cost guard e considerar desativacao temporaria |
| `parse-cotacao` | Ativa, `verify_jwt=true`, usa `GEMINI_API_KEY`, versionada localmente | Alto: custo de IA e CORS amplo, ainda sem role real | Manter JWT, restringir chamada a `admin`/`financeiro`/`compras`, limitar payload e registrar usuario/cotacao |

### `analisar-desconto`

Recomendacao:

- nao alterar agora;
- em PR proprio, trazer o codigo deployado para `supabase/functions/analisar-desconto`;
- revisar CORS, metodo permitido, tamanho maximo e validacao de payload;
- exigir JWT quando o login Auth estiver pronto;
- rejeitar usuario sem profile ativo;
- criar limite de custo por usuario/periodo;
- registrar logs sem expor segredo nem payload sensivel;
- se nao for essencial para operacao, considerar desativar ate Auth real.

### `parse-cotacao`

Recomendacao:

- manter `verify_jwt=true`;
- revisar chamada do frontend depois da migracao para Supabase Auth;
- permitir apenas roles ligadas a compras/cotacao;
- limitar tamanho do texto colado;
- registrar quem chamou, cotacao relacionada e status do parse;
- nao salvar segredo nem resposta bruta sensivel em log publico.

### Secrets

- `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` e similares ficam apenas nos secrets do Supabase.
- Nenhum valor de secret deve aparecer no repo, em `.env` versionado, log ou `NEXT_PUBLIC_*`.
- `service_role` nunca deve ir para o cliente.

## 10. Validacao por modulo

| Modulo | Validacao minima |
| --- | --- |
| Login | Sem sessao nao acessa; usuario autenticado carrega profile; inativo e bloqueado; logout limpa sessao e cache |
| Navegacao | `AuthGuard` e Nav refletem o profile; URL direta sem role e bloqueada; bloqueio de UI combina com bloqueio de banco |
| Producao | Criar/editar pedidos permitidos; forno le pedidos do dia; role errada nao le/escreve |
| Sobras/descartes | Registrar sobra/descarte; filtrar por loja quando aplicavel; role sem permissao e negada |
| Romaneio | Criar cabecalho e itens; validar origem/destino; impedir exclusao indevida |
| Compras | Solicitante cria lista; comprador/admin gerencia; status nao pode ser alterado por role errada |
| Cotacoes | Gerar cotacao; chamar `parse-cotacao` autenticado; salvar respostas; fechar sem duplicidade |
| Estoque | Ler saldo; registrar entrada/baixa; ver movimentos; impedir escrita de custo/saldo por role errada |
| Clientes/PJ | Financeiro/admin le e altera; producao ve apenas o necessario; lojas nao acessam dados comerciais sensiveis |
| Tabelas de preco | Financeiro/admin gerencia tabelas e overrides; roles operacionais nao leem/alteram precos sensiveis |
| Edge Functions | Sem JWT/profile e rejeitado; payload grande e rejeitado; logs registram usuario sem expor segredo |
| REST direto | Chamada anon com chave publica nao le/escreve tabelas sensiveis |

Validacoes tecnicas por PR futuro:

- `git diff --check`;
- typecheck/build/testes aplicaveis quando houver codigo;
- teste manual por perfil;
- teste de chamada direta negada para tabelas protegidas;
- revisao do Rodrigo antes de migration em producao.

## 11. Rollback

Principio: rollback deve ser pequeno e proporcional ao lote aplicado. Nao reabrir o banco inteiro para corrigir quebra de uma tela.

| Fase | Rollback esperado |
| --- | --- |
| Auth em paralelo | Manter login antigo e deixar `app_profiles` sem uso operacional ate corrigir |
| Migracao de login | Voltar fluxo da UI para login antigo enquanto Auth/profile ficam criados |
| Protecao de `app_users` | Reabrir temporariamente somente leitura minima se login quebrar; nunca escrita anonima |
| RLS P0 | Restaurar policy temporaria apenas na tabela/modulo quebrado, com prazo documentado |
| RLS P1 | Reverter lote do modulo afetado, nao todas as policies |
| Edge Functions | Preferir desabilitar tela/function de custo a voltar exposicao sem controle |
| Grants | Restaurar permissao minima necessaria, nao `ALL` amplo por padrao |

Checklist antes de qualquer migration futura:

- listar tabelas e policies afetadas;
- registrar comportamento anterior;
- escrever plano de rollback no PR;
- validar em producao logo apos aplicar;
- se houver quebra, registrar excecao temporaria e prazo de remocao.

## 12. O que nao fazer agora

- Nao executar SQL.
- Nao alterar Supabase.
- Nao criar migrations.
- Nao alterar `src/`.
- Nao alterar `supabase/`.
- Nao mexer em `.env`.
- Nao alterar `package.json` ou `package-lock.json`.
- Nao fazer deploy.
- Nao remover `anon_select_for_login` sem login Auth validado.
- Nao ligar RLS em tabela OFF sem policy substituta e teste.
- Nao remover todos os grants em lote unico.
- Nao corrigir P0 e P1 no mesmo PR.
- Nao criar tabela financeira nova antes da correcao minima.
- Nao importar XML, CNM ou dados reais de CMV antes da base segura.
- Nao colocar `service_role`, senha de banco ou segredo de IA no frontend.
- Nao depender de `user_metadata` editavel para autorizacao.
- Nao criar dashboard financeiro antes de ficha tecnica, vendas CNM e seguranca minima.

## 13. Primeiro PR de correcao real recomendado

### Branch

```text
codex/supabase-auth-profiles-foundation
```

### Escopo

Criar a fundacao de Supabase Auth e `app_profiles` em paralelo ao login atual, sem alterar ainda as tabelas de negocio.

### Arquivos esperados no PR futuro

- Uma migration nova em `supabase/migrations/` para criar a fundacao de profiles.
- Ajuste minimo de codigo apenas se necessario para testar leitura de profile autenticado.
- Documento curto de mapeamento usuario atual -> profile novo, sem PIN e sem segredo.

Este documento nao cria esses arquivos.

### Migration esperada, apenas descrita

Em PR futuro, a migration deve:

- criar `app_profiles`;
- vincular profile ao usuario do Supabase Auth;
- criar constraints de role e loja;
- habilitar RLS em `app_profiles`;
- permitir que usuario autenticado leia o proprio profile;
- permitir que admin gerencie profiles;
- negar acesso anonimo;
- nao expor PIN;
- nao remover `app_users`;
- nao alterar P0/P1 no mesmo PR.

### Criterios de sucesso

- Rodrigo aprova roles, lojas e usuarios iniciais.
- Admin autenticado le o proprio profile.
- Usuario nao autenticado nao le profiles.
- Profile inativo bloqueia acesso.
- App atual continua funcionando pelo login antigo durante a transicao.
- Nenhuma tabela de negocio tem policy alterada nesse primeiro PR.
- Rollback documentado.
- Validacoes aplicaveis passam antes de abrir PR.

### Proximos PRs depois da fundacao

| Ordem | Branch sugerida | Escopo |
| --- | --- | --- |
| 1 | `codex/supabase-auth-profiles-foundation` | Criar Auth/profile em paralelo |
| 2 | `codex/login-supabase-auth-parallel` | Migrar login sem remover fallback |
| 3 | `codex/protect-app-users` | Proteger `app_users` depois do login novo |
| 4 | `codex/rls-p0-stock-customers-prices` | Proteger estoque financeiro, clientes e precos |
| 5 | `codex/rls-p0-products-suppliers-losses` | Proteger produtos, fornecedores, sobras e descartes |
| 6 | `codex/edge-functions-auth-guards` | Corrigir `analisar-desconto` e revisar `parse-cotacao` |
| 7 | `codex/rls-p1-production-purchases` | Proteger producao, compras, cotacoes e romaneio |

## Conclusao

A correcao segura nao deve comecar removendo policies anonimas em massa. O caminho de menor risco e criar identidade real em paralelo, migrar login por perfis, proteger `app_users`, fechar P0 em lotes pequenos e depois P1.

Enquanto isso nao estiver aplicado, XML de compras, vendas CNM, ficha tecnica versionada, contas financeiras e CMV com dados sensiveis devem continuar bloqueados.
