import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./PendingPayableItems.tsx', import.meta.url), 'utf8')

describe('classificação posterior de itens da NF-e', () => {
  it('mantém as quatro escolhas discretas e destaca a ação final de vínculo', () => {
    const existingChoice = source.indexOf('1. Produto já cadastrado (insumo ou revenda)')
    const newChoice = source.indexOf('2. Produto novo da padaria')
    const expenseChoice = source.indexOf('3. Uso ou despesa')
    const resaleChoice = source.indexOf('4. Revenda sem cadastro')

    expect(existingChoice).toBeGreaterThanOrEqual(0)
    expect(newChoice).toBeGreaterThan(existingChoice)
    expect(expenseChoice).toBeGreaterThan(newChoice)
    expect(resaleChoice).toBeGreaterThan(expenseChoice)
    expect(source).toContain('className="ps-btn primary sm block" disabled={busy === item.id} onClick={() => void save(item)}')
    expect(source).toContain('className="ps-btn ghost sm block" disabled={busy === item.id} onClick={() => openProductForm(item)}')
    expect(source).toContain(`className="ps-btn ghost sm block" disabled={busy === item.id} onClick={() => void saveWithoutProduct(item, 'uso_despesa')}`)
    expect(source).toContain(`className="ps-btn ghost sm block" disabled={busy === item.id} onClick={() => void saveWithoutProduct(item, 'revenda')}`)
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
    expect(source).toContain('classifyPayableItemWithoutProduct(item.id, value.remember, kind)')
    expect(source).toContain("'Confirmar como uso ou despesa?")
  })

  it('lança revenda sem cadastro com confirmação que diz o efeito e o custo escondido', () => {
    expect(source).toContain("'Confirmar como revenda sem cadastro? O item entra no financeiro como mercadoria, sem criar produto, sem alterar custo de receita e fora da contagem semanal.'")
    expect(source).toContain('Mostra quanto se gastou, mas não controla estoque nem margem')
    expect(source).toContain("'Item registrado como revenda sem cadastro, sem alterar custo de receita.'")
  })

  it('avisa antes do clique quando a escolha será lembrada pelo fornecedor', () => {
    const reminder = source.indexOf('esta escolha volta na próxima nota deste fornecedor.')
    const expenseAction = source.indexOf("onClick={() => void saveWithoutProduct(item, 'uso_despesa')}")
    const resaleAction = source.indexOf("onClick={() => void saveWithoutProduct(item, 'revenda')}")

    expect(reminder).toBeGreaterThanOrEqual(0)
    expect(expenseAction).toBeGreaterThan(reminder)
    expect(resaleAction).toBeGreaterThan(expenseAction)
    expect(source).toContain('Lembrar o vínculo, o uso/despesa ou a revenda sem cadastro para este fornecedor')
  })
})
