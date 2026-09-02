import { describe, expect, it } from 'vitest'
import {
  CATALOG_TYPES,
  normalizeProductCategoryName,
  validateProductCategoryDraft,
  type ProductCategoryDraft,
} from '@/lib/productCategories'

const validDraft: ProductCategoryDraft = {
  name: 'Embalagens de produção',
  catalogType: 'embalagem',
  active: true,
  sortOrder: 10,
}

describe('normalizeProductCategoryName', () => {
  it('ignora acentos, caixa, espaços e pontuação', () => {
    expect(normalizeProductCategoryName('  EMBALÁGENS   de Produção! ')).toBe('embalagens-de-producao')
  })

  it('produz a mesma chave para grafias visualmente equivalentes', () => {
    expect(normalizeProductCategoryName('Manutenção')).toBe(normalizeProductCategoryName(' MANUTENCAO '))
  })
})

describe('validateProductCategoryDraft', () => {
  it('aceita todos os tipos previstos', () => {
    for (const catalogType of CATALOG_TYPES) {
      expect(validateProductCategoryDraft({ ...validDraft, catalogType })).toBeNull()
    }
  })

  it('recusa nome vazio ou feito apenas de símbolos', () => {
    expect(validateProductCategoryDraft({ ...validDraft, name: ' ' })).toMatch(/nome/i)
    expect(validateProductCategoryDraft({ ...validDraft, name: '---' })).toMatch(/letras ou números/i)
  })

  it('recusa ordem fracionária ou fora do limite', () => {
    expect(validateProductCategoryDraft({ ...validDraft, sortOrder: 1.5 })).toMatch(/inteiro/i)
    expect(validateProductCategoryDraft({ ...validDraft, sortOrder: 10001 })).toMatch(/10000/i)
  })
})
