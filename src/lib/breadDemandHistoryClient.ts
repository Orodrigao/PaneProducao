import {
  breadDemandCandidateDates,
  summarizeBreadDemandHistory,
  type BreadDemandBreadRow,
  type BreadDemandDestinationRow,
  type BreadDemandLeftoverRow,
  type BreadDemandRomaneioItemRow,
  type BreadDemandRomaneioRow,
  type BreadDemandSummary,
  type FirmBreadOrderRow,
} from './breadDemandHistory'
import { destinationCode } from './romaneioAccess'
import { supabase } from './supabase'

interface ProductLegacyLinkRow {
  id: string
  legacy_bread_id: string | null
}

export async function fetchBreadDemandHistory(
  targetDate: string,
  breads: BreadDemandBreadRow[],
): Promise<Record<string, BreadDemandSummary>> {
  const candidateDates = breadDemandCandidateDates(targetDate)
  const breadIds = breads.map(bread => bread.id)
  if (candidateDates.length === 0) throw new Error('invalid target date')

  const [destinationsResult, leftoversResult, productLinksResult, firmOrdersResult] = await Promise.all([
    supabase
      .from('destinations')
      .select('id,code,name')
      .eq('active', true),
    supabase
      .from('sobras')
      .select('record_date,store,product_id,product_source,quantity')
      .in('record_date', candidateDates)
      .in('store', ['jc', 'ja'])
      .eq('product_source', 'bread'),
    supabase
      .from('products')
      .select('id,legacy_bread_id')
      .in('legacy_bread_id', breadIds),
    supabase
      .from('orders')
      .select('bread_id,product_source,quantity,pricing_unit,store,order_type,order_date,production_date,pj_delivery_date,cancelled_at')
      .is('cancelled_at', null)
      .gt('quantity', 0)
      .or(`order_date.eq.${targetDate},production_date.eq.${targetDate},pj_delivery_date.eq.${targetDate}`),
  ])

  const firstError = destinationsResult.error
    ?? leftoversResult.error
    ?? productLinksResult.error
    ?? firmOrdersResult.error
  if (firstError) throw firstError

  const destinations = (destinationsResult.data ?? []) as BreadDemandDestinationRow[]
  const managedDestinations = destinations.filter(destination => {
    const code = destinationCode(destination).toLowerCase()
    return code === 'jc' || code === 'ja'
  })
  // Uma loja ausente, inativa ou escondida pela RLS não pode derrubar o bloco
  // dos outros pães nem o da loja que está íntegra: a que faltar simplesmente
  // não terá dias válidos e o card dirá "sem histórico" só para ela.
  if (managedDestinations.length === 0) {
    throw new Error('managed destinations unavailable')
  }

  const romaneiosResult = await supabase
    .from('romaneios')
    .select('id,record_date,destination_id')
    .in('record_date', candidateDates)
    .in('destination_id', managedDestinations.map(destination => destination.id))
  if (romaneiosResult.error) throw romaneiosResult.error

  const romaneios = (romaneiosResult.data ?? []) as BreadDemandRomaneioRow[]
  const romaneioIds = romaneios.map(romaneio => romaneio.id)
  let romaneioItems: BreadDemandRomaneioItemRow[] = []

  if (romaneioIds.length > 0) {
    const romaneioItemsResult = await supabase
      .from('romaneio_items')
      .select('romaneio_id,product_id,product_source,product_name,qty_sent,qty_accepted')
      .in('romaneio_id', romaneioIds)
      .in('product_source', ['bread', 'product'])
    if (romaneioItemsResult.error) throw romaneioItemsResult.error
    romaneioItems = (romaneioItemsResult.data ?? []) as BreadDemandRomaneioItemRow[]
  }

  const productLinks = ((productLinksResult.data ?? []) as ProductLegacyLinkRow[]).map(row => ({
    productId: row.id,
    legacyBreadId: row.legacy_bread_id,
  }))

  return summarizeBreadDemandHistory({
    targetDate,
    breads,
    productLinks,
    destinations: managedDestinations,
    romaneios,
    romaneioItems,
    leftovers: (leftoversResult.data ?? []) as BreadDemandLeftoverRow[],
    firmOrders: (firmOrdersResult.data ?? []) as FirmBreadOrderRow[],
  })
}
