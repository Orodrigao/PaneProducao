import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { bakeryDayKey, readBakeryClock, shiftDateKey, weekdayIndex } from './bakeryClock'
import { todayKey, todayLabel } from './utils'

// Estes testes rodam de propósito em quatro fusos, e não só no da máquina.
//
// A armadilha desta família de defeito é acertar por acidente em UTC, que é
// onde o CI roda: a conta antiga (`-3 * 60 - getTimezoneOffset()`) devolvia a
// data certa em UTC e a data de ontem num aparelho brasileiro entre meia-noite
// e 05:59. Sem trocar o fuso, nenhum teste segura essa regressão.
//
// Restaurar pelo nome da zona resolvida, nunca pelo valor cru de
// `process.env.TZ`: quando ele não está definido, `process.env.TZ = undefined`
// grava a string 'undefined' (que o Node trata como UTC) e `delete` não
// devolve o fuso do sistema. Os dois deixariam os arquivos seguintes da suíte
// rodando no fuso errado.
const FUSOS_DE_TESTE = ['UTC', 'Asia/Tokyo', 'America/Sao_Paulo', 'Pacific/Kiritimati']

// 01:30 da manhã em São Paulo na quarta 23/09/2026. É a faixa onde o defeito
// aparecia: a padaria já está trabalhando e o sistema achava que era terça.
const MADRUGADA_NA_PADARIA = '2026-09-23T04:30:00.000Z'
// 11:00 em São Paulo do mesmo dia. Em Tóquio já são 23:00, o que separa o fuso
// do aparelho do fuso da padaria fora da madrugada.
const MEIO_DIA_NA_PADARIA = '2026-09-23T14:00:00.000Z'

describe.each(FUSOS_DE_TESTE)('relógio da padaria com o aparelho em %s', timeZone => {
  const fusoOriginal = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone

  beforeAll(() => { process.env.TZ = timeZone })
  afterAll(() => { process.env.TZ = fusoOriginal })
  afterEach(() => { vi.useRealTimers() })

  it('lê data, dia da semana e hora em São Paulo a partir do instante', () => {
    expect(readBakeryClock(new Date('2026-09-23T10:39:00Z'))).toEqual({
      dateKey: '2026-09-23',
      dayOfWeek: 3,
      hour: 7,
      minute: 39,
    })
  })

  it('respeita a virada do dia em São Paulo, não a do aparelho', () => {
    // Um segundo antes da meia-noite de São Paulo ainda é terça 22/09.
    expect(readBakeryClock(new Date('2026-09-23T02:59:59Z'))).toEqual({
      dateKey: '2026-09-22', dayOfWeek: 2, hour: 23, minute: 59,
    })
    // A meia-noite vira quarta 23/09 com hora 0, nunca 24.
    expect(readBakeryClock(new Date('2026-09-23T03:00:00Z'))).toEqual({
      dateKey: '2026-09-23', dayOfWeek: 3, hour: 0, minute: 0,
    })
    // Virada de ano: 01/01/2027 em UTC ainda é 31/12/2026 na padaria.
    expect(readBakeryClock(new Date('2027-01-01T02:59:00Z'))).toEqual({
      dateKey: '2026-12-31', dayOfWeek: 4, hour: 23, minute: 59,
    })
  })

  it('bakeryDayKey acompanha a leitura completa', () => {
    expect(bakeryDayKey(new Date(MADRUGADA_NA_PADARIA))).toBe('2026-09-23')
    expect(bakeryDayKey(new Date('2026-09-09T02:59:59.000Z'))).toBe('2026-09-08')
    expect(bakeryDayKey(new Date('2026-09-09T03:00:00.000Z'))).toBe('2026-09-09')
  })

  // O defeito que motivou a issue 438, medido onde ele aparece: na madrugada.
  it('todayKey devolve hoje entre meia-noite e 6h, não ontem', () => {
    vi.useFakeTimers()

    // 00:00 em ponto na padaria.
    vi.setSystemTime(new Date('2026-09-23T03:00:00.000Z'))
    expect(todayKey()).toBe('2026-09-23')

    // 01:30, horário em que o romaneio de madrugada é criado.
    vi.setSystemTime(new Date(MADRUGADA_NA_PADARIA))
    expect(todayKey()).toBe('2026-09-23')

    // 05:59, último minuto da faixa defeituosa.
    vi.setSystemTime(new Date('2026-09-23T08:59:00.000Z'))
    expect(todayKey()).toBe('2026-09-23')

    // 06:00, onde a conta antiga já acertava.
    vi.setSystemTime(new Date('2026-09-23T09:00:00.000Z'))
    expect(todayKey()).toBe('2026-09-23')

    // Fora da madrugada, com o aparelho num fuso adiantado.
    vi.setSystemTime(new Date(MEIO_DIA_NA_PADARIA))
    expect(todayKey()).toBe('2026-09-23')

    // 23:59 continua sendo hoje, e não amanhã.
    vi.setSystemTime(new Date('2026-09-24T02:59:00.000Z'))
    expect(todayKey()).toBe('2026-09-23')
  })

  it('todayLabel nomeia o dia da semana da padaria', () => {
    vi.useFakeTimers()

    vi.setSystemTime(new Date(MADRUGADA_NA_PADARIA))
    expect(todayLabel()).toBe('quarta, 23/09')

    // Domingo 27/09 às 02:00 na padaria: o aparelho em Kiritimati já virou
    // segunda, e o rótulo tem de continuar dizendo domingo.
    vi.setSystemTime(new Date('2026-09-27T05:00:00.000Z'))
    expect(todayLabel()).toBe('domingo, 27/09')
  })

  it('weekdayIndex e shiftDateKey não dependem do fuso do aparelho', () => {
    expect(weekdayIndex('2026-09-23')).toBe(3)
    expect(weekdayIndex('2026-09-27')).toBe(0)
    expect(shiftDateKey('2026-09-23', -1)).toBe('2026-09-22')
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDateKey('2026-09-23', 7)).toBe('2026-09-30')
    // Ano bissexto tem 29 de fevereiro; 2026 não tem.
    expect(shiftDateKey('2028-03-01', -1)).toBe('2028-02-29')
  })

  // As bordas de hora decidem o aviso de prazo da tela inicial e a regra das 6h
  // do Planejamento. Errar em um minuto aqui muda o que a padaria vê.
  it('a hora vira no minuto certo, e não no do aparelho', () => {
    // 03:59 e 04:00 em São Paulo.
    expect(readBakeryClock(new Date('2026-09-23T06:59:00Z'))).toMatchObject({ hour: 3, minute: 59 })
    expect(readBakeryClock(new Date('2026-09-23T07:00:00Z'))).toMatchObject({ hour: 4, minute: 0 })
    // 05:59, último minuto da faixa onde o defeito vivia, e 06:00.
    expect(readBakeryClock(new Date('2026-09-23T08:59:00Z'))).toMatchObject({ hour: 5, minute: 59 })
    expect(readBakeryClock(new Date('2026-09-23T09:00:00Z'))).toMatchObject({ hour: 6, minute: 0 })
    // 23:59 continua sendo hoje.
    expect(readBakeryClock(new Date('2026-09-24T02:59:00Z')))
      .toMatchObject({ dateKey: '2026-09-23', hour: 23, minute: 59 })
  })
})

