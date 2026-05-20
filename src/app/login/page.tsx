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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <p style={{ color: 'var(--muted)' }}>Carregando...</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px', background: 'var(--bg)' }}>
      <div style={{ marginBottom: '24px', textAlign: 'center' }}>
        <div style={{ fontSize: '2rem' }}>🥖</div>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text)', margin: '8px 0 4px' }}>Pane &amp; Salute</h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Selecione seu usuário</p>
      </div>

      {!selected ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', width: '100%', maxWidth: '360px' }}>
          {users.map(user => (
            <button
              key={user.id}
              onClick={() => handleSelect(user)}
              style={{
                padding: '16px 8px', borderRadius: '12px', border: '2px solid var(--border)',
                background: 'white', cursor: 'pointer', textAlign: 'center',
                transition: 'border-color 0.15s',
              }}
            >
              <div style={{
                width: '40px', height: '40px', borderRadius: '50%', margin: '0 auto 8px',
                background: roleColor(user.role), display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontWeight: 700, fontSize: '1rem',
              }}>
                {user.displayName.charAt(0).toUpperCase()}
              </div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)' }}>{user.displayName}</div>
              <div style={{ fontSize: '0.72rem', color: roleColor(user.role), marginTop: '2px' }}>{roleLabel(user.role)}</div>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ width: '100%', maxWidth: '300px', textAlign: 'center' }}>
          <button onClick={() => { setSelected(null); setPin(''); setError('') }}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', marginBottom: '16px', fontSize: '0.85rem' }}>
            ← Trocar usuário
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', justifyContent: 'center' }}>
            <div style={{
              width: '44px', height: '44px', borderRadius: '50%',
              background: roleColor(selected.role), display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontWeight: 700, fontSize: '1.1rem',
            }}>
              {selected.displayName.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 600 }}>{selected.displayName}</div>
              <div style={{ fontSize: '0.75rem', color: roleColor(selected.role) }}>{roleLabel(selected.role)}</div>
            </div>
          </div>

          {/* PIN dots */}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '8px' }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{
                width: '14px', height: '14px', borderRadius: '50%',
                background: i < pin.length ? 'var(--primary)' : 'var(--border)',
                transition: 'background 0.1s',
              }} />
            ))}
          </div>

          {error && <p style={{ color: '#dc2626', fontSize: '0.8rem', marginBottom: '8px' }}>{error}</p>}

          {/* Teclado numérico */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginTop: '16px' }}>
            {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d, i) => (
              <button
                key={i}
                onClick={() => d === '⌫' ? handleBackspace() : d !== '' ? handlePin(d) : undefined}
                disabled={d === ''}
                style={{
                  padding: '18px', borderRadius: '10px', border: '1px solid var(--border)',
                  background: d === '' ? 'transparent' : 'white', cursor: d === '' ? 'default' : 'pointer',
                  fontSize: '1.2rem', fontWeight: 600, color: 'var(--text)',
                  boxShadow: d !== '' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
