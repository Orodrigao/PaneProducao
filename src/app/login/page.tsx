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
  sendEmailLoginLink,
} from '@/lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const [users, setUsers]   = useState<AppUser[]>([])
  const [selected, setSelected] = useState<AppUser | null>(null)
  const [pin, setPin]       = useState('')
  const [error, setError]   = useState('')
  const [mode, setMode]     = useState<'pin' | 'email'>('pin')
  const [email, setEmail]   = useState('')
  const [emailMsg, setEmailMsg] = useState('')
  const [emailOk, setEmailOk] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true

    async function boot() {
      // Sempre refresca o cache antes de qualquer decisão de redirect.
      // Sem isso, allowedRoutes stale do localStorage trava o usuário em loop.
      const remote = await fetchUsersFromSupabase()
      if (remote) cacheUsers(remote)
      const current = await getCurrentUserAsync()
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

  async function handleEmailLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setEmailMsg('')
    setEmailOk(false)
    setEmailLoading(true)

    const result = await sendEmailLoginLink(email)
    setEmailMsg(result.message)
    setEmailOk(result.ok)
    setEmailLoading(false)
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
          <p>{mode === 'email' ? 'Entrar por e-mail' : selected ? 'Digite seu PIN' : 'Selecione seu usuário'}</p>
        </div>

        <div className="ps-login-tabs" aria-label="Escolha a forma de entrada">
          <button
            type="button"
            className={mode === 'pin' ? 'active' : ''}
            onClick={() => { setMode('pin'); setEmailMsg(''); setSelected(null); setPin('') }}
          >
            PIN
          </button>
          <button
            type="button"
            className={mode === 'email' ? 'active' : ''}
            onClick={() => { setMode('email'); setError(''); setSelected(null); setPin('') }}
          >
            E-mail
          </button>
        </div>

        {mode === 'email' ? (
          <form className="ps-login-email" onSubmit={handleEmailLogin}>
            <div className="ps-fieldgroup">
              <div className="ps-fieldlabel">E-mail</div>
              <input
                className="ps-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={event => { setEmail(event.target.value); setEmailMsg('') }}
                placeholder="nome@paneesalute.com.br"
              />
            </div>
            <button type="submit" className="ps-btn primary block" disabled={emailLoading}>
              {emailLoading ? 'Enviando...' : 'Enviar link de acesso'}
            </button>
            <p className={emailOk ? 'ps-login-ok' : 'ps-login-err'}>{emailMsg}</p>
            <p className="ps-login-help">O PIN antigo continua disponível para a operação.</p>
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
