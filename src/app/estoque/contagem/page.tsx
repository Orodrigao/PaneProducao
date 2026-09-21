'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Lock, Unlock, CheckCircle2, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, type AppUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'
import {
  buildInventoryCountBoard,
  collectDirtyQuantityEdits,
  summarizeInventoryCountBoard,
  isInventoryWeeklyCountEditable,
  type InventoryCountProductLookup,
  type InventoryWeeklyCount,
  type InventoryWeeklyCountItemRow,
} from '@/lib/inventoryCount'

const STORE = 'jc'
const WEEKLY_COUNT_PERMISSION = 'estoque.contar_semanal'

function canCountInventory(user: AppUser | null): boolean {
  if (!user) return false
  if (user.role === 'admin') return true
  if (user.role !== 'expedicao' || user.store !== STORE) return false
  return Boolean(user.permissions?.some(permission =>
    permission.permission_key === WEEKLY_COUNT_PERMISSION
    && (permission.scope === '*' || permission.scope === STORE),
  ))
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export default function ContagemSemanalPage() {
  const router = useRouter()
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasEligibleProducts, setHasEligibleProducts] = useState(true)
  const [count, setCount] = useState<InventoryWeeklyCount | null>(null)
  const [items, setItems] = useState<InventoryWeeklyCountItemRow[]>([])
  const [productsById, setProductsById] = useState<Record<string, InventoryCountProductLookup>>({})
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [savingProductIds, setSavingProductIds] = useState<Set<string>>(new Set())
  const [flushingBeforeClose, setFlushingBeforeClose] = useState(false)
  const [opening, setOpening] = useState(false)
  const [closing, setClosing] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [confirmingReopen, setConfirmingReopen] = useState(false)

  const allowed = canCountInventory(user)

  const loadItemsAndProducts = async (countId: string) => {
    const { data: itemRows, error: itemsError } = await supabase
      .from('inventory_weekly_count_items')
      .select('id,product_id,quantity,unit,updated_at,updated_by_name')
      .eq('count_id', countId)
    if (itemsError) throw itemsError
    const rows = (itemRows || []) as InventoryWeeklyCountItemRow[]
    setItems(rows)

    const productIds = [...new Set(rows.map(row => row.product_id))]
    if (productIds.length > 0) {
      const { data: productRows, error: productsError } = await supabase
        .from('products').select('id,name,category').in('id', productIds)
      if (productsError) throw productsError
      const byId: Record<string, InventoryCountProductLookup> = {}
      for (const product of (productRows || []) as InventoryCountProductLookup[]) byId[product.id] = product
      setProductsById(byId)
    } else {
      setProductsById({})
    }
  }

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [eligibleResult, countResult] = await Promise.all([
        supabase.from('products').select('id', { count: 'exact', head: true })
          .eq('active', true).eq('kind', 'insumo').eq('weekly_count_enabled', true),
        supabase.from('inventory_weekly_counts').select('*')
          .eq('store', STORE).order('week_start', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (eligibleResult.error) throw eligibleResult.error
      setHasEligibleProducts((eligibleResult.count || 0) > 0)

      if (countResult.error) throw countResult.error
      const latestCount = countResult.data as InventoryWeeklyCount | null
      setCount(latestCount)

      if (latestCount) await loadItemsAndProducts(latestCount.id)
      else { setItems([]); setProductsById({}) }
    } catch {
      setError('Não foi possível carregar a contagem semanal.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const currentUser = getCurrentUser()
    setUser(currentUser)
    if (canCountInventory(currentUser)) load()
    else setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const board = useMemo(() => buildInventoryCountBoard(items, productsById), [items, productsById])
  const summary = useMemo(() => summarizeInventoryCountBoard(board), [board])
  // Editabilidade e "existe contagem aberta" vêm só do status gravado pelo
  // banco -- nunca de contas de semana feitas no navegador (achado do
  // CodeRabbit: o relógio/fuso do aparelho podia divergir do servidor e
  // bloquear uma contagem que estava genuinamente aberta).
  const editable = isInventoryWeeklyCountEditable(count)

  const openCount = async () => {
    setOpening(true)
    try {
      const { data, error: openError } = await supabase.rpc('open_inventory_weekly_count', { p_store: STORE })
      if (openError) throw openError
      setInputs({})
      await load()
      void data
      showToast('Contagem aberta!')
    } catch (rpcError: unknown) {
      showToast('Erro: ' + (rpcError instanceof Error ? rpcError.message : 'não foi possível abrir a contagem'))
    } finally {
      setOpening(false)
    }
  }

  // Devolve se salvou de verdade: closeCount depende disso para nunca fechar
  // por cima de uma gravação pendente que falhou (achado do CodeRabbit).
  const saveQuantity = async (productId: string, rawValue: string): Promise<boolean> => {
    if (!count) return false
    const trimmed = rawValue.trim()
    const quantity = trimmed === '' ? null : Number(trimmed.replace(',', '.'))
    if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) {
      showToast('Quantidade inválida.')
      return false
    }
    setSavingProductIds(prev => new Set(prev).add(productId))
    try {
      const { error: saveError } = await supabase.rpc('save_inventory_weekly_count_item', {
        p_count_id: count.id,
        p_product_id: productId,
        p_quantity: quantity,
      })
      if (saveError) throw saveError
      setItems(prev => prev.map(item => item.product_id === productId
        ? { ...item, quantity, updated_at: new Date().toISOString(), updated_by_name: user?.displayName || null }
        : item))
      return true
    } catch (rpcError: unknown) {
      showToast('Erro: ' + (rpcError instanceof Error ? rpcError.message : 'não foi possível salvar'))
      await load()
      return false
    } finally {
      setSavingProductIds(prev => { const next = new Set(prev); next.delete(productId); return next })
    }
  }

  const closeCount = async () => {
    if (!count) return
    // Descarrega qualquer valor digitado que ainda não venceu a corrida com o
    // salvamento no blur, para fechar nunca apagar o último número digitado.
    setFlushingBeforeClose(true)
    let flushedOk = true
    try {
      const dirty = collectDirtyQuantityEdits(board, inputs)
      if (dirty.length > 0) {
        const results = await Promise.all(dirty.map(edit => saveQuantity(edit.productId, edit.rawValue)))
        flushedOk = results.every(Boolean)
      }
    } finally {
      setFlushingBeforeClose(false)
    }

    if (!flushedOk) {
      showToast('Não deu para salvar tudo que faltava. Confira os campos e tente fechar de novo.')
      return
    }

    setClosing(true)
    try {
      const { error: closeError } = await supabase.rpc('close_inventory_weekly_count', { p_count_id: count.id })
      if (closeError) throw closeError
      await load()
      showToast('Contagem fechada!')
    } catch (rpcError: unknown) {
      showToast('Erro: ' + (rpcError instanceof Error ? rpcError.message : 'não foi possível fechar'))
    } finally {
      setClosing(false)
      setConfirmingClose(false)
    }
  }

  const reopenCount = async () => {
    if (!count) return
    setReopening(true)
    try {
      const { error: reopenError } = await supabase.rpc('reopen_inventory_weekly_count', { p_count_id: count.id })
      if (reopenError) throw reopenError
      await load()
      showToast('Contagem reaberta!')
    } catch (rpcError: unknown) {
      showToast('Erro: ' + (rpcError instanceof Error ? rpcError.message : 'não foi possível reabrir'))
    } finally {
      setReopening(false)
      setConfirmingReopen(false)
    }
  }

  const anySaving = savingProductIds.size > 0 || flushingBeforeClose

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <button className="ps-iconbtn" onClick={() => router.push('/estoque')} aria-label="Voltar">
              <ChevronLeft size={20}/>
            </button>
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Contagem semanal</b>
              <span>Estoque · JC</span>
            </div>
          </div>
        </header>

        <div className="ps-scroll ps-pad">
          {!user ? null : !allowed ? (
            <div className="ps-warning" style={{marginTop:14}}>
              <AlertTriangle size={18}/>
              <span>Você não tem permissão para contar o estoque semanal. Fale com o admin se precisar dela.</span>
            </div>
          ) : loading ? (
            <div className="ps-empty">Carregando contagem...</div>
          ) : error ? (
            <div className="ps-warning" style={{marginTop:14}}>
              <AlertTriangle size={18}/><span>{error}</span>
            </div>
          ) : !hasEligibleProducts && !count ? (
            <div className="ps-empty" style={{padding:'24px 0'}}>
              Nenhum insumo está marcado para a contagem semanal ainda. Marque em Produtos → editar insumo → &quot;Contagem semanal&quot;.
            </div>
          ) : (
            <>
              {!editable && (
                <div className="ps-card" style={{marginTop:14, padding:16, textAlign:'center'}}>
                  <div style={{fontSize:13, color:'var(--ink-soft)', marginBottom:12}}>
                    {count
                      ? `A última contagem foi fechada em ${formatDateTime(count.closed_at)}.`
                      : 'Nenhuma contagem foi feita ainda.'}
                    {' '}{hasEligibleProducts ? '' : 'Nenhum insumo marcado para contar no momento.'}
                  </div>
                  {hasEligibleProducts && (
                    <button className="ps-btn" onClick={openCount} disabled={opening}>
                      {opening ? 'Abrindo...' : count ? 'Iniciar nova contagem' : 'Iniciar contagem desta semana'}
                    </button>
                  )}
                </div>
              )}

              {count && !editable && (
                <div className="ps-card" style={{marginTop:14, padding:'12px 14px', background:'var(--cream)'}}>
                  <div style={{display:'flex', alignItems:'center', gap:8, fontSize:13, fontWeight:600}}>
                    <Lock size={16}/> Contagem fechada em {formatDateTime(count.closed_at)}{count.closed_by_name ? ` por ${count.closed_by_name}` : ''}
                  </div>
                  {user?.role === 'admin' && (
                    <div style={{display:'flex', gap:8, marginTop:10, flexWrap:'wrap'}}>
                      {!confirmingReopen ? (
                        <button className="ps-btn ghost sm" onClick={() => setConfirmingReopen(true)}>
                          <Unlock size={14}/> Reabrir esta contagem
                        </button>
                      ) : (
                        <>
                          <span style={{fontSize:12, color:'var(--ink-soft)'}}>Reabrir e liberar edição dos números?</span>
                          <button className="ps-btn sm" onClick={reopenCount} disabled={reopening}>{reopening ? 'Reabrindo...' : 'Confirmar'}</button>
                          <button className="ps-btn ghost sm" onClick={() => setConfirmingReopen(false)}>Cancelar</button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {count && board.length > 0 && (
                <>
                  <div style={{display:'flex', gap:10, marginTop:14, flexWrap:'wrap'}}>
                    <div className="ps-card" style={{padding:'10px 14px', fontSize:13}}>
                      <b>{summary.counted}</b> de <b>{summary.total}</b> contados
                    </div>
                  </div>

                  <div style={{display:'flex', flexDirection:'column', gap:8, marginTop:14}}>
                    {board.map(row => {
                      const value = inputs[row.productId] ?? (row.quantity === null ? '' : String(row.quantity))
                      return (
                        <div key={row.itemId} className="ps-card" style={{padding:'12px 14px'}}>
                          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:12}}>
                            <div style={{flex:1, minWidth:0}}>
                              <div className="ps-pname" style={{fontSize:14.5}}>{row.productName}</div>
                              <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>
                                {row.category || 'Sem categoria'}
                                {row.counted && ` · contado ${formatDateTime(row.updatedAt)}${row.updatedByName ? ` por ${row.updatedByName}` : ''}`}
                              </div>
                            </div>
                            <div style={{display:'flex', alignItems:'center', gap:6, flexShrink:0}}>
                              <input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="0.001"
                                placeholder="0"
                                value={value}
                                disabled={!editable}
                                onChange={event => setInputs(prev => ({...prev, [row.productId]: event.target.value}))}
                                onBlur={event => {
                                  const current = event.target.value
                                  const saved = row.quantity === null ? '' : String(row.quantity)
                                  if (current.trim() !== saved.trim()) saveQuantity(row.productId, current)
                                }}
                                className="ps-input"
                                style={{width:90, textAlign:'right'}}
                              />
                              <span style={{fontSize:12, color:'var(--ink-faint)', width:36}}>{row.displayUnit}</span>
                              {row.counted && <CheckCircle2 size={16} color="var(--sage)"/>}
                              {savingProductIds.has(row.productId) && <span style={{fontSize:11, color:'var(--ink-faint)'}}>salvando...</span>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {editable && (
                    <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:16, marginBottom:20}}>
                      {!confirmingClose ? (
                        <button className="ps-btn" onClick={() => setConfirmingClose(true)} disabled={anySaving}>
                          <Lock size={14}/> Fechar contagem
                        </button>
                      ) : (
                        <>
                          <span style={{fontSize:12, color:'var(--ink-soft)', alignSelf:'center'}}>
                            {summary.pending > 0 ? `${summary.pending} insumo(s) ainda sem contagem. ` : ''}Fechar mesmo assim?
                          </span>
                          <button className="ps-btn ghost sm" onClick={() => setConfirmingClose(false)}>Cancelar</button>
                          <button className="ps-btn sm" onClick={closeCount} disabled={closing || anySaving}>
                            {flushingBeforeClose ? 'Salvando pendências...' : closing ? 'Fechando...' : 'Confirmar'}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
