# Estado atual — Pane&Salute ERP

**Data de referência:** 2026-07-16

**Base observada:** `origin/main` no commit `cdf26f7`

**Natureza:** mapa operacional. Atualizar somente após mudança material
incorporada à `main`.

## Fase estratégica

O projeto está em estabilização e conclusão da Sprint 0 de segurança. A memória
central foi saneada, branches e worktrees antigos foram inventariados sem perder
patches exclusivos, e o baseline técnico foi executado.

Funcionalidades novas que adicionem dados financeiros devem esperar:

1. smoke visual autenticado dos fluxos críticos;
2. priorização das regressões reproduzíveis;
3. conclusão da auditoria e do hardening Auth/RLS.

## Baseline técnico

Em 2026-07-16, a partir do commit `cdf26f7`:

- instalação limpa, tipos, 109 testes e build passaram;
- as 31 páginas HTML exportadas responderam no smoke HTTP;
- o lint passou com 145 avisos;
- `npm audit` registrou 3 alertas moderados, sem alertas altos ou críticos;
- o teste visual autenticado ficou pendente porque o controle do navegador não
  estava disponível na sessão.

O relatório e suas limitações estão em
[BASELINE_2026-07-16.md](BASELINE_2026-07-16.md).

## Autenticação

Estado conhecido:

- Supabase Auth por e-mail e senha está implementado;
- `app_profiles` fornece role, loja, rotas e status do usuário autenticado;
- recuperação e definição de senha existem;
- login legado por PIN/localStorage continua em paralelo;
- `app_users` e fallback hardcoded ainda são usados pelo fluxo legado.

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
- `app_users` permanece exposta para sustentar o PIN;
- parte da operação ainda depende do acesso legado;
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
- compras, cotações e fornecedores;
- clientes, pedidos PJ e encomendas;
- tabelas e opções de preço;
- fechamento de caixa;
- catálogo unificado com `products.kind`;
- componentes de ficha técnica, rendimentos e cálculo de CMV;
- auditoria de cobertura/qualidade do CMV;
- relatórios operacionais.

## Capacidades parciais

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

1. Ausência de baseline visual recente e autenticado no navegador.
2. Login legado e acesso anônimo ainda coexistem com Auth.
3. RLS não pode ser declarado concluído sem nova auditoria live.
4. O lint acumula 145 avisos e as dependências têm 3 alertas moderados.

## Próximas fases aprovadas

1. Concluir o baseline visual autenticado no navegador.
2. Priorizar regressões reproduzíveis.
3. Retomar o hardening Auth/RLS em lotes pequenos.
4. Tratar dívida de lint e dependências em tarefas separadas.

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
