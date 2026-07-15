export interface PasswordRecoveryIdentity {
  userId: string
  email: string
  accessToken: string
}

interface PasswordRecoverySessionUser {
  id: string
  email?: string | null
}

interface PasswordRecoverySession {
  user: PasswordRecoverySessionUser
  access_token: string
}

function isPasswordRecoveryIdentity(value: unknown): value is PasswordRecoveryIdentity {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return typeof candidate.userId === 'string'
    && typeof candidate.email === 'string'
    && typeof candidate.accessToken === 'string'
}

export function passwordRecoveryIdentityForSession(
  serializedIdentity: string | null,
  session: PasswordRecoverySession | null,
): PasswordRecoveryIdentity | null {
  if (!serializedIdentity || !session) return null

  try {
    const identity: unknown = JSON.parse(serializedIdentity)
    if (!isPasswordRecoveryIdentity(identity)) return null
    if (identity.userId !== session.user.id) return null
    if (identity.accessToken !== session.access_token) return null

    return {
      userId: identity.userId,
      email: session.user.email ?? identity.email,
      accessToken: identity.accessToken,
    }
  } catch {
    return null
  }
}
