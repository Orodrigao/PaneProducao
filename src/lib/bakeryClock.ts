// Relógio da padaria.
//
// A regra é uma só: o dia civil da padaria é o de São Paulo, qualquer que seja
// o fuso do aparelho de quem está usando. Como o código roda no navegador, esse
// fuso não é escolha nossa — é o do celular ou do computador de quem abriu a
// tela.
//
// Este módulo é a fonte de `todayKey`/`todayLabel` e das telas que gravam
// registro com a data do dia. Ele ainda NÃO é a fonte de tudo: sobram cálculos
// de "hoje" feitos à mão em Contas a Pagar, Compras, Pedidos PJ, Encomendas,
// Forno e na conciliação PJ, listados no corpo do PR desta correção. Quem
// mexer nesses arquivos deve trazê-los para cá em vez de copiar a conta.
//
// A fonte é o `Intl`, nunca aritmética com `getTimezoneOffset()`. A conta à mão
// que existia aqui antes (`-3 * 60 - getTimezoneOffset()`) tinha o sinal
// trocado: num aparelho brasileiro ela voltava 6 horas, e o sistema achava que
// ainda era ontem entre meia-noite e 05:59 — justamente o turno em que a
// padaria trabalha. Em UTC, que é onde o CI roda, a mesma conta acertava por
// acidente, então nenhum teste reclamou. Por isso os testes deste módulo rodam
// em fuso hostil.

const BAKERY_TIME_ZONE = 'America/Sao_Paulo'

const bakeryClockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BAKERY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export interface BakeryClockReading {
  /** Hoje na padaria, no formato YYYY-MM-DD. Vazio quando a data é inválida. */
  dateKey: string
  /** Dia da semana na padaria, convenção JS (0=domingo … 6=sábado). */
  dayOfWeek: number
  /** Hora cheia na padaria, de 0 a 23. */
  hour: number
  /** Minuto na padaria, de 0 a 59. */
  minute: number
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function toDayKey(value: Date): string {
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
}

// Meio-dia UTC como âncora: qualquer conta de dia feita a partir daí sobra mais
// de dez horas de folga para os dois lados, então nenhum horário de verão de
// nenhum fuso empurra o resultado para o dia vizinho.
function parseDayKey(dateKey: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null
  const parsed = new Date(`${dateKey}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  // O `Date` normaliza dia inexistente em silêncio: '2026-02-31' vira 3 de
  // março. Sem conferir a volta, uma data impossível passaria por válida e
  // sairia daqui como outra data, que é pior do que recusar.
  return toDayKey(parsed) === dateKey ? parsed : null
}

/**
 * Uma leitura só do relógio serve à data, ao dia da semana e à hora. Duas
 * leituras separadas podem cair em lados diferentes da virada do dia.
 */
export function readBakeryClock(value: Date = new Date()): BakeryClockReading {
  // `formatToParts` lança RangeError com data inválida; aqui a leitura degrada
  // para vazio, como fazem `bakeryDayKey` e `weekdayIndex`.
  if (Number.isNaN(value.getTime())) {
    return { dateKey: '', dayOfWeek: -1, hour: Number.NaN, minute: Number.NaN }
  }

  // A tupla (`as const`) e o tipo explícito existem para o compilador conferir
  // os nomes das partes. Sem eles, `Object.fromEntries` devolve `any` e um erro
  // de digitação em `parts.year` viraria a data "undefined-..." sem ninguém
  // reclamar.
  const parts = Object.fromEntries(
    bakeryClockFormatter
      .formatToParts(value)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value] as const),
  ) as Partial<Record<Intl.DateTimeFormatPartTypes, string>>
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`

  return {
    dateKey,
    dayOfWeek: weekdayIndex(dateKey),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  }
}

/** Dia civil da padaria, no formato YYYY-MM-DD, sem depender do fuso do aparelho. */
export function bakeryDayKey(value: Date = new Date()): string {
  return readBakeryClock(value).dateKey
}

/** Dia da semana de uma data YYYY-MM-DD, convenção JS. Devolve -1 se inválida. */
export function weekdayIndex(dateKey: string): number {
  const parsed = parseDayKey(dateKey)
  return parsed ? parsed.getUTCDay() : -1
}

/** Soma (ou subtrai) dias de uma data YYYY-MM-DD. Data inválida volta como veio. */
export function shiftDateKey(dateKey: string, days: number): string {
  const parsed = parseDayKey(dateKey)
  if (!parsed) return dateKey
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return toDayKey(parsed)
}
