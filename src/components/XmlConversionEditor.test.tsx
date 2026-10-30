import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConversionEditor, ProductSelector } from './XmlConversionEditor'
import type { NfeItemDraft } from '@/lib/nfeXml'
import type { PayableProduct } from '@/lib/payables'

const recusaDoBanco = 'Já existe um item ativo com esse nome. Selecione o cadastro existente na NF-e.'

const products: PayableProduct[] = [
  { id: 'whey-existente', name: '100% WHEY POTE 900G LEITE', unit: 'un', category: 'Revenda' },
  { id: 'barra', name: 'BARRA DE PROTEINA CHARGE', unit: 'un', category: 'Revenda' },
]

const item: NfeItemDraft = {
  lineNumber: 1, supplierCode: 'G-1', ean: null, description: '100% WHEY POTE 900G LEITE', ncm: null,
  quantity: 2, purchaseUnit: 'UN', taxQuantity: null, taxUnit: null, unitPrice: 90,
  grossLineTotal: 180, discountValue: 0, lineTotal: 180,
  baseProductId: null, baseProductName: null, baseUnit: null, category: null,
  conversionBasis: 'simple', conversionFactor: null, usableQuantity: null, mappingStatus: 'pendente',
  rememberConversion: true, factorConfirmed: false, recognized: false,
  fiscal: {
    discount: 0, freight: 0, insurance: 0, otherExpenses: 0, importTax: 0, icmsSt: 0, fcpSt: 0,
    ipi: 0, ipiReturned: 0, icmsExempt: 0, deductsExemption: null, composesTotal: '1',
  },
}

function render(duplicateName: { name: string; message: string; matches: number } | null, catalog = products) {
  return renderToStaticMarkup(createElement(ProductSelector, {
    item, products: catalog, duplicateName,
    onChange: () => undefined, onCreate: () => undefined, onWithoutProduct: () => undefined,
  }))
}

describe('escolha do cadastro durante a importação da NF-e', () => {
  it('chama a escolha 1 de produto já cadastrado, de insumo ou de revenda', () => {
    const html = render(null)
    expect(html).toContain('1. Produto já cadastrado (insumo ou revenda)')
    expect(html).not.toContain('Insumo de receita já cadastrado')
  })

  it('mostra a recusa do banco fixa na escolha 1 e abre a busca no nome que já existe', () => {
    const html = render({ name: '100% WHEY POTE 900G LEITE', message: recusaDoBanco, matches: 1 })
    expect(html).toContain(recusaDoBanco)
    expect(html).toContain('role="alert"')
    expect(html).toContain('value="100% WHEY POTE 900G LEITE"')
    // O resultado da busca é o próprio cadastro, pronto para vincular.
    expect(html).toContain('<b>100% WHEY POTE 900G LEITE · un</b>')
  })

  it('explica quando o cadastro de mesmo nome não está na lista de insumos e revenda', () => {
    const html = render({ name: 'WHEY PROTEIN SHAKE 250ML', message: recusaDoBanco, matches: 0 })
    expect(html).toContain(recusaDoBanco)
    expect(html).toContain('não aparece nesta lista')
    expect(html).toContain('value="WHEY PROTEIN SHAKE 250ML"')
    // Criar com outro nome contornaria a recusa duplicando o produto.
    expect(html).not.toContain('outro nome')
  })

  it('com dois cadastros de mesmo nome, mostra os dois para a pessoa escolher', () => {
    const comRepetido = [...products, { id: 'whey-copia', name: '100% WHEY POTE 900G LEITE', unit: 'kg', category: 'Revenda' }]
    const html = render({ name: '100% WHEY POTE 900G LEITE', message: recusaDoBanco, matches: 2 }, comRepetido)
    expect(html).toContain('mostra os 2 cadastros com o nome')
    expect(html).toContain('<b>100% WHEY POTE 900G LEITE · un</b>')
    expect(html).toContain('<b>100% WHEY POTE 900G LEITE · kg</b>')
  })

  it('sem recusa, a busca continua começando pela primeira palavra da NF-e', () => {
    const html = render(null)
    expect(html).toContain('value="WHEY"')
    expect(html).not.toContain(recusaDoBanco)
  })
})

describe('revenda sem cadastro na importação da NF-e', () => {
  function renderItem(next: NfeItemDraft) {
    return renderToStaticMarkup(createElement(ProductSelector, {
      item: next, products, onChange: () => undefined, onCreate: () => undefined, onWithoutProduct: () => undefined,
    }))
  }

  it('mostra a quarta escolha ao lado do uso ou despesa, com o custo escondido escrito', () => {
    const html = renderItem(item)
    expect(html).toContain('Escolha um dos quatro caminhos abaixo')
    expect(html.indexOf('3. Uso ou despesa')).toBeLessThan(html.indexOf('4. Revenda sem cadastro'))
    expect(html).toContain('Lançar como revenda sem cadastro')
    expect(html).toContain('não controla estoque nem margem')
  })

  it('item já lançado como revenda sem cadastro diz o efeito, não uso ou despesa', () => {
    const resale: NfeItemDraft = { ...item, mappingStatus: 'nao_aplicavel', nonCatalogKind: 'revenda' }
    const html = renderItem(resale)
    expect(html).toContain('Revenda sem cadastro: entra no financeiro como mercadoria')
    expect(html).toContain('fora da contagem semanal')
    expect(html).not.toContain('Uso ou despesa')
    const conversion = renderToStaticMarkup(createElement(ConversionEditor, { item: resale, onChange: () => undefined }))
    expect(conversion).toContain('Revenda sem cadastro: entra no financeiro como mercadoria, sem custo de receita nem contagem.')
  })

  it('item fora do cadastro sem tipo (lembrado antes da revenda sem cadastro) continua uso ou despesa', () => {
    const html = renderItem({ ...item, mappingStatus: 'nao_aplicavel' })
    expect(html).toContain('Uso ou despesa')
    expect(html).not.toContain('Revenda sem cadastro')
  })
})
