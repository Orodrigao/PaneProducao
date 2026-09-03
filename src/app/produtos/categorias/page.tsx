'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Pencil, Plus, Save, Tags } from 'lucide-react'
import { getCurrentUserAsync, roleColor, type AppUser } from '@/lib/auth'
import {
  CATALOG_TYPES,
  CATALOG_TYPE_LABELS,
  loadProductCategories,
  saveProductCategory,
  validateProductCategoryDraft,
  type CatalogType,
  type ProductCategory,
  type ProductCategoryDraft,
} from '@/lib/productCategories'
import styles from './page.module.css'

const NEW_CATEGORY: ProductCategoryDraft = {
  name: '',
  catalogType: 'materia_prima',
  active: true,
  sortOrder: 0,
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return 'Não foi possível salvar a categoria.'
}

export default function ProductCategoriesPage() {
  const router = useRouter()
  const [user, setUser] = useState<AppUser | null>(null)
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [draft, setDraft] = useState<ProductCategoryDraft | null>(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<CatalogType | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  async function reload() {
    const loaded = await loadProductCategories()
    setCategories(loaded)
  }

  useEffect(() => {
    let alive = true
    void (async () => {
      const current = await getCurrentUserAsync()
      if (!alive) return
      if (!current || current.role !== 'admin') {
        router.replace('/produtos')
        return
      }
      setUser(current)
      try {
        const loaded = await loadProductCategories()
        if (alive) setCategories(loaded)
      } catch {
        if (alive) setMessage('A estrutura de categorias ainda não está disponível neste ambiente.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [router])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR')
    return categories.filter(category =>
      (typeFilter === 'all' || category.catalog_type === typeFilter)
      && (!normalized
        || category.name.toLocaleLowerCase('pt-BR').includes(normalized)
        || CATALOG_TYPE_LABELS[category.catalog_type].toLocaleLowerCase('pt-BR').includes(normalized)),
    )
  }, [categories, query, typeFilter])

  function edit(category: ProductCategory) {
    setDraft({
      id: category.id,
      name: category.name,
      catalogType: category.catalog_type,
      active: category.active,
      sortOrder: category.sort_order,
    })
    setMessage('')
  }

  async function save() {
    if (!draft) return
    const validationError = validateProductCategoryDraft(draft)
    if (validationError) {
      setMessage(validationError)
      return
    }
    setSaving(true)
    setMessage('')
    try {
      await saveProductCategory(draft)
      await reload()
      setDraft(null)
      setMessage('Categoria salva com sucesso.')
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="ps-loading"><div className="ps-spinner"/><p>Carregando...</p></div>

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand"><b>Categorias de produtos</b><span>Lista controlada do catálogo</span></div>
          </div>
          {user && <div className="ps-userchip"><div className="ps-avatar" style={{ background: roleColor(user.role) }}>{user.displayName.charAt(0).toUpperCase()}</div><b>{user.displayName}</b></div>}
        </header>

        <main className="ps-scroll ps-pad">
          <div className={styles.actions}>
            <Link href="/produtos" className="ps-btn ghost"><ArrowLeft size={15}/> Voltar ao catálogo</Link>
            <button className="ps-btn primary" onClick={() => { setDraft({ ...NEW_CATEGORY }); setMessage('') }}>
              <Plus size={15}/> Nova categoria
            </button>
          </div>

          <div className="ps-banner honey">
            <Tags size={20} aria-hidden="true"/>
            <span><b>Categoria do produto.</b> Esta lista é diferente das categorias financeiras do DRE. Somente administradores podem alterá-la.</span>
          </div>

          <div className="ps-banner" style={{ marginTop: 10 }}>
            Nesta primeira fase, os produtos antigos continuam como estão. A vinculação e a unificação das categorias serão feitas depois da auditoria.
          </div>

          {draft && (
            <section className={`ps-card ${styles.editor}`}>
              <h1 className="ps-page-title">{draft.id ? 'Editar categoria' : 'Nova categoria'}</h1>
              <div className="ps-fieldrow">
                <div className="ps-fieldgroup">
                  <label className="ps-fieldlabel" htmlFor="category-name">Nome</label>
                  <input id="category-name" className="ps-input" value={draft.name} maxLength={80}
                    onChange={event => setDraft(current => current ? { ...current, name: event.target.value } : current)}/>
                </div>
                <div className="ps-fieldgroup">
                  <label className="ps-fieldlabel" htmlFor="category-type">Tipo de item</label>
                  <select id="category-type" className="ps-select" value={draft.catalogType}
                    onChange={event => setDraft(current => current ? { ...current, catalogType: event.target.value as CatalogType } : current)}>
                    {CATALOG_TYPES.map(type => <option key={type} value={type}>{CATALOG_TYPE_LABELS[type]}</option>)}
                  </select>
                </div>
                <div className={styles.orderField}>
                  <label className="ps-fieldlabel" htmlFor="category-order">Ordem</label>
                  <input id="category-order" className="ps-input" type="number" min={0} max={10000} step={1}
                    value={draft.sortOrder}
                    onChange={event => setDraft(current => current ? { ...current, sortOrder: Number(event.target.value) } : current)}/>
                </div>
              </div>
              {draft.id && (
                <label className={styles.activeToggle}>
                  <input type="checkbox" checked={draft.active}
                    onChange={event => setDraft(current => current ? { ...current, active: event.target.checked } : current)}/>
                  Categoria ativa para novos cadastros
                </label>
              )}
              <div className={styles.editorActions}>
                <button className="ps-btn primary" disabled={saving} onClick={() => void save()}><Save size={15}/> {saving ? 'Salvando...' : 'Salvar categoria'}</button>
                <button className="ps-btn ghost" disabled={saving} onClick={() => setDraft(null)}>Cancelar</button>
              </div>
            </section>
          )}

          {message && <div className={`ps-banner ${message.includes('sucesso') ? 'honey' : ''}`} style={{ marginTop: 10 }}>{message}</div>}

          <div className={styles.filters}>
            <input className="ps-input" value={query} onChange={event => setQuery(event.target.value)}
              placeholder="Buscar categoria..." aria-label="Buscar categoria"/>
            <select className="ps-select" value={typeFilter} onChange={event => setTypeFilter(event.target.value as CatalogType | 'all')} aria-label="Filtrar por tipo">
              <option value="all">Todos os tipos</option>
              {CATALOG_TYPES.map(type => <option key={type} value={type}>{CATALOG_TYPE_LABELS[type]}</option>)}
            </select>
          </div>

          <section className={styles.list} aria-label="Categorias cadastradas">
            {filtered.map(category => (
              <button key={category.id} className={styles.category} onClick={() => edit(category)}>
                <span><b>{category.name}</b><small>{CATALOG_TYPE_LABELS[category.catalog_type]} · ordem {category.sort_order}</small></span>
                <span className={category.active ? styles.active : styles.inactive}>{category.active ? 'Ativa' : 'Inativa'}</span>
                <Pencil size={15} aria-hidden="true"/>
              </button>
            ))}
            {filtered.length === 0 && <div className={styles.empty}>Nenhuma categoria encontrada.</div>}
          </section>
        </main>
      </div>
    </div>
  )
}
