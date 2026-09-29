import { supabase } from '@/lib/supabase'
import { buildRecipeUsageIndex, type RecipeComponentLink, type RecipeProduct, type RecipeUsageIndex } from '@/lib/recipeUsage'

const PAGE_SIZE = 500

async function loadAll<T>(loadPage: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = []
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await loadPage(start, start + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

/** Leitura das fichas atuais, independente da data das notas já compradas. */
export async function loadRecipeUsageIndex(): Promise<RecipeUsageIndex> {
  const [products, links] = await Promise.all([
    loadAll<RecipeProduct>((start, end) => supabase.from('products').select('id,name,active').order('id').range(start, end)),
    loadAll<RecipeComponentLink>((start, end) => supabase.from('product_components')
      .select('parent_product_id,component_id,component_source').order('id').range(start, end)),
  ])
  return buildRecipeUsageIndex(products, links)
}
