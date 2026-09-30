import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { MATRIZ_MINIMA, resumirRelatorio as resumirComMinima, tabelaMarkdown } from './preview-pr-resumo.mjs'

// As regras gerais sao testadas sem a matriz minima; ela tem testes proprios abaixo.
const resumirRelatorio = (relatorio) => resumirComMinima(relatorio, [])

const SCRIPT = fileURLToPath(new URL('./preview-pr-resumo.mjs', import.meta.url))

const matriz = (perfil, loja, esperado, alvo) => [
  { type: 'perfil', description: perfil },
  { type: 'loja', description: loja },
  { type: 'esperado', description: esperado },
  { type: 'alvo', description: alvo },
]
const teste = (status, annotations = matriz('Vendas JA', 'JA', 'bloqueada', 'Producao da Cozinha (tela)')) => ({ status, annotations })
const relatorio = (testes, stats) => ({
  suites: [{
    title: 'perfis.spec.ts',
    specs: testes.map((t, i) => ({ title: `cenario ${i}`, tests: [t] })),
    suites: [],
  }],
  errors: [],
  stats: stats ?? {
    expected: testes.filter((t) => t.status === 'expected').length,
    unexpected: testes.filter((t) => t.status === 'unexpected').length,
    flaky: testes.filter((t) => t.status === 'flaky').length,
    skipped: testes.filter((t) => t.status === 'skipped').length,
  },
})

describe('resumirRelatorio', () => {
  it('aprova quando todos passaram de primeira e declararam a matriz', () => {
    const r = resumirRelatorio(relatorio([teste('expected'), teste('expected', matriz('Administrador', 'todas', 'entra', 'login'))]))
    assert.equal(r.ok, true, r.motivos.join('|'))
    assert.equal(r.linhas.length, 2)
    assert.equal(r.linhas[1].perfil, 'Administrador')
  })

  it('zero testes, lista vazia ou campo ausente e vermelho', () => {
    assert.equal(resumirRelatorio(relatorio([])).ok, false)
    assert.match(resumirRelatorio(relatorio([])).motivos.join(), /Nenhum teste/)
    assert.equal(resumirRelatorio(undefined).ok, false)
    assert.equal(resumirRelatorio({}).ok, false)
    assert.equal(resumirRelatorio({ suites: [{ specs: [{ title: 'x' }] }], stats: { expected: 0 } }).ok, false)
    const semStats = relatorio([teste('expected')])
    delete semStats.stats
    assert.equal(resumirRelatorio(semStats).ok, false)
  })

  it('pulado, instavel ou falho e vermelho mesmo ao lado de aprovados', () => {
    for (const status of ['skipped', 'flaky', 'unexpected', 'interrupted', undefined]) {
      const r = resumirRelatorio(relatorio([teste('expected'), teste(status)]))
      assert.equal(r.ok, false, String(status))
    }
  })

  it('teste pulado ou instavel reprova mesmo com totais que dizem o contrario', () => {
    for (const status of ['skipped', 'flaky']) {
      const r = resumirRelatorio(relatorio([teste(status)], { expected: 1, unexpected: 0, flaky: 0, skipped: 0 }))
      assert.equal(r.ok, false, status)
      assert.match(r.motivos.join(), /PULADO|INSTAVEL/, status)
    }
  })

  it('matriz incompleta e vermelho', () => {
    const semLoja = matriz('Vendas JA', 'JA', 'bloqueada', 'x').filter((a) => a.type !== 'loja')
    assert.match(resumirRelatorio(relatorio([teste('expected', semLoja)])).motivos.join(), /falta loja/)
    assert.equal(resumirRelatorio(relatorio([teste('expected', [])])).ok, false)
    assert.equal(resumirRelatorio(relatorio([teste('expected', matriz('Vendas JA', ' ', 'x', 'y'))])).ok, false)
  })

  it('totais que nao batem com a lista (relatorio truncado) sao vermelho', () => {
    const r = resumirRelatorio(relatorio([teste('expected')], { expected: 3, unexpected: 0, flaky: 0, skipped: 0 }))
    assert.equal(r.ok, false)
  })

  it('erro global do Playwright e vermelho', () => {
    const r = relatorio([teste('expected')])
    r.errors = [{ message: 'config quebrada' }]
    assert.equal(resumirRelatorio(r).ok, false)
  })

  it('acha testes em suites aninhadas', () => {
    const r = relatorio([])
    r.suites[0].suites = [{ title: 'grupo', specs: [{ title: 'dentro', tests: [teste('expected')] }] }]
    r.stats.expected = 1
    const resumo = resumirRelatorio(r)
    assert.equal(resumo.ok, true, resumo.motivos.join('|'))
    assert.equal(resumo.linhas[0].titulo, 'perfis.spec.ts > grupo > dentro')
  })
})

