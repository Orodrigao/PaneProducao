import {
  CATALOG_TYPES,
  CATALOG_TYPE_LABELS,
  type CatalogType,
  type ProductCategory,
} from './productCategories'

// Fase 2B do catálogo: a tela de produto escolhe a categoria da lista
// controlada e grava, no mesmo salvamento, os três campos que descrevem o item
// (categoria controlada, tipo de item e o texto legado). Até aqui a tela
// montava o corpo do salvamento a partir de `select('*')`, então devolvia ao
// banco o tipo e a categoria antigos enquanto trocava o texto livre: toda
// edição de categoria deixava as duas informações discordando.

export interface ProductCatalogClassification {
  category: string
  category_id: string | null
  catalog_type: CatalogType | null
  is_revenda: boolean
}

export interface CatalogCategoryGroup {
  catalogType: CatalogType
  label: string
  categories: ProductCategory[]
}

// Ordem em que os grupos aparecem na tela de produto, do que mais se cadastra
// para o que menos. A ordem do enum é a do banco e começa por matéria-prima e
// embalagem, deixando Escritório e Manutenção (um produto cada) acima de Produto
// fabricado, que reúne catorze categorias. Quem cadastra abre a lista atrás de
// pão muito mais vezes que atrás de chave de toalheiro.
const CATALOG_TYPE_PICKER_ORDER = [
  'materia_prima',
  'produto_fabricado',
  'produto_revenda',
  'embalagem',
  'higiene_limpeza',
  'escritorio_administrativo',
  'manutencao',
  'utensilio_equipamento',
  'servico',
  'kit',
] as const satisfies readonly CatalogType[]

const CATALOG_TYPE_ORDER = new Map<CatalogType, number>(
  CATALOG_TYPE_PICKER_ORDER.map((catalogType, index) => [catalogType, index]),
)

// Se um tipo novo entrar no catálogo e ninguém o colocar na ordem acima, ele
// desapareceria da lista da tela sem aviso. Esta guarda quebra a compilação.
type TiposForaDaOrdemDoPicker = Exclude<CatalogType, typeof CATALOG_TYPE_PICKER_ORDER[number]>
const _todoTipoTemLugarNaLista:
  TiposForaDaOrdemDoPicker extends never ? true : TiposForaDaOrdemDoPicker = true
void _todoTipoTemLugarNaLista

/**
 * Categorias oferecidas na tela, agrupadas por tipo de item. Categoria inativa
 * fica fora da lista, exceto a que o produto já usa: escondê-la faria a tela
 * abrir mostrando outra categoria e trocar a classificação de quem só quis
 * corrigir o custo.
 */
export function groupCategoriesForPicker(
  categories: ProductCategory[],
  currentCategoryId?: string | null,
): CatalogCategoryGroup[] {
  const offered = categories.filter(category => category.active || category.id === currentCategoryId)
  const groups = new Map<CatalogType, ProductCategory[]>()
  for (const category of offered) {
    if (!CATALOG_TYPE_ORDER.has(category.catalog_type)) continue
    const bucket = groups.get(category.catalog_type)
    if (bucket) bucket.push(category)
    else groups.set(category.catalog_type, [category])
  }

  return [...groups.entries()]
    .sort((a, b) => (CATALOG_TYPE_ORDER.get(a[0]) ?? 0) - (CATALOG_TYPE_ORDER.get(b[0]) ?? 0))
    .map(([catalogType, bucket]) => ({
      catalogType,
      label: CATALOG_TYPE_LABELS[catalogType],
      categories: [...bucket].sort(
        (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'pt-BR'),
      ),
    }))
}

/**
 * A categoria do produto ficou fora da lista oferecida? Pode ser lista que não
 * carregou, ou categoria de um tipo que o navegador ainda não conhece, que
 * `groupCategoriesForPicker` descarta de propósito. Nos dois casos a tela precisa
 * de uma opção de segurança, senão o campo mostra a primeira categoria da lista
 * enquanto o produto continua apontando para outra.
 */
export function needsCurrentCategoryFallback(
  groups: CatalogCategoryGroup[],
  currentCategoryId: string | null | undefined,
): boolean {
  if (!currentCategoryId) return false
  return !groups.some(group => group.categories.some(category => category.id === currentCategoryId))
}

/**
 * O que impede a tela de oferecer a escolha, em uma frase, ou nulo quando a
 * lista está utilizável. Lista vazia não vem com erro do banco: policy que
 * filtra por linha e tabela ainda sem dado devolvem zero linhas e sucesso. Sem
 * isto, a tela cobraria uma escolha que não oferece e o salvamento recusaria em
 * laço, sem dizer por quê.
 */
