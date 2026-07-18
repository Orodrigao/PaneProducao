# Estado atual — Pane&Salute ERP

**Data de referência:** 2026-07-17

**Base observada:** `origin/main` no commit `66318d4`

**Natureza:** mapa operacional. Atualizar somente após mudança material
incorporada à `main`.

## Fase estratégica

O projeto está em estabilização e conclusão da Sprint 0 de segurança.

Funcionalidades novas que adicionem dados financeiros devem esperar:

1. saneamento da memória e do fluxo de branches;
2. baseline de testes e navegador no `main`;
3. conclusão da auditoria e do hardening Auth/RLS.

## Autenticação

Estado conhecido:

- Supabase Auth por e-mail e senha está implementado;
- `app_profiles` fornece role, loja, rotas e status do usuário autenticado;
- recuperação e definição de senha existem;
- o acesso legado por PIN/localStorage foi removido da aplicação e a tela de
  login informa a transição para e-mail e senha;
- a administração legada de usuários foi retirada da interface; criação,
  alteração e desativação de acessos devem ocorrer no Supabase Auth pelo
  administrador responsável.
- a migration de retirada do PIN foi aplicada em produção: `app_users` não
  tem mais policy nem privilégios para `PUBLIC`, `anon` ou `authenticated`.

Consequência:

- Auth por e-mail não significa que a migração de segurança terminou;
- telas e tabelas precisam funcionar para `authenticated`;
- policies antigas de `anon` não podem ser mantidas indefinidamente;
- retirada do PIN exige validação operacional por perfil e loja.

## RLS e Supabase

Hardening documentado como aplicado:

- `app_profiles`;
- tabelas iniciais de estoque;
- clientes e tabelas de preço;
- acesso autenticado a pedidos;
- policies autenticadas de componentes de ficha;
- fechamento de caixa.

Riscos ainda abertos:

- o último inventário live completo registrou tabelas sem RLS e policies
  anônimas permissivas;
- `app_users` e a coluna histórica de PIN permanecem no banco para rollback
  administrativo controlado, mas não estão mais expostas pela Data API;
- o token do bot Telegram ainda é usado no frontend com prefixo
  `NEXT_PUBLIC_`;
- o estado live precisa ser reauditado antes de declarar Sprint 0 concluída.

Não deduza o estado de produção apenas pelas migrations locais. Para tarefa de
segurança, compare migration, resultado documentado, código cliente e auditoria
live somente leitura.

## Capacidades já presentes

- produção, forno e confirmação por lotes;
- sobras, reaproveitamento e pendências;
- romaneio e estoques;
- fornecedores;
- clientes, pedidos PJ e encomendas;
- tabelas e opções de preço;
- fechamento de caixa;
- catálogo unificado com `products.kind`;
- componentes de ficha técnica, rendimentos e cálculo de CMV;
- auditoria de cobertura/qualidade do CMV;
- relatórios operacionais.

## Capacidades parciais

### Compras e cotações legadas

As rotas `/compras` e `/cotacoes` estão temporariamente pausadas enquanto o
fluxo e a necessidade operacional são reavaliados. Os dados históricos foram
preservados e as tabelas legadas ficaram sem acesso pela Data API.

Essa pausa não cancela a frente estratégica de compras por XML prevista no
plano de CMV.

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

## Bloqueios atuais

1. Documentação central divergente do código.
2. Muitos branches e worktrees antigos aumentam o risco de partir de base
   desatualizada.
3. Ausência de baseline recente e único no navegador.
4. O código usa somente Auth e a tabela legada foi bloqueada; ainda existem
   policies anônimas permissivas em outras áreas operacionais.
5. RLS não pode ser declarado concluído sem nova auditoria live.

## Próximas fases aprovadas

1. Sanear memória e documentação.
2. Organizar branches/worktrees sem perder trabalho.
3. Executar baseline técnico e smoke tests no navegador.
4. Priorizar regressões reproduzíveis.
5. Aplicar o hardening Auth/RLS em lotes pequenos nas próximas tabelas
   operacionais, com validação por perfil e loja antes de cada aplicação em
   produção.

Depois disso, seguir [PLAN.md](PLAN.md).

## Como atualizar este arquivo

Atualize somente quando um PR incorporado à `main`:

- concluiu ou iniciou uma fase;
- adicionou ou retirou capacidade relevante;
- abriu ou fechou risco operacional;
- mudou autenticação, RLS ou arquitetura;
- alterou o próximo bloqueio real.

Não adicionar lista de commits, arquivos tocados ou detalhes fáceis de descobrir
no código.
