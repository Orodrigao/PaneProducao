import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * Le o relatorio JSON do Playwright do job "Navegador no preview desta PR",
 * escreve a tabela perfil x loja x esperado x resultado no resumo do job e
 * decide se o conjunto prova alguma coisa.
 *
 * O Playwright sai com codigo zero quando nenhum teste rodou, quando todos
 * foram pulados ou quando um teste so passou na segunda tentativa. Nenhum
 * desses casos e prova: aqui eles viram vermelho, com o motivo escrito.
 *
 * A tabela nao leva mensagem de erro nem nada lido da tela: so os rotulos da
 * matriz que o proprio teste declara e o resultado.
 */

export const ANOTACOES_DA_MATRIZ = ['perfil', 'loja', 'esperado', 'alvo']

const RESULTADOS = {
  expected: 'passou',
  unexpected: 'FALHOU',
  flaky: 'INSTAVEL (so passou repetindo)',
  skipped: 'PULADO',
}

function coletarTestes(suites, caminho = []) {
  const testes = []
  for (const suite of Array.isArray(suites) ? suites : []) {
    const aqui = suite?.title ? [...caminho, suite.title] : caminho
    for (const spec of Array.isArray(suite?.specs) ? suite.specs : []) {
      for (const teste of Array.isArray(spec?.tests) ? spec.tests : []) {
        testes.push({ titulo: [...aqui, spec.title].filter(Boolean).join(' > '), teste })
      }
    }
    testes.push(...coletarTestes(suite?.suites, aqui))
  }
  return testes
}

function celula(valor) {
  return String(valor ?? '').replace(/[|\r\n]+/g, ' ').trim() || '?'
}

export function resumirRelatorio(relatorio) {
  const motivos = []
  if (!relatorio || typeof relatorio !== 'object' || !Array.isArray(relatorio.suites)) {
    return { ok: false, linhas: [], motivos: ['O relatorio do Playwright veio sem a lista de suites.'] }
  }
  if (Array.isArray(relatorio.errors) && relatorio.errors.length > 0) {
    motivos.push(`O Playwright registrou ${relatorio.errors.length} erro(s) fora dos testes.`)
  }

  const linhas = []
  for (const { titulo, teste } of coletarTestes(relatorio.suites)) {
    const anotacoes = Array.isArray(teste?.annotations) ? teste.annotations : []
    const matriz = Object.fromEntries(ANOTACOES_DA_MATRIZ.map((tipo) => [
      tipo,
      anotacoes.find((anotacao) => anotacao?.type === tipo)?.description,
    ]))
    const resultado = RESULTADOS[teste?.status] ?? `desconhecido (${celula(teste?.status)})`
    linhas.push({ titulo, ...matriz, resultado })

    if (teste?.status !== 'expected') motivos.push(`${titulo}: ${resultado}.`)
    const faltando = ANOTACOES_DA_MATRIZ.filter((tipo) => typeof matriz[tipo] !== 'string' || !matriz[tipo].trim())
    if (faltando.length > 0) motivos.push(`${titulo}: matriz incompleta, falta ${faltando.join(', ')}.`)
  }

  if (linhas.length === 0) motivos.push('Nenhum teste foi executado.')
  const stats = relatorio.stats
  if (!stats || stats.expected !== linhas.length || stats.unexpected || stats.flaky || stats.skipped) {
    motivos.push('Os totais do Playwright nao batem com a lista de testes aprovados.')
  }
  return { ok: motivos.length === 0, linhas, motivos }
}

export function tabelaMarkdown({ ok, linhas, motivos }) {
  const partes = [
    `### Navegador no preview desta PR: ${ok ? 'aprovado' : 'REPROVADO'}`,
    '',
    '| Perfil | Loja | Esperado | Alvo | Resultado |',
    '| --- | --- | --- | --- | --- |',
    ...linhas.map((linha) => `| ${[linha.perfil, linha.loja, linha.esperado, linha.alvo, linha.resultado].map(celula).join(' | ')} |`),
  ]
  if (motivos.length > 0) partes.push('', '**Por que nao conta como prova:**', ...motivos.map((motivo) => `- ${celula(motivo)}`))
  return `${partes.join('\n')}\n`
}

function main() {
  const arquivo = process.argv[2]
  let resumo
  if (!arquivo || !existsSync(arquivo)) {
    resumo = { ok: false, linhas: [], motivos: ['O Playwright nao gerou o relatorio JSON.'] }
  } else {
    let relatorio
    try {
      relatorio = JSON.parse(readFileSync(arquivo, 'utf8'))
    } catch {
      relatorio = undefined
    }
    resumo = resumirRelatorio(relatorio)
  }
  const texto = tabelaMarkdown(resumo)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, texto)
  console.log(texto)
  if (!resumo.ok) process.exitCode = 1
}

const execucaoDireta = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (execucaoDireta) main()
