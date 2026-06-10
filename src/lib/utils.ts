export function nowBrasilia() {
  const n = new Date()
  const o = -3 * 60 - n.getTimezoneOffset()
  return new Date(n.getTime() + o * 60000)
}
export function todayKey() {
  const d = nowBrasilia()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
export function todayLabel() {
  const d = nowBrasilia()
  const days = ['domingo','segunda','terça','quarta','quinta','sexta','sábado']
  return `${days[d.getDay()]}, ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`
}
export function formatDate(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})
}
export function formatDateBR(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
export function showToast(msg: string, dur = 2800) {
  const t = document.createElement('div')
  t.className = 'toast show'
  t.textContent = msg
  document.body.appendChild(t)
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400) }, dur)
}
