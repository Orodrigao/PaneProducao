import type { AppUser } from './auth'

export type RomaneioRole = 'gustavo' | 'cleo' | 'marselle' | 'rodrigo'

type RomaneioUser = Pick<AppUser, 'id' | 'role' | 'store' | 'allowedRoutes'>

function hasRomaneioAccess(user: RomaneioUser): boolean {
  return user.role === 'admin' || user.allowedRoutes.some(
    route => route === '/romaneio' || route.startsWith('/romaneio/'),
  )
}

export function resolveRomaneioRole(user: RomaneioUser): RomaneioRole | null {
  if (user.role === 'admin') return 'rodrigo'
  if (!hasRomaneioAccess(user)) return null
  if (user.store === 'jc') return 'gustavo'
  if (user.store === 'ja') return 'cleo'
  if (user.store === 'ex') return 'marselle'
  if (user.id === 'gustavo') return 'gustavo'
  if (user.id === 'cleo') return 'cleo'
  if (user.id === 'marselle') return 'marselle'
  if (user.role === 'expedicao' || user.role === 'romaneio') return 'gustavo'
  if (user.role === 'producao' || user.role === 'financeiro') return 'marselle'
  return null
}

export function destinationCode(destination: { code?: string | null; name?: string | null } | null | undefined): string {
  const normalize = (value: string | null | undefined) =>
    (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  const code = normalize(destination?.code)
  if (code) return code
  const name = normalize(destination?.name)
  if (name.includes('EXPOS')) return 'EX'
  if (name.includes('JARDIM')) return 'JA'
  if (name.includes('JULIO')) return 'JC'
  return ''
}

export function canSeeRomaneio(
  role: RomaneioRole | null,
  destination: { code?: string | null; name?: string | null } | null | undefined,
): boolean {
  const code = destinationCode(destination)
  if (role === 'rodrigo' || role === 'gustavo') return true
  if (role === 'cleo') return code === 'JA'
  if (role === 'marselle') return code === 'EX'
  return false
}
