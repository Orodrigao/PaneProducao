import { supabaseRestFetch } from './supabaseRest'

export const ROMANEIO_PERMISSION_KEYS = {
  access: 'romaneio.acessar',
  view: 'romaneio.visualizar',
  create: 'romaneio.criar',
  send: 'romaneio.confirmar_saida',
  receive: 'romaneio.conferir_recebimento',
  approve: 'romaneio.aprovar_divergencia',
  manage: 'romaneio.administrar',
} as const

export type RomaneioAction = Exclude<keyof typeof ROMANEIO_PERMISSION_KEYS, 'access'>
export type RomaneioScope = '*' | 'jc' | 'ja' | 'ex'

export interface RomaneioPermissionAssignment {
  permission_key: string
  scope: RomaneioScope
}

export type RomaneioPermissions = RomaneioPermissionAssignment[]

export async function loadCurrentRomaneioPermissions(): Promise<RomaneioPermissions> {
  const keys = Object.values(ROMANEIO_PERMISSION_KEYS).join(',')
  const response = await supabaseRestFetch(
    `app_user_permissions?permission_key=in.(${keys})&select=permission_key,scope`,
  )
  return response.json() as Promise<RomaneioPermissions>
}

export function normalizeRomaneioScope(value: string | null | undefined): RomaneioScope | '' {
  const normalized = (value ?? '').trim().toLowerCase()
  if (normalized === 'jc' || normalized === 'ja' || normalized === 'ex') return normalized
  if (normalized === '*') return '*'
  return ''
}

export function canPerformRomaneioAction(
  permissions: RomaneioPermissions,
  action: RomaneioAction,
  destinationCode?: string | null,
): boolean {
  const permissionKey = ROMANEIO_PERMISSION_KEYS[action]
  const destinationScope = normalizeRomaneioScope(destinationCode)
  return permissions.some(permission =>
    permission.permission_key === permissionKey
    && (permission.scope === '*' || (destinationScope !== '' && permission.scope === destinationScope)),
  )
}

export function visibleRomaneioScopes(permissions: RomaneioPermissions): Set<RomaneioScope> {
  const scopes = new Set<RomaneioScope>()
  for (const permission of permissions) {
    if (
      permission.permission_key === ROMANEIO_PERMISSION_KEYS.view
      || permission.permission_key === ROMANEIO_PERMISSION_KEYS.manage
    ) {
      scopes.add(permission.scope)
    }
  }
  return scopes
}
