import { pathToFileURL } from 'node:url'
import { arquivosPorGitDiff, referenciaGitValida } from './change-scope.mjs'

/**
 * Decide se o ensaio do CI Banco (.github/workflows/ci-banco.yml) precisa
 * rodar nesta PR. O workflow roda em toda PR, porque o job e check exigido na
 * trava da `main`: com filtro `paths:`, PR sem banco nunca receberia o check.
 *
 * Falha FECHADA: SHA ausente, git com erro ou lista truncada lancam erro e o
 * job fica vermelho. So "banco=false" explicito dispensa o ensaio.
 *
 * A lista de arquivos vem de `arquivosPorGitDiff` (change-scope.mjs), que usa
 * `git diff -z` a partir do merge-base: sem `-z`, o git poe entre aspas e
 * escapa nome com acento, e uma migration `..._produção.sql` passaria como se
 * a PR nao mexesse em banco. Arquivo renomeado conta pelos dois nomes.
 *
 * Mudou a lista, mude o paragrafo do CI Banco em docs/regras/BANCO.md.
 */

export const PASTAS_DO_BANCO = ['supabase/migrations/', 'supabase/tests/', 'supabase/tests-local/']

export const ARQUIVOS_DO_BANCO = [
  'supabase/seed.sql',
  'supabase/config.toml',
  'scripts/verify-preview-seed-repeatability.mjs',
  'scripts/verify-preview-seed-repeatability.test.mjs',
  '.github/workflows/ci-banco.yml',
  'scripts/ci-banco-escopo.mjs',
]

export function ehCaminhoDoBanco(caminho) {
  if (typeof caminho !== 'string') return false
  return ARQUIVOS_DO_BANCO.includes(caminho) || PASTAS_DO_BANCO.some((pasta) => caminho.startsWith(pasta))
}

/** Recebe a saida de `arquivosPorGitDiff`; devolve os caminhos de banco tocados. */
export function caminhosDoBancoNasMudancas(mudancas) {
  if (!Array.isArray(mudancas)) throw new Error('Lista de mudancas invalida.')
  const caminhos = mudancas.flatMap((mudanca) => [mudanca.filename, mudanca.previous_filename])
  return Array.from(new Set(caminhos.filter(ehCaminhoDoBanco)))
}

export function decidirEnsaio({ base, head, execImpl } = {}) {
  if (!referenciaGitValida(base) || !referenciaGitValida(head)) {
    throw new Error('BASE_SHA e HEAD_SHA sao obrigatorios para decidir o ensaio.')
  }
  const mudancas = arquivosPorGitDiff({ base, head, eventName: 'pull_request', execImpl })
  const doBanco = caminhosDoBancoNasMudancas(mudancas)
  return { banco: doBanco.length > 0, total: mudancas.length, doBanco }
}

function main() {
  const { banco, total, doBanco } = decidirEnsaio({ base: process.env.BASE_SHA, head: process.env.HEAD_SHA })
  // stdout vai para o $GITHUB_OUTPUT; o relato vai para o log.
  console.error(`${total} arquivo(s) na PR; ${doBanco.length} de banco.`)
  // JSON: nome com quebra de linha nao vira comando "::" do Actions no log.
  for (const caminho of doBanco) console.error(`  ${JSON.stringify(caminho)}`)
  console.log(`banco=${banco}`)
}

const execucaoDireta = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (execucaoDireta) {
  try {
    main()
  } catch (erro) {
    console.error(erro instanceof Error ? erro.message : 'Falha desconhecida ao decidir o ensaio.')
    process.exitCode = 1
  }
}
