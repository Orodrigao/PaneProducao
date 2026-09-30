'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Settings } from 'lucide-react'
import { getCurrentUserAsync, roleColor, type AppUser } from '@/lib/auth'
import { loadProductCategories, type ProductCategory } from '@/lib/productCategories'
import {
  PRICING_CHANNELS,
  baseSlots,
  buildPricingChanges,
  categorySlots,
  channelsOverHundred,
  currentValueMap,
  loadPricingSettings,
  marginExceptionCategories,
  pricingChannelLabel,
  runPricingSave,
  savePricingSettings,
  type PricingSettingsData,
} from '@/lib/pricingSettings'
import { PricingCategoryCard, PricingChannelCard, PricingPercentField } from '@/components/PricingSettingsFields'
import { PRICING_HISTORY_STEP, PricingSettingsHistory } from '@/components/PricingSettingsHistory'
import styles from './page.module.css'

type Notice = { kind: 'ok' | 'warn' | 'error'; text: string } | null

export default function ConfiguracaoSistemaPage() {
  const router = useRouter()
  const [user, setUser] = useState<AppUser | null>(null)
  const [data, setData] = useState<PricingSettingsData | null>(null)
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [addedCategoryIds, setAddedCategoryIds] = useState<string[]>([])
  const [pickedCategoryId, setPickedCategoryId] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [historyVisible, setHistoryVisible] = useState(PRICING_HISTORY_STEP)
  const savingRef = useRef(false)

  const reload = useCallback(async () => {
    const [settings, loadedCategories] = await Promise.all([loadPricingSettings(), loadProductCategories()])
    setData(settings)
    setCategories(loadedCategories)
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      const current = await getCurrentUserAsync()
      if (!alive) return
      if (!current || current.role !== 'admin') {
        router.replace('/')
        return
      }
      setUser(current)
      try {
        await reload()
      } catch {
        if (alive) setLoadError('Não foi possível carregar a Configuração do Sistema. Recarregue a página.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [router, reload])

  const current = useMemo(() => currentValueMap(data?.current ?? []), [data])
  const exceptionOptions = useMemo(() => marginExceptionCategories(categories, data?.current ?? []), [categories, data])
  const exceptionCategories = useMemo(() => {
    const shown = new Set([...(data?.current ?? []).flatMap(item => item.categoryId ? [item.categoryId] : []), ...addedCategoryIds])
    return exceptionOptions.filter(category => shown.has(category.id))
  }, [data, addedCategoryIds, exceptionOptions])
  const slots = useMemo(
    () => [...baseSlots(), ...exceptionCategories.flatMap(category => categorySlots(category.id))],
    [exceptionCategories],
  )
  const { changes, errors } = useMemo(() => buildPricingChanges(slots, draft, current), [slots, draft, current])
  const overHundred = useMemo(() => channelsOverHundred(slots, draft, current), [slots, draft, current])
  const errorCount = Object.keys(errors).length
  const saveBlockedReason = saving ? 'Salvando...'
    : errorCount > 0 ? 'Corrija os campos marcados em vermelho para salvar.'
    : changes.length === 0 ? 'Nada mudou desde o último salvamento.'
    : ''

  function changeField(id: string, text: string) {
    setDraft(previous => ({ ...previous, [id]: text }))
    setNotice(null)
  }

  function addException() {
    if (!pickedCategoryId) return
    setAddedCategoryIds(previous => previous.includes(pickedCategoryId) ? previous : [...previous, pickedCategoryId])
    setPickedCategoryId('')
  }

  async function save() {
    if (savingRef.current || saveBlockedReason) return
    savingRef.current = true
    setSaving(true)
    setNotice(null)
    try {
      const outcome = await runPricingSave(changes, savePricingSettings, reload)
      // Só descarta o rascunho quando a tela já mostra o que o banco gravou.
      // Se a releitura falhou, o que foi digitado fica e salvar de novo não
      // duplica: o banco ignora valor igual ao vigente.
      if (outcome.kind === 'saved') {
        setDraft({})
        setAddedCategoryIds([])
      }
      setNotice({ kind: outcome.kind === 'saved' ? 'ok' : outcome.kind === 'saved-reload-failed' ? 'warn' : 'error', text: outcome.message })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="ps-loading"><div className="ps-spinner"/><p>Carregando...</p></div>
  }

  const fieldProps = { draft, current, errors, disabled: saving, onChange: changeField }
  const addable = exceptionOptions.filter(category => !exceptionCategories.some(shown => shown.id === category.id))

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand"><b>Admin · Configuração</b><span>Padrões do negócio</span></div>
          </div>
          {user && <div className="ps-userchip"><div className="ps-avatar" style={{ background: roleColor(user.role) }}>{user.displayName.charAt(0).toUpperCase()}</div><b>{user.displayName}</b></div>}
        </header>

        <main className="ps-scroll ps-pad">
          <h1 className="ps-page-title">Configuração do Sistema</h1>
          {loadError && <p className={styles.error} role="alert">{loadError}</p>}

          {data && (
            <>
              <h2 className={styles.sectionTitle}>Formação de preço</h2>
              <div className="ps-banner honey">
                <Settings size={20} aria-hidden="true" />
                <span><b>Margem é o lucro em % do preço de venda, não acréscimo sobre o custo.</b> Campo vazio significa “não definido” e nunca conta como zero.</span>
              </div>

              <section className={`ps-card ${styles.card}`} aria-label="Imposto">
                <PricingPercentField {...fieldProps} slot={{ key: 'imposto_venda', channel: null, categoryId: null }}
                  label="Imposto sobre a venda (vale para todos os canais)" />
              </section>

              {PRICING_CHANNELS.map(channel => <PricingChannelCard key={channel} channel={channel} {...fieldProps} />)}

              <h2 className={styles.sectionTitle}>Exceções de margem por categoria</h2>
              <p className={styles.fieldMeta}>Use quando uma categoria precisa de margem diferente da do canal. Sem exceção, vale a margem do canal.</p>
              {exceptionCategories.map(category => (
                <PricingCategoryCard key={category.id} categoryId={category.id} categoryName={category.name}
                  channels={PRICING_CHANNELS} {...fieldProps} />
              ))}
              <div className={styles.addRow}>
                <select className="ps-select" value={pickedCategoryId} aria-label="Categoria para exceção"
                  onChange={event => setPickedCategoryId(event.target.value)} disabled={saving || addable.length === 0}>
                  <option value="">{addable.length === 0 ? 'Todas as categorias já têm exceção' : 'Escolha a categoria'}</option>
                  {addable.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
                <button type="button" className="ps-btn" onClick={addException} disabled={!pickedCategoryId || saving}>
                  Adicionar exceção
                </button>
              </div>

              {overHundred.length > 0 && (
                <p className="ps-warning" role="status">
                  Em {overHundred.map(pricingChannelLabel).join(', ')}, imposto + taxa + margem já somam 100% ou mais do preço: nenhum preço fecha essa conta.
                </p>
              )}

              <div className={styles.saveBar}>
                <button type="button" className={styles.saveButton} disabled={Boolean(saveBlockedReason)} onClick={() => void save()}>
                  {saving ? 'Salvando...' : 'Salvar configuração'}
                </button>
                {saveBlockedReason && !saving && <small className={styles.fieldMeta}>{saveBlockedReason}</small>}
              </div>
              {notice && (
                <p className={notice.kind === 'ok' ? 'ps-banner honey' : notice.kind === 'warn' ? 'ps-warning' : styles.error}
                  role={notice.kind === 'ok' ? 'status' : 'alert'}>
                  {notice.text}
                </p>
              )}

              <h2 className={styles.sectionTitle}>Histórico de mudanças</h2>
              <PricingSettingsHistory history={data.history} visible={historyVisible}
                onShowMore={() => setHistoryVisible(visible => visible + PRICING_HISTORY_STEP)} />
            </>
          )}
        </main>
      </div>
    </div>
  )
}
