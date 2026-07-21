import { supabaseRestFetch } from '@/lib/supabaseRest'

export interface AccessProfile {
  user_id: string
  display_name: string
  role: string
  store: string | null
  active: boolean
}

export interface PermissionDefinition {
  key: string
  module: string
  label: string
  description: string | null
  sort_order: number
}

interface PermissionAssignment {
  user_id: string
  permission_key: string
  scope: PermissionScope
}

export type PermissionScope = '*' | 'jc' | 'ja' | 'ex'

export interface ScopedPermission {
  permissionKey: string
  scope: PermissionScope
}

export interface AccessManagementData {
  profiles: AccessProfile[]
  permissions: PermissionDefinition[]
  assignments: Record<string, ScopedPermission[]>
}

export async function loadAccessManagementData(): Promise<AccessManagementData> {
  const [profilesResponse, permissionsResponse, assignmentsResponse] = await Promise.all([
    supabaseRestFetch('app_profiles?select=user_id,display_name,role,store,active&order=display_name.asc'),
    supabaseRestFetch('app_permissions?select=key,module,label,description,sort_order&order=sort_order.asc'),
    supabaseRestFetch('app_user_permissions?select=user_id,permission_key,scope'),
  ])

  const profiles = await profilesResponse.json() as AccessProfile[]
  const permissions = (await permissionsResponse.json() as PermissionDefinition[]).map(permission =>
    permission.key === 'romaneio.acessar'
      ? {
          ...permission,
          label: 'Acessar módulo',
          description: 'Exibe o módulo Romaneio. Configure as ações e lojas abaixo.',
        }
      : permission,
  )
  const rows = await assignmentsResponse.json() as PermissionAssignment[]
  const assignments: Record<string, ScopedPermission[]> = {}

  for (const row of rows) {
    assignments[row.user_id] ??= []
    assignments[row.user_id].push({ permissionKey: row.permission_key, scope: row.scope })
  }

  return { profiles, permissions, assignments }
}

export async function replaceUserPermissions(userId: string, assignments: ScopedPermission[]): Promise<void> {
  await supabaseRestFetch('rpc/replace_user_permissions', {
    method: 'POST',
    body: JSON.stringify({
      p_user_id: userId,
      p_assignments: assignments,
    }),
  })
}

export function assignmentId(assignment: ScopedPermission): string {
  return `${assignment.permissionKey}|${assignment.scope}`
}

export function isSingleCheckboxPermissionChecked(assignments: ReadonlySet<string>, permissionKey: string): boolean {
  const prefix = `${permissionKey}|`
  return Array.from(assignments).some(assignment => assignment.startsWith(prefix))
}

export function toggleSingleCheckboxPermission(assignments: ReadonlySet<string>, permissionKey: string): Set<string> {
  const next = new Set(assignments)
  const prefix = `${permissionKey}|`
  const assignedScopes = Array.from(next).filter(assignment => assignment.startsWith(prefix))

  if (assignedScopes.length > 0) {
    assignedScopes.forEach(assignment => next.delete(assignment))
  } else {
    next.add(`${permissionKey}|*`)
  }

  return next
}

export function parseAssignmentId(value: string): ScopedPermission {
  const [permissionKey, rawScope] = value.split('|')
  const scope: PermissionScope = rawScope === 'jc' || rawScope === 'ja' || rawScope === 'ex' ? rawScope : '*'
  return { permissionKey, scope }
}

export function groupPermissions(permissions: PermissionDefinition[]): Array<{
  module: string
  permissions: PermissionDefinition[]
}> {
  const groups = new Map<string, PermissionDefinition[]>()
  for (const permission of permissions) {
    const group = groups.get(permission.module) ?? []
    group.push(permission)
    groups.set(permission.module, group)
  }
  return Array.from(groups, ([module, groupedPermissions]) => ({
    module,
    permissions: groupedPermissions,
  }))
}

export function formatStore(store: string | null): string {
  if (!store) return 'Todas as lojas'
  return store.toUpperCase()
}

export function formatRole(role: string): string {
  const labels: Record<string, string> = {
    admin: 'Administrador',
    producao: 'Produção',
    vendas: 'Atendimento',
    estoque: 'Estoque',
    compras: 'Compras',
    romaneio: 'Romaneio',
    financeiro: 'Financeiro',
    expedicao: 'Expedição',
  }
  return labels[role] ?? role
}
