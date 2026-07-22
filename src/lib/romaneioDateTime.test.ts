import { describe, expect, it } from 'vitest'
import { formatRomaneioDateTime, formatRomaneioTime } from './romaneioDateTime'

describe('romaneioDateTime', () => {
  it('mostra em Sao Paulo o horario gravado em UTC', () => {
    const createdAt = '2026-07-22T11:00:00.000Z'

    expect(formatRomaneioTime(createdAt)).toBe('08:00')
    expect(formatRomaneioDateTime(createdAt)).toBe('22/07 08:00')
  })
})
