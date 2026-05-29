'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AppUser,
  fetchUsersFromSupabase,
  cacheUsers,
  getCachedUsers,
  authenticate,
  getCurrentUser,
  firstAllowedRoute,
  roleLabel,
  roleColor,
} from '@/lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const [users, setUsers]   = useState<AppUser[]>([])
  const [selected, setSelected] = useState<AppUser | null>(null)
  const [pin, setPin]       = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Sempre refresca o cache antes de qualquer decisão de redirect.
    // Sem isso, allowedRoutes stale do localStorage trava o usuário em loop.
    fetchUsersFromSupabase().then(remote => {
      if (remote) cacheUsers(remote)
      const current = getCurrentUser()
      if (current && current.allowedRoutes.length > 0) {
        router.replace(firstAllowedRoute(current))
        return
      }
      setUsers((remote ?? getCachedUsers()).filter(u => u.active))
      setLoading(false)
    })
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
          <p>{selected ? 'Digite seu PIN' : 'Selecione seu usuário'}</p>
        </div>

        {!selected ? (
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
