# TODO — PR-B4: Tela de saldo de estoque de pães por loja

**Criado:** 2026-05-21
**Status:** planning

## Contexto / objetivo

Hoje temos `bread_movements` populadas pelos 3 fluxos (forno entrada/descarte, romaneio envio, sobras descarte de pão). **Saldo atual = SUM(quantity) por bread_id + location.** Mas não tem tela pra visualizar isso.

PR-B4 entrega: tela `/estoque-paes` com saldo atual de pão por loja. Cada user vê só a loja dele; admin tem dropdown pra trocar.

## Escopo

### Schema
Nada novo. Lê de `bread_movements` (já existe).

### Page: `/estoque-paes/page.tsx`

- **Auth/filtro:** lê `getCurrentUser`. Usuário com store: filtro fixo na loja dele. Admin: dropdown (default JC, opções JC/JA/EX/central).
- **Query:** `supabase.from('bread_movements').select('bread_id, location, quantity').eq('location', selectedStore)` + agrupa por bread_id em JS.
- **Lookup de nomes:** `supabase.from('breads').select('id,name,is_pj,unit')`.
- **Display:** lista de pães com saldo, ordenada por nome. Search/filter por nome.
- **KPIs no topo (3 cards):**
  - Total de unidades em estoque
  - Nº de variedades com saldo > 0
  - Top variedade (maior saldo)
- **Tabela:** Pão · Unidade · Saldo · (admin extra: location se "todas" selecionada)
- **Linha zerada:** mostra normalmente, com saldo=0 (não filtra).
- **Linha negativa:** destacar vermelho (sinaliza problema de tracking — ex: descarte sem entrada).

### Nav + permissões
- [src/components/Nav.tsx](src/components/Nav.tsx): novo link `/estoque-paes` com ícone (sugestão: 🥖 ou 📦; já temos 🍞 na Produção e 🧊 no Congelado — preciso de algo distinto. Pensei em **🥯** ou **📊** — admin opina)
- [src/lib/auth.ts](src/lib/auth.ts) `DEFAULT_ROUTES_BY_ROLE`: adicionar `/estoque-paes` em admin, producao, expedicao, financeiro, compras (basicamente todo mundo que toca em pão)
- [src/app/admin/usuarios/page.tsx](src/app/admin/usuarios/page.tsx) `ROUTE_OPTIONS`: adicionar
- SQL: adicionar `/estoque-paes` às routes de admins (Rodrigão, Suélen) + Marselle, Geolar, Liara, Gustavo, Elis, Sander, etc.

### Verificação
- `npx tsc --noEmit` verde
- `npm run build` verde
- SQL spot-check: rodar a mesma query da UI no MCP, comparar com o que aparece em produção
- Manual: Marselle vê só EX (5/3/10 dos testes anteriores se ainda houver), Rodrigão troca dropdown e vê todos

## Decisões abertas pra confirmar

1. **Localização da página:** rota nova `/estoque-paes` (separado) OU tab "Pães" em `/estoque` (que hoje é só insumos)? Recomendo separado pra não bloatar /estoque agora.
2. **Admin: ver tudo de uma vez?** Por default mostra UMA loja (com dropdown). Botão "Comparar lojas" pode mostrar tabela com colunas por loja. Sugiro deixar comparar pra depois (escopo simples agora).
3. **Ícone na Nav:** 🥯 / 📊 / outro? (já temos 🍞 Produção, 🧊 Congelado).

## Fora de escopo

- **Estoque consolidado (pão + congelado + insumos) em uma tela** — viria depois de unificar catálogos (Estágio C do plano de produtos).
- **Histórico de movimentos detalhado** — `bread_movements` já tem; pode virar tab futura ou um /relatorios/movimentos.
- **Edição direta de saldo (ajuste de inventário)** — operação delicada; deixa pra PR separado se virar necessidade.
- **Alertas de stock mínimo** — feature legítima futura.

## Estimativa

| Item | Linhas |
|---|---|
| `src/app/estoque-paes/page.tsx` (novo) | ~180 |
| `src/components/Nav.tsx` (+1 link) | +1 |
| `src/lib/auth.ts` (+1 entrada em vários roles) | +5 |
| `src/app/admin/usuarios/page.tsx` (+1 ROUTE_OPTIONS) | +1 |
| SQL: adicionar route aos usuários relevantes | 1 statement |
| **Total** | **~190 linhas** |

## Notas durante execução

- (preenchido conforme avanço)
