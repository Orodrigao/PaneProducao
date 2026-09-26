import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  ARQUIVOS_DO_BANCO,
  PASTAS_DO_BANCO,
  caminhosDoBancoNasMudancas,
  decidirEnsaio,
  ehCaminhoDoBanco,
} from './ci-banco-escopo.mjs'

/** Repositorio Git real e descartavel: a decisao roda contra o binario git de verdade. */
function repositorio() {
  const dir = mkdtempSync(join(tmpdir(), 'ci-banco-escopo-'))
  const exec = (cmd, args, opts = {}) => execFileSync(cmd, args, { ...opts, cwd: dir, encoding: 'utf8' })
  exec('git', ['init', '--quiet', '-b', 'main'])
  exec('git', ['config', 'user.email', 'teste@example.com'])
  exec('git', ['config', 'user.name', 'Teste'])
  const escrever = (caminho, conteudo = 'x\n') => {
    mkdirSync(join(dir, caminho, '..'), { recursive: true })
    writeFileSync(join(dir, caminho), conteudo)
  }
  const commitar = (mensagem) => {
    exec('git', ['add', '-A'])
    exec('git', ['commit', '--quiet', '--allow-empty', '-m', mensagem])
    return exec('git', ['rev-parse', 'HEAD']).trim()
  }
  escrever('docs/x.md')
  escrever('supabase/migrations/001_base.sql', 'create table a (id int);\n')
  escrever('supabase/functions/f.ts')
  escrever('supabase/.gitattributes')
  const base = commitar('base')
  exec('git', ['checkout', '--quiet', '-b', 'pr'])
  return { dir, exec, escrever, commitar, base, limpar: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Monta uma PR com `preparar` e devolve a decisao. */
function decidirPr(preparar) {
  const repo = repositorio()
  try {
    preparar(repo)
    const head = repo.commitar('pr')
    return decidirEnsaio({ base: repo.base, head, execImpl: repo.exec })
  } finally {
    repo.limpar()
  }
}

describe('ehCaminhoDoBanco', () => {
  it('a lista e exatamente a combinada; encolher exige mudar este teste de proposito', () => {
    assert.deepEqual(PASTAS_DO_BANCO, ['supabase/migrations/', 'supabase/tests/', 'supabase/tests-local/'])
    assert.deepEqual(ARQUIVOS_DO_BANCO, [
      'supabase/seed.sql',
      'supabase/config.toml',
      'scripts/verify-preview-seed-repeatability.mjs',
      'scripts/verify-preview-seed-repeatability.test.mjs',
      '.github/workflows/ci-banco.yml',
      'scripts/ci-banco-escopo.mjs',
    ])
  })

  it('reconhece cada arquivo e cada pasta da lista', () => {
    for (const arquivo of ARQUIVOS_DO_BANCO) assert.equal(ehCaminhoDoBanco(arquivo), true, arquivo)
    for (const pasta of PASTAS_DO_BANCO) assert.equal(ehCaminhoDoBanco(`${pasta}qualquer/coisa.sql`), true, pasta)
  })

  it('recusa os quase-iguais', () => {
    for (const caminho of [
      'supabase/seed.sql.bak',
      'supabase/config.toml.old',
      'supabase/migrations-old/a.sql',
      'xsupabase/migrations/a.sql',
      'Supabase/migrations/a.sql',
      'supabase/functions/f.ts',
      'supabase/.gitattributes',
      '.github/workflows/ci.yml',
      'scripts/ci-banco-escopo.test.mjs',
      'supabase/migrations',
      '',
      undefined,
    ]) {
      assert.equal(ehCaminhoDoBanco(caminho), false, String(caminho))
    }
  })
})

describe('caminhosDoBancoNasMudancas', () => {
  it('conta o nome antigo de arquivo renomeado', () => {
    const mudancas = [{ status: 'renamed', previous_filename: 'supabase/migrations/001.sql', filename: 'docs/001.sql' }]
    assert.deepEqual(caminhosDoBancoNasMudancas(mudancas), ['supabase/migrations/001.sql'])
  })

  it('recusa lista que nao e lista', () => {
    assert.throws(() => caminhosDoBancoNasMudancas(undefined), /invalida/)
  })
})

describe('decidirEnsaio contra git de verdade', () => {
  const casos = [
    ['so documento', false, (r) => r.escrever('docs/x.md', 'mudou\n')],
    ['migration nova', true, (r) => r.escrever('supabase/migrations/002_nova.sql')],
    ['migration com acento no nome', true, (r) => r.escrever('supabase/migrations/20260926_produção.sql')],
    ['migration com espaco e aspas no nome', true, (r) => r.escrever('supabase/migrations/002 "a".sql')],
    ['migration apagada', true, (r) => r.exec('git', ['rm', '--quiet', 'supabase/migrations/001_base.sql'])],
    [
      'migration movida para fora',
      true,
      (r) => {
        r.escrever('docs/antigas/.keep')
        r.exec('git', ['mv', 'supabase/migrations/001_base.sql', 'docs/antigas/001_base.sql'])
      },
    ],
    ['teste de banco local', true, (r) => r.escrever('supabase/tests-local/t.test.sql')],
    ['teste de banco', true, (r) => r.escrever('supabase/tests/t.test.sql')],
    ['seed', true, (r) => r.escrever('supabase/seed.sql')],
    ['config.toml', true, (r) => r.escrever('supabase/config.toml')],
    ['verificador do seed', true, (r) => r.escrever('scripts/verify-preview-seed-repeatability.mjs')],
    ['teste do verificador do seed', true, (r) => r.escrever('scripts/verify-preview-seed-repeatability.test.mjs')],
    ['o proprio workflow', true, (r) => r.escrever('.github/workflows/ci-banco.yml')],
    ['o proprio decisor', true, (r) => r.escrever('scripts/ci-banco-escopo.mjs')],
    ['funcao do supabase', false, (r) => r.escrever('supabase/functions/f.ts', 'mudou\n')],
    ['so .gitattributes do supabase', false, (r) => r.escrever('supabase/.gitattributes', 'mudou\n')],
    ['PR vazia', false, () => {}],
    [
      'lista enorme, banco no fim',
      true,
      (r) => {
        for (let i = 0; i < 2000; i += 1) r.escrever(`docs/muitos/arquivo-com-nome-comprido-${i}.md`)
        r.escrever('supabase/tests/zzz.test.sql')
      },
    ],
  ]

  for (const [nome, esperado, preparar] of casos) {
    it(nome, () => {
      assert.equal(decidirPr(preparar).banco, esperado)
    })
  }

  it('base que andou depois da PR nascer nao conta como mudanca da PR', () => {
    const repo = repositorio()
    try {
      repo.escrever('docs/x.md', 'mudou\n')
      const head = repo.commitar('pr so de texto')
      repo.exec('git', ['checkout', '--quiet', 'main'])
      repo.escrever('supabase/migrations/003_da_main.sql')
      const baseNova = repo.commitar('main ganhou migration')
      assert.equal(decidirEnsaio({ base: baseNova, head, execImpl: repo.exec }).banco, false)
    } finally {
      repo.limpar()
    }
  })

  it('falha fechada: SHA ausente, desconhecido ou invalido lanca erro', () => {
    const repo = repositorio()
    try {
      assert.throws(() => decidirEnsaio({ base: '', head: repo.base, execImpl: repo.exec }), /obrigatorios/)
      assert.throws(() => decidirEnsaio({ base: repo.base, head: undefined, execImpl: repo.exec }), /obrigatorios/)
      assert.throws(() => decidirEnsaio({ base: '0'.repeat(40), head: repo.base, execImpl: repo.exec }), /obrigatorios/)
      assert.throws(() => decidirEnsaio({ base: repo.base, head: '1234567890abcdef1234567890abcdef12345678', execImpl: repo.exec }))
    } finally {
      repo.limpar()
    }
  })

  it('falha fechada: saida truncada do git lanca erro', () => {
    const execImpl = (cmd, args) => (args[0] === 'merge-base' ? 'abc\n' : 'M\0supabase/migrations/001.sql')
    assert.throws(() => decidirEnsaio({ base: 'a', head: 'b', execImpl }), /truncada/)
  })
})

// Guardas textuais do ci-banco.yml (o projeto nao tem parser de YAML): cada uma
// barra um jeito de o check exigido ficar verde sem o ensaio ter rodado.
describe('ci-banco.yml usa a decisao', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci-banco.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const inicioDosPassos = workflow.indexOf('\n    steps:\n')
  // Cada passo comeca em "      - ", seja qual for a primeira chave.
  const passos = workflow.slice(inicioDosPassos).split('\n      - ').slice(1)
  const condicao = (passo) => passo.match(/(?:^|\n\s+)if: (.*)/)?.[1]
  const indiceEscopo = passos.findIndex((passo) => /(?:^|\n\s+)id: escopo$/m.test(passo))

  it('nao tem filtro paths: (check exigido precisa chegar em toda PR)', () => {
    assert.doesNotMatch(workflow, /^\s*paths(-ignore)?:/m)
  })

  it('nada ignora falha e o job nao tem condicao (job pulado conta como verde)', () => {
    assert.doesNotMatch(workflow, /continue-on-error/)
    assert.ok(inicioDosPassos > 0, 'bloco steps: nao encontrado')
    const cabecalhoDoJob = workflow.slice(workflow.indexOf('\n  ensaio:\n'), inicioDosPassos)
    assert.doesNotMatch(cabecalhoDoJob, /^\s+if:/m)
  })

  it('o passo de decisao so chama este script, sem desvio', () => {
    assert.ok(indiceEscopo >= 0, 'passo id: escopo nao encontrado')
    const runs = passos[indiceEscopo].match(/^\s+run:.*$/gm) ?? []
    assert.deepEqual(runs.map((linha) => linha.trim()), ['run: node scripts/ci-banco-escopo.mjs >> "$GITHUB_OUTPUT"'])
    assert.equal(condicao(passos[indiceEscopo]), undefined)
  })

  it('o teste do decisor roda no proprio job, antes da decisao', () => {
    const indiceTeste = passos.findIndex((passo) => /^\s+run: node --test scripts\/ci-banco-escopo\.test\.mjs$/m.test(passo))
    assert.ok(indiceTeste >= 0 && indiceTeste < indiceEscopo, 'teste do decisor ausente ou depois da decisao')
    for (const passo of passos.slice(0, indiceEscopo)) assert.equal(condicao(passo), undefined, passo.split('\n')[0])
  })

  it('todo passo depois da decisao roda salvo "false" explicito, menos o aviso de dispensa', () => {
    const depois = passos.slice(indiceEscopo + 1)
    assert.ok(depois.length >= 9, `poucos passos depois da decisao: ${depois.length}`)
    for (const passo of depois) {
      if (/(?:^|\n\s+)name: Dispensar o ensaio$/m.test(passo)) {
        assert.equal(condicao(passo), "steps.escopo.outputs.banco == 'false'")
      } else {
        assert.equal(condicao(passo), "steps.escopo.outputs.banco != 'false'", passo.split('\n')[0])
      }
    }
  })
})
