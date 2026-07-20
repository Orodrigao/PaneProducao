# Pane&Salute ERP

ERP interno da Pane&Salute, padaria artesanal com três lojas em Caxias do Sul.
O sistema complementa o PDV fiscal e busca responder:

> Para onde vai o dinheiro da Pane&Salute?

Fonte única de onboarding — regras de trabalho, arquitetura, segurança e
fluxo, para agentes e humanos: [AGENTS.md](AGENTS.md). Estado real do
projeto: [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md).

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

## Deploy

O push na `main` publica pela Vercel. Fluxo de branch, PR e aprovações:
[AGENTS.md](AGENTS.md).
