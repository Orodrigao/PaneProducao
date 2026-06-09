// Baixa em cascata de kit no descarte (/sobras): cada pão-componente do kit
// descartado é debitado do estoque da loja, multiplicando qty do kit × qty do
// componente na composição. Só componente-pão cascateia (modelo do negócio).
// Extraído de src/app/sobras/page.tsx pra ser testável — o acesso ao banco
// continua na tela; aqui só entra e sai dado.

export interface DiscardRow {
  id: string
  product_id: string
  product_source: string
  // Supabase numeric pode chegar como string — Number() resolve os dois casos
  quantity: number | string
}

export interface KitComponent {
  parent_product_id: string
  component_source: string
  component_id: string
  quantity: number | string
}

export interface CascadeMovement {
  movement_type: 'descarte_loja'
  bread_id: string
  location: string
  quantity: number
  reference_id: string
  reference_type: 'descarte_kit'
  recorded_by: string
}

/** Filtra, das linhas de descarte recém-gravadas, as que são kits do catálogo com quantidade positiva. */
export function filterKitDiscards(inserted: DiscardRow[], kitIds: Set<string>): DiscardRow[] {
  return inserted.filter(r =>
    r.product_source === 'catalog' && Number(r.quantity) > 0 && kitIds.has(r.product_id)
  )
}

/** Monta os movimentos de débito dos pães-componentes pra cada kit descartado. */
export function buildKitCascadeMovements(
  kitRows: DiscardRow[],
  comps: KitComponent[],
  store: string,
  recordedBy: string,
): CascadeMovement[] {
  const movements: CascadeMovement[] = []
  for (const kit of kitRows) {
    const kitQty = Number(kit.quantity)
    const breadComps = comps.filter(c =>
      c.parent_product_id === kit.product_id && c.component_source === 'bread'
    )
    for (const c of breadComps) {
      movements.push({
        movement_type: 'descarte_loja',
        bread_id: c.component_id,
        location: store,
        quantity: -(Number(c.quantity) * kitQty),
        reference_id: kit.id,
        reference_type: 'descarte_kit',
        recorded_by: recordedBy,
      })
    }
  }
  return movements
}
