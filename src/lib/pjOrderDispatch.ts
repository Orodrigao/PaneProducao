import type { AppPermissionRow, Role } from './auth'

export const PJ_ORDER_LAUNCH_PERMISSION = 'pedidos_pj.lancar'
// Quem lança precisa acompanhar o pedido na jornada, e a leitura da jornada
// pela Expedição exige a confirmação de envio. O banco confere o mesmo par.
const PJ_ORDER_DISPATCH_PERMISSION = 'pedidos_pj.confirmar_envio'

function hasJcPermission(permissions: readonly AppPermissionRow[], key: string): boolean {
  return permissions.some(permission => permission.permission_key === key
    && (permission.scope === '*' || permission.scope === 'jc'))
}

interface PjOrderAccessUser {
  role: Role
  store: string | null
  permissions?: readonly AppPermissionRow[]
}

export interface PjOrderAccess {
  mode: 'commercial' | 'dispatch' | 'blocked'
  canManage: boolean
  canDispatch: boolean
  // Expedição JC com permissão explícita lança pedido sem ver preço. O banco
  // confere o mesmo na gravação; aqui só decide se o botão aparece.
  canLaunch: boolean
  showCommercialValues: boolean
}

const BLOCKED_ACCESS: PjOrderAccess = {
  mode: 'blocked',
  canManage: false,
  canDispatch: false,
  canLaunch: false,
  showCommercialValues: false,
}

export function resolvePjOrderAccess(user: PjOrderAccessUser | null): PjOrderAccess {
  if (!user) return BLOCKED_ACCESS

  if (user.role === 'admin' || user.role === 'financeiro') {
    return {
      mode: 'commercial',
      canManage: true,
      canDispatch: false,
      canLaunch: false,
      showCommercialValues: true,
    }
  }

  if (user.role === 'expedicao' && user.store === 'jc') {
    return {
      mode: 'dispatch',
      canManage: false,
      canDispatch: true,
      canLaunch: hasJcPermission(user.permissions ?? [], PJ_ORDER_LAUNCH_PERMISSION)
        && hasJcPermission(user.permissions ?? [], PJ_ORDER_DISPATCH_PERMISSION),
      showCommercialValues: false,
    }
  }

  return BLOCKED_ACCESS
}
