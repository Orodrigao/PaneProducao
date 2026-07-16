# Pane&Salute ERP

ERP interno da Pane&Salute, padaria artesanal com três lojas em Caxias do Sul.
O sistema complementa o PDV fiscal e busca responder:

> Para onde vai o dinheiro da Pane&Salute?

## Documentação

- [AGENTS.md](AGENTS.md) — regras para qualquer agente que trabalhe no projeto.
- [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) — fase real, riscos e próximos
  bloqueios.
- [docs/PLAN.md](docs/PLAN.md) — roadmap canônico.
- [docs/PRD.md](docs/PRD.md) — visão e requisitos do produto.
- [docs/README.md](docs/README.md) — classificação dos demais documentos.

Documentos de auditoria, resultados de migrations e tarefas antigas são
históricos. Não use esses arquivos isoladamente para decidir a próxima tarefa.

## Stack

- Next.js 15.5, App Router e React 19.
- TypeScript strict.
- Tailwind 3.4 com módulos legados ainda em estilos próprios.
- Supabase/Postgres.
- Vercel.
- Build estático com `output: 'export'`.

Não existem API routes, middleware, SSR ou Server Actions. O navegador acessa
o Supabase diretamente, portanto RLS e grants são parte obrigatória da
segurança.

## Autenticação

O sistema está em transição:

- login por e-mail e senha via Supabase Auth;
- perfil e escopo em `app_profiles`;
- PIN/localStorage e `app_users` ainda disponíveis como legado temporário.

O estado e os riscos dessa transição estão em
[docs/CURRENT_STATE.md](docs/CURRENT_STATE.md).

## Desenvolvimento local

```bash
npm install
npm run dev
npm run lint
npx tsc --noEmit
npm test
npm run build
```

O build estático é gerado em `out/`.

As variáveis públicas necessárias ficam em `.env.local`, que não pode ser
versionado:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_TELEGRAM_CHAT_ID
```

Valores `NEXT_PUBLIC_*` entram no bundle do navegador. Nunca use esse prefixo
para service role, senha, token administrativo ou qualquer segredo.

O código legado ainda usa `NEXT_PUBLIC_TELEGRAM_BOT_TOKEN`. Como token de bot
não é público, isso permanece como risco a ser removido em tarefa própria; não
replique esse padrão.

## Módulos principais

- produção e forno;
- sobras, descartes e reaproveitamento;
- romaneio e estoques;
- compras, cotações e fornecedores;
- catálogo, ficha técnica e auditoria de CMV;
- clientes, pedidos PJ, encomendas e tabelas de preço;
- fechamento de caixa e relatórios;
- administração de usuários.

O status de cada frente não é mantido nesta lista. Consulte
[docs/CURRENT_STATE.md](docs/CURRENT_STATE.md).

## Deploy

O push na `main` publica pela Vercel. Por isso:

- cada tarefa usa branch própria `codex/<descricao>`;
- o PR é draft por padrão;
- não existe push direto na `main`;
- alterações de banco e autenticação exigem aprovação explícita.
