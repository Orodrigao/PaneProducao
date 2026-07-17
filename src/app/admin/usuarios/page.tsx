'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { getCurrentUserAsync, roleColor, type AppUser } from '@/lib/auth'

export default function AdminUsuariosPage() {
  const router = useRouter()
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true

    void getCurrentUserAsync().then(current => {
      if (!alive) return
      if (!current || current.role !== 'admin') {
        router.replace('/')
        return
      }
      setUser(current)
      setLoading(false)
    })

    return () => { alive = false }
  }, [router])

  if (loading) {
    return <div className="ps-loading"><div className="ps-spinner"/><p>Carregando...</p></div>
  }

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand"><b>Admin · Usuários</b><span>Transição de acesso</span></div>
          </div>
          {user && <div className="ps-userchip"><div className="ps-avatar" style={{ background: roleColor(user.role) }}>{user.displayName.charAt(0).toUpperCase()}</div><b>{user.displayName}</b></div>}
        </header>

        <main className="ps-scroll ps-pad">
          <section className="ps-card" style={{ marginTop: 16, padding: 20 }}>
            <ShieldCheck size={28} color="var(--crust)" aria-hidden="true" />
            <h1 className="ps-page-title">Cadastro legado desabilitado</h1>
            <p>O acesso por PIN foi aposentado. Entradas no ERP agora usam e-mail e senha.</p>
            <p className="ps-banner crust">Para criar, alterar ou desativar acessos, fale com o Administrador responsável pelo Supabase Auth.</p>
          </section>
        </main>
      </div>
    </div>
  )
}
