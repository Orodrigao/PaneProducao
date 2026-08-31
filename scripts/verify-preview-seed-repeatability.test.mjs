import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import {
  buildServerOnlySql,
  readProjectId,
  verifyPreviewSeedRepeatability,
} from './verify-preview-seed-repeatability.mjs'

describe('buildServerOnlySql', () => {
  it('envia uma transacao ao servidor e recusa comandos locais do psql', () => {
    assert.equal(buildServerOnlySql('select 1;'), 'begin;\nselect 1;\ncommit;')
    for (const maliciousSql of [
      'select 1;\n\\! env',
      '  \\getenv token GITHUB_TOKEN',
      'select 1; \\! env',
    ]) {
      assert.throws(() => buildServerOnlySql(maliciousSql), /comando local/i)
    }
  })
})

describe('readProjectId', () => {
  it('aceita somente o identificador simples do projeto local', () => {
    assert.equal(readProjectId('project_id = "pane-processo"'), 'pane-processo')
    assert.throws(() => readProjectId('project_id = "pane; rm"'), /invalido/i)
  })
})

describe('verifyPreviewSeedRepeatability', () => {
  it('desloca o plano e reaplica o arquivo canonico no Postgres local', async () => {
    const readFileImpl = mock.fn(async (file) => (
      file.endsWith('config.toml') ? 'project_id = "pane-processo"' : 'select 42;'
    ))
    const runProcess = mock.fn(async () => ({ stdout: '', stderr: '' }))

    await verifyPreviewSeedRepeatability({
      workdir: '/repo',
      readFileImpl,
      runProcess,
    })

    assert.equal(readFileImpl.mock.callCount(), 2)
    assert.equal(runProcess.mock.callCount(), 6)
    for (const call of runProcess.mock.calls) {
      const [command, args] = call.arguments
      assert.equal(command, 'docker')
      assert.equal(args[2], 'supabase_db_pane-processo')
      assert.equal(args.at(-1), '-')
    }
    assert.match(runProcess.mock.calls[0].arguments[2].input, /rodrigao\+teste@gmail\.com/)
    assert.match(runProcess.mock.calls[0].arguments[2].input, /fixture Auth da prova ja existe/)
    assert.doesNotMatch(runProcess.mock.calls[0].arguments[2].input, /on conflict/i)
    assert.match(runProcess.mock.calls[1].arguments[2].input, /select 42;/)
    assert.match(runProcess.mock.calls[2].arguments[2].input, /2000-01-01/)
    assert.match(runProcess.mock.calls[2].arguments[2].input, /2000-01-02/)
    assert.match(runProcess.mock.calls[2].arguments[2].input, /7fc00000-0000-4000-8000-000000000002/)
    assert.match(runProcess.mock.calls[2].arguments[2].input, /7fc00000-0000-4000-8000-000000000003/)
    assert.match(runProcess.mock.calls[2].arguments[2].input, /colisao real/)
    assert.match(runProcess.mock.calls[2].arguments[2].input, /30000000-0000-4000-8000-000000000101/)
    assert.match(runProcess.mock.calls[2].arguments[2].input, /guard_scheduled_pj_order_changes/)
    const viradaPj = runProcess.mock.calls[2].arguments[2].input
    const recuoDasDatas = viradaPj.indexOf('set order_date = order_date - 1')
    const criacaoDaProgramacao = viradaPj.indexOf('insert into public.pj_production_schedules')
    assert.ok(recuoDasDatas >= 0, 'a simulacao precisa recuar as datas do pedido PJ')
    assert.ok(criacaoDaProgramacao >= 0, 'a simulacao precisa criar a programacao do forno')
    assert.ok(
      recuoDasDatas < criacaoDaProgramacao,
      'a data precisa recuar antes de existir programacao, senao a trava barra a propria fixture',
    )
    assert.match(runProcess.mock.calls[3].arguments[2].input, /select 42;/)
    assert.match(runProcess.mock.calls[4].arguments[2].input, /A reaplicacao perdeu o vinculo/)
    assert.match(runProcess.mock.calls[4].arguments[2].input, /historico ficticio nao foi recriado/)
    assert.match(runProcess.mock.calls[4].arguments[2].input, /item do historico ficticio nao foi recriado/)
    assert.match(runProcess.mock.calls[4].arguments[2].input, /sobra do historico ficticio nao foi recriada/)
    assert.match(runProcess.mock.calls[4].arguments[2].input, /nao voltou para as datas de hoje/)
    assert.match(runProcess.mock.calls[4].arguments[2].input, /programacao ficticia do forno sobreviveu/)
    assert.match(runProcess.mock.calls[5].arguments[2].input, /delete from auth\.users/)
    assert.match(runProcess.mock.calls[5].arguments[2].input, /A fixture Auth nao foi removida/)
  })
})
