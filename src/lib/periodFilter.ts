export interface ReportPeriod {
  from: Date
  to: Date
}

const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/

// Ao digitar o ano, o campo de data passa por 0002, 0020 e 0202 antes de 2026;
// fora desta faixa a data ainda está sendo digitada e não vai ao banco.
const MIN_YEAR = 2000
const MAX_YEAR = 2099

function parseDateInput(value: string, hours: number, minutes: number, seconds: number): Date | null {
  const match = DATE_INPUT.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < MIN_YEAR || year > MAX_YEAR) return null
  const date = new Date(year, month - 1, day, hours, minutes, seconds)
  // new Date(2026, 1, 30) vira 2 de março; o dia digitado precisa existir.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

// Valores de <input type="date"> no modo Custom. O campo devolve '' quando é
// apagado ou está incompleto; nesse caso não há período e a tela mantém o último válido.
export function customPeriod(fromValue: string, toValue: string): ReportPeriod | null {
  const from = parseDateInput(fromValue, 0, 0, 0)
  const to = parseDateInput(toValue, 23, 59, 59)
  if (!from || !to) return null
  return { from, to }
}
