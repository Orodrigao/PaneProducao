# CODEX_ENVIRONMENT.md — Ambiente Codex para PaneProducao

## Modo recomendado

Usar dois modos:

1. **Codex local/CLI** para trabalho com segredos, Supabase, inspeção detalhada e validação local.
2. **Codex Web/Cloud** para tarefas isoladas, PRs pequenos, documentação, refactors e UI sem dados sensíveis.

## Local do repositório

No Windows, manter fora do OneDrive:

```text
C:\repos\PaneProducao
```

Evitar:

```text
OneDrive\Área de Trabalho\...
```

## Setup local mínimo

Pré-requisitos:

- Git
- Node 20+
- npm
- Codex CLI
- acesso ao GitHub do repo `Orodrigao/PaneProducao`

Comandos base:

```bash
cd /c/repos/PaneProducao
npm install
npm run lint
npx tsc --noEmit
npm test
npm run build
```

## Variáveis locais

`.env.local` deve existir apenas localmente e nunca ir para o Git.

Exemplo seguro:

```env
NEXT_PUBLIC_SUPABASE_URL=https://gohluceldchoitihrimw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=COLOCAR_CHAVE_PUBLICA_AQUI
NEXT_PUBLIC_TELEGRAM_BOT_TOKEN=COLOCAR_TOKEN_RESTRITO_SE_NECESSARIO
NEXT_PUBLIC_TELEGRAM_CHAT_ID=COLOCAR_CHAT_ID_SE_NECESSARIO
```

Nunca colocar:

```env
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_PASSWORD=
GITHUB_TOKEN=
VERCEL_TOKEN=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
```

Esses segredos ficam fora do repo.

## Codex Cloud — setup script sugerido

Usar no ambiente cloud do Codex:

```bash
set -euo pipefail

node --version
npm --version

export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-https://gohluceldchoitihrimw.supabase.co}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-dummy-anon-key-for-build-only}"
export NEXT_PUBLIC_TELEGRAM_BOT_TOKEN="${NEXT_PUBLIC_TELEGRAM_BOT_TOKEN:-dummy-telegram-token-for-build-only}"
export NEXT_PUBLIC_TELEGRAM_CHAT_ID="${NEXT_PUBLIC_TELEGRAM_CHAT_ID:-dummy-chat-id-for-build-only}"

npm ci || npm install
npm run lint || true
npx tsc --noEmit
npm test
npm run build
```

Observação: `npm run lint || true` é temporário se o projeto ainda tiver warnings/ajustes legados. Não usar isso como critério final em PR de código.

## Política de internet

- Setup pode ter internet para instalar dependências.
- Fase do agente deve trabalhar sem internet sempre que possível.
- Permitir internet apenas quando a tarefa exigir documentação atualizada ou pacote novo.

## Primeiro teste do ambiente

Depois de instalar e abrir Codex dentro do repo, pedir:

```text
Leia AGENTS.md, README.md, CLAUDE.md, docs/PRD.md, docs/PLAN.md e docs/TASKS.md. Não edite nada. Resuma o projeto, os riscos atuais e os próximos 3 PRs recomendados.
```
