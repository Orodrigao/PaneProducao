import { supabase } from './supabase'
import type { PjBillingEntry, PjBillingState, PjReceiptEntry } from './pjOrderOverview'

export interface PjReadPage<T> {
  data: T[] | null
  error: { message: string } | null
  count: number | null
}

/** Never publish a partial collection as a complete order. */
export async function readAllPjPages<T extends { id: string }>(
  read: (from: number, to: number) => PromiseLike<PjReadPage<T>>,
): Promise<T[]> {
  const rows: T[] = []
  const ids = new Set<string>()
  let expected: number | null = null
  do {
    const page = await read(rows.length, rows.length + 199)
    if (page.error) throw new Error(page.error.message)
    if (!Array.isArray(page.data) || page.count === null || !Number.isInteger(page.count) || page.count < 0) {
      throw new Error('Não foi possível confirmar a leitura completa. Recarregue a lista.')
    }
    if (expected !== null && expected !== page.count) {
      throw new Error('A lista mudou durante a consulta. Recarregue para ver todos os itens.')
    }
    expected = page.count
    for (const row of page.data) {
      if (!row.id || ids.has(row.id)) throw new Error('A lista mudou durante a consulta. Recarregue.')
      ids.add(row.id)
      rows.push(row)
    }
    if (rows.length > expected || (page.data.length === 0 && rows.length < expected)) {
      throw new Error('A consulta ficou incompleta. Recarregue a lista.')
    }
  } while (rows.length < expected)
  return rows
}

export async function loadAllCommercialPjOrders<T extends { id: string }>(): Promise<T[]> {
  return readAllPjPages<T>((from, to) => supabase.from('orders')
    .select('*', { count: 'exact' }).eq('order_type', 'pj')
    .order('id').range(from, to))
}

export async function loadPjBilling(userId: string): Promise<PjBillingState> {
  try {
    const [profile, permission] = await Promise.all([
      supabase.from('app_profiles').select('active').eq('user_id', userId).single(),
      supabase.from('app_user_permissions').select('permission_key,scope')
        .eq('user_id', userId).eq('permission_key', 'contas_receber.acessar').in('scope', ['*', 'jc']),
    ])
    if (profile.error || permission.error) return { kind: 'unavailable' }
    // Keep the existing explicit financial grant, including for administrators.
    if (!profile.data?.active || !permission.data?.length) return { kind: 'restricted' }
    const bills = await readAllPjPages<PjBillingEntry>((from, to) => supabase.from('receivables')
      .select('id,origin_ref,amount,due_date,status', { count: 'exact' })
      .eq('origin', 'pedido_pj').order('id').range(from, to))
    const receipts: PjReceiptEntry[] = []
    for (let offset = 0; offset < bills.length; offset += 100) {
      receipts.push(...await readAllPjPages<PjReceiptEntry>((from, to) => supabase.from('receivable_receipts')
        .select('id,receivable_id,amount,received_date,reversed_at', { count: 'exact' })
        .in('receivable_id', bills.slice(offset, offset + 100).map(bill => bill.id)).order('id').range(from, to)))
    }
    const [profileAfter, permissionAfter] = await Promise.all([
      supabase.from('app_profiles').select('active').eq('user_id', userId).single(),
      supabase.from('app_user_permissions').select('permission_key,scope')
        .eq('user_id', userId).eq('permission_key', 'contas_receber.acessar').in('scope', ['*', 'jc']),
    ])
    if (profileAfter.error || permissionAfter.error || !profileAfter.data?.active || !permissionAfter.data?.length) return { kind: 'unavailable' }
    return { kind: 'loaded', bills, receipts }
  } catch {
    return { kind: 'unavailable' }
  }
}
