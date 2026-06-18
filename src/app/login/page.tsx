'use client'
import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  AppUser,
  fetchUsersFromSupabase,
  cacheUsers,
  getCachedUsers,
  authenticate,
  getCurrentUserAsync,
  firstAllowedRoute,
  roleLabel,
  roleColor,
  sendPasswordSetupLink,
  signInWithEmailPassword,
  updateCurrentUserPassword,
} from '@/lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const [users, setUsers]   = useState<AppUser[]>([])
  const [selected, setSelected] = useState<AppUser | null>(null)
  const [pin, setPin]       = useState('')
  const [error, setError]   = useState('')
  const [mode, setMode]     = useState<'password' | 'pin' | 'setup'>('password')
  const [email, setEmail]   = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [emailMsg, setEmailMsg] = useState('')
  const [emailOk, setEmailOk] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [setupLoading, setSetupLoading] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true

    async function boot() {
      const params = new URLSearchParams(window.location.search)
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const isPasswordSetup = params.get('mode') === 'senha' || hashParams.get('type') === 'recovery'
      if (isPasswordSetup) setMode('setup')

      // Sempre refresca o cache antes de qualquer decisão de redirect.
      // Sem isso, allowedRoutes stale do localStorage trava o usuário em loop.
      const remote = await fetchUsersFromSupabase()
      if (remote) cacheUsers(remote)
      const current = isPasswordSetup ? null : await getCurrentUserAsync()
      if (!alive) return

      if (current && current.allowedRoutes.length > 0) {
        router.replace(firstAllowedRoute(current))
        return
      }
      setUsers((remote ?? getCachedUsers()).filter(u => u.active))
      setLoading(false)
    }

    boot()
    return () => { alive = false }
  }, [router])

  function handleSelect(user: AppUser) {
    setSelected(user)
    setPin('')
    setError('')
  }

  function handlePin(digit: string) {
    if (pin.length >= 4) return
    const next = pin + digit
    setPin(next)
    if (next.length === 4) {
      setTimeout(() => attemptLogin(next), 150)
    }
  }

  function handleBackspace() {
    setPin(p => p.slice(0, -1))
    setError('')
  }

  function attemptLogin(enteredPin: string) {
    if (!selected) return
    if (selected.pin === enteredPin) {
      authenticate(selected)
      router.replace(firstAllowedRoute(selected))
    } else {
      setError('PIN incorreto')
      setPin('')
    }
  }

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
      router.replace(firstAllowedRoute(result.user))
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
      router.replace(firstAllowedRoute(result.user))
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
          <p>{mode === 'setup' ? 'Criar senha' : mode === 'password' ? 'Entrar com senha' : selected ? 'Digite seu PIN' : 'Selecione seu usuário'}</p>
        </div>

        {mode !== 'setup' && (
          <div className="ps-login-tabs" aria-label="Escolha a forma de entrada">
            <button
              type="button"
              className={mode === 'password' ? 'active' : ''}
              onClick={() => { setMode('password'); clearEmailMessage(); setError(''); setSelected(null); setPin('') }}
            >
              Senha
            </button>
            <button
              type="button"
              className={mode === 'pin' ? 'active' : ''}
              onClick={() => { setMode('pin'); clearEmailMessage(); setSelected(null); setPin('') }}
            >
              PIN
            </button>
          </div>
        )}

        {mode === 'setup' ? (
          <form className="ps-login-email" onSubmit={handlePasswordUpdate}>
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
            <p className="ps-login-help">O PIN antigo continua disponível por enquanto.</p>
          </form>
        ) : !selected ? (
          <div className="ps-login-grid">
            {users.map(user => (
              <button key={user.id} className="ps-login-user" onClick={() => handleSelect(user)}>
                <div className="ps-login-av" style={{ background: roleColor(user.role) }}>
                  {user.displayName.charAt(0).toUpperCase()}
                </div>
                <div className="ps-login-name">{user.displayName}</div>
                <div className="ps-login-role" style={{ color: roleColor(user.role) }}>{roleLabel(user.role)}</div>
              </button>
            ))}
          </div>
        ) : (
          <div className="ps-login-pin">
            <button className="ps-login-back" onClick={() => { setSelected(null); setPin(''); setError('') }}>
              ← Trocar usuário
            </button>

            <div className="ps-login-sel">
              <div className="ps-login-av" style={{ background: roleColor(selected.role) }}>
                {selected.displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <b>{selected.displayName}</b>
                <small style={{ color: roleColor(selected.role) }}>{roleLabel(selected.role)}</small>
              </div>
            </div>

            <div className="ps-pin-dots">
              {[0,1,2,3].map(i => (
                <div key={i} className={'ps-pin-dot' + (i < pin.length ? ' on' : '')} />
              ))}
            </div>

            <p className="ps-login-err">{error}</p>

            <div className="ps-keypad">
              {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d, i) => (
                <button
                  key={i}
                  className={'ps-key' + (d === '' ? ' ghost' : d === '⌫' ? ' back' : '')}
                  onClick={() => d === '⌫' ? handleBackspace() : d !== '' ? handlePin(d) : undefined}
                  disabled={d === ''}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
