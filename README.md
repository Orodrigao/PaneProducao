# Pane & Salute — ERP

ERP interno de uma padaria artesanal com 3 lojas em Caxias do Sul (RS). Responde "para onde vai o dinheiro?" — complementa o PDV fiscal, não substitui.

> Documentação canônica: [CLAUDE.md](CLAUDE.md) (organização do código), [docs/PRD.md](docs/PRD.md) (produto), [docs/PLAN.md](docs/PLAN.md) (técnico/roadmap), [docs/TASKS.md](docs/TASKS.md) (backlog).

## Stack

- **Next.js 15.5** (App Router, `output: 'export'` — estático, sem servidor) + **React 19** + **TypeScript strict**
- **Tailwind 3.4** (módulos novos) + inline styles (módulos antigos) — coexistem
- **Supabase** (Postgres + Edge Functions) — auth **custom**, não o nativo
- **Vercel** — auto-deploy do push em `main` → `pane-producao.vercel.app`

## Rodar localmente

```bash
npm install
npm run dev          # :3000
npm run build        # build estático em ./out
npx tsc --noEmit     # typecheck
npm run lint
```

Precisa de `.env.local` com `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_TELEGRAM_BOT_TOKEN`, `NEXT_PUBLIC_TELEGRAM_CHAT_ID`.

## Deploy

Push em `main` → Vercel builda e publica. Não há staging — `main` = produção.

## Módulos

- **Produção** (`/`) — pedidos de produção diários
- **Compras** (`/compras`) — lista de compras semanal por setor + geração de cotação
- **Cotação** (`/cotacoes`) — cotação semi-automática: lista → WhatsApp → IA extrai respostas → comparativo → pedido
- **Estoque** (`/estoque`, `/estoque-paes`, `/estoque-congelado`) — entradas, saldos
- **Romaneio** (`/romaneio`) — transferências entre lojas (baixa em cascata de kits)
- **Catálogo** (`/produtos`, `/fornecedores`, `/clientes`) — cadastros, composição de kits (BOM), mapa fornecedor↔produto
- **Tabelas de preço** (`/tabelas-preco`) — preços por cliente/tier
- **Relatórios** (`/relatorios`) — sobras, descartes, PJ
- **Admin** (`/admin/usuarios`) — gestão de usuários

### Produtos: kind, revenda e kits (BOM)

`products` tem duas dimensões além de `category`:
- **`kind`** = `kit` | `insumo` | `final` (o que o produto é)
- **`is_revenda`** = comprado pronto pra revender

Kits têm composição em `product_components` (ex: 1 Kit Pão de Abóbora = 6 pãezinhos). Descartar ou expedir um kit **baixa os pães-componentes do estoque em cascata** (`/sobras`, `/romaneio`). `/compras` e `/estoque/entrada` listam só insumos + revenda.

### Cotação semi-automática

1. `/compras` (admin) → **Gerar cotação** agrega as listas enviadas
2. `/cotacoes/detalhe` → mensagem pronta por fornecedor → **Abrir no WhatsApp**
3. Cola a resposta → **Extrair preços com IA** (Edge Function `parse-cotacao`, Gemini Flash) → revisa o grid → salva
4. `/cotacoes/comparativo` → escolhe fornecedor por item (menor preço pré-marcado) → **Gerar pedidos**

Requer `GEMINI_API_KEY` nos Supabase Edge Functions Secrets.
