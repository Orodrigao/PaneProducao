'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, FileText, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { ModulePaused } from '@/components/ModulePaused'
import { COMPRAS_COTACOES_PAUSADAS } from '@/lib/features'

interface QuotationRow {
  id: string
  created_at: string
  week_reference: string
  status: string
  created_by: string
  item_count: number
  supplier_count: number
}

const STATUS_LABEL: Record<string, string> = { draft:'Rascunho', sent:'Enviada', responded:'Respondida', closed:'Fechada' }
const STATUS_CLS: Record<string, string> = { draft:'separado', sent:'enviado', responded:'conferido', closed:'aprovado' }

export default function CotacoesPage() {
  return COMPRAS_COTACOES_PAUSADAS
    ? <ModulePaused/>
    : <CotacoesAtivasPage/>
}

function CotacoesAtivasPage() {
  const router = useRouter()
  const [user, setUser] = useState<AppUser | null>(null)
  const [rows, setRows] = useState<QuotationRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { setUser(getCurrentUser()); load() }, [])

  async function load() {
    setLoading(true)
    const { data: qs } = await supabase
      .from('quotations')
      .select('id,created_at,week_reference,status,created_by')
      .order('created_at', { ascending: false })

    const ids = (qs || []).map((q: any) => q.id)
    const counts: Record<string, { items: number; suppliers: number }> = {}
    if (ids.length > 0) {
      const [{ data: items }, { data: sups }] = await Promise.all([
        supabase.from('quotation_items').select('quotation_id').in('quotation_id', ids),
        supabase.from('quotation_suppliers').select('quotation_id').in('quotation_id', ids),
      ])
      ;(items || []).forEach((i: any) => {
        if (!counts[i.quotation_id]) counts[i.quotation_id] = { items: 0, suppliers: 0 }
        counts[i.quotation_id].items++
      })
      ;(sups || []).forEach((s: any) => {
        if (!counts[s.quotation_id]) counts[s.quotation_id] = { items: 0, suppliers: 0 }
        counts[s.quotation_id].suppliers++
      })
    }

    setRows(((qs || []) as any[]).map(q => ({
      ...q,
      item_count: counts[q.id]?.items || 0,
      supplier_count: counts[q.id]?.suppliers || 0,
    })))
    setLoading(false)
  }

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <button className="ps-iconbtn" onClick={() => router.push('/compras')} aria-label="Voltar">
              <ChevronLeft size={20}/>
            </button>
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Cotações</b>
              <span>Histórico</span>
            </div>
          </div>
          {user && (
            <div className="ps-userchip">
              <div className="ps-avatar" style={{background: roleColor(user.role)}}>{user.displayName.charAt(0).toUpperCase()}</div>
              <b>{user.displayName}</b>
            </div>
          )}
        </header>

        <div className="ps-scroll ps-pad">
          {loading ? (
            <div style={{padding:24, textAlign:'center', color:'var(--ink-faint)'}}>Carregando…</div>
          ) : rows.length === 0 ? (
            <div className="ps-card" style={{padding:24, textAlign:'center'}}>
              <FileText size={32} style={{display:'block', margin:'0 auto 8px', color:'var(--ink-faint)'}}/>
              <div style={{fontSize:14, fontWeight:600, marginBottom:6}}>Nenhuma cotação ainda.</div>
              <div style={{fontSize:12, color:'var(--ink-faint)', marginBottom:14}}>
                Gere uma a partir das listas de compras enviadas.
              </div>
              <Link href="/compras" className="ps-btn primary"><Plus size={14}/> Ir pra /compras</Link>
            </div>
          ) : (
            <div style={{display:'flex', flexDirection:'column', gap:10}}>
              {rows.map(r => {
                const [y, m, d] = r.week_reference.split('-')
                const semana = (d && m && y) ? `${d}/${m}/${y}` : r.week_reference
                return (
                  <Link
                    key={r.id}
                    href={`/cotacoes/detalhe?id=${r.id}`}
                    className="ps-card"
                    style={{padding:'12px 14px', textDecoration:'none', color:'inherit'}}
                  >
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8}}>
                      <div>
                        <div className="ps-pname" style={{fontSize:14}}>Semana de {semana}</div>
                        <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>
                          {r.item_count} itens · {r.supplier_count} fornecedores · {r.created_by}
                        </div>
                      </div>
                      <span className={`ps-status ${STATUS_CLS[r.status] || 'separado'}`}>{STATUS_LABEL[r.status] || r.status}</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
