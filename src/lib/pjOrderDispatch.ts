import type { Role } from './auth'

interface PjOrderAccessUser {
  role: Role
  store: string | null
}

export interface PjOrderAccess {
  mode: 'commercial' | 'dispatch' | 'blocked'
  canManage: boolean
  canDispatch: boolean
  showCommercialValues: boolean
}

const BLOCKED_ACCESS: PjOrderAccess = {
  mode: 'blocked',
  canManage: false,
  canDispatch: false,
  showCommercialValues: false,
}

export function resolvePjOrderAccess(user: PjOrderAccessUser | null): PjOrderAccess {
  if (!user) return BLOCKED_ACCESS

  if (user.role === 'admin' || user.role === 'financeiro') {
    return {
      mode: 'commercial',
      canManage: true,
      canDispatch: false,
      showCommercialValues: true,
    }
  }

  if (user.role === 'expedicao' && user.store === 'jc') {
    return {
      mode: 'dispatch',
      canManage: false,
      canDispatch: true,
      showCommercialValues: false,
    }
  }

  return BLOCKED_ACCESS
}
