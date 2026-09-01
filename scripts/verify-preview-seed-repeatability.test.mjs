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
    const criacaoDaCobranca = viradaPj.indexOf("'pedido_pj', '70000000-0000-4000-8000-000000000001'")
    assert.ok(criacaoDaCobranca >= 0, 'a simulacao precisa criar a cobranca do pedido PJ')
    assert.ok(
      recuoDasDatas < criacaoDaCobranca,
      'a data precisa recuar antes de existir cobranca, pelo mesmo motivo da programacao',
    )
    assert.match(runProcess.mock.calls[3].arguments[2].input, /select 42;/)
    assert.match(runProcess.mock.calls[4].arguments[2].input, /A reaplicacao perdeu o vinculo/)
    assert.match(runProcess.mock.calls[4].arguments[2].input, /historico ficticio nao foi recriado/)
    assert.match(runProcess.mock.calls[4].arguments[2].input, /item do historico ficticio nao foi recriado/)
    assert.match(runProcess.mock.calls[4].arguments[2].input, /sobra do historico ficticio nao foi recriada/)
    assert.match(runProcess.mock.calls[4].arguments[2].input, /nao voltou para as datas de hoje/)
    assert.match(runProcess.mock.calls[4].arguments[2].input, /programacao ficticia do forno sobreviveu/)
    assert.match(runProcess.mock.calls[4].arguments[2].input, /cobranca ficticia do pedido PJ nao foi cancelada/)
    assert.match(runProcess.mock.calls[4].arguments[2].input, /pedido novo da JC nao voltou para a data de hoje/)
    assert.match(runProcess.mock.calls[4].arguments[2].input, /pedido reaproveitado da JC nao saiu da data de hoje/)
    assert.match(runProcess.mock.calls[4].arguments[2].input, /plano de reaproveitamento ficticio nao sobreviveu inteiro/)
    assert.match(runProcess.mock.calls[4].arguments[2].input, /plano de reaproveitamento nao voltou para a data-alvo de hoje/)
    assert.match(runProcess.mock.calls[2].arguments[2].input, /update public\.bread_reuse_plans/)
    const recuoDoPedidoNovo = viradaPj.indexOf("where id = '30000000-0000-4000-8000-000000000005'")
    const avancoDoReaproveitado = viradaPj.indexOf("where id = '30000000-0000-4000-8000-000000000004'")
    assert.ok(recuoDoPedidoNovo >= 0, 'a simulacao precisa recuar o pedido novo da JC')
    assert.ok(avancoDoReaproveitado >= 0, 'a simulacao precisa por o reaproveitado na data de hoje')
    assert.ok(
      recuoDoPedidoNovo < avancoDoReaproveitado,
      'o pedido novo solta a data antes, senao a propria simulacao bate na chave unica',
    )
    const limpeza = runProcess.mock.calls[5].arguments[2].input
    const remocaoDaCobranca = limpeza.indexOf('delete from public.receivables')
    const remocaoDaConta = limpeza.indexOf('delete from auth.users')
    assert.ok(remocaoDaCobranca >= 0, 'a limpeza precisa remover a cobranca ficticia')
    assert.ok(remocaoDaConta >= 0, 'a limpeza precisa remover a conta Auth da prova')
    assert.ok(
      remocaoDaCobranca < remocaoDaConta,
      'a cobranca sai antes da conta Auth, senao a chave estrangeira trava a limpeza',
    )
    assert.match(runProcess.mock.calls[5].arguments[2].input, /delete from auth\.users/)
    assert.match(runProcess.mock.calls[5].arguments[2].input, /A fixture Auth nao foi removida/)
  })
})
