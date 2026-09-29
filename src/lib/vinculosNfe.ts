import { PAYABLES_PERMISSION, type AppUser } from '@/lib/auth'
import type { InvoiceLinkHistory, SupplierMapping } from '@/lib/vinculosNfeClient'

export function canViewNfeLinks(user: AppUser): boolean {
  if (!user.active) return false
  if (user.role === 'admin') return true
  return user.role === 'financeiro'
    && user.allowedRoutes.some(route => route === '*' || route === '/produtos')
    && (user.permissions ?? []).some(permission => permission.permission_key === PAYABLES_PERMISSION
      && (permission.scope === '*' || permission.scope === 'jc'))
}

export function authorName(authors: ReadonlyMap<string, string>, id: string | null | undefined): string {
  return id ? (authors.get(id) ?? 'Nome indisponível') : 'Não registrado'
}

export function dateTimeLabel(value: string | null | undefined): string {
  if (!value) return 'Data não registrada'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Data não registrada'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

export function dateLabel(value: string | null | undefined): string {
  if (!value) return 'Data não registrada'
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return 'Data não registrada'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date)
}

export function currencyLabel(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

export function mappingStatusLabel(mapping: SupplierMapping): string {
  return mapping.active ? 'Ativo' : 'Inativo'
}

export function invoiceMappingLabel(item: Pick<InvoiceLinkHistory, 'mapping_status'>): string {
  if (item.mapping_status === 'mapeado') return 'Vínculo registrado na nota'
  return 'Sem vínculo confirmado na nota'
}