export function describeCategoryPickerProblem(input: {
  loadError: string | null
  categoryCount: number
}): string | null {
  if (input.loadError) return `${input.loadError} Recarregue a tela para escolher a categoria.`
  if (input.categoryCount === 0) {
    return 'A lista de categorias chegou vazia. Recarregue a tela; se continuar vazia, avise antes de cadastrar produto novo.'
  }
  return null
}

/**
 * Quem manda sobre "isto é revenda" é a categoria controlada, por decisão do
 * Rodrigo em 2026-09-22: a marcação à mão ficou esquecida em 33 produtos que
 * estão na categoria Revenda. Produto que ainda não tem categoria controlada
 * mantém a marcação antiga, porque nesse caso ela é a única resposta existente.
 */
export function resolveIsRevenda(
  catalogType: CatalogType | null | undefined,
  currentIsRevenda: boolean | null | undefined,
): boolean {
  if (!catalogType) return Boolean(currentIsRevenda)
  return catalogType === 'produto_revenda'
}

/**
 * Efeito de escolher uma categoria na tela. O texto legado passa a ser o nome
 * da categoria para Sobras, Itens JC, Tabelas de preço e a contagem de estoque,
 * que ainda leem `products.category`, continuarem agrupando certo.
 */
export function applyCategoryChoice(
  categoryId: string,
  categories: ProductCategory[],
  current: { category?: string | null; is_revenda?: boolean | null },
): ProductCatalogClassification {
  const chosen = categories.find(category => category.id === categoryId)
  if (!chosen) {
    return {
      category: current.category ?? '',
      category_id: null,
      catalog_type: null,
      is_revenda: Boolean(current.is_revenda),
    }
  }

  return {
    category: chosen.name,
    category_id: chosen.id,
    catalog_type: chosen.catalog_type,
    is_revenda: resolveIsRevenda(chosen.catalog_type, current.is_revenda),
  }
}

/**
 * Texto legado que vai ao banco. Quando existe categoria controlada, quem manda
 * é o nome dela: produto editado entre a fase 2A e esta ficou com o texto de uma
 * categoria e a gaveta de outra, e cada salvamento agora acerta isso. Sem a
 * lista carregada não há nome para resolver, e aí o texto de hoje é preservado
 * em vez de virar vazio.
 */
export function resolveLegacyCategoryText(
  categoryId: string | null | undefined,
  categories: ProductCategory[],
  currentText: string | null | undefined,
): string {
  if (!categoryId) return currentText ?? ''
  return categories.find(category => category.id === categoryId)?.name ?? currentText ?? ''
}

/**
 * Produto novo não nasce sem classificação (decisão do Rodrigo, 2026-09-22).
 * Produto antigo continua salvando sem escolher, senão corrigir um custo
 * viraria uma decisão de classificação que ninguém pediu.
 */
export function validateProductCatalogChoice(input: {
  isNew: boolean
  categoryId?: string | null
  catalogType?: CatalogType | null
}): string | null {
  if (input.isNew && (!input.categoryId || !input.catalogType)) {
    return 'Escolha a categoria do produto; ela define o tipo de item.'
  }
  if (input.categoryId && !input.catalogType) {
    return 'A categoria escolhida ficou sem tipo de item; recarregue a tela e escolha de novo.'
  }
  return null
}

/**
 * Colunas que a tela de produto edita. O salvamento envia só estas: montar o
 * corpo a partir da linha inteira devolvia ao banco colunas que a tela nem
 * mostra, e era isso que reescrevia a classificação com o valor antigo.
 * Coluna de fora não é apagada — ela simplesmente não viaja, e o banco mantém
 * o valor que já tinha.
 */
export const PRODUCT_SAVE_COLUMNS = [
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
] as const

export type ProductSaveColumn = typeof PRODUCT_SAVE_COLUMNS[number]

export function pickProductSaveColumns<T extends object>(
  source: T,
): Partial<Pick<T, Extract<keyof T, ProductSaveColumn>>> {
  const payload: Record<string, unknown> = {}
  for (const column of PRODUCT_SAVE_COLUMNS) {
    if (column in source) payload[column] = (source as Record<string, unknown>)[column]
  }
  return payload as Partial<Pick<T, Extract<keyof T, ProductSaveColumn>>>
}
