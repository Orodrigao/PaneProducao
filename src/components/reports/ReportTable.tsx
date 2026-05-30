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

  if (loading) return <div className="ps-empty">Carregando...</div>
  if (rows.length === 0) return <div className="ps-empty">{emptyMessage}</div>

  return (
    <div className="ps-table-wrap" style={{overflowX:'auto'}}>
      <table className="ps-table">
        <thead>
          <tr>
            {columns.map(col => {
              const sortable = col.sortable !== false
              const alignCls = col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : ''
              return (
                <th key={col.key}
                  className={[sortable ? 'sortable' : '', alignCls].filter(Boolean).join(' ')}
                  onClick={() => toggleSort(col.key, col.sortable)}>
                  {col.label}
                  {sortKey === col.key && sortable && (
                    <span style={{marginLeft:4}}>{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i}>
              {columns.map(col => {
                const value = row[col.key]
                const display = col.format ? col.format(value, row) : String(value ?? '')
                const alignCls = col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : ''
                return (
                  <td key={col.key} className={alignCls}>
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
