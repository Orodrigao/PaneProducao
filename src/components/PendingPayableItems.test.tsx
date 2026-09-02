import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./PendingPayableItems.tsx', import.meta.url), 'utf8')

describe('classificação posterior de itens da NF-e', () => {
  it('não deixa caixa virar quilo com fator automático', () => {
    expect(source).toContain('conversionNeedsConfirmation')
    expect(source).toContain('Confira quanto vem na embalagem')
    expect(source).toContain('factorConfirmed: true')
  })

  it('permite resolver material de uso ou despesa sem produto canônico', () => {
    expect(source).toContain('classifyPayableItemWithoutProduct')
    expect(source).toContain('Uso ou despesa — não entra em receita')
    expect(source).toContain("window.confirm('Confirmar como uso ou despesa?")
  })
})
