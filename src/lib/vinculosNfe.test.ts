import { describe, expect, it } from 'vitest'
import type { AppUser } from '@/lib/auth'
import { authorName, canViewNfeLinks, correctionActionLabel, currencyLabel, dateLabel, dateTimeLabel, describeCorrectionEffect, factorInputText, invoiceMappingLabel, invoiceMatchesMemory, mappingStatusLabel, nfeLinksHref, parseFactorInput, productIdFromNfeLinksSearch } from '@/lib/vinculosNfe'

function user(overrides: Partial<AppUser> = {}): AppUser {
  return {
    id: 'user-1', username: 'user', displayName: 'Pessoa', role: 'financeiro', active: true,
    allowedRoutes: ['/produtos'], store: 'jc',
    permissions: [{ permission_key: 'contas_pagar.acessar', scope: 'jc' }],
    ...overrides,
  }
}

describe('consulta de vínculos de NF-e', () => {
  it('permite administrador ativo e Financeiro com rota e acesso a pagar', () => {
    expect(canViewNfeLinks(user())).toBe(true)
    expect(canViewNfeLinks(user({ role: 'admin', permissions: [] }))).toBe(true)
  })

  it('bloqueia Financeiro sem rota ou permissão e qualquer perfil inativo', () => {
    expect(canViewNfeLinks(user({ allowedRoutes: ['/contas-pagar'] }))).toBe(false)
    expect(canViewNfeLinks(user({ permissions: [] }))).toBe(false)
    expect(canViewNfeLinks(user({ role: 'vendas' }))).toBe(false)
    expect(canViewNfeLinks(user({ active: false }))).toBe(false)
  })

  it('exibe autores indisponíveis sem inventar nome', () => {
    expect(authorName(new Map([['a', 'Elis']]), 'a')).toBe('Elis')
    expect(authorName(new Map(), 'a')).toBe('Nome indisponível')
    expect(authorName(new Map(), null)).toBe('Não registrado')
  })

  it('formata valores, datas e situação do item da nota', () => {
    expect(currencyLabel(12.5)).toContain('12,50')
    expect(dateLabel('2026-09-29')).toBe('29/09/2026')
    expect(dateTimeLabel(null)).toBe('Data não registrada')
    expect(invoiceMappingLabel({ mapping_status: 'mapeado' })).toBe('Vínculo registrado na nota')
    expect(invoiceMappingLabel({ mapping_status: 'pendente' })).toBe('Sem vínculo confirmado na nota')
  })

  it('lê o fator com vírgula ou ponto e recusa zero, texto e casas demais', () => {
    expect(parseFactorInput('12')).toBe(12)
    expect(parseFactorInput(' 0,5 ')).toBe(0.5)
    expect(parseFactorInput('2.5')).toBe(2.5)
    expect(parseFactorInput('0,000001')).toBe(0.000001)
    expect(parseFactorInput('0')).toBeNull()
    expect(parseFactorInput('-1')).toBeNull()
    expect(parseFactorInput('abc')).toBeNull()
    expect(parseFactorInput('')).toBeNull()
    expect(parseFactorInput('1,0000001')).toBeNull()
    expect(parseFactorInput('100000000')).toBeNull()
  })

  it('não lê ponto de milhar como decimal e devolve o fator do campo sem perda', () => {
    expect(parseFactorInput('1.000')).toBeNull()
    expect(parseFactorInput('25.000')).toBeNull()
    expect(parseFactorInput('1.000,5')).toBe(1000.5)
    expect(parseFactorInput('1000')).toBe(1000)
    expect(parseFactorInput('0.125')).toBe(0.125)
    expect(parseFactorInput('12.500,25')).toBe(12500.25)
    // Erro de digitação vira recusa, nunca outro número.
    expect(parseFactorInput('2 5')).toBeNull()
    expect(parseFactorInput('0,1 25')).toBeNull()
    expect(parseFactorInput('1234.567,5')).toBeNull()
    expect(parseFactorInput('0.125,0')).toBeNull()
    expect(parseFactorInput('1.000.000')).toBeNull()
    expect(parseFactorInput('1,5,0')).toBeNull()
    for (const value of [1000, 25000, 12.5, 0.000001, 1234567.123456]) {
      expect(parseFactorInput(factorInputText(value))).toBe(value)
    }
  })

  it('rotula situação da memória e ação desconhecida sem inventar', () => {
    expect(mappingStatusLabel({ active: true })).toContain('Ligada')
    expect(mappingStatusLabel({ active: false })).toContain('Desligada')
    expect(correctionActionLabel('desligar')).toBe('Memória desligada')
    expect(correctionActionLabel('outra')).toBe('outra')
  })

  it('reconhece o item da nota pela mesma regra da memória', () => {
    const memory = { supplier_id: 's1', supplier_product_code: 'C1', supplier_ean: 'SEM GTIN', supplier_description: 'Farinha', purchase_unit: 'SC' }
    const invoice = { supplier_id: 's1', source_code: 'C1', source_ean: 'SEM GTIN', source_description: 'Farinha', source_unit: 'SC' }
    expect(invoiceMatchesMemory(memory, invoice)).toBe(true)
    expect(invoiceMatchesMemory(memory, { ...invoice, supplier_id: 's2' })).toBe(false)
    expect(invoiceMatchesMemory(memory, { ...invoice, source_unit: 'KG' })).toBe(false)
    // "SEM GTIN" não é código de barras: outro código com o mesmo texto não casa.
    expect(invoiceMatchesMemory(memory, { ...invoice, source_code: 'C2' })).toBe(false)
    const semCodigo = { ...memory, supplier_product_code: null, supplier_ean: null }
    expect(invoiceMatchesMemory(semCodigo, { ...invoice, source_code: null, source_description: ' farinha ' })).toBe(true)
  })

  it('descreve o efeito da correção e garante que notas antigas não mudam', () => {
    const memory = { supplier_name: 'Moinho', supplier_description: 'Farinha T1', supplier_product_code: 'F1', purchase_unit: 'SC', conversion_factor: 25, base_unit: 'kg', active: true }
    const corrigir = describeCorrectionEffect({
      action: 'corrigir', memory, currentProductName: 'Farinha errada',
      newProduct: { name: 'Farinha certa', unit: 'kg' }, newFactor: 50, savedInvoices: 3,
      recipeNames: ['Pão francês'], recipesTruncated: false,
    })
    expect(corrigir[0]).toContain('vai sugerir Farinha certa, 1 SC = 50 kg')
    expect(corrigir[1]).toContain('Hoje sugere Farinha errada, 1 SC = 25 kg')
    expect(corrigir[2]).toContain('Pão francês')
    expect(corrigir.some(line => line.startsWith('Quem estiver com uma NF-e de Moinho aberta normalmente precisará reabrir'))).toBe(true)
    expect(corrigir.at(-1)).toContain('3 item(ns) deste fornecedor já gravado(s) em notas com Farinha errada')
    const desligada = describeCorrectionEffect({
      action: 'corrigir', memory: { ...memory, active: false }, currentProductName: 'Farinha errada',
      newProduct: { name: 'Farinha certa', unit: 'kg' }, newFactor: 50, savedInvoices: 0, recipeNames: [], recipesTruncated: false,
    })
    expect(desligada[1]).toBe('Hoje está desligada (sugeria Farinha errada, 1 SC = 25 kg); a correção também a religa.')
    const desligar = describeCorrectionEffect({ action: 'desligar', memory, currentProductName: 'Farinha errada', savedInvoices: 0, recipeNames: [], recipesTruncated: false })
    expect(desligar[0]).toContain('chega sem a sugestão desta memória')
    expect(desligar.at(-1)).toBe('Nenhuma nota já gravada muda.')
  })
})

describe('atalho da tela Produtos para os vínculos', () => {
  const id = '96200000-0000-4000-8000-000000000013'

  it('monta o link com o produto e volta à tela sem produto quando não há id', () => {
    expect(nfeLinksHref(id)).toBe(`/produtos/vinculos?produto=${id}`)
    expect(nfeLinksHref(undefined)).toBe('/produtos/vinculos')
    expect(nfeLinksHref(null)).toBe('/produtos/vinculos')
  })

  it('lê de volta só um identificador válido', () => {
    expect(productIdFromNfeLinksSearch(nfeLinksHref(id).split('?')[1])).toBe(id)
    expect(productIdFromNfeLinksSearch(`?produto=${id.toUpperCase()}`)).toBe(id)
    expect(productIdFromNfeLinksSearch('')).toBeNull()
    expect(productIdFromNfeLinksSearch('?produto=')).toBeNull()
    expect(productIdFromNfeLinksSearch('?produto=manteiga')).toBeNull()
    expect(productIdFromNfeLinksSearch(`?produto=${id},drop`)).toBeNull()
  })
})
