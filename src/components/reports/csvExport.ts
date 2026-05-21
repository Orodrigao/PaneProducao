export function csvExport(rows: Array<Record<string, any>>, filename: string) {
  if (rows.length === 0) return
  const keys = Object.keys(rows[0])
  // Separador `;` pra Excel pt-BR (Excel em locale BR usa vírgula como decimal,
  // então CSV separado por vírgula joga tudo numa coluna só). Valores numéricos
  // também devem usar vírgula como decimal — quem formata é o caller.
  const SEP = ';'
  const escapeCsv = (v: any) => {
    const s = String(v ?? '')
    if (s.includes(SEP) || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const csv = [
    keys.join(SEP),
    ...rows.map(r => keys.map(k => escapeCsv(r[k])).join(SEP)),
  ].join('\n')

  // BOM pra Excel abrir UTF-8 corretamente
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
