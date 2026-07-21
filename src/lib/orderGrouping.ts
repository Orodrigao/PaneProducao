export interface TaggedOrderRow {
  order_group_id: string | null
  customer_id: string | null
  order_date: string
  delivery_date: string | null
}

export interface PjOrderRow extends TaggedOrderRow {
  pj_client: string | null
}

export interface EncomendaOrderRow extends TaggedOrderRow {
  walkin_name: string | null
}

export function ensureOrderGroupId(
  existingGroupId: string | null | undefined,
  generateId: () => string = () => crypto.randomUUID(),
): string {
  return existingGroupId ?? generateId()
}

export function pjOrderGroupKey(row: PjOrderRow): string {
  if (row.order_group_id) return `group:${row.order_group_id}`

  return `legacy:pj:${row.customer_id || row.pj_client || '?'}__${row.order_date}__${row.delivery_date || ''}`
}

export function encomendaOrderGroupKey(row: EncomendaOrderRow): string {
  if (row.order_group_id) return `group:${row.order_group_id}`

  const customerKey = row.customer_id
    ? `c:${row.customer_id}`
    : `w:${row.walkin_name || ''}`

  return `legacy:encomenda:${customerKey}__${row.order_date}__${row.delivery_date || ''}`
}
