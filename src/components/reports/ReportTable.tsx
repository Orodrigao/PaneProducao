'use client'
import { useState, useMemo } from 'react'
import type { ReactNode } from 'react'

export interface ReportTableColumn<T> {
  key: string
  label: string
  align?: 'left' | 'right' | 'center'
  format?: (value: any, row: T) => ReactNode
  sortable?: boolean
}

interface Props<T> {
  columns: ReportTableColumn<T>[]
  rows: T[]
  loading?: boolean
  emptyMessage?: string
  initialSortKey?: string
  initialSortDir?: 'asc' | 'desc'
}

export default function ReportTable<T extends Record<string, any>>({
  columns, rows, loading, emptyMessage = 'Sem dados', initialSortKey, initialSortDir = 'desc',
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | undefined>(initialSortKey)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSortDir)

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av === bv) return 0
      const less = av < bv ? -1 : 1
      return sortDir === 'asc' ? less : -less
    })
    return copy
  }, [rows, sortKey, sortDir])

  function toggleSort(key: string, sortable: boolean | undefined) {
    if (sortable === false) return
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>Carregando...</div>
  if (rows.length === 0) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>{emptyMessage}</div>

  return (
    <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid var(--border)', background: 'white' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ background: '#f9f9f9', borderBottom: '1px solid var(--border)' }}>
            {columns.map(col => (
              <th key={col.key}
                onClick={() => toggleSort(col.key, col.sortable)}
                style={{
                  textAlign: col.align ?? 'left',
                  padding: '10px 12px',
                  fontWeight: 600, fontSize: '0.7rem',
                  color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
                  cursor: col.sortable === false ? 'default' : 'pointer',
                  userSelect: 'none', whiteSpace: 'nowrap',
                }}>
                {col.label}
                {sortKey === col.key && col.sortable !== false && (
                  <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
              {columns.map(col => {
                const value = row[col.key]
                const display = col.format ? col.format(value, row) : String(value ?? '')
                return (
                  <td key={col.key} style={{ textAlign: col.align ?? 'left', padding: '8px 12px' }}>
                    {display}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
