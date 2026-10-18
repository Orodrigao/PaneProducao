import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// O job "Navegador (login, perfis e lojas)" do ci.yml roda o smoke inteiro com
// um so worker, entao o tempo cresce com cada teste novo. Em 168 execucoes de
// 22/09 a 17/10/2026 o smoke gastou de 4,25 a 7,21 s por teste, conforme a
// maquina do runner, enquanto a suite ia de 56 para 88 testes e o teto ficava
// nos 10 min de 23/07: o job passou a ser cancelado por tempo com todos os
// testes verdes (runs 38932007162 e 39046838744). Esta guarda reprova o npm
// test quando a estimativa conservadora da suite passa do teto, para a decisao
// (subir o teto ou acelerar a suite) acontecer antes do vermelho ao acaso numa
// PR qualquer. E estimativa, nao garantia: banco lento ou mais repeticoes
// gastam a reserva sem aumentar a contagem.
const SEGUNDOS_POR_TESTE = 7.5 // acima do mais lento medido, 7,21 s
// Preparo do job antes do smoke (~35 s), subida do servidor (~10 s) e as
// repeticoes do Playwright (retries: 1), que custaram ate ~50 s cada.
const RESERVA_SEGUNDOS = 180

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function tetoDoNavegadorEmMinutos(workflow) {
  const linhas = workflow.replace(/\r\n/g, '\n').split('\n')
  const inicio = linhas.findIndex((linha) => linha === '  navegador:')
  if (inicio === -1) return null
  for (const linha of linhas.slice(inicio + 1)) {
    if (/^ {2}[^\s#]/.test(linha)) break
    const teto = linha.match(/^ {4}timeout-minutes:\s*(\d+)\s*$/)
    if (teto) return Number(teto[1])
  }
  return null
}

function totalDeTestesListados(saida) {
  const total = saida.match(/^Total: (\d+) tests? in \d+ files?$/m)
  return total ? Number(total[1]) : null
}

function estimativaDoJobEmSegundos(testes) {
  return testes * SEGUNDOS_POR_TESTE + RESERVA_SEGUNDOS
}

function cabeNoTeto(testes, tetoEmMinutos) {
  return estimativaDoJobEmSegundos(testes) <= tetoEmMinutos * 60
}

test('o teto do Navegador e lido so do job navegador, nunca de outro job', () => {
  const workflow = [
    'jobs:',
    '  espera-restauracao:',
    '    timeout-minutes: 35',
    '  navegador:',
    '    name: Navegador (login, perfis e lojas)',
    '  # comentario no nivel dos jobs nao encerra o bloco',
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 20',
    '    steps:',
    '      - name: Passo',
    '        timeout-minutes: 3',
    '  outro:',
    '    timeout-minutes: 99',
  ].join('\r\n')
  assert.equal(tetoDoNavegadorEmMinutos(workflow), 20)
  assert.equal(tetoDoNavegadorEmMinutos(workflow.replace('    timeout-minutes: 20\r\n', '')), null)
  assert.equal(tetoDoNavegadorEmMinutos('jobs:\n  verificacao:\n    timeout-minutes: 10\n'), null)
})

test('a listagem sem total reconhecivel nao vira zero testes', () => {
  assert.equal(totalDeTestesListados('Listing tests:\n  a.spec.ts:1:1 › x\nTotal: 88 tests in 18 files\n'), 88)
  assert.equal(totalDeTestesListados('Total: 1 test in 1 file\r\n'), 1)
  assert.equal(totalDeTestesListados('Error: Cannot find module'), null)
  assert.equal(totalDeTestesListados(''), null)
})

test('a estimativa reprova os 88 testes de 17/10 no teto antigo e marca a fronteira do novo', () => {
  assert.equal(cabeNoTeto(88, 10), false)
  assert.equal(cabeNoTeto(88, 20), true)
  assert.equal(cabeNoTeto(136, 20), true)
  assert.equal(cabeNoTeto(137, 20), false)
})

test('a estimativa conservadora da suite cabe no teto do job Navegador', () => {
  const teto = tetoDoNavegadorEmMinutos(readFileSync(path.join(raiz, '.github/workflows/ci.yml'), 'utf8'))
  assert.ok(teto, 'Nao achei timeout-minutes no job navegador de .github/workflows/ci.yml.')

  const lista = spawnSync(
    process.execPath,
    [path.join(raiz, 'node_modules/@playwright/test/cli.js'), 'test', '--list'],
    { cwd: raiz, encoding: 'utf8', timeout: 30_000 },
  )
  const testes = totalDeTestesListados(lista.stdout ?? '')
  assert.ok(
    lista.status === 0 && testes,
    `Nao consegui listar os testes do navegador (status ${lista.status}${lista.error ? `, ${lista.error.message}` : ''}).\n` +
      `${lista.stdout ?? ''}\n${lista.stderr ?? ''}`,
  )

  assert.ok(
    cabeNoTeto(testes, teto),
    `O smoke do navegador tem ${testes} testes: na estimativa conservadora das medicoes ` +
      `(${SEGUNDOS_POR_TESTE} s por teste mais ${RESERVA_SEGUNDOS} s de reserva) o job leva ` +
      `${Math.ceil(estimativaDoJobEmSegundos(testes) / 60)} min e o teto em .github/workflows/ci.yml e ${teto} min. ` +
      'Suba o timeout-minutes do job navegador ou acelere a suite (sessao reaproveitada) antes de somar testes. ' +
      'Workflow e area protegida: leia docs/regras/FECHAMENTO.md e docs/regras/BANCO.md.',
  )
})
