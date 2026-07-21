import { allOrderRowsCancelled, type CancelOrderRowsResult } from '@/lib/orderCancellation'
import { supabase } from '@/lib/supabase'

export async function cancelOrderRows(
  ids: string[],
  cancelledBy: string,
  reason: string,
): Promise<CancelOrderRowsResult> {
  if (ids.length === 0) return { ok: false, message: 'Pedido sem itens para cancelar.' }

  const cancelledAt = new Date().toISOString()
  const columns = 'id,cancelled_at,cancelled_by,cancel_reason'
  const { data, error } = await supabase
    .from('orders')
    .update({ cancelled_at: cancelledAt, cancelled_by: cancelledBy, cancel_reason: reason })
    .in('id', ids)
    .is('cancelled_at', null)
    .select(columns)

  if (error) return { ok: false, message: 'Erro ao cancelar: ' + error.message }

  let confirmedRows = data || []
  if (!allOrderRowsCancelled(confirmedRows, ids)) {
    const { data: currentRows, error: verifyError } = await supabase
      .from('orders')
      .select(columns)
      .in('id', ids)

    if (verifyError) {
      return {
        ok: false,
        message: 'Não foi possível confirmar o cancelamento. Recarregue a página antes de tentar novamente.',
      }
    }
    confirmedRows = currentRows || []
  }

  if (!allOrderRowsCancelled(confirmedRows, ids)) {
    return {
      ok: false,
      message: 'O pedido não foi cancelado por completo. Recarregue a página e fale com o Rodrigo.',
    }
  }

  const first = confirmedRows[0]
  return {
    ok: true,
    cancellation: {
      cancelled_at: first.cancelled_at as string,
      cancelled_by: first.cancelled_by,
      cancel_reason: first.cancel_reason,
    },
  }
}