describe('matriz minima', () => {
  const minima = () => MATRIZ_MINIMA.map((l) => teste('expected', matriz(l.perfil, l.loja, l.esperado, l.alvo)))

  it('aprova quando as quatro linhas minimas passaram, com ou sem linhas extras', () => {
    assert.equal(resumirComMinima(relatorio(minima())).ok, true)
    assert.equal(resumirComMinima(relatorio([...minima(), teste('expected', matriz('Cozinha JC', 'JC', 'entra', 'x'))])).ok, true)
  })

  it('apagar qualquer cenario minimo reprova, mesmo com o resto verde e anotado', () => {
    for (let i = 0; i < MATRIZ_MINIMA.length; i += 1) {
      const r = resumirComMinima(relatorio(minima().filter((_, j) => j !== i)))
      assert.equal(r.ok, false, String(i))
      assert.match(r.motivos.join(), /Matriz minima incompleta/)
    }
  })

  it('linha minima presente mas reprovada conta como faltando', () => {
    const linhas = minima()
    linhas[3] = { ...linhas[3], status: 'unexpected' }
    assert.match(resumirComMinima(relatorio(linhas)).motivos.join(), /Matriz minima incompleta: falta aprovar Vendas JA/)
  })

  it('a matriz minima e a mesma que o roteiro de demonstracao declara', () => {
    const roteiro = readFileSync(fileURLToPath(new URL('../test/preview-pr/perfis.spec.ts', import.meta.url)), 'utf8')
    for (const l of MATRIZ_MINIMA) {
      assert.ok(roteiro.includes(`matriz('${l.perfil}', '${l.loja}', '${l.esperado}', '${l.alvo}')`), JSON.stringify(l))
    }
  })
})

describe('tabelaMarkdown', () => {
  it('uma linha por teste e barra vertical nao quebra a tabela', () => {
    const texto = tabelaMarkdown(resumirRelatorio(relatorio([teste('expected', matriz('A|B', 'JA', 'entra', 'x\ny'))])))
    assert.match(texto, /\| A B \| JA \| entra \| x y \| passou \|/)
    assert.match(texto, /aprovado/)
  })
})

describe('execucao direta', () => {
  const rodar = (conteudo) => {
    const pasta = mkdtempSync(join(tmpdir(), 'resumo-'))
    try {
      const resumo = join(pasta, 'resumo.md')
      const arquivo = join(pasta, 'relatorio.json')
      if (conteudo !== undefined) writeFileSync(arquivo, conteudo)
      const r = spawnSync(process.execPath, [SCRIPT, arquivo], { env: { ...process.env, GITHUB_STEP_SUMMARY: resumo }, encoding: 'utf8' })
      return { status: r.status, resumo: readFileSync(resumo, 'utf8') }
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  }

  it('relatorio ausente ou ilegivel sai com erro e explica no resumo', () => {
    for (const conteudo of [undefined, '{nao e json']) {
      const r = rodar(conteudo)
      assert.equal(r.status, 1)
      assert.match(r.resumo, /REPROVADO/)
    }
  })

  it('relatorio aprovado sai com zero', () => {
    const r = rodar(JSON.stringify(relatorio(MATRIZ_MINIMA.map((l) => teste('expected', matriz(l.perfil, l.loja, l.esperado, l.alvo))))))
    assert.equal(r.status, 0, r.resumo)
    assert.match(r.resumo, /Vendas JA/)
  })
})
