export const CATALOG_TYPES = [
  'materia_prima',
  'embalagem',
  'higiene_limpeza',
  'escritorio_administrativo',
  'utensilio_equipamento',
  'manutencao',
  'produto_fabricado',
  'produto_revenda',
  'kit',
] as const

export type CatalogType = typeof CATALOG_TYPES[number]

export const CATALOG_TYPE_LABELS: Record<CatalogType, string> = {
  materia_prima: 'Matéria-prima',
  embalagem: 'Embalagem',
  higiene_limpeza: 'Higiene e limpeza',
  escritorio_administrativo: 'Escritório e administrativo',
  utensilio_equipamento: 'Utensílio e equipamento',
  manutencao: 'Manutenção',
  produto_fabricado: 'Produto fabricado',
  produto_revenda: 'Produto de revenda',
  kit: 'Kit',
}

export interface ProductCategory {
  id: string
  name: string
  normalized_name: string
  catalog_type: CatalogType
  active: boolean
  sort_order: number
}

export interface ProductCategoryDraft {
  id?: string
  name: string
  catalogType: CatalogType
  active: boolean
  sortOrder: number
}

export function normalizeProductCategoryName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function validateProductCategoryDraft(draft: ProductCategoryDraft): string | null {
  const name = draft.name.trim()
  if (name.length < 2 || name.length > 80) return 'Informe um nome entre 2 e 80 caracteres.'
  if (!normalizeProductCategoryName(name)) return 'O nome precisa conter letras ou números.'
  if (!CATALOG_TYPES.includes(draft.catalogType)) return 'Escolha um tipo de item válido.'
  if (!Number.isInteger(draft.sortOrder) || draft.sortOrder < 0 || draft.sortOrder > 10000) {
    return 'A ordem deve ser um número inteiro entre 0 e 10000.'
  }
  return null
}

export async function loadProductCategories(): Promise<ProductCategory[]> {
  const { supabase } = await import('@/lib/supabase')
  const { data, error } = await supabase
    .from('product_categories')
    .select('id,name,normalized_name,catalog_type,active,sort_order')
    .order('catalog_type')
    .order('sort_order')
    .order('name')

  if (error) throw error
  return (data ?? []) as ProductCategory[]
}

export async function saveProductCategory(draft: ProductCategoryDraft): Promise<string> {
  const validationError = validateProductCategoryDraft(draft)
  if (validationError) throw new Error(validationError)

  const { supabase } = await import('@/lib/supabase')
  const { data, error } = await supabase.rpc('manage_product_category', {
    p_name: draft.name.trim(),
    p_catalog_type: draft.catalogType,
    p_id: draft.id ?? null,
    p_active: draft.active,
    p_sort_order: draft.sortOrder,
  })

  if (error) throw error
  if (typeof data !== 'string') throw new Error('O banco não devolveu a categoria salva.')
  return data
}
