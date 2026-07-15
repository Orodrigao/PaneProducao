import { createClient } from '@supabase/supabase-js'
import {
  passwordRecoveryIdentityForSession,
  type PasswordRecoveryIdentity,
} from '@/lib/passwordRecovery'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const PASSWORD_RECOVERY_STORAGE_KEY = 'pane_password_recovery_session'

export const supabase = createClient(SB_URL, SB_KEY)

function readPasswordRecoveryMarker(): string | null {
  if (typeof window === 'undefined') return null

  try {
    return window.sessionStorage.getItem(PASSWORD_RECOVERY_STORAGE_KEY)
  } catch {
    return null
  }
}

export function clearPasswordRecoverySession() {
  if (typeof window === 'undefined') return

  try {
    window.sessionStorage.removeItem(PASSWORD_RECOVERY_STORAGE_KEY)
  } catch {
    // O navegador pode bloquear o storage privado; a sessao do Supabase continua protegendo a operacao.
  }
}

if (typeof window !== 'undefined') {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      clearPasswordRecoverySession()
      return
    }

    if (event !== 'PASSWORD_RECOVERY' || !session?.user.email) return

    const identity: PasswordRecoveryIdentity = {
      userId: session.user.id,
      email: session.user.email,
      accessToken: session.access_token,
    }

    try {
      window.sessionStorage.setItem(PASSWORD_RECOVERY_STORAGE_KEY, JSON.stringify(identity))
    } catch {
      // Sem sessionStorage, o formulario informa que o link deve ser reaberto em um navegador comum.
    }
  })
}

export async function getPasswordRecoverySession(): Promise<PasswordRecoveryIdentity | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) return null

  return passwordRecoveryIdentityForSession(readPasswordRecoveryMarker(), data.session)
}
