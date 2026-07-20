#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-$HOME/repos/PaneProducao}"
REPO_URL="https://github.com/Orodrigao/PaneProducao.git"

if ! command -v git >/dev/null 2>&1; then
  echo "ERRO: git não encontrado. Instale Git antes."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERRO: node não encontrado. Instale Node 20+."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERRO: npm não encontrado."
  exit 1
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "Codex CLI não encontrado. Instale com o instalador oficial conforme docs da OpenAI."
  echo "macOS/Linux: curl -fsSL https://chatgpt.com/codex/install.sh | sh"
  exit 1
fi

mkdir -p "$(dirname "$REPO_DIR")"

if [ ! -d "$REPO_DIR/.git" ]; then
  git clone "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"

git status -sb

echo "Instalando dependências..."
npm install

echo "Rodando validações base..."
npx tsc --noEmit
npm test
npm run build

echo "Abrindo Codex no repositório..."
echo "Primeiro prompt recomendado:"
echo "Leia AGENTS.md, docs/CURRENT_STATE.md e lessons.md. Nao edite nada. Resuma o projeto, o estado atual e os riscos, e aguarde a tarefa."

codex
