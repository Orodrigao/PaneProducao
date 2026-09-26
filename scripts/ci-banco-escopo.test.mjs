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

describe('ci-banco.yml usa a decisao', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci-banco.yml', import.meta.url), 'utf8')

  it('nao tem filtro paths: (check exigido precisa chegar em toda PR)', () => {
    assert.doesNotMatch(workflow, /^\s*paths(-ignore)?:/m)
  })

  it('o passo de decisao chama este script', () => {
    assert.match(workflow, /id: escopo\n(?:.*\n)*?\s+run: node scripts\/ci-banco-escopo\.mjs >> "\$GITHUB_OUTPUT"/)
  })

  it('todo passo depois da decisao roda salvo "false" explicito, menos o aviso de dispensa', () => {
    const depois = workflow.slice(workflow.indexOf('id: escopo'))
    const passos = depois.split(/\n\s+- (?:name|uses): /).slice(1)
    assert.ok(passos.length >= 9, `poucos passos depois da decisao: ${passos.length}`)
    for (const passo of passos) {
      const condicao = passo.match(/\n\s+if: (.*)/)?.[1]
      if (passo.startsWith('Dispensar o ensaio')) {
        assert.equal(condicao, "steps.escopo.outputs.banco == 'false'")
      } else {
        assert.equal(condicao, "steps.escopo.outputs.banco != 'false'", passo.split('\n')[0])
      }
    }
  })
})
