import type { AppUser } from './auth'

export type ProductionHomeUserKey = 'rodrigo' | 'gustavo' | 'marselle' | 'elis' | 'geolar'

export function resolveProductionHomeUserKey(
  user: Pick<AppUser, 'role' | 'store'>,
): ProductionHomeUserKey | null {
  if (user.role === 'admin') return 'rodrigo'
  if (user.role === 'expedicao' && user.store === 'jc') return 'gustavo'
  if (user.role === 'expedicao') return 'marselle'
  if (user.role === 'vendas') return 'marselle'
  if (user.role === 'financeiro') return 'elis'
  if (user.role === 'producao') return 'geolar'
  return null
}
