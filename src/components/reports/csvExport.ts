export function csvExport(rows: Array<Record<string, any>>, filename: string) {
  if (rows.length === 0) return
  const keys = Object.keys(rows[0])
  const escapeCsv = (v: any) => {
    const s = String(v ?? '')
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const csv = [
    keys.join(','),
    ...rows.map(r => keys.map(k => escapeCsv(r[k])).join(',')),
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
