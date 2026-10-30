import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { decidir, diaEsperado, relogioDeBrasilia } from './vigia-alarme.mjs'

// Instantes em UTC; Brasilia fica 3 horas atras (sem horario de verao).
const sexta10h = new Date('2026-10-30T13:00:00Z')
const sexta0830 = new Date('2026-10-30T11:30:00Z')
const segunda0830 = new Date('2026-11-02T11:30:00Z')
const domingo = new Date('2026-11-01T15:00:00Z')

const corpo = dia => JSON.stringify({ ultimo_dia_concluido: dia })

describe('vigia do alarme: qual dia precisa estar concluido', () => {
  it('le o relogio em Brasilia', () => {
    assert.deepEqual(relogioDeBrasilia(sexta10h), { dia: '2026-10-30', hora: 10, semana: 5 })
    assert.deepEqual(relogioDeBrasilia(new Date('2026-10-31T02:30:00Z')), { dia: '2026-10-30', hora: 23, semana: 5 })
  })

  it('depois das 9h de segunda a sabado espera o proprio dia', () => {
    assert.equal(diaEsperado(sexta10h), '2026-10-30')
  })

  it('antes das 9h espera o dia anterior, pulando o domingo', () => {
    assert.equal(diaEsperado(sexta0830), '2026-10-29')
    assert.equal(diaEsperado(segunda0830), '2026-10-31')
  })

  it('no domingo espera o sabado', () => {
    assert.equal(diaEsperado(domingo), '2026-10-31')
  })
})

describe('vigia do alarme: decisao', () => {
  it('passa quando o dia esperado foi concluido', () => {
    const resultado = decidir({ instante: sexta10h, status: 200, corpo: corpo('2026-10-30') })
    assert.equal(resultado.ok, true)
    assert.match(resultado.mensagem, /30\/10\/2026/)
  })

  it('falha quando o ultimo dia concluido ficou para tras', () => {
    const resultado = decidir({ instante: sexta10h, status: 200, corpo: corpo('2026-10-29') })
    assert.equal(resultado.ok, false)
    assert.match(resultado.mensagem, /30\/10\/2026 nao foi concluido/)
    assert.match(resultado.mensagem, /29\/10\/2026/)
  })

  it('falha quando o alarme nunca concluiu um dia', () => {
    assert.equal(decidir({ instante: sexta10h, status: 200, corpo: corpo(null) }).ok, false)
  })

  it('falha com a funcao fora do ar', () => {
    const resultado = decidir({ instante: sexta10h, status: 503, corpo: '' })
    assert.equal(resultado.ok, false)
    assert.match(resultado.mensagem, /HTTP 503/)
  })

  it('falha com resposta vazia', () => {
    assert.equal(decidir({ instante: sexta10h, status: 200, corpo: '' }).ok, false)
  })

  it('falha com resposta cortada no meio', () => {
    assert.equal(decidir({ instante: sexta10h, status: 200, corpo: '{"ultimo_dia_conclu' }).ok, false)
  })

  it('falha com o campo ausente, lista ou objeto vazio', () => {
    assert.equal(decidir({ instante: sexta10h, status: 200, corpo: '{}' }).ok, false)
    assert.equal(decidir({ instante: sexta10h, status: 200, corpo: '[]' }).ok, false)
    assert.equal(decidir({ instante: sexta10h, status: 200, corpo: 'null' }).ok, false)
  })

  it('falha com data fora do formato, mesmo que pareca de hoje', () => {
    assert.equal(decidir({ instante: sexta10h, status: 200, corpo: corpo('30/10/2026') }).ok, false)
    assert.equal(decidir({ instante: sexta10h, status: 200, corpo: corpo(20261030) }).ok, false)
  })

  it('aceita dia concluido a frente do esperado', () => {
    assert.equal(decidir({ instante: sexta0830, status: 200, corpo: corpo('2026-10-30') }).ok, true)
  })
})

describe('vigia do alarme: workflow', () => {
  const workflow = readFileSync(new URL('../.github/workflows/vigia-alarme.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

  it('roda de segunda a sabado depois das 9h de Brasilia, e tambem a mao', () => {
    const cron = workflow.match(/cron:\s*"([^"]+)"/)?.[1]
    assert.equal(cron, '45 12 * * 1-6')
    const [minuto, horaUtc] = cron.split(' ').map(Number)
    assert.ok(horaUtc - 3 >= 9 && minuto >= 0, 'o agendamento precisa cair depois das 9h em Brasilia')
    assert.match(workflow, /workflow_dispatch:/)
  })

  it('chama este roteiro com a URL da funcao, sem segredo', () => {
    assert.match(workflow, /node scripts\/vigia-alarme\.mjs/)
    assert.match(workflow, /ALARME_SAUDE_URL: https:\/\/gohluceldchoitihrimw\.supabase\.co\/functions\/v1\/alarme-rotina-parada/)
    assert.doesNotMatch(workflow, /secrets\./)
  })
})
