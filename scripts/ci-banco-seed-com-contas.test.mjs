import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it, mock } from 'node:test'
import { buildAccountsSql, seedWithAccounts } from './ci-banco-seed-com-contas.mjs'
import { PREVIEW_USERS } from './provision-preview-users.mjs'

describe('buildAccountsSql', () => {
  it('cria as mesmas contas do Banco Preview, sem duplicar as que ja existem', () => {
    const sql = buildAccountsSql()
    for (const { email } of PREVIEW_USERS) assert.ok(sql.includes(`'${email}'`), email)
    assert.equal(sql.match(/^ {2}\('/gm)?.length, PREVIEW_USERS.length)
    assert.match(sql, /where not exists \(\s*select 1 from auth\.users existing where lower\(existing\.email\) = account\.email/)
  })

  it('as contas batem com as que a verificacao do Banco Preview exige', async () => {
    const verification = await readFile(new URL('../supabase/verification/preview_users.sql', import.meta.url), 'utf8')
    const expected = [...verification.matchAll(/'(rodrigao\+[^']+@gmail\.com)'/g)].map(([, email]) => email)
    assert.deepEqual(
      [...new Set(expected)].sort(),
      PREVIEW_USERS.map(({ email }) => email).sort(),
    )
  })

  it('recusa e-mail ou nome que escaparia da string SQL', () => {
    assert.throws(() => buildAccountsSql([{ email: "x'); drop table auth.users; --@a.com", displayName: 'X' }]), /E-mail/)
    assert.throws(() => buildAccountsSql([{ email: 'a@b.com', displayName: "O'Brien" }]), /Nome/)
    assert.throws(() => buildAccountsSql([]), /vazia/)
  })
})

describe('seedWithAccounts', () => {
  const arquivos = {
    'config.toml': 'project_id = "pane-processo"',
    'seed.sql': 'select 1 as seed;',
    'preview_users.sql': 'select 1 as verificacao;',
  }
  const readFileImpl = mock.fn(async (file) => {
    const nome = Object.keys(arquivos).find((chave) => String(file).replaceAll('\\', '/').endsWith(`/${chave}`))
    if (!nome) throw new Error(`arquivo inesperado: ${file}`)
    return arquivos[nome]
  })

  it('cria as contas, reaplica o seed e confere os perfis, nessa ordem, so no container local', async () => {
    const runProcess = mock.fn(async () => ({ stdout: '', stderr: '' }))
    await seedWithAccounts({ workdir: '/repo', readFileImpl, runProcess })

    assert.equal(runProcess.mock.callCount(), 3)
    const entradas = runProcess.mock.calls.map((call) => {
      const [command, args, { input }] = call.arguments
      assert.equal(command, 'docker')
      assert.deepEqual(args, [
        'exec', '-i', 'supabase_db_pane-processo',
        'psql', '--username', 'postgres', '--dbname', 'postgres',
        '--set', 'ON_ERROR_STOP=1', '--file', '-',
      ])
      return input
    })
    assert.match(entradas[0], /insert into auth\.users/)
    assert.equal(entradas[1], 'begin;\nselect 1 as seed;\ncommit;')
    assert.equal(entradas[2], 'begin;\nselect 1 as verificacao;\ncommit;')
  })

  for (const [etapa, chamadaQueFalha] of [['contas', 1], ['seed', 2], ['conferencia dos perfis', 3]]) {
    it(`falha em ${etapa} deixa o passo vermelho e nao segue adiante`, async () => {
      let chamadas = 0
      const runProcess = mock.fn(async () => {
        chamadas += 1
        if (chamadas === chamadaQueFalha) throw new Error(`psql falhou em ${etapa}`)
        return { stdout: '', stderr: '' }
      })
      await assert.rejects(seedWithAccounts({ workdir: '/repo', readFileImpl, runProcess }), new RegExp(`psql falhou em ${etapa}`))
      assert.equal(runProcess.mock.callCount(), chamadaQueFalha)
    })
  }
})
