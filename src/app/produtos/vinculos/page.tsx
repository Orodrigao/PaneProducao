'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Search } from 'lucide-react'
import { canAccess, getCurrentUserAsync, type AppUser } from '@/lib/auth'
import { canViewNfeLinks, authorName, currencyLabel, dateLabel, dateTimeLabel, invoiceMappingLabel, mappingStatusLabel } from '@/lib/vinculosNfe'
import { loadLinkProductDetails, searchLinkProducts, type LinkProductDetails, type ProductOption } from '@/lib/vinculosNfeClient'
import { findCurrentRecipeUsage, type RecipeUsageIndex } from '@/lib/recipeUsage'
import { loadRecipeUsageIndex } from '@/lib/recipeUsageClient'

export default function VinculosNfePage() {
  const [user, setUser] = useState<AppUser | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [products, setProducts] = useState<ProductOption[]>([])
  const [recipeUsageIndex, setRecipeUsageIndex] = useState<RecipeUsageIndex | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ProductOption | null>(null)
  const [details, setDetails] = useState<LinkProductDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void getCurrentUserAsync().then(current => {
      if (active) {
        setUser(current)
        setAuthReady(true)
      }
    })
    return () => { active = false }
  }, [])

  const allowed = user ? canAccess(user, '/produtos/vinculos') && canViewNfeLinks(user) : false

  useEffect(() => {
    let active = true
    if (!allowed) return () => { active = false }
    void loadRecipeUsageIndex().then(index => {
      if (active) setRecipeUsageIndex(index)
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as fichas de receita.')
    })
    return () => { active = false }
  }, [allowed])

  const searchProducts = useCallback(async (term: string) => {
    if (!allowed) return
    setLoading(true)
    setError('')
    try {
      setProducts(await searchLinkProducts(term))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível buscar produtos.')
    } finally {
      setLoading(false)
    }
  }, [allowed])

  useEffect(() => {
    if (allowed) void searchProducts(search)
  }, [allowed, search, searchProducts])

  useEffect(() => {
    let active = true
    if (!selected || !allowed || !recipeUsageIndex) {
      setDetails(null)
      return () => { active = false }
    }
    setLoading(true)
    setError('')
    void loadLinkProductDetails(selected, recipeUsageIndex).then(result => {
      if (active) setDetails(result)
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os vínculos.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [selected, allowed, recipeUsageIndex])

  if (!authReady) return <main className="ps-canvas"><div className="ps-shell"><p className="ps-pad">Carregando seu acesso…</p></div></main>
  if (!user) return <main className="ps-canvas"><div className="ps-shell"><section className="ps-pad"><h1>Entre no ERP</h1><Link href="/login" className="ps-btn primary">Ir para o login</Link></section></div></main>
  if (!allowed) return <main className="ps-canvas"><div className="ps-shell"><section className="ps-pad"><h1>Acesso não liberado</h1><p>Esta consulta está disponível para Administração e para o Financeiro autorizado.</p><Link href="/" className="ps-btn ghost">Voltar ao início</Link></section></div></main>

  const usages = details ? findCurrentRecipeUsage(details.recipeUsageIndex, details.product.id) : null

  return (
    <main className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark"><div className="ps-mark">P</div><div className="ps-brand"><b>Vínculos de NF-e</b><span>Consulta do Catálogo</span></div></div>
          <Link href="/produtos" className="ps-btn ghost sm"><ArrowLeft size={14}/> Catálogo</Link>
        </header>
        <div className="ps-scroll ps-pad">
          <section className="ps-card" style={{ marginTop: 14, padding: 14 }}>
            <h1 style={{ margin: '0 0 6px', fontSize: 20 }}>Vínculos por produto</h1>
            <p style={{ margin: '0 0 12px', color: 'var(--ink-soft)' }}>Consulte separadamente as memórias do fornecedor, os vínculos gravados nas notas e o uso atual nas fichas de receita. Esta tela não confirma nem altera vínculos.</p>
            <label htmlFor="nfe-product-search" style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Buscar produto do catálogo</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: '1 1 280px', position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-faint)' }}/><input id="nfe-product-search" className="ps-input" value={search} onChange={event => { setSearch(event.target.value); setSelected(null) }} placeholder="Digite o nome do produto" style={{ width: '100%', paddingLeft: 32 }}/></div>
              {loading && <span role="status">Carregando…</span>}
            </div>
            {products.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {products.map(product => <button key={product.id} type="button" className={`ps-btn ${selected?.id === product.id ? 'primary' : 'ghost'} sm`} onClick={() => setSelected(product)}>{product.name}{product.active ? '' : ' (inativo)'}</button>)}
              </div>
            )}
            {products.length === 100 && <small style={{ display: 'block', marginTop: 8 }}>Mostrando até 100 produtos. Refine a busca para localizar outro item.</small>}
            {error && <p role="alert" style={{ color: 'var(--berry)', marginBottom: 0 }}>{error}<button type="button" className="ps-btn ghost sm" style={{ marginLeft: 8 }} onClick={() => selected ? setSelected({ ...selected }) : void searchProducts(search)}>Tentar novamente</button></p>}
            {!loading && !error && products.length === 0 && <p style={{ marginBottom: 0, color: 'var(--ink-soft)' }}>Nenhum produto encontrado.</p>}
          </section>

          {details && (
            <>
              <section className="ps-card" style={{ marginTop: 12, padding: 14 }}>
                <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>{details.product.name} <small style={{ fontWeight: 400 }}>({details.product.unit || 'unidade não informada'})</small></h2>
                <p style={{ margin: 0, color: 'var(--ink-soft)' }}>Produto {details.product.active ? 'ativo' : 'inativo'} no catálogo.</p>
              </section>

              <section className="ps-card" style={{ marginTop: 12, padding: 14 }}>
                <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>Memórias de vínculo por fornecedor</h2>
                <p style={{ margin: '0 0 10px', color: 'var(--ink-soft)' }}>São associações guardadas para ajudar em próximas importações. Não provam, sozinhas, o que foi usado em uma nota antiga.</p>
                {details.memories.length === 0 ? <p>Nenhuma memória encontrada para este produto.</p> : details.memories.map(memory => (
                  <article key={memory.id} style={{ borderTop: '1px solid var(--ps-line)', padding: '10px 0' }}>
                    <b>{memory.supplier_name}</b> · {mappingStatusLabel(memory)}
                    <p style={{ margin: '4px 0' }}>{memory.supplier_description} · código {memory.supplier_product_code || 'não informado'} · EAN {memory.supplier_ean || 'não informado'}</p>
                    <p style={{ margin: '4px 0' }}>Unidade da nota: {memory.purchase_unit} → unidade do produto: {memory.base_unit} · fator {memory.conversion_factor} ({memory.conversion_basis})</p>
                    <small>Confirmado em {dateTimeLabel(memory.last_confirmed_at)} por {authorName(details.authors, memory.last_confirmed_by)}. Fator {memory.factor_confirmed ? 'confirmado' : 'não marcado como confirmado'}.</small>
                  </article>
                ))}
              </section>

              <section className="ps-card" style={{ marginTop: 12, padding: 14 }}>
                <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>Vínculos efetivamente salvos nas notas</h2>
                <p style={{ margin: '0 0 10px', color: 'var(--ink-soft)' }}>Esta parte mostra os itens de NF-e que foram gravados apontando para este produto. O sistema não guarda uma ligação entre cada nota e a memória do fornecedor.</p>
                {details.invoices.length === 0 ? <p>Nenhum item de NF-e encontrado para este produto.</p> : details.invoices.map(item => (
                  <article key={item.id} style={{ borderTop: '1px solid var(--ps-line)', padding: '10px 0' }}>
                    <b>{item.supplier_name}</b> · {invoiceMappingLabel(item)}
                    <p style={{ margin: '4px 0' }}>NF {item.invoice_number || 'sem número'}{item.invoice_series ? `, série ${item.invoice_series}` : ''} · emissão {dateLabel(item.invoice_date)} · compra {dateLabel(item.purchase_date)}</p>
                    <p style={{ margin: '4px 0' }}>{item.source_description || 'Descrição não registrada'} · código {item.source_code || 'não informado'} · EAN {item.source_ean || 'não informado'}</p>
                    <p style={{ margin: '4px 0' }}>Na nota: {item.source_quantity ?? 'quantidade não registrada'} {item.source_unit || ''} · salvo como {item.quantity} {item.unit} · preço unitário {currencyLabel(item.unit_price)}</p>
                    <p style={{ margin: '4px 0' }}>Conversão registrada: {item.conversion_factor ?? 'sem fator'} {item.conversion_basis ? `(${item.conversion_basis})` : ''} · vínculo por {authorName(details.authors, item.mapping_confirmed_by)} em {dateTimeLabel(item.mapping_confirmed_at)}</p>
                    <small>Fator {item.factor_confirmed ? 'marcado como confirmado' : 'não marcado como confirmado'} por {authorName(details.authors, item.factor_confirmed_by)} em {dateTimeLabel(item.factor_confirmed_at)}. Situação da compra: {item.status}.</small>
                  </article>
                ))}
              </section>

              <section className="ps-card" style={{ marginTop: 12, padding: 14 }}>
                <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>Uso atual nas fichas de receita</h2>
                <p style={{ margin: '0 0 10px', color: 'var(--ink-soft)' }}>Mostra as fichas cadastradas hoje; não reconstrói as receitas vigentes na data de cada nota.</p>
                {!usages || usages.usages.length === 0 ? <p>Este produto não aparece como componente em fichas atuais.</p> : usages.usages.map(usage => {
                  const pathNames = usage.path.map(id => details.recipeUsageIndex.products.get(id)?.name ?? id)
                  return <article key={usage.productId} style={{ borderTop: '1px solid var(--ps-line)', padding: '10px 0' }}><b>{usage.name}</b> · {usage.active ? 'ativo' : 'inativo'}<p style={{ margin: '4px 0' }}>Caminho da ficha: {pathNames.join(' → ')}</p></article>
                })}
                {usages?.truncated && <p>Há mais usos ou níveis além do limite mostrado.</p>}
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
