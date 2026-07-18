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
}

export interface AccessManagementData {
  profiles: AccessProfile[]
  permissions: PermissionDefinition[]
  assignments: Record<string, string[]>
}

export async function loadAccessManagementData(): Promise<AccessManagementData> {
  const [profilesResponse, permissionsResponse, assignmentsResponse] = await Promise.all([
    supabaseRestFetch('app_profiles?select=user_id,display_name,role,store,active&order=display_name.asc'),
    supabaseRestFetch('app_permissions?select=key,module,label,description,sort_order&order=sort_order.asc'),
    supabaseRestFetch('app_user_permissions?select=user_id,permission_key'),
  ])

  const profiles = await profilesResponse.json() as AccessProfile[]
  const permissions = await permissionsResponse.json() as PermissionDefinition[]
  const rows = await assignmentsResponse.json() as PermissionAssignment[]
  const assignments: Record<string, string[]> = {}

  for (const row of rows) {
    assignments[row.user_id] ??= []
    assignments[row.user_id].push(row.permission_key)
  }

  return { profiles, permissions, assignments }
}

export async function replaceUserPermissions(userId: string, permissionKeys: string[]): Promise<void> {
  await supabaseRestFetch('rpc/replace_user_permissions', {
    method: 'POST',
    body: JSON.stringify({
      p_user_id: userId,
      p_permission_keys: permissionKeys,
    }),
  })
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
