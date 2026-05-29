# TODO — Redesign visual "Pane & Salute" (Produção + nav)

**Criado:** 2026-05-29
**Status:** implementado (tsc+build verdes) — aguardando verificação visual
**Origem:** handoff do Claude Design (`Producao.html`). Escopo aprovado: **Produção + nova nav inferior**.

## Sistema visual
- Paleta quente (farinha/creme/crosta/mel) via CSS vars novas (`--flour`, `--crust`, `--honey`...). Namespace `ps-*` (não colide com vars/classes atuais).
- Fontes: Spectral (títulos) + Hanken Grotesk (UI) via Google Fonts. Aplicadas só dentro do escopo `ps-*`.
- Ícones: `lucide-react`.

## Arquivos
1. **`package.json`** — add `lucide-react`.
2. **`src/app/layout.tsx`** — `<link>` Google Fonts (Spectral + Hanken Grotesk). Ajustar padding do body p/ nova nav.
3. **`src/app/globals.css`** — colar tokens + classes `ps-*` (header, deadline, tabs, days, card, stepper, totalbar, nav, sheet) do design. Sem mexer no body/headings globais.
4. **`src/components/Nav.tsx`** — reescrever para `ps-nav`: 4 primários (Produção/Forno/Romaneio/Relatórios) + botão **Mais** → bottom-sheet agrupado (Operação/Comercial/Gestão) + Sair. Filtrado por `canAccess`. Ícones Lucide.
5. **`src/app/page.tsx`** — reescrever o render da tela `main` (não a lógica):
   - `ps-shell` + `ps-header` (logo/wordmark + chip de usuário + sair)
   - `ps-deadline` (banner de prazo — reusa `isLocked`/`hoursLeft`)
   - `ps-tabs` (tabDefs atuais)
   - aba de pedido: `ps-days` (delivIdx 1..6) + `ps-section` + `ps-grid`/`ps-card`/`ps-stepper` + `ps-totalbar` (Salvar pedido)
   - PJ: preserva cliente/data
   - Relatório/Admin: mantém funcional dentro do shell (polish fino fica p/ follow-up)

## Preservar (lógica intacta)
Pedidos Supabase, delivIdx/DELIVERY_MAP, Telegram, Geolar (tela à parte — restyle fica p/ follow-up), Admin CRUD de pães, ItensJC, ReportView, auth/roles.

## Verificação
- `npx tsc --noEmit` + `npm run build` verdes.
- Conferência visual: limitada no preview (sem Supabase/login real); validar layout no preview e, idealmente, em produção depois.

## Fora de escopo (follow-up)
- Login e Forno no novo visual.
- Restyle detalhado de Relatório/Admin/Geolar.
- Tweaks (cor/fonte/densidade) do protótipo.
- Logo real (`logo-ink.png`) — por ora wordmark em Spectral; posso adicionar o asset depois.
