'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'

// ===== Tipos =====
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

interface CatalogProduct {
  id:string; source:'bread'|'product'; name:string; cost_price:number
}

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

// ===== Componente =====
export default function SimuladorDescontoPage() {
  const [user, setUser] = useState<{displayName:string}|null>(null)

  // Dados base
  const [customers, setCustomers] = useState<Customer[]>([])
  const [tierItems, setTierItems] = useState<TierItem[]>([])
  const [overrides, setOverrides] = useState<Override[]>([])
  const [catalog, setCatalog]     = useState<CatalogProduct[]>([])
  const [loading, setLoading]     = useState(true)

  // Inputs
  const [customerId, setCustomerId] = useState('')
  const [productKey, setProductKey] = useState('')  // formato: "source_id"
  const [customerNameFree, setCustomerNameFree] = useState('')  // se não selecionou cliente
  const [productNameFree, setProductNameFree]   = useState('')  // se não selecionou produto
  const [price, setPrice]       = useState<number>(0)
  const [cmv, setCmv]           = useState<number>(0)
  const [discount, setDiscount] = useState<number>(0)
  const [currentVolume, setCurrentVolume]   = useState<number>(0)
  const [promisedVolume, setPromisedVolume] = useState<number>(0)

  // IA
  const [aiLoading, setAiLoading] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiError, setAiError] = useState('')

  // Histórico local
  const [history, setHistory] = useState<HistoryEntry[]>([])

  useEffect(() => {
    const u = getCurrentUser(); if (u) setUser({ displayName: u.displayName })
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

  // ===== Auto-fill quando seleciona cliente + produto =====
  useEffect(() => {
    if (!customerId || !productKey) return
    const cust = customers.find(c => c.id === customerId)
    const prod = catalog.find(p => `${p.source}_${p.id}` === productKey)
    if (!cust || !prod) return

    // 1. Tenta override do cliente
    const ov = overrides.find(o => o.customer_id === cust.id && o.product_source === prod.source && o.product_id === prod.id)
    if (ov) {
      setPrice(Number(ov.unit_price))
      setCmv(prod.cost_price)
      return
    }
    // 2. Tenta tier do cliente
    if (cust.default_tier_id) {
      const ti = tierItems.find(t => t.tier_id === cust.default_tier_id && t.product_source === prod.source && t.product_id === prod.id)
      if (ti) {
        const basePrice = Number(ti.unit_price)
        // desconto base do cliente é aplicado no preço efetivo, mas pra simulador faz mais sentido
        // usar o preço da TABELA (não-descontado) pra mostrar "preço de venda Tabela B"
        setPrice(basePrice)
        setCmv(prod.cost_price)
        return
      }
    }
    // 3. Sem cadastro: só preenche CMV
    setCmv(prod.cost_price)
  }, [customerId, productKey, customers, catalog, overrides, tierItems])

  // ===== Quando muda só o produto (sem cliente), preenche CMV =====
  useEffect(() => {
    if (customerId || !productKey) return
    const prod = catalog.find(p => `${p.source}_${p.id}` === productKey)
    if (prod) setCmv(prod.cost_price)
  }, [productKey, customerId, catalog])

  // ===== Cálculos =====
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

  // ===== Histórico =====
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

  // ===== Chamar IA =====
  const analisarIA = async () => {
    if (!hasMinInputs) { showToast('Preencha todos os campos antes de analisar'); return }
    setAiLoading(true); setAiText(''); setAiError('')
    const custName = customers.find(c => c.id === customerId)?.name || customerNameFree.trim() || ''
    const prodName = catalog.find(p => `${p.source}_${p.id}` === productKey)?.name || productNameFree.trim() || ''
    try {
      const { data, error } = await supabase.functions.invoke('analisar-desconto', {
        body: {
          price, cmv, discount, currentVolume, promisedVolume,
          customerName: custName || undefined,
          productName: prodName || undefined,
        }
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setAiText(data?.analysis || '(resposta vazia)')
      saveToHistory({ customerName: custName, productName: prodName })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setAiError(msg)
    } finally { setAiLoading(false) }
  }

  // ===== UI helpers =====
  const verdictBadge = (() => {
    if (!hasMinInputs) return { label: 'preencha os dados', bg: '#f3f4f6', color: '#6b7280' }
    if (calc.verdict === 'margem_negativa') return { label: '🚨 MARGEM NEGATIVA', bg: '#fef2f2', color: '#991b1b' }
    if (calc.verdict === 'nao_vale')        return { label: '❌ NÃO COMPENSA',    bg: '#fef2f2', color: '#991b1b' }
    return { label: '✅ VALE',  bg: '#f0fdf4', color: '#15803d' }
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
    <div style={{maxWidth:1100,margin:'0 auto'}}>
      <div style={{padding:'14px 16px',background:'var(--primary)',color:'white',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
        <span style={{fontWeight:700}}>✨ Simulador: Desconto vs. Volume</span>
        {user && <span style={{fontSize:'.78rem',opacity:.85}}>{user.displayName}</span>}
      </div>

      <div style={{padding:16}}>
        <p style={{margin:'0 0 14px',color:'var(--muted)',fontSize:'.85rem'}}>
          Avalia se um desconto pedido pelo cliente compensa, dado o volume prometido. Cálculo + análise contextual por IA (Claude Sonnet 4.5).
        </p>

        {loading ? (
          <div style={{padding:40,textAlign:'center',color:'var(--muted)'}}>Carregando dados...</div>
        ) : (
          <div style={{display:'grid',gridTemplateColumns:'minmax(280px, 1fr) minmax(280px, 1fr)',gap:14}}>

            {/* ===== LEFT: INPUTS ===== */}
            <div style={{display:'grid',gap:12}}>
              <div className="card">
                <div className="card-title">CLIENTE / PRODUTO</div>
                <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Cliente cadastrado</label>
                <select value={customerId} onChange={e=>{ setCustomerId(e.target.value); setCustomerNameFree('') }}
                  style={{width:'100%',padding:9,border:'1.5px solid var(--border)',borderRadius:6,fontSize:'.88rem',background:'white',marginBottom:8}}>
                  <option value="">— selecionar (ou usar livre abaixo) —</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {!customerId && (
                  <input value={customerNameFree} onChange={e=>setCustomerNameFree(e.target.value)}
                    placeholder="ou digite o nome livre"
                    style={{width:'100%',padding:9,border:'1.5px solid var(--border)',borderRadius:6,fontSize:'.88rem',marginBottom:10}}/>
                )}

                <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600,marginTop:customerId?6:0}}>Produto</label>
                <select value={productKey} onChange={e=>{ setProductKey(e.target.value); setProductNameFree('') }}
                  style={{width:'100%',padding:9,border:'1.5px solid var(--border)',borderRadius:6,fontSize:'.88rem',background:'white',marginBottom:8}}>
                  <option value="">— selecionar do catálogo —</option>
                  {catalog.map(p => (
                    <option key={`${p.source}_${p.id}`} value={`${p.source}_${p.id}`}>
                      {p.name}{p.source === 'bread' ? ' 🥖' : ''}
                    </option>
                  ))}
                </select>
                {!productKey && (
                  <input value={productNameFree} onChange={e=>setProductNameFree(e.target.value)}
                    placeholder="ou digite o nome livre"
                    style={{width:'100%',padding:9,border:'1.5px solid var(--border)',borderRadius:6,fontSize:'.88rem'}}/>
                )}
              </div>

              <div className="card">
                <div className="card-title">PRODUTO / TABELA BASE</div>
                <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Preço de venda (Tabela B) — R$</label>
                <input type="number" min={0} step={0.01} value={price || ''} onChange={e=>setPrice(Number(e.target.value)||0)}
                  placeholder="0,00"
                  style={{width:'100%',padding:9,border:'1.5px solid var(--border)',borderRadius:6,fontSize:'.95rem',marginBottom:10}}/>
                <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>CMV do produto (custo) — R$</label>
                <input type="number" min={0} step={0.01} value={cmv || ''} onChange={e=>setCmv(Number(e.target.value)||0)}
                  placeholder="0,00"
                  style={{width:'100%',padding:9,border:'1.5px solid var(--border)',borderRadius:6,fontSize:'.95rem'}}/>
              </div>

              <div className="card">
                <div className="card-title">NEGOCIAÇÃO COM O CLIENTE</div>
                <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Desconto solicitado — %</label>
                <input type="number" min={0} max={99} step={0.5} value={discount || ''} onChange={e=>setDiscount(Math.min(99, Math.max(0, Number(e.target.value)||0)))}
                  placeholder="0"
                  style={{width:'100%',padding:9,border:'1.5px solid var(--border)',borderRadius:6,fontSize:'.95rem',marginBottom:10}}/>
                <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Volume atual do cliente (unid/mês)</label>
                <input type="number" min={0} step={1} value={currentVolume || ''} onChange={e=>setCurrentVolume(Number(e.target.value)||0)}
                  placeholder="0"
                  style={{width:'100%',padding:9,border:'1.5px solid var(--border)',borderRadius:6,fontSize:'.95rem',marginBottom:10}}/>
                <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Volume prometido com desconto (unid/mês)</label>
                <input type="number" min={0} step={1} value={promisedVolume || ''} onChange={e=>setPromisedVolume(Number(e.target.value)||0)}
                  placeholder="0"
                  style={{width:'100%',padding:9,border:'1.5px solid var(--border)',borderRadius:6,fontSize:'.95rem'}}/>
              </div>

              <button onClick={analisarIA} disabled={!hasMinInputs || aiLoading}
                style={{padding:'12px',background:hasMinInputs&&!aiLoading?'var(--primary)':'#e5e7eb',color:hasMinInputs&&!aiLoading?'white':'#9ca3af',border:'none',borderRadius:8,cursor:hasMinInputs&&!aiLoading?'pointer':'default',fontSize:'.92rem',fontWeight:700}}>
                {aiLoading ? '⏳ Analisando...' : '✨ Analisar com IA →'}
              </button>
            </div>

            {/* ===== RIGHT: RESULTADOS ===== */}
            <div style={{display:'grid',gap:12}}>
              <div className="card">
                <div className="card-title">MARGENS</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                  <div style={{padding:'10px 12px',background:'#f9fafb',borderRadius:8}}>
                    <div style={{fontSize:'.7rem',color:'var(--muted)',marginBottom:2}}>Margem atual</div>
                    <div style={{fontSize:'1.2rem',fontWeight:700,color:'#0a6e52'}}>{calc.marginPct.toFixed(1)}%</div>
                    <div style={{fontSize:'.78rem',color:'var(--muted)'}}>R$ {calc.margin.toFixed(2)}</div>
                  </div>
                  <div style={{padding:'10px 12px',background:'#f9fafb',borderRadius:8}}>
                    <div style={{fontSize:'.7rem',color:'var(--muted)',marginBottom:2}}>Margem com desconto</div>
                    <div style={{fontSize:'1.2rem',fontWeight:700,color:calc.newMargin>0?'#0a6e52':'#dc2626'}}>{calc.newMarginPct.toFixed(1)}%</div>
                    <div style={{fontSize:'.78rem',color:'var(--muted)'}}>R$ {calc.newMargin.toFixed(2)}</div>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-title">LUCRO TOTAL (MÊS)</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                  <div style={{padding:'10px 12px',background:'#f9fafb',borderRadius:8}}>
                    <div style={{fontSize:'.7rem',color:'var(--muted)',marginBottom:2}}>Sem desconto</div>
                    <div style={{fontSize:'1.05rem',fontWeight:700}}>R$ {calc.currentProfit.toFixed(2)}</div>
                  </div>
                  <div style={{padding:'10px 12px',background:'#f9fafb',borderRadius:8}}>
                    <div style={{fontSize:'.7rem',color:'var(--muted)',marginBottom:2}}>Com desconto</div>
                    <div style={{fontSize:'1.05rem',fontWeight:700,color:calc.profitDelta>=0?'#0a6e52':'#dc2626'}}>R$ {calc.promisedProfit.toFixed(2)}</div>
                  </div>
                </div>

                <div style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderTop:'1px solid var(--border)',fontSize:'.85rem'}}>
                  <span style={{color:'var(--muted)'}}>Volume mínimo para empatar</span>
                  <strong>{calc.breakEven === null ? '—' : `${calc.breakEven} unid`}</strong>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderTop:'1px solid var(--border)',fontSize:'.85rem'}}>
                  <span style={{color:'var(--muted)'}}>Diferença de lucro</span>
                  <strong style={{color:calc.profitDelta>=0?'#0a6e52':'#dc2626'}}>R$ {calc.profitDelta.toFixed(2)}</strong>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderTop:'1px solid var(--border)',fontSize:'.85rem'}}>
                  <span style={{color:'var(--muted)'}}>Impacto margem (%)</span>
                  <strong style={{color:calc.marginPctDiff>=0?'#0a6e52':'#dc2626'}}>{calc.marginPctDiff.toFixed(1)}%</strong>
                </div>

                {calc.breakEven !== null && promisedVolume > 0 && (
                  <>
                    <div style={{fontSize:'.72rem',color:'var(--muted)',marginTop:10,marginBottom:4}}>Volume prometido vs. mínimo necessário</div>
                    <div style={{height:8,background:'#e5e7eb',borderRadius:4,overflow:'hidden'}}>
                      <div style={{
                        width: `${Math.min(100, (promisedVolume / calc.breakEven) * 100)}%`,
                        height:'100%',
                        background: promisedVolume >= calc.breakEven ? '#15803d' : '#f59e0b',
                        transition:'width .2s'
                      }}/>
                    </div>
                  </>
                )}
              </div>

              <div style={{padding:'14px 16px',background:verdictBadge.bg,borderRadius:10,borderLeft:`4px solid ${verdictBadge.color}`}}>
                <div style={{fontWeight:700,fontSize:'1rem',color:verdictBadge.color,marginBottom:6}}>{verdictBadge.label}</div>
                {hasMinInputs && (
                  <div style={{fontSize:'.82rem',color:verdictBadge.color,lineHeight:1.5}}>
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

              {/* IA result */}
              {(aiText || aiError || aiLoading) && (
                <div className="card" style={{background:'#fafaf9',borderColor:'#e7e5e4'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                    <div className="card-title" style={{marginBottom:0}}>ANÁLISE — CLAUDE SONNET 4.5</div>
                    {aiText && (
                      <button onClick={copyResult}
                        style={{background:'none',border:'1px solid var(--border)',borderRadius:6,padding:'3px 8px',cursor:'pointer',fontSize:'.72rem'}}>
                        📋 Copiar
                      </button>
                    )}
                  </div>
                  {aiLoading && <div style={{color:'var(--muted)',fontSize:'.85rem'}}>⏳ Consultando IA...</div>}
                  {aiError && <div style={{color:'#dc2626',fontSize:'.85rem',whiteSpace:'pre-wrap'}}>❌ {aiError}</div>}
                  {aiText && <div style={{fontSize:'.85rem',lineHeight:1.55,whiteSpace:'pre-wrap',color:'#44403c'}}>{aiText}</div>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Histórico */}
        {history.length > 0 && (
          <div className="card" style={{marginTop:16}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <div className="card-title" style={{marginBottom:0}}>HISTÓRICO LOCAL ({history.length})</div>
              <button onClick={clearHistory} style={{background:'none',border:'1px solid var(--border)',borderRadius:6,padding:'3px 8px',cursor:'pointer',fontSize:'.72rem',color:'#dc2626'}}>Limpar</button>
            </div>
            <div style={{display:'grid',gap:6}}>
              {history.map(h => {
                const vBadge = h.verdict === 'vale' ? { bg:'#dcfce7', color:'#15803d', label:'✅' } : h.verdict === 'nao_vale' ? { bg:'#fef2f2', color:'#991b1b', label:'❌' } : { bg:'#fef2f2', color:'#991b1b', label:'🚨' }
                return (
                  <div key={h.ts} onClick={()=>loadFromHistory(h)}
                    style={{padding:'8px 10px',background:'white',border:'1px solid var(--border)',borderRadius:6,cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                    <div style={{flex:1,minWidth:160}}>
                      <div style={{fontSize:'.85rem',fontWeight:600}}>
                        {h.customerName || '(sem cliente)'} · {h.productName || '(sem produto)'}
                      </div>
                      <div style={{fontSize:'.72rem',color:'var(--muted)'}}>
                        Preço R$ {h.price.toFixed(2)} · -{h.discount}% · {h.currentVolume}→{h.promisedVolume} un · {new Date(h.ts).toLocaleString('pt-BR')}
                      </div>
                    </div>
                    <span style={{padding:'2px 8px',borderRadius:20,background:vBadge.bg,color:vBadge.color,fontSize:'.72rem',fontWeight:700}}>
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
  )
}
