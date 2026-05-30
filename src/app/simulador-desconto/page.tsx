'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Sparkles, Copy, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'

interface Customer { id:string; name:string; default_tier_id:string|null; discount_pct:number; active:boolean }
interface TierItem {
  id:string; tier_id:string; product_id:string; product_source:'bread'|'product';
  product_name:string; unit_price:number; pricing_unit:'un'|'kg'; pack_size:number; active:boolean
}
interface Override {
  id:string; customer_id:string; product_id:string; product_source:'bread'|'product';
  product_name:string; unit_price:number; pricing_unit:'un'|'kg'; pack_size:number; active:boolean
}
interface Bread   { id:string; name:string; cost_price:number|null; active:boolean }
interface Product { id:string; name:string; cost_price:number|null; active:boolean }

interface CatalogProduct { id:string; source:'bread'|'product'; name:string; cost_price:number }

interface HistoryEntry {
  ts:number
  customerName:string; productName:string
  price:number; cmv:number; discount:number
  currentVolume:number; promisedVolume:number
  verdict:'vale'|'nao_vale'|'margem_negativa'
  profitDelta:number
}

const HIST_KEY = 'pane_simulador_desconto_hist'
const HIST_MAX = 10

export default function SimuladorDescontoPage() {
  const [user, setUser] = useState<AppUser | null>(null)

  const [customers, setCustomers] = useState<Customer[]>([])
  const [tierItems, setTierItems] = useState<TierItem[]>([])
  const [overrides, setOverrides] = useState<Override[]>([])
  const [catalog, setCatalog]     = useState<CatalogProduct[]>([])
  const [loading, setLoading]     = useState(true)

  const [customerId, setCustomerId] = useState('')
  const [productKey, setProductKey] = useState('')
  const [customerNameFree, setCustomerNameFree] = useState('')
  const [productNameFree, setProductNameFree]   = useState('')
  const [price, setPrice]       = useState<number>(0)
  const [cmv, setCmv]           = useState<number>(0)
  const [discount, setDiscount] = useState<number>(0)
  const [currentVolume, setCurrentVolume]   = useState<number>(0)
  const [promisedVolume, setPromisedVolume] = useState<number>(0)

  const [aiLoading, setAiLoading] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiError, setAiError] = useState('')

  const [history, setHistory] = useState<HistoryEntry[]>([])

  useEffect(() => {
    setUser(getCurrentUser())
    try {
      const raw = localStorage.getItem(HIST_KEY)
      if (raw) setHistory(JSON.parse(raw))
    } catch {}
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [cRes, tiRes, ovRes, bRes, pRes] = await Promise.all([
      supabase.from('customers').select('id,name,default_tier_id,discount_pct,active').eq('active',true).order('name'),
      supabase.from('price_tier_items').select('*').eq('active',true),
      supabase.from('customer_price_overrides').select('*').eq('active',true),
      supabase.from('breads').select('id,name,cost_price,active').eq('active',true).order('name'),
      supabase.from('products').select('id,name,cost_price,active').eq('active',true).or('is_pj.eq.true,is_special.eq.true').order('name'),
    ])
    setCustomers((cRes.data||[]) as Customer[])
    setTierItems((tiRes.data||[]) as TierItem[])
    setOverrides((ovRes.data||[]) as Override[])
    const breads = (bRes.data||[]).map((b:Bread) => ({ id:b.id, source:'bread' as const, name:b.name, cost_price:Number(b.cost_price||0) }))
    const prods  = (pRes.data||[]).map((p:Product) => ({ id:p.id, source:'product' as const, name:p.name, cost_price:Number(p.cost_price||0) }))
    setCatalog([...breads, ...prods].sort((a,b) => a.name.localeCompare(b.name)))
    setLoading(false)
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    if (!customerId || !productKey) return
    const cust = customers.find(c => c.id === customerId)
    const prod = catalog.find(p => `${p.source}_${p.id}` === productKey)
    if (!cust || !prod) return

    const ov = overrides.find(o => o.customer_id === cust.id && o.product_source === prod.source && o.product_id === prod.id)
    if (ov) {
      setPrice(Number(ov.unit_price))
      setCmv(prod.cost_price)
      return
    }
    if (cust.default_tier_id) {
      const ti = tierItems.find(t => t.tier_id === cust.default_tier_id && t.product_source === prod.source && t.product_id === prod.id)
      if (ti) {
        const basePrice = Number(ti.unit_price)
        setPrice(basePrice)
        setCmv(prod.cost_price)
        return
      }
    }
    setCmv(prod.cost_price)
  }, [customerId, productKey, customers, catalog, overrides, tierItems])

  useEffect(() => {
    if (customerId || !productKey) return
    const prod = catalog.find(p => `${p.source}_${p.id}` === productKey)
    if (prod) setCmv(prod.cost_price)
  }, [productKey, customerId, catalog])

  const calc = useMemo(() => {
    const margin = price - cmv
    const marginPct = price > 0 ? (margin / price) * 100 : 0
    const newPrice = price * (1 - discount / 100)
    const newMargin = newPrice - cmv
    const newMarginPct = newPrice > 0 ? (newMargin / newPrice) * 100 : 0
    const currentProfit = currentVolume * margin
    const promisedProfit = promisedVolume * newMargin
    const profitDelta = promisedProfit - currentProfit
    const breakEven = newMargin > 0 ? Math.ceil(currentProfit / newMargin) : null
    const marginPctDiff = newMarginPct - marginPct
    const volumeShortage = breakEven !== null ? breakEven - promisedVolume : 0

    let verdict: 'vale'|'nao_vale'|'margem_negativa' = 'vale'
    if (newMargin <= 0) verdict = 'margem_negativa'
    else if (profitDelta < 0) verdict = 'nao_vale'

    return {
      margin, marginPct, newPrice, newMargin, newMarginPct,
      currentProfit, promisedProfit, profitDelta, breakEven, marginPctDiff,
      volumeShortage, verdict,
    }
  }, [price, cmv, discount, currentVolume, promisedVolume])

  const hasMinInputs = price > 0 && cmv > 0 && discount > 0 && currentVolume > 0 && promisedVolume > 0

  const saveToHistory = (extra: { customerName:string; productName:string }) => {
    const entry: HistoryEntry = {
      ts: Date.now(),
      customerName: extra.customerName,
      productName: extra.productName,
      price, cmv, discount, currentVolume, promisedVolume,
      verdict: calc.verdict,
      profitDelta: calc.profitDelta,
    }
    const next = [entry, ...history.filter(h => h.ts !== entry.ts)].slice(0, HIST_MAX)
    setHistory(next)
    try { localStorage.setItem(HIST_KEY, JSON.stringify(next)) } catch {}
  }
  const loadFromHistory = (h:HistoryEntry) => {
    setCustomerNameFree(h.customerName); setProductNameFree(h.productName)
    setCustomerId(''); setProductKey('')
    setPrice(h.price); setCmv(h.cmv); setDiscount(h.discount)
    setCurrentVolume(h.currentVolume); setPromisedVolume(h.promisedVolume)
    setAiText(''); setAiError('')
  }
  const clearHistory = () => {
    if (!confirm('Limpar histórico de simulações?')) return
    setHistory([]); try { localStorage.removeItem(HIST_KEY) } catch {}
  }

  const analisarIA = async () => {
    if (!hasMinInputs) { showToast('Preencha todos os campos antes de analisar'); return }
    setAiLoading(true); setAiText(''); setAiError('')
    const custName = customers.find(c => c.id === customerId)?.name || customerNameFree.trim() || ''
    const prodName = catalog.find(p => `${p.source}_${p.id}` === productKey)?.name || productNameFree.trim() || ''
    const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    try {
      const resp = await fetch(`${SB_URL}/functions/v1/analisar-desconto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
        body: JSON.stringify({
          price, cmv, discount, currentVolume, promisedVolume,
          customerName: custName || undefined,
          productName: prodName || undefined,
        }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`)
      if (data?.error) throw new Error(data.error)
      setAiText(data?.analysis || '(resposta vazia)')
      saveToHistory({ customerName: custName, productName: prodName })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setAiError(msg)
    } finally { setAiLoading(false) }
  }

  const verdictInfo = (() => {
    if (!hasMinInputs) return { label: 'preencha os dados', cls: 'separado', color: 'var(--ink-faint)' }
    if (calc.verdict === 'margem_negativa') return { label: '🚨 MARGEM NEGATIVA', cls: 'com_divergencia', color: 'var(--berry)' }
    if (calc.verdict === 'nao_vale')        return { label: '❌ NÃO COMPENSA',    cls: 'com_divergencia', color: 'var(--berry)' }
    return { label: '✅ VALE',  cls: 'conferido', color: 'var(--sage)' }
  })()

  const copyResult = () => {
    if (!aiText) return
    const txt = [
      `Simulação de Desconto — Pane & Salute`,
      `Cliente: ${customers.find(c => c.id === customerId)?.name || customerNameFree || '—'}`,
      `Produto: ${catalog.find(p => `${p.source}_${p.id}` === productKey)?.name || productNameFree || '—'}`,
      ``,
      `Preço Tabela: R$ ${price.toFixed(2)}`,
      `CMV: R$ ${cmv.toFixed(2)}`,
      `Margem atual: ${calc.marginPct.toFixed(1)}% (R$ ${calc.margin.toFixed(2)})`,
      `Desconto: ${discount}%`,
      `Margem com desconto: ${calc.newMarginPct.toFixed(1)}% (R$ ${calc.newMargin.toFixed(2)})`,
      `Volume atual: ${currentVolume} un/mês`,
      `Volume prometido: ${promisedVolume} un/mês`,
      `Diferença lucro: R$ ${calc.profitDelta.toFixed(2)}/mês`,
      `Break-even: ${calc.breakEven ?? 'inviável'} un/mês`,
      ``,
      `Análise IA:`,
      aiText,
    ].join('\n')
    navigator.clipboard.writeText(txt).then(() => showToast('✅ Copiado'))
  }

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Simulador</b>
              <span>Desconto × Volume</span>
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
          <h1 className="ps-page-title">✨ Simulador: Desconto vs. Volume</h1>
          <p className="ps-page-lead">
            Avalia se um desconto pedido pelo cliente compensa, dado o volume prometido. Cálculo + análise contextual por IA (Claude Sonnet 4.5).
          </p>

          {loading ? (
            <div className="ps-empty">Carregando dados...</div>
          ) : (
            <div style={{display:'grid', gridTemplateColumns:'1fr', gap:14}} className="ps-sim-grid">
              {/* LEFT: INPUTS */}
              <div style={{display:'grid', gap:12}}>
                <div className="ps-card" style={{gap:10}}>
                  <div className="ps-flabel">Cliente / Produto</div>
                  <div className="ps-fieldgroup">
                    <div className="ps-fieldlabel">Cliente cadastrado</div>
                    <select value={customerId} onChange={e=>{ setCustomerId(e.target.value); setCustomerNameFree('') }} className="ps-select">
                      <option value="">— selecionar (ou usar livre abaixo) —</option>
                      {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    {!customerId && (
                      <input value={customerNameFree} onChange={e=>setCustomerNameFree(e.target.value)}
                        placeholder="ou digite o nome livre" className="ps-input" style={{marginTop:6}}/>
                    )}
                  </div>

                  <div className="ps-fieldgroup">
                    <div className="ps-fieldlabel">Produto</div>
                    <select value={productKey} onChange={e=>{ setProductKey(e.target.value); setProductNameFree('') }} className="ps-select">
                      <option value="">— selecionar do catálogo —</option>
                      {catalog.map(p => (
                        <option key={`${p.source}_${p.id}`} value={`${p.source}_${p.id}`}>
                          {p.name}{p.source === 'bread' ? ' 🥖' : ''}
                        </option>
                      ))}
                    </select>
                    {!productKey && (
                      <input value={productNameFree} onChange={e=>setProductNameFree(e.target.value)}
                        placeholder="ou digite o nome livre" className="ps-input" style={{marginTop:6}}/>
                    )}
                  </div>
                </div>

                <div className="ps-card" style={{gap:10}}>
                  <div className="ps-flabel">Produto / Tabela base</div>
                  <div className="ps-fieldgroup">
                    <div className="ps-fieldlabel">Preço de venda (Tabela B) — R$</div>
                    <input type="number" min={0} step={0.01} value={price || ''} onChange={e=>setPrice(Number(e.target.value)||0)}
                      placeholder="0,00" className="ps-input"/>
                  </div>
                  <div className="ps-fieldgroup">
                    <div className="ps-fieldlabel">CMV do produto (custo) — R$</div>
                    <input type="number" min={0} step={0.01} value={cmv || ''} onChange={e=>setCmv(Number(e.target.value)||0)}
                      placeholder="0,00" className="ps-input"/>
                  </div>
                </div>

                <div className="ps-card" style={{gap:10}}>
                  <div className="ps-flabel">Negociação com o cliente</div>
                  <div className="ps-fieldgroup">
                    <div className="ps-fieldlabel">Desconto solicitado — %</div>
                    <input type="number" min={0} max={99} step={0.5} value={discount || ''} onChange={e=>setDiscount(Math.min(99, Math.max(0, Number(e.target.value)||0)))}
                      placeholder="0" className="ps-input"/>
                  </div>
                  <div className="ps-fieldgroup">
                    <div className="ps-fieldlabel">Volume atual (unid/mês)</div>
                    <input type="number" min={0} step={1} value={currentVolume || ''} onChange={e=>setCurrentVolume(Number(e.target.value)||0)}
                      placeholder="0" className="ps-input"/>
                  </div>
                  <div className="ps-fieldgroup">
                    <div className="ps-fieldlabel">Volume prometido c/ desconto (unid/mês)</div>
                    <input type="number" min={0} step={1} value={promisedVolume || ''} onChange={e=>setPromisedVolume(Number(e.target.value)||0)}
                      placeholder="0" className="ps-input"/>
                  </div>
                </div>

                <button onClick={analisarIA} disabled={!hasMinInputs || aiLoading} className="ps-btn primary block">
                  <Sparkles size={16}/> {aiLoading ? 'Analisando...' : 'Analisar com IA →'}
                </button>
              </div>

              {/* RIGHT: RESULTADOS */}
              <div style={{display:'grid', gap:12}}>
                <div className="ps-card" style={{gap:10}}>
                  <div className="ps-flabel">Margens</div>
                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
                    <div style={{padding:'10px 12px', background:'var(--line-soft)', borderRadius:'var(--r-ctrl)'}}>
                      <div style={{fontSize:11, color:'var(--ink-faint)', marginBottom:2, textTransform:'uppercase', letterSpacing:'.08em', fontWeight:600}}>Atual</div>
                      <div style={{fontSize:20, fontWeight:700, color:'var(--sage)', fontFamily:'var(--font-display)'}}>{calc.marginPct.toFixed(1)}%</div>
                      <div style={{fontSize:12, color:'var(--ink-soft)'}}>R$ {calc.margin.toFixed(2)}</div>
                    </div>
                    <div style={{padding:'10px 12px', background:'var(--line-soft)', borderRadius:'var(--r-ctrl)'}}>
                      <div style={{fontSize:11, color:'var(--ink-faint)', marginBottom:2, textTransform:'uppercase', letterSpacing:'.08em', fontWeight:600}}>Com desconto</div>
                      <div style={{fontSize:20, fontWeight:700, color:calc.newMargin>0?'var(--sage)':'var(--berry)', fontFamily:'var(--font-display)'}}>{calc.newMarginPct.toFixed(1)}%</div>
                      <div style={{fontSize:12, color:'var(--ink-soft)'}}>R$ {calc.newMargin.toFixed(2)}</div>
                    </div>
                  </div>
                </div>

                <div className="ps-card" style={{gap:8}}>
                  <div className="ps-flabel">Lucro total (mês)</div>
                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
                    <div style={{padding:'10px 12px', background:'var(--line-soft)', borderRadius:'var(--r-ctrl)'}}>
                      <div style={{fontSize:11, color:'var(--ink-faint)', marginBottom:2, textTransform:'uppercase', letterSpacing:'.08em', fontWeight:600}}>Sem desconto</div>
                      <div style={{fontSize:16, fontWeight:700, fontFamily:'var(--font-display)'}}>R$ {calc.currentProfit.toFixed(2)}</div>
                    </div>
                    <div style={{padding:'10px 12px', background:'var(--line-soft)', borderRadius:'var(--r-ctrl)'}}>
                      <div style={{fontSize:11, color:'var(--ink-faint)', marginBottom:2, textTransform:'uppercase', letterSpacing:'.08em', fontWeight:600}}>Com desconto</div>
                      <div style={{fontSize:16, fontWeight:700, color:calc.profitDelta>=0?'var(--sage)':'var(--berry)', fontFamily:'var(--font-display)'}}>R$ {calc.promisedProfit.toFixed(2)}</div>
                    </div>
                  </div>

                  <div style={{display:'flex', justifyContent:'space-between', padding:'6px 0', borderTop:'1px solid var(--line-soft)', fontSize:13, marginTop:6}}>
                    <span style={{color:'var(--ink-soft)'}}>Volume mínimo p/ empatar</span>
                    <strong>{calc.breakEven === null ? '—' : `${calc.breakEven} unid`}</strong>
                  </div>
                  <div style={{display:'flex', justifyContent:'space-between', padding:'6px 0', borderTop:'1px solid var(--line-soft)', fontSize:13}}>
                    <span style={{color:'var(--ink-soft)'}}>Diferença de lucro</span>
                    <strong style={{color:calc.profitDelta>=0?'var(--sage)':'var(--berry)', fontVariantNumeric:'tabular-nums'}}>R$ {calc.profitDelta.toFixed(2)}</strong>
                  </div>
                  <div style={{display:'flex', justifyContent:'space-between', padding:'6px 0', borderTop:'1px solid var(--line-soft)', fontSize:13}}>
                    <span style={{color:'var(--ink-soft)'}}>Impacto margem (%)</span>
                    <strong style={{color:calc.marginPctDiff>=0?'var(--sage)':'var(--berry)'}}>{calc.marginPctDiff.toFixed(1)}%</strong>
                  </div>

                  {calc.breakEven !== null && promisedVolume > 0 && (
                    <>
                      <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:8}}>Prometido vs. mínimo</div>
                      <div style={{height:8, background:'var(--ps-line)', borderRadius:4, overflow:'hidden'}}>
                        <div style={{
                          width: `${Math.min(100, (promisedVolume / calc.breakEven) * 100)}%`,
                          height:'100%',
                          background: promisedVolume >= calc.breakEven ? 'var(--sage)' : 'var(--honey-deep)',
                          transition:'width .2s'
                        }}/>
                      </div>
                    </>
                  )}
                </div>

                <div className="ps-card" style={{borderLeft:`4px solid ${verdictInfo.color}`, gap:6}}>
                  <div style={{fontWeight:700, fontSize:15, color:verdictInfo.color}}>{verdictInfo.label}</div>
                  {hasMinInputs && (
                    <div style={{fontSize:13, color:'var(--ink-soft)', lineHeight:1.5}}>
                      {calc.verdict === 'margem_negativa' && (
                        <>O preço com desconto (R$ {calc.newPrice.toFixed(2)}) é menor que o CMV (R$ {cmv.toFixed(2)}). Cada venda gera prejuízo direto. <strong>Não negocie esse desconto.</strong></>
                      )}
                      {calc.verdict === 'nao_vale' && (
                        <>O volume prometido ({promisedVolume} unid) está {calc.volumeShortage} unidades abaixo do mínimo necessário ({calc.breakEven} unid). Você perderia R$ {Math.abs(calc.profitDelta).toFixed(2)}/mês. Ou negocie menos desconto, ou exija mais volume.</>
                      )}
                      {calc.verdict === 'vale' && (
                        <>Volume prometido ({promisedVolume} unid) supera o mínimo de break-even ({calc.breakEven} unid). Ganho líquido de R$ {calc.profitDelta.toFixed(2)}/mês. <em>Atenção: análise não considera custos fixos.</em></>
                      )}
                    </div>
                  )}
                </div>

                {(aiText || aiError || aiLoading) && (
                  <div className="ps-card" style={{background:'var(--line-soft)', gap:8}}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                      <div className="ps-flabel" style={{margin:0}}>Análise — Claude Sonnet 4.5</div>
                      {aiText && (
                        <button onClick={copyResult} className="ps-btn ghost sm">
                          <Copy size={12}/> Copiar
                        </button>
                      )}
                    </div>
                    {aiLoading && <div style={{color:'var(--ink-soft)', fontSize:13}}>⏳ Consultando IA...</div>}
                    {aiError && <div style={{color:'var(--berry)', fontSize:13, whiteSpace:'pre-wrap'}}>❌ {aiError}</div>}
                    {aiText && <div style={{fontSize:13, lineHeight:1.55, whiteSpace:'pre-wrap', color:'var(--ps-ink)'}}>{aiText}</div>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Histórico */}
          {history.length > 0 && (
            <div className="ps-card" style={{marginTop:16, gap:8}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <div className="ps-flabel" style={{margin:0}}>Histórico local ({history.length})</div>
                <button onClick={clearHistory} className="ps-btn danger sm">
                  <Trash2 size={12}/> Limpar
                </button>
              </div>
              <div style={{display:'grid', gap:6}}>
                {history.map(h => {
                  const vBadge = h.verdict === 'vale' ? { cls:'conferido', label:'✅' }
                              : h.verdict === 'nao_vale' ? { cls:'com_divergencia', label:'❌' }
                              : { cls:'com_divergencia', label:'🚨' }
                  return (
                    <div key={h.ts} onClick={()=>loadFromHistory(h)}
                      style={{padding:'10px 12px', background:'var(--cream-raise)', border:'1px solid var(--ps-line)', borderRadius:'var(--r-ctrl)', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                      <div style={{flex:1, minWidth:160}}>
                        <div style={{fontSize:13, fontWeight:600, color:'var(--ps-ink)'}}>
                          {h.customerName || '(sem cliente)'} · {h.productName || '(sem produto)'}
                        </div>
                        <div style={{fontSize:11, color:'var(--ink-faint)'}}>
                          Preço R$ {h.price.toFixed(2)} · -{h.discount}% · {h.currentVolume}→{h.promisedVolume} un · {new Date(h.ts).toLocaleString('pt-BR')}
                        </div>
                      </div>
                      <span className={`ps-status ${vBadge.cls}`}>
                        {vBadge.label} R$ {h.profitDelta.toFixed(2)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
