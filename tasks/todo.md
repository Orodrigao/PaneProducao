# TODO — Redesign visual "Pane & Salute" — Login + Forno

**Criado:** 2026-05-29
**Status:** em implementação
**Origem:** follow-up do PR #5 (redesign Produção + nav). Escopo aprovado pelo usuário: **Login + Forno primeiro**, depois Geolar/Relatório/Admin em PR separado.

## Sistema visual (já existente, namespace `ps-*`)
Reusar tokens/classes do PR #5 em `globals.css`: `ps-canvas`, `ps-shell`, `ps-header`,
`ps-wordmark`/`ps-mark`/`ps-brand`, `ps-userchip`/`ps-avatar`, `ps-pad`, `ps-label`,
`ps-days`/`ps-day`, `ps-section`, `ps-grid`/`ps-card`/`ps-card-head`/`ps-pname`,
`ps-stepper`/`ps-step`/`ps-qty`, `ps-totalbar`/`ps-total-num`/`ps-save`, `ps-empty`.
Ícones Lucide. Fontes Spectral + Hanken (já no layout).

## Arquivos
1. **`src/app/globals.css`** — adicionar bloco focado:
   - `ps-login-*` (wrap centralizado, logo, grid de usuários, card de PIN, keypad, dots).
   - `ps-banner` (+`honey`/`crust`) p/ avisos PJ/encomenda do Forno.
   - helpers Forno: `ps-forno-intro`, `ps-flabel`, `ps-pjbadge`, `ps-discard*`.
   Sem mexer no que já existe.
2. **`src/app/login/page.tsx`** — reescrever só o render:
   - `ps-login` wrap (fundo farinha) + logo (mark "P" + Spectral).
   - estado 1: grid de usuários (`ps-login-user`, avatar `roleColor`, nome, `roleLabel`).
   - estado 2: header do usuário + dots de PIN + keypad numérico grande.
   - **Preservar lógica:** fetchUsersFromSupabase/cache/redirect, authenticate, handlePin/Backspace/attemptLogin.
3. **`src/app/forno/page.tsx`** — reescrever só o render:
   - `ps-canvas`>`ps-shell`>`ps-header` (wordmark "Forno" + userchip).
   - seletor de dia em `ps-days` (Hoje/Ontem/dd/mm, 8 dias).
   - avisos PJ/encomenda em `ps-banner`.
   - cada pão = `ps-card` (nome + badge PJ + planejado/breakdown), "Assado" em `ps-stepper`,
     descarte em bloco expansível (`ps-stepper` + select motivo).
   - barra fixa `ps-totalbar` (total assado/descarte + `ps-save`).
   - **Preservar lógica:** loadData (orders/PJ/enc/actuals), save (idempotência + bread_movements),
     adjustField, toggleDescarte, updateForm.

## Preservar (lógica intacta)
Login: auth flow inteiro. Forno: queries Supabase, idempotência, movements, datas locais.

## Verificação
- `npx tsc --noEmit` + `npm run build` verdes.
- Visual: limitado no preview (sem Supabase/login real); validar layout e, idealmente, em produção depois.

## Fora de escopo (próximo PR)
- Geolar, ReportView, Admin CRUD detalhados.
- Tweaks do protótipo, logo real (`logo-ink.png`).
