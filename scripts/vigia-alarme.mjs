import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * Vigia do vigia do alarme de rotina parada (workflow vigia-alarme.yml).
 *
 * O alarme tira a fotografia do dia de segunda a sabado a partir das 08:00 em
 * Brasilia e conclui o dia quando envia o e-mail ou quando nao tem o que
 * mandar. A Edge Function devolve, sem segredo, so a data da ultima
 * fotografia concluida. Este roteiro falha (e o GitHub avisa por e-mail) quando
 * essa data nao chegou ao dia esperado. Independe do pg_cron e do Resend.
 *
 * Na duvida, falha: resposta vazia, cortada, sem o campo ou com data fora do
 * formato contam como alarme parado.
 */

export const HORA_LIMITE = 9

/** Dia e hora de Brasilia de um instante, com o dia da semana ISO (1 = segunda). */
export function relogioDeBrasilia(instante) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(instante).map(parte => [parte.type, parte.value]))
  const semana = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[partes.weekday]
  return { dia: `${partes.year}-${partes.month}-${partes.day}`, hora: Number(partes.hour), semana }
}

function diaAnterior(dia) {
  const data = new Date(`${dia}T12:00:00Z`)
  data.setUTCDate(data.getUTCDate() - 1)
  return data.toISOString().slice(0, 10)
}

function semanaDe(dia) {
  const semana = new Date(`${dia}T12:00:00Z`).getUTCDay()
  return semana === 0 ? 7 : semana
}

/**
 * O dia que ja precisa estar concluido: hoje depois das 9h de segunda a
 * sabado; antes disso, ou no domingo, o ultimo dia de segunda a sabado.
 */
export function diaEsperado(instante) {
  const relogio = relogioDeBrasilia(instante)
  let dia = relogio.semana !== 7 && relogio.hora >= HORA_LIMITE ? relogio.dia : diaAnterior(relogio.dia)
  while (semanaDe(dia) === 7) dia = diaAnterior(dia)
  return dia
}

function formatar(dia) {
  const [ano, mes, diaDoMes] = dia.split('-')
  return `${diaDoMes}/${mes}/${ano}`
}

/** Decide pelo que a funcao de saude respondeu. Nunca lanca excecao. */
export function decidir({ instante, status, corpo }) {
  const esperado = diaEsperado(instante)
  const falha = mensagem => ({ ok: false, esperado, mensagem })

  if (status !== 200) return falha(`A funcao do alarme respondeu HTTP ${status}; nao deu para conferir o envio de ${formatar(esperado)}.`)

  let resposta
  try {
    resposta = JSON.parse(corpo)
  } catch {
    return falha('A funcao do alarme respondeu um texto que nao e JSON (vazio ou cortado).')
  }
  if (!resposta || typeof resposta !== 'object' || Array.isArray(resposta) || !('ultimo_dia_concluido' in resposta)) {
    return falha('A resposta da funcao do alarme nao traz o campo ultimo_dia_concluido.')
  }

  const ultimo = resposta.ultimo_dia_concluido
  if (ultimo === null) return falha('O alarme ainda nao concluiu nenhum dia.')
  if (typeof ultimo !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ultimo)) {
    return falha('A data devolvida pela funcao do alarme esta fora do formato AAAA-MM-DD.')
  }
  if (ultimo < esperado) {
    return falha(`O alarme de ${formatar(esperado)} nao foi concluido: o ultimo dia concluido foi ${formatar(ultimo)}. Confira a tabela private.alarme_rotina_envios, o cron e o Resend.`)
  }
  return { ok: true, esperado, mensagem: `Alarme concluido: ultimo dia ${formatar(ultimo)} (esperado ${formatar(esperado)}).` }
}

async function principal() {
  const url = process.env.ALARME_SAUDE_URL
  const instante = new Date()
  let resultado
  if (!url) {
    resultado = { ok: false, mensagem: 'Falta a variavel ALARME_SAUDE_URL no workflow.' }
  } else {
    try {
      const resposta = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(20_000) })
      resultado = decidir({ instante, status: resposta.status, corpo: await resposta.text() })
    } catch (erro) {
      resultado = { ok: false, mensagem: `Nao deu para chamar a funcao do alarme: ${erro instanceof Error ? erro.message : String(erro)}` }
    }
  }

  console.log(resultado.mensagem)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${resultado.ok ? 'OK' : 'FALHA'}: ${resultado.mensagem}\n`)
  }
  if (!resultado.ok) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await principal()
}
