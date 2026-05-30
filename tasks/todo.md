# TODO — Padronização visual `ps-*` em todas as telas

**Criado:** 2026-05-30
**Origem:** após PR #5 (Produção + Nav) e PR #6 (Login + Forno), padronizar o restante do app no sistema `ps-*` que está locked em `globals.css` linhas 235-431.

## Princípio
- Cada tela vira um PR próprio. Smoke test em produção entre uma e outra.
- Lógica de dados/queries/idempotência **intacta** — só o render muda.
- Compras/Estoque/Fornecedores já usam Tailwind (não inline), então a migração ali é mais mecânica.

## Fila de prioridades

### Tier 1 — nav primária (todo mundo vê)
- [x] 1. **Romaneio** — PR #7 (merged)
- [x] 2. **Relatórios** + `/relatorios/pj` + `/relatorios/sobras-descartes` — PR #8 (merged)

### Tier 2 — operação diária (sheet "Mais", alto uso)
- [x] 3. Estoque-Pães — PR #9 (merged)
- [x] 4. Sobras — PR #10 (merged)
- [x] 5. Estoque (index + entrada) — PR #11 (merged)
- [x] 6. Estoque-Congelado — PR #12 (merged)

### Tier 3 — regular
- [x] 7. Encomendas — PR #13 (merged)
- [x] 8. Compras (Telegram preservado) — PR #14 (merged)
- [x] 9. Fornecedores — PR #15 (merged)

### Tier 4 — admin / baixa frequência
- [x] 10. Produtos — PR #16 (merged)
- [x] 11. Tabelas-Preço — PR #17 (merged)
- [ ] 12. Clientes ← **EM ANDAMENTO**
- [ ] 13. Pedidos-PJ
- [ ] 14. Simulador-Desconto
- [ ] 15. Admin

---

## Tela atual: **#1 Romaneio**

**Branch:** `claude/redesign-romaneio`
**Arquivo:** `src/app/romaneio/page.tsx` (935 linhas, ~5 telas internas)

### Telas internas a reskinnar
| screen | função | papéis |
|---|---|---|
| `painel` | lista romaneios de hoje + ações por papel | gustavo/cleo/marselle |
| `detalhe` | view read-only de um romaneio | todos |
| `criar` | gustavo monta romaneio (data/destino/produtos/qtys/obs) | gustavo |
| `conferencia` | marselle confere chegada (rec/aceito/divergência/recusa) | marselle |
| `admin` (4 subtabs: painel-adm, divergências, fechamento, preços) | rodrigo | admin |
| modal `envioRomId` | confirma envio (cleo) | cleo |

### Mapeamento de classes
| Antigo | Novo |
|---|---|
| wrapper `#app` + `topbar` | `ps-canvas` > `ps-shell` > `ps-header` (wordmark + userchip + sair) |
| `card` + `card-header`/`card-title`/`card-meta` | `ps-card` + `ps-card-head` + `ps-pname` + `ps-card-meta` |
| `card-actions` com `btn btn-secondary/info/success/sm` | botões com novas variantes `ps-btn`/`ps-btn-*` |
| `section-label` | `ps-label` |
| `nav-tabs`/`nav-tab` (admin) | `ps-tabs`/`ps-tab` |
| `conf-row` | `ps-card` |
| `qty-input` + `qty-btn` (criar/conferencia) | `ps-stepper` + `ps-qty` |
| `obs-area` (textarea/select/input) | `ps-textarea` / `ps-select` / `ps-input` |
| `btn-save` (full-width sticky) | `ps-totalbar` + `ps-save` ou `ps-save` standalone |
| status pill `status s-*` | novo `ps-status` (separado/enviado/conferido/com_divergencia/aprovado/fechado/pendente) |
| `modal-overlay`/`modal-sheet` (envio) | `ps-sheet-overlay` + `ps-sheet` |
| empty state inline | `ps-empty` |
| `loading-overlay` + spinner | novo `ps-loading-overlay` (vs `ps-loading` full-page existente) |
| `toast` | re-estiliza com tokens `ps-*` (id `rom-toast` preservado) |
| `report-table` (fechamento) | novo `ps-table` |

### CSS novo (anexar em globals.css ao final, namespace `ps-*`)
1. `ps-btn` + variantes (`-ghost`/`-primary`/`-success`/`-danger`/`-sm`) — botões de ação em card
2. `ps-status` + modificadores de status — cores: honey/crust/sage/berry/teal/ink-faint
3. `ps-table` — header/cell/num para o fechamento
4. `ps-loading-overlay` — overlay (vs `ps-loading` full-page)
5. `ps-toast` — re-estiliza com tokens `ps-*`
6. `ps-fieldgroup`/`ps-fieldlabel` — pares "Recebido/Aceito" na conferência

### O que preservar (lógica intacta)
- `loadBase`, `loadPainel`, `loadAdminPainel`, `loadDiverg`, `loadPrecos`
- `doLogin`, useEffect de auto-resolve por role/store
- `openCriar`/`onDestChange`/`addExtra`/`removeExtra`/`criarChangeQty`/`saveRomaneio` (incluindo rollback do romaneio se itens falham)
- `confirmEnvio` com idempotência via `bread_movements` (linhas 290-340)
- `openConferencia`/`updateConf`/`recusarItem`/`desfazerRecusa`/`saveConferencia` (com flag `hasDiverg`)
- `aprovarDiverg`/`aprovarItem`/`deleteRomaneio`/`calcFechamento`/`savePrecos`
- Toast helper, todas as queries Supabase

### Verificação
- `npx tsc --noEmit` verde
- `npm run build` verde (24 rotas devem continuar exportando)
- Smoke test em produção depois do merge: login como Gustavo (criar) + Cléo (enviar) + Marselle (conferir) + Rodrigo (admin)
