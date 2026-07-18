'use client'
import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { getPasswordRecoverySession } from '@/lib/supabase'
import {
  getCurrentUserAsync,
  firstAllowedRoute,
  logout,
  navigateAfterAuthentication,
  passwordPolicyChecklist,
  sendPasswordSetupLink,
  signInWithEmailPassword,
  updateCurrentUserPassword,
} from '@/lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode]     = useState<'password' | 'setup'>('password')
  const [email, setEmail]   = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [emailMsg, setEmailMsg] = useState('')
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [emailOk, setEmailOk] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [setupLoading, setSetupLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [returnTo, setReturnTo] = useState<string | null>(null)
  const passwordRules = passwordPolicyChecklist(password)

  function safeReturnTo(value: string | null): string | null {
    if (!value) return null
    if (!value.startsWith('/') || value.startsWith('//')) return null
    if (value.includes('://')) return null
    return value
  }

  useEffect(() => {
    let alive = true

    async function boot() {
      const params = new URLSearchParams(window.location.search)
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const isPasswordSetup = params.get('mode') === 'senha' || hashParams.get('type') === 'recovery'
      const forceEmailLogin = params.get('force') === 'email'
      const nextReturnTo = safeReturnTo(params.get('returnTo'))
      let recoverySessionError = ''

      // A tela de troca de senha só pode usar a sessão emitida pelo link de recuperação.
      // Uma sessão normal, mesmo de outro usuário, nunca serve para esta operação.
      if (isPasswordSetup) {
        const recoverySession = await getPasswordRecoverySession()
        if (!recoverySession) {
          recoverySessionError = 'Link inválido ou expirado. Peça um novo acesso.'
        } else {
          setRecoveryEmail(recoverySession.email)
        }
      }

      setReturnTo(nextReturnTo)
      if (isPasswordSetup) setMode('setup')
      if (forceEmailLogin) {
        logout()
        setMode('password')
      }

      const current = isPasswordSetup || forceEmailLogin ? null : await getCurrentUserAsync()
      if (!alive) return

      if (current && current.allowedRoutes.length > 0) {
        router.replace(firstAllowedRoute(current))
        return
      }
      if (recoverySessionError) {
        setEmailMsg(recoverySessionError)
        setEmailOk(false)
      }
      setLoading(false)
    }

    boot()
    return () => { alive = false }
  }, [router])

  function clearEmailMessage() {
    setEmailMsg('')
    setEmailOk(false)
  }

  function clearPasswordSetupUrl() {
    if (typeof window === 'undefined') return
    window.history.replaceState(null, '', '/login')
  }

  async function handlePasswordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clearEmailMessage()
    setEmailLoading(true)

    const result = await signInWithEmailPassword(email, password)
    setEmailMsg(result.message)
    setEmailOk(result.ok)
    setEmailLoading(false)

    if (result.ok && result.user) {
      navigateAfterAuthentication(returnTo ?? firstAllowedRoute(result.user))
    }
  }

  async function handlePasswordSetupRequest() {
    clearEmailMessage()
    setRecoveryLoading(true)

    const result = await sendPasswordSetupLink(email)
    setEmailMsg(result.message)
    setEmailOk(result.ok)
    setRecoveryLoading(false)
  }

  async function handlePasswordUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clearEmailMessage()
    setSetupLoading(true)

    const result = await updateCurrentUserPassword(password, passwordConfirm)
    setEmailMsg(result.message)
    setEmailOk(result.ok)
    setSetupLoading(false)

    if (result.ok && result.user) {
      clearPasswordSetupUrl()
      navigateAfterAuthentication(returnTo ?? firstAllowedRoute(result.user))
    }
  }

  if (loading) return (
    <div className="ps-loading">
      <div className="ps-spinner" />
      <p>Carregando...</p>
    </div>
  )

  return (
    <div className="ps-login">
      <div className="ps-login-box ps-fadein">
        <div className="ps-login-logo">
          <div className="ps-login-mark">P</div>
          <h1>Pane &amp; Salute</h1>
          <p>{mode === 'setup' ? 'Criar senha' : 'Entrar com senha'}</p>
        </div>

        {mode === 'setup' ? (
          <form className="ps-login-email" onSubmit={handlePasswordUpdate}>
            {recoveryEmail && (
              <p className="ps-login-help">Criando senha para {recoveryEmail}</p>
            )}
            <div className="ps-fieldgroup">
              <div className="ps-fieldlabel">Nova senha</div>
              <input
                className="ps-input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={event => { setPassword(event.target.value); clearEmailMessage() }}
              />
            </div>
            <div className="ps-fieldgroup">
              <div className="ps-fieldlabel">Confirmar senha</div>
              <input
                className="ps-input"
                type="password"
                autoComplete="new-password"
                value={passwordConfirm}
                onChange={event => { setPasswordConfirm(event.target.value); clearEmailMessage() }}
              />
            </div>
            <ul className="ps-password-rules" aria-label="Critérios da senha">
              {passwordRules.map(rule => (
                <li key={rule.id} className={rule.valid ? 'ok' : ''}>
                  <span aria-hidden="true">{rule.valid ? '✓' : '•'}</span>
                  {rule.label}
                </li>
              ))}
            </ul>
            <button type="submit" className="ps-btn primary block" disabled={setupLoading}>
              {setupLoading ? 'Salvando...' : 'Salvar senha'}
            </button>
            <p className={emailOk ? 'ps-login-ok' : 'ps-login-err'}>{emailMsg}</p>
            <button
              type="button"
              className="ps-btn ghost block"
              onClick={() => { clearPasswordSetupUrl(); setMode('password'); setPassword(''); setPasswordConfirm(''); clearEmailMessage() }}
            >
              Voltar para login
            </button>
          </form>
        ) : mode === 'password' ? (
          <form className="ps-login-email" onSubmit={handlePasswordLogin}>
            <p className="ps-banner crust" role="status">
              Acesso por PIN desabilitado. Acesse com e-mail. Se não tiver o acesso, fale com o Administrador.
            </p>
            <div className="ps-fieldgroup">
              <div className="ps-fieldlabel">E-mail</div>
              <input
                className="ps-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={event => { setEmail(event.target.value); clearEmailMessage() }}
                placeholder="nome@paneesalute.com.br"
              />
            </div>
            <div className="ps-fieldgroup">
              <div className="ps-fieldlabel">Senha</div>
              <input
                className="ps-input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={event => { setPassword(event.target.value); clearEmailMessage() }}
              />
            </div>
            <button type="submit" className="ps-btn primary block" disabled={emailLoading}>
              {emailLoading ? 'Entrando...' : 'Entrar'}
            </button>
            <button
              type="button"
              className="ps-btn ghost block"
              onClick={handlePasswordSetupRequest}
              disabled={recoveryLoading || emailLoading}
            >
              {recoveryLoading ? 'Enviando...' : 'Primeiro acesso / esqueci senha'}
            </button>
            <p className={emailOk ? 'ps-login-ok' : 'ps-login-err'}>{emailMsg}</p>
          </form>
        ) : null}
      </div>
    </div>
  )
}
