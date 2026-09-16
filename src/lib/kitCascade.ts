// Baixa em cascata de kit no descarte (/sobras): cada componente físico do
// kit descartado (pão ou produto, inclusive uma variante específica) é
// debitado do estoque da loja, multiplicando qtd do kit × qtd do componente
// na composição. Extraído de src/app/sobras/page.tsx pra ser testável — o
// acesso ao banco continua na tela; aqui só entra e sai dado.

export interface DiscardRow {
  id: string
  product_id: string
  product_source: string
  // Supabase numeric pode chegar como string — Number() resolve os dois casos
  quantity: number | string
}

export interface KitComponent {
  parent_product_id: string
  component_source: 'bread' | 'product'
  component_id: string
  component_variant_id?: string | null
  quantity: number | string
}

export interface CascadeMovement {
  movement_type: 'descarte_loja'
  bread_id: string | null
  location: string
  quantity: number
  reference_id: string
  reference_type: 'descarte_kit'
  recorded_by: string
  product_source: 'bread' | 'product'
  product_id: string
  product_variant_id: string | null
}

/** Filtra, das linhas de descarte recém-gravadas, as que são kits do catálogo com quantidade positiva. */
export function filterKitDiscards(inserted: DiscardRow[], kitIds: Set<string>): DiscardRow[] {
  return inserted.filter(r =>
    r.product_source === 'catalog' && Number(r.quantity) > 0 && kitIds.has(r.product_id)
  )
}

/** Monta os movimentos de débito dos componentes físicos pra cada kit descartado. */
export function buildKitCascadeMovements(
  kitRows: DiscardRow[],
  comps: KitComponent[],
  store: string,
  recordedBy: string,
): CascadeMovement[] {
  const movements: CascadeMovement[] = []
  for (const kit of kitRows) {
    const kitQty = Number(kit.quantity)
    const kitComps = comps.filter(c => c.parent_product_id === kit.product_id)
    for (const c of kitComps) {
      movements.push({
        movement_type: 'descarte_loja',
        bread_id: c.component_source === 'bread' ? c.component_id : null,
        location: store,
        quantity: -(Number(c.quantity) * kitQty),
        reference_id: kit.id,
        reference_type: 'descarte_kit',
        recorded_by: recordedBy,
        product_source: c.component_source,
        product_id: c.component_id,
        product_variant_id: c.component_variant_id ?? null,
      })
    }
  }
  return movements
}
