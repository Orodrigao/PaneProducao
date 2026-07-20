param(
  [string]$RepoDir = "C:\repos\PaneProducao"
)

$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/Orodrigao/PaneProducao.git"

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Comando '$Name' não encontrado. Instale antes de continuar."
  }
}

Require-Command git
Require-Command node
Require-Command npm
Require-Command codex

$Parent = Split-Path $RepoDir -Parent
if (-not (Test-Path $Parent)) {
  New-Item -ItemType Directory -Path $Parent | Out-Null
}

if (-not (Test-Path (Join-Path $RepoDir ".git"))) {
  git clone $RepoUrl $RepoDir
}

Set-Location $RepoDir

git status -sb

Write-Host "Instalando dependências..."
npm install

Write-Host "Rodando validações base..."
npx tsc --noEmit
npm test
npm run build

Write-Host "Abrindo Codex no repositório..."
Write-Host "Primeiro prompt recomendado:"
Write-Host "Leia AGENTS.md, docs/CURRENT_STATE.md e lessons.md. Nao edite nada. Resuma o projeto, o estado atual e os riscos, e aguarde a tarefa."

codex
