# TODO — Padronização visual `ps-*` em todas as telas

**Criado:** 2026-05-30
**Status:** ✅ **CONCLUÍDO** — todas as 15 telas reskinnadas (PRs #7-21, merged)

## Resultado
Sistema visual `ps-*` aplicado em 100% das telas do app. Lógica de dados/queries/idempotência intacta em cada uma.

## Telas concluídas

### Tier 1 — nav primária
- [x] 1. **Romaneio** — PR #7
- [x] 2. **Relatórios** + `/relatorios/pj` + `/relatorios/sobras-descartes` — PR #8

### Tier 2 — operação diária
- [x] 3. Estoque-Pães — PR #9
- [x] 4. Sobras — PR #10
- [x] 5. Estoque (index + entrada) — PR #11
- [x] 6. Estoque-Congelado — PR #12

### Tier 3 — regular
- [x] 7. Encomendas — PR #13
- [x] 8. Compras (Telegram preservado) — PR #14
- [x] 9. Fornecedores — PR #15

### Tier 4 — admin / baixa frequência
- [x] 10. Produtos — PR #16
- [x] 11. Tabelas-Preço — PR #17
- [x] 12. Clientes — PR #18
- [x] 13. Pedidos-PJ — PR #19
- [x] 14. Simulador-Desconto — PR #20
- [x] 15. Admin (usuários) — PR #21

## Próximos passos sugeridos
- Smoke test em produção, papel a papel: vendas (sobras/compras), estoque (estoque/congelado/saldo-pães), romaneio (gustavo/cleo/marselle), admin (todos os CRUDs).
- Se algo torto: ajuste pontual em PR específico.
- Geolar e visão "Itens JC" no `/` continuam como estão (já foram reskinnados no PR #5).
