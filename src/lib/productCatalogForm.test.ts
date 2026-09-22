import { describe, expect, it } from 'vitest'
import {
  applyCategoryChoice,
  groupCategoriesForPicker,
  pickProductSaveColumns,
  resolveLegacyCategoryText,
  resolveIsRevenda,
  validateProductCatalogChoice,
  PRODUCT_SAVE_COLUMNS,
} from '@/lib/productCatalogForm'
import type { ProductCategory } from '@/lib/productCategories'

function category(overrides: Partial<ProductCategory> & Pick<ProductCategory, 'id' | 'name' | 'catalog_type'>): ProductCategory {
  return {
    normalized_name: overrides.name.toLocaleLowerCase('pt-BR'),
    active: true,
    sort_order: 0,
    ...overrides,
  }
}

const insumos = category({ id: 'cat-insumos', name: 'Insumos', catalog_type: 'materia_prima', sort_order: 10 })
const revenda = category({ id: 'cat-revenda', name: 'Revenda', catalog_type: 'produto_revenda', sort_order: 10 })
const paes = category({ id: 'cat-paes', name: 'Pães', catalog_type: 'produto_fabricado', sort_order: 20 })
const confeitaria = category({ id: 'cat-confeitaria', name: 'Confeitaria', catalog_type: 'produto_fabricado', sort_order: 10 })
const servicos = category({ id: 'cat-servicos', name: 'Serviços', catalog_type: 'servico', sort_order: 10 })

describe('groupCategoriesForPicker', () => {
  it('agrupa por tipo de item na ordem do catálogo e ordena dentro do grupo', () => {
    const groups = groupCategoriesForPicker([paes, revenda, insumos, confeitaria])

    expect(groups.map(group => group.catalogType)).toEqual(['materia_prima', 'produto_fabricado', 'produto_revenda'])
    expect(groups[1].label).toBe('Produto fabricado')
    expect(groups[1].categories.map(item => item.name)).toEqual(['Confeitaria', 'Pães'])
  })

  it('esconde categoria inativa', () => {
    const groups = groupCategoriesForPicker([insumos, { ...revenda, active: false }])

    expect(groups.flatMap(group => group.categories.map(item => item.id))).toEqual(['cat-insumos'])
  })

  it('mantém a categoria inativa que o produto já usa, para a tela não trocar a classificação sozinha', () => {
    const inativa = { ...revenda, active: false }
    const groups = groupCategoriesForPicker([insumos, inativa], 'cat-revenda')

    expect(groups.flatMap(group => group.categories.map(item => item.id))).toContain('cat-revenda')
  })
})

describe('resolveIsRevenda', () => {
  it('marca revenda quando o tipo de item é produto de revenda', () => {
    expect(resolveIsRevenda('produto_revenda', false)).toBe(true)
  })

  it('desmarca quando a categoria escolhida é de outro tipo, mesmo se estava marcado', () => {
    expect(resolveIsRevenda('materia_prima', true)).toBe(false)
    expect(resolveIsRevenda('servico', true)).toBe(false)
  })

  it('preserva a marcação antiga enquanto o produto não tem categoria controlada', () => {
    expect(resolveIsRevenda(null, true)).toBe(true)
    expect(resolveIsRevenda(undefined, false)).toBe(false)
  })
})

describe('applyCategoryChoice', () => {
  it('grava categoria, tipo de item e o texto legado com o nome da categoria', () => {
    const result = applyCategoryChoice('cat-insumos', [insumos, revenda], { category: 'Confeitaria', is_revenda: false })

    expect(result).toEqual({
      category: 'Insumos',
      category_id: 'cat-insumos',
      catalog_type: 'materia_prima',
      is_revenda: false,
    })
  })

  it('liga a marcação de revenda ao escolher uma categoria de revenda', () => {
    const result = applyCategoryChoice('cat-revenda', [insumos, revenda], { category: 'Insumos', is_revenda: false })

    expect(result.catalog_type).toBe('produto_revenda')
    expect(result.is_revenda).toBe(true)
  })

  it('desliga a marcação ao tirar o produto de uma categoria de revenda', () => {
    const result = applyCategoryChoice('cat-servicos', [revenda, servicos], { category: 'Revenda', is_revenda: true })

    expect(result.catalog_type).toBe('servico')
    expect(result.is_revenda).toBe(false)
  })

  it('limpa a classificação e preserva o texto quando a escolha é vazia', () => {
    const result = applyCategoryChoice('', [insumos], { category: 'Insumos', is_revenda: true })

    expect(result).toEqual({ category: 'Insumos', category_id: null, catalog_type: null, is_revenda: true })
  })
})

