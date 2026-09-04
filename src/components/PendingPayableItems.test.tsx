import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./PendingPayableItems.tsx', import.meta.url), 'utf8')

describe('classificação posterior de itens da NF-e', () => {
  it('mantém as três escolhas discretas e destaca a ação final de vínculo', () => {
    const existingChoice = source.indexOf('1. Insumo de receita já cadastrado')
    const newChoice = source.indexOf('2. Produto novo da padaria')
    const expenseChoice = source.indexOf('3. Uso ou despesa')

    expect(existingChoice).toBeGreaterThanOrEqual(0)
    expect(newChoice).toBeGreaterThan(existingChoice)
    expect(expenseChoice).toBeGreaterThan(newChoice)
    expect(source).toContain('className="ps-btn primary sm block" disabled={busy === item.id} onClick={() => void save(item)}')
    expect(source).toContain('className="ps-btn ghost sm block" disabled={busy === item.id} onClick={() => openProductForm(item)}')
    expect(source).toContain('className="ps-btn ghost sm block" disabled={busy === item.id} onClick={() => void saveWithoutProduct(item)}')
  })

  it('cadastra o produto novo pela função existente e o deixa pronto para vincular', () => {
    expect(source).toContain('createPayableCatalogProduct(newProduct.name, newProduct.category, newProduct.unit)')
    expect(source).toContain('update(item.id, { productId: id, factorConfirmed: false })')
    expect(source).toContain('Item criado e selecionado. Confira a conversão e confirme a classificação.')
  })

  it('não deixa caixa virar quilo com fator automático', () => {
    expect(source).toContain('conversionNeedsConfirmation')
    expect(source).toContain('Confira quanto vem na embalagem')
    expect(source).toContain('factorConfirmed: true')
  })

  it('permite resolver material de uso ou despesa sem produto canônico', () => {
    expect(source).toContain('classifyPayableItemWithoutProduct')
    expect(source).toContain("window.confirm('Confirmar como uso ou despesa?")
  })

  it('avisa antes do clique quando a escolha será lembrada pelo fornecedor', () => {
    const reminder = source.indexOf('esta escolha volta na próxima nota deste fornecedor.')
    const expenseAction = source.indexOf('onClick={() => void saveWithoutProduct(item)}')

    expect(reminder).toBeGreaterThanOrEqual(0)
    expect(expenseAction).toBeGreaterThan(reminder)
  })
})
