'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, Plus, RefreshCw, WalletCards } from 'lucide-react'
import { useRouter } from 'next/navigation'
import PayableForm from '@/components/PayableForm'
import PayablePaymentDialog from '@/components/PayablePaymentDialog'
import PayablePurchaseList from '@/components/PayablePurchaseList'
import PayableSupplierStatus from '@/components/PayableSupplierStatus'
import XmlPayableImport, { type XmlSupplierOption } from '@/components/XmlPayableImport'
import { supabase } from '@/lib/supabase'
import {
  cancelPayable,
  isDueSoon,
  isOverdue,
  loadPayablePurchases,
  loadPayablePurchaseItems,
  type PayableProduct,
  type PayableInstallmentRow,
  type PayablePurchaseItemRow,
  type PayablePurchaseRow,
  loadPendingPayableItems,
  loadPayableCategories,
  type PendingPayableItemRow,
  type PayableCategorySlice,
} from '@/lib/payables'
import {
  loadFinanceAccounts,
  loadFinanceCategories,
  type FinanceAccountRow,
  type FinanceCategoryRow,
} from '@/lib/finance'
import { showToast } from '@/lib/utils'

type SupplierOption = XmlSupplierOption

export default function ContasPagarPage() {
  const router = useRouter()
  const [purchases, setPurchases] = useState<PayablePurchaseRow[]>([])
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  const [products, setProducts] = useState<PayableProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showXmlImport, setShowXmlImport] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pendingPurchaseId, setPendingPurchaseId] = useState<string | null>(null)
  const [pendingItems, setPendingItems] = useState<PendingPayableItemRow[]>([])
  const [nfeItemsPurchaseId, setNfeItemsPurchaseId] = useState<string | null>(null)
  const [nfeItems, setNfeItems] = useState<PayablePurchaseItemRow[]>([])
  const [nfeItemsLoading, setNfeItemsLoading] = useState(false)
  const [nfeItemsError, setNfeItemsError] = useState<string | null>(null)
  const nfeItemsRequestId = useRef(0)
  const [paymentTarget, setPaymentTarget] = useState<{
    installment: PayableInstallmentRow
    purchase: PayablePurchaseRow
    mode: 'baixar' | 'corrigir'
    slices: PayableCategorySlice[]
    accountKey: string
  } | null>(null)
  const [financeCategories, setFinanceCategories] = useState<FinanceCategoryRow[]>([])
  const [financeAccounts, setFinanceAccounts] = useState<FinanceAccountRow[]>([])
  const [focusedPayable, setFocusedPayable] = useState<{ purchaseId: string; installmentId: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rows, suppliersResponse, productsResponse, categoryRows, accountRows] = await Promise.all([
        loadPayablePurchases(),
        supabase.from('suppliers').select('id,name,cnpj').eq('active', true).order('name'),
        supabase.from('products').select('id,name,unit,category').eq('active', true).or('kind.eq.insumo,is_revenda.eq.true').order('name'),
        loadFinanceCategories(),
        loadFinanceAccounts(),
      ])
      if (suppliersResponse.error) throw suppliersResponse.error
      if (productsResponse.error) throw productsResponse.error
      setPurchases(rows)
      setSuppliers((suppliersResponse.data ?? []) as SupplierOption[])
      setProducts((productsResponse.data ?? []) as PayableProduct[])
      setFinanceCategories(categoryRows)
      setFinanceAccounts(accountRows)
    } catch (loadError) {
      console.error(loadError)
      setError('Não foi possível carregar as contas da JC. Confira sua permissão e tente novamente.')
    } finally {
      setLoading(false)
    }
  }, [])

  async function openPendingItems(purchaseId: string) {
    setBusyId(purchaseId)
    try {
      setPendingItems(await loadPendingPayableItems(purchaseId))
      setPendingPurchaseId(purchaseId)
    } catch (loadError) {
      console.error(loadError)
      showToast('Não foi possível abrir os itens pendentes.')
    } finally { setBusyId(null) }
  }

  async function refreshPendingItems() {
    if (!pendingPurchaseId) return
    const items = await loadPendingPayableItems(pendingPurchaseId)
    setPendingItems(items)
    if (items.length === 0) setPendingPurchaseId(null)
    await load()
  }

  async function openNfeItems(purchaseId: string) {
    const requestId = nfeItemsRequestId.current + 1
    nfeItemsRequestId.current = requestId
    setNfeItemsPurchaseId(purchaseId)
    setNfeItems([])
    setNfeItemsError(null)
    setNfeItemsLoading(true)
    try {
      const items = await loadPayablePurchaseItems(purchaseId)
      if (nfeItemsRequestId.current === requestId) setNfeItems(items)
    } catch (loadError) {
      console.error(loadError)
      if (nfeItemsRequestId.current === requestId) setNfeItemsError('Não foi possível carregar os itens desta NF-e.')
    } finally {
      if (nfeItemsRequestId.current === requestId) setNfeItemsLoading(false)
    }
  }

  function closeNfeItems() {
    nfeItemsRequestId.current += 1
    setNfeItemsPurchaseId(null)
    setNfeItems([])
    setNfeItemsError(null)
    setNfeItemsLoading(false)
  }

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    const purchaseId = search.get('purchase')
    const installmentId = search.get('installment')
    if (purchaseId && installmentId) setFocusedPayable({ purchaseId, installmentId })
  }, [])

  const reminders = useMemo(() => {
    const installments = purchases.flatMap(purchase => purchase.payable_installments ?? [])
    return {
      overdue: installments.filter(installment => isOverdue(installment)).length,
      dueSoon: installments.filter(installment => isDueSoon(installment)).length,
    }
  }, [purchases])

  async function openPaymentDialog(installment: PayableInstallmentRow, purchase: PayablePurchaseRow, mode: 'baixar' | 'corrigir') {
    setBusyId(purchase.id)
    try {
      // A classificação já salva volta preenchida: a Elis confirma em vez de
      // escolher tudo de novo a cada parcela.
      const salvas = await loadPayableCategories(purchase.id)
      const porId = new Map(financeCategories.map(category => [category.id, category.key]))
      const slices: PayableCategorySlice[] = salvas
        .map(linha => ({ categoryKey: porId.get(linha.category_id) ?? '', amount: Number(linha.amount).toFixed(2) }))
        .filter(slice => slice.categoryKey)
      const accountKey = financeAccounts.find(account => account.id === purchase.finance_account_id)?.key ?? ''
      setPaymentTarget({ installment, purchase, mode, slices, accountKey })
    } catch (loadError) {
      console.error(loadError)
      showToast('Não foi possível carregar a categoria desta conta.')
    } finally {
      setBusyId(null)
    }
  }

  async function finishPayment() {
    setPaymentTarget(null)
    await load()
  }

  async function handleCancel(purchaseId: string) {
    const reason = window.prompt('Por que esta conta será cancelada?')?.trim()
    if (!reason) return
    setBusyId(purchaseId)
    try {
      await cancelPayable(purchaseId, reason)
      showToast('Conta cancelada e preservada no histórico.')
      await load()
    } catch (cancelError) {
      console.error(cancelError)
      showToast(cancelError instanceof Error ? cancelError.message : 'Não foi possível cancelar a conta.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark"><WalletCards size={18} /></div>
            <div className="ps-brand"><b>Contas a pagar</b><span>JC · manual e NF-e</span></div>
          </div>
          <button className="ps-iconbtn" onClick={() => void load()} aria-label="Atualizar contas" title="Atualizar"><RefreshCw size={17} /></button>
        </header>

        <div className="ps-scroll ps-pad">
          <div className="ps-banner honey">
            <b>Financeiro da JC</b>
            <small>Registre compras sem nota ou importe NF-e. O financeiro fica rastreado; o estoque será integrado depois.</small>
          </div>

          {!loading && !error && <PayableSupplierStatus suppliers={suppliers} purchases={purchases} />}

          {(reminders.overdue > 0 || reminders.dueSoon > 0) && (
            <div className="ps-card" style={{ marginTop: 12, borderColor: reminders.overdue > 0 ? 'var(--berry)' : 'var(--honey-deep)' }}>
              <b>{reminders.overdue > 0 ? `Atenção: ${reminders.overdue} vencimento(s) atrasado(s).` : `Lembrete: ${reminders.dueSoon} vencimento(s) nos próximos 7 dias.`}</b>
              <small style={{ display: 'block', marginTop: 4 }}>Confira as parcelas abaixo e registre a baixa somente depois do pagamento.</small>
            </div>
          )}

          {showForm ? (
            <PayableForm
              suppliers={suppliers}
              products={products}
              financeCategories={financeCategories}
              financeAccounts={financeAccounts}
              onCancel={() => setShowForm(false)}
              onSaved={async () => { setShowForm(false); await load() }}
            />
          ) : showXmlImport ? (
            <XmlPayableImport
              suppliers={suppliers}
              products={products}
              onCancel={() => setShowXmlImport(false)}
              onSaved={async () => { setShowXmlImport(false); await load() }}
            />
          ) : (
            <div className="ps-fieldrow" style={{ marginTop: 14 }}>
              <button className="ps-btn primary block" onClick={() => setShowForm(true)}><Plus size={16} /> Nova compra manual</button>
              <button className="ps-btn ghost block" onClick={() => setShowXmlImport(true)}>Importar XML da NF-e</button>
              <button className="ps-btn ghost block" onClick={() => router.push('/contas-pagar/relatorio')}><BarChart3 size={16} /> Relatório por período</button>
            </div>
          )}

          {error && (
            <div className="ps-card" style={{ marginTop: 14, borderColor: 'var(--berry)' }}>
              <b>Não carregou</b><p style={{ margin: '6px 0 10px' }}>{error}</p>
              <button className="ps-btn ghost sm" onClick={() => void load()}>Tentar novamente</button>
            </div>
          )}

          <div className="ps-label">Lançamentos da JC</div>
          {loading ? <div className="ps-empty">Carregando contas...</div> : (
            <PayablePurchaseList
              purchases={purchases}
              products={products}
              pendingPurchaseId={pendingPurchaseId}
              pendingItems={pendingItems}
              nfeItemsPurchaseId={nfeItemsPurchaseId}
              nfeItems={nfeItems}
              nfeItemsLoading={nfeItemsLoading}
              nfeItemsError={nfeItemsError}
              busyId={busyId}
              focusedPurchaseId={focusedPayable?.purchaseId}
              focusedInstallmentId={focusedPayable?.installmentId}
              onOpenPending={purchaseId => void openPendingItems(purchaseId)}
              onRefreshPending={() => void refreshPendingItems()}
              onClosePending={() => setPendingPurchaseId(null)}
              onOpenNfeItems={purchaseId => void openNfeItems(purchaseId)}
              onCloseNfeItems={closeNfeItems}
              onPay={(installment, purchase) => void openPaymentDialog(installment, purchase, 'baixar')}
              onCorrect={(installment, purchase) => void openPaymentDialog(installment, purchase, 'corrigir')}
              onCancel={purchaseId => void handleCancel(purchaseId)}
            />
          )}

          {paymentTarget && (
            <PayablePaymentDialog
              installment={paymentTarget.installment}
              purchaseId={paymentTarget.purchase.id}
              purchaseDate={paymentTarget.purchase.purchase_date}
              purchaseTotal={Number(paymentTarget.purchase.total_value)}
              supplierName={Array.isArray(paymentTarget.purchase.suppliers) ? paymentTarget.purchase.suppliers[0]?.name ?? 'Fornecedor não identificado' : paymentTarget.purchase.suppliers?.name ?? 'Fornecedor não identificado'}
              mode={paymentTarget.mode}
              financeCategories={financeCategories}
              financeAccounts={financeAccounts}
              initialSlices={paymentTarget.slices}
              initialAccountKey={paymentTarget.accountKey}
              onClose={() => setPaymentTarget(null)}
              onSaved={finishPayment}
            />
          )}

          <div className="ps-card" style={{ marginTop: 14, background: 'var(--cream-raise)' }}>
            <small>Fornecedor novo? No XML, você pode cadastrá-lo direto durante a importação. Para compras manuais, <button className="ps-link" onClick={() => router.push('/fornecedores')}>cadastre em Fornecedores</button>. A compra permanece somente financeira nesta fase.</small>
          </div>
        </div>
      </div>
    </div>
  )
}