describe('resolveLegacyCategoryText', () => {
  it('usa o nome da categoria controlada', () => {
    expect(resolveLegacyCategoryText('cat-insumos', [insumos, revenda], 'Confeitaria')).toBe('Insumos')
  })

  it('acerta o texto de produto que ficou divergente antes desta fase', () => {
    // Editado entre a fase 2A e a 2B: texto de uma categoria, gaveta de outra.
    expect(resolveLegacyCategoryText('cat-revenda', [insumos, revenda], 'Insumos')).toBe('Revenda')
  })

  it('preserva o texto atual quando a lista não carregou', () => {
    expect(resolveLegacyCategoryText('cat-revenda', [], 'Revenda')).toBe('Revenda')
  })

  it('preserva o texto de produto antigo sem categoria controlada', () => {
    expect(resolveLegacyCategoryText(null, [insumos], 'Pães')).toBe('Pães')
  })

  it('devolve texto vazio em vez de nulo', () => {
    expect(resolveLegacyCategoryText(null, [insumos], null)).toBe('')
  })
})

describe('validateProductCatalogChoice', () => {
  it('exige categoria em produto novo', () => {
    expect(validateProductCatalogChoice({ isNew: true, categoryId: null, catalogType: null }))
      .toBe('Escolha a categoria do produto; ela define o tipo de item.')
  })

  it('aceita produto antigo sem classificação', () => {
    expect(validateProductCatalogChoice({ isNew: false, categoryId: null, catalogType: null })).toBeNull()
  })

  it('aceita produto novo classificado', () => {
    expect(validateProductCatalogChoice({ isNew: true, categoryId: 'cat-paes', catalogType: 'produto_fabricado' })).toBeNull()
  })

  it('recusa categoria sem tipo de item, que a trava do banco rejeitaria com erro cru', () => {
    expect(validateProductCatalogChoice({ isNew: false, categoryId: 'cat-paes', catalogType: null }))
      .toBe('A categoria escolhida ficou sem tipo de item; recarregue a tela e escolha de novo.')
  })
})

describe('pickProductSaveColumns', () => {
  // O defeito que a fase 2B conserta: a tela lia o produto com select('*') e
  // devolvia a linha inteira no salvamento, então o tipo e a categoria antigos
  // voltavam ao banco enquanto o texto livre mudava.
  it('envia a classificação escolhida, não a que veio do banco', () => {
    const rowFromDatabase = {
      id: 'prod-1',
      name: 'Bombom',
      category: 'Insumos',
      category_id: 'cat-insumos',
      catalog_type: 'materia_prima' as const,
      is_revenda: false,
    }
    const escolha = applyCategoryChoice('cat-revenda', [insumos, revenda], rowFromDatabase)

    const payload = pickProductSaveColumns({ ...rowFromDatabase, ...escolha })

    expect(payload.category).toBe('Revenda')
    expect(payload.category_id).toBe('cat-revenda')
    expect(payload.catalog_type).toBe('produto_revenda')
    expect(payload.is_revenda).toBe(true)
  })

  it('não carrega coluna que a tela não edita', () => {
    const payload = pickProductSaveColumns({
      id: 'prod-1',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-02T00:00:00Z',
      sort_order: 7,
      legacy_bread_id: 'bread-1',
      active: false,
      name: 'Pão de forma',
    })

    expect(Object.keys(payload)).toEqual(['name'])
  })

  it('não inventa coluna ausente no formulário', () => {
    const payload = pickProductSaveColumns({ name: 'Focaccia', category: 'Pães' })

    expect(Object.keys(payload).sort()).toEqual(['category', 'name'])
  })

  it('preserva valor nulo que a pessoa apagou de propósito', () => {
    const payload = pickProductSaveColumns({ name: 'Sopa', cost_price: null, production_process: null })

    expect(payload).toEqual({ name: 'Sopa', cost_price: null, production_process: null })
  })

  it('cobre todos os campos que o formulário de produto edita', () => {
    expect([...PRODUCT_SAVE_COLUMNS]).toEqual([
      'name',
      'category',
      'category_id',
      'catalog_type',
      'unit',
      'cost_price',
      'kind',
      'is_revenda',
      'is_shelf',
      'weekly_count_enabled',
      'is_fabricacao_propria',
      'is_pj',
      'production_days',
      'production_area',
      'production_process',
      'allows_planned_production',
      'allows_unplanned_production',
    ])
  })
})