describe('bakeryClock com entrada inválida', () => {
  it('degrada sem lançar', () => {
    expect(readBakeryClock(new Date(Number.NaN))).toEqual({
      dateKey: '', dayOfWeek: -1, hour: Number.NaN, minute: Number.NaN,
    })
    expect(bakeryDayKey(new Date(Number.NaN))).toBe('')
    expect(weekdayIndex('')).toBe(-1)
    expect(weekdayIndex('abc')).toBe(-1)
    expect(shiftDateKey('', 1)).toBe('')
    expect(shiftDateKey('abc', 1)).toBe('abc')
  })

  // `new Date` normaliza dia inexistente em silêncio: '2026-02-31' vira 3 de
  // março. Recusar é melhor que devolver outra data com cara de certa.
  it('recusa dia que não existe no calendário em vez de deslizar', () => {
    expect(weekdayIndex('2026-02-31')).toBe(-1)
    expect(weekdayIndex('2026-02-29')).toBe(-1) // 2026 não é bissexto
    expect(weekdayIndex('2026-13-01')).toBe(-1)
    expect(weekdayIndex('2026-04-31')).toBe(-1)
    expect(shiftDateKey('2026-02-31', -1)).toBe('2026-02-31')
    expect(shiftDateKey('2026-02-29', 1)).toBe('2026-02-29')
    // O dia 29 existe em ano bissexto e precisa continuar passando.
    expect(weekdayIndex('2028-02-29')).toBe(2)
  })
})

// `nowBrasilia` devolvia um Date deslocado na marra, e cada tela que o usava
// reinventava a leitura de hora e de dia em cima dele. Quem precisar de hora
// da padaria agora usa `readBakeryClock`. Trazer a função de volta traz junto
// o defeito de 6 horas, então a ausência dela é testada.
describe('o relógio é um só', () => {
  it('nowBrasilia não é declarada nem chamada em lugar nenhum de src/', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { resolve, join } = await import('node:path')

    const arquivosComOTermo: string[] = []
    const varrer = (dir: string) => {
      for (const entrada of readdirSync(dir)) {
        const caminho = join(dir, entrada)
        if (statSync(caminho).isDirectory()) { varrer(caminho); continue }
        if (!/\.(ts|tsx)$/.test(entrada)) continue
        if (caminho.endsWith('bakeryClock.test.ts')) continue
        // Declaração ou chamada, não a menção do nome num comentário.
        if (/\bnowBrasilia\s*\(/.test(readFileSync(caminho, 'utf8'))) arquivosComOTermo.push(entrada)
      }
    }
    varrer(resolve(__dirname, '..'))

    expect(arquivosComOTermo).toEqual([])
  })
})
