import { describe, expect, it } from 'vitest'
import {
  CATALOG_TYPES,
  INSUMOS_CATEGORY,
  isSameProductCategory,
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

  it('trata acento solto igual a acento embutido, como o banco faz', () => {
    // 'EMBALA\u0301GENS' e "EMBALAGENS" com o acento como caractere separado,
    // a forma que alguns aparelhos mandam ao colar. Se as duas normalizacoes
    // divergirem, o banco aceita a mesma categoria duas vezes.
    expect(normalizeProductCategoryName('EMBALA\u0301GENS')).toBe('embalagens')
    expect(normalizeProductCategoryName('Ma\u0303e')).toBe(normalizeProductCategoryName('Mãe'))
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

describe('isSameProductCategory', () => {
  it('trata grafias com maiúscula diferente como a mesma categoria', () => {
    expect(isSameProductCategory('INSUMOS', INSUMOS_CATEGORY)).toBe(true)
    expect(isSameProductCategory(' insumos ', INSUMOS_CATEGORY)).toBe(true)
    expect(isSameProductCategory('Pães recheados', 'Pães Recheados')).toBe(true)
  })

  it('não confunde categorias diferentes nem valor vazio', () => {
    expect(isSameProductCategory('Revenda', INSUMOS_CATEGORY)).toBe(false)
    expect(isSameProductCategory('Pães', 'Pães Branco')).toBe(false)
    expect(isSameProductCategory(null, INSUMOS_CATEGORY)).toBe(false)
    expect(isSameProductCategory('', INSUMOS_CATEGORY)).toBe(false)
  })
})
