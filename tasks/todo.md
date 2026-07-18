# Tarefa: estabilizar operação e concluir hardening para segunda-feira

## Objetivo

Deixar os fluxos essenciais do ERP utilizáveis pela operação na segunda-feira,
sem reabrir os riscos críticos já corrigidos na migração para Supabase Auth.

## Plano aprovado

- [x] Inventariar e revisar as correções locais e o estado após a PR #127.
- [x] Validar e corrigir os fluxos críticos de login, Produção, Romaneio e
      Sobras.
- [x] Executar lint, TypeScript, testes, build e teste funcional mobile por
      perfil.
- [x] Auditar as 15 tabelas que ainda aceitam escrita anônima e separar o
      hardening por módulo.
- [ ] Preparar as migrations de hardening das 15 tabelas, separando as
      mudanças por módulo.
- [x] Auditar Edge Functions, funções SQL públicas e divergência do histórico
      de migrations.
- [ ] Executar a reauditoria final e entregar um checklist de prontidão para
      segunda-feira.

## Prioridade de bugs

- P0: impede login, carregamento, salvamento ou continuidade da operação.
- P1: causa dado incorreto ou exige contorno operacional relevante.
- P2: problema visual, textual ou fluxo contornável.

## Bugs documentados em 18/07

- [x] Manter Expedição JC no contexto de Produção da própria loja.
- [x] Resolver o papel do Romaneio pela loja autenticada.
- [x] Permitir que Cléo/JA veja e confirme a saída destinada à EX.
- [x] Remover preço unitário do card operacional do Romaneio.
- [x] Encaminhar o bloqueio de sobras antigas à Central de Pendências.

## Fora desta entrega

- CMV, dashboard ou novas funcionalidades.
- Redesign geral ou refatoração sem relação direta com um bug.
- Mudança em usuários, roles, Auth ou Supabase de produção sem aprovação
  explícita do Rodrigo.
- Deploy ou push direto na `main` sem aprovação explícita do Rodrigo.
