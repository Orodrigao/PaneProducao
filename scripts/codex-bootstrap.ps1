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

# Comandos nativos (git, npm, npx) nao lancam excecao ao falhar;
# $ErrorActionPreference nao os cobre. Validar $LASTEXITCODE e obrigatorio.
function Assert-LastExitCode($Step) {
  if ($LASTEXITCODE -ne 0) {
    throw "Falha em '$Step' (exit $LASTEXITCODE). Corrija antes de abrir o Codex."
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
  Assert-LastExitCode "git clone"
}

Set-Location $RepoDir

git status -sb
Assert-LastExitCode "git status"

Write-Host "Instalando dependências..."
npm install
Assert-LastExitCode "npm install"

Write-Host "Rodando validações base..."
npx tsc --noEmit
Assert-LastExitCode "npx tsc --noEmit"
npm test
Assert-LastExitCode "npm test"
npm run build
Assert-LastExitCode "npm run build"

Write-Host "Abrindo Codex no repositório..."
Write-Host "Primeiro prompt recomendado:"
Write-Host "Leia AGENTS.md e execute o ritual de inicio de tarefa descrito nele. Nao edite nada. Resuma o projeto, o estado atual e os riscos, e aguarde a tarefa."

codex
