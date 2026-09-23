import { bakeryDayKey, readBakeryClock } from './bakeryClock'

/** Hoje na padaria, no formato YYYY-MM-DD. O relógio mora em ./bakeryClock. */
export function todayKey() {
  return bakeryDayKey()
}
export function todayLabel() {
  const { dateKey, dayOfWeek } = readBakeryClock()
  const days = ['domingo','segunda','terça','quarta','quinta','sexta','sábado']
  const [, month, day] = dateKey.split('-')
  return `${days[dayOfWeek]}, ${day}/${month}`
}
export function formatDate(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})
}
export function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
export function showToast(msg: string, dur = 2800, className = 'toast') {
  const t = document.createElement('div')
  t.className = `${className} show`
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400) }, dur)
}
// Variante visual do /romaneio (.ps-toast: posição/sombra próprias).
export function showToastPS(msg: string, dur = 2800) {
  showToast(msg, dur, 'ps-toast')
}
